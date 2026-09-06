import { opendir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { mediaKindOf } from '@shared/types'

const MAX_DEPTH = 8
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
  if (depth > MAX_DEPTH || signal?.aborted || skip?.(root)) return
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
