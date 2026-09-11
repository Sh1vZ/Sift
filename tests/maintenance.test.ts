/**
 * The maintenance rules, then a real run over a throwaway folder tree with
 * files aged by hand. Runs on plain Node (`npm test`): lib/maintenance.ts is
 * Electron-free and takes its folders as arguments.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUDIO_TRACK_TTL_MS,
  GIF_PREVIEW_TTL_MS,
  ORPHAN_GRACE_MS,
  audioLimit,
  cacheLimit,
  isExportLeftover,
  runMaintenance,
  touch,
} from '../src/main/lib/maintenance'

let failed = 0
const check = (cond: unknown, msg: string): void => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
}

const now = Date.now()
const rules = {
  cacheValid: new Set(['a.jpg', 'a.sprite.jpg']),
  audioValid: new Set(['c-1.a1.m4a']),
  now,
}
const all = { ...rules, all: true }

// ---------------------------------------------------------------- rules
check(cacheLimit('a.jpg', rules) === null, 'an owned artifact stays for good')
check(cacheLimit('~a.jpg', rules) === ORPHAN_GRACE_MS, 'a half-made file gets the grace period')
check(cacheLimit('gifprev-x.gif', rules) === GIF_PREVIEW_TTL_MS, 'a GIF preview lives its hour')
check(cacheLimit('zzz.jpg', rules) === ORPHAN_GRACE_MS, 'an artifact no clip owns is an orphan')
check(
  cacheLimit('gifprev-x.gif', all) === 0 &&
    cacheLimit('zzz.jpg', all) === 0 &&
    cacheLimit('~a.jpg', all) === ORPHAN_GRACE_MS &&
    cacheLimit('a.jpg', all) === null,
  'Clear previews takes previews and orphans at once, never a live temp or an owned artifact',
)
check(
  audioLimit('c-1.a1.m4a', rules) === AUDIO_TRACK_TTL_MS &&
    audioLimit('~c-1.a1.m4a', rules) === ORPHAN_GRACE_MS &&
    audioLimit('d-1.a1.m4a', rules) === ORPHAN_GRACE_MS &&
    audioLimit('c-1.a1.m4a', all) === 0,
  'an audio track lives a week, an orphan an hour, none past Clear previews',
)
check(
  isExportLeftover('~Clip.mp4') &&
    isExportLeftover('~Clip.palette.png') &&
    isExportLeftover('~clip.GIF') &&
    isExportLeftover('~Sound.m4a') &&
    !isExportLeftover('Clip.mp4') &&
    !isExportLeftover('~$doc.docx') &&
    !isExportLeftover('~notes.txt'),
  "only an export's own temp names count as leftovers",
)

// ------------------------------------------------------------ a real run
// In a function: the tests bundle to CommonJS, which has no top-level await.
async function realRun(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'sift-maint-'))
  const cache = join(root, 'thumbs')
  const audio = join(root, 'audio')
  const clips = join(root, 'clips')
  for (const d of [cache, audio, clips, join(clips, 'Game'), join(clips, 'Game', 'Deeper')])
    mkdirSync(d)

  const OLD = 2 * ORPHAN_GRACE_MS
  const FRESH = 1000
  const WEEK_OLD = AUDIO_TRACK_TTL_MS + ORPHAN_GRACE_MS
  function file(dir: string, name: string, ageMs: number): string {
    const p = join(dir, name)
    writeFileSync(p, 'x'.repeat(10))
    const t = new Date(now - ageMs)
    utimesSync(p, t, t)
    return p
  }

  const kept = [
    file(cache, 'a.jpg', OLD),
    file(cache, 'young.jpg', FRESH),
    file(cache, '~live.jpg', FRESH),
    file(cache, 'gifprev-new.gif', FRESH),
    file(audio, 'c-1.a1.m4a', ORPHAN_GRACE_MS * 24),
    file(clips, '~Fresh.mp4', FRESH),
    file(join(clips, 'Game'), 'Real.mp4', OLD),
    file(join(clips, 'Game', 'Deeper'), '~Deep.mp4', OLD),
  ]
  const gone = [
    file(cache, 'zzz.jpg', OLD),
    file(cache, '~half.jpg', OLD),
    file(cache, 'gifprev-old.gif', GIF_PREVIEW_TTL_MS + FRESH),
    file(audio, 'e-1.a1.m4a', WEEK_OLD),
    file(audio, 'd-1.a1.m4a', OLD),
    file(clips, '~Clip.palette.png', OLD),
    file(join(clips, 'Game'), '~Clip.mp4', OLD),
  ]
  const touched = file(audio, 'f-1.a1.m4a', WEEK_OLD)

  const dirs = { cache, audio, clipsRoot: clips }
  const run = {
    cacheValid: new Set(['a.jpg']),
    audioValid: new Set(['c-1.a1.m4a', 'e-1.a1.m4a', 'f-1.a1.m4a']),
    now,
  }

  await touch(touched)
  const first = await runMaintenance(dirs, run)
  check(
    first.removed === gone.length && first.bytes === gone.length * 10,
    'a run removes what has expired and counts it',
  )
  check(
    gone.every((p) => !existsSync(p)),
    'expired orphans, half-made files, an old preview, an old and an orphan track, and export leftovers go',
  )
  check(
    kept.every((p) => existsSync(p)),
    'owned, fresh, live and out-of-reach files stay',
  )
  check(existsSync(touched), 'a track used again has its week start over')

  const second = await runMaintenance(dirs, run)
  check(second.removed === 0, 'a second run finds nothing to do')

  const wiped = await runMaintenance(dirs, { ...run, all: true })
  check(
    wiped.removed === 4 &&
      !existsSync(join(cache, 'gifprev-new.gif')) &&
      !existsSync(join(cache, 'young.jpg')) &&
      !existsSync(join(audio, 'c-1.a1.m4a')) &&
      !existsSync(touched),
    'Clear previews takes every preview, track and orphan whatever its age',
  )
  check(
    existsSync(join(cache, 'a.jpg')) &&
      existsSync(join(cache, '~live.jpg')) &&
      existsSync(join(clips, '~Fresh.mp4')),
    'and still leaves owned artifacts, live temps and fresh export files',
  )

  const missing = await runMaintenance(
    { cache: join(root, 'nope'), audio: join(root, 'nope'), clipsRoot: join(root, 'nope') },
    run,
  )
  check(missing.removed === 0, 'a folder that is not there is not an error')

  rmSync(root, { recursive: true, force: true })
}

realRun()
  .catch((err: unknown) => {
    failed++
    console.log(`FAIL the real run threw: ${(err as Error).message}`)
  })
  .finally(() => {
    console.log(failed ? `${failed} FAILED` : 'ALL OK')
    process.exitCode = failed ? 1 : 0
  })
