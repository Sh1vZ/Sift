import type { ChangelogRelease } from './changelog'
import type {
  UploadJob,
  UploadRequest,
  YouTubeAccount,
  YouTubePlaylist,
  YouTubePrivacy,
  YouTubeState,
} from './youtube'
import type {
  ActionResult,
  AppStats,
  AudioExportRequest,
  Clip,
  EventMap,
  EventName,
  ExportJob,
  ExportRequest,
  GifExportRequest,
  LibraryFolder,
  LibrarySnapshot,
  Settings,
  UpdateState,
  WhatsNew,
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
    /**
     * Deletes every cached poster, scrub strip and HDR screenshot render. They
     * are rebuilt in the background from the clips that are still probed, so
     * the cards refill.
     */
    clearPreviews(): Promise<ActionResult & { files?: number }>
    /**
     * The clips whose cards are on screen. The preview queue serves them ahead
     * of the backlog, so what the user is looking at fills first.
     */
    setVisibleClips(ids: string[]): Promise<void>
    /** One clip wanted now — a card being hovered, a clip being opened: its preview job goes to the front. */
    bumpClip(id: string): Promise<void>
    setSettings(patch: Partial<Settings>): Promise<Settings>
    /**
     * Renames games, or merges several into one, for display only — nothing on
     * disk is renamed or moved. `sources` are `Clip.sourceGame` values; a null
     * display puts them back under the names their folders gave them.
     */
    setGameAlias(sources: string[], display: string | null): Promise<ActionResult>
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
    /** Puts the file itself on the clipboard, as Explorer's Copy does, for pasting anywhere. */
    copyFile(id: string): Promise<ActionResult>
    /** Queues a stream-copy export; progress arrives through `exports:changed`. */
    export(req: ExportRequest): Promise<ActionResult & { job?: ExportJob }>
    /**
     * The selection's audio alone, to a file the user picks in a save dialog
     * whose file type sets the format (see `AUDIO_EXPORT_FORMATS`). Resolves
     * `cancelled` when the dialog was dismissed; otherwise the job runs and
     * reports through `exports:changed` like a clip export.
     */
    exportAudio(
      req: AudioExportRequest,
    ): Promise<ActionResult & { job?: ExportJob; cancelled?: boolean }>
    /** The selection as an animated GIF, to a file the user picks; `cancelled` as for `exportAudio`. */
    exportGif(
      req: GifExportRequest,
    ): Promise<ActionResult & { job?: ExportJob; cancelled?: boolean }>
    /** Opens the clip's YouTube page in the browser. */
    openYouTube(id: string): Promise<ActionResult>
    /** Puts `https://youtu.be/<id>` on the system clipboard. */
    copyYouTubeLink(id: string): Promise<ActionResult>
    /** Deletes the video from YouTube (permanent) and forgets the id on the clip. */
    removeFromYouTube(id: string): Promise<ActionResult>
    /** Ask YouTube once, now, how the clip's video is doing. */
    checkOnYouTube(id: string): Promise<ActionResult>
    /** Stars the clip, or takes the star off. */
    setFavourite(id: string, favourite: boolean): Promise<ActionResult>
    /** Marks the clip watched (stamping the time) or back to unwatched. */
    setSeen(id: string, seen: boolean): Promise<ActionResult>
    /**
     * Cuts one audio track out to its own file and returns its name, for
     * `audioUrl`. Cached, so asking twice costs nothing the second time.
     * Refused for the default track: the <video> element already plays it.
     */
    audioTrack(id: string, index: number): Promise<ActionResult & { file?: string }>
    /**
     * The trim bar's filmstrip: keyframes from across the whole clip, cut when
     * asked for rather than at index time, and cached after that. Resolves
     * with the strip file (for `thumbUrl`) once every frame is on disk — at
     * once for a strip already cut. Asking for another clip's strip cancels
     * a cut in progress.
     */
    filmstrip(id: string): Promise<ActionResult & { film?: string; frames?: number }>
  }
  exports: {
    cancel(id: string): Promise<ActionResult>
    /** Drops a finished/failed job from the list ahead of its automatic pruning. */
    dismiss(id: string): Promise<void>
    /** Explorer on a finished job's file — while the job is still in the list. */
    reveal(id: string): Promise<ActionResult>
  }
  /** The History tab: finished work main kept. The list itself arrives in the snapshot and on `activity:changed`. */
  activity: {
    /** Explorer on the file a row is about: how an audio export, which has no clip to open, is found again. */
    reveal(id: string): Promise<ActionResult>
    /** Forgets one row. */
    remove(id: string): Promise<void>
    /** Forgets every row. */
    clear(): Promise<void>
  }
  youtube: {
    state(): Promise<YouTubeState>
    /** New project from pasted values. The secret is encrypted before it touches disk and never comes back. */
    addAccount(
      clientId: string,
      clientSecret: string,
      label: string,
    ): Promise<ActionResult & { account?: YouTubeAccount }>
    /** New project from the text of a `client_secret_*.json`. */
    addAccountJson(text: string): Promise<ActionResult & { account?: YouTubeAccount }>
    /** Native file picker for one or more `client_secret_*.json` files. */
    importAccountFiles(): Promise<ActionResult & { added: number; cancelled?: boolean }>
    renameAccount(id: string, label: string): Promise<ActionResult>
    /** Runs the browser sign-in for that project; resolves when it finished, failed or timed out. */
    connect(id: string): Promise<ActionResult>
    cancelConnect(): Promise<void>
    /** Revokes the token (best effort) and forgets the channel; the client stays for a one-click reconnect. */
    disconnect(id: string): Promise<ActionResult>
    /** Forgets the project entirely. */
    removeAccount(id: string): Promise<ActionResult>
    playlists(
      accountId: string,
      refresh?: boolean,
    ): Promise<ActionResult & { playlists?: YouTubePlaylist[] }>
    createPlaylist(
      accountId: string,
      title: string,
      privacy: YouTubePrivacy,
    ): Promise<ActionResult & { playlist?: YouTubePlaylist }>
  }
  uploads: {
    list(): Promise<UploadJob[]>
    /** Queues a resumable upload; progress arrives through `uploads:changed`. */
    start(req: UploadRequest): Promise<ActionResult & { job?: UploadJob }>
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
  /** Plays an extracted audio track; `file` comes from `clips.audioTrack`. */
  audioUrl(file: string): string
  /** Absolute path behind a dropped `File`; `''` for one that is not backed by disk. */
  pathForFile(file: File): string
}
