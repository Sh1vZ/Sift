/**
 * Persistence regression test for the SQLite store, plus the pure export
 * helpers. Runs on plain Node (`npm test`) — no Electron needed because Store
 * takes its DB path.
 *
 * Case 1 reproduces the first-import crash: on a fresh database the folder
 * was re-queued after its clips, so the clip inserts hit a foreign key that
 * did not exist yet.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_SETTINGS, type Clip, type LibraryFolder } from '@shared/types'
import { buildExportArgs, exportExt, safeGameDir, sanitizeName, uniqueName, parseProgressLine } from '../src/main/lib/exports'
import { Store } from '../src/main/lib/store'

const dir = mkdtempSync(join(tmpdir(), 'sift-store-'))
const dbFile = join(dir, 'library.db')

const folder: LibraryFolder = {
  id: 'f1',
  path: 'D:/Videos/NVIDIA',
  name: 'NVIDIA',
  addedAtMs: 1,
  clipCount: 0,
  available: true,
  kind: 'library'
}

const clip = (id: string): Clip => ({
  id,
  path: `D:/Videos/NVIDIA/Valorant/${id}.mp4`,
  name: id,
  title: 'Valorant',
  ext: '.mp4',
  folderId: 'f1',
  game: 'Valorant',
  size: 10,
  mtimeMs: 1,
  recordedAtMs: 1,
  duration: 0,
  width: 0,
  height: 0,
  fps: 0,
  vcodec: '',
  hasAudio: false,
  thumb: '',
  sprite: '',
  spriteFrames: 0,
  probeState: 'pending',
  sourceId: '',
  trimStart: 0,
  trimEnd: 0,
  muted: false,
  createdAtMs: 0
})

const count = (file: string, sql: string): number => {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return (db.prepare(sql).get() as { n: number }).n
  } finally {
    db.close()
  }
}

let failed = 0
const check = (cond: unknown, msg: string): void => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
}

/** The v2 layout, as shipped before folder kinds and clip provenance existed. */
const SCHEMA_V2 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE folders (
  id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  added_at_ms INTEGER NOT NULL, clip_count INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE clips (
  id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, title TEXT NOT NULL, ext TEXT NOT NULL,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE, game TEXT NOT NULL, size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL, recorded_at_ms REAL NOT NULL, duration REAL NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, fps REAL NOT NULL DEFAULT 0,
  vcodec TEXT NOT NULL DEFAULT '', has_audio INTEGER NOT NULL DEFAULT 0, thumb TEXT NOT NULL DEFAULT '',
  sprite TEXT NOT NULL DEFAULT '', sprite_frames INTEGER NOT NULL DEFAULT 0, probe_state TEXT NOT NULL DEFAULT 'pending'
);
INSERT INTO meta (key, value) VALUES ('schema_version', '2');
INSERT INTO folders (id, path, name, added_at_ms) VALUES ('old', 'D:/Old', 'Old', 1);
INSERT INTO clips (id, path, name, title, ext, folder_id, game, size, mtime_ms, recorded_at_ms)
  VALUES ('oc', 'D:/Old/Game/x.mp4', 'x', 'x', '.mp4', 'old', 'Game', 1, 1, 1);
`

async function storeCases(): Promise<void> {
  const store = new Store(dbFile)
  await store.load()

  // 1. First import on a fresh DB: folder queued, clips queued, folder re-queued
  //    (clip count update), one flush. Folders must be written before clips.
  store.upsertFolder(folder)
  store.upsertClip(clip('c1'))
  store.upsertClip(clip('c2'))
  folder.clipCount = 2
  store.upsertFolder(folder)
  await store.flush()
  check(count(dbFile, 'SELECT COUNT(*) n FROM folders') === 1, 'folder written')
  check(count(dbFile, 'SELECT COUNT(*) n FROM clips') === 2, 'clips written after their folder (no FK failure)')
  check(count(dbFile, 'SELECT clip_count n FROM folders') === 2, 'latest folder state wins')

  // 2. Coalescing: several patches to one clip become one row with the final state.
  const c1 = clip('c1')
  store.upsertClip(c1)
  c1.probeState = 'ok'
  c1.duration = 12
  store.upsertClip(c1)
  await store.flush()
  check(
    count(dbFile, "SELECT COUNT(*) n FROM clips WHERE id = 'c1' AND probe_state = 'ok' AND duration = 12") === 1,
    'coalesced patches persist the final state'
  )

  // 3. A clips-kind folder and an export's provenance round-trip.
  const clipsFolder: LibraryFolder = { ...folder, id: 'fc', path: 'C:/Users/me/Videos/Sift Clips', name: 'Sift Clips', kind: 'clips' }
  store.upsertFolder(clipsFolder)
  const exported: Clip = {
    ...clip('e1'),
    path: 'C:/Users/me/Videos/Sift Clips/Valorant/Ace - Clip.mp4',
    folderId: 'fc',
    sourceId: 'c1',
    trimStart: 3,
    trimEnd: 9.5,
    muted: true,
    createdAtMs: 42
  }
  store.upsertClip(exported)

  // 4. Settings and rows survive close/reopen; unset settings fall back to defaults.
  store.data.settings.volume = 0.33
  store.data.settings.gridSize = 'compact'
  store.data.settings.minimizeToTray = true
  store.saveSettings()
  await store.close()
  const again = new Store(dbFile)
  await again.load()
  check(again.data.settings.volume === 0.33 && again.data.settings.gridSize === 'compact', 'settings survive reopen')
  check(again.data.settings.minimizeToTray === true, 'minimize-to-tray survives reopen')
  check(again.data.settings.trayHintShown === false, 'unset tray hint flag uses its default')
  check(again.data.settings.concurrency === DEFAULT_SETTINGS.concurrency, 'unset settings use defaults')
  check(Object.keys(again.data.clips).length === 3 && again.data.folders.length === 2, 'folders + clips reload')
  check(again.data.folders.find((f) => f.id === 'fc')?.kind === 'clips', 'folder kind survives reopen')
  const e1 = again.data.clips.e1
  check(
    e1?.sourceId === 'c1' && e1.trimStart === 3 && e1.trimEnd === 9.5 && e1.muted === true && e1.createdAtMs === 42,
    'export provenance survives reopen'
  )
  check(again.data.clips.c1?.sourceId === '' && again.data.clips.c1?.muted === false, 'recordings keep empty provenance')

  // 5. Removing a folder cascades to its clips; a clip delete queued alongside is harmless.
  again.deleteClip('c1')
  again.deleteFolder('f1')
  await again.flush()
  check(count(dbFile, 'SELECT COUNT(*) n FROM clips') === 1, 'folder removal cascades to clips')
  await again.close()
}

async function migrationCase(): Promise<void> {
  const oldFile = join(dir, 'old.db')
  const raw = new DatabaseSync(oldFile)
  raw.exec(SCHEMA_V2)
  raw.close()

  const store = new Store(oldFile)
  await store.load()
  check(store.data.folders[0]?.kind === 'library', 'v2 folders migrate to kind=library')
  check(store.data.clips.oc?.sourceId === '' && store.data.clips.oc?.createdAtMs === 0, 'v2 clips migrate with empty provenance')
  const cols = new DatabaseSync(oldFile, { readOnly: true })
  const names = (cols.prepare('PRAGMA table_info(clips)').all() as Array<{ name: string }>).map((r) => r.name)
  const version = (cols.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value
  cols.close()
  check(names.includes('created_at_ms') && names.includes('source_id'), 'migration added the provenance columns')
  check(version === '3', 'schema version advanced to 3')
  await store.close()
}

function exportHelperCases(): void {
  check(sanitizeName('  Ace - Clip. ').name === 'Ace - Clip', 'sanitizeName trims and strips trailing dots')
  check(Boolean(sanitizeName('bad:name').error), 'sanitizeName rejects Windows-invalid characters')
  check(Boolean(sanitizeName('CON').error), 'sanitizeName rejects reserved names')
  check(safeGameDir('Half-Life: Alyx') === 'Half-Life- Alyx', 'safeGameDir replaces invalid characters')
  check(safeGameDir('') === 'Clips', 'safeGameDir falls back')
  check(exportExt('.MKV') === '.mp4' && exportExt('.webm') === '.webm', 'exportExt picks the container')
  check(uniqueName('Clip', (c) => c === 'Clip' || c === 'Clip (2)') === 'Clip (3)', 'uniqueName suffixes on collision')
  check(parseProgressLine('out_time_us=2500000') === 2.5 && parseProgressLine('frame=12') === null, 'parseProgressLine')

  const args = buildExportArgs({ src: 'in.mp4', out: 'out.mp4', start: 1.5, end: 4, muted: false, vcodec: 'hevc' })
  const i = args.indexOf('-i')
  check(
    args.indexOf('-ss') < i && args.indexOf('-to') < i && args[args.indexOf('-ss') + 1] === '1.500',
    'seek and stop are input options'
  )
  check(args.includes('0:a?') && !args.includes('-an') && args.includes('hvc1'), 'audio mapped, hevc tagged')
  check(args[args.length - 1] === 'out.mp4' && args.includes('copy'), 'stream copy to the output path')
  const muted = buildExportArgs({ src: 'in.mp4', out: 'out.mp4', start: 0, end: 1, muted: true, vcodec: 'h264' })
  check(muted.includes('-an') && !muted.includes('0:a?') && !muted.includes('hvc1'), 'muted drops audio')
}

async function main(): Promise<void> {
  await storeCases()
  await migrationCase()
  exportHelperCases()
}

main()
  .catch((err) => {
    console.error(err)
    failed++
  })
  .finally(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* temp dir cleanup is best-effort */
    }
    console.log(failed ? `${failed} check(s) failed` : 'ALL OK')
    process.exit(failed ? 1 : 0)
  })
