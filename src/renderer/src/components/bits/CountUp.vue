<template>
  <span ref="elementRef" :class="className" />
</template>

<script setup lang="ts">
/**
 * Vue Bits — TextAnimations/CountUp (https://vue-bits.dev/text-animations/count-up)
 * Adapted: when `to` changes after the first run (a live library count going
 * 36 → 37) the number springs from its current value instead of resetting to
 * `from` and freezing, which is what the upstream watcher did.
 */
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

interface Props {
  to: number
  from?: number
  direction?: 'up' | 'down'
  delay?: number
  duration?: number
  className?: string
  startWhen?: boolean
  separator?: string
}

const props = withDefaults(defineProps<Props>(), {
  from: 0,
  direction: 'up',
  delay: 0,
  duration: 2,
  className: '',
  startWhen: true,
  separator: ''
})

const elementRef = useTemplateRef<HTMLSpanElement>('elementRef')
const currentValue = ref(props.direction === 'down' ? props.to : props.from)
const isInView = ref(false)
const animationId = ref<number | null>(null)
const hasStarted = ref(false)

let intersectionObserver: IntersectionObserver | null = null

const damping = computed(() => 20 + 40 * (1 / props.duration))
const stiffness = computed(() => 100 * (1 / props.duration))

let velocity = 0

const formatNumber = (value: number): string => {
  const formatted = Intl.NumberFormat('en-US', {
    useGrouping: Boolean(props.separator),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(value.toFixed(0)))
  return props.separator ? formatted.replace(/,/g, props.separator) : formatted
}

const updateDisplay = (): void => {
  if (elementRef.value) elementRef.value.textContent = formatNumber(currentValue.value)
}

const target = (): number => (props.direction === 'down' ? props.from : props.to)

const springAnimation = (): void => {
  const displacement = target() - currentValue.value
  const acceleration = displacement * stiffness.value - velocity * damping.value
  velocity += acceleration * 0.016
  currentValue.value += velocity * 0.016
  updateDisplay()

  if (Math.abs(displacement) > 0.01 || Math.abs(velocity) > 0.01) {
    animationId.value = requestAnimationFrame(springAnimation)
  } else {
    currentValue.value = target()
    updateDisplay()
    animationId.value = null
  }
}

const startAnimation = (): void => {
  if (hasStarted.value || !isInView.value || !props.startWhen) return
  hasStarted.value = true
  window.setTimeout(() => {
    if (animationId.value) cancelAnimationFrame(animationId.value)
    velocity = 0
    animationId.value = requestAnimationFrame(springAnimation)
  }, props.delay * 1000)
}

const setupIntersectionObserver = (): void => {
  if (!elementRef.value) return
  intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && !isInView.value) {
        isInView.value = true
        startAnimation()
      }
    },
    { threshold: 0, rootMargin: '0px' }
  )
  intersectionObserver.observe(elementRef.value)
}

const cleanup = (): void => {
  if (animationId.value) {
    cancelAnimationFrame(animationId.value)
    animationId.value = null
  }
  intersectionObserver?.disconnect()
  intersectionObserver = null
}

// Re-run from wherever the number currently is whenever the target moves.
watch([() => props.from, () => props.to, () => props.direction], () => {
  hasStarted.value = false
  if (isInView.value) startAnimation()
  else updateDisplay()
})

watch(
  () => props.startWhen,
  () => {
    if (props.startWhen && isInView.value && !hasStarted.value) startAnimation()
  }
)

onMounted(() => {
  updateDisplay()
  setupIntersectionObserver()
})

onUnmounted(cleanup)
</script>
