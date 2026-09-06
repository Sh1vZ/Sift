import type { Clip, ExportRequest } from '@shared/types'

/** Characters Windows refuses in a file or folder name (plus control characters). */
export const INVALID_NAME = /[<>:"/\\|?*]|\p{Cc}/u
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_NAME_LENGTH = 120

/** Shortest cut the editor accepts, in seconds. */
export const MIN_SELECTION_S = 0.25

/**
 * A file name the user typed, made safe for NTFS. Returns the reason when
 * nothing usable is left so the editor can show it.
 */
export function sanitizeName(
  raw: string,
): { name: string; error?: undefined } | { name?: undefined; error: string } {
  const name = raw.trim().replace(/[. ]+$/, '')
  if (!name) return { error: 'Name cannot be empty.' }
  if (INVALID_NAME.test(name)) return { error: 'Name contains characters Windows does not allow.' }
  if (RESERVED_NAME.test(name)) return { error: 'That name is reserved by Windows.' }
  if (name.length > MAX_NAME_LENGTH)
    return { error: `Name is longer than ${MAX_NAME_LENGTH} characters.` }
  return { name }
}

/** Game names come from folder names already, so this only guards the odd stored value. */
export function safeGameDir(game: string): string {
  const dir = game
    .replace(/[<>:"/\\|?*]|\p{Cc}/gu, '-')
    .trim()
    .replace(/[. ]+$/, '')
  return dir && !RESERVED_NAME.test(dir) ? dir : 'Clips'
}

/**
 * Container for the export. Stream copy cannot change codecs, so sources
 * whose codecs mp4 will not carry keep their own container.
 */
export function exportExt(sourceExt: string): string {
  switch (sourceExt.toLowerCase()) {
    case '.webm':
    case '.avi':
    case '.wmv':
    case '.flv':
      return sourceExt.toLowerCase()
    default:
      return '.mp4'
  }
}

/** Error message, or null when the request is fine to run. */
export function validateExportRequest(req: ExportRequest, clip: Clip | undefined): string | null {
  if (!clip) return 'Clip not found.'
  if (clip.probeState !== 'ok' || clip.duration <= 0)
    return 'Media info is still loading for this clip.'
  const named = sanitizeName(req.name)
  if (named.error) return named.error
  if (!Number.isFinite(req.start) || !Number.isFinite(req.end)) return 'Invalid trim range.'
  if (req.start < 0) return 'Start cannot be before the beginning.'
  if (req.end > clip.duration + 0.5) return 'End is past the end of the clip.'
  if (req.end - req.start < MIN_SELECTION_S) return 'Selection is too short.'
  return null
}

/** Bitrate for a mixed-down track; what the player's own track extraction uses. */
const MIX_BITRATE = '192k'
/** Filter graph label the mixed stream comes out on. */
const MIX_OUT = '[mix]'

export interface ExportPlan {
  src: string
  out: string
  /** In-point on the source timeline, in seconds. */
  start: number
  end: number
  /**
   * Where to actually seek: the source keyframe at or before `start`, when it
   * has been looked up. Only a mixed export needs it — see `buildExportArgs`.
   */
  seek?: number
  muted: boolean
  /**
   * Audio tracks to keep, by type-relative index. `null` keeps every track,
   * `[]` keeps none — the same thing `muted` asks for.
   */
  tracks: number[] | null
  /** Audio streams the source has, which is what `tracks: null` resolves to. */
  audioCount: number
  vcodec: string
}

/** The kept tracks as concrete indices, with anything the source no longer has dropped. */
function keptTracks(p: ExportPlan): number[] {
  if (p.muted) return []
  const all = Array.from({ length: Math.max(0, p.audioCount) }, (_, i) => i)
  return p.tracks ? p.tracks.filter((k) => all.includes(k)) : all
}

/**
 * Encoder for the mixed track, by output container, or '' where the export
 * keeps the source's own streams instead. Only the containers Sift actually
 * writes are mixed: mp4 for everything ShadowPlay and OBS record, webm for the
 * one source kind mp4 cannot carry. avi/wmv/flv keep the old copy path rather
 * than have this guess at an encoder each of them accepts — no recorder Sift
 * targets writes multi-track audio into one.
 */
function mixCodec(out: string): string {
  const name = out.toLowerCase()
  if (name.endsWith('.webm')) return 'libopus'
  if (name.endsWith('.avi') || name.endsWith('.wmv') || name.endsWith('.flv')) return ''
  return 'aac'
}

/**
 * True when the export has to sum several tracks into one, which is the only
 * case that re-encodes audio — and so the only one that has to be seeked to a
 * keyframe (see `buildExportArgs`).
 */
export function mixesAudio(p: ExportPlan): boolean {
  return keptTracks(p).length > 1 && mixCodec(p.out) !== ''
}

/**
 * Sum the kept tracks into one stereo stream.
 *
 * Every input is pinned to the same sample format and layout first, because a
 * mic is routinely mono where game audio is stereo or 5.1, and amix mixes one
 * layout. Sample rates are left to ffmpeg, which inserts a resampler only if
 * the tracks actually disagree. `normalize=0` keeps each track at its recorded
 * level: the player sums them in the mixer at full volume, and dividing by the
 * track count here would make every shared clip quieter than what was heard in
 * the app.
 */
function mixGraph(tracks: number[]): string {
  const heads = tracks.map(
    (k, i) => `[0:a:${k}]aformat=sample_fmts=fltp:channel_layouts=stereo[s${i}]`,
  )
  const inputs = tracks.map((_, i) => `[s${i}]`).join('')
  const amix = `amix=inputs=${tracks.length}:duration=longest:dropout_transition=0:normalize=0`
  return `${heads.join(';')};${inputs}${amix}${MIX_OUT}`
}

/**
 * Stream copy between two points. `-ss`/`-to` are *input* options so ffmpeg
 * seeks to the keyframe at or before `start` without decoding, and stops
 * reading at `end` on the source timeline (exact, unaffected by the keyframe
 * shift). `make_zero` rebases the timestamps the seek leaves negative, which
 * mp4 would otherwise reject. Subtitle/data streams are dropped because mp4
 * cannot carry most of them.
 *
 * Audio defaults to every track (ShadowPlay writes game and mic separately)
 * and narrows to `tracks` when the mixer picked a subset. Keeping several as
 * separate streams is what the file would need to be re-openable in Sift's own
 * mixer, but every other player — Discord, browsers, Windows' own — plays
 * exactly one of them and drops the rest, so a shared clip would lose its mic.
 * Several kept tracks are therefore summed into one, which is the mix the app
 * plays and the only shape another player will render whole. The video is
 * still copied; only the audio is re-encoded.
 *
 * Mixing is also the one path that cares where the seek lands: for a copied
 * stream ffmpeg keeps everything from the keyframe on, but a decoded one is
 * cut at `start` exactly, which would leave the run-up to the in-point silent.
 * Seeking to the keyframe itself (`seek`) makes both start together again.
 */
export function buildExportArgs(p: ExportPlan): string[] {
  const kept = keptTracks(p)
  const codec = mixesAudio(p) ? mixCodec(p.out) : ''
  const args = [
    '-y',
    '-nostdin',
    '-v',
    'error',
    '-threads',
    '1',
    '-ss',
    (codec ? (p.seek ?? p.start) : p.start).toFixed(3),
    '-to',
    p.end.toFixed(3),
    '-i',
    p.src,
  ]
  if (codec) args.push('-filter_complex', mixGraph(kept))
  args.push('-map', '0:v:0')
  // Each map keeps the trailing `?` for the same reason the catch-all did: a
  // selection made against a file that has since been re-recorded with fewer
  // tracks would otherwise abort the whole export rather than skip the stream.
  if (!kept.length) args.push('-an')
  else if (codec) args.push('-map', MIX_OUT)
  else for (const k of kept) args.push('-map', `0:a:${k}?`)
  args.push('-sn', '-dn')
  if (codec) args.push('-c:v', 'copy', '-c:a', codec, '-b:a', MIX_BITRATE)
  else args.push('-c', 'copy')
  args.push('-avoid_negative_ts', 'make_zero')
  // Apple-style tag so the mp4 also plays in players that only know hvc1.
  if (p.vcodec === 'hevc' && p.out.toLowerCase().endsWith('.mp4')) args.push('-tag:v', 'hvc1')
  args.push('-progress', 'pipe:1', '-stats_period', '0.25', '-nostats', p.out)
  return args
}

/** `name`, `name (2)`, `name (3)`… — the first candidate `taken` does not reject. */
export function uniqueName(base: string, taken: (candidate: string) => boolean): string {
  if (!taken(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`
    if (!taken(candidate)) return candidate
  }
}

/** Progress lines from `-progress pipe:1`; the output position in seconds when the line carries one. */
export function parseProgressLine(line: string): number | null {
  const eq = line.indexOf('=')
  if (eq < 0) return null
  const key = line.slice(0, eq)
  const value = line.slice(eq + 1).trim()
  if (key === 'out_time_us' || key === 'out_time_ms') {
    // Both keys are microseconds in every ffmpeg release that emits them.
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n / 1e6 : null
  }
  return null
}
