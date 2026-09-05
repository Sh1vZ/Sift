/** Types shared between the main process, the preload bridge and the renderer. */

import type { ChangelogBlock } from './changelog'
import type { UploadJob, VideoStage, YouTubeState } from './youtube'

export type ProbeState = 'pending' | 'ok' | 'failed'

/**
 * One audio stream inside a clip. ShadowPlay and OBS write game audio and mic
 * as separate streams, and Chromium only ever renders one of them, so the
 * player needs to know what else is in the file.
 */
export interface AudioTrack {
  /** The n in `-map 0:a:n`. Type-relative, NOT ffprobe's absolute stream index. */
  index: number
  /** Absolute ffprobe stream index. Display and debugging only; never fed to -map. */
  streamIndex: number
  codec: string
  channels: number
  /** From stream tags. ShadowPlay leaves both empty; the UI falls back to "Track n". */
  title: string
  language: string
  /** The stream Chromium plays from the file itself, so the one never extracted. */
  isDefault: boolean
  /** Seconds to add to video time when seeking this track; measured at extraction. */
  offset: number
}

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
  /** Group the clip belongs to — the game, as the app shows it. */
  game: string
  /**
   * The name the folder gave the clip, before any rename or merge. Equal to
   * `game` unless the user renamed the game or merged it into another.
   */
  sourceGame: string
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
  /** Every audio stream in the file. Empty until the clip has been probed. */
  audioTracks: AudioTrack[]
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
  /** YouTube video id once uploaded from Sift; '' otherwise. */
  youtubeId: string
  /** The Google project that uploaded it — the only one whose token can ask after it. */
  youtubeAccountId: string
  /** What YouTube last said about the video; '' when Sift has never asked. */
  youtubeStage: VideoStage | ''
  /** YouTube's reason for a rejected or failed video, already phrased; '' otherwise. */
  youtubeReason: string
  /** When Sift last asked YouTube; 0 = never. */
  youtubeCheckedAtMs: number
  /** Automatic checks stop once this passes; 0 when Sift is not watching the video. */
  youtubeWatchUntilMs: number
  /** User-set: pinned to the top of grids and reachable from the Favourites filter. */
  favourite: boolean
  /** When playback last passed the seen threshold; 0 when never watched. */
  seenAtMs: number
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

/** A clip the launch splash draws one frame of, to compile the player's video shader early (see main/lib/splash.ts). */
export interface WarmupClip {
  id: string
  width: number
  height: number
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
  /**
   * Type-relative indices of the audio tracks to keep. Absent keeps every
   * track, which is what an export with no mixer selection asks for.
   */
  tracks?: number[]
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
  /** Audio tracks the export keeps; absent keeps every one. */
  tracks?: number[]
  state: ExportState
  /** 0..1 */
  progress: number
  error?: string
  /** Set once the exported file is in the index. */
  clipId?: string
  createdAtMs: number
}

// --------------------------------------------------------------- activity

export type ActivityKind =
  'export' | 'upload' | 'copy-file' | 'rename' | 'delete' | 'game-alias' | 'scan'

export type ActivityStatus = 'done' | 'failed'

/**
 * One finished piece of work, kept after the live job is pruned so the user
 * can find what Sift did and act on it later. Flat on purpose: one SQLite row,
 * every string present (`''` rather than absent) so the shape matches the table.
 */
export interface ActivityRecord {
  id: string
  kind: ActivityKind
  status: ActivityStatus
  /** The subject: file name for clip work, game name for aliases, folder name for scans. */
  title: string
  /** The specific part of the second line; the renderer adds the verb. For `game-alias` it is the whole sentence. */
  detail: string
  /** Why it failed; '' otherwise. */
  error: string
  /** When the work started (`job.createdAtMs`); equal to `finishedAtMs` for instant actions. */
  createdAtMs: number
  finishedAtMs: number
  /** The clip the row can open; '' when there is none (a delete, a scan). A failed export points at its source. */
  clipId: string
  game: string
  /** Upload only: works even after the clip is gone from the library. */
  videoId: string
  /** Absolute path of the file or folder the row is about; '' when none. */
  path: string
}

/** What a caller supplies; the log assigns `id` and `finishedAtMs`. */
export type ActivityInput = Omit<ActivityRecord, 'id' | 'finishedAtMs'>

/** Rows kept in the history; the oldest fall off past this. */
export const ACTIVITY_CAP = 200

export type GroupBy = 'date' | 'none'
export type SortBy = 'newest' | 'oldest' | 'name' | 'duration' | 'size' | 'favourite'
export type GridSize = 'compact' | 'comfortable' | 'large'

/**
 * Colour theme for the renderer chrome. Every id is a `html[data-theme]` block
 * in `tokens.css`; the renderer's `useTheme` composable carries the labels.
 */
export const THEME_IDS = [
  'sift',
  'ember',
  'synthwave',
  'crimson',
  'solar',
  'nox',
  'grim',
  'space',
  'oled',
  'oled-mint',
  'oled-frost',
  'oled-crimson',
] as const
export type ThemeId = (typeof THEME_IDS)[number]

/**
 * localStorage key holding the last theme the user had. The app window and the
 * splash window both read it before their first paint so neither flashes the
 * default indigo at an OLED user; the persisted setting corrects it moments later.
 */
export const LAST_THEME_KEY = 'sift:theme'

export interface Settings {
  watchFolders: boolean
  generateThumbnails: boolean
  hoverPreview: boolean
  animations: boolean
  autoplayNext: boolean
  volume: number
  muted: boolean
  /**
   * Which audio track the player solos when a clip has more than one:
   * -1 leaves them all audible, 0 and up solo that track.
   */
  defaultAudioTrack: number
  /**
   * What to call each audio track, by position. Recorders write the same track
   * in the same slot every time — ShadowPlay puts game audio first and the mic
   * second — so a name given once fits the whole library. '' falls back to
   * "Track n".
   */
  audioTrackNames: string[]
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
  /** Closing the window hides it to the tray and leaves the library running. */
  minimizeToTray: boolean
  /** The sidebar shows as the icon-only rail instead of the labelled column. */
  sidebarCollapsed: boolean
  /** Look for a new version on launch and every few hours. Manual checks work either way. */
  autoCheckUpdates: boolean
  /**
   * Keep asking YouTube how an uploaded video is doing until it is live. One
   * API unit a check, batched across videos; off means the stage never moves
   * past "Uploaded" unless the user presses Check now.
   */
  youtubeCheckStatus: boolean
  /** Internal: the one-time `still running` tray balloon has been shown. Never surfaced in the UI. */
  trayHintShown: boolean
  /**
   * Internal: the version whose release notes the user has already seen. Empty on a
   * fresh install, which suppresses the first-run "What's new". Never surfaced in the UI.
   */
  lastSeenVersion: string
  /**
   * Internal: squashed names of look-alike games the user said are *not* the same
   * game, so the merge hint stays gone across launches. Never surfaced in the UI.
   */
  dismissedGameMerges: string[]
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
  /** Finished work, newest first. */
  activity: ActivityRecord[]
  appVersion: string
  suggestedFolders: string[]
  /** Where exports go unless the user picked another folder: `<Videos>\Sift Clips`. */
  defaultClipsDir: string
}

export interface ActionResult {
  ok: boolean
  error?: string
}

/**
 * One volume a watched folder (or the app data) sits on. Reported per drive so
 * the Storage screen can say what Sift costs on D: rather than only on C:.
 */
export interface VolumeStats {
  /** Root as the OS names it: `D:\` on Windows, `/` elsewhere. */
  root: string
  /** Zero when the platform will not report the volume. */
  freeBytes: number
  totalBytes: number
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
  /** Every volume holding a watched folder, plus the one holding the app data. */
  volumes: VolumeStats[]
  /** Which of `volumes` the app data is on; '' when the platform would not say. */
  appDataRoot: string
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

// ---------------------------------------------------------------- updates

/**
 * Where the updater is in its cycle. `unsupported` is a development build (or any
 * build with no update feed): the updater is inert and the UI says so rather than
 * offering a button that cannot work.
 */
export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** The running build, so the UI can render `1.0.0-beta.1 → 1.0.0-beta.2`. */
  currentVersion: string
  /** Version on offer; empty when there is nothing to offer. */
  version: string
  /** 0..1 while downloading. */
  progress: number
  /** Download speed; 0 outside a download. */
  bytesPerSecond: number
  /**
   * Release notes for the offered version, already flattened to plain text in main.
   * The GitHub feed serves rendered HTML, so the renderer never sees markup.
   */
  notes: string
  /** Human-readable reason when `status` is `error`. */
  error: string
  /** When the last completed check finished; 0 if none has. */
  checkedAtMs: number
}

export const IDLE_UPDATE_STATE: UpdateState = {
  status: 'idle',
  currentVersion: '',
  version: '',
  progress: 0,
  bytesPerSecond: 0,
  notes: '',
  error: '',
  checkedAtMs: 0,
}

/** The changelog section for the version now running, shown once after an update. */
export interface WhatsNew {
  version: string
  /**
   * The section of the bundled CHANGELOG.md for this version, already parsed in
   * main. Blocks rather than markdown or HTML, so the renderer draws it with
   * `v-for` and never has to decide whether to trust markup.
   */
  blocks: ChangelogBlock[]
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
  /**
   * Whether the window is on screen. False while it is hidden to the tray or
   * minimized, which is the renderer's cue to release everything expensive.
   */
  'window:visible': boolean
  /** The tray Settings item: show the settings screen on the OS settings pane. */
  'app:open-settings': null
  /** The whole updater state on every transition; the renderer replaces its copy. */
  'update:changed': UpdateState
  /** Every YouTube project with its connection and quota; the renderer replaces its copy. */
  'youtube:changed': YouTubeState
  /** Every live upload job; a job is sent once in its terminal state and then dropped. */
  'uploads:changed': UploadJob[]
  /** Every kept history record, newest first; the renderer replaces its copy. */
  'activity:changed': ActivityRecord[]
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
  '.ts',
] as const

export const DEFAULT_SETTINGS: Settings = {
  watchFolders: true,
  generateThumbnails: true,
  hoverPreview: true,
  animations: true,
  autoplayNext: false,
  volume: 0.8,
  muted: false,
  defaultAudioTrack: -1,
  audioTrackNames: [],
  gridSize: 'large',
  detailsPane: true,
  editOnOpen: true,
  sort: 'newest',
  groupBy: 'date',
  theme: 'sift',
  concurrency: 2,
  minimizeToTray: false,
  sidebarCollapsed: false,
  autoCheckUpdates: true,
  youtubeCheckStatus: true,
  trayHintShown: false,
  lastSeenVersion: '',
  dismissedGameMerges: [],
}
