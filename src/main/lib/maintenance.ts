import { readdir, stat, unlink, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { GIF_PREVIEW_PREFIX } from './exports'

/**
 * The one place Sift throws away what it made for itself and no longer
 * needs. Every derived file has a rule here — how long it may live, and from
 * when — and nothing else decides to delete one on its own account (a clip
 * leaving the library still takes its own artifacts with it, which is
 * ownership, not age).
 *
 * Electron-free on purpose, like lib/exports.ts, so `npm test` covers the
 * rules against a real folder. `Library` supplies the folders and which
 * names are still owned.
 *
 * What counts as "unused": a file's modification time. Files are written
 * once, so that is when they were made — until something uses one again and
 * `touch`es it, which the player does for an audio track it plays and a GIF
 * preview does when shown or copied into an export.
 */
const HOUR_MS = 60 * 60_000
/** A GIF preview lives this long past the last time it was shown or copied. Tens of megabytes each. */
export const GIF_PREVIEW_TTL_MS = HOUR_MS
/** An extracted audio track lives this long past the last time the player asked for it. */
export const AUDIO_TRACK_TTL_MS = 7 * 24 * HOUR_MS
/**
 * Anything unaccounted for — a `~` half-made file, an artifact no clip in the
 * index names — is left alone until it is this old. Longer than any job runs,
 * so a live job's files are never taken from under it.
 */
export const ORPHAN_GRACE_MS = HOUR_MS
/** How often a run follows the one at launch. */
export const MAINTENANCE_TICK_MS = 15 * 60_000
/** How far below the clips root exports are looked for: the game folders, as the scanner does. */
const LEFTOVER_DEPTH = 1
/** What an export writes on its way to its real name: the container, or a GIF's palette. */
const EXPORT_LEFTOVER = /^~.+\.(mp4|webm|avi|wmv|flv|gif|mp3|m4a|wav|ogg|palette\.png)$/i

export interface MaintenanceRules {
  /** Every cache file a clip in the index owns, or will once its job runs. Kept for good. */
  cacheValid: ReadonlySet<string>
  /** Every audio track a clip in the index could have extracted. Kept while used. */
  audioValid: ReadonlySet<string>
  now: number
  /** Clear previews: every GIF preview, audio track and orphan goes now, whatever its age. */
  all?: boolean
}

export interface MaintenanceDirs {
  cache: string
  audio: string
  /** The clips folder; exports are swept for leftovers under it and nowhere else. */
  clipsRoot: string
}

export interface MaintenanceResult {
  removed: number
  bytes: number
}

/**
 * How old a cache file may get, in ms, or null for one that stays for good.
 * Zero means it goes on sight.
 */
export function cacheLimit(name: string, r: MaintenanceRules): number | null {
  if (name.startsWith('~')) return ORPHAN_GRACE_MS
  if (name.startsWith(GIF_PREVIEW_PREFIX)) return r.all ? 0 : GIF_PREVIEW_TTL_MS
  if (r.cacheValid.has(name)) return null
  return r.all ? 0 : ORPHAN_GRACE_MS
}

/** As `cacheLimit`, for the audio folder. */
export function audioLimit(name: string, r: MaintenanceRules): number | null {
  if (name.startsWith('~')) return ORPHAN_GRACE_MS
  if (r.audioValid.has(name)) return r.all ? 0 : AUDIO_TRACK_TTL_MS
  return r.all ? 0 : ORPHAN_GRACE_MS
}

/** A `~` file under the clips root that an export was writing when it stopped. */
export function isExportLeftover(name: string): boolean {
  return EXPORT_LEFTOVER.test(name)
}

/** Marks a file used now, so its lifetime counts from here. Never fatal: a miss only means it expires sooner. */
export async function touch(path: string): Promise<void> {
  const now = new Date()
  await utimes(path, now, now).catch(() => undefined)
}

/**
 * One pass over the three places. Cheap by construction: one listing per
 * folder, a stat only for the files that have a limit, and every step an
 * await, so nothing here ever holds the event loop.
 */
export async function runMaintenance(
  dirs: MaintenanceDirs,
  rules: MaintenanceRules,
): Promise<MaintenanceResult> {
  const result: MaintenanceResult = { removed: 0, bytes: 0 }
  await sweep(dirs.cache, (n) => cacheLimit(n, rules), rules.now, result)
  await sweep(dirs.audio, (n) => audioLimit(n, rules), rules.now, result)
  const leftover = (n: string): number | null => (isExportLeftover(n) ? ORPHAN_GRACE_MS : null)
  await sweep(dirs.clipsRoot, leftover, rules.now, result, LEFTOVER_DEPTH)
  return result
}

async function sweep(
  dir: string,
  limitOf: (name: string) => number | null,
  now: number,
  result: MaintenanceResult,
  depth = 0,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      if (depth > 0) await sweep(join(dir, entry.name), limitOf, now, result, depth - 1)
      continue
    }
    if (!entry.isFile()) continue
    const limit = limitOf(entry.name)
    if (limit === null) continue
    const path = join(dir, entry.name)
    const s = await stat(path).catch(() => null)
    if (!s) continue
    // A zero limit goes regardless: a file touched a moment after `now` was
    // taken would otherwise read as younger than nothing.
    if (limit > 0 && now - s.mtimeMs < limit) continue
    // A file a job still holds open refuses to go; it is caught next time.
    const gone = await unlink(path).then(
      () => true,
      () => false,
    )
    if (gone) {
      result.removed++
      result.bytes += s.size
    }
  }
}
