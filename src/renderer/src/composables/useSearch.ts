import { computed, nextTick, ref } from 'vue'
import type { Clip } from '@shared/types'
import { allClips, clearFilters, exportedClips, goClips, openGame, squash } from './useLibrary'
import { openClip } from './usePlayer'

/**
 * The Ctrl+K palette: one search across the whole index, from any screen. The
 * per-screen boxes (`/` and Ctrl+F) still filter the grid you are looking at —
 * this is the one that leaves the grid behind and goes and finds the clip.
 */
export const searchOpen = ref(false)
export const searchQuery = ref('')

/** Enough rows to be worth scrolling, few enough to stay instant on a large library. */
const LIMIT = 50

export function openSearch(): void {
  searchQuery.value = ''
  searchOpen.value = true
}

export function closeSearch(): void {
  searchOpen.value = false
}

/**
 * Ranked so the clip you meant is first: a title that starts with what you
 * typed beats one that merely contains it, which beats a punctuation-insensitive
 * match, which beats matching only the game — and last, a game the user renamed,
 * matched on the name its folder still has. Recency breaks ties.
 */
function score(c: Clip, q: string, qs: string): number {
  const title = c.title.toLowerCase()
  if (title.startsWith(q)) return 0
  if (title.includes(q)) return 1
  if (qs && squash(c.title).includes(qs)) return 2
  const game = c.game.toLowerCase()
  if (game.includes(q) || (qs && squash(c.game).includes(qs))) return 3
  // A renamed game is still findable by the folder name on disk.
  if (c.sourceGame !== c.game && qs && squash(c.sourceGame).includes(qs)) return 4
  return -1
}

export const results = computed<Clip[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  const qs = squash(q)
  const scored: Array<{ clip: Clip; rank: number }> = []
  for (const c of allClips.value) {
    const rank = score(c, q, qs)
    if (rank >= 0) scored.push({ clip: c, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || b.clip.recordedAtMs - a.clip.recordedAtMs)
  return scored.slice(0, LIMIT).map((s) => s.clip)
})

/** True for a clip that lives under the clips folder, i.e. one Sift exported. */
export function isExport(clip: Clip): boolean {
  return exportedClips.value.some((c) => c.id === clip.id)
}

/**
 * Navigate first, then open. The player walks the grid it was opened from
 * (`orderedClips` / `orderedExports`), so landing on the right screen with the
 * filters cleared is what makes prev/next work on the clip you just picked.
 */
export async function openResult(clip: Clip): Promise<void> {
  const from = isExport(clip) ? 'clips' : 'library'
  closeSearch()
  clearFilters()
  if (from === 'clips') goClips()
  else openGame(clip.game)
  await nextTick()
  openClip(clip, null, from)
}
