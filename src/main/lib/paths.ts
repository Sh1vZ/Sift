import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

/** Binaries live outside the asar archive in a packaged build. */
function unpacked(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}

export const FFMPEG = ffmpegPath ? unpacked(ffmpegPath) : ''
export const FFPROBE = ffprobeStatic?.path ? unpacked(ffprobeStatic.path) : ''

export const userDataDir = (): string => app.getPath('userData')
export const cacheDir = (): string => join(userDataDir(), 'thumbs')
export const libraryDb = (): string => join(userDataDir(), 'library.db')

export function ensureDirs(): void {
  mkdirSync(cacheDir(), { recursive: true })
}
