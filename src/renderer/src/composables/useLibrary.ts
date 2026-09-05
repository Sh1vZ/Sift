import { computed, reactive, ref, watch } from 'vue'
import type {
  ActivityRecord,
  Clip,
  ExportJob,
  LibraryFolder,
  ScanState,
  Settings,
  SortBy,
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { youtubeUrl } from '@shared/youtube'
import { dateBucket } from '@/utils/format'
import { confirm } from './useDialogs'
import { toast } from './useToasts'

const api = window.api

/**
 * Clips live in a plain Map outside Vue's reactivity; `version` is bumped on
 * every change so computed lists rebuild without deep-proxying thousands of
 * objects. Cards receive fresh object references on update, which is all the
 * grid needs to re-render the right rows.
 */
const clipsById = new Map<string, Clip>()
const version = ref(0)

export const ready = ref(false)
export const folders = ref<LibraryFolder[]>([])
export const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
export const scan = ref<ScanState>({ active: false, folder: '', found: 0, pending: 0, done: 0 })
export const appVersion = ref('')
export const suggestedFolders = ref<string[]>([])
export const defaultClipsDir = ref('')
/**
 * Export jobs as of the snapshot. `useExports` owns them from there on; it is
 * seeded by App.vue rather than imported here so the composable graph stays
 * acyclic (useExports → usePlayer → useLibrary).
 */
export const initialExports = ref<ExportJob[]>([])
/** Same arrangement for the Activity history: seeded here, owned by `useActivityHistory`. */
export const initialActivity = ref<ActivityRecord[]>([])
export const selectedGame = ref<string | null>(null)
export type View = 'library' | 'clips' | 'settings' | 'activity'
export const view = ref<View>('library')

/** Ticks once a minute so "2 minutes ago" labels stay honest. */
export const now = ref(Date.now())

let clock = 0
/**
 * Stopped while the window is off screen (see useWindowVisibility). The timer
 * itself is nearly free, but every tick invalidates `sections`, which rebuilds
 * the whole grid — pointless work for a window nobody is looking at.
 */
export function startClock(): void {
  if (clock) return
  // Catch up first: labels have to be right before the next paint, not a minute later.
  now.value = Date.now()
  clock = window.setInterval(() => (now.value = Date.now()), 60_000)
}
export function stopClock(): void {
  if (!clock) return
  window.clearInterval(clock)
  clock = 0
}
startClock()

/** Every record in the index: recordings and exported clips alike. */
export const allClips = computed<Clip[]>(() => {
  void version.value
  return Array.from(clipsById.values())
})

// ------------------------------------------------------ recordings vs clips

/** The folder Sift exports into. Always present once the snapshot has loaded. */
export const clipsFolder = computed<LibraryFolder | null>(
  () => folders.value.find((f) => f.kind === 'clips') ?? null,
)
const exportFolderIds = computed(
  () => new Set(folders.value.filter((f) => f.kind === 'clips').map((f) => f.id)),
)

/** Recordings only — what the Games screen and its grids are built from. */
export const recordings = computed<Clip[]>(() => {
  const ids = exportFolderIds.value
  return ids.size ? allClips.value.filter((c) => !ids.has(c.folderId)) : allClips.value
})

/** Everything under the clips folder — the Clips view. */
export const exportedClips = computed<Clip[]>(() => {
  const ids = exportFolderIds.value
  return ids.size ? allClips.value.filter((c) => ids.has(c.folderId)) : []
})

/**
 * Which grid a clip belongs to, so something opening a clip from outside a
 * grid — the Storage screen, a search hit — can tell the player which list
 * prev/next should walk.
 */
export function scopeOf(clip: Clip): 'library' | 'clips' {
  return exportFolderIds.value.has(clip.folderId) ? 'clips' : 'library'
}

export interface GameSummary {
  name: string
  count: number
  cover: string
  latestMs: number
  totalDuration: number
  totalSize: number
  /** The folder names folded into this card — more than one once games are merged. */
  sources: string[]
  /** The name shown is not the one the folders gave it: renamed, merged, or both. */
  renamed: boolean
}

export const games = computed<GameSummary[]>(() => {
  const map = new Map<string, GameSummary & { coverMs: number; sourceSet: Set<string> }>()
  for (const c of recordings.value) {
    let g = map.get(c.game)
    if (!g) {
      g = {
        name: c.game,
        count: 0,
        cover: '',
        latestMs: 0,
        totalDuration: 0,
        totalSize: 0,
        sources: [],
        renamed: false,
        coverMs: -1,
        sourceSet: new Set(),
      }
      map.set(c.game, g)
    }
    g.sourceSet.add(c.sourceGame)
    g.count++
    g.totalDuration += c.duration
    g.totalSize += c.size
    if (c.recordedAtMs > g.latestMs) g.latestMs = c.recordedAtMs
    if (c.thumb && c.recordedAtMs > g.coverMs) {
      g.cover = c.thumb
      g.coverMs = c.recordedAtMs
    }
  }
  for (const g of map.values()) {
    g.sources = [...g.sourceSet].sort((a, b) => a.localeCompare(b))
    g.renamed = g.sources.length > 1 || g.sources[0] !== g.name
  }
  return [...map.values()].sort((a, b) => b.latestMs - a.latestMs)
})

/** Grid order. `timeOf` is what "newest" means: the recording time, or for exports the export time. */
function compare(
  sort: SortBy,
  timeOf: (c: Clip) => number = (c) => c.recordedAtMs,
): (a: Clip, b: Clip) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => timeOf(a) - timeOf(b) || a.name.localeCompare(b.name)
    case 'name':
      return (a, b) => a.title.localeCompare(b.title) || timeOf(a) - timeOf(b)
    case 'duration':
      return (a, b) => b.duration - a.duration || timeOf(b) - timeOf(a)
    case 'size':
      return (a, b) => b.size - a.size || timeOf(b) - timeOf(a)
    case 'favourite':
      return (a, b) =>
        Number(b.favourite) - Number(a.favourite) ||
        timeOf(b) - timeOf(a) ||
        a.name.localeCompare(b.name)
    default:
      return (a, b) => timeOf(b) - timeOf(a) || a.name.localeCompare(b.name)
  }
}

export type ShareFilter = 'all' | 'shared' | 'unshared'

export const SHARE_FILTERS: Array<{ value: ShareFilter; label: string; icon: string }> = [
  { value: 'all', label: 'All', icon: 'i-lucide-layers' },
  { value: 'shared', label: 'On YouTube', icon: 'i-lucide-youtube' },
  { value: 'unshared', label: 'Not shared', icon: 'i-lucide-cloud-off' },
]

/** Which grid a filter belongs to: a game's recordings, or the Clips view. */
export type FilterScope = 'library' | 'clips'

export interface ViewFilters {
  /** Title filter typed in the toolbar; reset whenever its screen is entered. */
  query: string
  favourites: boolean
  unwatched: boolean
  share: ShareFilter
}

const blankFilters = (): ViewFilters => ({
  query: '',
  favourites: false,
  unwatched: false,
  share: 'all',
})

/**
 * One set per grid, so a toggle set inside a game never silently narrows the
 * Clips view, or the other way round. View state rather than settings: a
 * filter left on across launches would look like clips had vanished. The two
 * toggles compose — "unwatched favourites" is the question the pair answers.
 */
export const libraryFilters = reactive<ViewFilters>(blankFilters())
export const clipsFilters = reactive<ViewFilters>(blankFilters())

export const filtersFor = (scope: FilterScope): ViewFilters =>
  scope === 'clips' ? clipsFilters : libraryFilters

/** A toggle or the sharing select — not the name filter — is hiding clips. */
export const isNarrowed = (f: ViewFilters): boolean =>
  f.favourites || f.unwatched || f.share !== 'all'

export function clearFilters(scope: FilterScope): void {
  const f = filtersFor(scope)
  f.favourites = false
  f.unwatched = false
  f.share = 'all'
}

/** The Clips view's order. The in-game order is a persisted setting; this one resets with the app. */
export const exportSort = ref<SortBy>('newest')

/** Letters and digits only, so "lords of the fallen" finds "LordsOfTheFallen_2026". */
export const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Title match for a query already lower-cased (`q`) and squashed (`qs`). */
const matchesQuery = (c: Clip, q: string, qs: string): boolean =>
  !q || c.title.toLowerCase().includes(q) || squash(c.title).includes(qs)

const matches = (c: Clip, f: ViewFilters, q: string, qs: string): boolean =>
  (f.share === 'all' || (f.share === 'shared') === Boolean(c.youtubeId)) &&
  (!f.favourites || c.favourite) &&
  (!f.unwatched || !c.seenAtMs) &&
  matchesQuery(c, q, qs)

export const visibleClips = computed<Clip[]>(() => {
  const game = selectedGame.value
  const f = libraryFilters
  const q = f.query.trim().toLowerCase()
  const qs = squash(q)
  const list = recordings.value.filter((c) => (!game || c.game === game) && matches(c, f, q, qs))
  return list.sort(compare(settings.value.sort))
})

/** Clips in the current game before the sharing filter, so an empty grid can say why. */
export const gameClipCount = computed<number>(() => {
  const game = selectedGame.value
  return game ? recordings.value.filter((c) => c.game === game).length : recordings.value.length
})

export interface Section {
  key: string
  /** Null renders the clips without a header. */
  title: string | null
  clips: Clip[]
}

/** Grouping applied inside a game's grid. Anything unexpected in a stored setting falls back to date. */
export const gridGroupBy = computed<'date' | 'none'>(() =>
  settings.value.groupBy === 'none' ? 'none' : 'date',
)

export const sections = computed<Section[]>(() => {
  const list = visibleClips.value
  if (!list.length) return []
  if (gridGroupBy.value === 'none') return [{ key: 'all', title: null, clips: list }]
  const stamp = now.value
  const buckets = new Map<string, { title: string; order: number; clips: Clip[] }>()
  for (const c of list) {
    const b = dateBucket(c.recordedAtMs, stamp)
    let s = buckets.get(b.key)
    if (!s) {
      s = { title: b.title, order: b.order, clips: [] }
      buckets.set(b.key, s)
    }
    s.clips.push(c)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, s]) => ({ key, title: s.title, clips: s.clips }))
})

/** Grid order, flattened: what "next clip" means inside the player. */
export const orderedClips = computed<Clip[]>(() => sections.value.flatMap((s) => s.clips))

export const libraryStats = computed(() => {
  let duration = 0
  let size = 0
  for (const c of visibleClips.value) {
    duration += c.duration
    size += c.size
  }
  return { count: visibleClips.value.length, duration, size }
})

/** When an export happened; hand-copied files fall back to their recording time. */
const exportedAt = (c: Clip): number => c.createdAtMs || c.recordedAtMs

/** The Clips view: one section per game in the chosen order, games by their latest export. */
export const clipSections = computed<Section[]>(() => {
  const f = clipsFilters
  const q = f.query.trim().toLowerCase()
  const qs = squash(q)
  const list = exportedClips.value.filter((c) => matches(c, f, q, qs))
  if (!list.length) return []
  const byGame = new Map<string, { latest: number; clips: Clip[] }>()
  for (const c of list) {
    let g = byGame.get(c.game)
    if (!g) {
      g = { latest: 0, clips: [] }
      byGame.set(c.game, g)
    }
    g.clips.push(c)
    if (exportedAt(c) > g.latest) g.latest = exportedAt(c)
  }
  return [...byGame.entries()]
    .sort((a, b) => b[1].latest - a[1].latest)
    .map(([game, g]) => ({
      key: `g:${game}`,
      title: game,
      clips: g.clips.sort(compare(exportSort.value, exportedAt)),
    }))
})

export const orderedExports = computed<Clip[]>(() => clipSections.value.flatMap((s) => s.clips))

export const clipsStats = computed(() => {
  let duration = 0
  let size = 0
  for (const c of exportedClips.value) {
    duration += c.duration
    size += c.size
  }
  return { count: exportedClips.value.length, duration, size }
})

export function getClip(id: string): Clip | undefined {
  return clipsById.get(id)
}

/** Which screen the main area shows: the games browser is home, a game drills into its clips. */
export const screen = computed<'games' | 'game' | 'clips' | 'settings' | 'activity'>(() => {
  if (view.value !== 'library') return view.value
  return selectedGame.value ? 'game' : 'games'
})

export function goGames(): void {
  selectedGame.value = null
  libraryFilters.query = ''
  view.value = 'library'
}

export function openGame(name: string): void {
  selectedGame.value = name
  libraryFilters.query = ''
  view.value = 'library'
}

/** The most recent recording of a game — what "show this game's folder" reveals. */
export function newestClipOf(game: string): Clip | undefined {
  let best: Clip | undefined
  for (const c of recordings.value) {
    if (c.game === game && (!best || c.recordedAtMs > best.recordedAtMs)) best = c
  }
  return best
}

export function goClips(): void {
  clipsFilters.query = ''
  view.value = 'clips'
}

// ------------------------------------------------------------------- back

interface Spot {
  view: View
  game: string | null
}

/**
 * One step of history: where the user stood before the last navigation, so
 * Backspace and Esc return there — Games → a game → Clips → Back lands on the
 * game again, and a second Back reaches Games. Recorded from the two refs every
 * navigation path mutates, so no caller has to remember to push; the guard
 * keeps a restore from recording itself.
 */
let previous: Spot | null = null
let restoring = false

watch([view, selectedGame], (_next, [prevView, prevGame]) => {
  if (restoring) {
    restoring = false
    return
  }
  previous = { view: prevView, game: prevGame }
})

export function goBack(): void {
  const to = previous
  previous = null
  if (!to || (to.view === view.value && to.game === selectedGame.value)) {
    goGames()
    return
  }
  restoring = true
  if (to.view === 'library') {
    selectedGame.value = to.game
    libraryFilters.query = ''
  }
  view.value = to.view
}

// ---------------------------------------------------------- games browser

export type GameSort = 'recent' | 'name' | 'count'
export const gameQuery = ref('')
export const gameSort = ref<GameSort>('recent')

export const filteredGames = computed<GameSummary[]>(() => {
  const q = gameQuery.value.trim().toLowerCase()
  const qs = squash(q)
  let list = games.value
  if (q) list = list.filter((g) => g.name.toLowerCase().includes(q) || squash(g.name).includes(qs))
  switch (gameSort.value) {
    case 'name':
      return [...list].sort((a, b) => a.name.localeCompare(b.name))
    case 'count':
      return [...list].sort((a, b) => b.count - a.count || b.latestMs - a.latestMs)
    default:
      return list
  }
})

/**
 * Games whose names differ only in case or punctuation — `apex_legends` beside
 * `Apex Legends`. Offered as a merge, never applied on their own: two folders
 * that look alike are not always the same game, and only the user knows.
 */
export interface MergeSuggestion {
  /** The squashed name the group shares; what a dismissal is remembered by. */
  key: string
  /** The busiest name first — the one the others are offered to fold into. */
  games: GameSummary[]
}

export const mergeSuggestions = computed<MergeSuggestion[]>(() => {
  const dismissed = new Set(settings.value.dismissedGameMerges)
  const byKey = new Map<string, GameSummary[]>()
  for (const g of games.value) {
    const key = squash(g.name)
    if (!key || dismissed.has(key)) continue
    const group = byKey.get(key)
    if (group) group.push(g)
    else byKey.set(key, [g])
  }
  const out: MergeSuggestion[] = []
  for (const [key, group] of byKey) {
    if (group.length < 2) continue
    // The fullest name leads: it is the one most likely worth keeping, and it is
    // what the merge button offers to fold the others into.
    out.push({
      key,
      games: [...group].sort((a, b) => b.count - a.count || b.name.length - a.name.length),
    })
  }
  return out.sort((a, b) => b.games[0].count - a.games[0].count)
})

/** Remembers that a look-alike pair is two different games, so the hint stays gone. */
export async function dismissMergeSuggestion(key: string): Promise<void> {
  const kept = settings.value.dismissedGameMerges.filter((k) => k !== key)
  await updateSettings({ dismissedGameMerges: [...kept, key].slice(-50) })
}

/** Mirrors `prettifyGame` in the main process, so the optimistic name matches what comes back. */
const prettyGameName = (s: string): string => s.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Renames a game, or merges several into one — display only, nothing on disk
 * moves. `sources` are `Clip.sourceGame` values; a null display puts each game
 * back under the name its folder gave it. Optimistic like the heart: the grid
 * regroups in the same frame and the `clips:updated` push confirms after.
 */
export async function setGameAlias(sources: string[], display: string | null): Promise<boolean> {
  const label = display === null ? null : prettyGameName(display)
  if (label !== null && !label) return false

  const affected = new Set(sources)
  const before = new Map<string, string>()
  for (const c of clipsById.values()) if (affected.has(c.sourceGame)) before.set(c.id, c.game)
  if (!before.size) return false

  for (const id of before.keys()) {
    const c = clipsById.get(id)
    if (c) patchLocal(id, { game: label ?? c.sourceGame })
  }
  // Follow the game the user is standing in rather than dropping them back to
  // the grid when the watch below notices the old name is gone.
  const wasSelected = selectedGame.value
  if (wasSelected !== null && [...before.values()].includes(wasSelected))
    selectedGame.value = label ?? [...affected].sort((a, b) => a.localeCompare(b))[0]

  const res = await api.library.setGameAlias(sources, display)
  if (!res.ok) {
    for (const [id, game] of before) patchLocal(id, { game })
    selectedGame.value = wasSelected
    toast('error', 'Could not rename', res.error)
    return false
  }
  return true
}

// If the selected game vanishes (folder removed, last clip deleted) fall back to
// All. Gated on there being a selection: a watch re-runs its getter on every
// dependency bump, so reading `games` unconditionally rebuilt the whole game
// index on every batch of clips a scan indexed, even on the Games screen.
watch(
  () => (selectedGame.value ? games.value : null),
  (list) => {
    if (list && selectedGame.value && !list.some((g) => g.name === selectedGame.value))
      selectedGame.value = null
  },
)

export async function initLibrary(): Promise<void> {
  const snap = await api.library.snapshot()
  clipsById.clear()
  for (const c of snap.clips) clipsById.set(c.id, c)
  folders.value = snap.folders
  settings.value = snap.settings
  scan.value = snap.scan
  appVersion.value = snap.appVersion
  suggestedFolders.value = snap.suggestedFolders
  defaultClipsDir.value = snap.defaultClipsDir
  initialExports.value = snap.exports
  initialActivity.value = snap.activity
  version.value++
  ready.value = true

  api.on('clips:added', (clips) => {
    for (const c of clips) clipsById.set(c.id, c)
    version.value++
  })
  api.on('clips:updated', (patches) => {
    for (const p of patches) {
      const c = clipsById.get(p.id)
      if (c) clipsById.set(p.id, { ...c, ...p })
    }
    version.value++
  })
  api.on('clips:removed', (ids) => {
    for (const id of ids) clipsById.delete(id)
    version.value++
  })
  api.on('folders:changed', (f) => (folders.value = f))
  api.on('settings:changed', (s) => (settings.value = s))
  api.on('scan:changed', (s) => (scan.value = s))
}

// ------------------------------------------------------------------ actions

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  settings.value = { ...settings.value, ...patch }
  settings.value = await api.library.setSettings(patch)
}

export async function addFolder(path?: string): Promise<LibraryFolder | null> {
  const res = path ? await api.library.addFolderPath(path) : await api.library.addFolder()
  if (res.error) toast('error', 'Could not add folder', res.error)
  else if (res.folder) toast('success', 'Folder added', `Scanning ${res.folder.name}…`)
  return res.folder
}

/**
 * Folders dropped onto the window. Only main knows a path from a File, and
 * only main can tell a folder from a file, so each one goes through the same
 * `addFolder` path the picker uses and reports the same way.
 */
export async function addDroppedFolders(files: File[]): Promise<void> {
  const paths = files.map((f) => api.pathForFile(f)).filter(Boolean)
  if (!paths.length) {
    toast('info', 'Drop a folder', 'Sift indexes folders, not single files.')
    return
  }
  for (const path of paths) await addFolder(path)
}

export async function removeFolder(folder: LibraryFolder): Promise<void> {
  const res = await api.library.removeFolder(folder.id)
  if (!res.ok) toast('error', 'Could not remove folder', res.error)
  else
    toast(
      'info',
      'Folder removed',
      `${folder.name} is no longer indexed. Files were left untouched.`,
    )
}

export async function rescan(folderId?: string): Promise<void> {
  await api.library.rescan(folderId)
}

/** Moving the clips folder only moves the index; files stay where they were exported. */
async function confirmClipsMove(): Promise<boolean> {
  if (!exportedClips.value.length) return true
  return confirm({
    title: 'Change the clips folder?',
    message:
      'Clips already exported stay on disk where they are, but they leave the Clips list. New exports go to the folder you pick.',
    detail: clipsFolder.value?.path,
    detailIcon: 'i-lucide-folder-output',
    confirmLabel: 'Choose folder',
  })
}

export async function chooseClipsDir(): Promise<void> {
  if (!(await confirmClipsMove())) return
  const res = await api.library.chooseClipsDir()
  if (!res.ok) toast('error', 'Could not change the clips folder', res.error)
  else if (res.folder) toast('success', 'Clips folder changed', res.folder.path)
}

export async function resetClipsDir(): Promise<void> {
  if (!(await confirmClipsMove())) return
  const res = await api.library.setClipsDir('')
  if (!res.ok) toast('error', 'Could not reset the clips folder', res.error)
  else if (res.folder) toast('success', 'Clips folder reset', res.folder.path)
}

export async function revealClipsDir(): Promise<void> {
  const res = await api.library.revealClipsDir()
  if (!res.ok) toast('error', 'Could not open the clips folder', res.error)
}

// ------------------------------------------------------------ pending work

export type PendingKind = 'delete' | 'rename' | 'remove-youtube' | 'check-youtube' | 'copy-file'

export interface PendingAction {
  kind: PendingKind
  /** What the card veil and the player banner say while it runs. */
  label: string
}

/**
 * Clip actions that take a moment — a Recycle Bin move, a rename on a slow
 * drive, a YouTube request — keyed by clip id while they run. Cards veil,
 * buttons spin and menu entries disable off this, so a click always answers.
 */
export const pendingByClip = ref<Record<string, PendingAction>>({})

async function withPending<T>(
  clipId: string,
  kind: PendingKind,
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  pendingByClip.value = { ...pendingByClip.value, [clipId]: { kind, label } }
  try {
    return await run()
  } finally {
    const rest = { ...pendingByClip.value }
    delete rest[clipId]
    pendingByClip.value = rest
  }
}

export async function renameClip(clip: Clip, name: string): Promise<Clip | null> {
  return withPending(clip.id, 'rename', 'Renaming…', async () => {
    const res = await api.clips.rename(clip.id, name)
    if (!res.ok || !res.clip) {
      toast('error', 'Rename failed', res.error)
      return null
    }
    // Swap the record now so the UI never sees a gap before the events arrive.
    clipsById.delete(clip.id)
    clipsById.set(res.clip.id, res.clip)
    version.value++
    return res.clip
  })
}

export async function deleteClip(clip: Clip, permanent = false): Promise<boolean> {
  return withPending(
    clip.id,
    'delete',
    permanent ? 'Deleting…' : 'Moving to the Recycle Bin…',
    async () => {
      const res = await api.clips.delete(clip.id, permanent)
      if (!res.ok) {
        toast('error', 'Delete failed', res.error)
        return false
      }
      clipsById.delete(clip.id)
      version.value++
      toast(
        'success',
        permanent ? 'Deleted permanently' : 'Moved to Recycle Bin',
        clip.name + clip.ext,
      )
      return true
    },
  )
}

export function revealClip(clip: Clip): void {
  void api.clips.reveal(clip.id)
}

// ------------------------------------------------------------- user state
// Flipped in the local map first so the heart and the dimming answer the click
// in the same frame; the `clips:updated` push confirms a moment later. No
// `withPending` veil — that is for actions that touch the disk and take time.

function patchLocal(id: string, patch: Partial<Clip>): void {
  const c = clipsById.get(id)
  if (!c) return
  clipsById.set(id, { ...c, ...patch })
  version.value++
}

export async function toggleFavourite(clip: Clip): Promise<void> {
  const next = !clip.favourite
  patchLocal(clip.id, { favourite: next })
  const res = await api.clips.setFavourite(clip.id, next)
  if (!res.ok) {
    patchLocal(clip.id, { favourite: !next })
    toast(
      'error',
      next ? 'Could not add to favourites' : 'Could not remove from favourites',
      res.error,
    )
  }
}

/**
 * Idempotent on purpose: the player calls this on every `timeupdate` past the
 * threshold, so a no-op has to be free and must not touch IPC.
 */
export async function markSeen(clip: Clip, seen = true): Promise<void> {
  if (Boolean(clip.seenAtMs) === seen) return
  const previous = clip.seenAtMs
  patchLocal(clip.id, { seenAtMs: seen ? Date.now() : 0 })
  const res = await api.clips.setSeen(clip.id, seen)
  if (!res.ok) {
    patchLocal(clip.id, { seenAtMs: previous })
    toast('error', seen ? 'Could not mark as watched' : 'Could not mark as unwatched', res.error)
  }
}

export async function copyClipPath(clip: Clip): Promise<void> {
  // The main process owns the clipboard: the renderer only knows the path it
  // was handed, and this keeps the write on the same side as the file itself.
  const res = await api.clips.copyPath(clip.id)
  if (res.ok) toast('success', 'Path copied', clip.path)
  else toast('error', 'Could not copy path', res.error)
}

/**
 * Puts the file itself on the clipboard, so a paste into Discord, a browser
 * or a folder lands the clip. Pending because the PowerShell that writes the
 * clipboard can take a second to cold-start.
 */
export async function copyClipFile(clip: Clip): Promise<void> {
  await withPending(clip.id, 'copy-file', 'Copying file…', async () => {
    const res = await api.clips.copyFile(clip.id)
    if (res.ok) toast('success', 'File copied', 'Paste it anywhere with Ctrl+V.')
    else toast('error', 'Could not copy the file', res.error)
  })
}

/** Opens the clip's YouTube page in the browser; main builds the URL from the stored id. */
export async function openYouTube(clip: Clip): Promise<void> {
  const res = await api.clips.openYouTube(clip.id)
  if (!res.ok) toast('error', 'Could not open YouTube', res.error)
}

export async function copyYouTubeLink(clip: Clip): Promise<void> {
  const res = await api.clips.copyYouTubeLink(clip.id)
  if (res.ok) toast('success', 'Link copied', youtubeUrl(clip.youtubeId))
  else toast('error', 'Could not copy the link', res.error)
}

/**
 * Asks YouTube where the video is right now. The watcher does this on its own
 * while an upload is fresh; this is the button for after it has stopped.
 */
export async function checkOnYouTube(clip: Clip): Promise<void> {
  await withPending(clip.id, 'check-youtube', 'Checking status…', async () => {
    const res = await api.clips.checkOnYouTube(clip.id)
    if (!res.ok) toast('error', 'Could not check the video', res.error)
  })
}

/** Deletes the video on YouTube. Confirmed first: YouTube has no trash to get it back from. */
export async function removeFromYouTube(clip: Clip): Promise<boolean> {
  const ok = await confirm({
    title: 'Remove this video from YouTube?',
    message:
      'The video is deleted from your channel for good — YouTube keeps no copy and the link stops working. The clip itself stays in Sift and on disk.',
    detail: youtubeUrl(clip.youtubeId),
    detailIcon: 'i-lucide-youtube',
    confirmLabel: 'Remove from YouTube',
    danger: true,
  })
  if (!ok) return false
  return withPending(clip.id, 'remove-youtube', 'Removing from YouTube…', async () => {
    const res = await api.clips.removeFromYouTube(clip.id)
    if (!res.ok) {
      toast('error', 'Could not remove the video', res.error)
      return false
    }
    // The badge goes now; the clips:updated push confirms it a moment later.
    const c = clipsById.get(clip.id)
    if (c) {
      clipsById.set(clip.id, { ...c, youtubeId: '' })
      version.value++
    }
    toast('success', 'Removed from YouTube', clip.title)
    return true
  })
}
