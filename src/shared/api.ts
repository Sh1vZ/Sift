import type { ChangelogRelease } from './changelog'
import type {
  ActionResult,
  AppStats,
  Clip,
  EventMap,
  EventName,
  ExportJob,
  ExportRequest,
  LibraryFolder,
  LibrarySnapshot,
  Settings,
  UpdateState,
  WhatsNew
} from './types'

/** The surface exposed to the renderer as `window.api`. */
export interface Api {
  library: {
    snapshot(): Promise<LibrarySnapshot>
    /** Opens the native folder picker. */
    addFolder(): Promise<{ folder: LibraryFolder | null; error?: string }>
    addFolderPath(path: string): Promise<{ folder: LibraryFolder | null; error?: string }>
    removeFolder(id: string): Promise<ActionResult>
    rescan(folderId?: string): Promise<ActionResult>
    setSettings(patch: Partial<Settings>): Promise<Settings>
    /** Disk and runtime figures for the stats screen; measured on demand. */
    stats(): Promise<AppStats>
    /** Opens %APPDATA%/sift in the file manager. */
    revealData(): Promise<ActionResult>
    /** Moves the clips folder; `''` restores `<Videos>\Sift Clips`. Files on disk are never moved. */
    setClipsDir(path: string): Promise<ActionResult & { folder?: LibraryFolder }>
    /** Folder picker, then `setClipsDir`. `folder` is undefined when the picker was cancelled. */
    chooseClipsDir(): Promise<ActionResult & { folder?: LibraryFolder }>
    revealClipsDir(): Promise<ActionResult>
  }
  clips: {
    rename(id: string, name: string): Promise<ActionResult & { clip?: Clip }>
    /** Moves the file to the Recycle Bin; `permanent` erases it from disk instead. */
    delete(id: string, permanent?: boolean): Promise<ActionResult>
    reveal(id: string): Promise<ActionResult>
    /** Puts the clip's absolute path on the system clipboard. */
    copyPath(id: string): Promise<ActionResult>
    /** Queues a stream-copy export; progress arrives through `exports:changed`. */
    export(req: ExportRequest): Promise<ActionResult & { job?: ExportJob }>
  }
  exports: {
    cancel(id: string): Promise<ActionResult>
    /** Drops a finished/failed job from the list ahead of its automatic pruning. */
    dismiss(id: string): Promise<void>
  }
  updates: {
    /** Current updater state; safe to call before any check has run. */
    get(): Promise<UpdateState>
    /** Checks now, even when automatic checks are switched off. */
    check(): Promise<UpdateState>
    /**
     * Quits, installs the downloaded update and relaunches. No-op unless one is
     * ready. Fire-and-forget: the process is going away, so there is nothing to await.
     */
    install(): void
    /** Notes for the build now running, the first time it runs after an update. */
    whatsNew(): Promise<WhatsNew | null>
    /** Marks those notes read so they are not offered again. */
    dismissWhatsNew(): void
    /** Every version in the bundled changelog, newest first. */
    changelog(): Promise<ChangelogRelease[]>
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    /** The app has its first real frame — dismisses the launch splash and reveals the window. */
    ready(): void
    /**
     * Drops Chromium's in-renderer caches (decoded images, the resource cache).
     * Only releases what nothing still references, so call it *after* the
     * images have been unmounted, never before.
     */
    clearCache(): void
  }
  on<K extends EventName>(name: K, handler: (payload: EventMap[K]) => void): () => void
  mediaUrl(clipId: string): string
  thumbUrl(file: string): string
}
