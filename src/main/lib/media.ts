import { spawn, type ChildProcess } from 'node:child_process'
import { access, unlink } from 'node:fs/promises'
import { cpus, constants as osConstants, setPriority } from 'node:os'
import { join } from 'node:path'
import type { Clip, ClipPatch } from '@shared/types'
import { FFMPEG, FFPROBE, cacheDir } from './paths'

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

export interface ProbeResult {
  duration: number
  width: number
  height: number
  fps: number
  vcodec: string
  hasAudio: boolean
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

interface FfprobeJson {
  format?: { duration?: string }
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
    avg_frame_rate?: string
    r_frame_rate?: string
    duration?: string
  }>
}

export async function probe(filePath: string): Promise<ProbeResult> {
  const { code, stdout } = await run(FFPROBE, [
    '-v',
    'error',
    '-print_format',
    'json',
    // Only the fields we read: keeps the JSON small and skips the per-stream
    // disposition/tag dumps ffprobe would otherwise serialise.
    '-show_entries',
    'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration',
    filePath,
  ])
  if (code !== 0) throw new Error(`ffprobe exited with ${code}`)
  const json = JSON.parse(stdout) as FfprobeJson
  const video = json.streams?.find((s) => s.codec_type === 'video')
  const audio = json.streams?.find((s) => s.codec_type === 'audio')
  const duration = Number(json.format?.duration ?? video?.duration ?? 0)
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: parseFps(video?.avg_frame_rate) || parseFps(video?.r_frame_rate),
    vcodec: video?.codec_name ?? '',
    hasAudio: Boolean(audio),
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
