/**
 * The tone map behind HDR screenshot renders, and the pure helpers screenshots
 * lean on. Runs on plain Node (`npm test`); nothing here decodes a real file —
 * the images are a few hand-built pixels.
 */
import { cleanTitle } from '../src/main/lib/clips'
import {
  JXR_DEFAULTS,
  JXR_ENV,
  halfToFloat,
  jxrTuning,
  toneMapToRgb,
  type DecodedJxr,
} from '../src/main/lib/jxr'
import { isMediaFile } from '../src/main/lib/scanner'
import { imageFormatLabel, isHdrImage, mediaKindOf } from '../src/shared/types'

let failed = 0
const check = (cond: unknown, msg: string): void => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
}

/** One-row RGBA float image from scRGB triples. */
function floatImage(pixels: Array<[number, number, number]>, bitDepth = '32Float'): DecodedJxr {
  const bytes =
    bitDepth === '32Float'
      ? new Uint8Array(new Float32Array(pixels.flatMap(([r, g, b]) => [r, g, b, 1])).buffer)
      : new Uint8Array(new Uint16Array(pixels.flatMap(([r, g, b]) => [r, g, b, 0x3c00])).buffer)
  return {
    width: pixels.length,
    height: 1,
    pixelInfo: {
      channels: 4,
      bitDepth,
      bitsPerPixel: bitDepth === '32Float' ? 128 : 64,
      bgr: false,
    },
    bytes,
  }
}

const rgb = (out: Uint8Array, i: number): [number, number, number] => [
  out[i * 3],
  out[i * 3 + 1],
  out[i * 3 + 2],
]

function toneMapCases(): void {
  const tuning = { paperWhite: 2, knee: 0.7 }
  const out = toneMapToRgb(
    floatImage([
      [0, 0, 0],
      [1, 1, 1],
      [2, 2, 2],
      [200, 200, 200],
      [-0.5, 0.2, 0.2],
      [1.4, 0.7, 0.35],
      [3, 3, 3],
    ]),
    tuning,
  )
  check(out.length === 7 * 3, 'output is packed RGB, three bytes a pixel')
  check(
    rgb(out, 0).every((c) => c === 0),
    'black stays black',
  )
  // 1.0 scRGB at paper white 2 is linear 0.5: under the knee, so straight sRGB (188).
  check(
    rgb(out, 1).every((c) => c === 188),
    'a midtone under the knee passes through the sRGB curve',
  )
  const white = rgb(out, 2)
  check(
    white.every((c) => c > 230 && c < 255),
    'paper white lands just under 255 on the shoulder',
  )
  check(
    rgb(out, 3).every((c) => c === 255),
    'a huge highlight clamps to white',
  )
  check(rgb(out, 6)[0] > white[0], 'brighter than paper white is still brighter, not clipped flat')
  const [r, g, b] = rgb(out, 4)
  check(r === 0 && g > 0 && g === b, 'a negative (out of gamut) component floors at zero')
  const [hr, hg, hb] = rgb(out, 5)
  check(hr > hg && hg > hb, 'a bright orange keeps its hue order through the shoulder')

  const half = toneMapToRgb(floatImage([[0x3c00, 0x3800, 0x3400]], '16Float'), {
    paperWhite: 1,
    knee: 0.99,
  })
  check(
    half[0] === 255 && half[1] === 188 && half[2] === 137,
    'half-float pixels decode (1.0 → 255, 0.5 → 188, 0.25 → 137)',
  )
  check(halfToFloat(0x3c00) === 1 && halfToFloat(0xbc00) === -1, 'halfToFloat handles sign')
  check(halfToFloat(0x0001) > 0 && halfToFloat(0x0001) < 1e-7, 'halfToFloat handles subnormals')

  const eight = toneMapToRgb(
    {
      width: 1,
      height: 1,
      pixelInfo: { channels: 4, bitDepth: '8', bitsPerPixel: 32, bgr: true },
      bytes: new Uint8Array([10, 20, 30, 255]),
    },
    tuning,
  )
  check(
    eight[0] === 30 && eight[1] === 20 && eight[2] === 10,
    '8-bit BGRA passes through with the order fixed',
  )

  let threw = false
  try {
    toneMapToRgb(
      {
        width: 1,
        height: 1,
        pixelInfo: { channels: 4, bitDepth: '16', bitsPerPixel: 64, bgr: false },
        bytes: new Uint8Array(8),
      },
      tuning,
    )
  } catch {
    threw = true
  }
  check(threw, 'an unsupported pixel format is refused rather than rendered wrong')
}

function tuningCases(): void {
  const defaults = jxrTuning({})
  check(
    defaults.paperWhite === JXR_DEFAULTS.paperWhite && defaults.knee === JXR_DEFAULTS.knee,
    'jxrTuning falls back to the defaults',
  )
  const tuned = jxrTuning({ [JXR_ENV.paperWhite]: '2.5', [JXR_ENV.knee]: '5' })
  check(tuned.paperWhite === 2.5, 'a paper white from the environment wins')
  check(tuned.knee === 0.95, 'an out-of-range knee is pulled back into range')
  check(
    jxrTuning({ [JXR_ENV.paperWhite]: 'abc' }).paperWhite === 2,
    'a non-numeric value falls back',
  )
  check(JXR_DEFAULTS.knee > 0 && JXR_DEFAULTS.knee < 1, 'the default knee leaves a shoulder')
}

function kindCases(): void {
  check(mediaKindOf('.mp4') === 'video', 'mp4 is a video')
  check(mediaKindOf('.JXR') === 'image', 'jxr is an image whatever its case')
  check(
    mediaKindOf('.png') === 'image' && mediaKindOf('.gif') === 'image',
    'png and gif are images',
  )
  check(mediaKindOf('.webp') === null, 'webp is not indexed')
  check(mediaKindOf('.txt') === null, 'a text file is not media')
  check(isHdrImage('.JXR') && !isHdrImage('.png'), 'only jxr is the HDR format')
  check(isMediaFile('D:\\v\\a.mp4', false), 'videos are media with images off')
  check(!isMediaFile('D:\\v\\a.png', false), 'images are not media with images off')
  check(isMediaFile('D:\\v\\a.png', true), 'images are media with images on')
  check(!isMediaFile('D:\\v\\~a.png', true), 'a temp file is never media')
}

function labelCases(): void {
  check(imageFormatLabel('.png') === 'PNG', 'png labels as PNG')
  check(
    imageFormatLabel('.jpeg') === 'JPG' && imageFormatLabel('.jpg', true) === 'JPEG',
    'jpeg labels',
  )
  check(imageFormatLabel('.jxr') === 'HDR', 'the card calls a jxr HDR')
  check(imageFormatLabel('.jxr', true) === 'JPEG XR · HDR', 'the details pane spells jxr out')
  check(imageFormatLabel('.tiff') === 'TIFF', 'an unknown format falls back to its extension')
}

function titleCases(): void {
  check(
    cleanTitle('Crimson Desert Screenshot 2026.03.20 - 17.33.30.60', 'Crimson Desert') ===
      'Crimson Desert',
    'a ShadowPlay screenshot name collapses to the game',
  )
  check(
    cleanTitle('MortalShell2_Screenshot_2026.08.20 - 17.13.38.55', 'MortalShell2') ===
      'MortalShell2',
    'an underscored screenshot name collapses too',
  )
  check(
    cleanTitle('Counter-strike 2 2024.05.03 - 21.44.12.03.DVR', 'Counter-strike 2') ===
      'Counter-strike 2',
    'a recording name still collapses to the game',
  )
  check(
    cleanTitle('Screenshot tour', 'Game') === 'Screenshot tour',
    'the word is only stripped at the end',
  )
}

toneMapCases()
tuningCases()
kindCases()
labelCases()
titleCases()
console.log(failed ? `${failed} check(s) failed` : 'ALL OK')
process.exit(failed ? 1 : 0)
