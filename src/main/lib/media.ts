import { spawn, type ChildProcess } from 'node:child_process'
import { access, readdir, rename as fsRename, unlink } from 'node:fs/promises'
import { constants as osConstants, setPriority } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { AudioTrack, Clip } from '@shared/types'
import { ADTS_CONTAINERS, TONE_MAP } from './exports'
import { jxrTuning } from './jxr'
import { touch } from './maintenance'
import jxrWorkerPath from './jxr.worker?modulePath'
import { FFMPEG, FFPROBE, audioDir, cacheDir } from './paths'

/**
 * Frames in a hover-scrub strip. Each is a keyframe decode, so this is the
 * strip's cost almost to the millisecond: five is one frame per 24–60 s of a
 * ShadowPlay clip, and half the import time ten cost. The count is part of
 * the strip's cache name, so changing it retires the strips already cut.
 */
export const SPRITE_FRAMES = 5
const THUMB_WIDTH = 480
/**
 * Every strip frame is exactly this, a 16:9 centre crop of the picture — the
 * same crop the card gives the poster. The card slides the strip by whole
 * frames as a percentage of its width, which is only exact when frame and
 * card share an aspect: a 21:9 recording left uncropped made every slot
 * straddle two frames.
 */
const SPRITE_FRAME_WIDTH = 320
const SPRITE_FRAME_HEIGHT = 180
/**
 * Frames in a trim filmstrip, by clip length. ShadowPlay puts a keyframe every
 * half second and a seek lands on the keyframe at or before its target, so
 * slots closer together than that show the same frame twice: a short clip
 * gets a slot per half second, a long one the cap. Thirty-two is a frame per
 * cell of the trim bar on an ultrawide, and ~2 s of cutting for an HDR clip
 * on two workers at ~100 ms a frame; an SDR clip is a third of that, mostly
 * the seeks.
 */
const FILM_FRAMES_MAX = 32
const FILM_FRAMES_MIN = 8
const FILM_FRAME_GAP_S = 0.5
/**
 * Seeks per ffmpeg process, and processes at once. Batches are kept small so
 * a cancelled cut wastes little and two workers share a strip evenly; two of
 * them halve an HDR strip's wait while looking like no more than a couple of
 * threads to a running game.
 */
const FILM_BATCH = 4
const FILM_WORKERS = 2
const JOB_TIMEOUT_MS = 60_000
/**
 * `area` is the cheapest swscale mode that still anti-aliases a 7x downscale;
 * `fast_bilinear` is ~10% quicker but speckles the poster.
 */
const SCALE_FLAGS = 'area'
/**
 * Filters default to a thread per core, which on a thumbnail-sized frame
 * costs more in spin-up than it saves, and would make one of our jobs look
 * like a whole machine's worth of load to the import burst (lib/burst.ts),
 * which counts each job as one thread. One thread for the decoder, one for
 * the filters: measured 4–15% faster per job on top of being predictable.
 */
const ONE_THREAD_FILTERS = ['-filter_threads', '1', '-filter_complex_threads', '1']
/** The transfer characteristics ffprobe reports for an HDR stream: PQ, and HLG. */
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])
/**
 * Bumped whenever the frames these files hold change meaning. The name is what
 * makes a cached artifact a hit, so a library cut by an older build regenerates
 * once on launch rather than keeping posters this build would not have made.
 * An HDR clip's names carry an `h` besides, so learning that a clip is HDR
 * (the probe reads it) retires the un-mapped frames cut before it was known.
 */
const ARTIFACT_VERSION = 2
/** Past this, a stream start difference is a misread file rather than a real offset. */
const MAX_TRACK_OFFSET_S = 1
/**
 * How much to read when looking for the keyframe before an export's in-point.
 * A few frames is enough: the seek that precedes the read is what finds the
 * keyframe, the read only has to reach far enough to report it.
 */
const KEYFRAME_WINDOW_S = 0.05

export interface ProbeResult {
  duration: number
  width: number
  height: number
  fps: number
  vcodec: string
  hdr: boolean
  hasAudio: boolean
  audioTracks: AudioTrack[]
}

export interface SpriteStrip {
  sprite: string
  spriteFrames: number
}

/** What the JPEG XR helper hands back: the render's cache name and the size it read. */
export interface JxrRender {
  render: string
  width: number
  height: number
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
/** Every live JPEG XR decode thread, for the same reason. */
const workers = new Set<Worker>()

function run(
  bin: string,
  args: string[],
  /** `input` is written to the child's stdin and closed, for ffmpeg's `pipe:0`; `signal` kills the child. */
  opts: { input?: Uint8Array; signal?: AbortSignal } = {},
): Promise<{ code: number; stdout: string; stderrTail: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: [opts.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
    active.add(child)
    lowerPriority(child.pid)
    const onAbort = (): void => {
      child.kill()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    if (opts.signal?.aborted) child.kill()
    if (opts.input && child.stdin) {
      // A child that quits early closes the pipe under the write; its exit code
      // tells that story, so the write error itself is not one.
      child.stdin.on('error', () => undefined)
      child.stdin.end(opts.input)
    }
    let stdout = ''
    // Only the end of stderr is kept, for the message a failure is reported with.
    let stderrTail = ''
    const timer = setTimeout(() => child.kill(), JOB_TIMEOUT_MS)
    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-2048)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      active.delete(child)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      active.delete(child)
      resolve({ code: code ?? -1, stdout, stderrTail: stderrTail.trim() })
    })
  })
}

export function killActiveJobs(): void {
  for (const child of active) child.kill()
  active.clear()
  for (const worker of workers) void worker.terminate()
  workers.clear()
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
  color_transfer?: string
  duration?: string
  start_time?: string
  channels?: number
  disposition?: { default?: number }
  tags?: { language?: string; title?: string }
}

interface FfprobePacket {
  pts_time?: string
  flags?: string
}

interface FfprobeJson {
  format?: { duration?: string }
  streams?: FfprobeStream[]
  packets?: FfprobePacket[]
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
    'format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,color_transfer,duration,start_time,channels:stream_tags=language,title:stream_disposition=default',
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
    hdr: HDR_TRANSFERS.has(video?.color_transfer ?? ''),
    hasAudio: tracks.length > 0,
    audioTracks: tracks,
  }
}

/**
 * When the last video keyframe at or before `at` is, in seconds from the start
 * of the file, or null when ffprobe cannot say.
 *
 * `-read_intervals` seeks before it reads, and a seek lands on the keyframe at
 * or before its target, so a window of a couple of frames starting at `at`
 * reports that keyframe as its first packet however long the GOP is — without
 * reading the file from the top. The stream's own start time is asked for in
 * the same call and taken back off: packet times carry it, and `-ss` adds it
 * again, so a file that does not start at zero would be seeked twice as far.
 */
export async function keyframeBefore(filePath: string, at: number): Promise<number | null> {
  if (!(at > 0)) return null
  const { code, stdout } = await run(FFPROBE, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=start_time:packet=pts_time,flags',
    '-read_intervals',
    `${at.toFixed(3)}%+${KEYFRAME_WINDOW_S}`,
    filePath,
  ])
  if (code !== 0) return null
  let json: FfprobeJson
  try {
    json = JSON.parse(stdout) as FfprobeJson
  } catch {
    return null
  }
  const base = seconds(json.streams?.[0]?.start_time)
  let best = -1
  for (const packet of json.packets ?? []) {
    // 'K' is the key-frame flag; the rest of the field is discard/corrupt.
    if (!packet.flags?.includes('K')) continue
    const pts = Number(packet.pts_time)
    if (!Number.isFinite(pts)) continue
    const t = pts - base
    if (t >= 0 && t <= at && t > best) best = t
  }
  return best < 0 ? null : best
}

/**
 * Cache names include the mtime so a re-recorded file never shows a stale
 * poster, and the HDR marker so a clip found to be HDR never keeps the
 * un-mapped frames cut before the probe said so.
 */
function frameStem(clip: Clip): string {
  return `${clip.id}-${Math.round(clip.mtimeMs)}-v${ARTIFACT_VERSION}${clip.hdr ? 'h' : ''}`
}
export function thumbName(clip: Clip): string {
  return `${frameStem(clip)}.jpg`
}
/** The strip's geometry is in its name, so a change to any of it retires the strips already cut. */
export function spriteName(clip: Clip): string {
  return `${frameStem(clip)}.sprite-${SPRITE_FRAMES}x${SPRITE_FRAME_WIDTH}x${SPRITE_FRAME_HEIGHT}.jpg`
}
/** The trim bar's filmstrip. Frame count and geometry are in the name, as the sprite's are. */
export function filmName(clip: Clip): string {
  const n = filmFrameCount(clip.duration)
  return `${frameStem(clip)}.film-${n}x${SPRITE_FRAME_WIDTH}x${SPRITE_FRAME_HEIGHT}.jpg`
}
/** The SDR copy of an HDR screenshot. A jpg in the cache, so `clip://thumb` can serve it. */
export function renderName(clip: Clip): string {
  return `${clip.id}-${Math.round(clip.mtimeMs)}-v${ARTIFACT_VERSION}.render.jpg`
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

export function filmFrameCount(duration: number): number {
  const slots = Math.floor(duration / FILM_FRAME_GAP_S)
  return Math.max(FILM_FRAMES_MIN, Math.min(FILM_FRAMES_MAX, slots))
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

/** Downscale, then for an HDR frame the tone map — in that order, so the curve runs over the small picture. */
function frameFilter(width: number, hdr: boolean): string {
  const scale = `scale=${width}:-2:flags=${SCALE_FLAGS}`
  return hdr ? `${scale},${TONE_MAP}` : scale
}

/**
 * A strip frame: scaled to cover `SPRITE_FRAME_WIDTH` x `SPRITE_FRAME_HEIGHT`
 * and centre-cropped to exactly that (CSS `object-fit: cover`, done here so
 * the card's whole-frame slide is exact), then the tone map if HDR.
 */
function stripFilter(hdr: boolean): string {
  const cover =
    `scale=${SPRITE_FRAME_WIDTH}:${SPRITE_FRAME_HEIGHT}:force_original_aspect_ratio=increase` +
    `:force_divisible_by=2:flags=${SCALE_FLAGS},crop=${SPRITE_FRAME_WIDTH}:${SPRITE_FRAME_HEIGHT}`
  return hdr ? `${cover},${TONE_MAP}` : cover
}

/**
 * The card's poster: the clip's own first frame, so the poster, the still the
 * player stands in with while it opens, and the frame playback starts on are
 * all the same picture and none hands over to another with a visible change.
 * No seek at all — the first packet is a keyframe — so it costs one decode:
 * a card has its picture in ~150 ms, strip or no strip. Skipped when already
 * on disk.
 */
export async function makePoster(clip: Clip): Promise<{ thumb: string }> {
  const thumb = thumbName(clip)
  const thumbPath = join(cacheDir(), thumb)
  if (await exists(thumbPath)) return { thumb }
  const { code } = await run(FFMPEG, [
    '-y',
    '-v',
    'error',
    ...ONE_THREAD_FILTERS,
    '-threads',
    '1',
    '-skip_frame',
    'nokey',
    '-skip_loop_filter',
    'all',
    '-i',
    clip.path,
    '-vf',
    frameFilter(THUMB_WIDTH, clip.hdr),
    '-frames:v',
    '1',
    '-q:v',
    '4',
    thumbPath,
  ])
  if (code !== 0) {
    // Never leave a half-written JPEG behind to be mistaken for a cache hit.
    await unlink(thumbPath).catch(() => undefined)
    throw new Error(`ffmpeg poster exited with ${code}`)
  }
  return { thumb }
}

/**
 * The hover-scrub strip: `SPRITE_FRAMES` keyframe-only seeks in one ffmpeg
 * process, stitched with `hstack` — one decoded I-frame per frame of the strip
 * and one spawn per clip. A job of its own, run after every poster: it is nine
 * tenths of a clip's preview cost, and nothing on screen waits for it. Skipped
 * when already on disk.
 */
export async function makeSprite(clip: Clip, duration: number): Promise<SpriteStrip> {
  const sprite = spriteName(clip)
  const spritePath = join(cacheDir(), sprite)
  const frames = spriteFrameCount(duration)
  if (await exists(spritePath)) return { sprite, spriteFrames: frames }

  // The strip opens on the first frame and steps through the clip from there.
  // Dividing by `frames` rather than `frames - 1` keeps the last seek short of
  // the end, where there is no frame left to land on.
  const args = ['-y', '-v', 'error', ...ONE_THREAD_FILTERS]
  const graph: string[] = []
  let stacked = ''
  for (let i = 0; i < frames; i++) {
    args.push(...seekInput(clip.path, (duration * i) / frames))
    // Cropped and tone-mapped per frame, straight off the decoder: `hstack`
    // drops the colour tags, and zscale refuses a frame whose transfer it
    // cannot see.
    graph.push(`[${i}:v]${stripFilter(clip.hdr)}[f${i}]`)
    stacked += `[f${i}]`
  }
  graph.push(`${stacked}hstack=inputs=${frames}[sprite]`)
  args.push('-filter_complex', graph.join(';'))
  args.push('-map', '[sprite]', '-frames:v', '1', '-threads', '1', '-q:v', '5', spritePath)

  const { code } = await run(FFMPEG, args)
  if (code !== 0) {
    await unlink(spritePath).catch(() => undefined)
    throw new Error(`ffmpeg sprite exited with ${code}`)
  }
  return { sprite, spriteFrames: frames }
}

export interface Film {
  film: string
  frames: number
}

/**
 * The trim bar's filmstrip: `filmFrameCount` keyframe seeks spread over the
 * clip, `FILM_BATCH` to an ffmpeg process and `FILM_WORKERS` processes at a
 * time, each frame to its own file, then stacked into one strip under the
 * cache name. Cut when the player opens a clip, never by the indexer, so a
 * clip that is never opened never pays for it; and cached, so the next ask
 * is a stat. `signal` kills the processes running and removes what they wrote.
 *
 * Seeks rather than one pass over the file, because a pass decodes every
 * keyframe on its way — 240 in a two-minute ShadowPlay clip: 3 s for SDR and
 * 13 s for HDR, measured — where seeks decode only the frames the strip
 * shows. Keyframes only, because an exact time means decoding the GOP up to
 * it, thirty frames for one; the strip's slots are half a second apart at
 * the closest, which is a GOP, so nothing is lost.
 */
export async function makeFilm(clip: Clip, signal: AbortSignal): Promise<Film> {
  const film = filmName(clip)
  const filmPath = join(cacheDir(), film)
  const frames = filmFrameCount(clip.duration)
  if (await exists(filmPath)) return { film, frames }

  // `~`-prefixed like every half-made file in the cache: never served, never a hit.
  const stem = film.slice(0, -'.jpg'.length)
  const framePath = (i: number): string => join(cacheDir(), `~${stem}.${i}.jpg`)
  const batches: number[][] = []
  for (let at = 0; at < frames; at += FILM_BATCH) {
    batches.push(Array.from({ length: Math.min(FILM_BATCH, frames - at) }, (_, k) => at + k))
  }

  // The strip is all of its frames or nothing: one failure stops the others.
  const stop = new AbortController()
  const onAbort = (): void => stop.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let next = 0
  /** Takes batches until they run out or one fails; resolves with the failure, if it was the one to hit it. */
  const worker = async (): Promise<Error | null> => {
    while (next < batches.length && !stop.signal.aborted) {
      const batch = batches[next++]
      try {
        await cutBatch(clip, batch, frames, framePath, stop.signal)
      } catch (err) {
        stop.abort()
        return err as Error
      }
    }
    return null
  }
  try {
    const workers = Math.min(FILM_WORKERS, batches.length)
    const failure = (await Promise.all(Array.from({ length: workers }, worker))).find((e) => e)
    if (signal.aborted) throw new Error('Filmstrip cancelled')
    if (failure) throw failure
    await stackFilm(batches.flat().map(framePath), filmPath, signal)
    return { film, frames }
  } finally {
    signal.removeEventListener('abort', onAbort)
    for (let i = 0; i < frames; i++) await unlink(framePath(i)).catch(() => undefined)
  }
}

/** One ffmpeg process: a keyframe seek per frame of the batch, each frame to its own file. */
async function cutBatch(
  clip: Clip,
  batch: number[],
  frames: number,
  framePath: (i: number) => string,
  signal: AbortSignal,
): Promise<void> {
  const args = ['-y', '-v', 'error', ...ONE_THREAD_FILTERS]
  // As the sprite: slot i opens at i/n of the clip, on the keyframe at or before it.
  for (const i of batch) args.push(...seekInput(clip.path, (clip.duration * i) / frames))
  batch.forEach((i, k) => {
    const filter = stripFilter(clip.hdr)
    args.push('-map', `${k}:v`, '-vf', filter, '-frames:v', '1', '-q:v', '5', framePath(i))
  })
  const { code } = await run(FFMPEG, args, { signal })
  if (code !== 0) {
    for (const i of batch) await unlink(framePath(i)).catch(() => undefined)
    throw new Error(`ffmpeg filmstrip exited with ${code}`)
  }
}

/**
 * The cut frames side by side in one JPEG, written under a temp name and
 * renamed once ffmpeg has exited cleanly: a half-written strip under the real
 * name would be a cache hit forever.
 */
async function stackFilm(
  framePaths: string[],
  filmPath: string,
  signal: AbortSignal,
): Promise<void> {
  const temp = join(dirname(filmPath), `~${basename(filmPath)}`)
  const args = ['-y', '-v', 'error', ...ONE_THREAD_FILTERS]
  for (const p of framePaths) args.push('-i', p)
  const inputs = framePaths.map((_, i) => `[${i}:v]`).join('')
  args.push('-filter_complex', `${inputs}hstack=inputs=${framePaths.length}[strip]`)
  args.push('-map', '[strip]', '-frames:v', '1', '-q:v', '4', temp)
  const { code } = await run(FFMPEG, args, { signal })
  if (code !== 0) {
    await unlink(temp).catch(() => undefined)
    throw new Error(`ffmpeg filmstrip stack exited with ${code}`)
  }
  await fsRename(temp, filmPath)
}

/**
 * Size of a still, by the same ffprobe call the videos get. A screenshot is
 * a one-frame "video stream" to it — and, for a GIF, a many-frame one with a
 * duration and a frame rate the caller must not take for a clip's.
 */
export async function probeImage(filePath: string): Promise<{ width: number; height: number }> {
  const info = await probe(filePath)
  if (!info.width || !info.height) throw new Error('No image dimensions found')
  return { width: info.width, height: info.height }
}

/**
 * The card poster for a screenshot: one scaled frame, so a GIF's is its first.
 * `source` is the file to read — the original, or for an HDR screenshot the
 * SDR render, since ffmpeg cannot open the original. No scrub strip: there is
 * nothing to scrub through.
 */
export async function makeImageThumb(clip: Clip, source = clip.path): Promise<{ thumb: string }> {
  const thumb = thumbName(clip)
  const thumbPath = join(cacheDir(), thumb)
  if (await exists(thumbPath)) return { thumb }
  const { code } = await run(FFMPEG, [
    '-y',
    '-v',
    'error',
    ...ONE_THREAD_FILTERS,
    '-threads',
    '1',
    '-i',
    source,
    '-vf',
    `scale=${THUMB_WIDTH}:-2:flags=${SCALE_FLAGS}`,
    '-frames:v',
    '1',
    '-q:v',
    '4',
    thumbPath,
  ])
  if (code !== 0) {
    await unlink(thumbPath).catch(() => undefined)
    throw new Error(`ffmpeg image thumb exited with ${code}`)
  }
  return { thumb }
}

/** Quality of the full-size render on ffmpeg's 2–31 mjpeg scale (lower is better): it is the whole picture the viewer shows. */
const RENDER_QUALITY = 3

interface DecodedRgb {
  width: number
  height: number
  /** Packed 8-bit RGB, already tone mapped. */
  rgb: Uint8Array
}

/**
 * Decodes and tone maps one HDR screenshot on a worker thread
 * (lib/jxr.worker.ts). One worker per file: a fresh WebAssembly heap each
 * time, gone with the thread, and the queue already bounds how many run at
 * once. The job timeout applies as it does to a child process.
 */
function decodeJxr(path: string): Promise<DecodedRgb> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(jxrWorkerPath, { workerData: { path, tuning: jxrTuning() } })
    workers.add(worker)
    let settled = false
    const finish = (outcome: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      workers.delete(worker)
      outcome()
      void worker.terminate()
    }
    const timer = setTimeout(
      () => finish(() => reject(new Error('JPEG XR decode timed out'))),
      JOB_TIMEOUT_MS,
    )
    worker.once('message', (msg: DecodedRgb | { error: string }) =>
      finish(() => ('error' in msg ? reject(new Error(msg.error)) : resolve(msg))),
    )
    worker.once('error', (err: unknown) =>
      finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
    )
    worker.once('exit', (code) =>
      finish(() => reject(new Error(`JPEG XR worker exited with ${code}`))),
    )
  })
}

/** Writes packed RGB as a JPEG through the bundled ffmpeg — to a temp name first, so a cache hit is never half a file. */
async function encodeRgbJpeg(image: DecodedRgb, out: string): Promise<void> {
  const temp = join(dirname(out), `~${basename(out)}`)
  const { code } = await run(
    FFMPEG,
    [
      '-y',
      '-v',
      'error',
      '-threads',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-video_size',
      `${image.width}x${image.height}`,
      '-i',
      'pipe:0',
      '-frames:v',
      '1',
      '-q:v',
      String(RENDER_QUALITY),
      temp,
    ],
    { input: image.rgb },
  )
  if (code !== 0) {
    await unlink(temp).catch(() => undefined)
    throw new Error(`ffmpeg render exited with ${code}`)
  }
  await fsRename(temp, out)
}

/**
 * The SDR copy of an HDR screenshot, made once. Doubles as the probe: ffprobe
 * cannot read the file, and the decode reports the size.
 */
export async function makeJxrRender(
  clip: Clip,
  /** The size from an earlier decode: with it, a render already on disk is not made twice. */
  known?: { width: number; height: number },
): Promise<JxrRender> {
  const render = renderName(clip)
  const out = join(cacheDir(), render)
  if (known && (await exists(out))) return { render, ...known }
  const image = await decodeJxr(clip.path)
  await encodeRgbJpeg(image, out)
  return { render, width: image.width, height: image.height }
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
  if (await exists(out)) {
    // Used now: its lifetime (lib/maintenance.ts) counts from here.
    await touch(out)
    return file
  }

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

/**
 * A rename gives the clip a new id, and the extractions are named by id: move
 * them along the way the posters are moved, so the player keeps its tracks
 * across the rename and the next open finds them cut. A cut still in flight
 * for the old id is dropped — it would land under a name nothing asks for.
 */
export async function renameAudioTracks(from: string, to: string): Promise<void> {
  if (!from || !to || from === to) return
  const dir = audioDir()
  const names = await readdir(dir).catch(() => [] as string[])
  for (const name of names) {
    if (name.startsWith(`${from}-`))
      await fsRename(join(dir, name), join(dir, to + name.slice(from.length))).catch(
        () => undefined,
      )
    else if (name.startsWith(`~${from}-`)) await unlink(join(dir, name)).catch(() => undefined)
  }
}

export async function removeArtifacts(
  clip: Pick<Clip, 'thumb' | 'sprite'> & { render?: string; film?: string },
): Promise<void> {
  for (const f of [clip.thumb, clip.sprite, clip.render ?? '', clip.film ?? '']) {
    if (!f) continue
    await unlink(join(cacheDir(), f)).catch(() => undefined)
  }
}

export function ffmpegAvailable(): boolean {
  return Boolean(FFMPEG && FFPROBE)
}
