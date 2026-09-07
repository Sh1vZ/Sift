import { cpus } from 'node:os'
import type { Clip, ClipPatch } from '@shared/types'

/**
 * The two halves of a clip's preview work, run as separate jobs. A poster is
 * one decoded frame; a scrub strip is ten. Splitting them means every card on
 * screen has a picture within a couple of seconds of a scan, and the strips —
 * nine tenths of the CPU — fill in behind, where nobody is waiting on them.
 */
export type MediaStage = 'poster' | 'sprite'

export interface MediaJob {
  clip: Clip
  stage: MediaStage
}

type JobRunner = (job: MediaJob) => Promise<ClipPatch>

interface Entry {
  clip: Clip
  rank: number
}

const STAGES: MediaStage[] = ['poster', 'sprite']

/**
 * Bounded-concurrency queue with two lanes, posters ahead of strips, and a
 * "hot" set the renderer keeps pointed at the clips on screen. The next job is
 * always: a hot poster, else a hot strip, else the newest poster in the
 * backlog, else the newest strip. Concurrency stays low and every child runs
 * at below-normal priority, so a running game or the player never has to
 * fight the indexer for CPU.
 *
 * Electron-free on purpose: `npm test` runs it on plain Node.
 */
export class MediaQueue {
  private lanes: Record<MediaStage, Entry[]> = { poster: [], sprite: [] }
  /** Clip id → the stage it is waiting in. A clip waits in one lane at a time. */
  private queued = new Map<string, MediaStage>()
  /** `<stage>:<id>` for every job in flight, so the same job is not started twice. */
  private active = new Set<string>()
  private hot = new Set<string>()
  private inFlight = 0
  private limit: number
  private stopped = false
  onProgress: (pending: number) => void = () => undefined

  constructor(
    private readonly runner: JobRunner,
    private readonly onDone: (patch: ClipPatch) => void,
    concurrency?: number,
  ) {
    this.limit = concurrency ?? Math.max(1, Math.min(2, Math.floor(cpus().length / 4)))
  }

  get pending(): number {
    return this.lanes.poster.length + this.lanes.sprite.length + this.inFlight
  }

  /** Jobs in flight right now. */
  get running(): number {
    return this.inFlight
  }

  get concurrency(): number {
    return this.limit
  }

  /**
   * Raising it starts more jobs at once; lowering it starts none until enough
   * of the running ones finish. Nothing in flight is interrupted either way.
   */
  setConcurrency(n: number): void {
    this.limit = Math.max(1, Math.floor(n))
    this.pump()
  }

  /** Waiting or in flight, whichever stage. */
  has(id: string): boolean {
    return this.queued.has(id) || this.active.has(`poster:${id}`) || this.active.has(`sprite:${id}`)
  }

  /**
   * `rank` orders a lane, higher first — the recording time, so the newest
   * clips, the top of the default grid, come first. `front` beats every rank:
   * the file that just finished recording. A poster job already waiting
   * covers the strip too (it queues the sprite stage itself when it is done),
   * and a poster job supersedes a waiting strip: it re-probes, then re-queues it.
   */
  enqueue(clip: Clip, stage: MediaStage, opts: { rank?: number; front?: boolean } = {}): void {
    if (this.active.has(`${stage}:${clip.id}`)) return
    const held = this.queued.get(clip.id)
    if (held === stage || (held === 'poster' && stage === 'sprite')) {
      if (opts.front) this.bump(clip.id)
      return
    }
    if (held) this.remove(clip.id)
    const rank = opts.front ? Infinity : (opts.rank ?? 0)
    const lane = this.lanes[stage]
    // First slot whose rank is below ours, so equal ranks keep arrival order.
    let lo = 0
    let hi = lane.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (lane[mid].rank >= rank) lo = mid + 1
      else hi = mid
    }
    lane.splice(lo, 0, { clip, rank })
    this.queued.set(clip.id, stage)
    this.pump()
  }

  /** Drops the clip's waiting job. A job already running finishes; its result is still applied. */
  remove(id: string): void {
    const stage = this.queued.get(id)
    if (!stage) return
    this.lanes[stage] = this.lanes[stage].filter((e) => e.clip.id !== id)
    this.queued.delete(id)
  }

  /** The clips on screen: their jobs go before the backlog, posters before strips. */
  setHot(ids: Iterable<string>): void {
    this.hot = new Set(ids)
  }

  /** Moves a waiting job to the front of its lane — the card being hovered, the clip being opened. */
  bump(id: string): void {
    const stage = this.queued.get(id)
    if (!stage) return
    const lane = this.lanes[stage]
    const i = lane.findIndex((e) => e.clip.id === id)
    if (i < 0) return
    const [entry] = lane.splice(i, 1)
    // Infinity, not "first for now": a later enqueue with a real rank must not slip ahead.
    entry.rank = Infinity
    lane.unshift(entry)
  }

  /**
   * Drops the backlog and takes no more work; in-flight results are discarded,
   * not recorded as failures. The caller kills the children (media.ts owns them).
   */
  stop(): void {
    this.stopped = true
    this.lanes = { poster: [], sprite: [] }
    this.queued.clear()
    this.hot.clear()
  }

  private next(): MediaJob | null {
    if (this.hot.size) {
      for (const stage of STAGES) {
        const i = this.lanes[stage].findIndex((e) => this.hot.has(e.clip.id))
        if (i >= 0) return this.take(stage, i)
      }
    }
    for (const stage of STAGES) if (this.lanes[stage].length) return this.take(stage, 0)
    return null
  }

  private take(stage: MediaStage, i: number): MediaJob {
    const [entry] = this.lanes[stage].splice(i, 1)
    this.queued.delete(entry.clip.id)
    return { clip: entry.clip, stage }
  }

  private pump(): void {
    while (!this.stopped && this.inFlight < this.limit) {
      const job = this.next()
      if (!job) break
      const key = `${job.stage}:${job.clip.id}`
      this.active.add(key)
      this.inFlight++
      this.onProgress(this.pending)
      this.runner(job)
        .then((patch) => {
          if (!this.stopped) this.onDone(patch)
        })
        .catch(() => {
          // A poster job is the probe too, so its failure is the clip's; a
          // strip that fails just leaves the card without a hover preview.
          if (this.stopped) return
          this.onDone(
            job.stage === 'poster'
              ? { id: job.clip.id, probeState: 'failed' }
              : { id: job.clip.id },
          )
        })
        .finally(() => {
          this.active.delete(key)
          this.inFlight--
          this.onProgress(this.pending)
          // Yield between jobs so IPC and the UI stay responsive.
          setImmediate(() => this.pump())
        })
    }
  }
}
