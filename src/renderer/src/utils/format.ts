export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

/**
 * Coarse label for a total (library playtime, app uptime) rather than a
 * timecode: `formatDuration` would render a year of clips as "412:07:44".
 */
export function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return '0m'
  const total = Math.round(seconds)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m`
  return `${total}s`
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / 1024 ** i
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/**
 * Standard classes, tallest first. A capture rarely matches one exactly — a
 * borderless window loses a title bar, an ultrawide grab is its own shape — so
 * a clip claims a tier once it is within `TIER_SLACK` of it. Without that
 * slack a 2560x1070 ShadowPlay grab sits 1% under 1080 and falls two whole
 * tiers, reading as "720p".
 */
const RES_TIERS: Array<{ min: number; label: string }> = [
  { min: 2160, label: '4K' },
  { min: 1440, label: '1440p' },
  { min: 1080, label: '1080p' },
  { min: 720, label: '720p' },
]
const TIER_SLACK = 0.9

export function formatResolution(width: number, height: number, fps: number): string {
  if (!height) return ''
  // The shorter side is what the "p" number names, which keeps both ultrawide
  // and portrait captures in the class they belong to.
  const side = width ? Math.min(width, height) : height
  const tier = RES_TIERS.find((t) => side >= t.min * TIER_SLACK)
  const label = tier ? tier.label : `${side}p`
  const rate = fps ? Math.round(fps) : 0
  return rate ? `${label}${rate}` : label
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const fullFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long' })
const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

export function formatRelative(ms: number, now = Date.now()): string {
  const diff = now - ms
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.round(diff / 3_600_000)
  if (hours < 24) return rtf.format(-hours, 'hour')
  const days = Math.round(diff / 86_400_000)
  if (days < 7) return `${rtf.format(-days, 'day')} · ${timeFmt.format(ms)}`
  return `${dateFmt.format(ms)} · ${timeFmt.format(ms)}`
}

export function formatFull(ms: number): string {
  return fullFmt.format(ms)
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Bucket used for the date-grouped grid. Sort key descends with recency. */
export function dateBucket(
  ms: number,
  now = Date.now(),
): { key: string; title: string; order: number } {
  const day = startOfDay(ms)
  const today = startOfDay(now)
  const days = Math.round((today - day) / 86_400_000)
  if (days <= 0) return { key: 'today', title: 'Today', order: 0 }
  if (days === 1) return { key: 'yesterday', title: 'Yesterday', order: 1 }
  if (days < 7) return { key: 'week', title: 'This week', order: 2 }
  if (days < 31) return { key: 'month', title: 'This month', order: 3 }
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const key = `${d.getFullYear()}-${d.getMonth()}`
  return {
    key,
    title: sameYear ? monthFmt.format(ms) : monthYearFmt.format(ms),
    order: 1_000_000 - (d.getFullYear() * 12 + d.getMonth()),
  }
}

/** Last segment of a Windows or POSIX path; the path itself when it has none. */
export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** Everything before the last segment; the path itself when it has no separator. */
export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : path
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Where a pointer sits along an element, 0 at its left edge and 1 at its right. */
export function fractionAcross(el: HTMLElement, clientX: number): number {
  const r = el.getBoundingClientRect()
  return r.width ? clamp((clientX - r.left) / r.width, 0, 1) : 0
}

/** Timecode with tenths, for trim points where whole seconds are too coarse: `1:07.5`. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const whole = Math.floor(seconds)
  const tenths = Math.floor((seconds - whole) * 10)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}.${tenths}`
}
