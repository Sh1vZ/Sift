<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ElasticSlider from './bits/ElasticSlider.vue'
import PlayerDetails from './PlayerDetails.vue'
import TrimBar from './TrimBar.vue'
import { deleteClip, renameClip, revealClip, settings, updateSettings } from '@/composables/useLibrary'
import {
  closePlayer,
  current,
  hasNext,
  hasPrev,
  neighbor,
  nextClip,
  openSource,
  originRect,
  pendingEdit,
  prevClip
} from '@/composables/usePlayer'
import {
  canExport,
  editing,
  enterEdit,
  exitEdit,
  exportMuted,
  exportName,
  inSec,
  outSec,
  resetRange,
  selectionLength,
  setIn,
  setOut,
  submit,
  submitting
} from '@/composables/useEditor'
import { fadeOut, flipFrom, flipTo } from '@/composables/useMotion'
import { activeTheme } from '@/composables/useTheme'
import { confirm, dialog, prompt } from '@/composables/useDialogs'
import { toast } from '@/composables/useToasts'
import {
  clamp,
  formatBytes,
  formatDuration,
  formatFull,
  formatResolution,
  formatTimecode,
  fractionAcross
} from '@/utils/format'
import { bitrate, formatBitrate } from '@/utils/quality'

const api = window.api
const RATES = [1, 1.25, 1.5, 2, 0.5]
/** Containers stream copy keeps as they are; everything else exports as mp4. */
const KEEP_EXT = new Set(['.webm', '.avi', '.wmv', '.flv'])

const stageArea = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
const seekEl = ref<HTMLElement | null>(null)

// The overlay only mounts while a clip is open.
const clip = computed(() => current.value!)
const src = computed(() => api.mediaUrl(clip.value.id))
const ratio = computed(() => (clip.value.width && clip.value.height ? clip.value.width / clip.value.height : 16 / 9))
const meta = computed(() =>
  [
    clip.value.game,
    formatFull(clip.value.recordedAtMs),
    formatResolution(clip.value.width, clip.value.height, clip.value.fps),
    formatBitrate(bitrate(clip.value)),
    formatBytes(clip.value.size)
  ]
    .filter(Boolean)
    .join(' · ')
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
const fullscreen = ref(Boolean(document.fullscreenElement))
const controls = ref(true)
const seeking = ref(false)
const hoverPct = ref<number | null>(null)
const closing = ref(false)
const details = ref(settings.value.detailsPane)
const flash = ref<{ icon: string; key: number } | null>(null)
const stageSize = ref({ width: 0, height: 0 })

const playedPct = computed(() => (duration.value ? `${(time.value / duration.value) * 100}%` : '0%'))
const bufferedPct = computed(() => (duration.value ? `${(buffered.value / duration.value) * 100}%` : '0%'))
const volumeIcon = computed(() =>
  muted.value || volume.value === 0
    ? 'i-lucide-volume-x'
    : volume.value < 0.5
      ? 'i-lucide-volume-1'
      : 'i-lucide-volume-2'
)

/** Trimming needs the probed duration; without it the handles have nothing to measure against. */
const canEdit = computed(() => clip.value.probeState === 'ok' && clip.value.duration > 0 && !failed.value)
const outExt = computed(() => (KEEP_EXT.has(clip.value.ext.toLowerCase()) ? clip.value.ext.toLowerCase() : '.mp4'))
const editHint = computed(() =>
  canEdit.value ? (editing.value ? 'Leave edit mode' : 'Trim & export') : 'Media info still loading'
)

const failedActions = computed(() => [
  {
    label: 'Show in Explorer',
    icon: 'i-lucide-folder-open',
    color: 'neutral' as const,
    variant: 'subtle' as const,
    onClick: () => revealClip(clip.value)
  }
])

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
    if (playing.value && !seeking.value && hoverPct.value === null) controls.value = false
  }, 2600)
}
watch(editing, poke)

// ------------------------------------------------------------- playback

function showFlash(icon: string): void {
  flash.value = { icon, key: Date.now() }
  window.setTimeout(() => (flash.value = null), 480)
}

function togglePlay(): void {
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
}
const seekBy = (delta: number): void => seekTo(time.value + delta)

/** One frame at the clip's rate, paused so the frame you land on stays put. */
function stepFrame(direction: -1 | 1): void {
  video.value?.pause()
  seekBy(direction / (clip.value.fps || 30))
}

let volumeTimer = 0
function persistVolume(): void {
  window.clearTimeout(volumeTimer)
  volumeTimer = window.setTimeout(
    () => void updateSettings({ volume: volume.value, muted: muted.value }),
    400
  )
}
function setVolume(value: number): void {
  volume.value = clamp(value, 0, 1)
  if (video.value) video.value.volume = volume.value
  if (volume.value > 0 && muted.value) setMuted(false)
  else persistVolume()
}
function setMuted(value: boolean): void {
  muted.value = value
  if (video.value) video.value.muted = value
  persistVolume()
}
function cycleRate(): void {
  rate.value = RATES[(RATES.indexOf(rate.value) + 1) % RATES.length]
  if (video.value) video.value.playbackRate = rate.value
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
  v.volume = volume.value
  v.muted = muted.value
  v.playbackRate = rate.value
}
let lastTime = 0
function onTimeUpdate(): void {
  const v = video.value
  if (!v) return
  if (!seeking.value) time.value = v.currentTime
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
  if (!v || !v.buffered.length) return
  for (let i = 0; i < v.buffered.length; i++) {
    if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) {
      buffered.value = v.buffered.end(i)
      return
    }
  }
  buffered.value = v.buffered.end(v.buffered.length - 1)
}
function onEnded(): void {
  if (editing.value) {
    // The out-point sits at the very end: keep the preview loop going.
    seekTo(inSec.value)
    void video.value?.play().catch(() => undefined)
    return
  }
  playing.value = false
  if (settings.value.autoplayNext && hasNext.value) {
    nextClip()
    return
  }
  ended.value = true
  controls.value = true
}
function onError(): void {
  failed.value = true
  playing.value = false
  buffering.value = false
}

// ------------------------------------------------------------- seek bar

function onSeekDown(e: PointerEvent): void {
  seeking.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  seekTo(fractionAcross(seekEl.value!, e.clientX) * duration.value)
}
function onSeekMove(e: PointerEvent): void {
  hoverPct.value = fractionAcross(seekEl.value!, e.clientX)
  if (seeking.value) seekTo(hoverPct.value * duration.value)
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

async function exportNow(): Promise<void> {
  if (!canExport.value) return
  await submit(clip.value)
}

function goToSource(): void {
  if (!openSource(clip.value)) toast('error', 'Source not found', 'The recording this clip was cut from is no longer in the library.')
}

// ------------------------------------------------------------- actions

function toggleDetails(): void {
  details.value = !details.value
  void updateSettings({ detailsPane: details.value })
}

function close(): void {
  if (closing.value) return
  closing.value = true
  video.value?.pause()
  const card = document.querySelector(`[data-clip-id="${clip.value.id}"] .thumb`)
  const rect = card?.getBoundingClientRect() ?? null
  const visible = rect && rect.bottom > 48 && rect.top < window.innerHeight && rect.width > 0
  if (stage.value && visible) flipTo(stage.value, rect, closePlayer)
  else if (stage.value) fadeOut(stage.value, closePlayer)
  else closePlayer()
}

async function rename(): Promise<void> {
  const c = clip.value
  const name = await prompt({ title: 'Rename clip', label: 'File name', value: c.name, confirmLabel: 'Rename' })
  if (name === null || !name.trim() || name === c.name) return
  const next = await renameClip(c, name)
  // Swap in place so prev/next keep walking the same list.
  if (next) current.value = next
}

async function remove(): Promise<void> {
  const c = clip.value
  const ok = await confirm({
    title: 'Delete this clip?',
    message: 'It goes to the Recycle Bin, so you can still restore it from there.',
    detail: c.name + c.ext,
    detailIcon: 'i-lucide-file-video',
    confirmLabel: 'Delete',
    danger: true
  })
  if (!ok) return
  exitEdit()
  const target = neighbor()
  if (target) current.value = target
  else closePlayer()
  await deleteClip(c)
}

// ------------------------------------------------------------- keyboard

function onKey(e: KeyboardEvent): void {
  if (dialog.value) return
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  let handled = true
  switch (e.key) {
    case ' ':
    case 'k':
      togglePlay()
      break
    case 'Escape':
      if (document.fullscreenElement) void document.exitFullscreen()
      else if (editing.value) exitEdit()
      else close()
      break
    case 'ArrowLeft':
      seekBy(-5)
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
      if (!editing.value) nextClip()
      break
    case 'p':
      if (!editing.value) prevClip()
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
    case 'R':
      if (editing.value) resetRange()
      else handled = false
      break
    case 'Enter':
      if (editing.value && e.ctrlKey) void exportNow()
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

function consumePendingEdit(): void {
  if (!pendingEdit.value) return
  pendingEdit.value = false
  if (canEdit.value) enterEdit(clip.value)
}

watch(
  () => clip.value.id,
  () => {
    exitEdit()
    time.value = 0
    lastTime = 0
    duration.value = clip.value.duration
    buffered.value = 0
    ended.value = false
    failed.value = false
    buffering.value = false
    consumePendingEdit()
    poke()
  }
)

// A clip opened straight into edit mode may still be probing; enter as soon as it can.
watch(canEdit, (ok) => {
  if (ok) consumePendingEdit()
})

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFullscreen)
  if (stageArea.value) {
    observer = new ResizeObserver(fitStage)
    observer.observe(stageArea.value)
  }
  fitStage()
  await nextTick()
  if (stage.value) flipFrom(stage.value, originRect.value)
  consumePendingEdit()
  poke()
})

onBeforeUnmount(() => {
  exitEdit()
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFullscreen)
  observer?.disconnect()
  window.clearTimeout(hideTimer)
  window.clearTimeout(volumeTimer)
  video.value?.pause()
  video.value?.removeAttribute('src')
})
</script>

<template>
  <div
    class="player"
    :class="{
      'is-fullscreen': fullscreen,
      'with-details': details && !fullscreen,
      'is-editing': editing,
      'no-cursor': !controls && playing,
      'controls-hidden': !controls
    }"
    @mousemove="poke"
    @mouseleave="controls = true"
  >
    <header class="top">
      <UTooltip text="Back" :kbds="['Esc']">
        <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" square size="lg" aria-label="Close player" @click="close" />
      </UTooltip>
      <div class="heading">
        <h2 class="truncate" :title="clip.name + clip.ext">{{ clip.title }}</h2>
        <p class="truncate">{{ meta }}</p>
      </div>
      <div class="actions">
        <UTooltip :text="editHint" :kbds="['E']">
          <UButton
            icon="i-lucide-scissors"
            :color="editing ? 'primary' : 'neutral'"
            :variant="editing ? 'soft' : 'ghost'"
            square
            size="lg"
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
            size="lg"
            aria-label="Toggle details pane"
            :aria-pressed="details"
            @click="toggleDetails"
          />
        </UTooltip>
      </div>
    </header>

    <!-- `.self` so only the letterbox around the video closes the player - clicks
         on the video, the arrows or the overlays are handled by those elements. -->
    <div class="stage-wrap" @click.self="close">
      <UButton
        v-if="hasPrev && !editing"
        class="arrow left"
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="soft"
        square
        size="xl"
        aria-label="Previous clip"
        @click.stop="prevClip"
      />

      <div ref="stageArea" class="stage-area" @click.self="close">
        <div
          ref="stage"
          class="stage"
          :style="{ width: `${stageSize.width}px`, height: `${stageSize.height}px` }"
          @click="togglePlay"
          @dblclick="toggleFullscreen"
        >
          <video
            ref="video"
            :src="src"
            :loop="loop && !editing"
            autoplay
            preload="auto"
            @loadedmetadata="onLoadedMetadata"
            @timeupdate="onTimeUpdate"
            @progress="onProgress"
            @play="playing = true"
            @pause="playing = false"
            @waiting="buffering = true"
            @playing="buffering = false"
            @canplay="buffering = false"
            @ended="onEnded"
            @error="onError"
          />

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
              <UButton icon="i-lucide-rotate-ccw" label="Replay" color="neutral" variant="subtle" size="lg" @click="replay" />
              <UButton v-if="hasNext" icon="i-lucide-skip-forward" label="Next clip" color="primary" size="lg" @click="nextClip" />
            </div>
          </Transition>

          <Transition name="fade">
            <div v-if="failed" class="veil failed" @click.stop>
              <UAlert
                class="failed-alert"
                icon="i-lucide-video-off"
                color="error"
                variant="soft"
                title="Can't play this file"
                description="The codec may not be supported by the built-in player. You can still open it from Explorer."
                :actions="failedActions"
              />
            </div>
          </Transition>
        </div>
      </div>

      <UButton
        v-if="hasNext && !editing"
        class="arrow right"
        icon="i-lucide-chevron-right"
        color="neutral"
        variant="soft"
        square
        size="xl"
        aria-label="Next clip"
        @click.stop="nextClip"
      />
    </div>

    <Transition name="pane">
      <PlayerDetails
        v-if="details && !fullscreen"
        :clip="clip"
        :editing="editing"
        :export-name="exportName + outExt"
        @close="toggleDetails"
        @rename="rename"
        @remove="remove"
        @edit="toggleEdit"
        @source="goToSource"
      />
    </Transition>

    <div class="controls" @click.stop>
      <Transition name="fade" mode="out-in">
        <TrimBar
          v-if="editing"
          key="trim"
          :duration="duration"
          :in-sec="inSec"
          :out-sec="outSec"
          :time="time"
          :buffered="buffered"
          @update:in="setIn"
          @update:out="setOut"
          @seek="seekTo"
        />
        <div
          v-else
          key="seek"
          ref="seekEl"
          class="seek"
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

      <Transition name="fade">
        <div v-if="editing" class="edit-row">
          <div class="range">
            <UTooltip text="Set start to the playhead" :kbds="['[']">
              <UButton
                class="mono point"
                icon="i-lucide-arrow-right-to-line"
                :label="formatTimecode(inSec)"
                color="neutral"
                variant="subtle"
                size="sm"
                aria-label="Set start to the playhead"
                @click="setIn(time)"
              />
            </UTooltip>
            <span class="len mono" :title="'Selection length'">{{ formatTimecode(selectionLength) }}</span>
            <UTooltip text="Set end to the playhead" :kbds="[']']">
              <UButton
                class="mono point"
                icon="i-lucide-arrow-left-to-line"
                :label="formatTimecode(outSec)"
                color="neutral"
                variant="subtle"
                size="sm"
                aria-label="Set end to the playhead"
                @click="setOut(time)"
              />
            </UTooltip>
            <UTooltip text="Reset range" :kbds="['Shift', 'R']">
              <UButton icon="i-lucide-rotate-ccw" color="neutral" variant="ghost" square size="sm" aria-label="Reset range" @click="resetRange" />
            </UTooltip>
          </div>

          <UTooltip :text="clip.hasAudio ? 'Drop the audio from the export' : 'Source has no audio'" :kbds="['Shift', 'M']">
            <UButton
              :icon="exportMuted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
              :label="exportMuted ? 'Muted' : 'Mute'"
              :color="exportMuted ? 'primary' : 'neutral'"
              :variant="exportMuted ? 'soft' : 'subtle'"
              size="sm"
              :aria-pressed="exportMuted"
              :disabled="!clip.hasAudio"
              @click="exportMuted = !exportMuted"
            />
          </UTooltip>

          <UInput
            v-model="exportName"
            class="name"
            size="md"
            placeholder="Clip name"
            spellcheck="false"
            autocomplete="off"
            aria-label="Clip name"
            :ui="{ trailing: 'pe-2.5' }"
            @keydown.enter.prevent="exportNow"
            @keydown.esc.prevent="exitEdit"
          >
            <template #trailing>
              <span class="ext mono">{{ outExt }}</span>
            </template>
          </UInput>

          <div class="submit">
            <UButton label="Cancel" color="neutral" variant="ghost" size="md" @click="exitEdit" />
            <UTooltip text="Export the selection" :kbds="['Ctrl', 'Enter']">
              <UButton
                icon="i-lucide-download"
                label="Export"
                color="primary"
                size="md"
                :loading="submitting"
                :disabled="!canExport"
                @click="exportNow"
              />
            </UTooltip>
          </div>
        </div>
      </Transition>

      <div class="row">
        <div class="group">
          <div class="transport">
            <UTooltip text="Previous" :kbds="['P']">
              <UButton icon="i-lucide-skip-back" color="neutral" variant="ghost" square size="lg" :disabled="!hasPrev || editing" aria-label="Previous clip" @click="prevClip" />
            </UTooltip>
            <UTooltip :text="playing ? 'Pause' : 'Play'" :kbds="['Space']">
              <UButton class="play" :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'" color="primary" square size="xl" :aria-label="playing ? 'Pause' : 'Play'" @click="togglePlay" />
            </UTooltip>
            <UTooltip text="Next" :kbds="['N']">
              <UButton icon="i-lucide-skip-forward" color="neutral" variant="ghost" square size="lg" :disabled="!hasNext || editing" aria-label="Next clip" @click="nextClip" />
            </UTooltip>
          </div>
          <div class="volume">
            <UTooltip :text="muted ? 'Unmute' : 'Mute'" :kbds="['M']">
              <UButton :icon="volumeIcon" color="neutral" variant="ghost" square size="lg" :aria-label="muted ? 'Unmute' : 'Mute'" @click="setMuted(!muted)" />
            </UTooltip>
            <!-- No side icons: the mute button beside it already shows the volume state. -->
            <ElasticSlider
              class="vol-slider"
              :model-value="muted ? 0 : volume * 100"
              :max-value="100"
              :fill-color="activeTheme.colors.secondary"
              track-color="rgba(255, 255, 255, 0.22)"
              @update:model-value="(v: number) => setVolume(v / 100)"
            />
          </div>
          <span class="time mono">
            {{ editing ? formatTimecode(time) : formatDuration(time) }}<span class="dim"> / {{ formatDuration(duration) }}</span>
          </span>
        </div>
        <div class="group">
          <template v-if="editing">
            <UTooltip text="Previous frame" :kbds="[',']">
              <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" square size="lg" aria-label="Previous frame" @click="stepFrame(-1)" />
            </UTooltip>
            <UTooltip text="Next frame" :kbds="['.']">
              <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" square size="lg" aria-label="Next frame" @click="stepFrame(1)" />
            </UTooltip>
          </template>
          <UTooltip text="Playback speed">
            <UButton class="rate mono" :label="`${rate}×`" color="neutral" variant="ghost" size="md" @click="cycleRate" />
          </UTooltip>
          <UTooltip v-if="!editing" text="Loop">
            <UButton
              icon="i-lucide-repeat"
              :color="loop ? 'primary' : 'neutral'"
              :variant="loop ? 'soft' : 'ghost'"
              square
              size="lg"
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
              size="lg"
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
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: rgba(7, 7, 18, 0.97);
  /* The overlay covers the frameless title bar, whose drag strip would
     otherwise swallow every click in the top 40px - the back arrow and the
     details toggle both sit inside it. */
  -webkit-app-region: no-drag;
  /* One width, one switch: everything that has to make room for the details
     pane reads --pane-w, which is 0 whenever the pane is not showing. */
  --details-w: 340px;
  --pane-w: 0px;
  /* The controls block grows a row in edit mode; the stage gives it the room. */
  --controls-h: 108px;
}
.player.with-details {
  --pane-w: var(--details-w);
}
.player.is-editing {
  --controls-h: 164px;
}
/* Near the 980px minimum window the pane gives width back so the video keeps
   the larger share of the screen. */
@media (max-width: 1240px) {
  .player {
    --details-w: 296px;
  }
  .player.is-editing {
    --controls-h: 210px;
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
  background: linear-gradient(180deg, rgba(7, 7, 18, 0.9), transparent);
}
.controls {
  bottom: 0;
  padding: var(--s-6) var(--s-5) var(--s-4);
  background: linear-gradient(0deg, rgba(7, 7, 18, 0.92), transparent);
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
.veil {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--secondary);
  background: rgba(7, 7, 18, 0.4);
}
.veil.failed {
  background: rgba(7, 7, 18, 0.85);
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
  background: rgba(30, 28, 53, 0.75);
  backdrop-filter: blur(6px);
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
  background: rgba(7, 7, 18, 0.55);
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
  background: rgba(30, 28, 53, 0.7);
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

.seek {
  position: relative;
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
  transform: scale(0);
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
  background: rgba(30, 28, 53, 0.95);
  border: 1px solid var(--border-hover);
  font-size: var(--text-xs);
  pointer-events: none;
}

/* Edit row: range on the left, the export form on the right; wraps near the
   980px minimum instead of squeezing the name field. */
.edit-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-3);
  margin-top: var(--s-3);
  padding: var(--s-2) var(--s-3);
  border-radius: var(--r-md);
  background: rgba(30, 28, 53, 0.6);
  border: 1px solid var(--border);
}
.range {
  display: flex;
  align-items: center;
  gap: var(--s-1);
}
.point {
  min-width: 108px;
  justify-content: center;
  text-transform: none;
}
.len {
  min-width: 64px;
  text-align: center;
  font-size: var(--text-xs);
  color: var(--fg-muted);
}
.name {
  flex: 1;
  min-width: 200px;
}
.ext {
  font-size: var(--text-xs);
  color: var(--fg-dim);
}
.submit {
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
  font-size: var(--text-sm);
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
</style>
