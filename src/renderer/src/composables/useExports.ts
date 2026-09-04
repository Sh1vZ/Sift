import { computed, ref } from 'vue'
import type { ExportJob, ExportRequest, ExportState } from '@shared/types'
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
    if (j.state === 'done') {
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
      toast('error', 'Export failed', j.error || 'ffmpeg reported an error.')
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
    toast('error', 'Could not start the export', res.error)
    return null
  }
  return res.job
}

export async function cancelExport(id: string): Promise<void> {
  const res = await api.exports.cancel(id)
  if (!res.ok) toast('error', 'Could not cancel the export', res.error)
}

export function dismissExport(id: string): void {
  void api.exports.dismiss(id)
}
