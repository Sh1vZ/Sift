import { computed, ref } from 'vue'
import type {
  ActionResult,
  AudioExportRequest,
  ExportJob,
  ExportRequest,
  ExportState,
  GifExportRequest,
} from '@shared/types'
import { historyRecords } from './useActivityHistory'
import { alertError } from './useDialogs'
import { getClip, goClips } from './useLibrary'
import { closePlayer } from './usePlayer'
import { openResult } from './useSearch'
import { toast } from './useToasts'

const api = window.api

/** Every live export job, as last pushed by main. Terminal jobs linger briefly, then main prunes them. */
export const exportJobs = ref<ExportJob[]>([])

export const activeExports = computed(() =>
  exportJobs.value.filter((j) => j.state === 'queued' || j.state === 'running'),
)

/** One line for the title bar and sidebar: what is exporting right now. Empty when idle. */
export const exportLabel = computed<string>(() => {
  const running = exportJobs.value.find((j) => j.state === 'running')
  if (running) return `Exporting ${running.name} · ${Math.round(running.progress * 100)}%`
  const queued = activeExports.value.length
  return queued ? `${queued} export${queued === 1 ? '' : 's'} queued` : ''
})

export const jobsById = computed<Record<string, ExportJob>>(() =>
  Object.fromEntries(exportJobs.value.map((j) => [j.id, j])),
)

/**
 * Terminal-state toasts come from diffing successive pushes, not from the
 * export call itself, so they still fire after a reload mid-export.
 */
let known = new Map<string, ExportState>()

function apply(list: ExportJob[]): void {
  for (const j of list) {
    const prev = known.get(j.id)
    if (!prev || prev === j.state) continue
    if (j.state === 'done' && j.kind !== 'clip') {
      toast('success', j.kind === 'gif' ? 'GIF exported' : 'Audio exported', j.name + j.ext, {
        label: 'Show in Explorer',
        onClick: () => void revealExport(j),
      })
    } else if (j.state === 'done') {
      toast('success', 'Clip exported', j.name + j.ext, {
        label: 'View clip',
        // Looked up when clicked, not now: the clip lands in the index a
        // moment around this push, and the toast lives long enough to wait.
        onClick: () => {
          const clip = j.clipId ? getClip(j.clipId) : undefined
          if (clip) {
            void openResult(clip)
            return
          }
          closePlayer()
          goClips()
        },
      })
    } else if (j.state === 'failed') {
      // The cut was never written, and the user has usually walked away from
      // the trim bar by now. A toast they can miss leaves them waiting on a
      // file that is not coming.
      void alertError({
        title: 'Export failed',
        message: `Nothing was written for ${j.name}${j.ext}. The recording it was cut from is untouched, so the trim can be made again.`,
        detail: j.error || 'ffmpeg reported an error but gave no message.',
      })
    }
  }
  known = new Map(list.map((j) => [j.id, j.state]))
  exportJobs.value = list
}

export function initExports(initial: ExportJob[]): void {
  known = new Map(initial.map((j) => [j.id, j.state]))
  exportJobs.value = initial
  api.on('exports:changed', apply)
}

export async function exportClip(req: ExportRequest): Promise<ExportJob | null> {
  const res = await api.clips.export(req)
  if (!res.ok || !res.job) {
    void alertError({
      title: 'Could not start the export',
      message:
        'The export never joined the queue, so nothing is being written. The trim is still on screen — close this and try again.',
      detail: res.error,
    })
    return null
  }
  return res.job
}

/**
 * Main's answer to an export that goes to a file. It put up the save dialog;
 * a dismissed one resolves null with nothing to say, exactly like a refused
 * request after its alert, so the caller stays on the trim either way.
 */
function accepted(res: ActionResult & { job?: ExportJob; cancelled?: boolean }): ExportJob | null {
  if (res.cancelled) return null
  if (!res.ok || !res.job) {
    void alertError({
      title: 'Could not start the export',
      message:
        'The export never joined the queue, so nothing is being written. The trim is still on screen — close this and try again.',
      detail: res.error,
    })
    return null
  }
  return res.job
}

/** The selection's audio alone, to a file the user picks. */
export async function exportAudio(req: AudioExportRequest): Promise<ExportJob | null> {
  return accepted(await api.clips.exportAudio(req))
}

/** The selection as an animated GIF, to a file the user picks. */
export async function exportGif(req: GifExportRequest): Promise<ExportJob | null> {
  return accepted(await api.clips.exportGif(req))
}

/**
 * Explorer on an exported file. Main knows the job only while it lingers in
 * the live list (ten seconds past done); a toast held open longer than that
 * falls back to the History row, which keeps the path for good.
 */
export async function revealExport(job: ExportJob): Promise<void> {
  const res = await api.exports.reveal(job.id)
  if (res.ok) return
  const record = historyRecords.value.find(
    (r) => r.kind === 'export' && r.status === 'done' && r.path === job.path,
  )
  const fallback = record ? await api.activity.reveal(record.id) : res
  if (!fallback.ok) toast('error', 'Could not show the file', fallback.error)
}

export async function cancelExport(id: string): Promise<void> {
  const res = await api.exports.cancel(id)
  if (!res.ok) toast('error', 'Could not cancel the export', res.error)
}

export function dismissExport(id: string): void {
  void api.exports.dismiss(id)
}
