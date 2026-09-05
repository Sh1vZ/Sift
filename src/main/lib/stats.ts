import { app } from 'electron'
import { opendir, stat, statfs } from 'node:fs/promises'
import { join, parse } from 'node:path'
import type { AppStats, RuntimeStats, StorageStats, VolumeStats } from '@shared/types'
import { ffmpegAvailable } from './media'
import { cacheDir, libraryDb, userDataDir } from './paths'

/**
 * Walking `userData` touches every Chromium cache file, so the walk is capped:
 * past this many entries the figure is a floor rather than a total. In practice
 * a library with a few thousand thumbnails stays well under it.
 */
const MAX_ENTRIES = 60_000

interface DirUsage {
  bytes: number
  files: number
}

/** Recursive size of a directory. A missing or unreadable path counts as zero. */
async function dirUsage(root: string, budget = { left: MAX_ENTRIES }): Promise<DirUsage> {
  const usage: DirUsage = { bytes: 0, files: 0 }
  let dir
  try {
    dir = await opendir(root)
  } catch {
    return usage
  }
  const subdirs: string[] = []
  for await (const entry of dir) {
    if (budget.left <= 0) break
    budget.left--
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      subdirs.push(full)
    } else if (entry.isFile()) {
      try {
        usage.bytes += (await stat(full)).size
        usage.files++
      } catch {
        // Vanished mid-walk (a cache file being rotated): skip it.
      }
    }
  }
  for (const sub of subdirs) {
    const child = await dirUsage(sub, budget)
    usage.bytes += child.bytes
    usage.files += child.files
  }
  return usage
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/** The volume a path sits on: `D:\` on Windows, `/` elsewhere; '' when relative. */
function volumeRoot(path: string): string {
  return parse(path).root
}

async function volumeUsage(root: string): Promise<VolumeStats | null> {
  try {
    const fs = await statfs(root)
    return { root, freeBytes: fs.bsize * fs.bavail, totalBytes: fs.bsize * fs.blocks }
  } catch {
    // An unplugged drive or a platform that will not report: leave it out.
    return null
  }
}

/**
 * Free space for every volume the library touches. Keyed case-insensitively so
 * `d:\clips` and `D:\Videos` are measured once, not twice.
 */
async function collectVolumes(paths: string[]): Promise<VolumeStats[]> {
  const roots = new Map<string, string>()
  for (const path of paths) {
    const root = volumeRoot(path)
    if (root) roots.set(root.toUpperCase(), root)
  }
  const measured = await Promise.all([...roots.values()].map(volumeUsage))
  return measured
    .filter((v): v is VolumeStats => v !== null)
    .sort((a, b) => a.root.localeCompare(b.root))
}

async function collectStorage(folderPaths: string[]): Promise<StorageStats> {
  const db = libraryDb()
  // WAL mode keeps recent commits in the sidecars, so they are part of the index.
  const [dbBytes, walBytes, shmBytes, cache, total] = await Promise.all([
    fileSize(db),
    fileSize(`${db}-wal`),
    fileSize(`${db}-shm`),
    dirUsage(cacheDir()),
    dirUsage(userDataDir()),
  ])
  const databaseBytes = dbBytes + walBytes + shmBytes

  const appDataRoot = volumeRoot(userDataDir())
  const volumes = await collectVolumes([userDataDir(), ...folderPaths])

  return {
    userDataPath: userDataDir(),
    databaseBytes,
    cacheBytes: cache.bytes,
    cacheFiles: cache.files,
    otherBytes: Math.max(0, total.bytes - databaseBytes - cache.bytes),
    volumes,
    // Only claim the drive when it was actually measured; an unreadable volume
    // is not in `volumes`, and the renderer would have nothing to point at. The
    // match is case-insensitive because the casing kept is whichever path named
    // the volume last, which need not be the app-data one.
    appDataRoot:
      volumes.find((v) => v.root.toUpperCase() === appDataRoot.toUpperCase())?.root ?? '',
  }
}

function collectRuntime(): RuntimeStats {
  const metrics = app.getAppMetrics()
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    uptimeMs: Math.round(process.uptime() * 1000),
    // getAppMetrics reports working sets in KiB.
    memoryBytes: metrics.reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0) * 1024,
    processCount: metrics.length,
    ffmpeg: ffmpegAvailable(),
  }
}

/**
 * Measured on demand — nothing here is polled or cached. `folderPaths` are the
 * watched roots, so free space is reported for every drive the library uses.
 */
export async function collectStats(folderPaths: string[] = []): Promise<AppStats> {
  return {
    storage: await collectStorage(folderPaths),
    runtime: collectRuntime(),
    generatedAtMs: Date.now(),
  }
}
