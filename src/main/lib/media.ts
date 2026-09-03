import { spawn } from 'node:child_process'
import { access, unlink } from 'node:fs/promises'
import { cpus, constants as osConstants, setPriority } from 'node:os'
import { join } from 'node:path'
import type { Clip, ClipPatch } from '@shared/types'
import { FFMPEG, FFPROBE, cacheDir } from './paths'

export const SPRITE_FRAMES = 10
const THUMB_WIDTH = 480
const SPRITE_FRAME_WIDTH = 320
const JOB_TIMEOUT_MS = 60_000

export interface ProbeResult {
  duration: number
  width: number
  height: number
  fps: number
  vcodec: string
  hasAudio: boolean
}

function lowerPriority(pid: number | undefined): void {
  if (!pid) return
  try {
    setPriority(pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
  } catch {
    // Not fatal: the job still runs, just at normal priority.
  }
}

function run(bin: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    lowerPriority(child.pid)
    let stdout = ''
    const timer = setTimeout(() => child.kill(), JOB_TIMEOUT_MS)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', () => undefined)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout })
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
    '-show_format',
    '-show_streams',
    filePath
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
    hasAudio: Boolean(audio)
  }
}

/** Cache names include the mtime so a re-recorded file never shows a stale poster. */
export function thumbName(clip: Clip): string {
  return `${clip.id}-${Math.round(clip.mtimeMs)}.jpg`
}
export function spriteName(clip: Clip): string {
  return `${clip.id}-${Math.round(clip.mtimeMs)}.sprite.jpg`
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** Poster frame a little way in, skipping the black/loading frames ShadowPlay often starts with. */
export async function makeThumb(clip: Clip, duration: number): Promise<string> {
  const name = thumbName(clip)
  const out = join(cacheDir(), name)
  if (await exists(out)) return name
  const at = Math.min(Math.max(duration * 0.15, 0.5), 8)
  const { code } = await run(FFMPEG, [
    '-y',
    '-v',
    'error',
    '-threads',
    '1',
    '-ss',
    at.toFixed(2),
    '-i',
    clip.path,
    '-frames:v',
    '1',
    '-vf',
    `scale=${THUMB_WIDTH}:-2`,
    '-q:v',
    '4',
    out
  ])
  if (code !== 0) throw new Error(`ffmpeg thumb exited with ${code}`)
  return name
}

/**
 * Hover-scrub strip: N keyframe seeks stitched with hstack in one ffmpeg
 * process. Seeking is far cheaper than decoding the whole clip with `select`.
 */
export async function makeSprite(
  clip: Clip,
  duration: number
): Promise<{ file: string; frames: number }> {
  const name = spriteName(clip)
  const out = join(cacheDir(), name)
  const frames = Math.max(4, Math.min(SPRITE_FRAMES, Math.floor(duration)))
  if (await exists(out)) return { file: name, frames }

  const args = ['-y', '-v', 'error', '-threads', '1']
  for (let i = 0; i < frames; i++) {
    const t = (duration * (i + 0.5)) / frames
    args.push('-ss', t.toFixed(2), '-i', clip.path)
  }
  const scaled: string[] = []
  let inputs = ''
  for (let i = 0; i < frames; i++) {
    scaled.push(`[${i}:v]scale=${SPRITE_FRAME_WIDTH}:-2[f${i}]`)
    inputs += `[f${i}]`
  }
  args.push(
    '-filter_complex',
    `${scaled.join(';')};${inputs}hstack=inputs=${frames}`,
    '-frames:v',
    '1',
    '-q:v',
    '5',
    out
  )
  const { code } = await run(FFMPEG, args)
  if (code !== 0) throw new Error(`ffmpeg sprite exited with ${code}`)
  return { file: name, frames }
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
    concurrency?: number
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

  stop(): void {
    this.stopped = true
    this.queue = []
    this.queued.clear()
  }

  private pump(): void {
    while (!this.stopped && this.running < this.concurrency && this.queue.length) {
      const clip = this.queue.shift()!
      this.running++
      this.onProgress(this.pending)
      this.runner(clip)
        .then((patch) => this.onDone(patch))
        .catch(() => this.onDone({ id: clip.id, probeState: 'failed' }))
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
