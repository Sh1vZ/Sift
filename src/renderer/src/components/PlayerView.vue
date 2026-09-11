<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { AudioExportExt, Clip, ExportKind } from '@shared/types'
import {
  AUDIO_EXPORT_FORMATS,
  GIF_FPS,
  GIF_WIDTHS,
  imageFormatLabel,
  isHdrClip,
} from '@shared/types'
import ElasticSlider from './bits/ElasticSlider.vue'
import AudioMixer from './AudioMixer.vue'
import ImageStage from './ImageStage.vue'
import FavouriteButton from './FavouriteButton.vue'
import PlayerDetails from './PlayerDetails.vue'
import TrimBar from './TrimBar.vue'
import ExportBanner from './ExportBanner.vue'
import PendingBanner from './youtube/PendingBanner.vue'
import UploadBanner from './youtube/UploadBanner.vue'
import {
  markSeen,
  pendingByClip,
  revealClip,
  settings,
  toggleFavourite,
  updateSettings,
} from '@/composables/useLibrary'
import { clipMenuItems, deleteClipDialog, shareMenuItems } from '@/composables/useClipMenu'
import {
  applyGains,
  auxSrc,
  auxTracks,
  cycleSolo,
  ensureTracks,
  hasMixer,
  loadTracks,
  pauseAll,
  registerAux,
  releaseAll,
  resetTracks,
  setVideo,
  startTicking,
  stopTicking,
  syncAll,
  videoMuted,
  videoVolume,
} from '@/composables/useAudioMixer'
import { shortcutsOpen } from '@/composables/useShortcuts'
import { searchOpen } from '@/composables/useSearch'
import {
  closePlayer,
  closeRequests,
  consumeRekey,
  current,
  fullscreen,
  hasNext,
  hasPrev,
  neighbor,
  nextClip,
  openSource,
  originRect,
  pendingEdit,
  prevClip,
  source,
} from '@/composables/usePlayer'
import {
  canExportAudio,
  canExportGif,
  canSubmit,
  currentProblem,
  editing,
  enterEdit,
  exitEdit,
  exportKind,
  exportMuted,
  exportName,
  filmstrip,
  gifProblem,
  inSec,
  outSec,
  prepareFilmstrip,
  rekeyFilmstrip,
  resetRange,
  selectionLength,
  setIn,
  setOut,
  submitAudio,
  submitCurrent,
  submitGif,
  submitting,
} from '@/composables/useEditor'
import { exportJobs } from '@/composables/useExports'
import { gifPreviewOpen, openGifPreview } from '@/composables/useGifPreview'
import { fadeOut, flipFrom, flipTo } from '@/composables/useMotion'
import { activeTheme } from '@/composables/useTheme'
import { visible as windowVisible } from '@/composables/useWindowVisibility'
import { dialog } from '@/composables/useDialogs'
import { uploadByClip, uploadDialog } from '@/composables/useUploads'
import { toast } from '@/composables/useToasts'
import {
  clamp,
  formatBytes,
  formatDuration,
  formatFull,
  formatResolution,
  formatTimecode,
  fractionAcross,
} from '@/utils/format'
import { bitrate, formatBitrate } from '@/utils/quality'

const api = window.api
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
/** Containers stream copy keeps as they are; everything else exports as mp4. */
const KEEP_EXT = new Set(['.webm', '.avi', '.wmv', '.flv'])

const stageArea = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
const seekEl = ref<HTMLElement | null>(null)

// The overlay only mounts while a clip is open.
const clip = computed(() => current.value!)
/**
 * A screenshot: the stage is a picture, the chrome is a viewer's, and every
 * playback control stands down. The <video> stays mounted underneath, hidden —
 * the audio mixer took hold of it once at mount and keeps it for the next clip.
 */
const isImage = computed(() => clip.value.kind === 'image')
// Structural rather than `InstanceType<typeof ImageStage>`: .vue modules carry
// no types for eslint, and this is the whole of the surface the keys call.
const imageStage = ref<{
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
  actual: () => void
  toggleFit: () => void
  pan: (dx: number, dy: number) => void
  isFit: boolean
  PAN_STEP: number
} | null>(null)
/** This clip's YouTube upload, live or just finished, for the banner over the stage. */
const upload = computed(() => uploadByClip.value[clip.value.id])
/** A slow action (delete, rename, YouTube removal) running on this clip. */
const pending = computed(() => pendingByClip.value[clip.value.id])
/** This recording's export, queue to done, for the banner over the stage. */
const exportJob = computed(() => {
  const mine = exportJobs.value.filter((j) => j.sourceId === clip.value.id)
  return mine.length ? mine[mine.length - 1] : undefined
})
/**
 * Set while the window is off screen: the media is unloaded to stop the decoder,
 * but the overlay stays mounted so a trim in progress, the rate and the details
 * pane all survive. `undefined` drops the attribute entirely — an empty string
 * would resolve against the document and fire `error`.
 */
const suspended = ref(false)
/** Where playback was when the window went away, or -1 for nothing to restore. */
let resumeAt = -1
/**
 * True until the open animation has landed. Chromium composites a <video> in a
 * layer of its own, and for the first frames of an ancestor's transform
 * animation that layer keeps painting at its untransformed size — inside a
 * stage scaled down to the card, that reads as a cropped, zoomed-in frame that
 * then snaps to fit. So the stage carries the poster through the flip and takes
 * the media on afterwards, which also keeps the decoder off the main thread
 * while GSAP is driving it.
 */
const flipping = ref(true)
/** Set once the element has a frame to show, which is when the poster can go. */
const frameReady = ref(false)
const poster = computed(() => (clip.value.thumb ? api.thumbUrl(clip.value.thumb) : ''))
const showPoster = computed(() => Boolean(poster.value) && (flipping.value || !frameReady.value))
/**
 * What the stage streams, pinned when a clip opens rather than read off the
 * record each time: a rename re-keys the record, and a src that followed it
 * would reload the element and start the video over. Main keeps resolving the
 * old id to the file's new path (see `Library.clipPath`), so the element plays
 * on across the rename and only a real step to another clip re-pins these.
 */
const mediaId = ref(clip.value.id)
const imageUrl = ref(imageUrlOf(clip.value))
/** The SDR render of an HDR screenshot, else the original through the same door the video uses. */
function imageUrlOf(c: Clip): string {
  return c.render ? api.thumbUrl(c.render) : api.mediaUrl(c.id)
}
const src = computed(() =>
  suspended.value || flipping.value || isImage.value ? undefined : api.mediaUrl(mediaId.value),
)
/**
 * What the image stage shows. Gated like the video's src, so the poster
 * carries the flip and nothing decodes while the window is away.
 */
const imageSrc = computed(() =>
  !isImage.value || suspended.value || flipping.value ? undefined : imageUrl.value,
)
const ratio = computed(() =>
  clip.value.width && clip.value.height ? clip.value.width / clip.value.height : 16 / 9,
)
const meta = computed(() =>
  [
    clip.value.game,
    formatFull(clip.value.recordedAtMs),
    formatResolution(clip.value.width, clip.value.height, clip.value.fps),
    isHdrClip(clip.value) ? 'HDR' : '',
    isImage.value ? imageFormatLabel(clip.value.ext, true) : formatBitrate(bitrate(clip.value)),
    formatBytes(clip.value.size),
  ]
    .filter(Boolean)
    .join(' · '),
)

const playing = ref(false)
const time = ref(0)
const duration = ref(clip.value.duration)
const buffered = ref(0)
const buffering = ref(false)
const ended = ref(false)
const failed = ref(false)
const volume = ref(settings.value.volume)
const muted = ref(settings.value.muted)
const rate = ref(1)
const loop = ref(false)
const controls = ref(true)
const seeking = ref(false)
const hoverPct = ref<number | null>(null)
const closing = ref(false)
const details = ref(settings.value.detailsPane)
const flash = ref<{ icon: string; key: number } | null>(null)
const stageSize = ref({ width: 0, height: 0 })

const playedPct = computed(() =>
  duration.value ? `${(time.value / duration.value) * 100}%` : '0%',
)
const bufferedPct = computed(() =>
  duration.value ? `${(buffered.value / duration.value) * 100}%` : '0%',
)
const volumeIcon = computed(() =>
  muted.value || volume.value === 0
    ? 'i-lucide-volume-x'
    : volume.value < 0.5
      ? 'i-lucide-volume-1'
      : 'i-lucide-volume-2',
)

/** Trimming needs the probed duration; without it the handles have nothing to measure against. */
const canEdit = computed(
  () => clip.value.probeState === 'ok' && clip.value.duration > 0 && !failed.value,
)
const outExt = computed(() =>
  KEEP_EXT.has(clip.value.ext.toLowerCase()) ? clip.value.ext.toLowerCase() : '.mp4',
)
const editHint = computed(() =>
  canEdit.value ? (editing.value ? 'Cancel trim' : 'Trim & export') : 'Media info still loading',
)

const failedActions = computed(() => [
  {
    label: 'Show in Explorer',
    icon: 'i-lucide-folder-open',
    color: 'neutral' as const,
    variant: 'subtle' as const,
    onClick: () => revealClip(clip.value),
  },
])
const failedCopy = computed(() =>
  isImage.value
    ? {
        icon: 'i-lucide-image-off',
        title: "Can't show this image",
        text: 'The file may be damaged, or its format is not one the viewer can decode. You can still open it from Explorer.',
      }
    : {
        icon: 'i-lucide-video-off',
        title: "Can't play this file",
        text: 'The codec may not be supported by the built-in player. You can still open it from Explorer.',
      },
)

// ------------------------------------------------------------- viewer

/** Zoom as the image bar shows it, and whether the picture is at fit. */
const zoomPercent = ref(100)
const zoomFit = ref(true)
function onZoom(percent: number, atFit: boolean): void {
  zoomPercent.value = percent
  zoomFit.value = atFit
}

/**
 * A screenshot counts as seen once it has been on screen a moment — opened
 * and looked at, not stepped past on the way to another clip.
 */
const SEEN_AFTER_MS = 1000
let seenTimer = 0
function cancelDwell(): void {
  window.clearTimeout(seenTimer)
  seenTimer = 0
}
function onImageLoaded(): void {
  frameReady.value = true
  cancelDwell()
  // Read when it fires, not now: a rename inside the second re-keys the
  // record, and the old one would be marked under an id that is gone.
  seenTimer = window.setTimeout(() => void markSeen(clip.value), SEEN_AFTER_MS)
}

/**
 * Every clip action, reachable whether or not the details pane is showing.
 * Same list the card's right-click menu builds, minus Play and Trim, which
 * the player already has in front of you.
 */
const moreItems = computed(() =>
  clipMenuItems(clip.value, {
    variant: source.value === 'clips' ? 'export' : 'recording',
    omitOpen: true,
    beforeDelete,
  }),
)

/** Copy file and Upload, behind the header's Share button; the details pane offers the same list. */
const shareItems = computed(() => shareMenuItems(clip.value))

const rateItems = computed<DropdownMenuItem[]>(() =>
  RATES.map((r) => ({
    label: `${r}×`,
    type: 'checkbox',
    checked: rate.value === r,
    onSelect: () => setRate(r),
  })),
)

// ------------------------------------------------------------- sizing

let observer: ResizeObserver | null = null
function fitStage(): void {
  // Measure the padding-free content box so the stage never spills into the
  // chrome margins and gets letterboxed.
  const area = stageArea.value
  if (!area) return
  const r = ratio.value
  const width = Math.min(area.clientWidth, area.clientHeight * r)
  stageSize.value = { width: Math.floor(width), height: Math.floor(width / r) }
}
watch(ratio, fitStage)

// ----------------------------------------------------- controls visibility

let hideTimer = 0
function poke(): void {
  controls.value = true
  window.clearTimeout(hideTimer)
  // Edit mode keeps the chrome up: you are working in it, not watching.
  if (editing.value) return
  hideTimer = window.setTimeout(() => {
    // A picture is "playing" for this purpose: the chrome gets out of its way too.
    if ((playing.value || isImage.value) && !seeking.value && hoverPct.value === null)
      controls.value = false
  }, 3500)
}

/**
 * Changing clips would throw the trim away, so in edit mode the arrows and
 * N/P stay where they are but say no — once per edit session, in a toast, and
 * always in the tooltip.
 */
let blockedHint = false
function stepClip(direction: -1 | 1): void {
  if (editing.value) {
    if (!blockedHint) {
      blockedHint = true
      toast(
        'info',
        'Finish or cancel the trim first',
        'Export, or press Esc to leave edit mode, then change clips.',
      )
    }
    return
  }
  if (direction > 0) nextClip()
  else prevClip()
}

watch(editing, (on) => {
  if (!on) {
    blockedHint = false
    // Leaving mid-drag (Escape) takes the bar with it, so the hand never lifts here.
    onTrimDrag(false)
  }
  poke()
})

// ------------------------------------------------------------- playback

function showFlash(icon: string): void {
  flash.value = { icon, key: Date.now() }
  window.setTimeout(() => (flash.value = null), 480)
}

function togglePlay(): void {
  // A click on a picture is a click on a picture; the hidden video must not start.
  if (isImage.value) return
  const v = video.value
  if (!v || failed.value) return
  if (v.paused) {
    void v.play().catch(() => undefined)
    showFlash('i-lucide-play')
  } else {
    v.pause()
    showFlash('i-lucide-pause')
  }
}

function replay(): void {
  seekTo(0)
  togglePlay()
}

function seekTo(seconds: number): void {
  const v = video.value
  if (!v) return
  const t = clamp(seconds, 0, duration.value || 0)
  v.currentTime = t
  time.value = t
  lastTime = t
  ended.value = false
  // Setting currentTime fires nothing the mixer could mirror, and every jump in
  // the player comes through here — the trim preview's loop included.
  syncAll()
}
const seekBy = (delta: number): void => scrubTo(time.value + delta)

/** One frame at the clip's rate, paused so the frame you land on stays put. */
function stepFrame(direction: -1 | 1): void {
  video.value?.pause()
  pauseAll()
  seekBy(direction / (clip.value.fps || 30))
}

let volumeTimer = 0
function persistVolume(): void {
  window.clearTimeout(volumeTimer)
  volumeTimer = window.setTimeout(
    () => void updateSettings({ volume: volume.value, muted: muted.value }),
    400,
  )
}
/**
 * Master volume and mute reach the video and every extra track together, each
 * scaled by that track's own gain. One place computes it so a soloed track
 * cannot drift out of step with the slider.
 */
function applyVolume(): void {
  if (video.value) {
    video.value.volume = videoVolume(volume.value)
    video.value.muted = videoMuted(muted.value)
  }
  applyGains(volume.value, muted.value)
}
function setVolume(value: number): void {
  volume.value = clamp(value, 0, 1)
  applyVolume()
  if (volume.value > 0 && muted.value) setMuted(false)
  else persistVolume()
}
function setMuted(value: boolean): void {
  muted.value = value
  applyVolume()
  persistVolume()
}
function setRate(r: number): void {
  rate.value = r
  if (video.value) video.value.playbackRate = r
  // The corrector trims around the video's rate, so it has to see the new one.
  syncAll()
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    /* ignore: fullscreen can be refused */
  }
}
const onFullscreen = (): void => {
  fullscreen.value = Boolean(document.fullscreenElement)
  void nextTick(fitStage)
}

// video element events
function onLoadedMetadata(): void {
  const v = video.value
  if (!v) return
  duration.value = v.duration || clip.value.duration
  applyVolume()
  v.playbackRate = rate.value
  if (resumeAt < 0) {
    syncAll()
    return
  }
  // Back from the tray: land on the frame we left, paused. The element carries
  // `autoplay`, and pause() is what clears that flag — without it a window
  // restored from the tray would start playing on its own.
  v.currentTime = Math.min(resumeAt, duration.value)
  resumeAt = -1
  v.pause()
  // Aux elements reload on their own schedule; this puts whichever have
  // arrived onto the restored frame, and the rest follow as they load.
  syncAll()
}

/**
 * An extra track is ready. Registration happens here rather than through a
 * template ref: the mixer keys elements by track index, this fires again after
 * a suspend reload, and it does not churn on the re-render every `timeupdate`
 * causes. A track that never loads simply stays silent — an error veil over a
 * perfectly good video would be the worse failure.
 */
function onAuxLoaded(index: number, e: Event): void {
  registerAux(index, e.target as HTMLAudioElement)
  applyVolume()
  syncAll()
  startTicking()
}
/** Fraction of a clip that counts as having watched it. */
const SEEN_AT = 0.9

/**
 * Whether playing on from here is watching the clip. Outside edit mode it
 * always is. Inside, the preview loops within the selection, so position alone
 * cannot say: a trimmed range near the end would clear SEEN_AT on every lap
 * without the clip ever having been watched. A selection that still spans
 * essentially the whole clip — what edit mode opens with, and what every clip
 * stays on under the `editOnOpen` setting — is the clip.
 */
const watchingWholeClip = computed(
  () => !editing.value || selectionLength.value >= duration.value * SEEN_AT,
)

let lastTime = 0
function onTimeUpdate(): void {
  const v = video.value
  if (!v || suspended.value) return
  if (!seeking.value) time.value = v.currentTime
  // Watched once you have seen essentially all of it. Ahead of the loop below,
  // so the lap that reaches the end of an untrimmed preview still counts.
  if (watchingWholeClip.value && duration.value > 0 && v.currentTime / duration.value >= SEEN_AT)
    void markSeen(clip.value)
  // Edit mode previews the selection on a loop: crossing the out-point (or
  // having been dragged past it) wraps back to the in-point.
  if (editing.value && !v.paused && v.currentTime >= outSec.value) {
    if (lastTime < outSec.value || v.currentTime - outSec.value > 0.3) {
      seekTo(inSec.value)
      return
    }
  }
  lastTime = v.currentTime
}
function onProgress(): void {
  const v = video.value
  if (!v?.buffered.length) return
  for (let i = 0; i < v.buffered.length; i++) {
    if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) {
      buffered.value = v.buffered.end(i)
      return
    }
  }
  buffered.value = v.buffered.end(v.buffered.length - 1)
}
function onEnded(): void {
  // Nothing plays while the window is away; this can only be the teardown.
  if (suspended.value) return
  if (editing.value) {
    // The out-point sits at the very end: keep the preview loop going. A lap
    // of the whole clip is still a watch, even though the player never stops.
    if (watchingWholeClip.value) void markSeen(clip.value)
    seekTo(inSec.value)
    void video.value?.play().catch(() => undefined)
    return
  }
  playing.value = false
  // A mic track commonly runs a moment past the last video frame; without this
  // its tail plays over the start of whatever autoplay moves on to.
  pauseAll()
  // Watched to the very end, even if no `timeupdate` landed past the threshold.
  void markSeen(clip.value)
  if (settings.value.autoplayNext && hasNext.value) {
    nextClip()
    return
  }
  ended.value = true
  controls.value = true
}
function onError(): void {
  // Unloading the source is not a broken clip.
  if (suspended.value) return
  failed.value = true
  playing.value = false
  buffering.value = false
}

function onPlay(): void {
  playing.value = true
  // Frame stepping and scrubbing leave the aux elements wherever they stopped,
  // so they are lined up here rather than trusted to be in place already.
  syncAll()
  startTicking()
}
function onPause(): void {
  playing.value = false
  pauseAll()
  stopTicking()
}
/**
 * The spinner is for a real stall, not for a seek's own decode. A seek on a
 * 4K clip is a decoder flush and up to a GOP of frames, 50–300 ms, and a veil
 * flashed over every click read as buffering. So a stall has to last this
 * long before it shows, and it never shows under a drag: the last frame stays
 * put while the hand is on the bar.
 */
const STALL_SHOW_MS = 300
let stallTimer = 0
function stalled(): void {
  if (stallTimer) return
  stallTimer = window.setTimeout(() => {
    stallTimer = 0
    if (!seeking.value) buffering.value = true
  }, STALL_SHOW_MS)
}
function settled(): void {
  window.clearTimeout(stallTimer)
  stallTimer = 0
  buffering.value = false
}
/**
 * A stall on the video decoder does not stall the extracted tracks — they would
 * run on ahead for as long as the source takes to catch up.
 */
function onWaiting(): void {
  pauseAll()
  stalled()
}
function onPlaying(): void {
  settled()
  syncAll()
}

// ------------------------------------------------------------- seek bar

/**
 * Seeks that come in a stream — a drag on either bar, a held arrow key: one
 * is in flight at a time, and the next goes to wherever the hand is by then.
 * Every pointer move as a seek of its own queued them faster than a 4K clip
 * decodes (a flush and up to a GOP of frames each), so the picture trailed
 * the hand by all of them, under a spinner. The bar's playhead follows the
 * hand at once either way; the last position asked for is always reached.
 */
let scrubTarget: number | null = null
function scrubTo(seconds: number): void {
  const v = video.value
  if (!v) return
  if (!v.seeking) {
    scrubTarget = null
    seekTo(seconds)
    return
  }
  const t = clamp(seconds, 0, duration.value || 0)
  scrubTarget = t
  time.value = t
}
function onSeeked(): void {
  settled()
  syncAll()
  if (scrubTarget !== null) {
    const t = scrubTarget
    scrubTarget = null
    seekTo(t)
  }
}

function onSeekDown(e: PointerEvent): void {
  seeking.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  scrubTo(fractionAcross(seekEl.value!, e.clientX) * duration.value)
}
function onSeekMove(e: PointerEvent): void {
  hoverPct.value = fractionAcross(seekEl.value!, e.clientX)
  if (seeking.value) scrubTo(hoverPct.value * duration.value)
}
function onSeekUp(): void {
  seeking.value = false
}
function onSeekLeave(): void {
  hoverPct.value = null
  seeking.value = false
}

// ------------------------------------------------------------- editing

function toggleEdit(): void {
  if (editing.value) exitEdit()
  else if (canEdit.value) enterEdit(clip.value)
  poke()
}

/**
 * The video holds still while a bracket or the playhead is dragged, so the
 * frame under the hand is the one being chosen rather than one that has
 * already moved on, and picks up again where the hand let go — only if it
 * was playing when the hand went down.
 */
let resumeAfterTrimDrag = false
function onTrimDrag(active: boolean): void {
  const v = video.value
  if (!v) return
  if (active) {
    resumeAfterTrimDrag = !v.paused
    v.pause()
  } else if (resumeAfterTrimDrag) {
    resumeAfterTrimDrag = false
    void v.play().catch(() => undefined)
  }
}

/** The export the format switch is set to. */
async function exportNow(): Promise<void> {
  if (!canSubmit.value) return
  await submitCurrent(clip.value)
}

/** The format switch: what the selection becomes. */
const EXPORT_KINDS: ReadonlyArray<{
  kind: ExportKind
  label: string
  icon: string
  hint: string
}> = [
  {
    kind: 'clip',
    label: 'Clip',
    icon: 'i-lucide-film',
    hint: 'A trimmed video, into your clips folder',
  },
  {
    kind: 'audio',
    label: 'Audio only',
    icon: 'i-lucide-music',
    hint: 'Just the sound, to a file you pick — MP3, M4A, WAV or OGG',
  },
  {
    kind: 'gif',
    label: 'GIF',
    icon: 'i-lucide-image-play',
    hint: 'An animated GIF, to a file you pick',
  },
]
const exportLabel = computed(() => {
  switch (exportKind.value) {
    case 'clip':
      return 'Export clip'
    case 'audio':
      return 'Export audio'
    case 'gif':
      return 'Export GIF'
  }
})
const exportHint = computed(() => {
  switch (exportKind.value) {
    case 'clip':
      return 'Cut the selection into your clips folder'
    case 'audio':
      return 'Save the sound to a file you pick'
    case 'gif':
      return 'Save an animated GIF to a file you pick'
  }
})
/** What the name will end in: the clip's container, the audio format the last export used, or .gif. */
const nameExt = computed(() => {
  switch (exportKind.value) {
    case 'clip':
      return outExt.value
    case 'audio':
      return settings.value.audioExportExt
    case 'gif':
      return '.gif'
  }
})

async function exportAudioNow(): Promise<void> {
  if (!canExportAudio.value) return
  await submitAudio(clip.value)
}

async function exportGifNow(): Promise<void> {
  if (!canExportGif.value) return
  await submitGif(clip.value)
}

/** The GIF as it would be saved, in a dialog; saving from there copies the render. */
function previewGifNow(): void {
  if (!canExportGif.value) return
  void openGifPreview(clip.value)
}

const stayOpen = (e: Event): void => e.preventDefault()

/** One line each on what the format is for; the save dialog then opens on the pick. */
const AUDIO_FORMAT_HINTS: Record<AudioExportExt, string> = {
  '.mp3': 'Plays anywhere',
  '.m4a': 'AAC, like the recording',
  '.wav': 'Uncompressed, biggest',
  '.ogg': 'Opus, small and clear',
}
const audioFormatItems = computed<DropdownMenuItem[]>(() =>
  AUDIO_EXPORT_FORMATS.map<DropdownMenuItem>((f) => ({
    label: f.label,
    description: AUDIO_FORMAT_HINTS[f.ext],
    type: 'checkbox',
    checked: settings.value.audioExportExt === f.ext,
    onUpdateChecked: (on: boolean) => {
      if (on) void updateSettings({ audioExportExt: f.ext })
    },
  })),
)
const audioFormatLabel = computed(
  () => AUDIO_EXPORT_FORMATS.find((f) => f.ext === settings.value.audioExportExt)?.label ?? 'MP3',
)
/** Width and frame rate for the next GIF, kept in settings so the pick outlives the session. */
const gifItems = computed<DropdownMenuItem[][]>(() => [
  [
    { label: 'Width', type: 'label' },
    ...GIF_WIDTHS.map<DropdownMenuItem>((w) => ({
      label: `${w} px`,
      type: 'checkbox',
      checked: settings.value.gifWidth === w,
      onSelect: stayOpen,
      onUpdateChecked: (on: boolean) => {
        if (on) void updateSettings({ gifWidth: w })
      },
    })),
  ],
  [
    { label: 'Frame rate', type: 'label' },
    ...GIF_FPS.map<DropdownMenuItem>((f) => ({
      label: `${f} fps`,
      type: 'checkbox',
      checked: settings.value.gifFps === f,
      onSelect: stayOpen,
      onUpdateChecked: (on: boolean) => {
        if (on) void updateSettings({ gifFps: f })
      },
    })),
  ],
])

function goToSource(): void {
  if (!openSource(clip.value))
    toast(
      'error',
      'Source not found',
      'The recording this clip was cut from is no longer in the library.',
    )
}

// ------------------------------------------------------------- actions

function toggleDetails(): void {
  details.value = !details.value
  void updateSettings({ detailsPane: details.value })
}

function close(): void {
  if (closing.value) return
  closing.value = true
  cancelDwell()
  video.value?.pause()
  // closePlayer is a GSAP callback, so the overlay lives on for the length of
  // the animation; without this the extra tracks play through all of it.
  releaseAll()
  // The stage goes back to the poster before anything moves, as on the way in
  // (see `flipping`). Scaling or fading the live frame has Chromium draw the
  // video through shader variants it compiles on first use — a 250 ms freeze
  // on the first close after every launch — while the poster's have long been
  // built by the grid.
  flipping.value = true
  frameReady.value = false
  void leave()
}

async function leave(): Promise<void> {
  await nextTick() // Vue has dropped the src attribute and put the poster up...
  video.value?.load() // ...and this releases the frame, so only the poster is left to draw.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const card = document.querySelector(`[data-clip-id="${clip.value.id}"] .thumb`)
  const rect = card?.getBoundingClientRect() ?? null
  const visible = rect && rect.bottom > 48 && rect.top < window.innerHeight && rect.width > 0
  if (stage.value && visible) flipTo(stage.value, rect, closePlayer)
  else if (stage.value) fadeOut(stage.value, closePlayer)
  else closePlayer()
}

/** Runs once the delete is confirmed, before the file goes: step off the clip first. */
function beforeDelete(): void {
  exitEdit()
  const target = neighbor()
  if (target) current.value = target
  else closePlayer()
}

function remove(): void {
  void deleteClipDialog(clip.value, beforeDelete)
}

// ------------------------------------------------------------- keyboard

/** Esc, Backspace and Alt+←: out of fullscreen, then out of edit mode, then off the page. */
function back(): void {
  if (document.fullscreenElement) void document.exitFullscreen()
  else if (editing.value) exitEdit()
  else close()
}

/**
 * The viewer's keys. Playback keys mean nothing to a picture and fall through
 * unhandled; the arrows pan a zoomed picture and step clips at fit, which is
 * what a photo viewer does with them.
 */
function onImageKey(e: KeyboardEvent): void {
  const stageApi = imageStage.value
  const step = stageApi?.PAN_STEP ?? 80
  let handled = true
  switch (e.key) {
    case 'Escape':
    case 'Backspace':
      back()
      break
    case 's':
      void toggleFavourite(clip.value)
      break
    case 'f':
      void toggleFullscreen()
      break
    case 'i':
      toggleDetails()
      break
    case 'n':
      stepClip(1)
      break
    case 'p':
      stepClip(-1)
      break
    case '+':
    case '=':
      stageApi?.zoomIn()
      break
    case '-':
    case '_':
      stageApi?.zoomOut()
      break
    case '0':
      stageApi?.fit()
      break
    case '1':
      stageApi?.actual()
      break
    case ' ':
      stageApi?.toggleFit()
      break
    case 'ArrowLeft':
      if (e.altKey) back()
      else if (stageApi?.isFit) stepClip(-1)
      else stageApi?.pan(step, 0)
      break
    case 'ArrowRight':
      if (stageApi?.isFit) stepClip(1)
      else stageApi?.pan(-step, 0)
      break
    case 'ArrowUp':
      if (stageApi && !stageApi.isFit) stageApi.pan(0, step)
      else handled = false
      break
    case 'ArrowDown':
      if (stageApi && !stageApi.isFit) stageApi.pan(0, -step)
      else handled = false
      break
    default:
      handled = false
  }
  if (handled) {
    e.preventDefault()
    poke()
  }
}

function onKey(e: KeyboardEvent): void {
  // A modal owns the keyboard: the confirm/prompt host, the upload form, the
  // shortcut list, search, or the GIF preview.
  if (
    dialog.value ||
    uploadDialog.value ||
    shortcutsOpen.value ||
    searchOpen.value ||
    gifPreviewOpen.value
  )
    return
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (isImage.value) return onImageKey(e)
  let handled = true
  switch (e.key) {
    case ' ':
    case 'k':
      togglePlay()
      break
    case 'Escape':
    case 'Backspace':
      back()
      break
    case 'ArrowLeft':
      if (e.altKey) back()
      else seekBy(-5)
      break
    case 'ArrowRight':
      seekBy(5)
      break
    case 'j':
      seekBy(-10)
      break
    case 'l':
      seekBy(10)
      break
    case 'ArrowUp':
      setVolume(volume.value + 0.05)
      break
    case 'ArrowDown':
      setVolume(volume.value - 0.05)
      break
    case 'm':
      setMuted(!muted.value)
      break
    case 's':
      void toggleFavourite(clip.value)
      break
    case 'a':
      if (hasMixer.value) {
        cycleSolo()
        applyVolume()
        showFlash('i-lucide-audio-lines')
      } else handled = false
      break
    case 'f':
      void toggleFullscreen()
      break
    case 'i':
      toggleDetails()
      break
    case 'e':
      toggleEdit()
      break
    case 'n':
      stepClip(1)
      break
    case 'p':
      stepClip(-1)
      break
    case 'r':
      loop.value = !loop.value
      break
    case 'Home':
      seekTo(0)
      break
    case 'End':
      seekTo(duration.value)
      break
    case ',':
      stepFrame(-1)
      break
    case '.':
      stepFrame(1)
      break
    case '[':
      if (editing.value) setIn(time.value)
      else handled = false
      break
    case ']':
      if (editing.value) setOut(time.value)
      else handled = false
      break
    case '{':
      if (editing.value) seekTo(inSec.value)
      else handled = false
      break
    case '}':
      if (editing.value) seekTo(outSec.value)
      else handled = false
      break
    case 'M':
      if (editing.value && clip.value.hasAudio) exportMuted.value = !exportMuted.value
      else handled = false
      break
    case 'G':
      if (editing.value) void exportGifNow()
      else handled = false
      break
    case 'P':
      if (editing.value) previewGifNow()
      else handled = false
      break
    case 'R':
      if (editing.value) resetRange()
      else handled = false
      break
    case 'Enter':
      if (editing.value && e.ctrlKey) void (e.shiftKey ? exportAudioNow() : exportNow())
      else handled = false
      break
    default:
      if (/^[0-9]$/.test(e.key)) seekTo((duration.value * Number(e.key)) / 10)
      else handled = false
  }
  if (handled) {
    e.preventDefault()
    poke()
  }
}

// ------------------------------------------------------------- lifecycle

/**
 * Enter edit mode on open when asked to (Trim & export from a menu) or when the
 * setting says every clip opens that way. Waits for the probe if it must, via
 * the `canEdit` watcher; `pendingEdit` is consumed either way so a later clip
 * change does not re-trigger a one-off request.
 */
let autoEdit = false
function consumePendingEdit(): void {
  if (pendingEdit.value) {
    pendingEdit.value = false
    autoEdit = true
  } else if (settings.value.editOnOpen && !editing.value) {
    autoEdit = true
  }
  if (!autoEdit || !canEdit.value) return
  autoEdit = false
  enterEdit(clip.value)
}

watch(
  () => clip.value.id,
  (id, from) => {
    if (consumeRekey(from, id)) {
      // The same file under a new name: the element keeps streaming the old
      // id, which main still resolves, so playback never notices. Only what
      // is keyed by id follows the record — the extracted tracks, which main
      // moved to the new id's names (their elements re-point and re-sync: a
      // blink on the extra tracks, never on the video), and the trim strip.
      void ensureTracks(clip.value)
      rekeyFilmstrip(clip.value)
      return
    }
    mediaId.value = id
    imageUrl.value = imageUrlOf(clip.value)
    // First, before anything can await: the outgoing clip's tracks are still
    // playing, and the new clip's extractions are a round trip away.
    releaseAll()
    loadTracks(clip.value)
    void ensureTracks(clip.value)
    // Now rather than when the trim bar opens: the cut is usually done by then.
    prepareFilmstrip(clip.value)
    exitEdit()
    time.value = 0
    lastTime = 0
    duration.value = clip.value.duration
    buffered.value = 0
    ended.value = false
    failed.value = false
    settled()
    scrubTarget = null
    // The poster covers the swap so stepping through clips does not flash black.
    frameReady.value = false
    cancelDwell()
    if (isImage.value) {
      // Nothing plays under a picture: the previous clip's decoder goes back now
      // rather than when the element is next given a source.
      video.value?.pause()
      void nextTick(() => video.value?.load())
    }
    consumePendingEdit()
    poke()
  },
)

// A clip opened straight into edit mode may still be probing; enter as soon as it can.
watch(canEdit, (ok) => {
  if (ok && autoEdit) consumePendingEdit()
})

// The title bar's crumb for the screen beneath: leaves the way Back does, flip included.
watch(closeRequests, () => close())

/**
 * Hidden to the tray or minimized: unload the media. Chromium does not pause a
 * <video> for a window that is off screen, so this is the difference between an
 * idle app and one decoding 4K in the background for as long as it sits there.
 * The overlay itself stays mounted — closing it would throw away a trim in
 * progress, and its close path is a GSAP animation, which cannot run while the
 * window is hidden anyway.
 */
watch(windowVisible, async (vis) => {
  const v = video.value
  if (vis) {
    // Re-applying the src reloads the element; onLoadedMetadata restores the position.
    suspended.value = false
    return
  }
  // A window that hides while fullscreen leaves the desktop showing nothing.
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
  if (!v) return
  resumeAt = v.currentTime
  v.pause()
  // Before the flag: load() below rewinds every element to 0, and a corrector
  // still running would take that for real drift and drag the video after it.
  stopTicking()
  pauseAll()
  suspended.value = true
  // The picture is dropped with the flag; the poster stands in until it is back.
  if (isImage.value) frameReady.value = false
  await nextTick() // Vue removes the src attribute
  v.load() // and this is what actually releases the decoder and the buffers
  releaseAll() // same for every extra track, which Vue has just unbound too
  buffered.value = 0
  settled()
})

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFullscreen)
  if (stageArea.value) {
    observer = new ResizeObserver(fitStage)
    observer.observe(stageArea.value)
  }
  fitStage()
  setVideo(video.value)
  loadTracks(clip.value)
  void ensureTracks(clip.value)
  prepareFilmstrip(clip.value)
  await nextTick()
  // The media is attached from here, so a flip that cannot run (reduced motion,
  // no origin card) has to release it in the same tick rather than never.
  if (stage.value) flipFrom(stage.value, originRect.value, () => (flipping.value = false))
  else flipping.value = false
  consumePendingEdit()
  poke()
})

onBeforeUnmount(() => {
  exitEdit()
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFullscreen)
  // Closed from under fullscreen (a delete, an upload's toast): the chrome App
  // hid for it has to come back, and the listener above is gone by the time
  // the document would say so.
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
  fullscreen.value = false
  observer?.disconnect()
  window.clearTimeout(hideTimer)
  window.clearTimeout(volumeTimer)
  window.clearTimeout(stallTimer)
  cancelDwell()
  video.value?.pause()
  video.value?.removeAttribute('src')
  // Dropping the attribute alone leaves the decoder and the buffered media
  // attached until the element is collected; load() hands them back now.
  video.value?.load()
  releaseAll()
  resetTracks()
})
</script>

<template>
  <div
    class="player"
    :class="{
      'is-fullscreen': fullscreen,
      'with-details': details && !fullscreen,
      'is-editing': editing,
      'is-image': isImage,
      'no-cursor': !controls && (playing || isImage),
      'controls-hidden': !controls,
    }"
    @mousemove="poke"
    @mouseleave="controls = true"
  >
    <header class="top">
      <UTooltip text="Back" :kbds="['Esc']">
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          square
          aria-label="Close player"
          @click="close"
        />
      </UTooltip>
      <div class="heading">
        <h2 class="truncate" :title="clip.name + clip.ext">{{ clip.title }}</h2>
        <p class="truncate">{{ meta }}</p>
      </div>
      <div class="actions">
        <UTooltip v-if="!isImage" :text="editHint" :kbds="['E']">
          <UButton
            icon="i-lucide-scissors"
            :color="editing ? 'primary' : 'neutral'"
            :variant="editing ? 'soft' : 'ghost'"
            square
            aria-label="Trim and export"
            :aria-pressed="editing"
            :disabled="!canEdit"
            @click="toggleEdit"
          />
        </UTooltip>
        <UTooltip :text="details ? 'Hide details' : 'Details'" :kbds="['I']">
          <UButton
            icon="i-lucide-panel-right"
            :color="details ? 'primary' : 'neutral'"
            :variant="details ? 'soft' : 'ghost'"
            square
            aria-label="Toggle details pane"
            :aria-pressed="details"
            @click="toggleDetails"
          />
        </UTooltip>
        <UTooltip text="Share">
          <UDropdownMenu
            :items="shareItems"
            :content="{ align: 'end' }"
            :ui="{ content: 'min-w-80' }"
            @update:open="poke"
          >
            <UButton
              icon="i-lucide-share-2"
              color="neutral"
              variant="ghost"
              square
              aria-label="Share: copy the file, or upload it to YouTube"
              :loading="pending?.kind === 'copy-file'"
            />
          </UDropdownMenu>
        </UTooltip>
        <UDropdownMenu
          :items="moreItems"
          :content="{ align: 'end' }"
          :ui="{ content: 'min-w-56' }"
          @update:open="poke"
        >
          <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="ghost"
            square
            aria-label="More actions"
          />
        </UDropdownMenu>
      </div>
    </header>

    <!-- The letterbox is page, not scrim: a click on it does nothing, so leaving
         the name field by clicking away commits the rename and keeps the clip up. -->
    <div class="stage-wrap">
      <UTooltip
        v-if="hasPrev"
        :text="editing ? 'Finish or cancel the trim first' : 'Previous clip'"
        :kbds="editing ? undefined : ['P']"
      >
        <UButton
          class="arrow left"
          :class="{ 'is-blocked': editing }"
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="soft"
          square
          size="xl"
          :aria-disabled="editing"
          aria-label="Previous clip"
          @click.stop="stepClip(-1)"
        />
      </UTooltip>

      <div ref="stageArea" class="stage-area">
        <div
          ref="stage"
          class="stage"
          :style="{ width: `${stageSize.width}px`, height: `${stageSize.height}px` }"
          @click="togglePlay"
          @dblclick="toggleFullscreen"
        >
          <!-- Hidden rather than gone under a picture: the audio mixer holds
               this element from mount, and a fresh one would leave it behind. -->
          <video
            v-show="!isImage"
            ref="video"
            :src="src"
            :loop="loop && !editing"
            autoplay
            preload="auto"
            @loadedmetadata="onLoadedMetadata"
            @loadeddata="frameReady = true"
            @timeupdate="onTimeUpdate"
            @progress="onProgress"
            @play="onPlay"
            @pause="onPause"
            @waiting="onWaiting"
            @playing="onPlaying"
            @canplay="settled"
            @seeking="stalled"
            @seeked="onSeeked"
            @ended="onEnded"
            @error="onError"
          />

          <!-- The picture, zoomed and panned by its own transform inside the
               stage the flip animates; the poster below still covers the swap. -->
          <ImageStage
            v-if="isImage"
            ref="imageStage"
            :src="imageSrc"
            :width="clip.width"
            :height="clip.height"
            :box="stageSize"
            :alt="clip.title"
            @load="onImageLoaded"
            @error="onError"
            @zoom="onZoom"
            @interact="poke"
          />

          <!-- Audio tracks the <video> element will not play: Chromium renders
               only the container's default one, so the rest ride alongside as
               their own elements and are kept in step with it. Gated on the
               same flags as the video's own src, or they would start during
               the open flip while there is no picture yet. -->
          <audio
            v-for="track in auxTracks"
            :key="track.index"
            :src="suspended || flipping ? undefined : auxSrc(track.index) || undefined"
            preload="auto"
            @loadedmetadata="(e: Event) => onAuxLoaded(track.index, e)"
          />

          <!-- Stands in for the video until it has a frame: through the open
               flip, and across a clip change, so neither shows black. -->
          <Transition name="fade">
            <img
              v-if="showPoster && !closing"
              class="poster"
              :src="poster"
              alt=""
              draggable="false"
            />
          </Transition>
          <!-- The close flip carries the poster too, but this one is up on the
               spot: fading it in would leave the live frame showing through. -->
          <img v-if="closing && poster" class="poster" :src="poster" alt="" draggable="false" />

          <Transition name="fade">
            <UploadBanner v-if="upload" :key="upload.id" :job="upload" :clip="clip" />
            <PendingBanner v-else-if="pending" :label="pending.label" />
            <ExportBanner v-else-if="exportJob" :key="exportJob.id" :job="exportJob" />
          </Transition>

          <Transition name="fade">
            <div v-if="buffering && !failed" class="veil">
              <UIcon name="i-lucide-loader-circle" class="spin big-icon" />
            </div>
          </Transition>

          <Transition name="pop">
            <div v-if="flash" :key="flash.key" class="flash" aria-hidden="true">
              <UIcon :name="flash.icon" class="flash-icon" />
            </div>
          </Transition>

          <Transition name="pop">
            <div v-if="ended && !loop && !failed && !editing" class="ended" @click.stop>
              <UButton
                icon="i-lucide-rotate-ccw"
                label="Replay"
                color="neutral"
                variant="subtle"
                @click="replay"
              />
              <UButton
                v-if="hasNext"
                icon="i-lucide-skip-forward"
                label="Next clip"
                color="primary"
                @click="nextClip"
              />
            </div>
          </Transition>

          <Transition name="fade">
            <div v-if="failed" class="veil failed" @click.stop>
              <UAlert
                class="failed-alert"
                :icon="failedCopy.icon"
                color="error"
                variant="soft"
                :title="failedCopy.title"
                :description="failedCopy.text"
                :actions="failedActions"
              />
            </div>
          </Transition>
        </div>
      </div>

      <UTooltip
        v-if="hasNext"
        :text="editing ? 'Finish or cancel the trim first' : 'Next clip'"
        :kbds="editing ? undefined : ['N']"
      >
        <UButton
          class="arrow right"
          :class="{ 'is-blocked': editing }"
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="soft"
          square
          size="xl"
          :aria-disabled="editing"
          aria-label="Next clip"
          @click.stop="stepClip(1)"
        />
      </UTooltip>
    </div>

    <Transition name="pane">
      <PlayerDetails
        v-if="details && !fullscreen"
        :clip="clip"
        :editing="editing"
        :export-name="exportName + nameExt"
        @close="toggleDetails"
        @remove="remove"
        @edit="toggleEdit"
        @source="goToSource"
      />
    </Transition>

    <!-- The viewer's bar: the picture has nothing to play, so the row is zoom
         and the way to the next one. -->
    <div v-if="isImage" class="controls image-bar" @click.stop>
      <UTooltip text="Previous" :kbds="['P']">
        <UButton
          icon="i-lucide-skip-back"
          color="neutral"
          variant="ghost"
          square
          :disabled="!hasPrev"
          aria-label="Previous"
          @click="stepClip(-1)"
        />
      </UTooltip>
      <div class="zoom-group">
        <UTooltip text="Zoom out" :kbds="['-']">
          <UButton
            icon="i-lucide-zoom-out"
            color="neutral"
            variant="ghost"
            square
            aria-label="Zoom out"
            @click="imageStage?.zoomOut()"
          />
        </UTooltip>
        <UTooltip text="Fit to the screen" :kbds="['0']">
          <UButton
            class="zoom-label mono"
            :label="`${zoomPercent}%`"
            color="neutral"
            variant="ghost"
            size="md"
            aria-label="Zoom level; press to fit the screen"
            aria-live="polite"
            @click="imageStage?.fit()"
          />
        </UTooltip>
        <UTooltip text="Zoom in" :kbds="['+']">
          <UButton
            icon="i-lucide-zoom-in"
            color="neutral"
            variant="ghost"
            square
            aria-label="Zoom in"
            @click="imageStage?.zoomIn()"
          />
        </UTooltip>
        <UTooltip :text="zoomFit ? 'Actual size' : 'Fit to the screen'" :kbds="['Space']">
          <UButton
            :icon="zoomFit ? 'i-lucide-expand' : 'i-lucide-shrink'"
            :label="zoomFit ? '1:1' : 'Fit'"
            color="neutral"
            variant="subtle"
            size="md"
            :aria-label="zoomFit ? 'Show at actual size' : 'Fit to the screen'"
            @click="imageStage?.toggleFit()"
          />
        </UTooltip>
      </div>
      <div class="group">
        <FavouriteButton :clip="clip" />
        <UTooltip :text="fullscreen ? 'Exit fullscreen' : 'Fullscreen'" :kbds="['F']">
          <UButton
            :icon="fullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
            color="neutral"
            variant="ghost"
            square
            aria-label="Toggle fullscreen"
            @click="toggleFullscreen"
          />
        </UTooltip>
        <UTooltip text="Next" :kbds="['N']">
          <UButton
            icon="i-lucide-skip-forward"
            color="neutral"
            variant="ghost"
            square
            :disabled="!hasNext"
            aria-label="Next"
            @click="stepClip(1)"
          />
        </UTooltip>
      </div>
    </div>

    <div v-else class="controls" @click.stop>
      <!-- Both timelines share one box, anchored to the same baseline: its height
           animates between them while they cross-fade in place, so entering and
           leaving edit mode reads as one move rather than a swap. -->
      <div class="timeline-slot">
        <Transition name="swap">
          <TrimBar
            v-if="editing"
            key="trim"
            class="layer"
            :duration="duration"
            :in-sec="inSec"
            :out-sec="outSec"
            :time="time"
            :sprite="clip.sprite ? api.thumbUrl(clip.sprite) : ''"
            :sprite-frames="clip.spriteFrames"
            :filmstrip="filmstrip"
            @update:in="setIn"
            @update:out="setOut"
            @seek="scrubTo"
            @drag="onTrimDrag"
          />
          <div
            v-else
            key="seek"
            ref="seekEl"
            class="seek layer"
            role="slider"
            aria-label="Seek"
            :aria-valuemin="0"
            :aria-valuemax="Math.round(duration)"
            :aria-valuenow="Math.round(time)"
            @pointerdown="onSeekDown"
            @pointermove="onSeekMove"
            @pointerup="onSeekUp"
            @pointercancel="onSeekUp"
            @pointerleave="onSeekLeave"
          >
            <div class="track">
              <div class="buffered" :style="{ width: bufferedPct }" />
              <div class="played" :style="{ width: playedPct }" />
              <div class="knob" :style="{ left: playedPct }" />
            </div>
            <div v-if="hoverPct !== null" class="tip mono" :style="{ left: `${hoverPct * 100}%` }">
              {{ formatDuration(hoverPct * duration) }}
            </div>
          </div>
        </Transition>
      </div>

      <!-- Stays mounted and opens by height, so the row grows out of the
           controls instead of snapping in and shoving everything upward. -->
      <div class="edit-slot" :class="{ open: editing }" :inert="editing ? undefined : true">
        <!-- A grid of three areas: the range and the audio tracks on one line,
             the export form on the next, and all three on one line once the
             container is wide enough for it — decided by a container query,
             never by incidental wrapping. The export is a format switch — Clip,
             Audio only, GIF — followed by only that format's option and one
             Export button named for it. -->
        <div class="edit-row">
          <div class="range" role="group" aria-label="Trim range">
            <div class="step">
              <UTooltip text="Previous frame" :kbds="[',']">
                <UButton
                  icon="i-lucide-chevron-left"
                  color="neutral"
                  variant="ghost"
                  square
                  aria-label="Previous frame"
                  @click="stepFrame(-1)"
                />
              </UTooltip>
              <UTooltip text="Next frame" :kbds="['.']">
                <UButton
                  icon="i-lucide-chevron-right"
                  color="neutral"
                  variant="ghost"
                  square
                  aria-label="Next frame"
                  @click="stepFrame(1)"
                />
              </UTooltip>
            </div>
            <!-- Start and End say which point each is; the click moves it to the
                 playhead, which the tooltip and the key spell out. -->
            <UTooltip text="Set start to the playhead" :kbds="['[']">
              <UButton
                class="point"
                color="neutral"
                variant="subtle"
                aria-label="Start: set to the playhead"
                @click="setIn(time)"
              >
                <span class="point-cap">Start</span>
                <span class="point-time mono">{{ formatTimecode(inSec) }}</span>
              </UButton>
            </UTooltip>
            <span class="len" title="Selection length" aria-label="Selection length">
              <span class="mono">{{ formatTimecode(selectionLength) }}</span>
            </span>
            <UTooltip text="Set end to the playhead" :kbds="[']']">
              <UButton
                class="point"
                color="neutral"
                variant="subtle"
                aria-label="End: set to the playhead"
                @click="setOut(time)"
              >
                <span class="point-cap">End</span>
                <span class="point-time mono">{{ formatTimecode(outSec) }}</span>
              </UButton>
            </UTooltip>
            <UTooltip text="Reset to the whole clip" :kbds="['Shift', 'R']">
              <UButton
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="ghost"
                square
                aria-label="Reset to the whole clip"
                @click="resetRange"
              />
            </UTooltip>
          </div>

          <!-- Which tracks play, and so which the export keeps: for the ear as
               much as for the file, so it sits between the two. -->
          <div class="tracks">
            <AudioMixer v-if="hasMixer && editing" @change="applyVolume" @toggle="poke" />
          </div>

          <div class="export" role="group" aria-label="Export">
            <UInput
              v-model="exportName"
              class="name"
              placeholder="File name"
              spellcheck="false"
              autocomplete="off"
              aria-label="File name"
              :ui="{ trailing: 'pe-2.5' }"
              @keydown.enter.prevent="exportNow"
              @keydown.esc.prevent="exitEdit"
            >
              <template #trailing>
                <span class="ext mono">{{ nameExt }}</span>
              </template>
            </UInput>
            <UFieldGroup role="group" aria-label="Export format">
              <UTooltip v-for="k in EXPORT_KINDS" :key="k.kind" :text="k.hint">
                <UButton
                  :icon="k.icon"
                  :label="k.label"
                  :color="exportKind === k.kind ? 'primary' : 'neutral'"
                  :variant="exportKind === k.kind ? 'soft' : 'subtle'"
                  :aria-pressed="exportKind === k.kind"
                  @click="exportKind = k.kind"
                />
              </UTooltip>
            </UFieldGroup>
            <!-- The chosen format's own option, and nothing else's. -->
            <UTooltip
              v-if="exportKind === 'clip'"
              :text="clip.hasAudio ? 'Export the clip without its audio' : 'Source has no audio'"
              :kbds="['Shift', 'M']"
            >
              <UButton
                :icon="exportMuted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                label="No audio"
                :color="exportMuted ? 'primary' : 'neutral'"
                :variant="exportMuted ? 'soft' : 'subtle'"
                :aria-pressed="exportMuted"
                :disabled="!clip.hasAudio"
                @click="exportMuted = !exportMuted"
              />
            </UTooltip>
            <UDropdownMenu
              v-else-if="exportKind === 'gif'"
              :items="gifItems"
              :content="{ align: 'end' }"
              :ui="{ content: 'min-w-40' }"
            >
              <UButton
                class="gif-opts"
                icon="i-lucide-settings-2"
                trailing-icon="i-lucide-chevron-down"
                :label="`${settings.gifWidth} px · ${settings.gifFps} fps`"
                color="neutral"
                variant="subtle"
                aria-label="GIF width and frame rate"
              />
            </UDropdownMenu>
            <!-- The audio format here rather than only in the save dialog's
                 type list; the dialog opens on whatever is picked. -->
            <UDropdownMenu
              v-else-if="exportKind === 'audio'"
              :items="audioFormatItems"
              :content="{ align: 'end' }"
              :ui="{ content: 'min-w-56' }"
            >
              <UButton
                class="gif-opts"
                icon="i-lucide-file-audio"
                trailing-icon="i-lucide-chevron-down"
                :label="audioFormatLabel"
                color="neutral"
                variant="subtle"
                aria-label="Audio format"
              />
            </UDropdownMenu>
            <!-- Why Export is off, in words, instead of a silently disabled button. -->
            <p v-if="currentProblem" class="problem" role="status" :title="currentProblem">
              {{ currentProblem }}
            </p>
            <!-- No Cancel here: the trim toggle in the transport row, the details
                 pane and Esc all leave edit mode, and a third copy only pushed
                 Export onto a line of its own. -->
            <div class="submit">
              <!-- A GIF can be looked at before it is saved; the export then copies it. -->
              <UTooltip
                v-if="exportKind === 'gif'"
                :text="gifProblem || 'See the GIF before saving it'"
                :kbds="['Shift', 'P']"
              >
                <UButton
                  icon="i-lucide-eye"
                  label="Preview"
                  color="neutral"
                  variant="subtle"
                  :disabled="!canExportGif"
                  @click="previewGifNow"
                />
              </UTooltip>
              <!-- A disabled button explains itself on hover too. -->
              <UTooltip :text="currentProblem || exportHint" :kbds="['Ctrl', 'Enter']">
                <UButton
                  icon="i-lucide-download"
                  :label="exportLabel"
                  color="primary"
                  :loading="submitting"
                  :disabled="!canSubmit"
                  @click="exportNow"
                />
              </UTooltip>
            </div>
          </div>
        </div>
      </div>

      <div class="row">
        <div class="group">
          <div class="transport">
            <UTooltip text="Previous" :kbds="['P']">
              <UButton
                icon="i-lucide-skip-back"
                color="neutral"
                variant="ghost"
                square
                :class="{ 'is-blocked': editing }"
                :disabled="!hasPrev"
                :aria-disabled="editing"
                aria-label="Previous clip"
                @click="stepClip(-1)"
              />
            </UTooltip>
            <UTooltip :text="playing ? 'Pause' : 'Play'" :kbds="['Space']">
              <UButton
                class="play"
                :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
                color="primary"
                square
                size="xl"
                :aria-label="playing ? 'Pause' : 'Play'"
                @click="togglePlay"
              />
            </UTooltip>
            <UTooltip text="Next" :kbds="['N']">
              <UButton
                icon="i-lucide-skip-forward"
                color="neutral"
                variant="ghost"
                square
                :class="{ 'is-blocked': editing }"
                :disabled="!hasNext"
                :aria-disabled="editing"
                aria-label="Next clip"
                @click="stepClip(1)"
              />
            </UTooltip>
          </div>
          <div class="volume">
            <UTooltip :text="muted ? 'Unmute' : 'Mute'" :kbds="['M']">
              <UButton
                :icon="volumeIcon"
                color="neutral"
                variant="ghost"
                square
                :aria-label="muted ? 'Unmute' : 'Mute'"
                :aria-pressed="muted"
                @click="setMuted(!muted)"
              />
            </UTooltip>
            <!-- No side icons: the mute button beside it already shows the volume state. -->
            <ElasticSlider
              class="vol-slider"
              aria-label="Volume"
              :model-value="muted ? 0 : volume * 100"
              :max-value="100"
              :fill-color="activeTheme.colors.secondary"
              track-color="rgba(255, 255, 255, 0.22)"
              @update:model-value="(v: number) => setVolume(v / 100)"
            />
          </div>
          <span class="time mono">
            {{ editing ? formatTimecode(time) : formatDuration(time)
            }}<span class="dim"> / {{ formatDuration(duration) }}</span>
          </span>
        </div>
        <div class="group">
          <!-- Only worth a control when there is a choice to make: a clip with
               one audio track is served by the volume slider alone. While
               trimming it moves into the edit row, where the audible tracks
               are the ones the export keeps. -->
          <AudioMixer v-if="hasMixer && !editing" @change="applyVolume" @toggle="poke" />
          <UDropdownMenu
            :items="rateItems"
            :content="{ side: 'top', align: 'end' }"
            :ui="{ content: 'min-w-28', itemLabel: 'font-mono' }"
            @update:open="poke"
          >
            <UButton
              class="rate mono"
              :label="`${rate}×`"
              color="neutral"
              variant="ghost"
              size="md"
              aria-label="Playback speed"
            />
          </UDropdownMenu>
          <FavouriteButton :clip="clip" />
          <UTooltip v-if="!editing" text="Loop" :kbds="['R']">
            <UButton
              icon="i-lucide-repeat"
              :color="loop ? 'primary' : 'neutral'"
              :variant="loop ? 'soft' : 'ghost'"
              square
              aria-label="Loop"
              :aria-pressed="loop"
              @click="loop = !loop"
            />
          </UTooltip>
          <UTooltip :text="fullscreen ? 'Exit fullscreen' : 'Fullscreen'" :kbds="['F']">
            <UButton
              :icon="fullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
              color="neutral"
              variant="ghost"
              square
              aria-label="Toggle fullscreen"
              @click="toggleFullscreen"
            />
          </UTooltip>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player {
  /* A page over the screen it was opened from, which stays mounted beneath
     (inert) so the close flip has the card to land on. Opaque: the title bar
     and sidebar are beside it, not under it, and in fullscreen App hides them
     so the main area — and this — is the whole screen. */
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background: var(--scrim);
  /* One width, one switch: everything that has to make room for the details
     pane reads --pane-w, which is 0 whenever the pane is not showing. */
  --details-w: 400px;
  --pane-w: 0px;
  /* The controls block grows a row in edit mode; the stage gives it the room. */
  --controls-h: 108px;
}
.player.with-details {
  --pane-w: var(--details-w);
}
.player.is-editing {
  --controls-h: 252px;
}
/* One row of buttons, no timeline: the picture gets the height back. */
.player.is-image {
  --controls-h: 84px;
}
/* On a narrow page the pane gives width back so the video keeps the larger
   share, and the edit row, which wraps, gets a taller block. Measured against
   the main area (App.vue names it as the container): with the sidebar beside
   the page, the window's width is not the width the layout has to fit. */
@container main (max-width: 1240px) {
  .player {
    --details-w: 340px;
  }
  .player.is-editing {
    --controls-h: 320px;
  }
}
.player.no-cursor {
  cursor: none;
}
.top,
.controls {
  position: absolute;
  left: 0;
  right: var(--pane-w);
  z-index: 2;
  transition:
    opacity var(--dur) var(--ease-out),
    transform var(--dur) var(--ease-out),
    right var(--dur) var(--ease-out);
}
.top {
  top: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--scrim) 90%, transparent),
    transparent
  );
}
.controls {
  bottom: 0;
  padding: var(--s-6) var(--s-5) var(--s-4);
  background: linear-gradient(0deg, color-mix(in srgb, var(--scrim) 92%, transparent), transparent);
}
.controls-hidden .top {
  opacity: 0;
  transform: translateY(-8px);
  pointer-events: none;
}
.controls-hidden .controls {
  opacity: 0;
  transform: translateY(8px);
  pointer-events: none;
}
.heading {
  flex: 1;
  min-width: 0;
}
.heading h2 {
  font-size: var(--text-lg);
}
.heading p {
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--s-1);
}

.pane-enter-active,
.pane-leave-active {
  transition:
    transform var(--dur) var(--ease-out),
    opacity var(--dur) var(--ease-out);
}
.pane-enter-from,
.pane-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.stage-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 72px 88px var(--controls-h);
  padding-right: calc(88px + var(--pane-w));
  transition: padding var(--dur) var(--ease-out);
}
.is-fullscreen .stage-wrap {
  padding: 0;
}
.stage-area {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.stage {
  position: relative;
  background: #000;
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06),
    0 40px 100px -20px rgba(0, 0, 0, 0.9),
    0 0 80px -20px color-mix(in srgb, var(--primary) 35%, transparent);
  will-change: transform;
}
.is-fullscreen .stage {
  border-radius: 0;
}
.stage video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}
.poster {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
  pointer-events: none;
}
.veil {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--secondary);
  background: color-mix(in srgb, var(--scrim) 40%, transparent);
}
.veil.failed {
  background: color-mix(in srgb, var(--scrim) 85%, transparent);
  padding: 24px;
}
.failed-alert {
  max-width: 440px;
}
.big-icon {
  width: 36px;
  height: 36px;
}
.flash {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 72px;
  height: 72px;
  margin: -36px 0 0 -36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  background: color-mix(in srgb, var(--bg-3) 75%, transparent);
  pointer-events: none;
}
.flash-icon {
  width: 30px;
  height: 30px;
}
.ended {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: color-mix(in srgb, var(--scrim) 55%, transparent);
}
.arrow {
  position: absolute;
  top: 50%;
  z-index: 1;
  width: 48px;
  height: 48px;
  margin-top: -24px;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  color: var(--fg);
  background: color-mix(in srgb, var(--bg-3) 70%, transparent);
  border: 1px solid var(--border-hover);
  transition:
    background var(--dur-fast) var(--ease-out),
    transform var(--dur) var(--ease-spring),
    opacity var(--dur) var(--ease-out),
    right var(--dur) var(--ease-out);
}
.arrow:hover {
  background: var(--primary);
  border-color: var(--primary-hover);
  transform: scale(1.08);
}
/* In edit mode the arrows stay put but say no: the tooltip and a toast explain,
   and the hover lift is withheld. The same class dims the transport pair. */
.arrow.is-blocked,
.is-blocked {
  opacity: 0.45;
  cursor: not-allowed;
}
.arrow.is-blocked:hover {
  background: color-mix(in srgb, var(--bg-3) 70%, transparent);
  border-color: var(--border-hover);
  transform: none;
}
.arrow.left {
  left: 22px;
}
.arrow.right {
  right: calc(22px + var(--pane-w));
}
.controls-hidden .arrow {
  opacity: 0;
  pointer-events: none;
}

/* One box for both timelines. The layers are pinned to its bottom edge, so the
   seek bar and the filmstrip's last row sit on the same line and the box simply
   grows upward into the trim height while the two cross-fade. */
.timeline-slot {
  position: relative;
  height: 22px;
  transition: height var(--dur) var(--ease-out);
}
.is-editing .timeline-slot {
  /* TrimBar's own --ruler-h (36) + --strip-h (56). */
  height: 92px;
}
.layer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}
.swap-enter-active,
.swap-leave-active {
  transform-origin: bottom;
  transition:
    opacity var(--dur) var(--ease-out),
    transform var(--dur) var(--ease-out);
}
/* The outgoing layer is still on top of the incoming one for a frame or two. */
.swap-leave-active {
  pointer-events: none;
}
.swap-enter-from,
.swap-leave-to {
  opacity: 0;
  transform: scaleY(0.94);
}

.seek {
  height: 22px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.track {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: var(--r-full);
  background: rgba(255, 255, 255, 0.16);
  transition: transform var(--dur-fast) var(--ease-out);
}
.seek:hover .track {
  transform: scaleY(1.5);
}
.buffered,
.played {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: var(--r-full);
}
.buffered {
  background: rgba(255, 255, 255, 0.22);
}
.played {
  background: linear-gradient(90deg, var(--secondary), var(--primary));
}
.knob {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--secondary) 35%, transparent);
  /* Small at rest so the position reads without hovering; full size under the pointer. */
  transform: scale(0.6);
  transition: transform var(--dur-fast) var(--ease-spring);
}
.seek:hover .knob {
  transform: scale(1);
}
.tip {
  position: absolute;
  bottom: 22px;
  transform: translateX(-50%);
  padding: 3px 7px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--bg-3) 95%, transparent);
  border: 1px solid var(--border-hover);
  font-size: var(--text-xs);
  pointer-events: none;
}

/* Opens by row height rather than by mounting, so the controls above it drift
   up at the same rate the timeline grows. */
.edit-slot {
  display: grid;
  grid-template-rows: 0fr;
  /* The row lays itself out by this width — see `.edit-row`. */
  container-type: inline-size;
  margin-top: 0;
  opacity: 0;
  transition:
    grid-template-rows var(--dur) var(--ease-out),
    margin-top var(--dur) var(--ease-out),
    opacity var(--dur-fast) var(--ease-out);
}
.edit-slot.open {
  grid-template-rows: 1fr;
  margin-top: var(--s-3);
  opacity: 1;
}

/* Edit row: three grid areas. Two lines by default — the range and the audio
   tracks, then the export form — and one line once the container is wide
   enough for all of it (a maximised 1920px window with the details pane shut).
   Explicit rows, because two nested wrapping flexboxes each broke wherever
   they happened to run out of room and left the export folded beside a
   range that was centred against it. */
.edit-row {
  /* The clipped grid item: without these the 0fr row cannot collapse. */
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas:
    'range tracks'
    'export export';
  align-items: center;
  row-gap: var(--s-2);
  column-gap: var(--s-4);
  padding: var(--s-2) var(--s-3);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--bg-3) 60%, transparent);
  border: 1px solid var(--border);
}
@container (min-width: 1700px) {
  .edit-row {
    grid-template-columns: auto auto minmax(0, 1fr);
    grid-template-areas: 'range tracks export';
  }
}
.range {
  grid-area: range;
  display: flex;
  align-items: center;
  gap: var(--s-1);
}
.tracks {
  grid-area: tracks;
  display: flex;
  align-items: center;
  justify-self: start;
}
/* The export form. Only the name and the reason text flex — the name within
   bounds, the reason down to nothing — and the controls keep their size, so
   Export stays at the end of the line. Wrapping is the last resort, at the
   window minimum, and beats clipping the button under `overflow: hidden`. */
.export {
  grid-area: export;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-2);
}
/* Kept tight together: they are one control, and they sit at the head of the
   range row because you step to the frame before you mark it. */
.step {
  display: flex;
  align-items: center;
  margin-right: var(--s-1);
}
/* "Start 1:37.2": the caption says which point, the time is the value. */
.point {
  min-width: 128px;
  justify-content: center;
  gap: var(--s-2);
}
/* "480 px · 15 fps", "M4A (AAC)": values, not a shouted label. */
.gif-opts {
  text-transform: none;
  letter-spacing: 0;
}
.point-cap {
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  color: var(--fg-muted);
}
.point-time {
  text-transform: none;
  letter-spacing: 0;
  color: var(--fg);
}
/* The selection's length, drawn as the span between its two points. */
.len {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-width: 96px;
  padding: 0 var(--s-1);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.len::before,
.len::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-hover);
}
.name {
  flex: 1 1 140px;
  min-width: 0;
  /* A file name, not a paragraph: on a wide line the slack goes to the reason text instead. */
  max-width: 380px;
}
.name :deep(input) {
  min-width: 0;
}
.ext {
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
/* Why Export is off. Zero basis: flex-wrap breaks lines on the basis, so this
   never decides where the line breaks — it fills what is left, and truncates
   (the full text is in its title and the button's tooltip). */
.problem {
  flex: 1 1 0;
  min-width: 0;
  /* Hugs the Export button it explains. */
  text-align: right;
  font-size: var(--text-sm);
  color: var(--warning);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.submit {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-left: auto;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  margin-top: var(--s-2);
}
.group {
  display: flex;
  align-items: center;
  gap: var(--s-1);
}
/* Three clusters, loosest to tightest: transport reads as one control, volume
   sits behind a hairline, the timecode trails it. */
.transport {
  display: flex;
  align-items: center;
  gap: var(--s-1);
}
.play {
  width: 44px;
  height: 44px;
  margin: 0 2px;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  color: var(--on-primary);
  background: linear-gradient(135deg, var(--primary-hover), var(--primary));
  box-shadow: 0 8px 20px -6px color-mix(in srgb, var(--primary) 80%, transparent);
}
.play:hover {
  background: linear-gradient(135deg, var(--secondary), var(--primary-hover));
}
.volume {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  margin-left: var(--s-2);
  padding-left: var(--s-3);
  border-left: 1px solid var(--border);
}
.vol-slider {
  width: 132px;
  color: var(--fg-muted);
}
.time {
  margin-left: var(--s-3);
  font-size: var(--text-base);
  color: var(--fg);
}
.dim {
  color: var(--fg-muted);
}
.rate {
  /* Fixed width so cycling 1× → 1.25× does not shuffle the controls beside it. */
  min-width: 52px;
  justify-content: center;
  text-transform: none;
}

/* The viewer's bar: previous on the left, next on the right, zoom between. */
.image-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
}
.zoom-group {
  display: flex;
  align-items: center;
  gap: var(--s-1);
}
/* Fixed width so 100% → 1000% does not shuffle the buttons beside it. */
.zoom-label {
  min-width: 68px;
  justify-content: center;
  text-transform: none;
}
</style>
