/**
 * The upload queue: one at a time, like exports. A job picks its project when
 * it starts (the one with the most quota left, unless the user chose), streams
 * the file with `resumableUpload`, records the video id on the clip and, if
 * asked, files it into a playlist. Terminal jobs linger briefly for the card
 * to show how they ended, then prune themselves.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { ActionResult, ActivityInput, Clip, ClipPatch } from '@shared/types'
import {
  WATCH_WINDOW_MS,
  isStageTerminal,
  stageLine,
  stageSentence,
  validateUploadRequest,
  type UploadJob,
  type UploadRequest,
  type VideoStatus,
  type YouTubePrivacy,
} from '@shared/youtube'
import type { Emit } from '../library'
import type { YouTubeAccounts } from './accounts'
import { addToPlaylist, friendlyError, isQuotaExceeded } from './api'
import { insertBody, mimeFor, resumableUpload } from './upload'

const PRUNE_DONE_MS = 10_000
const PRUNE_FAILED_MS = 30_000
/** The user just asked for this; a short acknowledgement is enough. */
const PRUNE_CANCELLED_MS = 4_000
const EMIT_MS = 250
/** YouTube's own ceiling. */
const MAX_BYTES = 256 * 1024 ** 3

const isTerminal = (j: UploadJob): boolean =>
  j.state === 'done' || j.state === 'failed' || j.state === 'cancelled'
/**
 * Bytes are moving, or about to. `processing` is deliberately neither this nor
 * terminal: the file is gone, there is nothing left to cancel, and quitting or
 * disconnecting a project costs nothing — so a job that YouTube is still
 * chewing on must not block quit, disconnect, removal or a second upload.
 */
const isSending = (j: UploadJob): boolean => j.state === 'queued' || j.state === 'uploading'

export interface UploadsDeps {
  emit: Emit
  accounts: YouTubeAccounts
  getClip(id: string): Clip | undefined
  patchClip(patch: ClipPatch): void
  /**
   * Hand the finished video to the watcher. Returns false when Sift is not
   * going to ask after it — the setting is off — and the job is simply done.
   */
  watch(clipId: string, videoId: string, accountId: string, watchUntilMs: number): boolean
  /** Stop asking about a clip's video, for a dismissed processing row. */
  unwatch(clipId: string): void
  /** Keep a finished upload in the Activity history. */
  record(input: ActivityInput): void
}

export class YouTubeUploads {
  private readonly jobs = new Map<string, UploadJob>()
  private readonly requests = new Map<string, UploadRequest>()
  private chain: Promise<void> = Promise.resolve()
  private abort: AbortController | null = null
  private emitTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: UploadsDeps) {}

  list(): UploadJob[] {
    return [...this.jobs.values()].map((j) => ({ ...j }))
  }

  hasActive(): boolean {
    return [...this.jobs.values()].some(isSending)
  }

  hasActiveFor(accountId: string): boolean {
    return [...this.jobs.values()].some(
      (j) =>
        isSending(j) && (j.accountId === accountId || (j.accountId === '' && j.state === 'queued')),
    )
  }

  enqueue(req: UploadRequest): ActionResult & { job?: UploadJob } {
    const { accounts } = this.deps
    const connected = accounts.connectedIds()
    if (!connected.length)
      return { ok: false, error: 'Connect a YouTube project under Settings → YouTube first.' }
    if (req.accountId && !accounts.isConnected(req.accountId))
      return { ok: false, error: `${accounts.label(req.accountId)} is not connected.` }
    const invalid = validateUploadRequest(req)
    if (invalid) return { ok: false, error: invalid }
    const clip = this.deps.getClip(req.clipId)
    if (!clip) return { ok: false, error: 'Clip not found.' }
    if (clip.probeState !== 'ok')
      return { ok: false, error: 'This clip has not been read yet. Try again in a moment.' }
    if (!existsSync(clip.path)) return { ok: false, error: 'The file is no longer on disk.' }
    if (clip.size > MAX_BYTES) return { ok: false, error: 'YouTube accepts files up to 256 GB.' }
    if ([...this.jobs.values()].some((j) => isSending(j) && j.clipId === clip.id))
      return { ok: false, error: 'This clip is already being uploaded.' }
    if (req.accountId && accounts.isExhausted(req.accountId))
      return {
        ok: false,
        error: `${accounts.label(req.accountId)} is out of quota until midnight Pacific.`,
      }
    if (!req.accountId && !accounts.pick(connected))
      return {
        ok: false,
        error: 'Every connected project is out of quota until midnight Pacific.',
      }

    const job: UploadJob = {
      id: randomUUID().slice(0, 8),
      clipId: clip.id,
      clipTitle: clip.title,
      thumb: clip.thumb,
      game: clip.game,
      size: clip.size,
      title: req.title.trim(),
      privacy: req.privacy,
      playlistId: req.playlistId,
      playlistTitle: req.playlistId ? accounts.playlistTitle(req.playlistId) : '',
      accountId: req.accountId,
      accountLabel: req.accountId ? accounts.label(req.accountId) : '',
      channelTitle: req.accountId ? accounts.channelTitle(req.accountId) : '',
      state: 'queued',
      progress: 0,
      bytesSent: 0,
      bytesPerSecond: 0,
      videoId: '',
      stage: 'unknown',
      stageProgress: -1,
      stageEtaMs: 0,
      checkedAtMs: 0,
      checksStopped: false,
      privacyDowngraded: false,
      playlistError: '',
      error: '',
      createdAtMs: Date.now(),
    }
    this.jobs.set(job.id, job)
    this.requests.set(job.id, { ...req, title: job.title, tags: req.tags.map((t) => t.trim()) })
    this.scheduleEmit(true)
    this.chain = this.chain.then(() => this.runJob(job, clip)).catch(() => undefined)
    return { ok: true, job: { ...job } }
  }

  cancel(id: string): ActionResult {
    const job = this.jobs.get(id)
    if (!job) return { ok: false, error: 'Upload not found.' }
    if (job.state === 'queued') {
      job.state = 'cancelled'
      this.requests.delete(id)
      this.scheduleEmit(true)
      this.pruneLater(job)
    } else if (job.state === 'uploading') {
      this.abort?.abort(new Error('Upload cancelled.'))
    } else if (job.state === 'processing') {
      // The file is already on YouTube; there is nothing left here to stop.
      return {
        ok: false,
        error: 'The upload has finished. Remove the video from YouTube to undo it.',
      }
    }
    return { ok: true }
  }

  /** Clears a finished row, or stops asking about one YouTube is still processing. */
  dismiss(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.state === 'processing') this.deps.unwatch(job.clipId)
    else if (!isTerminal(job)) return
    this.jobs.delete(id)
    this.scheduleEmit(true)
  }

  /** Aborts the running upload and waits for the chain, for before-quit. */
  async shutdown(): Promise<void> {
    this.abort?.abort(new Error('Sift is quitting.'))
    await this.chain.catch(() => undefined)
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = null
  }

  private async runJob(job: UploadJob, clip: Clip): Promise<void> {
    if (job.state !== 'queued') return
    const req = this.requests.get(job.id)
    if (!req) return
    const { accounts } = this.deps
    const abort = new AbortController()
    this.abort = abort
    job.state = 'uploading'
    this.scheduleEmit(true)

    // Speed is an exponential moving average of the last few progress ticks.
    let lastAt = Date.now()
    let lastBytes = 0
    const onProgress = (bytes: number): void => {
      const now = Date.now()
      const dt = (now - lastAt) / 1000
      if (dt >= 0.5) {
        const rate = Math.max(0, bytes - lastBytes) / dt
        job.bytesPerSecond = job.bytesPerSecond ? job.bytesPerSecond * 0.7 + rate * 0.3 : rate
        lastAt = now
        lastBytes = bytes
      }
      job.bytesSent = bytes
      job.progress = job.size ? Math.min(1, bytes / job.size) : 0
      this.scheduleEmit()
    }

    try {
      const st = await stat(clip.path)
      const src = { path: clip.path, size: st.size, mimeType: mimeFor(clip.ext) }
      job.size = st.size
      const body = insertBody({
        title: req.title,
        description: req.description,
        tags: req.tags.filter(Boolean),
        privacy: req.privacy,
        madeForKids: req.madeForKids,
      })
      const tried = new Set<string>()
      let accountId = req.accountId
      // A playlist belongs to one channel; under Auto the project that owns it must do the upload.
      if (!accountId && req.playlistId) accountId = accounts.ownerOfPlaylist(req.playlistId)

      // Auto mode walks the projects in order, moving on when YouTube says one is spent.
      let video: Awaited<ReturnType<typeof resumableUpload>> | null = null
      while (!video) {
        const id = accountId || accounts.pick(accounts.connectedIds().filter((x) => !tried.has(x)))
        if (!id) {
          throw new Error(
            tried.size
              ? 'Every connected project is out of quota until midnight Pacific.'
              : 'No connected project can take this upload right now.',
          )
        }
        tried.add(id)
        job.accountId = id
        job.accountLabel = accounts.label(id)
        job.channelTitle = accounts.channelTitle(id)
        this.scheduleEmit(true)
        try {
          video = await resumableUpload(accounts.ctx(id, abort.signal), body, src, {
            signal: abort.signal,
            onProgress,
          })
        } catch (err) {
          // quotaExceeded only ever comes from the initiate call, before any bytes move.
          if (isQuotaExceeded(err) && !abort.signal.aborted) {
            accounts.markExhausted(id)
            if (req.accountId || accountId) throw err
            continue
          }
          throw err
        }
      }

      job.videoId = video.id
      job.progress = 1
      job.bytesSent = job.size
      const got = video.status?.privacyStatus as YouTubePrivacy | undefined
      job.privacyDowngraded = Boolean(got && got !== req.privacy)
      const watchUntilMs = Date.now() + WATCH_WINDOW_MS
      this.deps.patchClip({
        id: clip.id,
        youtubeId: video.id,
        // Which project sent it: the only token that may ask after it later.
        youtubeAccountId: job.accountId,
        youtubeReason: '',
      })
      if (req.playlistId) {
        try {
          await addToPlaylist(accounts.ctx(job.accountId, abort.signal), req.playlistId, video.id)
        } catch (err) {
          job.playlistError = friendlyError(err, job.accountLabel)
        }
      }
      // The bytes are up, but YouTube has not finished with them. The job only
      // reaches `done` when YouTube says the video is playable — or when Sift
      // is not going to ask, in which case sending it is the whole story and
      // the clip is left saying nothing rather than "processing" for ever.
      const watched = this.deps.watch(clip.id, video.id, job.accountId, watchUntilMs)
      if (watched) {
        job.stage = 'processing'
        job.state = 'processing'
        this.deps.patchClip({
          id: clip.id,
          youtubeStage: 'processing',
          youtubeWatchUntilMs: watchUntilMs,
        })
      } else {
        job.state = 'done'
      }
    } catch (err) {
      if (abort.signal.aborted) {
        job.state = 'cancelled'
      } else {
        job.state = 'failed'
        job.error = friendlyError(err, job.accountLabel || 'This project')
      }
    } finally {
      this.abort = null
      this.requests.delete(job.id)
      this.scheduleEmit(true)
      // A processing job prunes when YouTube answers, not on a timer.
      if (job.state !== 'processing') this.pruneLater(job)
    }
  }

  /**
   * What the watcher learned about one clip's video. A null status means Sift
   * has simply stopped asking, so the job keeps whatever it last knew.
   */
  setStatus(
    clipId: string,
    status: VideoStatus | null,
    checkedAtMs: number,
    stopped: boolean,
  ): void {
    const job = this.newestFor(clipId)
    if (job?.state !== 'processing') return
    if (status) {
      job.stage = status.stage
      job.stageProgress = status.progress
      job.stageEtaMs = status.etaMs
      job.checkedAtMs = checkedAtMs
    }
    job.checksStopped = stopped
    if (status && isStageTerminal(status.stage)) {
      if (status.stage === 'ready') {
        job.state = 'done'
      } else {
        job.state = 'failed'
        job.error = stageSentence(status)
      }
    } else if (stopped) {
      // The bytes are up and the video exists; Sift just has nothing more to add.
      job.state = 'done'
    }
    this.scheduleEmit(job.state !== 'processing')
    if (job.state !== 'processing') this.pruneLater(job)
  }

  /**
   * Puts back the rows for videos the last run was still watching, so the
   * Activity panel carries on across a restart. The bytes are long gone, so
   * these jobs show a full bar and no rate.
   */
  restore(clips: readonly Clip[]): void {
    const { accounts } = this.deps
    for (const clip of clips) {
      const stage = clip.youtubeStage || 'processing'
      this.jobs.set(clip.youtubeId, {
        // The video id is stable and unique, and it keeps a relaunch from
        // colliding with a row the same session already holds.
        id: clip.youtubeId,
        clipId: clip.id,
        clipTitle: clip.title,
        thumb: clip.thumb,
        game: clip.game,
        size: clip.size,
        title: clip.title,
        privacy: 'private',
        playlistId: '',
        playlistTitle: '',
        accountId: clip.youtubeAccountId,
        accountLabel: accounts.label(clip.youtubeAccountId),
        channelTitle: accounts.channelTitle(clip.youtubeAccountId),
        state: 'processing',
        progress: 1,
        bytesSent: clip.size,
        bytesPerSecond: 0,
        videoId: clip.youtubeId,
        stage: stage === 'unknown' ? 'processing' : stage,
        stageProgress: -1,
        stageEtaMs: 0,
        checkedAtMs: clip.youtubeCheckedAtMs,
        checksStopped: false,
        privacyDowngraded: false,
        playlistError: '',
        error: '',
        createdAtMs: clip.youtubeCheckedAtMs || Date.now(),
      })
    }
    if (clips.length) this.scheduleEmit(true)
  }

  /** The job to speak for a clip: the one still running, else the most recent. */
  private newestFor(clipId: string): UploadJob | undefined {
    let best: UploadJob | undefined
    for (const j of this.jobs.values()) {
      if (j.clipId !== clipId) continue
      if (!best || j.state === 'processing' || j.createdAtMs > best.createdAtMs) best = j
    }
    return best
  }

  private pruneLater(job: UploadJob): void {
    // The one place every terminal transition passes exactly once — from a
    // cancel, the upload's own end, or the watcher's verdict after a relaunch —
    // so the history row is written here. A cancelled upload sent nothing and
    // keeps no row.
    if (job.state === 'done' || job.state === 'failed') {
      this.deps.record({
        kind: 'upload',
        status: job.state,
        title: job.title,
        detail: stageLine(job) || (job.accountLabel ? `via ${job.accountLabel}` : ''),
        error: job.error,
        createdAtMs: job.createdAtMs,
        clipId: job.clipId,
        game: job.game,
        videoId: job.videoId,
        path: '',
      })
    }
    const delay =
      job.state === 'done'
        ? PRUNE_DONE_MS
        : job.state === 'cancelled'
          ? PRUNE_CANCELLED_MS
          : PRUNE_FAILED_MS
    setTimeout(() => {
      if (this.jobs.get(job.id) !== job || !isTerminal(job)) return
      this.jobs.delete(job.id)
      this.scheduleEmit(true)
    }, delay).unref()
  }

  private scheduleEmit(now = false): void {
    const send = (): void => this.deps.emit('uploads:changed', this.list())
    if (now) {
      if (this.emitTimer) clearTimeout(this.emitTimer)
      this.emitTimer = null
      send()
      return
    }
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      send()
    }, EMIT_MS)
  }
}
