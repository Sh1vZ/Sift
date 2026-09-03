import type {
  ActionResult,
  AppStats,
  Clip,
  EventMap,
  EventName,
  LibraryFolder,
  LibrarySnapshot,
  Settings
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
  }
  clips: {
    rename(id: string, name: string): Promise<ActionResult & { clip?: Clip }>
    delete(id: string): Promise<ActionResult>
    reveal(id: string): Promise<ActionResult>
    /** Puts the clip's absolute path on the system clipboard. */
    copyPath(id: string): Promise<ActionResult>
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
  }
  on<K extends EventName>(name: K, handler: (payload: EventMap[K]) => void): () => void
  mediaUrl(clipId: string): string
  thumbUrl(file: string): string
}
