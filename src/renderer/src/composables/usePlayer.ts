import { computed, ref, watch } from 'vue'
import type { Clip } from '@shared/types'
import { allClips, getClip, orderedClips, orderedExports } from './useLibrary'
import type { Rect } from './useMotion'

/** Which list prev/next walk: a game's grid, or the Clips view. */
export type PlayerSource = 'library' | 'clips'

export const current = ref<Clip | null>(null)
export const originRect = ref<Rect | null>(null)
export const source = ref<PlayerSource>('library')
/** Set by `openClip(…, edit)` and consumed by the overlay once it has mounted. */
export const pendingEdit = ref(false)
export const isOpen = computed(() => current.value !== null)

const list = computed(() => (source.value === 'clips' ? orderedExports.value : orderedClips.value))
const index = computed(() => (current.value ? list.value.findIndex((c) => c.id === current.value!.id) : -1))
export const hasPrev = computed(() => index.value > 0)
export const hasNext = computed(() => index.value >= 0 && index.value < list.value.length - 1)

export function openClip(clip: Clip, rect: Rect | null = null, from: PlayerSource = 'library', edit = false): void {
  originRect.value = rect
  source.value = from
  pendingEdit.value = edit
  current.value = clip
}

/** Jump from an exported clip to the recording it was cut from. False when that recording is gone. */
export function openSource(clip: Clip): boolean {
  const src = clip.sourceId ? getClip(clip.sourceId) : undefined
  if (!src) return false
  source.value = 'library'
  pendingEdit.value = false
  current.value = src
  return true
}

export function closePlayer(): void {
  current.value = null
  pendingEdit.value = false
}

export function nextClip(): void {
  if (hasNext.value) current.value = list.value[index.value + 1]
}

export function prevClip(): void {
  if (hasPrev.value) current.value = list.value[index.value - 1]
}

/**
 * Keep the open clip's metadata fresh (thumbnails, probe data) and close if it
 * disappears. The source is gated on the player being open: a watch re-runs its
 * getter on every dependency bump, and reading `allClips` unconditionally
 * rebuilt the whole clip array on every batch of a scan, player or no player.
 */
watch(
  () => (current.value ? allClips.value : null),
  () => {
    const cur = current.value
    if (!cur) return
    const fresh = getClip(cur.id)
    if (!fresh) current.value = null
    else if (fresh !== cur) current.value = fresh
  }
)

/** The clip that should take over if the current one goes away: next, else previous. */
export function neighbor(): Clip | null {
  const l = list.value
  const i = index.value
  if (i < 0) return null
  return l[i + 1] ?? l[i - 1] ?? null
}
