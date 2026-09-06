<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { clamp } from '@/utils/format'

/**
 * The still behind the viewer: one <img> laid out at its natural size and
 * moved by a single transform, so zooming and panning never touch layout and
 * stay on the compositor. Fit is the floor — below it there is nothing more
 * to see — and 1:1 means one image pixel per device pixel, which is what
 * "actual size" reads as on a scaled display. The overlay's stage box already
 * has the image's aspect (fitStage sizes it from the clip), so fit fills it.
 *
 * The transform lives on this child; the GSAP flip that opens and closes the
 * overlay transforms the stage itself, so the two compose and never fight.
 */
const props = defineProps<{
  /** Absent while the overlay is flipping or the window is away: nothing decodes then. */
  src?: string
  width: number
  height: number
  /** The stage box, in CSS pixels. */
  box: { width: number; height: number }
  alt: string
}>()
const emit = defineEmits<{
  load: []
  error: []
  /** Zoom as a percentage of actual size, and whether the image is at fit. */
  zoom: [percent: number, atFit: boolean]
  /** A wheel, drag or double-click: the overlay keeps its chrome up on these. */
  interact: []
}>()

const ZOOM_STEP = 1.25
/** Wheel notches to zoom factor: one notch of 100 units is about 16 %. */
const WHEEL_RATE = 0.0015
const PAN_STEP = 80
/** Pointer travel under this is a click, not a drag. */
const DRAG_SLOP = 4
/** How long after the last wheel notch the transition comes back. */
const SETTLE_MS = 160

const root = ref<HTMLElement | null>(null)
const natural = ref({ width: props.width, height: props.height })
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const dragging = ref(false)
/** Wheel and drag move the picture directly; the transition is for keys and double-clicks. */
const interacting = ref(false)

const dpr = (): number => window.devicePixelRatio || 1
const fitScale = computed(() => {
  const { width: nw, height: nh } = natural.value
  const { width: sw, height: sh } = props.box
  if (!nw || !nh || !sw || !sh) return 1
  return Math.min(sw / nw, sh / nh)
})
const actualScale = computed(() => 1 / dpr())
const maxScale = computed(() => Math.max(8 * fitScale.value, 4 * actualScale.value))
const isFit = computed(() => Math.abs(scale.value - fitScale.value) < 1e-4)
const percent = computed(() => Math.round(scale.value * dpr() * 100))
const pannable = computed(() => !isFit.value)

const style = computed(() => ({
  width: `${natural.value.width}px`,
  height: `${natural.value.height}px`,
  transform: `translate3d(${tx.value}px, ${ty.value}px, 0) scale(${scale.value})`,
}))

/** Centred while the picture fits the box on an axis; otherwise never showing the box behind it. */
function clampPan(): void {
  const { width: nw, height: nh } = natural.value
  const { width: sw, height: sh } = props.box
  const w = nw * scale.value
  const h = nh * scale.value
  tx.value = w <= sw ? (sw - w) / 2 : clamp(tx.value, sw - w, 0)
  ty.value = h <= sh ? (sh - h) / 2 : clamp(ty.value, sh - h, 0)
}

function fit(): void {
  scale.value = fitScale.value
  clampPan()
}

/** Zoom by `factor` about a point of the box, so what is under the pointer stays under it. */
function zoomAt(factor: number, px: number, py: number): void {
  const next = clamp(scale.value * factor, fitScale.value, maxScale.value)
  if (next === scale.value) return
  const u = (px - tx.value) / scale.value
  const v = (py - ty.value) / scale.value
  tx.value = px - u * next
  ty.value = py - v * next
  scale.value = next
  clampPan()
}

const centre = (): [number, number] => [props.box.width / 2, props.box.height / 2]

function zoomIn(): void {
  zoomAt(ZOOM_STEP, ...centre())
}
function zoomOut(): void {
  zoomAt(1 / ZOOM_STEP, ...centre())
}
function actual(px?: number, py?: number): void {
  const [cx, cy] = centre()
  zoomAt(actualScale.value / scale.value, px ?? cx, py ?? cy)
}
function toggleFit(): void {
  if (isFit.value) actual()
  else fit()
}
/** Moves the picture by the given amount; a no-op at fit, where there is nowhere to go. */
function pan(dx: number, dy: number): void {
  if (!pannable.value) return
  tx.value += dx
  ty.value += dy
  clampPan()
}

// --------------------------------------------------------------- pointer

function localPoint(e: MouseEvent): [number, number] {
  const r = root.value?.getBoundingClientRect()
  return r ? [e.clientX - r.left, e.clientY - r.top] : centre()
}

let settle = 0
function onWheel(e: WheelEvent): void {
  const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
  interacting.value = true
  window.clearTimeout(settle)
  settle = window.setTimeout(() => (interacting.value = false), SETTLE_MS)
  zoomAt(Math.exp(-delta * WHEEL_RATE), ...localPoint(e))
  emit('interact')
}

let drag: { id: number; x: number; y: number; moved: boolean } | null = null
/** Set by a drag that went somewhere, so the double-click a release can end in does not re-fit. */
let lastDragMoved = false

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || !pannable.value) return
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
  lastDragMoved = false
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent): void {
  if (drag?.id !== e.pointerId) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_SLOP) return
  drag.moved = true
  dragging.value = true
  interacting.value = true
  window.clearTimeout(settle)
  drag.x = e.clientX
  drag.y = e.clientY
  tx.value += dx
  ty.value += dy
  clampPan()
  emit('interact')
}
function onPointerUp(e: PointerEvent): void {
  if (drag?.id !== e.pointerId) return
  lastDragMoved = drag.moved
  drag = null
  dragging.value = false
  interacting.value = false
}

/** At fit, a double-click brings the picture to actual size under the pointer; zoomed, it fits again. */
function onDblClick(e: MouseEvent): void {
  if (lastDragMoved) {
    lastDragMoved = false
    return
  }
  emit('interact')
  if (isFit.value) actual(...localPoint(e))
  else fit()
}

// --------------------------------------------------------------- lifecycle

function onLoad(e: Event): void {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight)
    natural.value = { width: img.naturalWidth, height: img.naturalHeight }
  emit('load')
}

fit()

// A new picture starts at fit, with the size the index knows until the file says otherwise.
watch(
  () => props.src,
  () => {
    natural.value = { width: props.width, height: props.height }
    fit()
  },
)

// The box resized, or the file corrected its size: a picture that was at fit
// stays at fit; one that was zoomed keeps its zoom and is pulled back in bounds.
watch(fitScale, (next, prev) => {
  if (Math.abs(scale.value - prev) < 1e-4) scale.value = next
  clampPan()
})

watch([percent, isFit], ([p, f]) => emit('zoom', p, f), { immediate: true })

onBeforeUnmount(() => window.clearTimeout(settle))

defineExpose({ zoomIn, zoomOut, fit, actual: () => actual(), toggleFit, pan, isFit, PAN_STEP })
</script>

<template>
  <div
    ref="root"
    class="image-stage"
    :class="{ 'is-pannable': pannable, 'is-dragging': dragging, 'is-interacting': interacting }"
    role="img"
    :aria-label="alt"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @dblclick.stop="onDblClick"
  >
    <img
      v-if="src"
      class="picture"
      :src="src"
      alt=""
      draggable="false"
      decoding="async"
      :style="style"
      @load="onLoad"
      @error="emit('error')"
    />
  </div>
</template>

<style scoped>
.image-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #000;
  touch-action: none;
  user-select: none;
}
.image-stage.is-pannable {
  cursor: grab;
}
.image-stage.is-dragging {
  cursor: grabbing;
}
.picture {
  position: absolute;
  left: 0;
  top: 0;
  max-width: none;
  transform-origin: 0 0;
  transition: transform var(--dur) var(--ease-out);
}
/* Under the wheel or a drag the picture follows the hand; easing there would lag
   it. (Motion off collapses --dur globally, so that case needs nothing here.) */
.image-stage.is-interacting .picture {
  transition: none;
  will-change: transform;
}
</style>
