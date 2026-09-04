import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { cacheDir } from './paths'

export const SCHEME = 'clip'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.jpg': 'image/jpeg',
}

const CHUNK = 1 << 20

/** Must run before `app.whenReady()`. */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ])
}

/**
 * `clip://media/<clipId>` streams a library video with HTTP range support so
 * the <video> element can seek instantly. `clip://thumb/<file>` serves cached
 * posters/sprites. The renderer never gets to name an arbitrary path: media is
 * looked up by id and thumbnails are confined to the cache directory.
 */
export function installProtocol(resolveClipPath: (id: string) => string | undefined): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''))

    if (url.hostname === 'thumb') {
      if (!key || key !== basename(key) || !key.endsWith('.jpg')) return bad(400)
      return serveFile(join(cacheDir(), key), request, {
        'Cache-Control': 'private, max-age=31536000, immutable',
      })
    }
    if (url.hostname === 'media') {
      const filePath = resolveClipPath(key)
      if (!filePath) return bad(404)
      return serveFile(filePath, request, { 'Cache-Control': 'no-store' })
    }
    return bad(404)
  })
}

function bad(status: number): Response {
  return new Response(null, { status })
}

async function serveFile(
  filePath: string,
  request: Request,
  extra: Record<string, string>,
): Promise<Response> {
  let size: number
  try {
    size = (await stat(filePath)).size
  } catch {
    return bad(404)
  }
  const headers: Record<string, string> = {
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    ...extra,
  }

  const range = request.headers.get('range')
  const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
  if (match) {
    let start = match[1] ? Number(match[1]) : 0
    let end = match[2] ? Number(match[2]) : size - 1
    if (!match[1] && match[2]) {
      start = Math.max(0, size - Number(match[2]))
      end = size - 1
    }
    end = Math.min(end, size - 1)
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    return new Response(toWeb(filePath, request, { start, end }), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      },
    })
  }

  return new Response(toWeb(filePath, request, {}), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(size) },
  })
}

function toWeb(
  filePath: string,
  request: Request,
  range: { start?: number; end?: number },
): ReadableStream {
  const stream = createReadStream(filePath, { ...range, highWaterMark: CHUNK })
  // The player seeks constantly; tear the file handle down the moment Chromium
  // abandons a request instead of letting it drain to the end.
  request.signal?.addEventListener('abort', () => stream.destroy(), { once: true })
  return Readable.toWeb(stream) as unknown as ReadableStream
}
