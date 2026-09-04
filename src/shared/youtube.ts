/**
 * YouTube upload types and pure helpers, shared by main and the renderer.
 * Electron-free on purpose so `npm test` can import it.
 */

export type YouTubePrivacy = 'public' | 'unlisted' | 'private'
export const YOUTUBE_PRIVACIES: readonly YouTubePrivacy[] = ['public', 'unlisted', 'private']

/**
 * disconnected: client saved, no usable token · connecting: the browser
 * round-trip is open · connected: refresh token stored and last seen good.
 */
export type YouTubeConnection = 'disconnected' | 'connecting' | 'connected'

export interface YouTubeChannel {
  id: string
  title: string
  /** `data:image/...` URL fetched in main so the renderer CSP img-src stays as it is; '' when unavailable. */
  avatar: string
}

export interface YouTubePlaylist {
  id: string
  title: string
  itemCount: number
  privacy: YouTubePrivacy
}

/** One Google Cloud project = one OAuth client = one daily quota bucket. */
export interface YouTubeAccount {
  /** Random 8 chars. */
  id: string
  /** project_id from the JSON, else what the user typed; editable. */
  label: string
  /** From the JSON; '' when pasted by hand. Used for console links. */
  projectId: string
  /** Not secret. */
  clientId: string
  hasSecret: boolean
  connection: YouTubeConnection
  channel: YouTubeChannel | null
  /** Last connect / refresh / playlist failure; ''. */
  error: string
  /**
   * Set when YouTube answered `quotaExceeded` today: no uploads go through
   * this project until then (midnight Pacific). 0 otherwise. Google does not
   * expose usage to apps without a billing account, so this answer is the one
   * quota signal Sift has — it never counts on its own.
   */
  quotaExhaustedUntilMs: number
  addedAtMs: number
}

export interface YouTubeState {
  accounts: YouTubeAccount[]
  /** `safeStorage.isEncryptionAvailable()`; false → secrets live in memory until quit. */
  encryptionAvailable: boolean
}

export const IDLE_YOUTUBE_STATE: YouTubeState = { accounts: [], encryptionAvailable: true }

export const isExhausted = (a: YouTubeAccount, nowMs = Date.now()): boolean =>
  a.quotaExhaustedUntilMs > nowMs

/** What the dialog asks for. Validated again in main; never trusted as-is. */
export interface UploadRequest {
  clipId: string
  title: string
  description: string
  tags: string[]
  privacy: YouTubePrivacy
  /** '' for no playlist. */
  playlistId: string
  madeForKids: boolean
  /** '' = Auto: the first connected project that is not out of quota. */
  accountId: string
}

export type UploadState = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled'

export interface UploadJob {
  id: string
  clipId: string
  /** Card facts frozen at enqueue so the job can render after the clip is gone. */
  clipTitle: string
  thumb: string
  game: string
  size: number
  title: string
  privacy: YouTubePrivacy
  playlistId: string
  playlistTitle: string
  /** Account actually used, resolved when the job starts; '' while queued under Auto. */
  accountId: string
  accountLabel: string
  channelTitle: string
  state: UploadState
  /** 0..1 */
  progress: number
  bytesSent: number
  bytesPerSecond: number
  /** Set once YouTube returns the video resource. */
  videoId: string
  /** YouTube returned a stricter privacyStatus than requested (unverified project). */
  privacyDowngraded: boolean
  /** Set when the upload succeeded but playlistItems.insert did not. */
  playlistError: string
  error: string
  createdAtMs: number
}

/** Google's published figures, for the explanatory copy only; Sift does not count quota. */
export const QUOTA_UNITS_PER_DAY = 10_000
export const QUOTA_COST = { videosInsert: 1600, playlistItemsInsert: 50 } as const

export const YOUTUBE_LIMITS = { title: 100, description: 5000, tagsTotal: 500 } as const
export const YOUTUBE_CATEGORY_GAMING = '20'

/** Upload + playlists. `youtube.upload` alone cannot list or fill playlists. */
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube'
export const OAUTH_SCOPES: readonly string[] = [YOUTUBE_SCOPE]

export const YOUTUBE_AUDIT_FORM_URL = 'https://support.google.com/youtube/contact/yt_api_form'
export const GOOGLE_CONSOLE_URL = 'https://console.cloud.google.com/'
export const GOOGLE_CONSOLE_CREDENTIALS_URL = 'https://console.cloud.google.com/apis/credentials'
export const GOOGLE_CONSOLE_CONSENT_URL = 'https://console.cloud.google.com/auth/overview'
export const GOOGLE_CONSOLE_YOUTUBE_API_URL =
  'https://console.cloud.google.com/apis/library/youtube.googleapis.com'
/** The console's Quotas & System Limits page, the one place Google shows live usage for a free project. */
export const GOOGLE_CONSOLE_QUOTAS_URL = 'https://console.cloud.google.com/iam-admin/quotas'

export const youtubeUrl = (videoId: string): string => `https://youtu.be/${videoId}`

/** YouTube video ids are 11 URL-safe base64 characters. */
export const VIDEO_ID = /^[\w-]{11}$/

/** YouTube counts a tag with a space as quoted, so it costs two extra characters. */
export function tagsLength(tags: string[]): number {
  return tags.reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0), 0)
}

/** Error message, or null when the request is acceptable. Used live by the dialog and again in main. */
export function validateUploadRequest(req: UploadRequest): string | null {
  const title = req.title.trim()
  if (!title) return 'Give the video a title.'
  if (title.length > YOUTUBE_LIMITS.title)
    return `Titles can be at most ${YOUTUBE_LIMITS.title} characters.`
  if (/[<>]/.test(title)) return 'YouTube does not allow < or > in a title.'
  if (req.description.length > YOUTUBE_LIMITS.description)
    return `Descriptions can be at most ${YOUTUBE_LIMITS.description} characters.`
  if (/[<>]/.test(req.description)) return 'YouTube does not allow < or > in a description.'
  if (req.tags.some((t) => !t.trim())) return 'Tags cannot be empty.'
  if (tagsLength(req.tags) > YOUTUBE_LIMITS.tagsTotal)
    return `Tags can add up to at most ${YOUTUBE_LIMITS.tagsTotal} characters.`
  if (!YOUTUBE_PRIVACIES.includes(req.privacy)) return 'Pick a privacy setting.'
  return null
}

export interface ClientSecret {
  clientId: string
  clientSecret: string
  projectId: string
  /** Desktop-app clients are `installed`; `web` clients also work with a loopback redirect. */
  kind: 'installed' | 'web'
}

/** Reads Google's `client_secret_*.json`. Null when the text is not one. */
export function parseClientSecretJson(text: string): ClientSecret | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const root = raw as Record<string, unknown>
  const kind: ClientSecret['kind'] | null = root.installed ? 'installed' : root.web ? 'web' : null
  if (!kind) return null
  const body = root[kind]
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const clientId = typeof b.client_id === 'string' ? b.client_id.trim() : ''
  const clientSecret = typeof b.client_secret === 'string' ? b.client_secret.trim() : ''
  const projectId = typeof b.project_id === 'string' ? b.project_id.trim() : ''
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, projectId, kind }
}

export const isClientId = (id: string): boolean => id.endsWith('.apps.googleusercontent.com')

// ------------------------------------------------------------- Pacific day
// Google resets YouTube quota at midnight Pacific, DST included.

const PACIFIC = 'America/Los_Angeles'
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** 'YYYY-MM-DD' in America/Los_Angeles: Google's quota day. */
export function pacificDayKey(nowMs: number): string {
  return dayFormat.format(new Date(nowMs))
}

/** Offset of Pacific time from UTC at `ms`, in minutes (e.g. -420 in summer). */
function pacificOffsetMinutes(ms: number): number {
  const p: Record<string, number> = {}
  for (const part of partsFormat.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000)
}

/** The moment today's Pacific day ends, when the quota counter resets. */
export function nextPacificMidnightMs(nowMs: number): number {
  const [y, m, d] = pacificDayKey(nowMs).split('-').map(Number)
  // Midnight of the next Pacific date, first as if Pacific were UTC, then shifted
  // by the offset in force at that moment (DST may flip between now and then).
  const naive = Date.UTC(y, m - 1, d + 1)
  let guess = naive - pacificOffsetMinutes(nowMs) * 60_000
  guess = naive - pacificOffsetMinutes(guess) * 60_000
  return guess
}

/** "5 h 12 min" / "40 min" until `atMs`; "now" once it has passed. */
export function formatUntil(atMs: number, nowMs = Date.now()): string {
  const mins = Math.round((atMs - nowMs) / 60_000)
  if (mins <= 0) return 'now'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
