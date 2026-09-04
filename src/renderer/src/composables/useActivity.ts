import { computed, ref } from 'vue'
import type { ExportJob, ScanState } from '@shared/types'
import type { UploadJob } from '@shared/youtube'
import { historyRecords } from './useActivityHistory'
import { activeExports, exportJobs, exportLabel } from './useExports'
import { scan, view } from './useLibrary'
import { activeUploads, processingUploads, uploadJobs, uploadLabel } from './useUploads'

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
  () =>
    activeExports.value.length +
    activeUploads.value.length +
    processingUploads.value.length +
    (scanBusy() ? 1 : 0),
)

/**
 * Whether Sift itself is working, which is what may spin. A video YouTube is
 * processing counts in the badge but not here: it can sit there for an hour,
 * and an hour of spinning icon reads as a hang, not as progress.
 */
export const activityBusy = computed<boolean>(
  () => activeExports.value.length > 0 || activeUploads.value.length > 0 || scanBusy(),
)

/** The sidebar popover: live work plus the last few finished things. */
export const activityOpen = ref(false)

/** How many finished rows the popover shows before handing over to the page. */
export const RECENT_LIMIT = 10
export const recentRecords = computed(() => historyRecords.value.slice(0, RECENT_LIMIT))

export type ActivityTab = 'active' | 'history'
/** Which tab the Activity page is on. */
export const activityTab = ref<ActivityTab>('active')

/**
 * The full Activity page. Lands on what there is to see: live work if any,
 * else the history when it has something; an empty page stays on Active,
 * whose empty state explains what turns up there. `tab` overrides that.
 */
export function openActivity(tab?: ActivityTab): void {
  activityTab.value =
    tab ?? (activityItems.value.length || !historyRecords.value.length ? 'active' : 'history')
  activityOpen.value = false
  view.value = 'activity'
}
