import { computed, ref, watch } from 'vue'
import type { Clip } from '@shared/types'
import { allClips, getClip, orderedClips } from './useLibrary'
import type { Rect } from './useMotion'

export const current = ref<Clip | null>(null)
export const originRect = ref<Rect | null>(null)
export const isOpen = computed(() => current.value !== null)

const index = computed(() =>
  current.value ? orderedClips.value.findIndex((c) => c.id === current.value!.id) : -1
)
export const hasPrev = computed(() => index.value > 0)
export const hasNext = computed(() => index.value >= 0 && index.value < orderedClips.value.length - 1)

export function openClip(clip: Clip, rect: Rect | null = null): void {
  originRect.value = rect
  current.value = clip
}

export function closePlayer(): void {
  current.value = null
}

export function nextClip(): void {
  if (hasNext.value) current.value = orderedClips.value[index.value + 1]
}

export function prevClip(): void {
  if (hasPrev.value) current.value = orderedClips.value[index.value - 1]
}

/** Keep the open clip's metadata fresh (thumbnails, probe data) and close if it disappears. */
watch(allClips, () => {
  const cur = current.value
  if (!cur) return
  const fresh = getClip(cur.id)
  if (!fresh) current.value = null
  else if (fresh !== cur) current.value = fresh
})

/** The clip that should take over if the current one goes away: next, else previous. */
export function neighbor(): Clip | null {
  const list = orderedClips.value
  const i = index.value
  if (i < 0) return null
  return list[i + 1] ?? list[i - 1] ?? null
}
