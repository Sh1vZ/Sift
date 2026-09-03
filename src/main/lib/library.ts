import { app, shell } from 'electron'
import { existsSync, type Stats } from 'node:fs'
import { rename as fsRename, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize } from 'node:path'
import type { FSWatcher } from 'chokidar'
import type {
  ActionResult,
  AppStats,
  Clip,
  ClipPatch,
  EventMap,
  EventName,
  LibraryFolder,
  LibrarySnapshot,
  ScanState,
  Settings
} from '@shared/types'
import { cleanTitle, clipId, deriveGame, parseRecordedAt } from './clips'
import {
  MediaQueue,
  ffmpegAvailable,
  makeSprite,
  makeThumb,
  probe,
  removeArtifacts,
  spriteName,
  thumbName
} from './media'
import { cacheDir, libraryDb, userDataDir } from './paths'
import { walkVideos } from './scanner'
import { collectStats } from './stats'
import { Store } from './store'
import { watchFolder } from './watcher'

type Emit = <K extends EventName>(name: K, payload: EventMap[K]) => void

const FLUSH_MS = 150
const ADD_BATCH = 40
const INVALID_NAME = /[<>:"/\\|?*]/

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
      appVersion: app.getVersion(),
      suggestedFolders: existsSync(videos) ? [videos] : []
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
    for (const f of this.store.data.folders) {
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
      available: existsSync(path)
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
    for await (const file of walkVideos(folder.path)) {
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
      probeState: 'pending'
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

    // Poster first so the card fills in as early as possible; the scrub strip
    // is the nice-to-have and lands a moment later.
    const current = this.store.data.clips[clip.id]
    if (!current) return { id: clip.id }
    if (!current.thumb) {
      try {
        this.applyPatch({ id: clip.id, thumb: await makeThumb(current, info.duration) })
      } catch {
        /* keep going: the card falls back to a placeholder */
      }
    }
    if (!current.sprite) {
      try {
        const s = await makeSprite(current, info.duration)
        this.applyPatch({ id: clip.id, sprite: s.file, spriteFrames: s.frames })
      } catch {
        /* hover preview simply stays off for this clip */
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
    const watcher = watchFolder(folder.path, {
      onAdd: (p) => void this.onFileSeen(folder, p, true),
      onChange: (p) => void this.onFileSeen(folder, p, false),
      onRemove: (p) => {
        const clip = this.store.data.clips[clipId(p)]
        if (clip) this.dropClip(clip)
      }
    })
    this.watchers.set(folder.id, watcher)
  }

  private async stopWatcher(folderId: string): Promise<void> {
    const w = this.watchers.get(folderId)
    if (!w) return
    this.watchers.delete(folderId)
    await w.close().catch(() => undefined)
  }

  private async onFileSeen(folder: LibraryFolder, file: string, isNew: boolean): Promise<void> {
    let st: Stats
    try {
      st = await stat(file)
    } catch {
      return
    }
    const existing = this.store.data.clips[clipId(file)]
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
