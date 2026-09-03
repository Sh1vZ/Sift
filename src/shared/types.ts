/** Types shared between the main process, the preload bridge and the renderer. */

export type ProbeState = 'pending' | 'ok' | 'failed'

export interface Clip {
  /** Stable id derived from the absolute file path. */
  id: string
  path: string
  /** File name without extension. */
  name: string
  /** Cleaned-up display title (ShadowPlay date/DVR noise stripped). */
  title: string
  ext: string
  folderId: string
  /** Group the clip belongs to — the sub-folder name, i.e. the game. */
  game: string
  size: number
  mtimeMs: number
  /** Best-effort recording time: parsed from the file name, else birthtime/mtime. */
  recordedAtMs: number
  duration: number
  width: number
  height: number
  fps: number
  vcodec: string
  hasAudio: boolean
  /** File names inside the cache dir, empty when not generated (yet). */
  thumb: string
  sprite: string
  spriteFrames: number
  probeState: ProbeState
  /** Id of the recording this clip was exported from; '' for recordings and foreign files. */
  sourceId: string
  /** Requested trim range in source seconds; both 0 when not an export. */
  trimStart: number
  trimEnd: number
  /** Audio stripped on export. */
  muted: boolean
  /** Export time; for files copied into the clips folder by hand, the file's birthtime; 0 for recordings. */
  createdAtMs: number
}

/**
 * `library` folders are watched recording roots that feed the Games screen;
 * the single `clips` folder is where Sift exports trimmed clips to, and it
 * feeds the Clips view instead. Library scans skip anything under it.
 */
export type FolderKind = 'library' | 'clips'

export interface LibraryFolder {
  id: string
  path: string
  name: string
  addedAtMs: number
  clipCount: number
  /** False when the drive/folder is not reachable right now; clips are kept, not dropped. */
  available: boolean
  kind: FolderKind
}

// ---------------------------------------------------------------- exports

export type ExportState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/** What the editor asks for. Validated again in main; never trusted as-is. */
export interface ExportRequest {
  /** Source clip id. */
  id: string
  /** File name without extension. */
  name: string
  start: number
  end: number
  muted: boolean
}

export interface ExportJob {
  id: string
  sourceId: string
  /** Poster of the source, so the progress card has a picture from the first frame. */
  sourceThumb: string
  game: string
  /** Final file name without extension, after collision suffixing. */
  name: string
  ext: string
  start: number
  end: number
  muted: boolean
  state: ExportState
  /** 0..1 */
  progress: number
  error?: string
  /** Set once the exported file is in the index. */
  clipId?: string
  createdAtMs: number
}

export type GroupBy = 'date' | 'none'
export type SortBy = 'newest' | 'oldest' | 'name' | 'duration' | 'size'
export type GridSize = 'compact' | 'comfortable' | 'large'

/**
 * Colour theme for the renderer chrome. Every id is a `html[data-theme]` block
 * in `tokens.css`; the renderer's `useTheme` composable carries the labels.
 */
export const THEME_IDS = [
  'sift',
  'ember',
  'arctic',
  'synthwave',
  'verdant',
  'crimson',
  'solar',
  'oled',
  'oled-mint',
  'oled-frost',
  'oled-crimson'
] as const
export type ThemeId = (typeof THEME_IDS)[number]

export interface Settings {
  watchFolders: boolean
  generateThumbnails: boolean
  hoverPreview: boolean
  animations: boolean
  autoplayNext: boolean
  volume: number
  muted: boolean
  gridSize: GridSize
  /** Whether the player opens with its details pane showing. */
  detailsPane: boolean
  /** Open the player straight into trim mode whenever the clip can be trimmed. */
  editOnOpen: boolean
  sort: SortBy
  groupBy: GroupBy
  theme: ThemeId
  /** Parallel ffmpeg jobs. Kept low so the app never fights a game for CPU. */
  concurrency: number
}

export interface ScanState {
  active: boolean
  /** Folder currently being walked. */
  folder: string
  found: number
  /** Media jobs still queued (probe + thumbnail + sprite). */
  pending: number
  done: number
}

export interface LibrarySnapshot {
  folders: LibraryFolder[]
  clips: Clip[]
  settings: Settings
  scan: ScanState
  exports: ExportJob[]
  appVersion: string
  suggestedFolders: string[]
  /** Where exports go unless the user picked another folder: `<Videos>\Sift Clips`. */
  defaultClipsDir: string
}

export interface ActionResult {
  ok: boolean
  error?: string
}

/** Disk used by the storage Sift owns, i.e. everything under `userData`. */
export interface StorageStats {
  /** %APPDATA%/sift (or the SIFT_USER_DATA override). */
  userDataPath: string
  /** library.db plus its -wal / -shm sidecars. */
  databaseBytes: number
  /** Poster frames and hover-scrub strips. */
  cacheBytes: number
  cacheFiles: number
  /** Everything else Electron keeps there: GPU cache, logs, local storage. */
  otherBytes: number
  /** Volume holding the app data. Zero when the platform will not report it. */
  diskFreeBytes: number
  diskTotalBytes: number
}

export interface RuntimeStats {
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
  /** Milliseconds since the main process started. */
  uptimeMs: number
  /** Working set summed across every Electron process of this app. */
  memoryBytes: number
  processCount: number
  /** False when the bundled ffmpeg/ffprobe could not be resolved. */
  ffmpeg: boolean
}

export interface AppStats {
  storage: StorageStats
  runtime: RuntimeStats
  generatedAtMs: number
}

export interface ClipPatch extends Partial<Clip> {
  id: string
}

/** Payloads pushed from main → renderer. */
export interface EventMap {
  'clips:added': Clip[]
  'clips:updated': ClipPatch[]
  'clips:removed': string[]
  'folders:changed': LibraryFolder[]
  'settings:changed': Settings
  'scan:changed': ScanState
  /** Every live export job; a job is sent once in its terminal state and then dropped. */
  'exports:changed': ExportJob[]
  'window:maximized': boolean
}

export type EventName = keyof EventMap

export const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mkv',
  '.mov',
  '.webm',
  '.m4v',
  '.avi',
  '.wmv',
  '.flv',
  '.ts'
] as const

export const DEFAULT_SETTINGS: Settings = {
  watchFolders: true,
  generateThumbnails: true,
  hoverPreview: true,
  animations: true,
  autoplayNext: false,
  volume: 0.8,
  muted: false,
  gridSize: 'large',
  detailsPane: true,
  editOnOpen: true,
  sort: 'newest',
  groupBy: 'date',
  theme: 'sift',
  concurrency: 2
}
