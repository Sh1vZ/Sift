import { basename } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { isVideoFile } from './scanner'

export interface WatchHandlers {
  onAdd: (path: string) => void
  onChange: (path: string) => void
  onRemove: (path: string) => void
}

/**
 * ShadowPlay keeps writing while it muxes, so we wait for the size to sit
 * still before treating a file as a finished clip.
 */
export function watchFolder(root: string, handlers: WatchHandlers): FSWatcher {
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    depth: 8,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2500, pollInterval: 500 },
    ignored: (p, stats) => {
      const name = basename(p)
      if (name.startsWith('.') || name.startsWith('~')) return true
      return Boolean(stats?.isFile()) && !isVideoFile(p)
    }
  })
  watcher.on('add', (p) => isVideoFile(p) && handlers.onAdd(p))
  watcher.on('change', (p) => isVideoFile(p) && handlers.onChange(p))
  watcher.on('unlink', (p) => isVideoFile(p) && handlers.onRemove(p))
  watcher.on('error', () => undefined)
  return watcher
}
