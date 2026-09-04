import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { DEFAULT_SETTINGS, type Clip, type LibraryFolder, type Settings } from '@shared/types'

interface LibraryData {
  folders: LibraryFolder[]
  clips: Record<string, Clip>
  settings: Settings
}

const FLUSH_MS = 200

/**
 * Forward-only schema migrations. `SCHEMA` creates the current shape for a new
 * database; each entry here upgrades an older database by one version. Add a
 * function (never edit an existing one) whenever the schema changes.
 */
const MIGRATIONS: Array<(db: DatabaseSync) => void> = [
  // v1 -> v2: large cards became the default grid size; drop any stored value so
  // existing libraries pick the new default up instead of the old one.
  (db) => db.prepare("DELETE FROM settings WHERE key = 'gridSize'").run(),
  // v2 -> v3: the clips folder (exports) became a folder kind, and clips learned
  // where they were cut from.
  (db) => {
    db.exec("ALTER TABLE folders ADD COLUMN kind TEXT NOT NULL DEFAULT 'library'")
    db.exec("ALTER TABLE clips ADD COLUMN source_id TEXT NOT NULL DEFAULT ''")
    db.exec('ALTER TABLE clips ADD COLUMN trim_start REAL NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE clips ADD COLUMN trim_end REAL NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE clips ADD COLUMN muted INTEGER NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE clips ADD COLUMN created_at_ms REAL NOT NULL DEFAULT 0')
  },
]
const SCHEMA_VERSION = MIGRATIONS.length + 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  added_at_ms INTEGER NOT NULL,
  clip_count  INTEGER NOT NULL DEFAULT 0,
  available   INTEGER NOT NULL DEFAULT 1,
  kind        TEXT NOT NULL DEFAULT 'library'
);
CREATE TABLE IF NOT EXISTS clips (
  id             TEXT PRIMARY KEY,
  path           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  title          TEXT NOT NULL,
  ext            TEXT NOT NULL,
  folder_id      TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  game           TEXT NOT NULL,
  size           INTEGER NOT NULL,
  mtime_ms       REAL NOT NULL,
  recorded_at_ms REAL NOT NULL,
  duration       REAL NOT NULL DEFAULT 0,
  width          INTEGER NOT NULL DEFAULT 0,
  height         INTEGER NOT NULL DEFAULT 0,
  fps            REAL NOT NULL DEFAULT 0,
  vcodec         TEXT NOT NULL DEFAULT '',
  has_audio      INTEGER NOT NULL DEFAULT 0,
  thumb          TEXT NOT NULL DEFAULT '',
  sprite         TEXT NOT NULL DEFAULT '',
  sprite_frames  INTEGER NOT NULL DEFAULT 0,
  probe_state    TEXT NOT NULL DEFAULT 'pending',
  source_id      TEXT NOT NULL DEFAULT '',
  trim_start     REAL NOT NULL DEFAULT 0,
  trim_end       REAL NOT NULL DEFAULT 0,
  muted          INTEGER NOT NULL DEFAULT 0,
  created_at_ms  REAL NOT NULL DEFAULT 0
);
`

/** Created after migrations run, since an index may name a column an older database only gains then. */
const INDEXES = `
CREATE INDEX IF NOT EXISTS clips_folder   ON clips(folder_id);
CREATE INDEX IF NOT EXISTS clips_game     ON clips(game);
CREATE INDEX IF NOT EXISTS clips_recorded ON clips(recorded_at_ms DESC);
CREATE INDEX IF NOT EXISTS clips_source   ON clips(source_id);
`

interface ClipRow {
  id: string
  path: string
  name: string
  title: string
  ext: string
  folder_id: string
  game: string
  size: number
  mtime_ms: number
  recorded_at_ms: number
  duration: number
  width: number
  height: number
  fps: number
  vcodec: string
  has_audio: number
  thumb: string
  sprite: string
  sprite_frames: number
  probe_state: Clip['probeState']
  source_id: string
  trim_start: number
  trim_end: number
  muted: number
  created_at_ms: number
}

interface FolderRow {
  id: string
  path: string
  name: string
  added_at_ms: number
  clip_count: number
  available: number
  kind: string
}

/**
 * SQLite-backed library index using Node's built-in `node:sqlite` — no native
 * module to rebuild for each Electron release. `data` is the in-memory working
 * set the rest of the main process reads and mutates; every mutation is then
 * registered here and written incrementally: changes are coalesced per row and
 * committed in one transaction every 200 ms (and on shutdown), so a 3,000-clip
 * scan is a few hundred small transactions rather than 3,000 fsyncs or a full
 * rewrite of the index.
 */
export class Store {
  data: LibraryData = { folders: [], clips: {}, settings: { ...DEFAULT_SETTINGS } }

  private db: DatabaseSync | null = null
  private stmts!: {
    upsertFolder: StatementSync
    deleteFolder: StatementSync
    upsertClip: StatementSync
    deleteClip: StatementSync
    setSetting: StatementSync
  }
  /**
   * Coalesced pending writes, keyed by row; the latest op for a key wins.
   * Kept in three buckets so a flush always writes folders before the clips
   * that reference them (clips.folder_id → folders.id), whatever order the
   * calls arrived in.
   */
  private pending = {
    folders: new Map<string, () => void>(),
    clips: new Map<string, () => void>(),
    other: new Map<string, () => void>(),
  }
  private timer: NodeJS.Timeout | null = null

  /** `dbPath` is injected (rather than derived from Electron's userData here) so the store is testable without Electron. */
  constructor(private readonly dbPath: string) {}

  async load(): Promise<void> {
    const db = new DatabaseSync(this.dbPath)
    this.db = db
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(SCHEMA)
    this.migrate(db)
    db.exec(INDEXES)
    this.prepare(db)

    this.data.folders = (
      db.prepare('SELECT * FROM folders ORDER BY added_at_ms').all() as unknown as FolderRow[]
    ).map((r) => ({
      id: r.id,
      path: r.path,
      name: r.name,
      addedAtMs: r.added_at_ms,
      clipCount: r.clip_count,
      available: Boolean(r.available),
      kind: r.kind === 'clips' ? 'clips' : 'library',
    }))
    const clips: Record<string, Clip> = {}
    for (const r of db.prepare('SELECT * FROM clips').all() as unknown as ClipRow[])
      clips[r.id] = rowToClip(r)
    this.data.clips = clips

    const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    for (const r of db.prepare('SELECT key, value FROM settings').all() as unknown as Array<{
      key: string
      value: string
    }>) {
      if (r.key in DEFAULT_SETTINGS) {
        try {
          settings[r.key] = JSON.parse(r.value)
        } catch {
          /* keep default */
        }
      }
    }
    this.data.settings = settings as unknown as Settings
  }

  private prepare(db: DatabaseSync): void {
    this.stmts = {
      upsertFolder: db.prepare(`
        INSERT INTO folders (id, path, name, added_at_ms, clip_count, available, kind)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          path = excluded.path, name = excluded.name, added_at_ms = excluded.added_at_ms,
          clip_count = excluded.clip_count, available = excluded.available, kind = excluded.kind`),
      deleteFolder: db.prepare('DELETE FROM folders WHERE id = ?'),
      upsertClip: db.prepare(`
        INSERT INTO clips (id, path, name, title, ext, folder_id, game, size, mtime_ms, recorded_at_ms,
          duration, width, height, fps, vcodec, has_audio, thumb, sprite, sprite_frames, probe_state,
          source_id, trim_start, trim_end, muted, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          path = excluded.path, name = excluded.name, title = excluded.title, ext = excluded.ext,
          folder_id = excluded.folder_id, game = excluded.game, size = excluded.size,
          mtime_ms = excluded.mtime_ms, recorded_at_ms = excluded.recorded_at_ms,
          duration = excluded.duration, width = excluded.width, height = excluded.height, fps = excluded.fps,
          vcodec = excluded.vcodec, has_audio = excluded.has_audio, thumb = excluded.thumb,
          sprite = excluded.sprite, sprite_frames = excluded.sprite_frames, probe_state = excluded.probe_state,
          source_id = excluded.source_id, trim_start = excluded.trim_start, trim_end = excluded.trim_end,
          muted = excluded.muted, created_at_ms = excluded.created_at_ms`),
      deleteClip: db.prepare('DELETE FROM clips WHERE id = ?'),
      setSetting: db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ),
    }
  }

  private migrate(db: DatabaseSync): void {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      { value: string } | undefined
    let version = row ? Number(row.value) : SCHEMA_VERSION
    while (version < SCHEMA_VERSION) {
      const step = MIGRATIONS[version - 1]
      this.transaction(() => {
        step(db)
        db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(
          String(version + 1),
        )
      })
      version++
    }
    db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION),
    )
  }

  // ---------------------------------------------------------- write API
  // Each call registers the *object* to persist; its state is read at flush
  // time, so ten patches to one clip become a single upsert.

  upsertFolder(folder: LibraryFolder): void {
    this.enqueue(this.pending.folders, folder.id, () => this.writeFolder(folder))
  }

  deleteFolder(id: string): void {
    this.enqueue(this.pending.folders, id, () => this.stmts.deleteFolder.run(id))
  }

  upsertClip(clip: Clip): void {
    this.enqueue(this.pending.clips, clip.id, () => this.writeClip(clip))
  }

  deleteClip(id: string): void {
    this.enqueue(this.pending.clips, id, () => this.stmts.deleteClip.run(id))
  }

  saveSettings(): void {
    this.enqueue(this.pending.other, 'settings', () => {
      for (const [k, v] of Object.entries(this.data.settings))
        this.stmts.setSetting.run(k, JSON.stringify(v))
    })
  }

  /**
   * Commit everything queued in a single transaction. Cheap to call; no-op
   * when idle. A failing batch is retried row by row so one bad write can
   * neither poison the others nor crash the main process.
   */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const ops = [
      ...this.pending.folders.values(),
      ...this.pending.clips.values(),
      ...this.pending.other.values(),
    ]
    this.pending.folders.clear()
    this.pending.clips.clear()
    this.pending.other.clear()
    if (!ops.length || !this.db) return Promise.resolve()
    try {
      this.transaction(() => {
        for (const op of ops) op()
      })
    } catch (err) {
      console.error('[store] batch write failed, retrying individually:', err)
      for (const op of ops) {
        try {
          this.transaction(op)
        } catch (e) {
          console.error('[store] dropped write:', e)
        }
      }
    }
    return Promise.resolve()
  }

  async close(): Promise<void> {
    await this.flush()
    this.db?.close()
    this.db = null
  }

  // ------------------------------------------------------------ internals

  private enqueue(bucket: Map<string, () => void>, key: string, op: () => void): void {
    bucket.set(key, op)
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS)
  }

  private transaction(fn: () => void): void {
    const db = this.db!
    db.exec('BEGIN')
    try {
      fn()
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  private writeFolder(f: LibraryFolder): void {
    this.stmts.upsertFolder.run(
      f.id,
      f.path,
      f.name,
      f.addedAtMs,
      f.clipCount,
      f.available ? 1 : 0,
      f.kind,
    )
  }

  private writeClip(c: Clip): void {
    this.stmts.upsertClip.run(
      c.id,
      c.path,
      c.name,
      c.title,
      c.ext,
      c.folderId,
      c.game,
      c.size,
      c.mtimeMs,
      c.recordedAtMs,
      c.duration,
      c.width,
      c.height,
      c.fps,
      c.vcodec,
      c.hasAudio ? 1 : 0,
      c.thumb,
      c.sprite,
      c.spriteFrames,
      c.probeState,
      c.sourceId,
      c.trimStart,
      c.trimEnd,
      c.muted ? 1 : 0,
      c.createdAtMs,
    )
  }
}

function rowToClip(r: ClipRow): Clip {
  return {
    id: r.id,
    path: r.path,
    name: r.name,
    title: r.title,
    ext: r.ext,
    folderId: r.folder_id,
    game: r.game,
    size: r.size,
    mtimeMs: r.mtime_ms,
    recordedAtMs: r.recorded_at_ms,
    duration: r.duration,
    width: r.width,
    height: r.height,
    fps: r.fps,
    vcodec: r.vcodec,
    hasAudio: Boolean(r.has_audio),
    thumb: r.thumb,
    sprite: r.sprite,
    spriteFrames: r.sprite_frames,
    probeState: r.probe_state,
    sourceId: r.source_id,
    trimStart: r.trim_start,
    trimEnd: r.trim_end,
    muted: Boolean(r.muted),
    createdAtMs: r.created_at_ms,
  }
}
