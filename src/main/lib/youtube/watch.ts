/**
 * What YouTube does with a video after the last byte. The upload is not the
 * end: YouTube still has to transcode the file, and it can still refuse it.
 * This asks `videos.list` on a widening ladder until YouTube gives a final
 * answer or the two-hour window runs out, after which it is the user's Check
 * now that asks.
 *
 * Thrift is the whole design. One call costs a single quota unit whatever it
 * asks about, so a tick collects every video that is due, groups them by the
 * project that uploaded them and sends one call per project. Grouping is not
 * only cheap: `status` and `processingDetails` come back only to the owner's
 * token, and each project is its own daily bucket.
 *
 * Nothing here counts quota. As everywhere else in this module, the only
 * signal is YouTube answering `quotaExceeded`.
 */

import type { Clip, ClipPatch } from '@shared/types'
import {
  MANUAL_WATCH_MS,
  VIDEOS_PER_CALL,
  WATCH_RETRY_MS,
  isStageTerminal,
  mapVideoStatus,
  nextPacificMidnightMs,
  watchDelayMs,
  type VideoStatus,
} from '@shared/youtube'
import type { YouTubeAccounts } from './accounts'
import { YouTubeApiError, isQuotaExceeded, listVideoStatus } from './api'

/** Never wake more often than this, however impatient the ladder gets. */
const TICK_MIN_MS = 5_000
/**
 * ...and never sleep longer, so a machine that suspended for three hours is
 * polling again within a minute of waking. Cheaper than a `powerMonitor` hook
 * and there is nothing else to get wrong.
 */
const TICK_MAX_MS = 60_000
/**
 * A video due within this of one that is due now rides along in the same call.
 * The call costs the same either way, and the ride saves a whole unit later.
 */
const COALESCE_MS = 30_000

interface Entry {
  clipId: string
  videoId: string
  accountId: string
  /** How many answers have come back for this video; indexes the backoff ladder. */
  tries: number
  nextAtMs: number
  watchUntilMs: number
  inFlight: boolean
}

export interface WatchDeps {
  accounts: YouTubeAccounts
  getClip(id: string): Clip | undefined
  listClips(): Clip[]
  patchClip(patch: ClipPatch): void
  /** The `youtubeCheckStatus` setting, read fresh so the switch takes effect at once. */
  enabled(): boolean
  /**
   * What YouTube said, for the upload queue to mirror onto its job. A null
   * status means nothing new was learned and Sift has simply stopped asking.
   */
  onStatus(clipId: string, status: VideoStatus | null, checkedAtMs: number, stopped: boolean): void
}

export class YouTubeWatch {
  /** Keyed by video id — a clip can only be one video at a time. */
  private readonly entries = new Map<string, Entry>()
  /** Accounts with a call in the air; one at a time keeps the batching honest. */
  private readonly polling = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private abort = new AbortController()
  private closed = false

  constructor(private readonly deps: WatchDeps) {}

  /**
   * Picks up where the last run left off. Returns the clips whose videos are
   * still being watched so the upload queue can put their rows back in the
   * Activity panel.
   */
  load(): Clip[] {
    const now = Date.now()
    const resumed: Clip[] = []
    for (const clip of this.deps.listClips()) {
      if (!clip.youtubeId || clip.youtubeWatchUntilMs <= now) continue
      if (clip.youtubeStage && isStageTerminal(clip.youtubeStage)) continue
      // Nothing can ask about a video whose project is gone; say so once and
      // clear the flag rather than leaving a row that polls forever.
      if (!clip.youtubeAccountId || !this.deps.accounts.isConnected(clip.youtubeAccountId)) {
        this.stopWatching(clip.id, null)
        continue
      }
      this.entries.set(clip.youtubeId, {
        clipId: clip.id,
        videoId: clip.youtubeId,
        accountId: clip.youtubeAccountId,
        tries: 0,
        // Everything due at once is one call per project, not one per video.
        nextAtMs: 0,
        watchUntilMs: clip.youtubeWatchUntilMs,
        inFlight: false,
      })
      resumed.push(clip)
    }
    this.arm()
    return resumed
  }

  /** Starts watching a video the upload queue just created. */
  add(clipId: string, videoId: string, accountId: string, watchUntilMs: number): void {
    if (this.closed) return
    this.entries.set(videoId, {
      clipId,
      videoId,
      accountId,
      tries: 0,
      nextAtMs: Date.now() + watchDelayMs(0),
      watchUntilMs,
      inFlight: false,
    })
    this.arm()
  }

  /** Stops watching one clip's video without changing what Sift last knew. */
  stop(clipId: string): void {
    for (const [videoId, e] of this.entries) {
      if (e.clipId === clipId) this.entries.delete(videoId)
    }
  }

  /** The project is gone, so nothing can ask about its videos any more. */
  dropAccount(accountId: string): void {
    for (const [videoId, e] of [...this.entries]) {
      if (e.accountId !== accountId) continue
      this.entries.delete(videoId)
      this.stopWatching(e.clipId, null)
    }
  }

  /**
   * Switching the checks off lets go of what is being watched rather than
   * parking it: a row that says "processing" with nothing behind it, waiting to
   * spring back to life on re-enable, is worse than saying Sift has stopped.
   */
  setEnabled(on: boolean): void {
    if (on) {
      this.arm()
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const [videoId, e] of [...this.entries]) {
      this.entries.delete(videoId)
      this.stopWatching(e.clipId, null)
    }
  }

  shutdown(): void {
    this.closed = true
    this.abort.abort(new Error('Sift is quitting.'))
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /**
   * One check right now, for the button the user presses after Sift has given
   * up. A video that is still processing gets another window, so pressing it
   * once puts the automatic ladder back rather than buying a single answer.
   */
  async checkNow(clipId: string): Promise<{ ok: boolean; error?: string }> {
    const clip = this.deps.getClip(clipId)
    if (!clip?.youtubeId) return { ok: false, error: 'This clip has not been uploaded to YouTube.' }
    const accountId = clip.youtubeAccountId
    if (!accountId || !this.deps.accounts.isConnected(accountId)) {
      return {
        ok: false,
        error: 'Connect the YouTube project that uploaded this clip to check on it.',
      }
    }
    if (this.deps.accounts.isExhausted(accountId)) {
      return {
        ok: false,
        error: `${this.deps.accounts.label(accountId)} is out of quota until midnight Pacific.`,
      }
    }
    const existing = this.entries.get(clip.youtubeId)
    // An answer is already on its way; a second call would buy the same one twice.
    if (existing?.inFlight) return { ok: true }
    const watchUntilMs = Math.max(clip.youtubeWatchUntilMs, Date.now() + MANUAL_WATCH_MS)
    const entry: Entry = existing ?? {
      clipId,
      videoId: clip.youtubeId,
      accountId,
      // Re-adopting after the window lapsed resumes on the slow rung, not the fast one.
      tries: Number.MAX_SAFE_INTEGER,
      nextAtMs: 0,
      watchUntilMs,
      inFlight: false,
    }
    entry.watchUntilMs = watchUntilMs
    entry.nextAtMs = 0
    this.entries.set(entry.videoId, entry)
    this.deps.patchClip({ id: clipId, youtubeWatchUntilMs: watchUntilMs })
    await this.poll(accountId, [entry])
    this.arm()
    return { ok: true }
  }

  // ------------------------------------------------------------------ ticks

  private arm(): void {
    if (this.timer || this.closed || !this.entries.size || !this.deps.enabled()) return
    let soonest = Infinity
    for (const e of this.entries.values()) {
      if (!e.inFlight) soonest = Math.min(soonest, e.nextAtMs)
    }
    if (!Number.isFinite(soonest)) return
    const wait = Math.min(TICK_MAX_MS, Math.max(TICK_MIN_MS, soonest - Date.now()))
    this.timer = setTimeout(() => void this.tick(), wait)
    this.timer.unref()
  }

  private async tick(): Promise<void> {
    this.timer = null
    if (this.closed || !this.deps.enabled()) return
    const now = Date.now()
    const { accounts } = this.deps

    // Anything past its window stops here, whatever the projects are doing.
    for (const [videoId, e] of [...this.entries]) {
      if (e.inFlight || e.watchUntilMs > now) continue
      this.entries.delete(videoId)
      this.stopWatching(e.clipId, null)
    }

    const due = new Map<string, Entry[]>()
    for (const e of this.entries.values()) {
      if (e.inFlight || e.nextAtMs > now + COALESCE_MS) continue
      const list = due.get(e.accountId)
      if (list) list.push(e)
      else due.set(e.accountId, [e])
    }

    const calls: Array<Promise<void>> = []
    for (const [accountId, list] of due) {
      if (!accounts.isConnected(accountId)) {
        for (const e of list) {
          this.entries.delete(e.videoId)
          this.stopWatching(e.clipId, null)
        }
        continue
      }
      // A parked project is not a lost one: wait for the reset, spend nothing,
      // and do not count the wait against the video's attempts.
      if (accounts.isExhausted(accountId)) {
        for (const e of list) e.nextAtMs = nextPacificMidnightMs(now)
        continue
      }
      if (this.polling.has(accountId)) continue
      for (let i = 0; i < list.length; i += VIDEOS_PER_CALL) {
        calls.push(this.poll(accountId, list.slice(i, i + VIDEOS_PER_CALL)))
      }
    }
    await Promise.all(calls)
    this.arm()
  }

  private async poll(accountId: string, chunk: Entry[]): Promise<void> {
    const { accounts } = this.deps
    for (const e of chunk) e.inFlight = true
    this.polling.add(accountId)
    try {
      const found = await listVideoStatus(
        accounts.ctx(accountId, this.abort.signal),
        chunk.map((e) => e.videoId),
      )
      const checkedAtMs = Date.now()
      for (const e of chunk) {
        const raw = found.get(e.videoId)
        // A video YouTube does not return is not a video that will come back:
        // it was deleted, or this channel cannot see it. Stop, do not retry.
        const status: VideoStatus = raw
          ? mapVideoStatus(raw)
          : { stage: 'deleted', progress: -1, etaMs: 0, reason: '' }
        this.settle(e, status, checkedAtMs)
      }
    } catch (err) {
      if (this.abort.signal.aborted) return
      const now = Date.now()
      if (isQuotaExceeded(err)) {
        accounts.markExhausted(accountId)
        for (const e of chunk) e.nextAtMs = nextPacificMidnightMs(now)
      } else if (err instanceof YouTubeApiError && err.status === 403) {
        // A scope or ownership problem will not fix itself on a retry.
        for (const e of chunk) {
          this.entries.delete(e.videoId)
          this.stopWatching(e.clipId, null)
        }
      } else {
        // A dropped connection should widen the ladder, not burn the window.
        for (const e of chunk) e.nextAtMs = now + WATCH_RETRY_MS
      }
    } finally {
      this.polling.delete(accountId)
      for (const e of chunk) e.inFlight = false
    }
  }

  /** Records one answer: either the last word on the video, or the next wait. */
  private settle(entry: Entry, status: VideoStatus, checkedAtMs: number): void {
    if (isStageTerminal(status.stage)) {
      this.entries.delete(entry.videoId)
      this.deps.patchClip({
        id: entry.clipId,
        youtubeStage: status.stage,
        youtubeReason: status.reason,
        youtubeCheckedAtMs: checkedAtMs,
        youtubeWatchUntilMs: 0,
      })
      this.deps.onStatus(entry.clipId, status, checkedAtMs, true)
      return
    }
    entry.tries++
    entry.nextAtMs = checkedAtMs + watchDelayMs(entry.tries, status.etaMs)
    this.deps.patchClip({
      id: entry.clipId,
      youtubeStage: status.stage,
      youtubeReason: '',
      youtubeCheckedAtMs: checkedAtMs,
    })
    this.deps.onStatus(entry.clipId, status, checkedAtMs, false)
  }

  /** Sift has stopped asking about this clip; what it last knew stands. */
  private stopWatching(clipId: string, status: VideoStatus | null): void {
    this.deps.patchClip({ id: clipId, youtubeWatchUntilMs: 0 })
    this.deps.onStatus(clipId, status, Date.now(), true)
  }
}
