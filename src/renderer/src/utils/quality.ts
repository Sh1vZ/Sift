import type { Clip } from '@shared/types'

/**
 * Average bitrate in bits per second, derived from the size and duration
 * already indexed on every clip. Deliberately not read from ffprobe: this
 * needs no extra probe pass and it works on clips indexed before the figure
 * existed, which a new `bit_rate` column would not. It counts audio and
 * container overhead alongside video — at gameplay bitrates a 192 kbps audio
 * track is well under a percent of the total.
 */
export function bitrate(clip: Clip): number {
  if (!clip.size || clip.duration <= 0) return 0
  return (clip.size * 8) / clip.duration
}

/** Human bitrate, e.g. "48 Mbps". Empty when the clip has not been probed yet. */
export function formatBitrate(bps: number): string {
  if (!bps || !Number.isFinite(bps)) return ''
  const mbps = bps / 1_000_000
  if (mbps >= 10) return `${Math.round(mbps)} Mbps`
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`
  return `${Math.round(bps / 1000)} kbps`
}

/**
 * Rough bitrate efficiency against H.264. HEVC and AV1 reach comparable
 * perceptual quality at roughly half the bitrate, so their density is scaled
 * up before it meets the H.264 thresholds below. Approximate by nature —
 * enough to bucket and sort a library, not a perceptual measurement.
 */
const CODEC_FACTOR: Record<string, number> = {
  hevc: 1.8,
  h265: 1.8,
  av1: 2,
  vp9: 1.6
}

/**
 * Bits per pixel: bitrate against the pixel rate. This, rather than raw
 * bitrate, is what makes two clips comparable — 20 Mbps is generous at 1080p60
 * and thin at 4K60. Returns 0 when there is not enough probed data to judge.
 */
export function bitsPerPixel(clip: Clip): number {
  const pixels = clip.width * clip.height * clip.fps
  const bps = bitrate(clip)
  if (!pixels || !bps) return 0
  return (bps / pixels) * (CODEC_FACTOR[clip.vcodec] ?? 1)
}

export type QualityTier = 'high' | 'good' | 'fair' | 'low' | 'unknown'

export interface QualityTierDef {
  id: QualityTier
  label: string
  color: 'success' | 'primary' | 'warning' | 'neutral'
  /** Lower bound in codec-normalised bits per pixel. */
  min: number
}

/**
 * Thresholds calibrated for high-motion gameplay, the demanding end of what an
 * encoder sees: fast pans, particles and foliage eat bits a talking head never
 * would. Rules of thumb rather than a verdict — a clip one step down is
 * usually still perfectly watchable.
 */
export const QUALITY_TIERS: QualityTierDef[] = [
  { id: 'high', label: 'High', color: 'success', min: 0.2 },
  { id: 'good', label: 'Good', color: 'primary', min: 0.1 },
  { id: 'fair', label: 'Fair', color: 'warning', min: 0.05 },
  { id: 'low', label: 'Compressed', color: 'neutral', min: 0 }
]

const UNKNOWN: QualityTierDef = { id: 'unknown', label: 'Unknown', color: 'neutral', min: 0 }

/** The tier a clip falls in; `unknown` until it has been probed. */
export function qualityTier(clip: Clip): QualityTierDef {
  const bpp = bitsPerPixel(clip)
  if (!bpp) return UNKNOWN
  return QUALITY_TIERS.find((t) => bpp >= t.min) ?? UNKNOWN
}
