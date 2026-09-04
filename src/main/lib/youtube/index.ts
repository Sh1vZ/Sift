/**
 * The YouTube module's front door: composes the account list, the quota ledger
 * and the upload queue, and is the only thing `ipc.ts` and `main/index.ts`
 * talk to. This directory is the one place in Sift that touches the network.
 */

import { clipboard, shell } from 'electron'
import type { ActionResult, Clip, ClipPatch } from '@shared/types'
import { VIDEO_ID, youtubeUrl } from '@shared/youtube'
import type { Emit } from '../library'
import type { Store } from '../store'
import { YouTubeAccounts } from './accounts'
import { deleteVideo, friendlyError, isQuotaExceeded, YouTubeApiError } from './api'
import { YouTubeUploads } from './uploads'

/** The only URLs this module ever hands to the OS browser. */
const OPEN_ALLOWED = ['https://accounts.google.com/o/oauth2/', 'https://youtu.be/']

export interface YouTube {
  accounts: YouTubeAccounts
  uploads: YouTubeUploads
  openVideo(clipId: string): ActionResult
  copyLink(clipId: string): Promise<ActionResult>
  /** Deletes the clip's video on YouTube and clears the id; permanent. */
  removeVideo(clipId: string): Promise<ActionResult>
  shutdown(): Promise<void>
}

export function createYouTube(deps: {
  emit: Emit
  store: Store
  getClip(id: string): Clip | undefined
  patchClip(patch: ClipPatch): void
}): YouTube {
  const openExternal = (url: string): void => {
    if (OPEN_ALLOWED.some((prefix) => url.startsWith(prefix))) void shell.openExternal(url)
  }
  let uploads: YouTubeUploads
  const accounts = new YouTubeAccounts({
    store: deps.store,
    emit: deps.emit,
    openExternal,
    hasActiveUpload: (id) => uploads.hasActiveFor(id),
  })
  uploads = new YouTubeUploads({
    emit: deps.emit,
    accounts,
    getClip: (id) => deps.getClip(id),
    patchClip: (patch) => deps.patchClip(patch),
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
          deps.patchClip({ id: clipId, youtubeId: '' })
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
    async shutdown() {
      accounts.shutdown()
      await uploads.shutdown()
    },
  }
}
