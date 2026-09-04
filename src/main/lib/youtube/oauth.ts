/**
 * OAuth 2.0 for a desktop app: PKCE, a loopback redirect on 127.0.0.1, the
 * code exchange and token refresh. Electron-free: the caller opens the browser.
 *
 * Google's "Desktop app" client type accepts any loopback port, so nothing has
 * to be registered ahead of time. The listener only ever binds 127.0.0.1, only
 * answers `/callback`, and refuses a response whose `state` is not the one
 * this sign-in generated.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const HTTP_TIMEOUT_MS = 30_000

const base64url = (buf: Buffer): string => buf.toString('base64url')

export interface PkcePair {
  verifier: string
  challenge: string
}

export function pkcePair(): PkcePair {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export const randomState = (): string => base64url(randomBytes(16))

export function buildAuthUrl(o: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  scopes: readonly string[]
}): string {
  const u = new URL(AUTH_URL)
  u.searchParams.set('client_id', o.clientId)
  u.searchParams.set('redirect_uri', o.redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', o.scopes.join(' '))
  u.searchParams.set('code_challenge', o.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', o.state)
  // offline + consent: a refresh token every time, including on a reconnect.
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('include_granted_scopes', 'true')
  return u.toString()
}

/** Errors from Google's token endpoint keep their OAuth `error` code for the caller to branch on. */
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

/** The page the browser shows once Google has redirected back. No scripts, no remote assets. */
function resultPage(title: string, body: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="dark">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Sift</title>
<style>
  html,body{height:100%;margin:0;background:#0f0f23;color:#e2e8f0;font:15px/1.5 "Segoe UI",system-ui,sans-serif}
  main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:32px;box-sizing:border-box}
  .card{max-width:420px;padding:28px 32px;border-radius:14px;background:#1e1c35;border:1px solid rgba(255,255,255,.07);box-shadow:0 24px 60px -12px rgba(0,0,0,.7)}
  h1{margin:0 0 8px;font-size:18px;letter-spacing:.02em}
  p{margin:0;color:#94a3b8}
  .mark{display:inline-block;width:10px;height:10px;border-radius:50%;background:#7c3aed;margin-right:10px;vertical-align:1px}
</style></head>
<body><main><div class="card"><h1><span class="mark"></span>${esc(title)}</h1><p>${esc(body)}</p></div></main></body></html>`
}

export interface Loopback {
  redirectUri: string
  /** Resolves with the authorization code, rejects on denial, timeout or abort. */
  code: Promise<string>
  close(): void
}

/**
 * Starts the loopback listener. The returned promise settles once the browser
 * has been redirected back (or the wait was abandoned); the server is closed
 * either way.
 */
export function startLoopback(
  expectedState: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Loopback> {
  return new Promise((resolveStart, rejectStart) => {
    let settled = false
    let resolveCode!: (code: string) => void
    let rejectCode!: (err: Error) => void
    const code = new Promise<string>((res, rej) => {
      resolveCode = res
      rejectCode = rej
    })

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
        return
      }
      const html = (status: number, title: string, body: string): void => {
        res
          .writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
          .end(resultPage(title, body))
      }
      // A response we did not ask for: answer it, but keep waiting for ours.
      if (url.searchParams.get('state') !== expectedState) {
        html(400, 'Not this sign-in', 'This sign-in link is not for the current Sift session.')
        return
      }
      const error = url.searchParams.get('error')
      const authCode = url.searchParams.get('code')
      if (error || !authCode) {
        html(200, 'Sign-in cancelled', 'Sign-in was cancelled. You can close this tab.')
        finish(() =>
          rejectCode(
            new OAuthError(error ?? 'access_denied', 'Sign-in was cancelled in the browser.'),
          ),
        )
        return
      }
      html(200, 'Sift is connected to YouTube', 'You can close this tab and go back to Sift.')
      finish(() => resolveCode(authCode))
    })

    const close = (): void => {
      server.close()
      server.closeAllConnections()
    }
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      settle()
      // Let the response bytes leave before the socket goes away.
      setTimeout(close, 500).unref()
    }
    const onAbort = (): void =>
      finish(() => rejectCode(new OAuthError('aborted', 'Sign-in was cancelled.')))
    const timer = setTimeout(
      () => finish(() => rejectCode(new OAuthError('timeout', 'Sign-in timed out. Try again.'))),
      timeoutMs,
    )
    signal.addEventListener('abort', onAbort, { once: true })

    const candidates = loopbackPorts()
    const tryNext = (): void => {
      const port = candidates.shift()
      if (port === undefined) {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        rejectStart(new OAuthError('no_port', 'No free local port for the sign-in. Try again.'))
        return
      }
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          tryNext()
          return
        }
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        rejectStart(err)
      })
      server.listen(port, '127.0.0.1', () => {
        const bound = (server.address() as AddressInfo).port
        resolveStart({
          redirectUri: `http://127.0.0.1:${bound}/callback`,
          code,
          close: () =>
            finish(() => rejectCode(new OAuthError('aborted', 'Sign-in was cancelled.'))),
        })
      })
    }
    tryNext()
  })
}

/**
 * Ports to try for the loopback listener, in order. Letting the OS pick one is
 * not safe: browsers refuse a list of "non-web" ports (Firefox and its forks
 * show "This address is restricted"), and Windows hands out ephemeral ports
 * from a range that can collide with it. These are well outside every browser
 * blocklist; a handful of fixed ones first so the redirect stays predictable,
 * then random picks in a quiet range in case they are all taken.
 */
export function loopbackPorts(): number[] {
  const fixed = [8085, 8086, 8087, 8088, 8089, 17548, 17549, 17550]
  const random = new Set<number>()
  while (random.size < 8) random.add(20_000 + Math.floor(Math.random() * 10_000))
  return [...fixed, ...random]
}

interface TokenJson {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  error?: string
  error_description?: string
}

async function tokenRequest(params: Record<string, string>): Promise<TokenJson> {
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch {
    throw new OAuthError('network', 'Could not reach Google. Check your connection.')
  }
  const json = (await res.json().catch(() => ({}))) as TokenJson
  if (!res.ok || json.error) {
    const code = json.error ?? `http_${res.status}`
    throw new OAuthError(code, json.error_description ?? `Google answered ${res.status}.`)
  }
  return json
}

export interface Tokens {
  accessToken: string
  expiresAtMs: number
  refreshToken: string
  /** Space-separated scopes Google actually granted. */
  scope: string
}

export async function exchangeCode(o: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  verifier: string
}): Promise<Tokens> {
  const json = await tokenRequest({
    code: o.code,
    client_id: o.clientId,
    client_secret: o.clientSecret,
    redirect_uri: o.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: o.verifier,
  })
  if (!json.access_token || !json.refresh_token) {
    throw new OAuthError('no_refresh_token', 'Google did not return a refresh token. Try again.')
  }
  return {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + (json.expires_in ?? 3600) * 1000,
    refreshToken: json.refresh_token,
    scope: json.scope ?? '',
  }
}

export async function refreshAccessToken(o: {
  clientId: string
  clientSecret: string
  refreshToken: string
}): Promise<{ accessToken: string; expiresAtMs: number; scope: string }> {
  const json = await tokenRequest({
    client_id: o.clientId,
    client_secret: o.clientSecret,
    refresh_token: o.refreshToken,
    grant_type: 'refresh_token',
  })
  if (!json.access_token)
    throw new OAuthError('no_access_token', 'Google returned no access token.')
  return {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: json.scope ?? '',
  }
}

/** Best effort: a token that is already dead answers 400, which is fine. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch {
    /* revocation is a courtesy; the token is forgotten locally regardless */
  }
}
