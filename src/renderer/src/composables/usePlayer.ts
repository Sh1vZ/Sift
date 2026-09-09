import { computed, nextTick, ref, watch } from 'vue'
import type { Clip } from '@shared/types'
import {
  allClips,
  getClip,
  onClipRekeyed,
  orderedClips,
  orderedExports,
  orderedFavourites,
  requestPreview,
  screen,
} from './useLibrary'
import type { Rect } from './useMotion'

/** Which list prev/next walk: a game's grid, the Clips view, or Favourites. */
export type PlayerSource = 'library' | 'clips' | 'favourites'

export const current = ref<Clip | null>(null)
export const originRect = ref<Rect | null>(null)
export const source = ref<PlayerSource>('library')
/** Set by `openClip(…, edit)` and consumed by the overlay once it has mounted. */
export const pendingEdit = ref(false)
export const isOpen = computed(() => current.value !== null)
/** True while the document is fullscreen: App hides the title bar and sidebar so the page is the whole window. */
export const fullscreen = ref(Boolean(document.fullscreenElement))
/**
 * Bumped to leave the page the way its Back button does, flip and all — the
 * title bar's crumb for the screen beneath uses it. PlayerView watches it.
 */
export const closeRequests = ref(0)
export function requestClose(): void {
  closeRequests.value++
}

// The trim bar scrubs on the strip: an open clip without one yet is asked for next.
watch(current, (c) => {
  if (c) requestPreview(c)
})

const list = computed(() => {
  switch (source.value) {
    case 'clips':
      return orderedExports.value
    case 'favourites':
      return orderedFavourites.value
    default:
      return orderedClips.value
  }
})
const index = computed(() =>
  current.value ? list.value.findIndex((c) => c.id === current.value!.id) : -1,
)
export const hasPrev = computed(() => index.value > 0)
export const hasNext = computed(() => index.value >= 0 && index.value < list.value.length - 1)

/** Every open, counted: how the screen watcher below tells a navigation from a reopen. */
let opens = 0

export function openClip(
  clip: Clip,
  rect: Rect | null = null,
  from: PlayerSource = 'library',
  edit = false,
): void {
  opens++
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

/**
 * The page belongs to the screen it was opened over: navigating away beneath
 * it — a crumb, the sidebar, Settings from the tray — takes it down. Judged a
 * tick later because opening a search result navigates first and opens
 * second; by then `opens` has moved on and the page stays up, swapping the
 * clip in place instead of closing and reopening.
 */
watch(screen, () => {
  if (!current.value) return
  const seen = opens
  void nextTick(() => {
    if (current.value && opens === seen) closePlayer()
  })
})

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
  },
)

// A rename gives the open clip a new id. The swap lands here, ahead of the
// version bump the watcher above runs on, so it finds the clip under its new
// id instead of closing the page as if the file had been deleted — and
// prev/next keep walking the same list, where the clip now sits re-keyed.
let lastRekey: { from: string; to: string } | null = null
onClipRekeyed((from, to) => {
  if (current.value?.id !== from) return
  lastRekey = { from, to: to.id }
  current.value = to
})

/**
 * Whether the id change `from` → `to` the player just saw was the open clip
 * being renamed rather than a step to another clip. Answered once: the page
 * asks from its clip watcher, and a stale answer must never make a later step
 * look like a rename.
 */
export function consumeRekey(from: string | undefined, to: string): boolean {
  const hit = lastRekey !== null && lastRekey.from === from && lastRekey.to === to
  lastRekey = null
  return hit
}

/** The clip that should take over if the current one goes away: next, else previous. */
export function neighbor(): Clip | null {
  const l = list.value
  const i = index.value
  if (i < 0) return null
  return l[i + 1] ?? l[i - 1] ?? null
}
