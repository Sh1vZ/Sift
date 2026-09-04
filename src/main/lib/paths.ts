import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'

/**
 * Binaries live outside the asar archive in a packaged build. Idempotent on
 * purpose: 'app.asar.unpacked' contains 'app.asar', so rewriting a path that has
 * already been rewritten would produce 'app.asar.unpacked.unpacked'. Which of the
 * two a module reports is up to how it resolves itself, so neither is assumed.
 */
function unpacked(p: string): string {
  return p.includes('app.asar.unpacked') ? p : p.replace('app.asar', 'app.asar.unpacked')
}

/**
 * Required rather than imported: @ffprobe-installer resolves its binary at
 * module load and *throws* when the platform package is missing — an install
 * that skipped optional dependencies, or an architecture it has no build for.
 * A static import would take the whole app down with it, where Sift is meant to
 * start anyway and report the tooling as unavailable (see `ffmpegAvailable` in
 * lib/media.ts, which is what an empty path here feeds).
 */
function resolveFfprobe(): string {
  try {
    const require = createRequire(import.meta.url)
    return (require('@ffprobe-installer/ffprobe') as { path?: string }).path ?? ''
  } catch {
    return ''
  }
}

export const FFMPEG = ffmpegPath ? unpacked(ffmpegPath) : ''
const ffprobePath = resolveFfprobe()
export const FFPROBE = ffprobePath ? unpacked(ffprobePath) : ''

export const userDataDir = (): string => app.getPath('userData')
export const cacheDir = (): string => join(userDataDir(), 'thumbs')
export const libraryDb = (): string => join(userDataDir(), 'library.db')

export function ensureDirs(): void {
  mkdirSync(cacheDir(), { recursive: true })
}

/**
 * The app icon on disk, for the window and the tray. A packaged build gets it
 * from extraResources (electron-builder.yml) because the asar ships only out/**;
 * dev and unpacked builds read it straight out of build/. Undefined when neither
 * is there — the window falls back to the exe icon, the tray is simply skipped.
 */
export function appIconPath(): string | undefined {
  for (const p of [
    join(process.resourcesPath, 'icon.png'),
    join(import.meta.dirname, '../../build/icon.png'),
  ]) {
    if (existsSync(p)) return p
  }
  return undefined
}
