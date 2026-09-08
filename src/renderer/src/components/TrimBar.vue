<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Filmstrip } from '@/composables/useEditor'
import { clamp, formatDuration, formatTimecode, fractionAcross } from '@/utils/format'

/**
 * The player's timeline in edit mode: a ruler with timecodes over a filmstrip
 * of the clip, bracket handles at the in/out points, and a playhead running
 * through both. The filmstrip is cut for the clip as the player opens (see
 * `filmstrip` in useEditor); until it is whole, the hover-scrub sprite the
 * indexer already rendered stands in, and the strip then fades in over it in
 * one go rather than filling in frame by frame.
 */
const props = defineProps<{
  duration: number
  inSec: number
  outSec: number
  time: number
  /** `clip://thumb/...` URL of the hover-scrub sprite; empty when previews are off or still rendering. */
  sprite: string
  spriteFrames: number
  /** The clip's filmstrip, cut or still being cut; null when none was asked for, or the cut failed. */
  filmstrip: Filmstrip | null
}>()
const emit = defineEmits<{
  'update:in': [seconds: number]
  'update:out': [seconds: number]
  seek: [seconds: number]
  /** The hand going down on a bracket or the strip, and lifting off: the player holds still in between. */
  drag: [active: boolean]
}>()

type Target = 'in' | 'out' | 'head'

/** Labelled ticks across the ruler, and unlabelled ones between each pair. */
const MAJORS = 10
const MINORS = 4

const track = ref<HTMLElement | null>(null)
/** Sprite frames are cropped to 320x180 (see `makeSprite`), whatever shape the clip is. */
const FRAME_ASPECT = 16 / 9
const trackSize = ref({ width: 0, height: 0 })
const dragging = ref<Target | null>(null)
const hoverPct = ref<number | null>(null)
const headHover = ref(false)

const pct = (s: number): number =>
  props.duration ? (clamp(s, 0, props.duration) / props.duration) * 100 : 0
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

/** Frame `j` of an `n`-frame strip, sized so the one frame fills the cell. */
function slice(url: string, n: number, j: number): Record<string, string> {
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${n * 100}% 100%`,
    backgroundPosition: n > 1 ? `${(j / (n - 1)) * 100}% 0` : '0 0',
  }
}

/** Cells across the track, each the shape of a frame at the strip's height, so nothing is stretched. */
const cellCount = computed(() => {
  const { width, height } = trackSize.value
  return height > 0 ? Math.max(1, Math.round(width / (height * FRAME_ASPECT))) : 1
})

/** A cell per slot, each showing the frame of the `n`-frame strip at `url` captured nearest its midpoint. */
function layout(url: string, n: number): Array<{ key: number; style: Record<string, string> }> {
  const count = cellCount.value
  return Array.from({ length: count }, (_, i) => {
    // Frame j of n opens at j/n of the clip, so the cell's midpoint picks its frame.
    const j = Math.min(n - 1, Math.floor(((i + 0.5) / count) * n))
    return { key: i, style: slice(url, n, j) }
  })
}

/**
 * Two layers of cells. The sprite's frames — five, repeated, but on screen
 * the moment the bar is — are what it opens on, and what it keeps if there
 * is no strip. The strip's frames go on top once the strip is whole, fading
 * in over the same cells: one crossfade, from coarse to exact, rather than a
 * fill-in; and none at all when the strip was already cut, since the layer
 * is then there from the first frame.
 */
const spriteCells = computed(() =>
  props.sprite && props.spriteFrames > 0
    ? layout(props.sprite, props.spriteFrames)
    : Array.from({ length: cellCount.value }, (_, i) => ({ key: i, style: null })),
)
const filmCells = computed(() => {
  const film = props.filmstrip
  return film?.strip && film.count > 0 ? layout(film.strip, film.count) : null
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
  emit('drag', true)
  apply('head', secondsAt(e))
}

function onHandleDown(target: Target, e: PointerEvent): void {
  e.stopPropagation()
  dragging.value = target
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  emit('drag', true)
}

function onMove(e: PointerEvent): void {
  if (track.value) hoverPct.value = fractionAcross(track.value, e.clientX)
  if (dragging.value) apply(dragging.value, secondsAt(e))
}

function onUp(): void {
  if (!dragging.value) return
  dragging.value = null
  emit('drag', false)
}

function onLeave(): void {
  hoverPct.value = null
}

/** Focused handle or playhead: arrows nudge by a second, a tenth with Shift. Stops here so the player's keys stay out of it. */
function onHandleKey(target: Target, e: KeyboardEvent): void {
  const value = target === 'in' ? props.inSec : target === 'out' ? props.outSec : props.time
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

const onHead = computed(() => dragging.value === 'head' || (headHover.value && !dragging.value))
const tipTime = computed(() => {
  if (dragging.value === 'in') return props.inSec
  if (dragging.value === 'out') return props.outSec
  if (onHead.value) return props.time
  return hoverPct.value === null ? null : hoverPct.value * props.duration
})
const tipPct = computed(() => {
  if (dragging.value === 'in') return inPct.value
  if (dragging.value === 'out') return outPct.value
  if (onHead.value) return headPct.value
  return hoverPct.value === null ? 0 : hoverPct.value * 100
})

let observer: ResizeObserver | null = null
onMounted(() => {
  if (!track.value) return
  observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    trackSize.value = { width, height }
  })
  observer.observe(track.value)
})
onBeforeUnmount(() => observer?.disconnect())
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
          <span
            v-if="t.label !== null"
            class="label mono"
            :class="{ first: t.pct === 0, last: t.pct === 100 }"
            >{{ t.label }}</span
          >
        </span>
      </div>

      <div ref="track" class="strip" @pointerdown="onTrackDown">
        <div class="film">
          <span
            v-for="c in spriteCells"
            :key="c.key"
            class="cell"
            :class="{ empty: !c.style }"
            :style="c.style ?? undefined"
          />
        </div>
        <Transition name="film">
          <div v-if="filmCells" class="film">
            <span v-for="c in filmCells" :key="c.key" class="cell" :style="c.style" />
          </div>
        </Transition>

        <div class="dim" :style="{ left: 0, width: `${inPct}%` }" />
        <div class="dim" :style="{ left: `${outPct}%`, right: 0 }" />
        <div
          class="frame"
          :style="{ left: `${inPct}%`, width: `${Math.max(0, outPct - inPct)}%` }"
        />

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

      <!-- Runs the full height; the tab above the ruler is where you take hold of it. -->
      <div
        class="playhead"
        :class="{ 'is-grabbed': dragging === 'head' }"
        :style="{ left: `${headPct}%` }"
      >
        <span class="line" aria-hidden="true" />
        <div
          class="grab"
          role="slider"
          tabindex="0"
          aria-label="Playhead"
          :aria-valuemin="0"
          :aria-valuemax="Math.round(duration * 10) / 10"
          :aria-valuenow="Math.round(time * 10) / 10"
          :aria-valuetext="formatTimecode(time)"
          title="Drag to scrub"
          @pointerdown="onHandleDown('head', $event)"
          @pointerenter="headHover = true"
          @pointerleave="headHover = false"
          @keydown="onHandleKey('head', $event)"
        >
          <span class="marker" aria-hidden="true"><span class="grip-dots" /></span>
        </div>
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
  --ruler-h: 36px;
  /* The playhead is the theme's punctuation colour, not a status: --success
     would stay emerald in a crimson or solar player. --accent is the one brand
     colour guaranteed to read against the white trim brackets. */
  --head: var(--accent);
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
  background: var(--bg-3);
}
/* The strip arriving over the sprite: one crossfade, cell for cell. */
.film-enter-active {
  transition: opacity var(--dur-slow) var(--ease-out);
}
.film-enter-from {
  opacity: 0;
}
.cell {
  flex: 1 1 0;
  min-width: 0;
  background-repeat: no-repeat;
  /* Each cell is one frame, sized to the cell so it shows at its own shape;
     the cells share the track evenly, so at most half a cell's width of
     rounding is spread across all of them. */
  background-clip: border-box;
}
/* A frame still to land, or no previews at all: the strip's own ruling. */
.cell.empty {
  box-shadow: inset -1px 0 rgba(255, 255, 255, 0.08);
}
/* What the export drops: darkened so the kept range reads as the bright part. */
.dim {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--scrim) 72%, transparent);
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
  background: color-mix(in srgb, var(--scrim) 55%, transparent);
}

/* ---------------------------------------------------------- playhead */
/* Zero-width anchor at the current time. The line over the strip does not take
   pointer events, so a bracket sitting under it stays easy to grab; the tab
   above the ruler is the playhead's own drag target. */
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  z-index: 2;
  pointer-events: none;
}
.line {
  position: absolute;
  top: 8px;
  bottom: 0;
  left: -1px;
  width: 2px;
  background: var(--head);
  box-shadow: 0 0 8px color-mix(in srgb, var(--head) 70%, transparent);
}
.grab {
  position: absolute;
  top: 0;
  left: -16px;
  width: 32px;
  height: var(--ruler-h);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  pointer-events: auto;
  cursor: grab;
  outline: none;
}
.is-grabbed .grab {
  cursor: grabbing;
}
.marker {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 20px;
  border-radius: 6px;
  background: var(--head);
  box-shadow: 0 4px 12px -2px color-mix(in srgb, var(--head) 70%, transparent);
  transition:
    transform var(--dur-fast) var(--ease-spring),
    box-shadow var(--dur-fast) var(--ease-out);
}
.grab:hover .marker,
.grab:focus-visible .marker,
.is-grabbed .marker {
  transform: scale(1.15);
}
.grab:focus-visible .marker {
  box-shadow: 0 0 0 2px var(--fg);
}
/* Grip dots: the same cue a draggable list row or a window splitter uses. */
.grip-dots {
  width: 8px;
  height: 8px;
  background: radial-gradient(
      circle,
      color-mix(in srgb, var(--scrim) 65%, transparent) 1px,
      transparent 1.3px
    )
    0 0 / 4px 4px;
}

.tip {
  position: absolute;
  bottom: calc(var(--strip-h) + 8px);
  transform: translateX(-50%);
  padding: 3px 7px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--bg-3) 95%, transparent);
  border: 1px solid var(--border-hover);
  font-size: var(--text-xs);
  pointer-events: none;
  white-space: nowrap;
  z-index: 3;
}
</style>
