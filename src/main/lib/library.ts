import { app, clipboard, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, type Stats } from 'node:fs'
import { mkdir, rename as fsRename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize } from 'node:path'
import type { FSWatcher } from 'chokidar'
import type {
  ActionResult,
  AppStats,
  Clip,
  ClipPatch,
  EventMap,
  EventName,
  ExportJob,
  ExportRequest,
  LibraryFolder,
  LibrarySnapshot,
  ScanState,
  Settings
} from '@shared/types'
import { cleanTitle, clipId, deriveGame, parseRecordedAt } from './clips'
import {
  INVALID_NAME,
  buildExportArgs,
  exportExt,
  parseProgressLine,
  safeGameDir,
  sanitizeName,
  uniqueName,
  validateExportRequest
} from './exports'
import {
  MediaQueue,
  ffmpegAvailable,
  makeArtifacts,
  probe,
  removeArtifacts,
  runLong,
  spriteName,
  thumbName
} from './media'
import { FFMPEG, cacheDir, libraryDb, userDataDir } from './paths'
import { walkVideos } from './scanner'
import { collectStats } from './stats'
import { Store } from './store'
import { watchFolder } from './watcher'

type Emit = <K extends EventName>(name: K, payload: EventMap[K]) => void

const FLUSH_MS = 150
const ADD_BATCH = 40
/** An export that prints nothing for this long is wedged, not slow. */
const EXPORT_STALL_MS = 30_000
const EXPORT_MAX_MS = 15 * 60_000
/** How long a finished job stays in the list for the progress card to show its end state. */
const EXPORT_PRUNE_DONE_MS = 10_000
const EXPORT_PRUNE_FAILED_MS = 30_000

const isTerminal = (j: ExportJob): boolean => j.state === 'done' || j.state === 'failed' || j.state === 'cancelled'

/**
 * Owns the library state and coordinates the store, folder scans, the ffmpeg
 * queue and folder watchers. Renderer-facing changes are batched and pushed
 * as events so a 3,000-clip scan does not turn into 3,000 IPC messages.
 */
export class Library {
  readonly store = new Store(libraryDb())
  private readonly media: MediaQueue
  private readonly watchers = new Map<string, FSWatcher>()
  private scanChain: Promise<void> = Promise.resolve()
  private readonly scanState: ScanState = { active: false, folder: '', found: 0, pending: 0, done: 0 }

  private added = new Map<string, Clip>()
  private updated = new Map<string, ClipPatch>()
  private removed = new Set<string>()
  private flushTimer: NodeJS.Timeout | null = null
  private scanTimer: NodeJS.Timeout | null = null

  /**
   * Exports run one at a time: a stream copy is bound by the disk, so a second
   * job would only slow the first, and one progress bar is easier to follow.
   * This is the one ffmpeg path outside MediaQueue, which is typed for
   * clip → patch probe/thumbnail work.
   */
  private readonly exports = new Map<string, ExportJob>()
  private readonly exportTargets = new Map<string, string>()
  private exportChain: Promise<void> = Promise.resolve()
  private exportAbort: AbortController | null = null
  private exportsTimer: NodeJS.Timeout | null = null

  constructor(private readonly emit: Emit) {
    this.media = new MediaQueue(
      (clip) => this.processClip(clip),
      (patch) => this.applyPatch(patch)
    )
    this.media.onProgress = (pending) => {
      this.scanState.pending = pending
      this.scheduleScanEmit()
    }
  }

  async init(): Promise<void> {
    await this.store.load()
    this.media.concurrency = this.settings.concurrency
    this.ensureClipsFolder()
    for (const folder of this.store.data.folders) {
      folder.available = existsSync(folder.path)
      this.store.upsertFolder(folder)
      if (folder.available) {
        this.startWatcher(folder)
        this.queueScan(folder)
      }
    }
  }

  async shutdown(): Promise<void> {
    // The running export removes its own temp file on abort; wait for that.
    this.exportAbort?.abort()
    await this.exportChain.catch(() => undefined)
    this.media.stop()
    for (const w of this.watchers.values()) await w.close().catch(() => undefined)
    this.watchers.clear()
    await this.store.close()
  }

  get settings(): Settings {
    return this.store.data.settings
  }

  clipPath(id: string): string | undefined {
    return this.store.data.clips[id]?.path
  }

  snapshot(): LibrarySnapshot {
    const videos = app.getPath('videos')
    return {
      folders: this.store.data.folders,
      clips: Object.values(this.store.data.clips),
      settings: this.settings,
      scan: { ...this.scanState },
      exports: [...this.exports.values()].map((j) => ({ ...j })),
      appVersion: app.getVersion(),
      suggestedFolders: existsSync(videos) ? [videos] : [],
      defaultClipsDir: this.defaultClipsDir()
    }
  }

  /**
   * Disk and runtime figures for the stats screen. Pending writes are flushed
   * first so the reported index size matches what is actually on disk.
   */
  async stats(): Promise<AppStats> {
    await this.store.flush()
    return collectStats()
  }

  async revealData(): Promise<ActionResult> {
    const error = await shell.openPath(userDataDir())
    return error ? { ok: false, error } : { ok: true }
  }

  // ---------------------------------------------------------------- folders

  addFolder(rawPath: string): { folder: LibraryFolder | null; error?: string } {
    const path = normalize(rawPath).replace(/[\\/]+$/, '')
    const lower = path.toLowerCase()
    if (this.isUnderClipsRoot(path)) {
      return { folder: null, error: 'That is your Sift Clips folder — its clips already show under Clips.' }
    }
    for (const f of this.store.data.folders) {
      // The clips folder may sit inside a library root: scans skip it.
      if (f.kind === 'clips') continue
      const existing = f.path.toLowerCase()
      if (existing === lower) return { folder: f }
      if (lower.startsWith(existing + '\\') || lower.startsWith(existing + '/')) {
        return { folder: null, error: `That folder is already covered by "${f.name}".` }
      }
      if (existing.startsWith(lower + '\\') || existing.startsWith(lower + '/')) {
        return {
          folder: null,
          error: `"${f.name}" sits inside this folder. Remove it first to avoid indexing clips twice.`
        }
      }
    }
    const folder: LibraryFolder = {
      id: clipId(path),
      path,
      name: basename(path) || path,
      addedAtMs: Date.now(),
      clipCount: 0,
      available: existsSync(path),
      kind: 'library'
    }
    this.store.data.folders.push(folder)
    this.store.upsertFolder(folder)
    this.emitFolders()
    if (folder.available) {
      this.startWatcher(folder)
      this.queueScan(folder)
    }
    return { folder }
  }

  async removeFolder(id: string): Promise<ActionResult> {
    const folders = this.store.data.folders
    const index = folders.findIndex((f) => f.id === id)
    if (index < 0) return { ok: false, error: 'Folder not found.' }
    if (folders[index].kind === 'clips') {
      return { ok: false, error: 'The clips folder cannot be removed. Change it under Settings → Clips instead.' }
    }
    const [folder] = folders.splice(index, 1)
    await this.stopWatcher(folder.id)
    for (const clip of Object.values(this.store.data.clips)) {
      if (clip.folderId === folder.id) this.dropClip(clip)
    }
    this.store.deleteFolder(folder.id)
    this.emitFolders()
    return { ok: true }
  }

  rescan(folderId?: string): ActionResult {
    const targets = folderId
      ? this.store.data.folders.filter((f) => f.id === folderId)
      : this.store.data.folders
    for (const folder of targets) {
      folder.available = existsSync(folder.path)
      this.store.upsertFolder(folder)
      if (folder.available) this.queueScan(folder)
    }
    this.emitFolders()
    return { ok: true }
  }

  // ----------------------------------------------------------- clips folder

  defaultClipsDir(): string {
    return join(app.getPath('videos'), 'Sift Clips')
  }

  clipsFolder(): LibraryFolder | undefined {
    return this.store.data.folders.find((f) => f.kind === 'clips')
  }

  private clipsRoot(): string {
    return this.clipsFolder()?.path ?? this.defaultClipsDir()
  }

  private isUnderClipsRoot(p: string): boolean {
    const root = this.clipsRoot().toLowerCase()
    const q = p.toLowerCase()
    return q === root || q.startsWith(root + '\\') || q.startsWith(root + '/')
  }

  /** The clips folder row always exists; the directory itself is created by the first export. */
  private ensureClipsFolder(): void {
    if (this.clipsFolder()) return
    const path = this.defaultClipsDir()
    const folder: LibraryFolder = {
      id: clipId(path),
      path,
      name: basename(path) || path,
      addedAtMs: Date.now(),
      clipCount: 0,
      available: existsSync(path),
      kind: 'clips'
    }
    this.store.data.folders.push(folder)
    this.store.upsertFolder(folder)
  }

  /** `''` restores the default. Exports already on disk stay where they are; only the index moves. */
  async setClipsDir(raw: string): Promise<ActionResult & { folder?: LibraryFolder }> {
    const path = (raw.trim() ? normalize(raw.trim()) : this.defaultClipsDir()).replace(/[\\/]+$/, '')
    const lower = path.toLowerCase()
    for (const f of this.store.data.folders) {
      if (f.kind !== 'library') continue
      const existing = f.path.toLowerCase()
      if (existing === lower) return { ok: false, error: `"${f.name}" is a watched folder. Pick a folder that is not one.` }
      if (existing.startsWith(lower + '\\') || existing.startsWith(lower + '/')) {
        return { ok: false, error: `"${f.name}" sits inside that folder, so its recordings would be indexed twice.` }
      }
    }
    const current = this.clipsFolder()
    if (current && current.path.toLowerCase() === lower) return { ok: true, folder: current }
    if ([...this.exports.values()].some((j) => !isTerminal(j))) {
      return { ok: false, error: 'Wait for the current export to finish first.' }
    }
    if (current) {
      await this.stopWatcher(current.id)
      for (const clip of Object.values(this.store.data.clips)) {
        if (clip.folderId === current.id) this.dropClip(clip)
      }
      this.store.data.folders.splice(this.store.data.folders.indexOf(current), 1)
      this.store.deleteFolder(current.id)
    }
    const folder: LibraryFolder = {
      id: clipId(path),
      path,
      name: basename(path) || path,
      addedAtMs: Date.now(),
      clipCount: 0,
      available: existsSync(path),
      kind: 'clips'
    }
    this.store.data.folders.push(folder)
    this.store.upsertFolder(folder)
    this.emitFolders()
    if (folder.available) {
      this.startWatcher(folder)
      this.queueScan(folder)
    }
    return { ok: true, folder }
  }

  async revealClipsDir(): Promise<ActionResult> {
    const path = this.clipsRoot()
    if (!existsSync(path)) {
      return { ok: false, error: 'The clips folder does not exist yet — your first export creates it.' }
    }
    const error = await shell.openPath(path)
    return error ? { ok: false, error } : { ok: true }
  }

  // --------------------------------------------------------------- settings

  setSettings(patch: Partial<Settings>): Settings {
    const before = { ...this.settings }
    Object.assign(this.settings, patch)
    this.store.saveSettings()
    const s = this.settings

    if (before.watchFolders !== s.watchFolders) {
      for (const folder of this.store.data.folders) {
        if (s.watchFolders && folder.available) this.startWatcher(folder)
        else void this.stopWatcher(folder.id)
      }
    }
    if (before.concurrency !== s.concurrency) {
      this.media.concurrency = Math.max(1, Math.min(4, s.concurrency))
    }
    if (!before.generateThumbnails && s.generateThumbnails) {
      for (const clip of Object.values(this.store.data.clips)) {
        if (clip.probeState === 'ok' && !clip.thumb) this.media.enqueue(clip)
      }
    }
    this.emit('settings:changed', { ...s })
    return s
  }

  // ------------------------------------------------------------------ clips

  async renameClip(id: string, newName: string): Promise<ActionResult & { clip?: Clip }> {
    const clip = this.store.data.clips[id]
    if (!clip) return { ok: false, error: 'Clip not found.' }
    const name = newName.trim()
    if (!name) return { ok: false, error: 'Name cannot be empty.' }
    if (INVALID_NAME.test(name)) return { ok: false, error: 'Name contains characters Windows does not allow.' }
    if (name === clip.name) return { ok: true, clip }

    const target = join(dirname(clip.path), name + clip.ext)
    if (existsSync(target)) return { ok: false, error: 'A file with that name already exists.' }
    try {
      await fsRename(clip.path, target)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }

    // Ids derive from the path, so a rename produces a new record. Cached
    // artifacts are moved along so nothing needs regenerating.
    const next: Clip = { ...clip, id: clipId(target), path: target, name, title: cleanTitle(name, clip.game) }
    if (clip.thumb) {
      next.thumb = thumbName(next)
      await fsRename(join(cacheDir(), clip.thumb), join(cacheDir(), next.thumb)).catch(() => (next.thumb = ''))
    }
    if (clip.sprite) {
      next.sprite = spriteName(next)
      await fsRename(join(cacheDir(), clip.sprite), join(cacheDir(), next.sprite)).catch(() => (next.sprite = ''))
    }
    delete this.store.data.clips[clip.id]
    this.store.data.clips[next.id] = next
    this.store.deleteClip(clip.id)
    this.store.upsertClip(next)
    this.removed.add(clip.id)
    this.added.set(next.id, next)
    this.scheduleFlush()
    if (!next.thumb || !next.sprite) this.media.enqueue(next, true)
    return { ok: true, clip: next }
  }

  async deleteClip(id: string): Promise<ActionResult> {
    const clip = this.store.data.clips[id]
    if (!clip) return { ok: false, error: 'Clip not found.' }
    try {
      await shell.trashItem(clip.path)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
    this.dropClip(clip)
    return { ok: true }
  }

  reveal(id: string): ActionResult {
    const clip = this.store.data.clips[id]
    if (!clip) return { ok: false, error: 'Clip not found.' }
    shell.showItemInFolder(clip.path)
    return { ok: true }
  }

  copyPath(id: string): ActionResult {
    const clip = this.store.data.clips[id]
    if (!clip) return { ok: false, error: 'Clip not found.' }
    clipboard.writeText(clip.path)
    return { ok: true }
  }

  // ---------------------------------------------------------------- exports

  async exportClip(req: ExportRequest): Promise<ActionResult & { job?: ExportJob }> {
    if (!ffmpegAvailable()) return { ok: false, error: 'ffmpeg is not available in this build.' }
    const source = this.store.data.clips[req.id]
    const invalid = validateExportRequest(req, source)
    if (invalid || !source) return { ok: false, error: invalid ?? 'Clip not found.' }
    if (!existsSync(source.path)) return { ok: false, error: 'The source file is no longer on disk.' }

    const folder = this.clipsFolder()
    if (!folder) return { ok: false, error: 'No clips folder is configured.' }
    const dir = join(folder.path, safeGameDir(source.game))
    try {
      await mkdir(dir, { recursive: true })
    } catch (err) {
      return { ok: false, error: `Could not create ${dir}: ${(err as Error).message}` }
    }
    if (!folder.available) {
      folder.available = true
      this.store.upsertFolder(folder)
      this.emitFolders()
      this.startWatcher(folder)
    }

    const ext = exportExt(source.ext)
    const base = sanitizeName(req.name).name ?? 'Clip'
    const targets = new Set([...this.exportTargets.values()].map((p) => p.toLowerCase()))
    const name = uniqueName(base, (candidate) => {
      const target = join(dir, candidate + ext)
      return (
        existsSync(target) || Boolean(this.store.data.clips[clipId(target)]) || targets.has(target.toLowerCase())
      )
    })
    const job: ExportJob = {
      id: randomUUID().slice(0, 8),
      sourceId: source.id,
      sourceThumb: source.thumb,
      game: source.game,
      name,
      ext,
      start: Math.max(0, req.start),
      end: Math.min(req.end, source.duration),
      muted: req.muted && source.hasAudio,
      state: 'queued',
      progress: 0,
      createdAtMs: Date.now()
    }
    this.exports.set(job.id, job)
    this.exportTargets.set(job.id, join(dir, name + ext))
    this.scheduleExportsEmit(true)
    this.exportChain = this.exportChain.then(() => this.runExportJob(job, source, dir)).catch(() => undefined)
    return { ok: true, job: { ...job } }
  }

  cancelExport(id: string): ActionResult {
    const job = this.exports.get(id)
    if (!job) return { ok: false, error: 'Export not found.' }
    if (job.state === 'queued') {
      job.state = 'cancelled'
      this.exportTargets.delete(job.id)
      this.scheduleExportsEmit(true)
      this.pruneLater(job)
    } else if (job.state === 'running') {
      this.exportAbort?.abort()
    }
    return { ok: true }
  }

  dismissExport(id: string): void {
    const job = this.exports.get(id)
    if (!job || !isTerminal(job)) return
    this.exports.delete(id)
    this.scheduleExportsEmit(true)
  }

  private async runExportJob(job: ExportJob, source: Clip, dir: string): Promise<void> {
    if (job.state !== 'queued') return
    const out = join(dir, job.name + job.ext)
    // `~` names are invisible to the scanner and the watcher, so a half-written
    // export can never be indexed; it is renamed into place once ffmpeg is done.
    const tmp = join(dir, '~' + job.name + job.ext)
    job.state = 'running'
    this.scheduleExportsEmit(true)
    const abort = new AbortController()
    this.exportAbort = abort
    const span = job.end - job.start
    try {
      const args = buildExportArgs({
        src: source.path,
        out: tmp,
        start: job.start,
        end: job.end,
        muted: job.muted,
        vcodec: source.vcodec
      })
      const { code, stderrTail } = await runLong(FFMPEG, args, {
        stallMs: EXPORT_STALL_MS,
        maxMs: EXPORT_MAX_MS,
        signal: abort.signal,
        onLine: (line) => {
          const t = parseProgressLine(line)
          if (t === null || span <= 0) return
          job.progress = Math.min(1, t / span)
          this.scheduleExportsEmit()
        }
      })
      if (abort.signal.aborted) throw new Error('Export cancelled.')
      if (code !== 0) throw new Error(stderrTail || `ffmpeg exited with code ${code}`)
      await fsRename(tmp, out)
      const st = await stat(out)
      const folder = this.clipsFolder()
      if (!folder) throw new Error('The clips folder was removed during the export.')

      const clip: Clip = {
        id: clipId(out),
        path: out,
        name: job.name,
        title: cleanTitle(job.name, job.game),
        ext: job.ext,
        folderId: folder.id,
        game: job.game,
        size: st.size,
        mtimeMs: st.mtimeMs,
        recordedAtMs: source.recordedAtMs,
        duration: span,
        width: source.width,
        height: source.height,
        fps: source.fps,
        vcodec: source.vcodec,
        hasAudio: source.hasAudio && !job.muted,
        thumb: '',
        sprite: '',
        spriteFrames: 0,
        probeState: 'pending',
        sourceId: source.id,
        trimStart: job.start,
        trimEnd: job.end,
        muted: job.muted,
        createdAtMs: Date.now()
      }
      const previous = this.store.data.clips[clip.id]
      if (previous) void removeArtifacts(previous)
      this.store.data.clips[clip.id] = clip
      this.store.upsertClip(clip)
      this.added.set(clip.id, clip)
      this.scheduleFlush()
      // The user is waiting for this poster: ahead of the backlog.
      this.media.remove(clip.id)
      this.media.enqueue(clip, true)
      if (!previous) {
        folder.clipCount++
        this.store.upsertFolder(folder)
        this.emitFolders()
      }
      job.progress = 1
      job.state = 'done'
      job.clipId = clip.id
    } catch (err) {
      // Only ever our own partial file — never a user's clip.
      await unlink(tmp).catch(() => undefined)
      if (abort.signal.aborted) {
        job.state = 'cancelled'
      } else {
        job.state = 'failed'
        job.error = (err as Error).message
      }
    } finally {
      this.exportAbort = null
      this.exportTargets.delete(job.id)
      this.scheduleExportsEmit(true)
      this.pruneLater(job)
    }
  }

  private pruneLater(job: ExportJob): void {
    const delay = job.state === 'done' ? EXPORT_PRUNE_DONE_MS : EXPORT_PRUNE_FAILED_MS
    setTimeout(() => {
      if (this.exports.get(job.id) !== job || !isTerminal(job)) return
      this.exports.delete(job.id)
      this.scheduleExportsEmit(true)
    }, delay)
  }

  // --------------------------------------------------------------- scanning

  private queueScan(folder: LibraryFolder): void {
    this.scanChain = this.scanChain.then(() => this.scanFolder(folder)).catch(() => undefined)
  }

  private async scanFolder(folder: LibraryFolder): Promise<void> {
    if (!this.store.data.folders.some((f) => f.id === folder.id)) return
    this.scanState.active = true
    this.scanState.folder = folder.name
    this.scanState.found = 0
    this.scheduleScanEmit(true)

    const seen = new Set<string>()
    let count = 0
    // A library root may contain the clips folder; those files belong to the Clips view only.
    const skip = folder.kind === 'library' ? (dir: string) => this.isUnderClipsRoot(dir) : undefined
    for await (const file of walkVideos(folder.path, { skip })) {
      const id = clipId(file)
      seen.add(id)
      count++
      let st: Stats
      try {
        st = await stat(file)
      } catch {
        continue
      }
      const existing = this.store.data.clips[id]
      if (existing && existing.size === st.size && Math.abs(existing.mtimeMs - st.mtimeMs) < 1000) {
        if (this.needsWork(existing)) this.media.enqueue(existing)
        continue
      }
      this.upsertClip(folder, file, st, existing)
      this.scanState.found++
      if (this.added.size >= ADD_BATCH) this.flushEvents()
      else this.scheduleFlush()
    }

    for (const clip of Object.values(this.store.data.clips)) {
      if (clip.folderId === folder.id && !seen.has(clip.id)) this.dropClip(clip)
    }
    folder.clipCount = count
    this.store.upsertFolder(folder)
    this.emitFolders()

    this.scanState.active = false
    this.scanState.folder = ''
    this.scheduleScanEmit(true)
  }

  private needsWork(clip: Clip): boolean {
    if (clip.probeState === 'pending') return true
    if (clip.probeState === 'failed') return false
    return this.settings.generateThumbnails && (!clip.thumb || !clip.sprite)
  }

  private upsertClip(folder: LibraryFolder, file: string, st: Stats, previous?: Clip): Clip {
    if (previous) void removeArtifacts(previous)
    const ext = extname(file)
    const name = basename(file, ext)
    const game = deriveGame(folder, file)
    const clip: Clip = {
      id: clipId(file),
      path: file,
      name,
      title: cleanTitle(name, game),
      ext,
      folderId: folder.id,
      game,
      size: st.size,
      mtimeMs: st.mtimeMs,
      recordedAtMs: parseRecordedAt(name) ?? Math.min(st.birthtimeMs || st.mtimeMs, st.mtimeMs),
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
      // Provenance survives a re-index of a changed file; a foreign file in the
      // clips folder counts from when it appeared there.
      sourceId: previous?.sourceId ?? '',
      trimStart: previous?.trimStart ?? 0,
      trimEnd: previous?.trimEnd ?? 0,
      muted: previous?.muted ?? false,
      createdAtMs: previous?.createdAtMs ?? (folder.kind === 'clips' ? st.birthtimeMs || st.mtimeMs : 0)
    }
    this.store.data.clips[clip.id] = clip
    this.store.upsertClip(clip)
    this.added.set(clip.id, clip)
    this.media.enqueue(clip)
    return clip
  }

  private dropClip(clip: Clip): void {
    delete this.store.data.clips[clip.id]
    this.store.deleteClip(clip.id)
    this.media.remove(clip.id)
    void removeArtifacts(clip)
    this.added.delete(clip.id)
    this.updated.delete(clip.id)
    this.removed.add(clip.id)
    this.scheduleFlush()
  }

  // ------------------------------------------------------------- media jobs

  private async processClip(clip: Clip): Promise<ClipPatch> {
    if (!ffmpegAvailable()) return { id: clip.id, probeState: 'failed' }
    const info = await probe(clip.path)
    this.applyPatch({ id: clip.id, ...info, probeState: 'ok' })
    if (!this.settings.generateThumbnails || info.duration <= 0) return { id: clip.id }

    // Poster and scrub strip come out of one ffmpeg run; anything already
    // cached on disk is skipped inside makeArtifacts.
    const current = this.store.data.clips[clip.id]
    if (!current) return { id: clip.id }
    if (!current.thumb || !current.sprite) {
      try {
        this.applyPatch({ id: clip.id, ...(await makeArtifacts(current, info.duration)) })
      } catch {
        /* the card falls back to a placeholder and hover preview stays off */
      }
    }
    return { id: clip.id }
  }

  private applyPatch(patch: ClipPatch): void {
    const clip = this.store.data.clips[patch.id]
    if (!clip) return
    Object.assign(clip, patch)
    this.store.upsertClip(clip)
    if (this.added.has(patch.id)) {
      // Not sent yet: the pending "added" payload already carries the new fields.
      return
    }
    this.updated.set(patch.id, { ...(this.updated.get(patch.id) ?? { id: patch.id }), ...patch })
    this.scheduleFlush()
  }

  // --------------------------------------------------------------- watchers

  private startWatcher(folder: LibraryFolder): void {
    if (!this.settings.watchFolders || this.watchers.has(folder.id)) return
    const ignored = folder.kind === 'library' ? (p: string) => this.isUnderClipsRoot(p) : undefined
    const watcher = watchFolder(
      folder.path,
      {
        onAdd: (p) => void this.onFileSeen(folder, p, true),
        onChange: (p) => void this.onFileSeen(folder, p, false),
        onRemove: (p) => {
          const clip = this.store.data.clips[clipId(p)]
          if (clip) this.dropClip(clip)
        }
      },
      ignored
    )
    this.watchers.set(folder.id, watcher)
  }

  private async stopWatcher(folderId: string): Promise<void> {
    const w = this.watchers.get(folderId)
    if (!w) return
    this.watchers.delete(folderId)
    await w.close().catch(() => undefined)
  }

  private async onFileSeen(folder: LibraryFolder, file: string, isNew: boolean): Promise<void> {
    if (folder.kind === 'library' && this.isUnderClipsRoot(file)) return
    let st: Stats
    try {
      st = await stat(file)
    } catch {
      return
    }
    const existing = this.store.data.clips[clipId(file)]
    // Also what makes our own finished export a no-op here: the record was
    // written from the same stat before the watcher settled.
    if (existing && existing.size === st.size && Math.abs(existing.mtimeMs - st.mtimeMs) < 1000) return
    const clip = this.upsertClip(folder, file, st, existing)
    if (isNew) {
      folder.clipCount++
      this.store.upsertFolder(folder)
      this.emitFolders()
      // A clip you just saved should get its thumbnail before the backlog.
      this.media.remove(clip.id)
      this.media.enqueue(clip, true)
    }
    this.scheduleFlush()
  }

  // ----------------------------------------------------------------- events

  private emitFolders(): void {
    this.emit('folders:changed', this.store.data.folders.map((f) => ({ ...f })))
  }

  private scheduleScanEmit(now = false): void {
    if (now) {
      if (this.scanTimer) clearTimeout(this.scanTimer)
      this.scanTimer = null
      this.emit('scan:changed', { ...this.scanState })
      return
    }
    if (this.scanTimer) return
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null
      this.emit('scan:changed', { ...this.scanState })
    }, 250)
  }

  private scheduleExportsEmit(now = false): void {
    const send = (): void => this.emit('exports:changed', [...this.exports.values()].map((j) => ({ ...j })))
    if (now) {
      if (this.exportsTimer) clearTimeout(this.exportsTimer)
      this.exportsTimer = null
      send()
      return
    }
    if (this.exportsTimer) return
    this.exportsTimer = setTimeout(() => {
      this.exportsTimer = null
      send()
    }, 250)
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => this.flushEvents(), FLUSH_MS)
  }

  private flushEvents(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    if (this.removed.size) {
      this.emit('clips:removed', [...this.removed])
      this.removed.clear()
    }
    if (this.added.size) {
      this.emit('clips:added', [...this.added.values()].map((c) => ({ ...c })))
      this.added.clear()
    }
    if (this.updated.size) {
      this.emit('clips:updated', [...this.updated.values()])
      this.updated.clear()
    }
  }
}
