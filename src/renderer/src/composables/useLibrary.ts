import { computed, ref, watch } from 'vue'
import type { Clip, ExportJob, LibraryFolder, ScanState, Settings } from '@shared/types'
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
export const selectedGame = ref<string | null>(null)
export const view = ref<'library' | 'clips' | 'settings'>('library')

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

export interface GameSummary {
  name: string
  count: number
  cover: string
  latestMs: number
  totalDuration: number
  totalSize: number
}

export const games = computed<GameSummary[]>(() => {
  const map = new Map<string, GameSummary & { coverMs: number }>()
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
        coverMs: -1,
      }
      map.set(c.game, g)
    }
    g.count++
    g.totalDuration += c.duration
    g.totalSize += c.size
    if (c.recordedAtMs > g.latestMs) g.latestMs = c.recordedAtMs
    if (c.thumb && c.recordedAtMs > g.coverMs) {
      g.cover = c.thumb
      g.coverMs = c.recordedAtMs
    }
  }
  return [...map.values()].sort((a, b) => b.latestMs - a.latestMs)
})

function compare(sort: Settings['sort']): (a: Clip, b: Clip) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => a.recordedAtMs - b.recordedAtMs || a.name.localeCompare(b.name)
    case 'name':
      return (a, b) => a.title.localeCompare(b.title) || a.recordedAtMs - b.recordedAtMs
    case 'duration':
      return (a, b) => b.duration - a.duration || b.recordedAtMs - a.recordedAtMs
    case 'size':
      return (a, b) => b.size - a.size || b.recordedAtMs - a.recordedAtMs
    default:
      return (a, b) => b.recordedAtMs - a.recordedAtMs || a.name.localeCompare(b.name)
  }
}

export type ShareFilter = 'all' | 'shared' | 'unshared'

export const SHARE_FILTERS: Array<{ value: ShareFilter; label: string; icon: string }> = [
  { value: 'all', label: 'All', icon: 'i-lucide-layers' },
  { value: 'shared', label: 'On YouTube', icon: 'i-lucide-youtube' },
  { value: 'unshared', label: 'Not shared', icon: 'i-lucide-cloud-off' },
]

/**
 * Narrows both grids to clips that have, or have not, been uploaded to YouTube.
 * View state rather than a setting: a filter left on across launches would look
 * like clips had vanished.
 */
export const shareFilter = ref<ShareFilter>('all')

const matchesShare = (c: Clip): boolean =>
  shareFilter.value === 'all' || (shareFilter.value === 'shared') === Boolean(c.youtubeId)

/** Letters and digits only, so "lords of the fallen" finds "LordsOfTheFallen_2026". */
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Narrows a game's grid by title. View state like `shareFilter`: it resets
 * whenever you step into or out of a game, so a filter never outlives the
 * screen it was typed on.
 */
export const clipQuery = ref('')
/** The same for the Clips view; cleared each time the view is opened. */
export const exportQuery = ref('')

/** Title match for a query already lower-cased (`q`) and squashed (`qs`). */
const matchesQuery = (c: Clip, q: string, qs: string): boolean =>
  !q || c.title.toLowerCase().includes(q) || squash(c.title).includes(qs)

export const visibleClips = computed<Clip[]>(() => {
  const game = selectedGame.value
  const q = clipQuery.value.trim().toLowerCase()
  const qs = squash(q)
  const list = recordings.value.filter(
    (c) => (!game || c.game === game) && matchesShare(c) && matchesQuery(c, q, qs),
  )
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

/** The Clips view: one section per game, latest export first, games by their latest export. */
export const clipSections = computed<Section[]>(() => {
  const q = exportQuery.value.trim().toLowerCase()
  const qs = squash(q)
  const list = exportedClips.value.filter((c) => matchesShare(c) && matchesQuery(c, q, qs))
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
      clips: g.clips.sort((a, b) => exportedAt(b) - exportedAt(a) || a.name.localeCompare(b.name)),
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
export const screen = computed<'games' | 'game' | 'clips' | 'settings'>(() => {
  if (view.value !== 'library') return view.value
  return selectedGame.value ? 'game' : 'games'
})

export function goGames(): void {
  selectedGame.value = null
  clipQuery.value = ''
  view.value = 'library'
}

export function openGame(name: string): void {
  selectedGame.value = name
  clipQuery.value = ''
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
  exportQuery.value = ''
  view.value = 'clips'
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

export type PendingKind = 'delete' | 'rename' | 'remove-youtube' | 'copy-file'

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
