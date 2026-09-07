import { basename } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { MAX_MEDIA_DEPTH, isMediaFile } from './scanner'

export interface WatchHandlers {
  onAdd: (path: string) => void
  onChange: (path: string) => void
  onRemove: (path: string) => void
}

export interface WatchOptions {
  /** Paths to leave alone, e.g. the clips folder inside a library root. */
  ignored?: (path: string) => boolean
  /**
   * Whether screenshots count right now. Read per event rather than once, so
   * the setting takes effect without the watcher being restarted.
   */
  includeImages: () => boolean
}

/**
 * ShadowPlay keeps writing while it muxes, so we wait for the size to sit
 * still before treating a file as a finished clip. `ignored` is consulted per
 * event, so a predicate that reads live state (the clips folder path) keeps
 * working after that state changes without restarting the watcher.
 */
export function watchFolder(root: string, handlers: WatchHandlers, opts: WatchOptions): FSWatcher {
  const wanted = (p: string): boolean => isMediaFile(p, opts.includeImages())
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    // Matches the scan: a folder and one level of subfolders below it, so a
    // clip dropped deeper later is no more indexed than one found there.
    depth: MAX_MEDIA_DEPTH,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2500, pollInterval: 500 },
    ignored: (p, stats) => {
      const name = basename(p)
      if (name.startsWith('.') || name.startsWith('~')) return true
      if (opts.ignored?.(p)) return true
      return Boolean(stats?.isFile()) && !wanted(p)
    },
  })
  watcher.on('add', (p) => wanted(p) && handlers.onAdd(p))
  watcher.on('change', (p) => wanted(p) && handlers.onChange(p))
  watcher.on('unlink', (p) => wanted(p) && handlers.onRemove(p))
  watcher.on('error', () => undefined)
  return watcher
}
