/**
 * The Electron-free half of the YouTube module: request validation, the
 * client-secret parser, Google's Pacific quota day, PKCE, the loopback port
 * choice and the resumable-upload helpers. Runs on plain Node (`npm test`);
 * nothing here opens a socket.
 */
import {
  formatUntil,
  isExhausted,
  nextPacificMidnightMs,
  pacificDayKey,
  parseClientSecretJson,
  tagsLength,
  validateUploadRequest,
  youtubeUrl,
  type UploadRequest,
  type YouTubeAccount,
} from '@shared/youtube'
import { friendlyError, isQuotaExceeded, YouTubeApiError } from '../src/main/lib/youtube/api'
import {
  OAuthError,
  buildAuthUrl,
  loopbackPorts,
  pkcePair,
  randomState,
} from '../src/main/lib/youtube/oauth'
import { CHUNK_BYTES, insertBody, mimeFor, parseRangeEnd } from '../src/main/lib/youtube/upload'

let failed = 0
const check = (cond: unknown, msg: string): void => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
}

const request = (patch: Partial<UploadRequest> = {}): UploadRequest => ({
  clipId: 'c1',
  title: 'Ace',
  description: 'Valorant',
  tags: ['valorant'],
  privacy: 'unlisted',
  playlistId: '',
  madeForKids: false,
  accountId: '',
  ...patch,
})

function requestCases(): void {
  check(validateUploadRequest(request()) === null, 'a plain request validates')
  check(validateUploadRequest(request({ title: '  ' })) !== null, 'an empty title is rejected')
  check(
    validateUploadRequest(request({ title: 'x'.repeat(101) })) !== null,
    'a 101-character title is rejected',
  )
  check(
    validateUploadRequest(request({ title: 'a <b> c' })) !== null,
    'angle brackets are rejected',
  )
  check(
    validateUploadRequest(request({ description: 'x'.repeat(5001) })) !== null,
    'a 5001-character description is rejected',
  )
  check(tagsLength(['a b', 'cd']) === 7, 'a tag with a space costs two extra characters')
  check(
    validateUploadRequest(request({ tags: ['x'.repeat(250), 'y'.repeat(251)] })) !== null,
    'tags over 500 characters are rejected',
  )
  check(validateUploadRequest(request({ tags: [''] })) !== null, 'an empty tag is rejected')
  check(youtubeUrl('dQw4w9WgXcQ') === 'https://youtu.be/dQw4w9WgXcQ', 'youtubeUrl')
  const body = insertBody({
    title: 'Ace',
    description: '',
    tags: [],
    privacy: 'public',
    madeForKids: false,
  })
  check(
    body.snippet.categoryId === '20' && body.status.selfDeclaredMadeForKids === false,
    'insertBody fixes the Gaming category and declares the kids flag',
  )
}

function clientSecretCases(): void {
  const installed = JSON.stringify({
    installed: {
      client_id: '123-abc.apps.googleusercontent.com',
      project_id: 'sift-uploads',
      client_secret: 'GOCSPX-secret',
      redirect_uris: ['http://localhost'],
    },
  })
  const p = parseClientSecretJson(installed)
  check(
    p?.kind === 'installed' &&
      p.clientId === '123-abc.apps.googleusercontent.com' &&
      p.clientSecret === 'GOCSPX-secret' &&
      p.projectId === 'sift-uploads',
    'parses a Desktop-app client secret file',
  )
  const web = parseClientSecretJson(
    JSON.stringify({ web: { client_id: 'w.apps.googleusercontent.com', client_secret: 's' } }),
  )
  check(web?.kind === 'web' && web.projectId === '', 'parses a web client without a project id')
  check(parseClientSecretJson('not json') === null, 'garbage is not a client secret')
  check(
    parseClientSecretJson('{"installed":{"client_id":"x"}}') === null,
    'a missing secret is rejected',
  )
  check(parseClientSecretJson('[]') === null, 'an array is not a client secret')
}

function pacificDayCases(): void {
  // 2026-07-01 03:00 UTC is still 2026-06-30 20:00 in Los Angeles (PDT, UTC-7).
  const summer = Date.UTC(2026, 6, 1, 3, 0, 0)
  check(pacificDayKey(summer) === '2026-06-30', 'Pacific day key lags UTC in summer')
  check(
    nextPacificMidnightMs(summer) === Date.UTC(2026, 6, 1, 7, 0, 0),
    'next Pacific midnight in summer is 07:00 UTC',
  )
  // 2026-01-15 06:00 UTC is 2026-01-14 22:00 in Los Angeles (PST, UTC-8).
  const winter = Date.UTC(2026, 0, 15, 6, 0, 0)
  check(pacificDayKey(winter) === '2026-01-14', 'Pacific day key lags UTC in winter')
  check(
    nextPacificMidnightMs(winter) === Date.UTC(2026, 0, 15, 8, 0, 0),
    'next Pacific midnight in winter is 08:00 UTC',
  )
  // Across the spring-forward night (2026-03-08 in Los Angeles) the day is 23 hours long.
  const beforeDst = Date.UTC(2026, 2, 8, 9, 0, 0) // 2026-03-08 01:00 PST
  check(
    nextPacificMidnightMs(beforeDst) === Date.UTC(2026, 2, 9, 7, 0, 0),
    'midnight after the DST switch lands at 07:00 UTC',
  )
  check(
    formatUntil(summer + 5 * 60 * 60_000 + 12 * 60_000, summer) === '5 h 12 min',
    'formatUntil h+min',
  )
  check(formatUntil(summer + 40 * 60_000, summer) === '40 min', 'formatUntil minutes')
  check(formatUntil(summer - 1, summer) === 'now', 'formatUntil past')

  const account = (until: number): YouTubeAccount => ({
    id: 'a',
    label: 'a',
    projectId: '',
    clientId: 'x.apps.googleusercontent.com',
    hasSecret: true,
    connection: 'connected',
    channel: null,
    error: '',
    quotaExhaustedUntilMs: until,
    addedAtMs: 0,
  })
  check(isExhausted(account(summer + 1), summer) && !isExhausted(account(0), summer), 'isExhausted')
}

function oauthCases(): void {
  const { verifier, challenge } = pkcePair()
  check(/^[\w-]{43}$/.test(verifier), 'PKCE verifier is 43 base64url characters')
  check(
    /^[\w-]{43}$/.test(challenge) && challenge !== verifier,
    'PKCE challenge is a distinct 43-char digest',
  )
  check(randomState() !== randomState(), 'state is random')
  // Firefox's banned list (network.security.ports.banned) plus X11 and the common
  // ones Chromium refuses; the loopback listener must never land on any of them.
  const banned = new Set([
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
    103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
    512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
    995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
    6697, 10080,
  ])
  const ports = loopbackPorts()
  check(
    ports.length >= 16 && ports.every((p) => p > 1024 && p < 65536 && !banned.has(p)),
    'loopback ports avoid every browser-banned port',
  )
  const url = new URL(
    buildAuthUrl({
      clientId: 'id.apps.googleusercontent.com',
      redirectUri: 'http://127.0.0.1:4242/callback',
      challenge,
      state: 's1',
      scopes: ['a', 'b'],
    }),
  )
  check(
    url.origin === 'https://accounts.google.com' &&
      url.searchParams.get('code_challenge_method') === 'S256' &&
      url.searchParams.get('scope') === 'a b' &&
      url.searchParams.get('state') === 's1' &&
      url.searchParams.get('access_type') === 'offline' &&
      url.searchParams.get('prompt') === 'consent' &&
      url.searchParams.get('redirect_uri') === 'http://127.0.0.1:4242/callback',
    'auth URL carries PKCE, scopes, state and offline access',
  )
}

function uploadHelperCases(): void {
  check(CHUNK_BYTES % (256 * 1024) === 0, 'chunk size is a multiple of 256 KiB')
  check(parseRangeEnd('bytes=0-8388607') === 8388607, 'parseRangeEnd reads the confirmed end')
  check(parseRangeEnd(null) === -1, 'parseRangeEnd is -1 without a header')
  check(mimeFor('.MKV') === 'video/x-matroska' && mimeFor('.mp4') === 'video/mp4', 'mimeFor')
  check(mimeFor('.xyz') === 'application/octet-stream', 'unknown extensions fall back')
}

function errorCases(): void {
  const quota = new YouTubeApiError(403, 'quotaExceeded', 'x')
  check(isQuotaExceeded(quota), 'quotaExceeded is recognised')
  check(
    friendlyError(quota, 'Alpha').includes('Alpha') &&
      friendlyError(quota).includes('midnight Pacific'),
    'quotaExceeded names the project and the reset',
  )
  check(
    /reconnect/i.test(friendlyError(new OAuthError('invalid_grant', 'x'), 'Alpha')),
    'invalid_grant tells the user to reconnect',
  )
  check(
    /channel/i.test(friendlyError(new YouTubeApiError(401, 'youtubeSignupRequired', 'x'))),
    'a Google account without a channel is explained',
  )
  check(friendlyError(new Error('boom')) === 'boom', 'other errors pass their message through')
}

requestCases()
clientSecretCases()
pacificDayCases()
oauthCases()
uploadHelperCases()
errorCases()
console.log(failed ? `${failed} check(s) failed` : 'ALL OK')
process.exit(failed ? 1 : 0)
