/**
 * The Sift logo: a valid PNG carrying the mark where the design says it should
 * be, on a transparent background, filling the canvas. Runs on plain Node
 * (`npm test`); the PNG is decoded here by hand since it is unfiltered RGBA.
 * The committed build/icon.png is checked against the same renderer, so a
 * geometry change that was never regenerated fails here rather than shipping.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { LOGO_SIZE, hexToRgb, renderLogo } from '../scripts/icon'

let failed = 0
const check = (cond: unknown, msg: string): void => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
}

type Px = [number, number, number, number]

interface Decoded {
  size: number
  at(x: number, y: number): Px
}

function decode(png: Buffer): Decoded {
  const size = png.readUInt32BE(16)
  let offset = 8
  const idat: Buffer[] = []
  while (offset < png.length) {
    const len = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + len))
    offset += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = 1 + size * 4
  return {
    size,
    at(x, y) {
      const o = y * stride + 1 + x * 4
      return [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]]
    },
  }
}

const near = (a: number, b: number, tol = 3): boolean => Math.abs(a - b) <= tol
const isRgb = (px: Px, hex: string): boolean => {
  const [r, g, b] = hexToRgb(hex)
  return near(px[0], r) && near(px[1], g) && near(px[2], b)
}

/** True when a colour sits on the gradient between two hexes, within tolerance. */
function onGradient(px: Px, from: string, to: string, tol = 4): boolean {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  return [0, 1, 2].every(
    (i) => px[i] >= Math.min(a[i], b[i]) - tol && px[i] <= Math.max(a[i], b[i]) + tol,
  )
}

/**
 * How much of the canvas the mark reaches. Measured as the extent of its
 * bounding box, not as a count of rows holding ink — the mark is a stack of
 * slats with gaps between them, so a fifth of its rows are empty by design.
 */
function coverage(img: Decoded): { columns: number; rows: number; opaque: number } {
  let x0 = img.size
  let y0 = img.size
  let x1 = -1
  let y1 = -1
  let opaque = 0
  for (let y = 0; y < img.size; y++) {
    for (let x = 0; x < img.size; x++) {
      const alpha = img.at(x, y)[3]
      if (alpha === 255) opaque++
      if (alpha <= 8) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return {
    columns: (x1 - x0 + 1) / img.size,
    rows: (y1 - y0 + 1) / img.size,
    opaque: opaque / img.size ** 2,
  }
}

function logoCases(): void {
  const size = 128
  const png = renderLogo(size)
  check(
    png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'output starts with the PNG signature',
  )
  const img = decode(png)
  check(img.size === size, `IHDR carries the requested size (${size})`)

  check(
    img.at(0, 0)[3] === 0 &&
      img.at(size - 1, 0)[3] === 0 &&
      img.at(0, size - 1)[3] === 0 &&
      img.at(size - 1, size - 1)[3] === 0,
    'all four corners are transparent — there is no tile',
  )

  const { columns, rows, opaque } = coverage(img)
  check(rows > 0.9, `the mark fills its taller axis (${Math.round(rows * 100)}% of rows)`)
  check(columns > 0.7, `and most of the other (${Math.round(columns * 100)}% of columns)`)
  // Inside an opaque tile this was ~1; the mark alone covers well under half.
  check(opaque < 0.6, `the background is transparent (${Math.round(opaque * 100)}% opaque)`)

  // A slat carries the gradient rather than the flat white it had on the old
  // tile. Searched over a range rather than one row: a row that lands on a band
  // edge is only partly covered, so none of its pixels are fully opaque.
  let slat: Px | null = null
  for (let y = Math.round(size * 0.25); y < Math.round(size * 0.6) && !slat; y++) {
    for (let x = 0; x < size && !slat; x++) {
      if (img.at(x, y)[3] === 255) slat = img.at(x, y)
    }
  }
  check(slat !== null, 'the middle slat is opaque')
  check(
    slat !== null && onGradient(slat, '#a78bfa', '#7c3aed'),
    'a slat is drawn in the brand gradient, not white',
  )

  // The gap between two slats shows the background straight through.
  let gap = false
  for (let y = Math.round(size * 0.2); y < Math.round(size * 0.75); y++) {
    if (img.at(Math.round(size * 0.3), y)[3] === 0) gap = true
  }
  check(gap, 'the gap between slats is transparent, not filled')

  // The bar that fell through keeps its own colour, low in the canvas.
  let fallen = false
  for (let y = Math.round(size * 0.78); y < size && !fallen; y++) {
    for (let x = 0; x < size && !fallen; x++) {
      const px = img.at(x, y)
      if (px[3] > 200 && isRgb(px, '#fb7185')) fallen = true
    }
  }
  check(fallen, 'the last slat is the rose accent')

  // The size that matters: the notification area draws at 16pt logical.
  check(coverage(decode(renderLogo(16))).rows > 0.8, 'a 16px render still fills the canvas')
}

/** The committed PNG has to be what the current renderer produces. */
function committedIconCase(): void {
  const png = readFileSync(join(process.cwd(), 'build', 'icon.png'))
  check(
    png.equals(renderLogo(LOGO_SIZE)),
    'build/icon.png is current (run `npm run icon` if this fails)',
  )
}

logoCases()
committedIconCase()
console.log(failed ? `\n${failed} check(s) failed` : '\nall icon checks passed')
process.exit(failed ? 1 : 0)
