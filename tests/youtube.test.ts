/**
 * The Electron-free half of the YouTube module: request validation, the
 * client-secret parser, Google's Pacific quota day, PKCE, the loopback port
 * choice and the resumable-upload helpers. Runs on plain Node (`npm test`);
 * nothing here opens a socket.
 */
import {
  VIDEOS_PER_CALL,
  WATCH_BACKOFF_MS,
  WATCH_WINDOW_MS,
  formatUntil,
  isExhausted,
  isStageTerminal,
  mapVideoStatus,
  nextPacificMidnightMs,
  pacificDayKey,
  parseClientSecretJson,
  stageLine,
  stageReason,
  stageSentence,
  tagsLength,
  validateUploadRequest,
  watchDelayMs,
  youtubeUrl,
  type RawVideoStatus,
  type UploadJob,
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

/** A raw videos.list item; YouTube sends its counts as strings, so these do too. */
const raw = (patch: Partial<RawVideoStatus> = {}): RawVideoStatus => ({
  uploadStatus: 'uploaded',
  processingStatus: 'processing',
  ...patch,
})

function videoStatusCases(): void {
  const going = mapVideoStatus(raw({ partsTotal: '8', partsProcessed: '3', timeLeftMs: '120000' }))
  check(
    going.stage === 'processing' && going.progress === 0.375 && going.etaMs === 120_000,
    'a processing video reports its parts and the time YouTube says is left',
  )
  check(!isStageTerminal(going.stage), 'processing is not a final answer')

  const noParts = mapVideoStatus(raw())
  check(
    noParts.stage === 'processing' && noParts.progress === -1 && noParts.etaMs === 0,
    'YouTube giving no parts reads as unknown progress, never 0% and never NaN',
  )

  const over = mapVideoStatus(raw({ partsTotal: '8', partsProcessed: '9' }))
  check(over.progress === 1, 'more parts done than total is clamped to 1')

  const done = mapVideoStatus(raw({ uploadStatus: 'processed', processingStatus: 'succeeded' }))
  check(
    done.stage === 'ready' && done.progress === 1 && done.reason === '' && isStageTerminal('ready'),
    'a processed video is ready, complete and blameless',
  )
  check(
    mapVideoStatus(raw({ uploadStatus: 'processed' })).stage === 'ready',
    'processed without processingDetails is still ready',
  )

  const rejected = mapVideoStatus(raw({ uploadStatus: 'rejected', rejectionReason: 'copyright' }))
  check(
    rejected.stage === 'rejected' && /copyright/i.test(rejected.reason),
    'a rejected video names why',
  )
  check(
    mapVideoStatus(raw({ uploadStatus: 'rejected', processingStatus: 'succeeded' })).stage ===
      'rejected',
    'uploadStatus wins: a rejected video also reports processing succeeded',
  )

  const odd = mapVideoStatus(raw({ uploadStatus: 'rejected', rejectionReason: 'somethingNew' }))
  check(
    odd.stage === 'rejected' && odd.reason.includes('somethingNew'),
    'an unknown rejection code surfaces the code rather than undefined',
  )
  check(
    !stageSentence(odd).includes('undefined') && stageSentence(odd).endsWith('.'),
    'the sentence for an unknown code is still a sentence',
  )

  check(
    mapVideoStatus(raw({ uploadStatus: 'failed', failureReason: 'codecs' })).stage === 'failed',
    'a failed upload is failed',
  )
  check(
    mapVideoStatus(raw({ processingStatus: 'terminated' })).stage === 'failed',
    'terminated processing counts as failed',
  )
  const gone = mapVideoStatus(raw({ uploadStatus: 'deleted' }))
  check(gone.stage === 'deleted' && isStageTerminal('deleted'), 'a deleted video is final')
  check(stageReason('') === '', 'no code means no reason fragment')
}

function watchScheduleCases(): void {
  const ladder = [0, 1, 2, 3, 4].map((n) => watchDelayMs(n))
  check(
    ladder.join() === WATCH_BACKOFF_MS.join(),
    'the ladder walks 15 s to 5 min as answers come back',
  )
  const last = WATCH_BACKOFF_MS[WATCH_BACKOFF_MS.length - 1]
  check(watchDelayMs(99) === last, 'the ladder saturates rather than growing forever')
  check(
    WATCH_BACKOFF_MS.every((v, i) => i === 0 || v > WATCH_BACKOFF_MS[i - 1]),
    'the ladder only ever widens',
  )
  check(watchDelayMs(0, 90_000) === 95_000, "YouTube's own estimate aims the next call")
  check(watchDelayMs(0, 1) === WATCH_BACKOFF_MS[0], 'a tiny estimate cannot make Sift hot-loop')
  check(watchDelayMs(0, 3_600_000) === last, 'a huge estimate cannot stall the ladder')
  check(VIDEOS_PER_CALL === 50, 'one call carries the 50 ids YouTube allows')
  check(WATCH_WINDOW_MS === 2 * 60 * 60_000, 'automatic checks stop after two hours')
}

const job = (patch: Partial<UploadJob> = {}): UploadJob =>
  ({
    stage: 'processing',
    stageProgress: -1,
    stageEtaMs: 0,
    checkedAtMs: 0,
    checksStopped: false,
    error: '',
    ...patch,
  }) as UploadJob

function stageLineCases(): void {
  const now = 1_700_000_000_000
  check(
    stageLine(job(), now) === 'Processing on YouTube',
    'with nothing to report the line is just the stage, never "0%"',
  )
  check(
    stageLine(job({ stageProgress: 0.45 }), now) === 'Processing on YouTube · 45%',
    'a known fraction is shown as a percentage',
  )
  const withEta = stageLine(
    job({ stageProgress: 0.45, stageEtaMs: 300_000, checkedAtMs: now }),
    now,
  )
  check(
    withEta === 'Processing on YouTube · 45% · 5 min left',
    "YouTube's estimate is counted from when it was given",
  )
  check(
    !stageLine(job({ stageProgress: 0.45, stageEtaMs: 20_000, checkedAtMs: now }), now).includes(
      'left',
    ),
    'an estimate under a minute is left off rather than rounded to "now"',
  )
  check(
    stageLine(job({ checksStopped: true }), now) === 'Still processing on YouTube',
    'once Sift stops asking it says so',
  )
  check(stageLine(job({ stage: 'ready' }), now) === 'Ready on YouTube', 'ready is not "live"')
  check(
    stageLine(job({ stage: 'rejected', error: 'YouTube rejected this video.' }), now) ===
      'YouTube rejected this video.',
    'a bad outcome shows the sentence already built for it',
  )
  check(stageLine(job({ stage: 'unknown' }), now) === '', 'nothing known means nothing said')
}

requestCases()
clientSecretCases()
pacificDayCases()
oauthCases()
uploadHelperCases()
errorCases()
videoStatusCases()
watchScheduleCases()
stageLineCases()
console.log(failed ? `${failed} check(s) failed` : 'ALL OK')
process.exit(failed ? 1 : 0)
