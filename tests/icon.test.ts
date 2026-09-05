/**
 * The themed app icon: a valid PNG of the requested size whose pixels carry the
 * theme's colours where the design says they should. Runs on plain Node
 * (`npm test`); the PNG is decoded here by hand since it is unfiltered RGBA.
 */
import { inflateSync } from 'node:zlib'
import { hexToRgb, renderAppIcon } from '../src/main/lib/icon'
import { THEME_BRAND } from '../src/shared/themes'

let failed = 0
const check = (cond: unknown, msg: string): void => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
}

interface Decoded {
  size: number
  at(x: number, y: number): [number, number, number, number]
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
const isRgb = (px: [number, number, number, number], hex: string): boolean => {
  const [r, g, b] = hexToRgb(hex)
  return near(px[0], r) && near(px[1], g) && near(px[2], b) && px[3] === 255
}

function iconCases(): void {
  const size = 128
  const brand = THEME_BRAND.ember
  const png = renderAppIcon(brand, size)
  check(
    png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'output starts with the PNG signature',
  )
  const img = decode(png)
  check(img.size === size, `IHDR carries the requested size (${size})`)

  check(img.at(0, 0)[3] === 0, 'the corner outside the rounded tile is transparent')
  check(img.at(2, size / 2)[3] === 0, 'the margin left of the tile is transparent')
  // Just inside the tile's left edge, halfway down: gradient, no glyph there.
  const edge = img.at(Math.round(size * 0.1), size / 2)
  check(edge[3] === 255, 'inside the tile is fully opaque')
  check(
    !isRgb(edge, brand.onPrimary) && !isRgb(edge, brand.accent),
    'the tile edge is gradient, not glyph',
  )

  // The middle slat (design y 22.5–30.5) crosses the triangle's widest part.
  const unit = (size * (1 - (2 * 24) / 512) * 0.75) / 64
  const g0 = (size - unit * 64) / 2
  const slat = img.at(Math.round(g0 + 24 * unit), Math.round(g0 + 26.5 * unit))
  check(isRgb(slat, brand.onPrimary), 'a middle slat pixel is the on-primary colour')

  const gap = img.at(Math.round(g0 + 24 * unit), Math.round(g0 + 21.25 * unit))
  check(!isRgb(gap, brand.onPrimary), 'the gap between slats shows the tile through')

  // The fallen slat sits at design y 44.5–53.5 after its (5, 1) shift.
  const last = img.at(Math.round(g0 + 24 * unit), Math.round(g0 + 48.5 * unit))
  check(isRgb(last, brand.accent), 'the last slat is the accent colour')

  const solar = decode(renderAppIcon(THEME_BRAND.solar, size))
  check(
    isRgb(
      solar.at(Math.round(g0 + 24 * unit), Math.round(g0 + 26.5 * unit)),
      THEME_BRAND.solar.onPrimary,
    ),
    'a light identity (solar) draws its slats in its dark on-primary',
  )

  const small = decode(renderAppIcon(brand, 16))
  check(small.size === 16 && small.at(8, 8)[3] === 255, 'a 16px render is still a filled tile')
}

iconCases()
console.log(failed ? `\n${failed} check(s) failed` : '\nall icon checks passed')
process.exit(failed ? 1 : 0)
