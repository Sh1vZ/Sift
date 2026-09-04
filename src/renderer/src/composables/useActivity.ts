import { computed, ref } from 'vue'
import type { ExportJob, ScanState } from '@shared/types'
import type { UploadJob } from '@shared/youtube'
import { activeExports, exportJobs, exportLabel } from './useExports'
import { scan } from './useLibrary'
import { activeUploads, uploadJobs, uploadLabel } from './useUploads'

/**
 * The one line of background activity the title bar shows. Jobs the user
 * started (exports, uploads) come before housekeeping (scans, previews), and
 * both kinds of job show at once when both are running.
 */
export const activityLabel = computed<string>(() => {
  const jobs = [exportLabel.value, uploadLabel.value].filter(Boolean)
  if (jobs.length) return jobs.join(' · ')
  if (scan.value.active) return `Scanning ${scan.value.folder}…`
  if (scan.value.pending) return `Generating previews · ${scan.value.pending} left`
  return ''
})

/** One row of the Activity panel: every job main is tracking, plus the scan while it runs. */
export type ActivityItem =
  | { kind: 'export'; id: string; job: ExportJob }
  | { kind: 'upload'; id: string; job: UploadJob }
  | { kind: 'scan'; id: 'scan'; scan: ScanState }

const scanBusy = (): boolean => scan.value.active || scan.value.pending > 0

export const activityItems = computed<ActivityItem[]>(() => {
  const items: ActivityItem[] = []
  for (const job of exportJobs.value) items.push({ kind: 'export', id: job.id, job })
  for (const job of uploadJobs.value) items.push({ kind: 'upload', id: job.id, job })
  if (scanBusy()) items.push({ kind: 'scan', id: 'scan', scan: scan.value })
  return items
})

/** Live work only — what the badge on the sidebar counts. Finished jobs wait in the panel. */
export const activityCount = computed<number>(
  () => activeExports.value.length + activeUploads.value.length + (scanBusy() ? 1 : 0),
)

export const activityOpen = ref(false)
