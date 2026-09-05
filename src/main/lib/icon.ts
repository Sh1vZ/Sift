import { deflateSync } from 'node:zlib'
import type { ThemeBrand } from '@shared/themes'

/**
 * The app icon, drawn in a theme's colours: the "slats" play triangle on its
 * gradient tile, the last bar fallen through in the accent. Same geometry as
 * build/icon.png and the splash mark; this exists so the taskbar and tray can
 * follow the theme without shipping one PNG per theme. Pure Node — no Electron,
 * no image library — so `npm test` covers it, and main wraps the result in a
 * `nativeImage`.
 *
 * Cost: a 256px render is ~600k supersampled points and takes a few tens of
 * milliseconds. It runs once at boot and once per theme change, on the main
 * process, which is idle at both moments.
 */

/** Big enough for every place Windows draws a window icon; the tray resizes down. */
export const ICON_SIZE = 256

const SUPERSAMPLE = 3

// Geometry as fractions of the tile, taken from the 512px master.
const MARGIN = 24 / 512
const RADIUS = 104 / 512
const GLYPH = 0.75

type Rgb = [number, number, number]

// The glyph in its own 64-unit design space.
const TRIANGLE: [number, number][] = [
  [17, 12],
  [51, 32],
  [17, 52],
]
const SLATS: [number, number][] = [
  [12, 20],
  [22.5, 30.5],
  [33, 41],
]
const LAST_SLAT: [number, number] = [43.5, 52.5]
const LAST_SLAT_SHIFT: [number, number] = [5, 1]

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function inTriangle(px: number, py: number): boolean {
  const [[ax, ay], [bx, by], [cx, cy]] = TRIANGLE
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

/** Renders the icon as an RGBA PNG buffer, `size` pixels square. */
export function renderAppIcon(brand: ThemeBrand, size = ICON_SIZE): Buffer {
  const margin = size * MARGIN
  const tile = size - margin * 2
  const radius = size * RADIUS
  const glyph = tile * GLYPH
  const g0 = (size - glyph) / 2
  const unit = glyph / 64

  const top = hexToRgb(brand.secondary)
  const bottom = hexToRgb(brand.primary)
  const glyphColor = hexToRgb(brand.onPrimary)
  const accent = hexToRgb(brand.accent)

  const lo = margin
  const hi = size - margin
  const r2 = radius * radius

  const sample = (x: number, y: number): Rgb | null => {
    if (x < lo || x >= hi || y < lo || y >= hi) return null
    // Rounded corners: outside the corner circles is outside the tile.
    const cx = x < lo + radius ? lo + radius : x > hi - radius ? hi - radius : x
    const cy = y < lo + radius ? lo + radius : y > hi - radius ? hi - radius : y
    if ((x - cx) ** 2 + (y - cy) ** 2 > r2) return null

    const gx = (x - g0) / unit
    const gy = (y - g0) / unit
    for (const [y0, y1] of SLATS) {
      if (gy >= y0 && gy < y1 && inTriangle(gx, gy)) return glyphColor
    }
    const sx = gx - LAST_SLAT_SHIFT[0]
    const sy = gy - LAST_SLAT_SHIFT[1]
    if (sy >= LAST_SLAT[0] && sy < LAST_SLAT[1] && inTriangle(sx, sy)) return accent

    // The tile gradient runs down the top-left → bottom-right diagonal.
    const t = Math.min(1, Math.max(0, (x - lo + (y - lo)) / (2 * tile)))
    return [
      top[0] + (bottom[0] - top[0]) * t,
      top[1] + (bottom[1] - top[1]) * t,
      top[2] + (bottom[2] - top[2]) * t,
    ]
  }

  const stride = 1 + size * 4
  const raw = Buffer.alloc(stride * size)
  const samples = SUPERSAMPLE * SUPERSAMPLE
  for (let py = 0; py < size; py++) {
    const row = py * stride
    raw[row] = 0 // PNG filter: none
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const c = sample(px + (sx + 0.5) / SUPERSAMPLE, py + (sy + 0.5) / SUPERSAMPLE)
          if (!c) continue
          r += c[0]
          g += c[1]
          b += c[2]
          hits++
        }
      }
      const o = row + 1 + px * 4
      if (hits === 0) continue // already transparent black
      // Average only the covered samples so edge pixels keep the fill colour
      // under partial alpha instead of darkening toward transparent black.
      raw[o] = Math.round(r / hits)
      raw[o + 1] = Math.round(g / hits)
      raw[o + 2] = Math.round(b / hits)
      raw[o + 3] = Math.round((hits / samples) * 255)
    }
  }

  return encodePng(size, raw)
}

// --- PNG container -----------------------------------------------------------

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size: number, filteredRows: Buffer): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filteredRows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
