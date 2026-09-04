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
import type { ActionResult, Clip, ClipPatch } from '@shared/types'
import {
  validateUploadRequest,
  type UploadJob,
  type UploadRequest,
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
const isLive = (j: UploadJob): boolean => j.state === 'queued' || j.state === 'uploading'

export interface UploadsDeps {
  emit: Emit
  accounts: YouTubeAccounts
  getClip(id: string): Clip | undefined
  patchClip(patch: ClipPatch): void
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
    return [...this.jobs.values()].some(isLive)
  }

  hasActiveFor(accountId: string): boolean {
    return [...this.jobs.values()].some(
      (j) =>
        isLive(j) && (j.accountId === accountId || (j.accountId === '' && j.state === 'queued')),
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
    if ([...this.jobs.values()].some((j) => isLive(j) && j.clipId === clip.id))
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
    }
    return { ok: true }
  }

  dismiss(id: string): void {
    const job = this.jobs.get(id)
    if (!job || !isTerminal(job)) return
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
      this.deps.patchClip({ id: clip.id, youtubeId: video.id })
      if (req.playlistId) {
        try {
          await addToPlaylist(accounts.ctx(job.accountId, abort.signal), req.playlistId, video.id)
        } catch (err) {
          job.playlistError = friendlyError(err, job.accountLabel)
        }
      }
      job.state = 'done'
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
      this.pruneLater(job)
    }
  }

  private pruneLater(job: UploadJob): void {
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
