/**
 * The YouTube module's front door: composes the account list, the quota ledger
 * and the upload queue, and is the only thing `ipc.ts` and `main/index.ts`
 * talk to. This directory is the one place in Sift that touches the network.
 */

import { clipboard, shell } from 'electron'
import type { ActionResult, ActivityInput, Clip, ClipPatch } from '@shared/types'
import { VIDEO_ID, youtubeUrl } from '@shared/youtube'
import type { Emit } from '../library'
import type { Store } from '../store'
import { YouTubeAccounts } from './accounts'
import { deleteVideo, friendlyError, isQuotaExceeded, YouTubeApiError } from './api'
import { YouTubeUploads } from './uploads'
import { YouTubeWatch } from './watch'

/** The only URLs this module ever hands to the OS browser. */
const OPEN_ALLOWED = ['https://accounts.google.com/o/oauth2/', 'https://youtu.be/']

export interface YouTube {
  accounts: YouTubeAccounts
  uploads: YouTubeUploads
  openVideo(clipId: string): ActionResult
  copyLink(clipId: string): Promise<ActionResult>
  /** Deletes the clip's video on YouTube and clears the id; permanent. */
  removeVideo(clipId: string): Promise<ActionResult>
  /** One immediate "how is it going?" for a clip's video, for the Check now button. */
  checkVideo(clipId: string): Promise<ActionResult>
  /** The `youtubeCheckStatus` setting changed. */
  setCheckStatus(on: boolean): void
  /** Resumes watching the videos the last run left processing. Call once, after the library loads. */
  resume(): void
  shutdown(): Promise<void>
}

export function createYouTube(deps: {
  emit: Emit
  store: Store
  getClip(id: string): Clip | undefined
  listClips(): Clip[]
  patchClip(patch: ClipPatch): void
  /** Read fresh each time so flipping the setting takes effect without a restart. */
  checkStatus(): boolean
  /** Finished uploads go into the same history as exports. */
  recordActivity(input: ActivityInput): void
}): YouTube {
  const openExternal = (url: string): void => {
    if (OPEN_ALLOWED.some((prefix) => url.startsWith(prefix))) void shell.openExternal(url)
  }
  let uploads: YouTubeUploads
  let watch: YouTubeWatch
  const accounts = new YouTubeAccounts({
    store: deps.store,
    emit: deps.emit,
    openExternal,
    hasActiveUpload: (id) => uploads.hasActiveFor(id),
    onGone: (id) => watch.dropAccount(id),
  })
  uploads = new YouTubeUploads({
    emit: deps.emit,
    accounts,
    getClip: (id) => deps.getClip(id),
    patchClip: (patch) => deps.patchClip(patch),
    watch: (clipId, videoId, accountId, until) => {
      if (!deps.checkStatus()) return false
      watch.add(clipId, videoId, accountId, until)
      return true
    },
    unwatch: (clipId) => {
      watch.stop(clipId)
      deps.patchClip({ id: clipId, youtubeWatchUntilMs: 0 })
    },
    record: (input) => deps.recordActivity(input),
  })
  watch = new YouTubeWatch({
    accounts,
    getClip: (id) => deps.getClip(id),
    listClips: () => deps.listClips(),
    patchClip: (patch) => deps.patchClip(patch),
    enabled: () => deps.checkStatus(),
    onStatus: (clipId, status, checkedAtMs, stopped) =>
      uploads.setStatus(clipId, status, checkedAtMs, stopped),
  })
  accounts.load()

  const videoOf = (clipId: string): string | null => {
    const id = deps.getClip(clipId)?.youtubeId ?? ''
    return VIDEO_ID.test(id) ? id : null
  }

  return {
    accounts,
    uploads,
    openVideo(clipId) {
      const id = videoOf(clipId)
      if (!id) return { ok: false, error: 'This clip has not been uploaded to YouTube.' }
      openExternal(youtubeUrl(id))
      return { ok: true }
    },
    async copyLink(clipId) {
      const id = videoOf(clipId)
      if (!id) return { ok: false, error: 'This clip has not been uploaded to YouTube.' }
      await clipboard.writeText(youtubeUrl(id))
      return { ok: true }
    },
    async removeVideo(clipId) {
      const id = videoOf(clipId)
      if (!id) return { ok: false, error: 'This clip has not been uploaded to YouTube.' }
      if (uploads.hasActive())
        return { ok: false, error: 'Wait for the current upload to finish first.' }
      // Sift records the video, not the project that sent it, so each connected
      // channel gets one try; a channel that does not own the video answers 403.
      const candidates = accounts.connectedPerChannel()
      if (!candidates.length)
        return { ok: false, error: 'Connect the YouTube project that uploaded this clip first.' }
      let lastError = ''
      for (const accountId of candidates) {
        if (accounts.isExhausted(accountId)) continue
        try {
          await deleteVideo(accounts.ctx(accountId), id)
          watch.stop(clipId)
          deps.patchClip({
            id: clipId,
            youtubeId: '',
            youtubeAccountId: '',
            youtubeStage: '',
            youtubeReason: '',
            youtubeCheckedAtMs: 0,
            youtubeWatchUntilMs: 0,
          })
          return { ok: true }
        } catch (err) {
          if (isQuotaExceeded(err)) {
            accounts.markExhausted(accountId)
            lastError = friendlyError(err, accounts.label(accountId))
            continue
          }
          if (err instanceof YouTubeApiError && err.status === 403) {
            lastError = `${accounts.channelTitle(accountId) || accounts.label(accountId)} does not own this video.`
            continue
          }
          return { ok: false, error: friendlyError(err, accounts.label(accountId)) }
        }
      }
      return {
        ok: false,
        error:
          lastError ||
          'No connected channel owns this video. Connect the project that uploaded it and try again.',
      }
    },
    checkVideo(clipId) {
      return watch.checkNow(clipId)
    },
    setCheckStatus(on) {
      watch.setEnabled(on)
    },
    resume() {
      uploads.restore(watch.load())
    },
    async shutdown() {
      watch.shutdown()
      accounts.shutdown()
      await uploads.shutdown()
    },
  }
}
