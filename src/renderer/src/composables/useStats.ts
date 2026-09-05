import { computed, ref } from 'vue'
import type { AppStats, Clip, LibraryFolder } from '@shared/types'
import { formatResolution, volumeRoot } from '@/utils/format'
import { QUALITY_TIERS, qualityTier } from '@/utils/quality'
import { confirm } from './useDialogs'
import { allClips, exportedClips, getClip, recordings, folders, games, now } from './useLibrary'
import { toast } from './useToasts'

const api = window.api

const MONTHS = 12
const TOP_GAMES = 6
const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'short' })
const monthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

const count = new Intl.NumberFormat()

const clipCount = (clips: number): string => `${count.format(clips)} clip${clips === 1 ? '' : 's'}`

// --------------------------------------------------------- main-process stats

export const appStats = ref<AppStats | null>(null)
export const statsLoading = ref(false)
export const statsError = ref('')

/**
 * Disk usage is measured by walking the app-data folder, so it is pulled on
 * demand (opening the screen, or the refresh button) rather than kept live.
 */
export async function refreshStats(): Promise<void> {
  statsLoading.value = true
  try {
    appStats.value = await api.library.stats()
    statsError.value = ''
  } catch (err) {
    statsError.value = (err as Error).message || 'Could not measure the app data folder.'
  } finally {
    statsLoading.value = false
  }
}

export async function revealAppData(): Promise<void> {
  const res = await api.library.revealData()
  if (!res.ok) toast('error', 'Could not open the folder', res.error)
}

/** Empties the preview cache after a confirm; main rebuilds it in the background. */
export async function clearPreviews(): Promise<void> {
  const ok = await confirm({
    title: 'Clear the preview cache?',
    message:
      'Every poster frame and scrub strip is deleted and rebuilt in the background. Cards show placeholders until their previews come back.',
    detailIcon: 'i-lucide-image',
    confirmLabel: 'Clear previews',
    danger: true,
  })
  if (!ok) return
  const res = await api.library.clearPreviews()
  if (!res.ok) {
    toast('error', 'Could not clear the previews', res.error)
    return
  }
  const n = res.files ?? 0
  toast(
    'success',
    'Preview cache cleared',
    `${n} file${n === 1 ? '' : 's'} removed. Previews are being rebuilt.`,
  )
  await refreshStats()
}

// ------------------------------------------------------------ library totals

export interface LibraryTotals {
  clips: number
  games: number
  folders: number
  offlineFolders: number
  bytes: number
  duration: number
  withPreviews: number
  pending: number
  failed: number
  /** Zero when the library is empty. */
  oldestMs: number
  newestMs: number
  avgBytes: number
  avgDuration: number
  /** Bits per second across every probed clip; 0 until something has been probed. */
  avgBitrate: number
  largest: Clip | null
  longest: Clip | null
}

export const libraryTotals = computed<LibraryTotals>(() => {
  const clips = recordings.value
  const t: LibraryTotals = {
    clips: clips.length,
    games: games.value.length,
    folders: folders.value.length,
    offlineFolders: folders.value.filter((f) => !f.available).length,
    bytes: 0,
    duration: 0,
    withPreviews: 0,
    pending: 0,
    failed: 0,
    oldestMs: 0,
    newestMs: 0,
    avgBytes: 0,
    avgDuration: 0,
    avgBitrate: 0,
    largest: null,
    longest: null,
  }
  // Unprobed clips carry no duration, so they sit out of the bitrate average
  // rather than dragging it toward zero.
  let ratedBytes = 0
  let ratedDuration = 0
  for (const c of clips) {
    t.bytes += c.size
    t.duration += c.duration
    if (c.duration > 0) {
      ratedBytes += c.size
      ratedDuration += c.duration
    }
    if (c.thumb) t.withPreviews++
    if (c.probeState === 'pending') t.pending++
    else if (c.probeState === 'failed') t.failed++
    if (!t.oldestMs || c.recordedAtMs < t.oldestMs) t.oldestMs = c.recordedAtMs
    if (c.recordedAtMs > t.newestMs) t.newestMs = c.recordedAtMs
    if (!t.largest || c.size > t.largest.size) t.largest = c
    if (!t.longest || c.duration > t.longest.duration) t.longest = c
  }
  if (clips.length) {
    t.avgBytes = t.bytes / clips.length
    t.avgDuration = t.duration / clips.length
  }
  if (ratedDuration > 0) t.avgBitrate = (ratedBytes * 8) / ratedDuration
  return t
})

// ------------------------------------------------------------------ drives

export interface DriveUsage {
  /** `D:\` — the root as the main process measured it, cased as the OS gave it. */
  root: string
  freeBytes: number
  totalBytes: number
  /** Indexed recordings and exported clips living on this volume. */
  clipBytes: number
  clips: number
  /** Cache, index and Electron data; non-zero only on the drive that holds them. */
  appDataBytes: number
  /** `clipBytes` + `appDataBytes`: everything on this volume that is Sift's doing. */
  siftBytes: number
  /** Watched folders rooted here, in the order the library keeps them. */
  folders: LibraryFolder[]
  /** 0-100, how full the volume is. Zero when the platform would not report it. */
  usedPct: number
  /** 0-100, Sift's share of the whole volume. Never above `usedPct`. */
  siftPct: number
}

/**
 * One row per drive the library touches. Free space comes from the main
 * process — it is the only side that can call `statfs` — while the clip bytes
 * are summed here from the index, so the figure moves with a scan instead of
 * waiting for the next measurement.
 */
export const drives = computed<DriveUsage[]>(() => {
  const storage = appStats.value?.storage
  if (!storage) return []
  const appRoot = storage.appDataRoot.toUpperCase()
  const rows = new Map<string, DriveUsage>()

  for (const v of storage.volumes) {
    rows.set(v.root.toUpperCase(), {
      root: v.root,
      freeBytes: v.freeBytes,
      totalBytes: v.totalBytes,
      clipBytes: 0,
      clips: 0,
      appDataBytes:
        v.root.toUpperCase() === appRoot
          ? storage.databaseBytes + storage.cacheBytes + storage.otherBytes
          : 0,
      siftBytes: 0,
      folders: [],
      usedPct: 0,
      siftPct: 0,
    })
  }
  for (const f of folders.value) rows.get(volumeRoot(f.path).toUpperCase())?.folders.push(f)
  for (const c of allClips.value) {
    const row = rows.get(volumeRoot(c.path).toUpperCase())
    if (!row) continue
    row.clipBytes += c.size
    row.clips++
  }
  for (const row of rows.values()) {
    row.siftBytes = row.clipBytes + row.appDataBytes
    if (!row.totalBytes) continue
    row.usedPct = Math.round(((row.totalBytes - row.freeBytes) / row.totalBytes) * 100)
    // An index that has not caught up with a deletion could otherwise claim
    // more of the drive than the drive says is used at all.
    row.siftPct = Math.min(row.usedPct, (row.siftBytes / row.totalBytes) * 100)
  }
  return [...rows.values()].sort(
    (a, b) => b.siftBytes - a.siftBytes || a.root.localeCompare(b.root),
  )
})

// --------------------------------------------------------- biggest / oldest

const BIGGEST_CLIPS = 5

/** The heaviest files in the index, recordings and exported clips alike. */
export const biggestClips = computed<Clip[]>(() =>
  [...allClips.value]
    .sort((a, b) => b.size - a.size || a.title.localeCompare(b.title))
    .slice(0, BIGGEST_CLIPS),
)

/** The file that has been sitting on the drive longest. */
export const oldestClip = computed<Clip | null>(() => {
  let best: Clip | null = null
  for (const c of allClips.value) if (!best || c.recordedAtMs < best.recordedAtMs) best = c
  return best
})

// ---------------------------------------------------------------- clean-up

/** Footage past this age is old enough to be worth a second look. */
const OLD_MS = 365 * 86_400_000
/** A game with nothing new for this long is one that has been put down. */
const QUIET_MS = 182 * 86_400_000
/** Under this, clearing a hint out would not free enough to be worth the row. */
const HINT_MIN_BYTES = 1024 ** 3
const HINT_MIN_CLIPS = 5
const MAX_HINTS = 6

export type CleanupKind = 'quiet-game' | 'old-footage' | 'duplicate'

export interface CleanupHint {
  id: string
  kind: CleanupKind
  icon: string
  title: string
  detail: string
  /** What reviewing this hint could free. */
  bytes: number
  clips: number
  /** The game the review opens; '' for a hint that opens the Clips view. */
  game: string
}

/**
 * Suggestions, never actions: each row says what it found and hands the user to
 * the grid holding it. Nothing here deletes anything, and a library that is
 * already tidy produces no rows at all.
 */
export const cleanupHints = computed<CleanupHint[]>(() => {
  const stamp = now.value
  const hints: CleanupHint[] = []
  const worthIt = (bytes: number, clips: number): boolean =>
    bytes >= HINT_MIN_BYTES && clips >= HINT_MIN_CLIPS

  interface GameAge {
    bytes: number
    clips: number
    oldBytes: number
    oldClips: number
    latestMs: number
  }
  const byGame = new Map<string, GameAge>()
  for (const c of recordings.value) {
    let g = byGame.get(c.game)
    if (!g) {
      g = { bytes: 0, clips: 0, oldBytes: 0, oldClips: 0, latestMs: 0 }
      byGame.set(c.game, g)
    }
    g.bytes += c.size
    g.clips++
    if (c.recordedAtMs > g.latestMs) g.latestMs = c.recordedAtMs
    if (stamp - c.recordedAtMs > OLD_MS) {
      g.oldBytes += c.size
      g.oldClips++
    }
  }

  for (const [game, g] of byGame) {
    // A game that has been put down is the whole folder's worth, so it stands in
    // for its own old footage rather than earning a second row beside it.
    if (stamp - g.latestMs > QUIET_MS) {
      if (worthIt(g.bytes, g.clips))
        hints.push({
          id: `quiet:${game}`,
          kind: 'quiet-game',
          icon: 'gamepad',
          title: game,
          detail: `${clipCount(g.clips)}, and nothing new since ${monthYear.format(g.latestMs)}.`,
          bytes: g.bytes,
          clips: g.clips,
          game,
        })
      continue
    }
    if (worthIt(g.oldBytes, g.oldClips))
      hints.push({
        id: `old:${game}`,
        kind: 'old-footage',
        icon: 'history',
        title: `Old ${game} footage`,
        detail: `${clipCount(g.oldClips)} recorded over a year ago, in a game you still play.`,
        bytes: g.oldBytes,
        clips: g.oldClips,
        game,
      })
  }

  // An export whose source recording is still indexed: the same moment kept
  // twice, and the full recording is the heavy half.
  let dupBytes = 0
  const seen = new Set<string>()
  for (const c of exportedClips.value) {
    if (!c.sourceId || seen.has(c.sourceId)) continue
    const src = getClip(c.sourceId)
    if (!src) continue
    seen.add(c.sourceId)
    dupBytes += src.size
  }
  if (dupBytes >= HINT_MIN_BYTES)
    hints.push({
      id: 'duplicate',
      kind: 'duplicate',
      icon: 'copy',
      title: 'Recordings you have already trimmed',
      detail: `${clipCount(seen.size)} still indexed beside the clips cut out of them.`,
      bytes: dupBytes,
      clips: seen.size,
      game: '',
    })

  return hints.sort((a, b) => b.bytes - a.bytes).slice(0, MAX_HINTS)
})

/** Everything the hints together point at — the panel's headline figure. */
export const cleanupBytes = computed(() => cleanupHints.value.reduce((sum, h) => sum + h.bytes, 0))

// --------------------------------------------------------------- breakdowns

export interface Breakdown {
  key: string
  label: string
  count: number
  bytes: number
  /** 0–1 against the largest row, i.e. the width of its bar. */
  share: number
}

function ranked(
  rows: Map<string, { label: string; count: number; bytes: number }>,
  by: 'bytes' | 'count',
): Breakdown[] {
  const list = [...rows.entries()].map(([key, r]) => ({ key, ...r, share: 0 }))
  list.sort((a, b) => b[by] - a[by] || a.label.localeCompare(b.label))
  const top = list[0]?.[by] ?? 0
  if (top) for (const r of list) r.share = r[by] / top
  return list
}

export const topGames = computed<Breakdown[]>(() => {
  const rows = new Map<string, { label: string; count: number; bytes: number }>()
  for (const g of games.value)
    rows.set(g.name, { label: g.name, count: g.count, bytes: g.totalSize })
  return ranked(rows, 'bytes').slice(0, TOP_GAMES)
})

export const resolutions = computed<Breakdown[]>(() => {
  const rows = new Map<string, { label: string; count: number; bytes: number }>()
  for (const c of recordings.value) {
    const label = formatResolution(c.width, c.height, 0) || 'Unknown'
    const row = rows.get(label) ?? { label, count: 0, bytes: 0 }
    row.count++
    row.bytes += c.size
    rows.set(label, row)
  }
  return ranked(rows, 'count')
})

export const codecs = computed<Breakdown[]>(() => {
  const rows = new Map<string, { label: string; count: number; bytes: number }>()
  for (const c of recordings.value) {
    const label = c.vcodec ? c.vcodec.toUpperCase() : 'Unknown'
    const row = rows.get(label) ?? { label, count: 0, bytes: 0 }
    row.count++
    row.bytes += c.size
    rows.set(label, row)
  }
  return ranked(rows, 'count')
})

/**
 * Clips bucketed by bitrate density rather than raw bitrate, so a 4K clip and
 * a 1080p one can share a bucket. Ordered along the quality scale instead of
 * by size, with anything unprobed last.
 */
export const bitrateTiers = computed<Breakdown[]>(() => {
  const rows = new Map<string, { label: string; count: number; bytes: number }>()
  for (const c of recordings.value) {
    const tier = qualityTier(c)
    const row = rows.get(tier.id) ?? { label: tier.label, count: 0, bytes: 0 }
    row.count++
    row.bytes += c.size
    rows.set(tier.id, row)
  }
  const order: string[] = QUALITY_TIERS.map((t) => t.id)
  const rank = (key: string): number => {
    const i = order.indexOf(key)
    return i < 0 ? order.length : i
  }
  return ranked(rows, 'count').sort((a, b) => rank(a.key) - rank(b.key))
})

export interface MonthBar {
  key: string
  label: string
  /** Rendered as the column title, e.g. "March 2026". */
  title: string
  count: number
  bytes: number
  share: number
}

/** Clips recorded per month over the last year — the activity chart. */
export const monthlyActivity = computed<MonthBar[]>(() => {
  const end = new Date(now.value)
  const bars: MonthBar[] = []
  const index = new Map<string, MonthBar>()
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const bar: MonthBar = {
      key,
      label: monthLabel.format(d),
      title: `${monthLabel.format(d)} ${d.getFullYear()}`,
      count: 0,
      bytes: 0,
      share: 0,
    }
    bars.push(bar)
    index.set(key, bar)
  }
  for (const c of recordings.value) {
    const d = new Date(c.recordedAtMs)
    const bar = index.get(`${d.getFullYear()}-${d.getMonth()}`)
    if (!bar) continue
    bar.count++
    bar.bytes += c.size
  }
  const peak = bars.reduce((m, b) => Math.max(m, b.count), 0)
  if (peak) for (const b of bars) b.share = b.count / peak
  return bars
})
