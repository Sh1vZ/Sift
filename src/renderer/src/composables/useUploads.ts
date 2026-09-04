import { computed, ref } from 'vue'
import type { Clip } from '@shared/types'
import {
  YOUTUBE_AUDIT_FORM_URL,
  stageLine,
  type UploadJob,
  type UploadRequest,
  type UploadState,
} from '@shared/youtube'
import { checkOnYouTube, copyYouTubeLink, getClip, now, openYouTube } from './useLibrary'
import { closePlayer } from './usePlayer'
import { openSettings } from './useSettings'
import { toast, type ToastAction } from './useToasts'
import { anyConnected, openExternalUrl } from './useYouTube'
import { formatBytes } from '@/utils/format'

const api = window.api

/** Every live upload job, as last pushed by main. Terminal jobs linger briefly, then main prunes them. */
export const uploadJobs = ref<UploadJob[]>([])

/**
 * Bytes are moving. Kept apart from `processing` on purpose: that can run for
 * an hour, so anything that spins, blocks or says "uploading" reads this.
 */
export const isSending = (j: UploadJob): boolean => j.state === 'queued' || j.state === 'uploading'

export const activeUploads = computed(() => uploadJobs.value.filter(isSending))

/** Sent, and now waiting on YouTube. Still work in progress, just not Sift's. */
export const processingUploads = computed(() =>
  uploadJobs.value.filter((j) => j.state === 'processing'),
)

/** "9.4 MB/s" from the smoothed rate main reports; '' before the first sample. */
export const formatRate = (bytesPerSecond: number): string =>
  bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : ''

/** "72% · 9.4 MB/s" — the same progress phrase everywhere an upload is shown. */
export const progressText = (j: UploadJob): string =>
  [`${Math.round(j.progress * 100)}%`, formatRate(j.bytesPerSecond)].filter(Boolean).join(' · ')

/**
 * Where a job's video is on YouTube's side, in the wording every surface uses.
 * '' while the bytes are still moving, and for a job Sift never watched.
 */
export const stageText = (j: UploadJob): string => stageLine(j, now.value)

/**
 * One line for the title bar and sidebar: what is uploading right now. Empty
 * when idle — processing is deliberately left out, because an hour of "YouTube
 * is thinking" does not belong in the chrome.
 */
export const uploadLabel = computed<string>(() => {
  const running = uploadJobs.value.find((j) => j.state === 'uploading')
  if (running) return `Uploading ${running.title} · ${progressText(running)}`
  const queued = activeUploads.value.length
  return queued ? `${queued} upload${queued === 1 ? '' : 's'} queued` : ''
})

/** The job to draw on a clip's card: the live one, else the most recent one still listed. */
export const uploadByClip = computed<Record<string, UploadJob>>(() => {
  const out: Record<string, UploadJob> = {}
  for (const j of uploadJobs.value) {
    const cur = out[j.clipId]
    if (!cur || isSending(j) || (!isSending(cur) && j.createdAtMs > cur.createdAtMs))
      out[j.clipId] = j
  }
  return out
})

/** The clip the upload form is open for; null when closed. */
export const uploadDialog = ref<Clip | null>(null)

export function openUploadDialog(clip: Clip): void {
  if (!anyConnected.value) {
    toast(
      'info',
      'Connect YouTube first',
      'Add a Google project and connect it under Settings → YouTube.',
      {
        label: 'Open YouTube settings',
        onClick: () => {
          closePlayer()
          openSettings('youtube')
        },
      },
    )
    return
  }
  uploadDialog.value = clip
}

export function closeUploadDialog(): void {
  uploadDialog.value = null
}

/**
 * Terminal-state toasts come from diffing successive pushes, not from the
 * upload call itself, so they still fire after a reload mid-upload.
 */
let known = new Map<string, UploadState>()

/** Copy link / Open on YouTube, when the clip is still in the library. */
function videoActions(clipId: string): ToastAction[] | undefined {
  const clip = getClip(clipId)
  return clip
    ? [
        { label: 'Copy link', onClick: () => void copyYouTubeLink(clip) },
        { label: 'Open on YouTube', onClick: () => void openYouTube(clip) },
      ]
    : undefined
}

/** The upload's own footnotes, told once, when the bytes land. */
function uploadNotes(j: UploadJob): void {
  if (j.privacyDowngraded) {
    toast(
      'info',
      'YouTube made this video private',
      'Videos uploaded through an unverified Google project are locked to private until Google audits the project.',
      { label: 'Request an audit', onClick: () => openExternalUrl(YOUTUBE_AUDIT_FORM_URL) },
    )
  }
  if (j.playlistError) {
    toast('info', 'Uploaded, but not added to the playlist', j.playlistError)
  }
}

function apply(list: UploadJob[]): void {
  for (const j of list) {
    const prev = known.get(j.id)
    if (!prev || prev === j.state) continue
    if (j.state === 'processing') {
      // The file is up; the news now is that YouTube has more to do with it.
      toast(
        'success',
        'Uploaded to YouTube',
        `${j.title} · YouTube is processing it`,
        videoActions(j.clipId),
      )
      uploadNotes(j)
    } else if (j.state === 'done') {
      if (prev === 'processing') {
        // Sift watched it through: either YouTube called it finished, or Sift
        // ran out of window. Never claim the first when it was the second.
        if (j.checksStopped && j.stage !== 'ready') {
          toast(
            'info',
            'Still processing on YouTube',
            `Sift has stopped checking on ${j.title}. Open it on YouTube to see how it is doing.`,
            videoActions(j.clipId),
          )
        } else {
          toast(
            'success',
            'Your video is ready',
            j.accountLabel ? `${j.title} · on ${j.accountLabel}` : j.title,
            videoActions(j.clipId),
          )
        }
      } else {
        toast(
          'success',
          'Uploaded to YouTube',
          j.accountLabel ? `${j.title} · via ${j.accountLabel}` : j.title,
          videoActions(j.clipId),
        )
        uploadNotes(j)
      }
    } else if (j.state === 'failed') {
      // A video YouTube took and then refused is a different problem from an
      // upload that never landed, and it has a page the user can go and look at.
      if (prev === 'processing') {
        toast(
          'error',
          j.stage === 'rejected'
            ? 'YouTube rejected this video'
            : 'YouTube could not process this video',
          j.error || 'YouTube did not say why.',
          videoActions(j.clipId),
        )
        continue
      }
      const settingsProblem = /connect|quota|permission|client/i.test(j.error)
      toast(
        'error',
        'Upload failed',
        j.error || 'YouTube reported an error.',
        settingsProblem
          ? {
              label: 'Open YouTube settings',
              onClick: () => {
                closePlayer()
                openSettings('youtube')
              },
            }
          : undefined,
      )
    }
  }
  known = new Map(list.map((j) => [j.id, j.state]))
  uploadJobs.value = list
}

export async function initUploads(): Promise<void> {
  const initial = await api.uploads.list()
  known = new Map(initial.map((j) => [j.id, j.state]))
  uploadJobs.value = initial
  api.on('uploads:changed', apply)
}

export async function startUpload(req: UploadRequest): Promise<UploadJob | null> {
  // Rebuilt as plain data: a reactive array or object cannot be structured-cloned
  // across IPC, and the rejection that causes would otherwise vanish silently.
  const plain: UploadRequest = {
    clipId: req.clipId,
    title: req.title,
    description: req.description,
    tags: req.tags.map(String),
    privacy: req.privacy,
    playlistId: req.playlistId,
    madeForKids: req.madeForKids,
    accountId: req.accountId,
  }
  try {
    const res = await api.uploads.start(plain)
    if (!res.ok || !res.job) {
      toast('error', 'Could not start the upload', res.error)
      return null
    }
    return res.job
  } catch (err) {
    toast('error', 'Could not start the upload', (err as Error).message)
    return null
  }
}

export async function cancelUpload(id: string): Promise<void> {
  const res = await api.uploads.cancel(id)
  if (!res.ok) toast('error', 'Could not cancel the upload', res.error)
}

export function dismissUpload(id: string): void {
  void api.uploads.dismiss(id)
}

/** Asks YouTube now about the video behind a job, for a row Sift has stopped watching. */
export async function checkUploadNow(job: UploadJob): Promise<void> {
  const clip = getClip(job.clipId)
  if (clip) await checkOnYouTube(clip)
}
