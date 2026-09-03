<template>
  <div ref="containerRef" class="relative w-full h-full" @click="handleClick">
    <canvas ref="canvasRef" class="absolute inset-0 pointer-events-none" style="z-index: 1000" />
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * Vue Bits — Animations/ClickSpark (https://vue-bits.dev/animations/click-spark)
 * Adapted: the draw loop only runs while sparks are alive (upstream ran a
 * requestAnimationFrame loop forever), the canvas is DPR-aware, and a
 * `disabled` prop honours the app's reduced-motion setting.
 */
import { computed, onMounted, onUnmounted, useTemplateRef } from 'vue'

interface Spark {
  x: number
  y: number
  angle: number
  startTime: number
}

interface Props {
  sparkColor?: string
  sparkSize?: number
  sparkRadius?: number
  sparkCount?: number
  duration?: number
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  extraScale?: number
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  sparkColor: '#fff',
  sparkSize: 10,
  sparkRadius: 15,
  sparkCount: 8,
  duration: 400,
  easing: 'ease-out',
  extraScale: 1.0,
  disabled: false
})

const containerRef = useTemplateRef<HTMLDivElement>('containerRef')
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef')
let sparks: Spark[] = []
let animationId: number | null = null
let dpr = 1

const easeFunc = computed(() => (t: number) => {
  switch (props.easing) {
    case 'linear':
      return t
    case 'ease-in':
      return t * t
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
    default:
      return t * (2 - t)
  }
})

const handleClick = (e: MouseEvent): void => {
  const canvas = canvasRef.value
  if (!canvas || props.disabled) return
  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const now = performance.now()
  for (let i = 0; i < props.sparkCount; i++) {
    sparks.push({ x, y, angle: (2 * Math.PI * i) / props.sparkCount, startTime: now })
  }
  if (animationId === null) animationId = requestAnimationFrame(draw)
}

const draw = (timestamp: number): void => {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!ctx || !canvas) {
    animationId = null
    return
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(dpr, dpr)

  sparks = sparks.filter((spark) => {
    const elapsed = timestamp - spark.startTime
    if (elapsed >= props.duration) return false
    const eased = easeFunc.value(elapsed / props.duration)
    const distance = eased * props.sparkRadius * props.extraScale
    const lineLength = props.sparkSize * (1 - eased)
    const x1 = spark.x + distance * Math.cos(spark.angle)
    const y1 = spark.y + distance * Math.sin(spark.angle)
    const x2 = spark.x + (distance + lineLength) * Math.cos(spark.angle)
    const y2 = spark.y + (distance + lineLength) * Math.sin(spark.angle)
    ctx.strokeStyle = props.sparkColor
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    return true
  })
  ctx.restore()

  // Idle once every spark has burned out — no per-frame work while nothing is happening.
  animationId = sparks.length ? requestAnimationFrame(draw) : null
}

const resizeCanvas = (): void => {
  const canvas = canvasRef.value
  const parent = canvas?.parentElement
  if (!canvas || !parent) return
  dpr = window.devicePixelRatio || 1
  const { width, height } = parent.getBoundingClientRect()
  const w = Math.round(width * dpr)
  const h = Math.round(height * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }
}

let resizeTimeout: ReturnType<typeof setTimeout>
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  const parent = canvasRef.value?.parentElement
  if (!parent) return
  resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(resizeCanvas, 100)
  })
  resizeObserver.observe(parent)
  resizeCanvas()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  clearTimeout(resizeTimeout)
  if (animationId !== null) cancelAnimationFrame(animationId)
})
</script>
