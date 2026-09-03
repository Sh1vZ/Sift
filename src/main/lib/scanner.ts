import { opendir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { VIDEO_EXTENSIONS } from '@shared/types'

const MAX_DEPTH = 8
const SKIP_DIRS = new Set(['node_modules', 'system volume information', '$recycle.bin'])
const VIDEO_EXT = new Set<string>(VIDEO_EXTENSIONS)

export function isVideoFile(filePath: string): boolean {
  const name = basename(filePath)
  if (name.startsWith('.') || name.startsWith('~')) return false
  return VIDEO_EXT.has(extname(name).toLowerCase())
}

function shouldSkipDir(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name.toLowerCase())
}

export interface WalkOptions {
  signal?: AbortSignal
  /** Directories (absolute paths) to leave out of the walk, e.g. the clips folder inside a library root. */
  skip?: (dir: string) => boolean
}

/**
 * Depth-first walk that yields video paths as it finds them. Directory
 * listing is cheap; the expensive work (probing) happens in the media queue.
 */
export async function* walkVideos(root: string, opts: WalkOptions = {}, depth = 0): AsyncGenerator<string> {
  const { signal, skip } = opts
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
    } else if (entry.isFile() && isVideoFile(full)) {
      yield full
    }
  }
  for (const sub of subdirs) yield* walkVideos(sub, opts, depth + 1)
}
