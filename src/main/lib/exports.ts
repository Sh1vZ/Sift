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

export interface ExportPlan {
  src: string
  out: string
  start: number
  end: number
  muted: boolean
  /**
   * Audio tracks to keep, by type-relative index. `null` keeps every track,
   * `[]` keeps none — the same thing `muted` asks for.
   */
  tracks: number[] | null
  vcodec: string
}

/**
 * Stream copy between two points. `-ss`/`-to` are *input* options so ffmpeg
 * seeks to the keyframe at or before `start` without decoding, and stops
 * reading at `end` on the source timeline (exact, unaffected by the keyframe
 * shift). `make_zero` rebases the timestamps the seek leaves negative, which
 * mp4 would otherwise reject. Audio defaults to every track (ShadowPlay writes
 * game and mic separately) and narrows to `tracks` when the mixer picked a
 * subset; subtitle/data streams are dropped because mp4 cannot carry most of
 * them.
 */
export function buildExportArgs(p: ExportPlan): string[] {
  const args = [
    '-y',
    '-nostdin',
    '-v',
    'error',
    '-threads',
    '1',
    '-ss',
    p.start.toFixed(3),
    '-to',
    p.end.toFixed(3),
    '-i',
    p.src,
    '-map',
    '0:v:0',
  ]
  // Each map keeps the trailing `?` for the same reason the catch-all does: a
  // selection made against a file that has since been re-recorded with fewer
  // tracks would otherwise abort the whole export rather than skip the stream.
  if (p.muted || p.tracks?.length === 0) args.push('-an')
  else if (!p.tracks) args.push('-map', '0:a?')
  else for (const k of p.tracks) args.push('-map', `0:a:${k}?`)
  args.push('-sn', '-dn', '-c', 'copy', '-avoid_negative_ts', 'make_zero')
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
