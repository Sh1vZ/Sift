/**
 * Persistence regression test for the SQLite store. Runs on plain Node
 * (`npm test`) — no Electron needed because Store takes its DB path.
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
import { Store } from '../src/main/lib/store'

const dir = mkdtempSync(join(tmpdir(), 'sift-store-'))
const dbFile = join(dir, 'library.db')

const folder: LibraryFolder = {
  id: 'f1',
  path: 'D:/Videos/NVIDIA',
  name: 'NVIDIA',
  addedAtMs: 1,
  clipCount: 0,
  available: true
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
  probeState: 'pending'
})

const count = (sql: string): number => {
  const db = new DatabaseSync(dbFile, { readOnly: true })
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

async function main(): Promise<void> {
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
  check(count('SELECT COUNT(*) n FROM folders') === 1, 'folder written')
  check(count('SELECT COUNT(*) n FROM clips') === 2, 'clips written after their folder (no FK failure)')
  check(count('SELECT clip_count n FROM folders') === 2, 'latest folder state wins')

  // 2. Coalescing: several patches to one clip become one row with the final state.
  const c1 = clip('c1')
  store.upsertClip(c1)
  c1.probeState = 'ok'
  c1.duration = 12
  store.upsertClip(c1)
  await store.flush()
  check(
    count("SELECT COUNT(*) n FROM clips WHERE id = 'c1' AND probe_state = 'ok' AND duration = 12") === 1,
    'coalesced patches persist the final state'
  )

  // 3. Settings and rows survive close/reopen; unset settings fall back to defaults.
  store.data.settings.volume = 0.33
  store.data.settings.gridSize = 'compact'
  store.saveSettings()
  await store.close()
  const again = new Store(dbFile)
  await again.load()
  check(again.data.settings.volume === 0.33 && again.data.settings.gridSize === 'compact', 'settings survive reopen')
  check(again.data.settings.concurrency === DEFAULT_SETTINGS.concurrency, 'unset settings use defaults')
  check(Object.keys(again.data.clips).length === 2 && again.data.folders.length === 1, 'folders + clips reload')

  // 4. Removing a folder cascades to its clips; a clip delete queued alongside is harmless.
  again.deleteClip('c1')
  again.deleteFolder('f1')
  await again.flush()
  check(count('SELECT COUNT(*) n FROM clips') === 0, 'folder removal cascades to clips')
  await again.close()
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
