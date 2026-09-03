<template>
  <component
    :is="as"
    ref="divRef"
    :class="['relative rounded-3xl border overflow-hidden p-8', className]"
    @mousemove="handleMouseMove"
    @focus="handleFocus"
    @blur="handleBlur"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <div
      class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 ease-in-out"
      :style="{
        opacity,
        background: `radial-gradient(circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 80%)`
      }"
    />
    <slot />
  </component>
</template>

<script setup lang="ts">
/**
 * Vue Bits — Components/SpotlightCard (https://vue-bits.dev/components/spotlight-card)
 * Adapted: `as` prop so a card can be a real <button>.
 */
import { ref, useTemplateRef } from 'vue'

interface SpotlightCardProps {
  as?: string
  className?: string
  spotlightColor?: string
}

const { as = 'div', className = '', spotlightColor = 'rgba(255, 255, 255, 0.25)' } =
  defineProps<SpotlightCardProps>()

const divRef = useTemplateRef<HTMLElement>('divRef')
const isFocused = ref(false)
const position = ref({ x: 0, y: 0 })
const opacity = ref(0)

const handleMouseMove = (e: MouseEvent): void => {
  if (!divRef.value || isFocused.value) return
  const rect = divRef.value.getBoundingClientRect()
  position.value = { x: e.clientX - rect.left, y: e.clientY - rect.top }
}
const handleFocus = (): void => {
  isFocused.value = true
  opacity.value = 0.6
}
const handleBlur = (): void => {
  isFocused.value = false
  opacity.value = 0
}
const handleMouseEnter = (): void => {
  opacity.value = 0.6
}
const handleMouseLeave = (): void => {
  opacity.value = 0
}
</script>
