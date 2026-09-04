import { createHash } from 'node:crypto'
import { relative, sep } from 'node:path'
import type { LibraryFolder } from '@shared/types'

export function clipId(filePath: string): string {
  return createHash('sha1').update(filePath.toLowerCase()).digest('hex').slice(0, 16)
}

/**
 * ShadowPlay:  "Counter-strike 2 2024.05.03 - 21.44.12.03.DVR.mp4"
 * OBS / others: "2024-05-03 21-44-12.mp4", "Replay_2024-05-03_21-44-12", "20240503_214412"
 */
const DATE_PATTERNS = [
  /(\d{4})[.\-_](\d{2})[.\-_](\d{2})[ _-]+(\d{2})[.\-_:](\d{2})[.\-_:](\d{2})/,
  /(\d{4})(\d{2})(\d{2})[_\-T]?(\d{2})(\d{2})(\d{2})/,
]

export function parseRecordedAt(name: string): number | null {
  for (const re of DATE_PATTERNS) {
    const m = name.match(re)
    if (!m) continue
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number)
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) continue
    const t = new Date(y, mo - 1, d, h, mi, s).getTime()
    if (!Number.isNaN(t)) return t
  }
  return null
}

/** Strip the timestamp / DVR suffix so the card shows something human. */
export function cleanTitle(name: string, game: string): string {
  let t = name
    .replace(/\s*\d{4}[.\-_]\d{2}[.\-_]\d{2}.*$/, '')
    .replace(/\s*\d{8}[_\-T]?\d{6}.*$/, '')
    .replace(/\.DVR$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t || t.toLowerCase() === game.toLowerCase()) t = game
  return t
}

export function prettifyGame(raw: string): string {
  return raw.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Clips'
}

/**
 * ShadowPlay writes to `<Videos>\<Game>\<clip>.mp4`, so the first path
 * segment below the library root is the game. Files sitting directly in the
 * root fall back to the root folder's own name.
 */
export function deriveGame(folder: LibraryFolder, filePath: string): string {
  const parts = relative(folder.path, filePath).split(sep)
  return parts.length > 1 ? prettifyGame(parts[0]) : prettifyGame(folder.name)
}
