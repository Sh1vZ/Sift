import { DatabaseSync, type StatementSync } from 'node:sqlite'
import {
  ACTIVITY_CAP,
  DEFAULT_SETTINGS,
  type ActivityKind,
  type ActivityRecord,
  type ActivityStatus,
  type AudioTrack,
  type Clip,
  type LibraryFolder,
  type Settings,
} from '@shared/types'
import { isVideoStage } from '@shared/youtube'

interface LibraryData {
  folders: LibraryFolder[]
  clips: Record<string, Clip>
  settings: Settings
  /**
   * Display names the user gave games, keyed by the name the folder gave them.
   * Several sources pointing at one display name is a merge.
   */
  gameAliases: Record<string, string>
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
  // v3 -> v4: clips remember the YouTube video they were uploaded as, and the
  // Google projects used to upload them get a table of their own.
  (db) => {
    db.exec("ALTER TABLE clips ADD COLUMN youtube_id TEXT NOT NULL DEFAULT ''")
    db.exec(YOUTUBE_ACCOUNTS_TABLE)
  },
  // v4 -> v5: clips carry the two pieces of user state — starred, and watched.
  (db) => {
    db.exec('ALTER TABLE clips ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE clips ADD COLUMN seen_at_ms REAL NOT NULL DEFAULT 0')
  },
  // v5 -> v6: games can be renamed and merged for display. `source_game` keeps
  // the name the folder gave the clip, so a merge is undoable and can be
  // re-applied on a rescan; `game` becomes the name the app shows.
  (db) => {
    db.exec("ALTER TABLE clips ADD COLUMN source_game TEXT NOT NULL DEFAULT ''")
    db.exec('UPDATE clips SET source_game = game')
    db.exec(GAME_ALIASES_TABLE)
  },
  // v6 -> v7: clips remember what YouTube did with the video after the upload —
  // the stage survives a restart, and the project id tells Sift whose token may
  // ask after it. Existing rows keep '' / 0, which reads as "never asked".
  (db) => {
    db.exec("ALTER TABLE clips ADD COLUMN youtube_account_id TEXT NOT NULL DEFAULT ''")
    db.exec("ALTER TABLE clips ADD COLUMN youtube_stage TEXT NOT NULL DEFAULT ''")
    db.exec("ALTER TABLE clips ADD COLUMN youtube_reason TEXT NOT NULL DEFAULT ''")
    db.exec('ALTER TABLE clips ADD COLUMN youtube_checked_at_ms REAL NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE clips ADD COLUMN youtube_watch_until_ms REAL NOT NULL DEFAULT 0')
  },
  // v7 -> v8: finished work (exports, uploads, renames…) is kept as history
  // instead of vanishing seconds after the job ends.
  (db) => db.exec(ACTIVITY_TABLE),
  // v8 -> v9: clips carry their audio streams, so the player can offer the mic
  // and the game separately. needsWork() only re-enqueues a clip whose probe is
  // pending or whose artifacts went stale, so without the reset every clip
  // already indexed would keep an empty track list for good.
  (db) => {
    db.exec("ALTER TABLE clips ADD COLUMN audio_tracks TEXT NOT NULL DEFAULT ''")
    db.exec("UPDATE clips SET probe_state = 'pending' WHERE has_audio = 1")
  },
]
const SCHEMA_VERSION = MIGRATIONS.length + 1

/**
 * One row per Google Cloud project the user connected. Secrets are stored as
 * base64 of `safeStorage.encryptString` output, never in the clear; the quota
 * columns cache what Cloud Monitoring last reported plus Sift's own spend since.
 */
const YOUTUBE_ACCOUNTS_TABLE = `
CREATE TABLE IF NOT EXISTS youtube_accounts (
  id                 TEXT PRIMARY KEY,
  label              TEXT NOT NULL,
  project_id         TEXT NOT NULL DEFAULT '',
  client_id          TEXT NOT NULL,
  client_secret_enc  TEXT NOT NULL,
  refresh_token_enc  TEXT NOT NULL DEFAULT '',
  channel_json       TEXT NOT NULL DEFAULT '',
  quota_limit        INTEGER NOT NULL DEFAULT 10000,
  quota_limit_source TEXT NOT NULL DEFAULT 'default',
  quota_day          TEXT NOT NULL DEFAULT '',
  quota_google_used  INTEGER NOT NULL DEFAULT 0,
  quota_synced_at_ms REAL NOT NULL DEFAULT 0,
  quota_local_used   INTEGER NOT NULL DEFAULT 0,
  exhausted_until_ms REAL NOT NULL DEFAULT 0,
  added_at_ms        REAL NOT NULL,
  sort               INTEGER NOT NULL DEFAULT 0
);
`

/**
 * One row per folder-derived game name the user renamed or merged away. Absent
 * means "show the folder's own name", so clearing an alias is a DELETE.
 */
const GAME_ALIASES_TABLE = `
CREATE TABLE IF NOT EXISTS game_aliases (
  source  TEXT PRIMARY KEY,
  display TEXT NOT NULL
);
`

/**
 * One row per finished piece of work, capped at `ACTIVITY_CAP`. Every string
 * column defaults to '' so a row and an `ActivityRecord` have the same shape.
 */
const ACTIVITY_TABLE = `
CREATE TABLE IF NOT EXISTS activity (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  status         TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  detail         TEXT NOT NULL DEFAULT '',
  error          TEXT NOT NULL DEFAULT '',
  created_at_ms  REAL NOT NULL DEFAULT 0,
  finished_at_ms REAL NOT NULL DEFAULT 0,
  clip_id        TEXT NOT NULL DEFAULT '',
  game           TEXT NOT NULL DEFAULT '',
  video_id       TEXT NOT NULL DEFAULT '',
  path           TEXT NOT NULL DEFAULT ''
);
`

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
  created_at_ms  REAL NOT NULL DEFAULT 0,
  youtube_id     TEXT NOT NULL DEFAULT '',
  favourite      INTEGER NOT NULL DEFAULT 0,
  seen_at_ms     REAL NOT NULL DEFAULT 0,
  source_game    TEXT NOT NULL DEFAULT '',
  youtube_account_id     TEXT NOT NULL DEFAULT '',
  youtube_stage          TEXT NOT NULL DEFAULT '',
  youtube_reason         TEXT NOT NULL DEFAULT '',
  youtube_checked_at_ms  REAL NOT NULL DEFAULT 0,
  youtube_watch_until_ms REAL NOT NULL DEFAULT 0,
  audio_tracks   TEXT NOT NULL DEFAULT ''
);
${YOUTUBE_ACCOUNTS_TABLE}
${GAME_ALIASES_TABLE}
${ACTIVITY_TABLE}
`

/** Created after migrations run, since an index may name a column an older database only gains then. */
const INDEXES = `
CREATE INDEX IF NOT EXISTS clips_folder   ON clips(folder_id);
CREATE INDEX IF NOT EXISTS clips_game     ON clips(game);
CREATE INDEX IF NOT EXISTS clips_recorded ON clips(recorded_at_ms DESC);
CREATE INDEX IF NOT EXISTS clips_source   ON clips(source_id);
CREATE INDEX IF NOT EXISTS activity_finished ON activity(finished_at_ms DESC);
`

const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'export',
  'upload',
  'copy-file',
  'rename',
  'delete',
  'game-alias',
  'scan',
]
const ACTIVITY_STATUSES: readonly ActivityStatus[] = ['done', 'failed']
const isActivityKind = (v: string): v is ActivityKind => ACTIVITY_KINDS.includes(v as ActivityKind)
const isActivityStatus = (v: string): v is ActivityStatus =>
  ACTIVITY_STATUSES.includes(v as ActivityStatus)

interface ActivityRow {
  id: string
  kind: string
  status: string
  title: string
  detail: string
  error: string
  created_at_ms: number
  finished_at_ms: number
  clip_id: string
  game: string
  video_id: string
  path: string
}

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
  youtube_id: string
  favourite: number
  seen_at_ms: number
  source_game: string
  youtube_account_id: string
  youtube_stage: string
  youtube_reason: string
  youtube_checked_at_ms: number
  youtube_watch_until_ms: number
  audio_tracks: string
}

/** A `youtube_accounts` row as stored. The `_enc` columns hold base64 ciphertext or ''. */
export interface YouTubeAccountRow {
  id: string
  label: string
  project_id: string
  client_id: string
  client_secret_enc: string
  refresh_token_enc: string
  channel_json: string
  quota_limit: number
  quota_limit_source: string
  quota_day: string
  quota_google_used: number
  quota_synced_at_ms: number
  quota_local_used: number
  exhausted_until_ms: number
  added_at_ms: number
  sort: number
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
  data: LibraryData = {
    folders: [],
    clips: {},
    settings: { ...DEFAULT_SETTINGS },
    gameAliases: {},
  }

  private db: DatabaseSync | null = null
  private stmts!: {
    upsertFolder: StatementSync
    deleteFolder: StatementSync
    upsertClip: StatementSync
    deleteClip: StatementSync
    setSetting: StatementSync
    upsertAccount: StatementSync
    deleteAccount: StatementSync
    setGameAlias: StatementSync
    deleteGameAlias: StatementSync
    listActivity: StatementSync
    insertActivity: StatementSync
    trimActivity: StatementSync
    deleteActivity: StatementSync
    clearActivity: StatementSync
    rekeyActivityClip: StatementSync
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

    const aliases: Record<string, string> = {}
    for (const r of db
      .prepare('SELECT source, display FROM game_aliases')
      .all() as unknown as Array<{
      source: string
      display: string
    }>)
      aliases[r.source] = r.display
    this.data.gameAliases = aliases

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
          source_id, trim_start, trim_end, muted, created_at_ms, youtube_id, favourite, seen_at_ms,
          source_game, youtube_account_id, youtube_stage, youtube_reason, youtube_checked_at_ms,
          youtube_watch_until_ms, audio_tracks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          path = excluded.path, name = excluded.name, title = excluded.title, ext = excluded.ext,
          folder_id = excluded.folder_id, game = excluded.game, size = excluded.size,
          mtime_ms = excluded.mtime_ms, recorded_at_ms = excluded.recorded_at_ms,
          duration = excluded.duration, width = excluded.width, height = excluded.height, fps = excluded.fps,
          vcodec = excluded.vcodec, has_audio = excluded.has_audio, thumb = excluded.thumb,
          sprite = excluded.sprite, sprite_frames = excluded.sprite_frames, probe_state = excluded.probe_state,
          source_id = excluded.source_id, trim_start = excluded.trim_start, trim_end = excluded.trim_end,
          muted = excluded.muted, created_at_ms = excluded.created_at_ms,
          youtube_id = excluded.youtube_id, favourite = excluded.favourite,
          seen_at_ms = excluded.seen_at_ms, source_game = excluded.source_game,
          youtube_account_id = excluded.youtube_account_id, youtube_stage = excluded.youtube_stage,
          youtube_reason = excluded.youtube_reason,
          youtube_checked_at_ms = excluded.youtube_checked_at_ms,
          youtube_watch_until_ms = excluded.youtube_watch_until_ms,
          audio_tracks = excluded.audio_tracks`),
      deleteClip: db.prepare('DELETE FROM clips WHERE id = ?'),
      setSetting: db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ),
      upsertAccount: db.prepare(`
        INSERT INTO youtube_accounts (id, label, project_id, client_id, client_secret_enc,
          refresh_token_enc, channel_json, quota_limit, quota_limit_source, quota_day,
          quota_google_used, quota_synced_at_ms, quota_local_used, exhausted_until_ms, added_at_ms, sort)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label, project_id = excluded.project_id, client_id = excluded.client_id,
          client_secret_enc = excluded.client_secret_enc, refresh_token_enc = excluded.refresh_token_enc,
          channel_json = excluded.channel_json, quota_limit = excluded.quota_limit,
          quota_limit_source = excluded.quota_limit_source, quota_day = excluded.quota_day,
          quota_google_used = excluded.quota_google_used, quota_synced_at_ms = excluded.quota_synced_at_ms,
          quota_local_used = excluded.quota_local_used, exhausted_until_ms = excluded.exhausted_until_ms,
          added_at_ms = excluded.added_at_ms, sort = excluded.sort`),
      deleteAccount: db.prepare('DELETE FROM youtube_accounts WHERE id = ?'),
      setGameAlias: db.prepare(
        'INSERT INTO game_aliases (source, display) VALUES (?, ?) ON CONFLICT(source) DO UPDATE SET display = excluded.display',
      ),
      deleteGameAlias: db.prepare('DELETE FROM game_aliases WHERE source = ?'),
      listActivity: db.prepare(
        'SELECT * FROM activity ORDER BY finished_at_ms DESC, rowid DESC LIMIT ?',
      ),
      insertActivity: db.prepare(`
        INSERT INTO activity (id, kind, status, title, detail, error, created_at_ms,
          finished_at_ms, clip_id, game, video_id, path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      trimActivity: db.prepare(`
        DELETE FROM activity WHERE id NOT IN (
          SELECT id FROM activity ORDER BY finished_at_ms DESC, rowid DESC LIMIT ?)`),
      deleteActivity: db.prepare('DELETE FROM activity WHERE id = ?'),
      clearActivity: db.prepare('DELETE FROM activity'),
      rekeyActivityClip: db.prepare('UPDATE activity SET clip_id = ?, path = ? WHERE clip_id = ?'),
    }
  }

  // ---------------------------------------------------------------- activity
  // Written straight through, like game aliases: a handful of rows a session,
  // and the panel re-reads the list as soon as a write returns. Not part of
  // `data` — the `ActivityLog` in main is the only reader.

  listActivity(): ActivityRecord[] {
    if (!this.db) return []
    const rows = this.stmts.listActivity.all(ACTIVITY_CAP) as unknown as ActivityRow[]
    const records: ActivityRecord[] = []
    for (const r of rows) {
      // A row written by a future build with a kind this one cannot draw is
      // skipped rather than rendered as something it is not.
      if (!isActivityKind(r.kind) || !isActivityStatus(r.status)) continue
      records.push({
        id: r.id,
        kind: r.kind,
        status: r.status,
        title: r.title,
        detail: r.detail,
        error: r.error,
        createdAtMs: r.created_at_ms,
        finishedAtMs: r.finished_at_ms,
        clipId: r.clip_id,
        game: r.game,
        videoId: r.video_id,
        path: r.path,
      })
    }
    return records
  }

  /** Inserts and trims to the cap in one transaction, so the table never grows past it. */
  addActivity(r: ActivityRecord): void {
    if (!this.db) return
    this.transaction(() => {
      this.stmts.insertActivity.run(
        r.id,
        r.kind,
        r.status,
        r.title,
        r.detail,
        r.error,
        r.createdAtMs,
        r.finishedAtMs,
        r.clipId,
        r.game,
        r.videoId,
        r.path,
      )
      this.stmts.trimActivity.run(ACTIVITY_CAP)
    })
  }

  removeActivity(id: string): void {
    if (!this.db) return
    this.stmts.deleteActivity.run(id)
  }

  clearActivity(): void {
    if (!this.db) return
    this.stmts.clearActivity.run()
  }

  /**
   * Clip ids derive from the path, so a rename gives the clip a new id; the
   * rows about it follow, or every one of them would read as "clip gone".
   */
  rekeyActivityClip(oldId: string, newId: string, newPath: string): void {
    if (!this.db) return
    this.stmts.rekeyActivityClip.run(newId, newPath, oldId)
  }

  // ------------------------------------------------------------ game names

  /**
   * Sets or clears display names for folder-derived games, in one transaction.
   * A null display drops the row, putting the game back under its folder name.
   * Written straight through rather than through the coalescing flush: there
   * are a handful of rows, they change only when the user asks, and the games
   * grid re-reads `data.gameAliases` as soon as this returns.
   */
  writeGameAliases(entries: Array<[source: string, display: string | null]>): void {
    if (!this.db || !entries.length) return
    this.transaction(() => {
      for (const [source, display] of entries) {
        if (display) this.stmts.setGameAlias.run(source, display)
        else this.stmts.deleteGameAlias.run(source)
      }
    })
    for (const [source, display] of entries) {
      if (display) this.data.gameAliases[source] = display
      else delete this.data.gameAliases[source]
    }
  }

  // ------------------------------------------------------- youtube accounts
  // Not part of `data`: the rows carry ciphertext and are read once by the
  // YouTube module, which keeps its own working copy and never broadcasts them.

  listYouTubeAccounts(): YouTubeAccountRow[] {
    if (!this.db) return []
    return this.db
      .prepare('SELECT * FROM youtube_accounts ORDER BY sort, added_at_ms')
      .all() as unknown as YouTubeAccountRow[]
  }

  upsertYouTubeAccount(row: YouTubeAccountRow): void {
    this.enqueue(this.pending.other, `yt:${row.id}`, () => this.writeAccount(row))
  }

  deleteYouTubeAccount(id: string): void {
    this.enqueue(this.pending.other, `yt:${id}`, () => this.stmts.deleteAccount.run(id))
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
      c.youtubeId,
      c.favourite ? 1 : 0,
      c.seenAtMs,
      c.sourceGame,
      c.youtubeAccountId,
      c.youtubeStage,
      c.youtubeReason,
      c.youtubeCheckedAtMs,
      c.youtubeWatchUntilMs,
      JSON.stringify(c.audioTracks ?? []),
    )
  }

  private writeAccount(a: YouTubeAccountRow): void {
    this.stmts.upsertAccount.run(
      a.id,
      a.label,
      a.project_id,
      a.client_id,
      a.client_secret_enc,
      a.refresh_token_enc,
      a.channel_json,
      a.quota_limit,
      a.quota_limit_source,
      a.quota_day,
      a.quota_google_used,
      a.quota_synced_at_ms,
      a.quota_local_used,
      a.exhausted_until_ms,
      a.added_at_ms,
      a.sort,
    )
  }
}

/**
 * Rows written before the column existed hold '', and a row is not worth losing
 * over malformed JSON: either way the clip reads as untracked until its next
 * probe, which the v8 -> v9 migration has already queued.
 */
function parseTracks(raw: string): AudioTrack[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AudioTrack[]) : []
  } catch {
    return []
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
    // Databases migrated from v5 backfill this, but a row written by an older
    // build in between would not: fall back to the name it is shown under.
    sourceGame: r.source_game || r.game,
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
    youtubeId: r.youtube_id,
    youtubeAccountId: r.youtube_account_id,
    // Anything the column does not recognise reads as "never asked", so a row
    // written by a future build cannot put an unknown stage into the UI.
    youtubeStage: isVideoStage(r.youtube_stage) ? r.youtube_stage : '',
    youtubeReason: r.youtube_reason,
    youtubeCheckedAtMs: r.youtube_checked_at_ms,
    youtubeWatchUntilMs: r.youtube_watch_until_ms,
    audioTracks: parseTracks(r.audio_tracks),
    favourite: Boolean(r.favourite),
    seenAtMs: r.seen_at_ms,
  }
}
