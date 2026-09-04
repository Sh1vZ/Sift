/**
 * YouTube's resumable upload protocol, Electron-free.
 *
 * One POST creates a session and returns its URI; the file then goes up in
 * PUTs of `CHUNK_BYTES`, each answered with 308 and a `Range` header saying how
 * much YouTube has kept. A dropped connection, a 5xx or a stall is answered by
 * asking the session where it stands (a zero-length PUT with an open-ended
 * Content-Range) and carrying on from there, so a wobbly connection costs a
 * retry, not a restart.
 */

import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { YOUTUBE_CATEGORY_GAMING, type YouTubePrivacy } from '@shared/youtube'
import { errorFrom, ytRequest, YouTubeApiError, type ApiContext } from './api'

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'
/** A multiple of 256 KiB, as the protocol requires. */
export const CHUNK_BYTES = 8 * 1024 * 1024
const MAX_ATTEMPTS = 8
/** No bytes leaving the disk for this long means the socket is wedged, not slow. */
const STALL_MS = 60_000
const QUERY_TIMEOUT_MS = 30_000

export interface UploadSource {
  path: string
  size: number
  mimeType: string
}

export interface VideoInsertBody {
  snippet: { title: string; description: string; tags: string[]; categoryId: string }
  status: { privacyStatus: YouTubePrivacy; selfDeclaredMadeForKids: boolean }
}

export interface VideoResource {
  id: string
  status?: { privacyStatus?: string; uploadStatus?: string }
}

export function insertBody(o: {
  title: string
  description: string
  tags: string[]
  privacy: YouTubePrivacy
  madeForKids: boolean
}): VideoInsertBody {
  return {
    snippet: {
      title: o.title,
      description: o.description,
      tags: o.tags,
      categoryId: YOUTUBE_CATEGORY_GAMING,
    },
    status: { privacyStatus: o.privacy, selfDeclaredMadeForKids: o.madeForKids },
  }
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
}

export function mimeFor(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}

/** `Range: bytes=0-8388607` → 8388607. -1 when YouTube kept nothing (header absent). */
export function parseRangeEnd(header: string | null): number {
  const m = header && /bytes=0-(\d+)/.exec(header)
  return m ? Number(m[1]) : -1
}

/** Starts a session; costs the whole 1,600 units whether or not any bytes follow. */
export async function initiateUpload(
  ctx: ApiContext,
  body: VideoInsertBody,
  src: UploadSource,
): Promise<string> {
  const res = await ytRequest(ctx, `${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': src.mimeType,
      'X-Upload-Content-Length': String(src.size),
    },
    body: JSON.stringify(body),
  })
  const session = res.headers.get('location')
  if (!session) throw new YouTubeApiError(res.status, '', 'YouTube did not open an upload session.')
  return session
}

type Outcome =
  | { kind: 'done'; video: VideoResource }
  | { kind: 'partial'; nextOffset: number }
  | { kind: 'retry' }

/** Where the session stands after an interruption. */
export async function queryOffset(
  session: string,
  size: number,
  signal: AbortSignal,
): Promise<Outcome> {
  const res = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(QUERY_TIMEOUT_MS)]),
  })
  return interpret(res)
}

async function interpret(res: Response): Promise<Outcome> {
  if (res.status === 308) {
    return { kind: 'partial', nextOffset: parseRangeEnd(res.headers.get('range')) + 1 }
  }
  if (res.ok) return { kind: 'done', video: (await res.json()) as VideoResource }
  if (res.status === 404 || res.status === 410)
    throw new YouTubeApiError(
      res.status,
      'sessionGone',
      'The upload session expired. Start the upload again.',
    )
  if (res.status >= 500) return { kind: 'retry' }
  // A 401 here is unusual (the session URI carries its own auth) but not fatal.
  if (res.status === 401) return { kind: 'retry' }
  throw await errorFrom(res)
}

/** The caller's abort reason as an Error, whatever was passed to `abort()`. */
const abortError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error('Upload cancelled.')

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal))
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

/** Bytes read off the disk, counted on their way to the socket. */
async function* counted(
  stream: Readable,
  onBytes: (n: number) => void,
): AsyncGenerator<Buffer, void, undefined> {
  for await (const chunk of stream) {
    const buf = chunk as Buffer
    onBytes(buf.length)
    yield buf
  }
}

/**
 * Uploads `src` into a fresh session and returns the created video. Progress
 * is reported in bytes handed to the socket; a 308 snaps it back to what
 * YouTube confirmed. Rejects with the caller's abort reason when cancelled.
 */
export async function resumableUpload(
  ctx: ApiContext,
  body: VideoInsertBody,
  src: UploadSource,
  opts: { signal: AbortSignal; onProgress: (bytesSent: number) => void },
): Promise<VideoResource> {
  const { signal } = opts
  const session = await initiateUpload(ctx, body, src)
  let offset = 0
  let attempt = 0

  while (true) {
    if (signal.aborted) throw abortError(signal)
    if (offset >= src.size && src.size > 0) {
      // Everything was sent but the final answer got lost: ask.
      const state = await queryOffset(session, src.size, signal)
      if (state.kind === 'done') return state.video
      if (state.kind === 'partial') offset = state.nextOffset
      else await backoff()
      continue
    }
    const end = Math.min(offset + CHUNK_BYTES, src.size) - 1
    const outcome = await putChunk(session, src, offset, end, signal, opts.onProgress)
    if (outcome.kind === 'done') return outcome.video
    if (outcome.kind === 'partial') {
      offset = outcome.nextOffset
      attempt = 0
      opts.onProgress(offset)
      continue
    }
    await backoff()
    // Resync with the session before sending anything else.
    let state: Outcome
    try {
      state = await queryOffset(session, src.size, signal)
    } catch (err) {
      if (signal.aborted || err instanceof YouTubeApiError) throw err
      continue
    }
    if (state.kind === 'done') return state.video
    if (state.kind === 'partial') offset = state.nextOffset
  }

  async function backoff(): Promise<void> {
    attempt++
    if (attempt > MAX_ATTEMPTS)
      throw new YouTubeApiError(
        0,
        'network',
        'YouTube stopped responding. Check your connection and try again.',
      )
    const ms = Math.min(1000 * 2 ** attempt, 32_000) + Math.random() * 1000
    await sleep(ms, signal)
  }
}

async function putChunk(
  session: string,
  src: UploadSource,
  offset: number,
  end: number,
  signal: AbortSignal,
  onProgress: (bytesSent: number) => void,
): Promise<Outcome> {
  const chunk = new AbortController()
  let stall = setTimeout(onStall, STALL_MS)
  function onStall(): void {
    chunk.abort(new Error('Upload stalled.'))
  }
  const onAbort = (): void => chunk.abort(abortError(signal))
  signal.addEventListener('abort', onAbort, { once: true })

  const stream = createReadStream(src.path, { start: offset, end })
  let sent = 0
  const body = Readable.toWeb(
    Readable.from(
      counted(stream, (n) => {
        sent += n
        clearTimeout(stall)
        stall = setTimeout(onStall, STALL_MS)
        onProgress(Math.min(src.size, offset + sent))
      }),
    ),
  )
  try {
    const res = await fetch(session, {
      method: 'PUT',
      headers: {
        'Content-Length': String(end - offset + 1),
        'Content-Range': `bytes ${offset}-${end}/${src.size}`,
        'Content-Type': src.mimeType,
      },
      body,
      duplex: 'half',
      signal: chunk.signal,
    } as RequestInit)
    return await interpret(res)
  } catch (err) {
    if (signal.aborted) throw abortError(signal)
    if (err instanceof YouTubeApiError) throw err
    // A stall, a reset, a DNS blip: all retryable.
    return { kind: 'retry' }
  } finally {
    clearTimeout(stall)
    signal.removeEventListener('abort', onAbort)
    stream.destroy()
  }
}
