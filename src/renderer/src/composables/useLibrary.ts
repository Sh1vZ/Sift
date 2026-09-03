import { computed, ref, watch } from 'vue'
import type { Clip, ExportJob, LibraryFolder, ScanState, Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
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
window.setInterval(() => (now.value = Date.now()), 60_000)

/** Every record in the index: recordings and exported clips alike. */
export const allClips = computed<Clip[]>(() => {
  void version.value
  return Array.from(clipsById.values())
})

// ------------------------------------------------------ recordings vs clips

/** The folder Sift exports into. Always present once the snapshot has loaded. */
export const clipsFolder = computed<LibraryFolder | null>(() => folders.value.find((f) => f.kind === 'clips') ?? null)
const exportFolderIds = computed(() => new Set(folders.value.filter((f) => f.kind === 'clips').map((f) => f.id)))

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
      g = { name: c.game, count: 0, cover: '', latestMs: 0, totalDuration: 0, totalSize: 0, coverMs: -1 }
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

export const visibleClips = computed<Clip[]>(() => {
  const game = selectedGame.value
  const list = game ? recordings.value.filter((c) => c.game === game) : recordings.value.slice()
  return list.sort(compare(settings.value.sort))
})

export interface Section {
  key: string
  /** Null renders the clips without a header. */
  title: string | null
  clips: Clip[]
}

/** Grouping applied inside a game's grid. Anything unexpected in a stored setting falls back to date. */
export const gridGroupBy = computed<'date' | 'none'>(() =>
  settings.value.groupBy === 'none' ? 'none' : 'date'
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
  const list = exportedClips.value
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
      clips: g.clips.sort((a, b) => exportedAt(b) - exportedAt(a) || a.name.localeCompare(b.name))
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
  view.value = 'library'
}

export function openGame(name: string): void {
  selectedGame.value = name
  view.value = 'library'
}

export function goClips(): void {
  view.value = 'clips'
}

// ---------------------------------------------------------- games browser

export type GameSort = 'recent' | 'name' | 'count'
export const gameQuery = ref('')
export const gameSort = ref<GameSort>('recent')

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

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

// If the selected game vanishes (folder removed, last clip deleted) fall back to All.
watch(games, (list) => {
  if (selectedGame.value && !list.some((g) => g.name === selectedGame.value)) selectedGame.value = null
})

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

export async function removeFolder(folder: LibraryFolder): Promise<void> {
  const res = await api.library.removeFolder(folder.id)
  if (!res.ok) toast('error', 'Could not remove folder', res.error)
  else toast('info', 'Folder removed', `${folder.name} is no longer indexed. Files were left untouched.`)
}

export async function rescan(folderId?: string): Promise<void> {
  await api.library.rescan(folderId)
}

/** Moving the clips folder only moves the index; files stay where they were exported. */
async function confirmClipsMove(): Promise<boolean> {
  if (!exportedClips.value.length) return true
  return confirm({
    title: 'Change the clips folder?',
    message: 'Clips already exported stay on disk where they are, but they leave the Clips list. New exports go to the folder you pick.',
    detail: clipsFolder.value?.path,
    detailIcon: 'i-lucide-folder-output',
    confirmLabel: 'Choose folder'
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

export async function renameClip(clip: Clip, name: string): Promise<Clip | null> {
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
}

export async function deleteClip(clip: Clip, permanent = false): Promise<boolean> {
  const res = await api.clips.delete(clip.id, permanent)
  if (!res.ok) {
    toast('error', 'Delete failed', res.error)
    return false
  }
  clipsById.delete(clip.id)
  version.value++
  toast('success', permanent ? 'Deleted permanently' : 'Moved to Recycle Bin', clip.name + clip.ext)
  return true
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
