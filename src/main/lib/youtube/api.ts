/**
 * A thin typed layer over the YouTube Data API v3. Electron-free.
 *
 * Every request goes through `ytRequest`: bearer token, one silent token
 * refresh on a 401, Google's error JSON turned into a `YouTubeApiError` with
 * its `reason`.
 */

import type {
  RawVideoStatus,
  YouTubeChannel,
  YouTubePlaylist,
  YouTubePrivacy,
} from '@shared/youtube'
import { VIDEOS_PER_CALL, YOUTUBE_PRIVACIES } from '@shared/youtube'
import { OAuthError } from './oauth'

export const API = 'https://www.googleapis.com/youtube/v3'
const HTTP_TIMEOUT_MS = 30_000
const AVATAR_MAX_BYTES = 256 * 1024

export interface TokenSource {
  /** A valid access token; `force` skips the cache after a 401. */
  accessToken(force?: boolean): Promise<string>
}

export interface ApiContext {
  auth: TokenSource
  signal?: AbortSignal
}

export class YouTubeApiError extends Error {
  constructor(
    readonly status: number,
    /** Google's `errors[0].reason` or `error.status`, e.g. `quotaExceeded`; '' when unknown. */
    readonly reason: string,
    message: string,
  ) {
    super(message)
    this.name = 'YouTubeApiError'
  }
}

interface GoogleErrorJson {
  error?: {
    code?: number
    message?: string
    status?: string
    errors?: Array<{ reason?: string; message?: string }>
    details?: Array<{ reason?: string; metadata?: Record<string, string> }>
  }
}

/** Builds the typed error for a non-2xx response, reading Google's JSON body when there is one. */
export async function errorFrom(res: Response): Promise<YouTubeApiError> {
  const json = (await res.json().catch(() => ({}))) as GoogleErrorJson
  const e = json.error
  // The ErrorInfo detail (SERVICE_DISABLED, ACCESS_TOKEN_SCOPE_INSUFFICIENT, ...) is the
  // specific reason; the legacy `errors[0].reason` is usually just "forbidden".
  const reason =
    e?.details?.find((d) => d.reason)?.reason ?? e?.errors?.[0]?.reason ?? e?.status ?? ''
  return new YouTubeApiError(res.status, reason, e?.message ?? `YouTube answered ${res.status}.`)
}

function timeoutSignal(signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(HTTP_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, t]) : t
}

/**
 * Sends one request with a bearer token. A 401 refreshes the token and retries
 * once; every other non-2xx answer becomes a `YouTubeApiError`. Network
 * failures surface as a `YouTubeApiError` with status 0.
 */
export async function ytRequest(
  ctx: ApiContext,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let token = await ctx.auth.accessToken()
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        signal: timeoutSignal(ctx.signal),
      })
    } catch (err) {
      if (ctx.signal?.aborted) throw err
      throw new YouTubeApiError(0, 'network', 'Could not reach YouTube. Check your connection.')
    }
    if (res.status === 401 && attempt === 0) {
      token = await ctx.auth.accessToken(true)
      continue
    }
    if (!res.ok) throw await errorFrom(res)
    return res
  }
}

export async function ytJson<T>(ctx: ApiContext, url: string, init: RequestInit): Promise<T> {
  const res = await ytRequest(ctx, url, init)
  return (await res.json()) as T
}

export const isQuotaExceeded = (err: unknown): boolean =>
  err instanceof YouTubeApiError &&
  (err.reason === 'quotaExceeded' || err.reason === 'RESOURCE_EXHAUSTED')

/** One sentence a user can act on, for any error the module throws. */
export function friendlyError(err: unknown, project = 'This project'): string {
  if (err instanceof OAuthError) {
    switch (err.code) {
      case 'invalid_grant':
        return `${project}'s YouTube access expired or was revoked. Reconnect it under Settings → YouTube.`
      case 'invalid_client':
      case 'unauthorized_client':
        return `Google rejected ${project}'s client ID or secret. Import its JSON again.`
      case 'network':
        return err.message
      default:
        return err.message
    }
  }
  if (err instanceof YouTubeApiError) {
    switch (err.reason) {
      case 'quotaExceeded':
      case 'RESOURCE_EXHAUSTED':
        return `${project} has used up today's YouTube API quota. It resets at midnight Pacific time.`
      case 'uploadLimitExceeded':
        return 'YouTube says this channel has hit its daily upload limit.'
      case 'forbidden':
      case 'insufficientPermissions':
      case 'PERMISSION_DENIED':
        return `Sift was not granted the YouTube permission for ${project}. Disconnect and connect it again.`
      case 'youtubeSignupRequired':
        return 'This Google account has no YouTube channel.'
      case 'network':
        return err.message
      default:
        return err.message || `YouTube answered ${err.status}.`
    }
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError')
      return 'YouTube stopped responding. Check your connection and try again.'
    return err.message
  }
  return 'Something went wrong talking to YouTube.'
}

// ------------------------------------------------------------------ channel

interface ChannelListJson {
  items?: Array<{
    id: string
    snippet?: { title?: string; thumbnails?: { default?: { url?: string } } }
  }>
}

/** The signed-in account's channel; `avatarUrl` is a `yt3.ggpht.com` URL to fetch separately. */
export async function myChannel(
  ctx: ApiContext,
): Promise<Omit<YouTubeChannel, 'avatar'> & { avatarUrl: string }> {
  const json = await ytJson<ChannelListJson>(ctx, `${API}/channels?part=snippet&mine=true`, {
    method: 'GET',
  })
  const c = json.items?.[0]
  if (!c)
    throw new YouTubeApiError(
      404,
      'youtubeSignupRequired',
      'This Google account has no YouTube channel.',
    )
  return {
    id: c.id,
    title: c.snippet?.title ?? 'YouTube channel',
    avatarUrl: c.snippet?.thumbnails?.default?.url ?? '',
  }
}

/**
 * The renderer's CSP allows `data:` images but no remote hosts, so the avatar
 * is fetched here and handed over inline. Any failure yields '' — the pane
 * falls back to initials.
 */
export async function fetchAvatarDataUrl(url: string, signal?: AbortSignal): Promise<string> {
  if (!/^https:\/\/[a-z0-9.-]+\.(ggpht|googleusercontent)\.com\//.test(url)) return ''
  try {
    const res = await fetch(url, { signal: timeoutSignal(signal) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.startsWith('image/')) return ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > AVATAR_MAX_BYTES) return ''
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}

// ------------------------------------------------------------------- videos

/**
 * Deletes a video the signed-in channel owns. Permanent on YouTube's side.
 * Resolves true when it is gone (deleted now, or already absent); throws when
 * this channel does not own it, so the caller can try another project.
 */
export async function deleteVideo(ctx: ApiContext, videoId: string): Promise<boolean> {
  try {
    await ytRequest(ctx, `${API}/videos?id=${encodeURIComponent(videoId)}`, {
      method: 'DELETE',
    })
    return true
  } catch (err) {
    if (err instanceof YouTubeApiError && err.status === 404) return true
    throw err
  }
}

interface VideoStatusListJson {
  items?: Array<{
    id?: string
    status?: Record<string, unknown>
    processingDetails?: {
      processingStatus?: string
      processingFailureReason?: string
      processingProgress?: { partsTotal?: string; partsProcessed?: string; timeLeftMs?: string }
    }
  }>
}

/**
 * What YouTube has done with videos this channel owns, keyed by video id. Ids
 * that come back missing are gone from the channel.
 *
 * One quota unit per call whatever the part list or the number of ids — which
 * is why the watcher batches up to `VIDEOS_PER_CALL` ids and groups them by
 * project. Grouping is not only thrift: `status` and `processingDetails` are
 * only returned to the owner's token, and each project is its own quota bucket.
 */
export async function listVideoStatus(
  ctx: ApiContext,
  ids: readonly string[],
): Promise<Map<string, RawVideoStatus>> {
  const out = new Map<string, RawVideoStatus>()
  if (!ids.length) return out
  const u = new URL(`${API}/videos`)
  u.searchParams.set('part', 'status,processingDetails')
  u.searchParams.set('id', ids.join(','))
  u.searchParams.set('maxResults', String(VIDEOS_PER_CALL))
  const json = await ytJson<VideoStatusListJson>(ctx, u.toString(), { method: 'GET' })
  for (const item of json.items ?? []) {
    if (!item.id) continue
    const s = (item.status ?? {}) as Record<string, string | undefined>
    const d = item.processingDetails ?? {}
    out.set(item.id, {
      uploadStatus: s.uploadStatus,
      failureReason: s.failureReason,
      rejectionReason: s.rejectionReason,
      privacyStatus: s.privacyStatus,
      processingStatus: d.processingStatus,
      processingFailureReason: d.processingFailureReason,
      partsTotal: d.processingProgress?.partsTotal,
      partsProcessed: d.processingProgress?.partsProcessed,
      timeLeftMs: d.processingProgress?.timeLeftMs,
    })
  }
  return out
}

// ---------------------------------------------------------------- playlists

interface PlaylistJson {
  id: string
  snippet?: { title?: string }
  status?: { privacyStatus?: string }
  contentDetails?: { itemCount?: number }
}
interface PlaylistListJson {
  items?: PlaylistJson[]
  nextPageToken?: string
}

const toPrivacy = (v: string | undefined): YouTubePrivacy =>
  YOUTUBE_PRIVACIES.includes(v as YouTubePrivacy) ? (v as YouTubePrivacy) : 'private'

const toPlaylist = (p: PlaylistJson): YouTubePlaylist => ({
  id: p.id,
  title: p.snippet?.title ?? 'Untitled playlist',
  itemCount: p.contentDetails?.itemCount ?? 0,
  privacy: toPrivacy(p.status?.privacyStatus),
})

/** Every playlist the channel owns; one unit per page of 50. */
export async function listPlaylists(ctx: ApiContext): Promise<YouTubePlaylist[]> {
  const out: YouTubePlaylist[] = []
  let pageToken = ''
  do {
    const u = new URL(`${API}/playlists`)
    u.searchParams.set('part', 'snippet,status,contentDetails')
    u.searchParams.set('mine', 'true')
    u.searchParams.set('maxResults', '50')
    if (pageToken) u.searchParams.set('pageToken', pageToken)
    const json = await ytJson<PlaylistListJson>(ctx, u.toString(), { method: 'GET' })
    for (const p of json.items ?? []) out.push(toPlaylist(p))
    pageToken = json.nextPageToken ?? ''
  } while (pageToken)
  return out
}

export async function createPlaylist(
  ctx: ApiContext,
  title: string,
  privacy: YouTubePrivacy,
): Promise<YouTubePlaylist> {
  const json = await ytJson<PlaylistJson>(
    ctx,
    `${API}/playlists?part=snippet,status,contentDetails`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ snippet: { title }, status: { privacyStatus: privacy } }),
    },
  )
  return toPlaylist(json)
}

export async function addToPlaylist(
  ctx: ApiContext,
  playlistId: string,
  videoId: string,
): Promise<void> {
  await ytRequest(ctx, `${API}/playlistItems?part=snippet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
    }),
  })
}
