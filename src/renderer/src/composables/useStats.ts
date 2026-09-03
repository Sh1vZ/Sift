import { computed, ref } from 'vue'
import type { AppStats, Clip } from '@shared/types'
import { formatResolution } from '@/utils/format'
import { QUALITY_TIERS, qualityTier } from '@/utils/quality'
import { allClips, folders, games, now } from './useLibrary'
import { toast } from './useToasts'

const api = window.api

const MONTHS = 12
const TOP_GAMES = 6
const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'short' })

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
  const clips = allClips.value
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
    longest: null
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

// --------------------------------------------------------------- breakdowns

export interface Breakdown {
  key: string
  label: string
  count: number
  bytes: number
  /** 0–1 against the largest row, i.e. the width of its bar. */
  share: number
}

function ranked(rows: Map<string, { label: string; count: number; bytes: number }>, by: 'bytes' | 'count'): Breakdown[] {
  const list = [...rows.entries()].map(([key, r]) => ({ key, ...r, share: 0 }))
  list.sort((a, b) => b[by] - a[by] || a.label.localeCompare(b.label))
  const top = list[0]?.[by] ?? 0
  if (top) for (const r of list) r.share = r[by] / top
  return list
}

export const topGames = computed<Breakdown[]>(() => {
  const rows = new Map<string, { label: string; count: number; bytes: number }>()
  for (const g of games.value) rows.set(g.name, { label: g.name, count: g.count, bytes: g.totalSize })
  return ranked(rows, 'bytes').slice(0, TOP_GAMES)
})

export const resolutions = computed<Breakdown[]>(() => {
  const rows = new Map<string, { label: string; count: number; bytes: number }>()
  for (const c of allClips.value) {
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
  for (const c of allClips.value) {
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
  for (const c of allClips.value) {
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
      share: 0
    }
    bars.push(bar)
    index.set(key, bar)
  }
  for (const c of allClips.value) {
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
