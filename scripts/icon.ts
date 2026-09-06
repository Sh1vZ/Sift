/**
 * Regenerates `build/icon.png`, the single Sift logo.
 *
 * One image serves every surface — the installer, the exe (electron-builder
 * turns this into the .ico), the shortcuts, the window, Alt+Tab and the tray —
 * so they cannot disagree. That matters on Windows in particular: a packaged
 * app's taskbar button is drawn from the shortcut the shell matched it to, not
 * from `BrowserWindow.setIcon`, so the only icon guaranteed to reach the
 * taskbar is the one the installer wrote.
 *
 * The mark is the same 64-unit "slats" geometry as the in-app logos in
 * Sidebar.vue and splash.html, and is not changed here — what changed is its
 * presentation: no tile, a transparent background, and the mark scaled to fill
 * the canvas so it survives being drawn at 16px in the notification area.
 *
 * Pure Node — no image library — so `npm test` covers it. Run with
 * `npm run icon`; importing the module just gets the renderer.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

/** The master electron-builder downsamples for every icon size it needs. */
export const LOGO_SIZE = 512

/**
 * How much of the canvas the mark's bounding box fills on its longer axis. Not
 * quite 1: Windows clips nothing, but a mark flush to the edge reads as cramped
 * next to the padded icons either side of it on the taskbar.
 */
const FILL = 0.94

const SUPERSAMPLE = 3

/**
 * The neutral identity, fixed rather than per-theme. The mark carries the
 * gradient itself now that there is no tile behind it to carry it — white
 * slats would vanish on a light taskbar.
 */
const TOP = '#a78bfa'
const BOTTOM = '#7c3aed'
/** The bar that "fell through": rose-400, which stays legible at tray size. */
const FALLEN = '#fb7185'

type Rgb = [number, number, number]

// The glyph in its own 64-unit design space. Shared with the in-app marks —
// changing it here alone would put the icon out of step with them.
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

/** Which part of the mark covers a point in glyph space, if any. */
function shapeAt(gx: number, gy: number): 'slat' | 'fallen' | null {
  for (const [y0, y1] of SLATS) {
    if (gy >= y0 && gy < y1 && inTriangle(gx, gy)) return 'slat'
  }
  const sx = gx - LAST_SLAT_SHIFT[0]
  const sy = gy - LAST_SLAT_SHIFT[1]
  if (sy >= LAST_SLAT[0] && sy < LAST_SLAT[1] && inTriangle(sx, sy)) return 'fallen'
  return null
}

interface Bounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * The mark's bounding box in glyph space, measured rather than declared so the
 * fit stays correct if the geometry above is ever adjusted. It is what lets the
 * mark fill the canvas: the shape is neither square nor centred in its own
 * 64-unit space, so scaling that space would leave the old dead margin behind.
 */
function inkBounds(): Bounds {
  const step = 1 / 16
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let gy = 0; gy < 64; gy += step) {
    for (let gx = 0; gx < 64; gx += step) {
      if (!shapeAt(gx, gy)) continue
      if (gx < x0) x0 = gx
      if (gx > x1) x1 = gx
      if (gy < y0) y0 = gy
      if (gy > y1) y1 = gy
    }
  }
  return { x0, y0, x1: x1 + step, y1: y1 + step }
}

/** Renders the logo as an RGBA PNG buffer, `size` pixels square. */
export function renderLogo(size = LOGO_SIZE): Buffer {
  const ink = inkBounds()
  const width = ink.x1 - ink.x0
  const height = ink.y1 - ink.y0
  // Fit the longer axis; the shorter one centres in what is left over.
  const unit = (size * FILL) / Math.max(width, height)
  const ox = (size - width * unit) / 2 - ink.x0 * unit
  const oy = (size - height * unit) / 2 - ink.y0 * unit

  const top = hexToRgb(TOP)
  const bottom = hexToRgb(BOTTOM)
  const fallen = hexToRgb(FALLEN)

  const sample = (x: number, y: number): Rgb | null => {
    const gx = (x - ox) / unit
    const gy = (y - oy) / unit
    const shape = shapeAt(gx, gy)
    if (!shape) return null
    if (shape === 'fallen') return fallen
    // Top-left → bottom-right across the mark, as it ran across the old tile.
    const t = Math.min(1, Math.max(0, (gx - ink.x0) / width / 2 + (gy - ink.y0) / height / 2))
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

// `npm run icon`. Guarded so the test can import the renderer without writing.
if (process.argv.includes('--write')) {
  const out = join(process.cwd(), 'build', 'icon.png')
  writeFileSync(out, renderLogo())
  console.log(`icon: wrote ${out} at ${LOGO_SIZE}px`)
}
