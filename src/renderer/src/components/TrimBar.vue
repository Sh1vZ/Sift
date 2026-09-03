<script setup lang="ts">
import { computed, ref } from 'vue'
import { clamp, formatTimecode, fractionAcross } from '@/utils/format'

/**
 * The player's seek bar in edit mode: the same track, plus in/out handles
 * that shade out what the export will drop. Dragging a handle scrubs the
 * video to it so you see the exact frame you are cutting on.
 */
const props = defineProps<{
  duration: number
  inSec: number
  outSec: number
  time: number
  buffered: number
}>()
const emit = defineEmits<{ 'update:in': [seconds: number]; 'update:out': [seconds: number]; seek: [seconds: number] }>()

type Target = 'in' | 'out' | 'head'

const track = ref<HTMLElement | null>(null)
const dragging = ref<Target | null>(null)
const hoverPct = ref<number | null>(null)

const pct = (s: number): number => (props.duration ? (clamp(s, 0, props.duration) / props.duration) * 100 : 0)
const inPct = computed(() => pct(props.inSec))
const outPct = computed(() => pct(props.outSec))
const headPct = computed(() => pct(props.time))
const bufferedPct = computed(() => pct(props.buffered))

function secondsAt(e: PointerEvent): number {
  return track.value ? fractionAcross(track.value, e.clientX) * props.duration : 0
}

function apply(target: Target, seconds: number): void {
  if (target === 'in') emit('update:in', seconds)
  else if (target === 'out') emit('update:out', seconds)
  emit('seek', seconds)
}

function onTrackDown(e: PointerEvent): void {
  dragging.value = 'head'
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  apply('head', secondsAt(e))
}

function onHandleDown(target: Target, e: PointerEvent): void {
  e.stopPropagation()
  dragging.value = target
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent): void {
  if (track.value) hoverPct.value = fractionAcross(track.value, e.clientX)
  if (dragging.value) apply(dragging.value, secondsAt(e))
}

function onUp(): void {
  dragging.value = null
}

function onLeave(): void {
  hoverPct.value = null
  if (!dragging.value) return
}

/** Focused handle: arrows nudge by a second, a tenth with Shift. Stops here so the player's keys stay out of it. */
function onHandleKey(target: 'in' | 'out', e: KeyboardEvent): void {
  const value = target === 'in' ? props.inSec : props.outSec
  const step = e.shiftKey ? 0.1 : 1
  let next: number | null = null
  switch (e.key) {
    case 'ArrowLeft':
      next = value - step
      break
    case 'ArrowRight':
      next = value + step
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = props.duration
      break
  }
  if (next === null) return
  e.preventDefault()
  e.stopPropagation()
  apply(target, clamp(next, 0, props.duration))
}

const tipTime = computed(() => {
  if (dragging.value === 'in') return props.inSec
  if (dragging.value === 'out') return props.outSec
  return hoverPct.value === null ? null : hoverPct.value * props.duration
})
const tipPct = computed(() => {
  if (dragging.value === 'in') return inPct.value
  if (dragging.value === 'out') return outPct.value
  return hoverPct.value === null ? 0 : hoverPct.value * 100
})
</script>

<template>
  <div
    class="trim"
    :class="{ 'is-dragging': dragging }"
    role="group"
    aria-label="Trim range"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @pointerleave="onLeave"
  >
    <div ref="track" class="track" @pointerdown="onTrackDown">
      <div class="buffered" :style="{ width: `${bufferedPct}%` }" />
      <div class="dim" :style="{ left: 0, width: `${inPct}%` }" />
      <div class="dim" :style="{ left: `${outPct}%`, right: 0 }" />
      <div class="selection" :style="{ left: `${inPct}%`, width: `${Math.max(0, outPct - inPct)}%` }" />
      <div class="playhead" :style="{ left: `${headPct}%` }" />

      <div
        class="handle in"
        :style="{ left: `${inPct}%` }"
        role="slider"
        tabindex="0"
        aria-label="Start of clip"
        :aria-valuemin="0"
        :aria-valuemax="Math.round(duration * 10) / 10"
        :aria-valuenow="Math.round(inSec * 10) / 10"
        :aria-valuetext="formatTimecode(inSec)"
        @pointerdown="onHandleDown('in', $event)"
        @keydown="onHandleKey('in', $event)"
      >
        <span class="grip" aria-hidden="true" />
      </div>
      <div
        class="handle out"
        :style="{ left: `${outPct}%` }"
        role="slider"
        tabindex="0"
        aria-label="End of clip"
        :aria-valuemin="0"
        :aria-valuemax="Math.round(duration * 10) / 10"
        :aria-valuenow="Math.round(outSec * 10) / 10"
        :aria-valuetext="formatTimecode(outSec)"
        @pointerdown="onHandleDown('out', $event)"
        @keydown="onHandleKey('out', $event)"
      >
        <span class="grip" aria-hidden="true" />
      </div>
    </div>

    <div v-if="tipTime !== null" class="tip mono" :style="{ left: `${tipPct}%` }">
      {{ formatTimecode(tipTime) }}
    </div>
  </div>
</template>

<style scoped>
.trim {
  position: relative;
  height: 28px;
  display: flex;
  align-items: center;
  touch-action: none;
  user-select: none;
}
.track {
  position: relative;
  width: 100%;
  height: 6px;
  border-radius: var(--r-full);
  background: rgba(255, 255, 255, 0.16);
  cursor: pointer;
}
.buffered,
.dim,
.selection {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: var(--r-full);
}
.buffered {
  left: 0;
  background: rgba(255, 255, 255, 0.2);
}
/* What the export drops: darkened so the kept range reads as the bright part. */
.dim {
  background: rgba(7, 7, 18, 0.7);
}
.selection {
  background: linear-gradient(90deg, var(--secondary), var(--primary));
  box-shadow: 0 0 12px color-mix(in srgb, var(--primary) 55%, transparent);
}
.playhead {
  position: absolute;
  top: -6px;
  bottom: -6px;
  width: 2px;
  margin-left: -1px;
  border-radius: 1px;
  background: #fff;
  box-shadow: 0 0 0 3px color-mix(in srgb, #fff 25%, transparent);
  pointer-events: none;
}
.handle {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 24px;
  margin: -12px 0 0 -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--secondary);
  border: 1px solid color-mix(in srgb, #fff 45%, var(--secondary));
  box-shadow: var(--shadow-md);
  cursor: ew-resize;
  outline-offset: 2px;
  transition:
    transform var(--dur-fast) var(--ease-spring),
    background var(--dur-fast) var(--ease-out);
}
.handle:hover,
.handle:focus-visible,
.is-dragging .handle {
  background: var(--primary-hover);
}
.handle:hover,
.handle:focus-visible {
  transform: scale(1.12);
}
.grip {
  width: 2px;
  height: 10px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.85);
}
.tip {
  position: absolute;
  bottom: 30px;
  transform: translateX(-50%);
  padding: 3px 7px;
  border-radius: 5px;
  background: rgba(30, 28, 53, 0.95);
  border: 1px solid var(--border-hover);
  font-size: var(--text-xs);
  pointer-events: none;
  white-space: nowrap;
}
</style>
