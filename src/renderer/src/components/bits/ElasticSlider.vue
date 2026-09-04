<template>
  <div :class="`flex flex-col items-center justify-center gap-4 w-48 ${className}`">
    <div
      class="flex w-full touch-none select-none items-center justify-center gap-4"
      :style="{ scale: scale, opacity: sliderOpacity }"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
    >
      <div
        v-if="$slots['left-icon']"
        ref="leftIconRef"
        :style="{ transform: `translateX(${leftIconTranslateX}px) scale(${leftIconScale})` }"
        class="transition-transform duration-200 ease-out"
      >
        <slot name="left-icon" />
      </div>

      <div
        ref="sliderRef"
        class="relative flex w-full max-w-xs flex-grow cursor-grab touch-none select-none items-center py-4 rounded-full"
        role="slider"
        tabindex="0"
        :aria-label="ariaLabel"
        :aria-valuemin="startingValue"
        :aria-valuemax="maxValue"
        :aria-valuenow="Math.round(value)"
        :aria-valuetext="`${Math.round(value)}%`"
        @keydown="handleKey"
        @focus="focused = true"
        @blur="focused = false"
        @pointermove="handlePointerMove"
        @pointerdown="handlePointerDown"
        @pointerup="handlePointerUp"
        @pointercancel="handlePointerUp"
      >
        <div
          :style="{
            transform: `scaleX(${sliderScaleX}) scaleY(${sliderScaleY})`,
            transformOrigin: transformOrigin,
            height: `${sliderHeight}px`,
            marginTop: `${sliderMarginTop}px`,
            marginBottom: `${sliderMarginBottom}px`
          }"
          class="flex flex-grow"
        >
          <div class="relative h-full flex-grow overflow-hidden rounded-full" :style="{ background: trackColor }">
            <div class="absolute h-full rounded-full" :style="{ width: `${rangePercentage}%`, background: fillColor }" />
          </div>
        </div>
      </div>

      <div
        v-if="$slots['right-icon']"
        ref="rightIconRef"
        :style="{ transform: `translateX(${rightIconTranslateX}px) scale(${rightIconScale})` }"
        class="transition-transform duration-200 ease-out"
      >
        <slot name="right-icon" />
      </div>
    </div>

    <p
      v-if="showValue || focused || hovering"
      class="absolute -translate-y-6 text-xs font-medium tracking-wide text-muted pointer-events-none"
    >
      {{ Math.round(value) }}%
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * Vue Bits — Components/ElasticSlider (https://vue-bits.dev/components/elastic-slider)
 * Adapted: v-model (`modelValue` / `update:modelValue`) so the parent actually
 * receives the value — upstream kept it internal — plus `trackColor`,
 * `fillColor` and `showValue` props in place of hard-coded colours. The side
 * icons are also opt-in: upstream always rendered them (falling back to `-`/`+`
 * text), which left dead space when the caller has its own icon beside the
 * slider. Keyboard and screen-reader support are ours as well: upstream was
 * pointer-only, so the track is now a focusable `role="slider"` with arrow,
 * Home and End keys, an `aria-label` prop, and a readout while hovered or focused.
 */
import { computed, ref, useTemplateRef, watch } from 'vue'

const MAX_OVERFLOW = 50

interface Props {
  modelValue?: number
  startingValue?: number
  maxValue?: number
  className?: string
  isStepped?: boolean
  stepSize?: number
  trackColor?: string
  fillColor?: string
  showValue?: boolean
  ariaLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: 50,
  startingValue: 0,
  maxValue: 100,
  className: '',
  isStepped: false,
  stepSize: 1,
  trackColor: 'rgba(255,255,255,0.25)',
  fillColor: '#ffffff',
  showValue: false,
  ariaLabel: 'Value'
})

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const sliderRef = useTemplateRef<HTMLDivElement>('sliderRef')

const value = ref(props.modelValue)
const focused = ref(false)
const hovering = ref(false)
const region = ref<'left' | 'middle' | 'right'>('middle')
const clientX = ref(0)
const overflow = ref(0)
const scale = ref(1)
const leftIconScale = ref(1)
const rightIconScale = ref(1)

let scaleAnimation: number | null = null
let overflowAnimation: number | null = null

watch(
  () => props.modelValue,
  (v) => {
    value.value = v
  }
)

watch(clientX, (latest) => {
  if (!sliderRef.value) return
  const { left, right } = sliderRef.value.getBoundingClientRect()
  let newValue: number
  if (latest < left) {
    region.value = 'left'
    newValue = left - latest
  } else if (latest > right) {
    region.value = 'right'
    newValue = latest - right
  } else {
    region.value = 'middle'
    newValue = 0
  }
  overflow.value = decay(newValue, MAX_OVERFLOW)
})

const rangePercentage = computed(() => {
  const totalRange = props.maxValue - props.startingValue
  if (totalRange === 0) return 0
  return ((value.value - props.startingValue) / totalRange) * 100
})

const sliderScaleX = computed(() => {
  if (!sliderRef.value) return 1
  const { width } = sliderRef.value.getBoundingClientRect()
  return 1 + overflow.value / width
})
const sliderScaleY = computed(() => 1 + (overflow.value / MAX_OVERFLOW) * (0.8 - 1))
const transformOrigin = computed(() => {
  if (!sliderRef.value) return 'center'
  const { left, width } = sliderRef.value.getBoundingClientRect()
  return clientX.value < left + width / 2 ? 'right' : 'left'
})
const t = computed(() => (scale.value - 1) / (1.2 - 1))
const sliderHeight = computed(() => 6 + t.value * (12 - 6))
const sliderMarginTop = computed(() => t.value * -3)
const sliderMarginBottom = computed(() => t.value * -3)
const sliderOpacity = computed(() => 0.7 + t.value * 0.3)
const leftIconTranslateX = computed(() => (region.value === 'left' ? -overflow.value / scale.value : 0))
const rightIconTranslateX = computed(() => (region.value === 'right' ? overflow.value / scale.value : 0))

const decay = (inputValue: number, max: number): number => {
  if (max === 0) return 0
  const entry = inputValue / max
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5)
  return sigmoid * max
}

const animateValue = (target: { value: number }, to: number, duration = 300): number => {
  const start = target.value
  const diff = to - start
  const startTime = performance.now()
  const frame = (now: number): void => {
    const progress = Math.min((now - startTime) / duration, 1)
    target.value = start + diff * (1 - Math.pow(1 - progress, 3))
    if (progress < 1) requestAnimationFrame(frame)
  }
  return requestAnimationFrame(frame)
}

const animateSpring = (target: { value: number }, to: number, bounce = 0.5, duration = 600): number => {
  const start = target.value
  const startTime = performance.now()
  const stiffness = 170
  const damping = 26 * (1 - bounce)
  const dampingRatio = damping / (2 * Math.sqrt(stiffness))
  const angularFreq = Math.sqrt(stiffness)
  const dampedFreq = angularFreq * Math.sqrt(1 - dampingRatio * dampingRatio)
  const frame = (now: number): void => {
    const elapsed = now - startTime
    const time = elapsed / 1000
    let displacement: number
    if (dampingRatio < 1) {
      const envelope = Math.exp(-dampingRatio * angularFreq * time)
      displacement =
        envelope *
        (Math.cos(dampedFreq * time) + ((dampingRatio * angularFreq) / dampedFreq) * Math.sin(dampedFreq * time))
    } else {
      displacement = Math.exp(-angularFreq * time)
    }
    const current = to + (start - to) * displacement
    target.value = current
    const settled = Math.abs(current - to) < 0.01 && elapsed > 100
    if (!settled && elapsed < duration * 3) requestAnimationFrame(frame)
    else target.value = to
  }
  return requestAnimationFrame(frame)
}

const animateIconScale = (target: { value: number }, isActive: boolean): void => {
  if (isActive) {
    animateValue(target, 1.4, 125)
    window.setTimeout(() => animateValue(target, 1, 125), 125)
  } else {
    animateValue(target, 1, 250)
  }
}

watch(region, (next, prev) => {
  if (next === 'left' && prev !== 'left') animateIconScale(leftIconScale, true)
  else if (next === 'right' && prev !== 'right') animateIconScale(rightIconScale, true)
})

const handlePointerMove = (e: PointerEvent): void => {
  if (e.buttons > 0 && sliderRef.value) {
    const { left, width } = sliderRef.value.getBoundingClientRect()
    let newValue = props.startingValue + ((e.clientX - left) / width) * (props.maxValue - props.startingValue)
    if (props.isStepped) newValue = Math.round(newValue / props.stepSize) * props.stepSize
    newValue = Math.min(Math.max(newValue, props.startingValue), props.maxValue)
    value.value = newValue
    emit('update:modelValue', newValue)
    clientX.value = e.clientX
  }
}

const handlePointerDown = (e: PointerEvent): void => {
  handlePointerMove(e)
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

const handlePointerUp = (): void => {
  if (overflowAnimation) cancelAnimationFrame(overflowAnimation)
  overflowAnimation = animateSpring(overflow, 0, 0.4, 500)
}

const handleMouseEnter = (): void => {
  hovering.value = true
  if (scaleAnimation) cancelAnimationFrame(scaleAnimation)
  scaleAnimation = animateValue(scale, 1.2, 200)
}

const handleMouseLeave = (): void => {
  hovering.value = false
  if (scaleAnimation) cancelAnimationFrame(scaleAnimation)
  scaleAnimation = animateValue(scale, 1, 200)
}

/** Arrows step a twentieth of the range (or one step when stepped); Home and End jump. */
const handleKey = (e: KeyboardEvent): void => {
  const step = props.isStepped ? props.stepSize : (props.maxValue - props.startingValue) / 20
  let next: number | null = null
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value.value + step
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value.value - step
  else if (e.key === 'Home') next = props.startingValue
  else if (e.key === 'End') next = props.maxValue
  if (next === null) return
  e.preventDefault()
  e.stopPropagation()
  next = Math.min(Math.max(next, props.startingValue), props.maxValue)
  value.value = next
  emit('update:modelValue', next)
}
</script>
