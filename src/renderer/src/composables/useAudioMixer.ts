import { computed, ref } from 'vue'
import type { AudioTrack, Clip } from '@shared/types'
import { clamp } from '@/utils/format'
import { settings, updateSettings } from './useLibrary'

/**
 * Per-track audio for the player.
 *
 * ShadowPlay and OBS write game audio and the mic as separate streams, and
 * Chromium renders exactly one of them — whichever the container marks
 * default. So the default track keeps playing from the <video> element, where
 * it stays perfectly in step with the picture, and every *other* track is cut
 * out to its own file in main and played from a hidden <audio> beside it.
 *
 * That leaves two clocks to keep together. The video is the clock; the aux
 * elements follow it, corrected at every deliberate jump (see `syncAll`) and
 * nudged back by `tick` in between.
 *
 * One clip is played at a time, so this is module state, reset on clip change.
 */

/** Past this the tracks have visibly parted; snap rather than creep back. */
const HARD_RESYNC_S = 0.25
/**
 * Under this, a difference is as likely to be measurement noise as real drift:
 * `currentTime` only moves as the last decoded buffer lands. Correcting inside
 * the noise floor makes the corrector hunt, which is audible on a voice.
 */
const DEADBAND_S = 0.05
/** A seek is not instant; re-measuring mid-seek would stack a second correction. */
const RESYNC_COOLDOWN_MS = 300
/**
 * Rate trim used to walk a small drift out. Deliberately gentle: real drift is
 * well under half a percent, while 5% is close to a semitone and audible on
 * speech even with pitch preservation on.
 */
const MAX_NUDGE = 0.03
/** Only unintended drift reaches this; the deliberate jumps are all handled at source. */
const TICK_MS = 750

export interface MixerTrack extends AudioTrack {
  /** What the user calls it: their own name, the stream's, or "Track 2". */
  name: string
  /** "Stereo", "Mono", "5.1" — the one clue to which stream is the mic. */
  hint: string
  /** Both together, for tooltips and screen readers. */
  label: string
}

export const tracks = ref<MixerTrack[]>([])
export const gains = ref<number[]>([])
export const mutes = ref<boolean[]>([])
/** Track index -> the file main cut for it, once it has been asked for. */
const files = ref<Record<number, string>>({})

/** More than one track is what makes the mixer worth showing at all. */
export const hasMixer = computed(() => tracks.value.length > 1)
/** Every track but the one the <video> element is already playing. */
export const auxTracks = computed(() => tracks.value.filter((t) => !t.isDefault))
/** Indices that can be heard, for defaulting the export selection. */
export const audibleTracks = computed(() =>
  tracks.value.filter((t) => !mutes.value[t.index] && gains.value[t.index] > 0).map((t) => t.index),
)

/** True while every track is audible at full volume — the state you start in. */
export const isDefaultMix = computed(
  () => !tracks.value.some((t) => mutes.value[t.index] || (gains.value[t.index] ?? 1) < 1),
)

/**
 * What the control bar button reads. Naming the track you are actually hearing
 * is the whole point: the feature is invisible otherwise, and "which audio am I
 * getting" is the question the button exists to answer.
 */
export const mixSummary = computed(() => {
  const audible = audibleTracks.value
  if (!audible.length) return 'Silent'
  if (audible.length === 1) return (tracks.value[audible[0]]?.name ?? 'Track').slice(0, 14)
  if (audible.length === tracks.value.length) return isDefaultMix.value ? 'All' : 'Mix'
  return `${audible.length} tracks`
})

/** Elements registered by the player, by track index. The video is not one of them. */
const elements = new Map<number, HTMLAudioElement>()
let video: HTMLVideoElement | null = null
let timer = 0
let resyncUntil = 0
/**
 * Bumped on every clip change. An extraction that resolves after the player has
 * moved on belongs to a clip nobody is watching, and must not touch the state.
 */
let generation = 0

function channelHint(channels: number): string {
  if (channels === 1) return 'Mono'
  if (channels === 2) return 'Stereo'
  if (channels === 6) return '5.1'
  if (channels === 8) return '7.1'
  return channels > 0 ? `${channels} ch` : ''
}

/**
 * What to call a track. The user's own name wins, because recorders tag almost
 * nothing: ShadowPlay writes neither a title nor a language, so without one the
 * best on offer is the position and the channel count — and the channel count
 * is the only clue that tells a mono mic from stereo game audio.
 */
function trackName(track: AudioTrack, index: number): string {
  const custom = settings.value.audioTrackNames?.[index]?.trim()
  return custom || track.title || track.language || `Track ${index + 1}`
}

/** Rename a track everywhere. Blank restores the default name. */
export function setTrackName(index: number, name: string): void {
  const names = [...(settings.value.audioTrackNames ?? [])]
  while (names.length <= index) names.push('')
  names[index] = name.trim().slice(0, 40)
  // Trailing blanks carry no information and would grow the row forever.
  while (names.length && !names[names.length - 1]) names.pop()
  void updateSettings({ audioTrackNames: names })
  tracks.value = tracks.value.map((t, i) =>
    i === index ? { ...t, name: trackName(t, i), label: labelFor(trackName(t, i), t.hint) } : t,
  )
}

function labelFor(name: string, hint: string): string {
  return hint ? `${name} · ${hint}` : name
}

/** Adopt a clip's tracks, applying the default-track preference. */
export function loadTracks(clip: Clip): void {
  generation++
  const list = clip.audioTracks ?? []
  tracks.value = list.map((t, i) => {
    const name = trackName(t, i)
    const hint = channelHint(t.channels)
    return { ...t, name, hint, label: labelFor(name, hint) }
  })
  gains.value = list.map(() => 1)
  // A preference naming a track this clip does not have would silence it
  // entirely, with nothing in the UI to explain why.
  const preferred = settings.value.defaultAudioTrack
  const solo = list.length > 1 && preferred >= 0 && preferred < list.length ? preferred : -1
  mutes.value = list.map((_, i) => (solo < 0 ? false : i !== solo))
  files.value = {}
  elements.clear()
}

/** Drop everything: no clip open, or the open one is going away. */
export function resetTracks(): void {
  generation++
  stopTicking()
  tracks.value = []
  gains.value = []
  mutes.value = []
  files.value = {}
  elements.clear()
  video = null
}

export function setVideo(el: HTMLVideoElement | null): void {
  video = el
  // Rate trimming is inaudible only while pitch is held; the video is nudged
  // alongside the aux elements when the user picks a speed, so it wants it too.
  if (el) el.preservesPitch = true
}

export function registerAux(index: number, el: HTMLAudioElement | null): void {
  if (el) {
    el.preservesPitch = true
    elements.set(index, el)
  } else elements.delete(index)
}

/** URL for a track, or '' until main has cut it. */
export function auxSrc(index: number): string {
  const file = files.value[index]
  return file ? window.api.audioUrl(file) : ''
}

/**
 * Ask main for every extra track this clip has. Extraction is cached, so this
 * is cheap on a clip already opened once, and the results are dropped outright
 * if the player moved on while ffmpeg was running.
 */
export async function ensureTracks(clip: Clip): Promise<void> {
  const mine = generation
  for (const track of auxTracks.value) {
    const res = await window.api.clips.audioTrack(clip.id, track.index)
    if (mine !== generation) return
    // A track that cannot be cut simply stays silent; the clip still plays, and
    // an error veil over a perfectly good video would be worse than the gap.
    if (res.ok && res.file) files.value = { ...files.value, [track.index]: res.file }
  }
}

/** Effective volume for one track, master included. */
function volumeFor(index: number, master: number): number {
  return clamp(master * (gains.value[index] ?? 1), 0, 1)
}

/**
 * Push master volume/mute down onto every aux element. The <video> element is
 * left to the player, which owns it — but its track's gain applies there too.
 */
export function applyGains(master: number, masterMuted: boolean): void {
  for (const [index, el] of elements) {
    el.volume = volumeFor(index, master)
    el.muted = masterMuted || (mutes.value[index] ?? false)
  }
}

/** The video element's own volume, with the default track's gain folded in. */
export function videoVolume(master: number): number {
  const track = tracks.value.find((t) => t.isDefault)
  return track ? volumeFor(track.index, master) : clamp(master, 0, 1)
}

export function videoMuted(masterMuted: boolean): boolean {
  const track = tracks.value.find((t) => t.isDefault)
  return masterMuted || (track ? (mutes.value[track.index] ?? false) : false)
}

export function setGain(index: number, value: number): void {
  const next = [...gains.value]
  next[index] = clamp(value, 0, 1)
  gains.value = next
}

export function setMute(index: number, value: boolean): void {
  const next = [...mutes.value]
  next[index] = value
  mutes.value = next
}

/** Back to every track, full volume. */
export function showAll(): void {
  mutes.value = tracks.value.map(() => false)
  gains.value = tracks.value.map(() => 1)
}

/** Leave one track audible. This is what "switch to track N" means here. */
export function solo(index: number): void {
  mutes.value = tracks.value.map((t) => t.index !== index)
}

/**
 * Step through the tracks one at a time and then back to all of them, so the
 * shortcut can always undo itself without opening the mixer.
 */
export function cycleSolo(): void {
  if (!hasMixer.value) return
  const audible = audibleTracks.value
  if (audible.length !== 1) {
    solo(0)
    return
  }
  const next = audible[0] + 1
  if (next >= tracks.value.length) showAll()
  else solo(next)
}

/**
 * Line every aux element up with the video, now. Called at each deliberate
 * discontinuity — a seek, a play, a rate change — because none of those give
 * the drift corrector anything to work with until it is far too late.
 */
export function syncAll(): void {
  const v = video
  if (!v) return
  resyncUntil = Date.now() + RESYNC_COOLDOWN_MS
  for (const [index, el] of elements) {
    el.playbackRate = v.playbackRate
    seekAux(el, index, v.currentTime)
    if (v.paused) el.pause()
    else void el.play().catch(() => undefined)
  }
}

export function pauseAll(): void {
  for (const el of elements.values()) el.pause()
}

/** Stop and unload every aux element, releasing its decoder as the video does. */
export function releaseAll(): void {
  stopTicking()
  for (const el of elements.values()) {
    el.pause()
    el.removeAttribute('src')
    el.load()
  }
}

function seekAux(el: HTMLAudioElement, index: number, videoTime: number): void {
  const target = videoTime + (tracks.value[index]?.offset ?? 0)
  if (!Number.isFinite(target)) return
  el.currentTime = clamp(target, 0, el.duration || target)
}

/**
 * Walk out whatever drift the event fan-out did not prevent. Everything
 * deliberate is handled at source, so this only ever sees the slow kind: a
 * clock difference between two decoders, or a stall on one of them.
 */
function tick(): void {
  const v = video
  if (!v || v.paused || v.seeking || v.readyState < 2) return
  if (Date.now() < resyncUntil) return
  const now = v.currentTime
  for (const [index, el] of elements) {
    // A track shorter than the video has legitimately ended; nudging it would
    // only restart it from the top.
    if (el.ended || (el.duration && el.currentTime >= el.duration - 0.05)) continue
    if (el.readyState < 2 || el.seeking) continue
    // The video is playing and this one is not: a stall it never got told had
    // ended, or an element that finished loading mid-playback. Either way it
    // has to be put back in step and started, not merely nudged.
    if (el.paused) {
      seekAux(el, index, now)
      void el.play().catch(() => undefined)
      continue
    }
    const drift = el.currentTime - (now + (tracks.value[index]?.offset ?? 0))
    if (Math.abs(drift) > HARD_RESYNC_S) {
      seekAux(el, index, now)
      resyncUntil = Date.now() + RESYNC_COOLDOWN_MS
    } else if (Math.abs(drift) > DEADBAND_S) {
      // Relative to the video's own rate, never absolute: the user may be
      // watching at 0.5x or 2x, and an absolute write would undo that.
      const trim = clamp(-drift, -MAX_NUDGE, MAX_NUDGE)
      el.playbackRate = v.playbackRate * (1 + trim)
    } else if (el.playbackRate !== v.playbackRate) {
      el.playbackRate = v.playbackRate
    }
  }
}

export function startTicking(): void {
  if (timer || !elements.size) return
  timer = window.setInterval(tick, TICK_MS)
}

export function stopTicking(): void {
  if (!timer) return
  window.clearInterval(timer)
  timer = 0
}
