/**
 * Turns the pixels of an HDR screenshot (.jxr, JPEG XR — what ShadowPlay saves
 * when the game runs in HDR) into 8-bit sRGB the viewer can show. Chromium and
 * the bundled ffmpeg both lack a JPEG XR decoder; the `jpegxr` package is
 * Microsoft's reference jxrlib compiled to WebAssembly, and it decodes these
 * files to the same floats Windows' own codec does (checked against WIC on the
 * user's captures, and about three times faster). The decode runs in a worker
 * thread (lib/jxr.worker.ts) so the main process never stalls on it; this
 * module is the pure part — the tuning and the tone map — so `npm test` can
 * cover it without a codec or an image.
 *
 * What the pixels are: scRGB — linear light, sRGB primaries, 1.0 = 80 nits,
 * with no ceiling. A screenshot of an HDR game runs well past 1.0 in the sun
 * and the fire. `toneMapToRgb` maps that to 8-bit sRGB:
 *   1. divide by `paperWhite`, so the value the game used for "ordinary white"
 *      becomes 1.0 (2.0 = 160 nits, close to Windows' default SDR white);
 *   2. leave every pixel whose luminance sits under `knee` exactly as it is —
 *      the HUD, the midtones, most of the frame — and roll everything above it
 *      off with an exponential shoulder that starts at slope 1 and never quite
 *      reaches 1.0, so the brightest highlights keep some separation instead
 *      of clipping to a flat white;
 *   3. scale the three channels by the same factor (a luminance-only curve
 *      keeps hue), clamp, and encode through the sRGB transfer curve.
 * `paperWhite` is the knob that matters if a render looks too dark or too
 * washed out next to Windows Photos; both it and `knee` can be overridden
 * through the environment for tuning without a rebuild.
 */

export interface JxrTuning {
  /** scRGB value shown as SDR white. 1.0 = 80 nits; 2.0 ≈ 160 nits. */
  paperWhite: number
  /** Luminance (after paper-white scaling) below which nothing is touched; 0 < knee < 1. */
  knee: number
}

export const JXR_DEFAULTS: JxrTuning = { paperWhite: 2.0, knee: 0.7 }

/** Environment variables that override the defaults, for comparing renders against Windows Photos. */
export const JXR_ENV = { paperWhite: 'SIFT_JXR_PAPER_WHITE', knee: 'SIFT_JXR_KNEE' } as const

/** A finite number from the environment, or the default; out-of-range values are pulled back in. */
function tuned(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  const v = raw !== undefined && raw !== '' && Number.isFinite(n) ? n : fallback
  return Math.min(max, Math.max(min, v))
}

export function jxrTuning(base: NodeJS.ProcessEnv = process.env): JxrTuning {
  return {
    paperWhite: tuned(base[JXR_ENV.paperWhite], JXR_DEFAULTS.paperWhite, 0.1, 100),
    knee: tuned(base[JXR_ENV.knee], JXR_DEFAULTS.knee, 0.05, 0.95),
  }
}

/** What the decoder reports about the pixels it hands back (the `pixelInfo` of the `jpegxr` package). */
export interface JxrPixelInfo {
  /** 3 for RGB, 4 for RGBA. */
  channels: number
  /** '8', '16Float' or '32Float' — the storage of one channel. */
  bitDepth: string
  bitsPerPixel: number
  /** Blue first in memory. */
  bgr: boolean
}

export interface DecodedJxr {
  width: number
  height: number
  pixelInfo: JxrPixelInfo
  /** Packed pixels in the format `pixelInfo` describes; jxrlib hands them back as stored. */
  bytes: Uint8Array
}

/** sRGB transfer curve for [0, 1], in 4096 steps: a table lookup per channel rather than a pow. */
let srgbLut: Uint8Array | null = null
function lut(): Uint8Array {
  if (srgbLut) return srgbLut
  const table = new Uint8Array(4097)
  for (let i = 0; i <= 4096; i++) {
    const c = i / 4096
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    table[i] = Math.round(s * 255)
  }
  srgbLut = table
  return table
}

/** IEEE half to a JS number. */
export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1
  const exp = (h >> 10) & 0x1f
  const frac = h & 0x3ff
  if (exp === 0) return sign * frac * 2 ** -24
  if (exp === 0x1f) return frac ? NaN : sign * Infinity
  return sign * (1 + frac / 1024) * 2 ** (exp - 15)
}

/** A float view over the decoded bytes, copied first when the offset would misalign it. */
function floatChannels(image: DecodedJxr): (i: number) => number {
  const { bytes, pixelInfo } = image
  if (pixelInfo.bitDepth === '32Float') {
    const aligned = bytes.byteOffset % 4 === 0 ? bytes : new Uint8Array(bytes) // copy realigns at offset 0
    const f = new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4)
    return (i) => f[i]
  }
  if (pixelInfo.bitDepth === '16Float') {
    const aligned = bytes.byteOffset % 2 === 0 ? bytes : new Uint8Array(bytes)
    const u = new Uint16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2)
    return (i) => halfToFloat(u[i])
  }
  throw new Error(`Unsupported JPEG XR pixel format: ${pixelInfo.bitDepth}-bit`)
}

/**
 * Packed 8-bit RGB, ready for ffmpeg's rawvideo input. Float pixels are tone
 * mapped as described above; 8-bit ones are already sRGB and pass through
 * with only the channel order fixed.
 */
export function toneMapToRgb(image: DecodedJxr, tuning: JxrTuning): Uint8Array {
  const { width, height, pixelInfo } = image
  const channels = pixelInfo.channels
  if (channels !== 3 && channels !== 4)
    throw new Error(`Unsupported JPEG XR channel count: ${channels}`)
  const count = width * height
  const out = new Uint8Array(count * 3)
  const [ri, gi, bi] = pixelInfo.bgr ? [2, 1, 0] : [0, 1, 2]

  if (pixelInfo.bitDepth === '8') {
    const src = image.bytes
    if (src.length < count * channels) throw new Error('JPEG XR pixel data is short')
    for (let p = 0, s = 0, o = 0; p < count; p++, s += channels, o += 3) {
      out[o] = src[s + ri]
      out[o + 1] = src[s + gi]
      out[o + 2] = src[s + bi]
    }
    return out
  }

  const at = floatChannels(image)
  const table = lut()
  const inv = 1 / tuning.paperWhite
  const knee = tuning.knee
  const shoulder = 1 - knee
  for (let p = 0, s = 0, o = 0; p < count; p++, s += channels, o += 3) {
    // Negative components are out-of-gamut scRGB, not darkness: floor them.
    let r = Math.max(0, at(s + ri) * inv)
    let g = Math.max(0, at(s + gi) * inv)
    let b = Math.max(0, at(s + bi) * inv)
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (y > knee) {
      const k = (knee + shoulder * (1 - Math.exp(-(y - knee) / shoulder))) / y
      r *= k
      g *= k
      b *= k
    }
    out[o] = table[Math.round(Math.min(1, r) * 4096)]
    out[o + 1] = table[Math.round(Math.min(1, g) * 4096)]
    out[o + 2] = table[Math.round(Math.min(1, b) * 4096)]
  }
  return out
}
