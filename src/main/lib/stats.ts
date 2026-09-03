import { app } from 'electron'
import { opendir, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppStats, RuntimeStats, StorageStats } from '@shared/types'
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

async function collectStorage(): Promise<StorageStats> {
  const db = libraryDb()
  // WAL mode keeps recent commits in the sidecars, so they are part of the index.
  const [dbBytes, walBytes, shmBytes, cache, total] = await Promise.all([
    fileSize(db),
    fileSize(`${db}-wal`),
    fileSize(`${db}-shm`),
    dirUsage(cacheDir()),
    dirUsage(userDataDir())
  ])
  const databaseBytes = dbBytes + walBytes + shmBytes

  let diskFreeBytes = 0
  let diskTotalBytes = 0
  try {
    const fs = await statfs(userDataDir())
    diskFreeBytes = fs.bsize * fs.bavail
    diskTotalBytes = fs.bsize * fs.blocks
  } catch {
    // Not fatal: the free-space row simply hides.
  }

  return {
    userDataPath: userDataDir(),
    databaseBytes,
    cacheBytes: cache.bytes,
    cacheFiles: cache.files,
    otherBytes: Math.max(0, total.bytes - databaseBytes - cache.bytes),
    diskFreeBytes,
    diskTotalBytes
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
    ffmpeg: ffmpegAvailable()
  }
}

/** Measured on demand — nothing here is polled or cached. */
export async function collectStats(): Promise<AppStats> {
  return {
    storage: await collectStorage(),
    runtime: collectRuntime(),
    generatedAtMs: Date.now()
  }
}
