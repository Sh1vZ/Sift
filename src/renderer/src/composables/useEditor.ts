import { computed, ref } from 'vue'
import type { Clip, ExportJob } from '@shared/types'
import { clamp } from '@/utils/format'
import { exportClip } from './useExports'
import { toast } from './useToasts'

/** Shortest cut the editor accepts, in seconds. Mirrors the check in main. */
export const MIN_SELECTION_S = 0.25

/**
 * Edit-mode state for the player's trim tools. One clip is edited at a time,
 * so the state is module-scope and reset whenever the player's clip changes.
 */
export const editing = ref(false)
export const inSec = ref(0)
export const outSec = ref(0)
export const exportMuted = ref(false)
export const exportName = ref('')
export const submitting = ref(false)

let duration = 0

export const selectionLength = computed(() => outSec.value - inSec.value)
export const canExport = computed(
  () =>
    editing.value &&
    !submitting.value &&
    exportName.value.trim().length > 0 &&
    selectionLength.value >= MIN_SELECTION_S
)

export function enterEdit(clip: Clip): void {
  duration = clip.duration
  inSec.value = 0
  outSec.value = duration
  exportMuted.value = false
  exportName.value = `${clip.title} - Clip`
  editing.value = true
}

export function exitEdit(): void {
  editing.value = false
}

export function setIn(t: number): void {
  inSec.value = clamp(t, 0, Math.max(0, outSec.value - MIN_SELECTION_S))
}

export function setOut(t: number): void {
  outSec.value = clamp(t, Math.min(duration, inSec.value + MIN_SELECTION_S), duration)
}

export function resetRange(): void {
  inSec.value = 0
  outSec.value = duration
}

export async function submit(clip: Clip): Promise<ExportJob | null> {
  if (!canExport.value) return null
  submitting.value = true
  try {
    const job = await exportClip({
      id: clip.id,
      name: exportName.value.trim(),
      start: inSec.value,
      end: outSec.value,
      muted: exportMuted.value
    })
    if (job) {
      toast('info', 'Exporting clip', `${job.name}${job.ext} · ${job.game}`)
      exitEdit()
    }
    return job
  } finally {
    submitting.value = false
  }
}
