<script setup lang="ts">
import { computed, ref } from 'vue'
import { clamp, formatDuration, formatTimecode, fractionAcross } from '@/utils/format'

/**
 * The player's timeline in edit mode: a ruler with timecodes over a filmstrip
 * of the clip, bracket handles at the in/out points, and a playhead running
 * through both. The filmstrip is the hover-scrub sprite the indexer already
 * rendered, so no extra ffmpeg work happens when you start trimming.
 */
const props = defineProps<{
  duration: number
  inSec: number
  outSec: number
  time: number
  /** `clip://thumb/...` URL of the sprite strip; empty when previews are off or still rendering. */
  sprite: string
  frames: number
}>()
const emit = defineEmits<{ 'update:in': [seconds: number]; 'update:out': [seconds: number]; seek: [seconds: number] }>()

type Target = 'in' | 'out' | 'head'

/** Labelled ticks across the ruler, and unlabelled ones between each pair. */
const MAJORS = 10
const MINORS = 4

const track = ref<HTMLElement | null>(null)
const dragging = ref<Target | null>(null)
const hoverPct = ref<number | null>(null)

const pct = (s: number): number => (props.duration ? (clamp(s, 0, props.duration) / props.duration) * 100 : 0)
const inPct = computed(() => pct(props.inSec))
const outPct = computed(() => pct(props.outSec))
const headPct = computed(() => pct(props.time))

const ticks = computed(() => {
  const out: Array<{ pct: number; label: string | null }> = []
  const steps = (MAJORS - 1) * (MINORS + 1)
  for (let i = 0; i <= steps; i++) {
    const major = i % (MINORS + 1) === 0
    const p = (i / steps) * 100
    out.push({ pct: p, label: major ? formatDuration((props.duration * i) / steps) : null })
  }
  return out
})

/** One cell per sprite frame; each shows its slice of the strip, cropped to the cell. */
const cells = computed(() => {
  const n = Math.max(1, props.frames)
  return Array.from({ length: n }, (_, i) => ({
    key: i,
    style: {
      backgroundImage: `url("${props.sprite}")`,
      backgroundSize: `${n * 100}% 100%`,
      backgroundPosition: n > 1 ? `${(i / (n - 1)) * 100}% 0` : '0 0'
    }
  }))
})

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
    class="timeline"
    :class="{ 'is-dragging': dragging }"
    role="group"
    aria-label="Trim range"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @pointerleave="onLeave"
  >
    <div class="inner">
      <div class="ruler" aria-hidden="true">
        <span
          v-for="t in ticks"
          :key="t.pct"
          class="tick"
          :class="{ major: t.label !== null }"
          :style="{ left: `${t.pct}%` }"
        >
          <span v-if="t.label !== null" class="label mono" :class="{ first: t.pct === 0, last: t.pct === 100 }">{{ t.label }}</span>
        </span>
      </div>

      <div ref="track" class="strip" @pointerdown="onTrackDown">
        <div v-if="sprite" class="film">
          <span v-for="c in cells" :key="c.key" class="cell" :style="c.style" />
        </div>
        <div v-else class="film blank" />

        <div class="dim" :style="{ left: 0, width: `${inPct}%` }" />
        <div class="dim" :style="{ left: `${outPct}%`, right: 0 }" />
        <div class="frame" :style="{ left: `${inPct}%`, width: `${Math.max(0, outPct - inPct)}%` }" />

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

      <!-- Runs the full height, ruler included, so the marker sits above the timecodes. -->
      <div class="playhead" :style="{ left: `${headPct}%` }" aria-hidden="true">
        <span class="marker" />
      </div>

      <div v-if="tipTime !== null" class="tip mono" :style="{ left: `${tipPct}%` }">
        {{ formatTimecode(tipTime) }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  touch-action: none;
  user-select: none;
  --strip-h: 56px;
  --ruler-h: 30px;
  --head: var(--success);
}
/* Everything positioned by percentage shares this box, so the ruler, the strip
   and the playhead agree on where a given second is. */
.inner {
  position: relative;
  margin: 0 6px;
}

/* ------------------------------------------------------------- ruler */
.ruler {
  position: relative;
  height: var(--ruler-h);
}
.tick {
  position: absolute;
  bottom: 0;
  width: 1px;
  height: 6px;
  background: rgba(255, 255, 255, 0.28);
}
.tick.major {
  height: 10px;
  background: rgba(255, 255, 255, 0.55);
}
.label {
  position: absolute;
  bottom: 13px;
  transform: translateX(-50%);
  font-size: var(--text-xs);
  color: var(--fg-muted);
  white-space: nowrap;
}
.label.first {
  transform: none;
}
.label.last {
  transform: translateX(-100%);
}

/* ------------------------------------------------------------- strip */
.strip {
  position: relative;
  height: var(--strip-h);
  border-radius: 6px;
  background: var(--bg-3);
  cursor: pointer;
  overflow: visible;
}
.film {
  position: absolute;
  inset: 0;
  display: flex;
  border-radius: 6px;
  overflow: hidden;
}
.film.blank {
  background:
    repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(255, 255, 255, 0.08) calc(10% - 1px) 10%),
    var(--bg-3);
}
.cell {
  flex: 1 1 0;
  min-width: 0;
  background-repeat: no-repeat;
  /* Each cell is one sprite frame, cropped by the cell's own width. */
  background-clip: border-box;
}
/* What the export drops: darkened so the kept range reads as the bright part. */
.dim {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(7, 7, 18, 0.72);
  border-radius: 6px;
  pointer-events: none;
}
/* The kept range: a white frame joining the two brackets. */
.frame {
  position: absolute;
  top: 0;
  bottom: 0;
  box-shadow:
    inset 0 2px 0 #fff,
    inset 0 -2px 0 #fff;
  pointer-events: none;
}
.handle {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  cursor: ew-resize;
  outline-offset: 2px;
  box-shadow: var(--shadow-md);
  transition: background var(--dur-fast) var(--ease-out);
}
/* Brackets sit just inside the kept range, so the frames between them are the export. */
.handle.in {
  border-radius: 7px 0 0 7px;
}
.handle.out {
  margin-left: -14px;
  border-radius: 0 7px 7px 0;
}
.handle:hover,
.handle:focus-visible,
.is-dragging .handle {
  background: var(--secondary);
}
.grip {
  width: 2px;
  height: 16px;
  border-radius: 1px;
  background: rgba(7, 7, 18, 0.55);
}

/* ---------------------------------------------------------- playhead */
.playhead {
  position: absolute;
  top: 2px;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--head);
  box-shadow: 0 0 8px color-mix(in srgb, var(--head) 70%, transparent);
  pointer-events: none;
  z-index: 2;
}
.marker {
  position: absolute;
  top: 0;
  left: 50%;
  width: 10px;
  height: 12px;
  margin-left: -5px;
  border-radius: 3px;
  background: var(--head);
}

.tip {
  position: absolute;
  bottom: calc(var(--strip-h) + 8px);
  transform: translateX(-50%);
  padding: 3px 7px;
  border-radius: 5px;
  background: rgba(30, 28, 53, 0.95);
  border: 1px solid var(--border-hover);
  font-size: var(--text-xs);
  pointer-events: none;
  white-space: nowrap;
  z-index: 3;
}
</style>
