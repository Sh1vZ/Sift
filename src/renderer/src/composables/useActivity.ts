import { computed } from 'vue'
import { exportLabel } from './useExports'
import { scan } from './useLibrary'
import { uploadLabel } from './useUploads'

/**
 * The one line of background activity the title bar and sidebar show. Jobs
 * the user started (exports, uploads) come before housekeeping (scans,
 * previews), and both kinds of job show at once when both are running.
 */
export const activityLabel = computed<string>(() => {
  const jobs = [exportLabel.value, uploadLabel.value].filter(Boolean)
  if (jobs.length) return jobs.join(' · ')
  if (scan.value.active) return `Scanning ${scan.value.folder}…`
  if (scan.value.pending) return `Generating previews · ${scan.value.pending} left`
  return ''
})
