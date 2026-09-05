import { spawn, type ChildProcess } from 'node:child_process'
import { access, readdir, rename as fsRename, unlink } from 'node:fs/promises'
import { cpus, constants as osConstants, setPriority } from 'node:os'
import { extname, join } from 'node:path'
import type { AudioTrack, Clip, ClipPatch } from '@shared/types'
import { FFMPEG, FFPROBE, audioDir, cacheDir } from './paths'

export const SPRITE_FRAMES = 10
const THUMB_WIDTH = 480
const SPRITE_FRAME_WIDTH = 320
const JOB_TIMEOUT_MS = 60_000
/**
 * `area` is the cheapest swscale mode that still anti-aliases a 7x downscale;
 * `fast_bilinear` is ~10% quicker but speckles the poster.
 */
const SCALE_FLAGS = 'area'
/** Seeks landing within one GOP of the poster time reuse that frame instead of a second decode. */
const POSTER_REUSE_WINDOW_S = 1
/**
 * The clip's own first frame: the card's poster, the still the player stands in
 * with while it opens, and the frame playback starts on are then all the same
 * picture, so none of the three hands over to another with a visible change.
 */
const POSTER_TIME = 0
/**
 * Bumped whenever the frames these files hold change meaning. The name is what
 * makes a cached artifact a hit, so a library cut by an older build regenerates
 * once on launch rather than keeping posters this build would not have made.
 */
const ARTIFACT_VERSION = 2
/** Past this, a stream start difference is a misread file rather than a real offset. */
const MAX_TRACK_OFFSET_S = 1
/** Containers whose AAC needs its ASC rebuilt on the way into mp4. */
const ADTS_CONTAINERS = new Set(['.mkv', '.ts', '.flv', '.avi', '.webm'])

export interface ProbeResult {
  duration: number
  width: number
  height: number
  fps: number
  vcodec: string
  hasAudio: boolean
  audioTracks: AudioTrack[]
}

export interface Artifacts {
  thumb: string
  sprite: string
  spriteFrames: number
}

function lowerPriority(pid: number | undefined): void {
  if (!pid) return
  try {
    setPriority(pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
  } catch {
    // Not fatal: the job still runs, just at normal priority.
  }
}

/** Every live ffmpeg/ffprobe child, so shutdown can kill them instead of orphaning them. */
const active = new Set<ChildProcess>()

function run(bin: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    active.add(child)
    lowerPriority(child.pid)
    let stdout = ''
    const timer = setTimeout(() => child.kill(), JOB_TIMEOUT_MS)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', () => undefined)
    child.on('error', (err) => {
      clearTimeout(timer)
      active.delete(child)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      active.delete(child)
      resolve({ code: code ?? -1, stdout })
    })
  })
}

export function killActiveJobs(): void {
  for (const child of active) child.kill()
  active.clear()
}

export interface LongJobOptions {
  /** Kill if no stdout line arrives for this long: the job is wedged, not slow. */
  stallMs: number
  /** Absolute cap, whatever the output. */
  maxMs: number
  onLine?: (line: string) => void
  signal?: AbortSignal
}

/**
 * Sibling of `run()` for jobs that legitimately outlive `JOB_TIMEOUT_MS`,
 * i.e. an export. Same spawn contract (hidden window, below-normal priority,
 * registered for shutdown), but stdout is handed over line by line so the
 * caller can read `-progress` output, the stall timer resets on every line,
 * and the last couple of KB of stderr come back for the error toast.
 */
export function runLong(
  bin: string,
  args: string[],
  opts: LongJobOptions,
): Promise<{ code: number; stderrTail: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    active.add(child)
    lowerPriority(child.pid)
    let stderrTail = ''
    let buffered = ''
    let stall: NodeJS.Timeout | null = null
    const armStall = (): void => {
      if (stall) clearTimeout(stall)
      stall = setTimeout(() => child.kill(), opts.stallMs)
    }
    armStall()
    const cap = setTimeout(() => child.kill(), opts.maxMs)
    const onAbort = (): void => {
      child.kill()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const done = (): void => {
      if (stall) clearTimeout(stall)
      clearTimeout(cap)
      opts.signal?.removeEventListener('abort', onAbort)
      active.delete(child)
    }
    child.stdout.on('data', (d: Buffer) => {
      armStall()
      buffered += d.toString()
      let nl = buffered.indexOf('\n')
      while (nl >= 0) {
        opts.onLine?.(buffered.slice(0, nl).trim())
        buffered = buffered.slice(nl + 1)
        nl = buffered.indexOf('\n')
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-2048)
    })
    child.on('error', (err) => {
      done()
      reject(err)
    })
    child.on('close', (code) => {
      done()
      resolve({ code: code ?? -1, stderrTail: stderrTail.trim() })
    })
  })
}

function parseFps(rate: string | undefined): number {
  if (!rate) return 0
  const [n, d] = rate.split('/').map(Number)
  if (!n) return 0
  return d ? Math.round((n / d) * 100) / 100 : n
}

interface FfprobeStream {
  index?: number
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  start_time?: string
  channels?: number
  disposition?: { default?: number }
  tags?: { language?: string; title?: string }
}

interface FfprobeJson {
  format?: { duration?: string }
  streams?: FfprobeStream[]
}

/** Seconds, or 0 for the ffprobe spellings of "no idea" (absent, 'N/A', NaN). */
function seconds(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

/**
 * Audio streams in file order. `index` is the ordinal *among audio streams* —
 * the n in `-map 0:a:n` — while `streamIndex` is the absolute one ffprobe
 * reports; mixing the two up silently selects the wrong track, so the
 * type-relative one is what the rest of the app passes around.
 */
function audioTracks(streams: FfprobeStream[], videoStart: number): AudioTrack[] {
  const audio = streams.filter((s) => s.codec_type === 'audio')
  const marked = audio.findIndex((s) => s.disposition?.default === 1)
  // Nothing marked default means Chromium takes the first audio stream.
  const fallback = marked < 0 ? 0 : marked
  return audio.map((s, i) => ({
    index: i,
    streamIndex: s.index ?? -1,
    codec: s.codec_name ?? '',
    channels: s.channels ?? 0,
    title: s.tags?.title ?? '',
    language: language(s.tags?.language),
    isDefault: i === fallback,
    offset: trackOffset(videoStart, seconds(s.start_time)),
  }))
}

/**
 * A real language tag, or ''. ffmpeg stamps every untagged stream 'und'
 * ("undetermined"), and 'zxx' means there is no speech in it — neither is a
 * name, and both would otherwise be shown as one.
 */
function language(raw: string | undefined): string {
  const tag = (raw ?? '').trim().toLowerCase()
  return tag === 'und' || tag === 'zxx' ? '' : (raw ?? '')
}

/**
 * How far an extracted track has to be nudged to line up with the video.
 *
 * Streams in one file can start at different presentation times, and the two
 * media elements each zero their own timeline, so that difference survives as a
 * constant lip-sync error the drift corrector would faithfully preserve.
 * Extraction keeps source timestamps (`-copyts`), which makes the gap
 * measurable here rather than guessable later. Anything past a second is not a
 * stream offset, it is a file we have misread — take 0 and let the corrector
 * work rather than shifting audio by a wrong constant.
 */
function trackOffset(videoStart: number, audioStart: number): number {
  const delta = videoStart - audioStart
  if (!Number.isFinite(delta) || Math.abs(delta) > MAX_TRACK_OFFSET_S) return 0
  return Math.round(delta * 1000) / 1000
}

export async function probe(filePath: string): Promise<ProbeResult> {
  const { code, stdout } = await run(FFPROBE, [
    '-v',
    'error',
    '-print_format',
    'json',
    // Only the fields we read. The per-stream tag and disposition dumps are
    // narrowed the same way: audio track names and which one plays by default
    // are worth the bytes, the rest of what ffprobe would emit is not.
    '-show_entries',
    'format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration,start_time,channels:stream_tags=language,title:stream_disposition=default',
    filePath,
  ])
  if (code !== 0) throw new Error(`ffprobe exited with ${code}`)
  const json = JSON.parse(stdout) as FfprobeJson
  const streams = json.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const tracks = audioTracks(streams, seconds(video?.start_time))
  const duration = Number(json.format?.duration ?? video?.duration ?? 0)
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: parseFps(video?.avg_frame_rate) || parseFps(video?.r_frame_rate),
    vcodec: video?.codec_name ?? '',
    hasAudio: tracks.length > 0,
    audioTracks: tracks,
  }
}

/** Cache names include the mtime so a re-recorded file never shows a stale poster. */
export function thumbName(clip: Clip): string {
  return `${clip.id}-${Math.round(clip.mtimeMs)}-v${ARTIFACT_VERSION}.jpg`
}
export function spriteName(clip: Clip): string {
  return `${clip.id}-${Math.round(clip.mtimeMs)}-v${ARTIFACT_VERSION}.sprite.jpg`
}

/** Cached under a name this build would not write: the frames in it are not the ones it wants. */
export function artifactsStale(clip: Clip): boolean {
  return Boolean(
    (clip.thumb && clip.thumb !== thumbName(clip)) ||
    (clip.sprite && clip.sprite !== spriteName(clip)),
  )
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export function spriteFrameCount(duration: number): number {
  return Math.max(4, Math.min(SPRITE_FRAMES, Math.floor(duration)))
}

/**
 * One input per seek point. Every option here is per-input on purpose: ffmpeg
 * applies `-threads`/seek flags only to the `-i` that follows them, so a
 * single global `-threads 1` leaves inputs 2..N decoding on every core.
 *
 * `-noaccurate_seek` + `-skip_frame nokey` output the keyframe at or before
 * the target instead of decoding the whole GOP up to the exact timestamp;
 * on 60fps HEVC that is one intra frame instead of up to thirty.
 * `-skip_loop_filter all` drops deblocking/SAO, invisible at thumbnail size.
 */
function seekInput(path: string, at: number): string[] {
  return [
    '-threads',
    '1',
    '-noaccurate_seek',
    '-skip_frame',
    'nokey',
    '-skip_loop_filter',
    'all',
    '-ss',
    at.toFixed(2),
    '-i',
    path,
  ]
}

function scaleTo(width: number, from: string, to: string): string {
  return `[${from}]scale=${width}:-2:flags=${SCALE_FLAGS}[${to}]`
}

/**
 * Poster + hover-scrub strip from a single ffmpeg process. Seeks are
 * keyframe-only and stitched with `hstack`; the poster is split off the
 * matching sprite seek when one is close enough, so the common case is
 * exactly `SPRITE_FRAMES` decodes and one spawn per clip. Whichever
 * artifact already exists on disk is skipped.
 */
export async function makeArtifacts(clip: Clip, duration: number): Promise<Artifacts> {
  const thumb = thumbName(clip)
  const sprite = spriteName(clip)
  const thumbPath = join(cacheDir(), thumb)
  const spritePath = join(cacheDir(), sprite)
  const frames = spriteFrameCount(duration)
  const needThumb = !(await exists(thumbPath))
  const needSprite = !(await exists(spritePath))
  if (!needThumb && !needSprite) return { thumb, sprite, spriteFrames: frames }

  // The strip opens on the first frame and steps through the clip from there.
  // Dividing by `frames` rather than `frames - 1` keeps the last seek short of
  // the end, where there is no frame left to land on.
  const times: number[] = []
  if (needSprite) for (let i = 0; i < frames; i++) times.push((duration * i) / frames)
  let posterIdx = -1
  if (needThumb) {
    posterIdx = times.findIndex((t) => Math.abs(t - POSTER_TIME) < POSTER_REUSE_WINDOW_S)
    if (posterIdx < 0) posterIdx = times.push(POSTER_TIME) - 1
  }

  const args = ['-y', '-v', 'error']
  for (const t of times) args.push(...seekInput(clip.path, t))

  const graph: string[] = []
  let stacked = ''
  for (let i = 0; i < times.length; i++) {
    const inSprite = needSprite && i < frames
    if (i === posterIdx && inSprite) {
      graph.push(
        `[${i}:v]split[p][s]`,
        scaleTo(THUMB_WIDTH, 'p', 'poster'),
        scaleTo(SPRITE_FRAME_WIDTH, 's', `f${i}`),
      )
    } else if (i === posterIdx) {
      graph.push(scaleTo(THUMB_WIDTH, `${i}:v`, 'poster'))
    } else {
      graph.push(scaleTo(SPRITE_FRAME_WIDTH, `${i}:v`, `f${i}`))
    }
    if (inSprite) stacked += `[f${i}]`
  }
  if (needSprite) graph.push(`${stacked}hstack=inputs=${frames}[sprite]`)
  args.push('-filter_complex', graph.join(';'))
  if (needThumb)
    args.push('-map', '[poster]', '-frames:v', '1', '-threads', '1', '-q:v', '4', thumbPath)
  if (needSprite)
    args.push('-map', '[sprite]', '-frames:v', '1', '-threads', '1', '-q:v', '5', spritePath)

  const { code } = await run(FFMPEG, args)
  if (code !== 0) {
    // Never leave a half-written JPEG behind to be mistaken for a cache hit.
    if (needThumb) await unlink(thumbPath).catch(() => undefined)
    if (needSprite) await unlink(spritePath).catch(() => undefined)
    throw new Error(`ffmpeg artifacts exited with ${code}`)
  }
  return { thumb, sprite, spriteFrames: frames }
}

/**
 * Name of the cached extraction for one audio track. Carries the mtime for the
 * same reason the poster does: a re-recorded file must never hit a stale cache.
 */
export function audioTrackName(clip: Pick<Clip, 'id' | 'mtimeMs'>, index: number): string {
  return `${clip.id}-${Math.round(clip.mtimeMs)}.a${index}.m4a`
}

/**
 * Pull one audio track out into its own file so the player can play it beside
 * the video, which is the only way to hear a track Chromium is not rendering.
 *
 * AAC is copied; anything else is transcoded, because the point is a file
 * Chromium will decode, not a faithful archive. Timestamps are deliberately
 * left alone — the export path's `-avoid_negative_ts make_zero` would shift the
 * first sample to zero and destroy the very offset `trackOffset` measured.
 */
export async function extractAudioTrack(clip: Clip, index: number): Promise<string> {
  const file = audioTrackName(clip, index)
  const out = join(audioDir(), file)
  if (await exists(out)) return file

  const track = clip.audioTracks[index]
  const copy = track?.codec === 'aac'
  // A half-written file under the real name is indistinguishable from a cache
  // hit forever, so it only takes that name once ffmpeg has exited cleanly.
  const temp = join(audioDir(), `~${file}`)
  const args = ['-y', '-nostdin', '-v', 'error', '-threads', '1', '-i', clip.path]
  args.push('-map', `0:a:${index}`, '-vn', '-sn', '-dn')
  if (copy) {
    args.push('-c:a', 'copy')
    // Matroska keeps the AudioSpecificConfig aside and MPEG-TS is ADTS-framed;
    // without this the mp4 muxer writes an esds Chromium cannot build a decoder
    // from. A no-op when the extradata is already in mp4 shape.
    if (ADTS_CONTAINERS.has(extname(clip.path).toLowerCase())) args.push('-bsf:a', 'aac_adtstoasc')
  } else {
    args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2')
  }
  args.push('-copyts', '-avoid_negative_ts', 'disabled', '-muxdelay', '0', '-muxpreload', '0')
  args.push('-f', 'mp4', temp)

  // A copy is over in milliseconds; a transcode of a long clip is not, and
  // runLong only resets its stall timer on stdout, hence -progress there.
  const code = copy
    ? (await run(FFMPEG, args)).code
    : (
        await runLong(FFMPEG, [...args, '-progress', 'pipe:1', '-stats_period', '0.5'], {
          stallMs: 30_000,
          maxMs: 10 * 60_000,
        })
      ).code
  if (code !== 0) {
    await unlink(temp).catch(() => undefined)
    throw new Error(`ffmpeg audio track exited with ${code}`)
  }
  await fsRename(temp, out)
  return file
}

/**
 * Every extraction belonging to a clip, whatever mtime it was cut at. Names are
 * derived rather than stored, so this sweeps the stale and the orphaned too.
 */
export async function removeAudioTracks(clipId: string): Promise<void> {
  if (!clipId) return
  const dir = audioDir()
  const names = await readdir(dir).catch(() => [] as string[])
  for (const name of names) {
    if (name.startsWith(`${clipId}-`) || name.startsWith(`~${clipId}-`))
      await unlink(join(dir, name)).catch(() => undefined)
  }
}

export async function removeArtifacts(clip: Pick<Clip, 'thumb' | 'sprite'>): Promise<void> {
  for (const f of [clip.thumb, clip.sprite]) {
    if (!f) continue
    await unlink(join(cacheDir(), f)).catch(() => undefined)
  }
}

export function ffmpegAvailable(): boolean {
  return Boolean(FFMPEG && FFPROBE)
}

type JobRunner = (clip: Clip) => Promise<ClipPatch>

/**
 * Bounded-concurrency queue. Concurrency stays low and every child runs at
 * below-normal priority, so a running game or the player never has to fight
 * the indexer for CPU.
 */
export class MediaQueue {
  private queue: Clip[] = []
  private queued = new Set<string>()
  private running = 0
  private stopped = false
  concurrency: number
  onProgress: (pending: number) => void = () => undefined

  constructor(
    private readonly runner: JobRunner,
    private readonly onDone: (patch: ClipPatch) => void,
    concurrency?: number,
  ) {
    this.concurrency = concurrency ?? Math.max(1, Math.min(2, Math.floor(cpus().length / 4)))
  }

  get pending(): number {
    return this.queue.length + this.running
  }

  has(id: string): boolean {
    return this.queued.has(id)
  }

  enqueue(clip: Clip, front = false): void {
    if (this.queued.has(clip.id)) return
    this.queued.add(clip.id)
    if (front) this.queue.unshift(clip)
    else this.queue.push(clip)
    this.pump()
  }

  remove(id: string): void {
    if (!this.queued.has(id)) return
    this.queue = this.queue.filter((c) => c.id !== id)
    this.queued.delete(id)
  }

  /** Drops the backlog and kills in-flight children; their results are discarded, not recorded as failures. */
  stop(): void {
    this.stopped = true
    this.queue = []
    this.queued.clear()
    killActiveJobs()
  }

  private pump(): void {
    while (!this.stopped && this.running < this.concurrency && this.queue.length) {
      const clip = this.queue.shift()!
      this.running++
      this.onProgress(this.pending)
      this.runner(clip)
        .then((patch) => {
          if (!this.stopped) this.onDone(patch)
        })
        .catch(() => {
          if (!this.stopped) this.onDone({ id: clip.id, probeState: 'failed' })
        })
        .finally(() => {
          this.queued.delete(clip.id)
          this.running--
          this.onProgress(this.pending)
          // Yield between jobs so IPC and the UI stay responsive.
          setImmediate(() => this.pump())
        })
    }
  }
}
