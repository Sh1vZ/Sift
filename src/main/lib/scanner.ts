import { opendir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { mediaKindOf } from '@shared/types'

/**
 * How many directory levels below a chosen folder may hold media. One level
 * covers the usual `Recordings/<Game>/clip.mp4` layout; a folder that buries
 * its clips deeper is refused when it is added, and the walk never descends
 * past this either, so a folder cannot grow its way around that.
 */
export const MAX_MEDIA_DEPTH = 1
/** How far past the limit the add-time check looks before giving the folder the benefit of the doubt. */
const DEEP_PROBE_DEPTH = 8
const SKIP_DIRS = new Set(['node_modules', 'system volume information', '$recycle.bin'])

/**
 * Whether a file is one the library indexes. Videos always are; stills only
 * when the caller says so — the exports folder never takes them, and the
 * setting can switch them off for the recording folders too.
 */
export function isMediaFile(filePath: string, includeImages: boolean): boolean {
  const name = basename(filePath)
  if (name.startsWith('.') || name.startsWith('~')) return false
  const kind = mediaKindOf(extname(name))
  return kind === 'video' || (kind === 'image' && includeImages)
}

function shouldSkipDir(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name.toLowerCase())
}

export interface WalkOptions {
  signal?: AbortSignal
  /** Directories (absolute paths) to leave out of the walk, e.g. the clips folder inside a library root. */
  skip?: (dir: string) => boolean
  /** Yield screenshots as well as recordings. */
  includeImages?: boolean
}

/**
 * Depth-first walk that yields media paths as it finds them. Directory
 * listing is cheap; the expensive work (probing) happens in the media queue.
 */
export async function* walkMedia(
  root: string,
  opts: WalkOptions = {},
  depth = 0,
): AsyncGenerator<string> {
  const { signal, skip, includeImages = false } = opts
  if (depth > MAX_MEDIA_DEPTH || signal?.aborted || skip?.(root)) return
  let dir
  try {
    dir = await opendir(root)
  } catch {
    return
  }
  const subdirs: string[] = []
  for await (const entry of dir) {
    if (signal?.aborted) return
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) subdirs.push(full)
    } else if (entry.isFile() && isMediaFile(full, includeImages)) {
      yield full
    }
  }
  for (const sub of subdirs) yield* walkMedia(sub, opts, depth + 1)
}

/**
 * The first media file that sits deeper than `MAX_MEDIA_DEPTH` below `root`,
 * or `null` if there is none. Used to refuse a folder before it is added, so
 * it stops at the first offender rather than listing them all — and honours
 * `skip`, or the clips folder inside a candidate root would trip it.
 */
export async function findMediaTooDeep(
  root: string,
  opts: WalkOptions = {},
  depth = 0,
): Promise<string | null> {
  const { signal, skip, includeImages = false } = opts
  if (depth > DEEP_PROBE_DEPTH || signal?.aborted || skip?.(root)) return null
  let dir
  try {
    dir = await opendir(root)
  } catch {
    return null
  }
  const subdirs: string[] = []
  for await (const entry of dir) {
    if (signal?.aborted) return null
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) subdirs.push(full)
    } else if (depth > MAX_MEDIA_DEPTH && entry.isFile() && isMediaFile(full, includeImages)) {
      return full
    }
  }
  for (const sub of subdirs) {
    const hit = await findMediaTooDeep(sub, opts, depth + 1)
    if (hit) return hit
  }
  return null
}
