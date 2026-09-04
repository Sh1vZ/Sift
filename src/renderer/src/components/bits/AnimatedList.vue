<template>
  <div :class="`scroll-list-container relative ${className}`.trim()">
    <div ref="listRef" class="animated-list-scroll overflow-y-auto flex flex-col gap-3" @scroll="handleScroll">
      <AnimatedItem
        v-for="(item, index) in items"
        :key="keyOf(item, index)"
        :index="index"
        :delay="0.05"
        :animated="animated"
        @mousemove="onPointer($event, index)"
        @click="select(item, index)"
      >
        <slot :item="item" :index="index" :selected="selectedIndex === index" />
      </AnimatedItem>
    </div>
    <template v-if="showGradients">
      <div
        class="top-0 right-0 left-0 absolute h-[50px] transition-opacity duration-300 pointer-events-none"
        :style="{ opacity: topGradientOpacity, background: `linear-gradient(to bottom, ${gradientColor}, transparent)` }"
      />
      <div
        class="right-0 bottom-0 left-0 absolute h-[100px] transition-opacity duration-300 pointer-events-none"
        :style="{ opacity: bottomGradientOpacity, background: `linear-gradient(to top, ${gradientColor}, transparent)` }"
      />
    </template>
  </div>
</template>

<script setup lang="ts" generic="T">
/**
 * Vue Bits — Components/AnimatedList (https://vue-bits.dev/components/animated-list)
 * Adapted: generic items rendered through a scoped slot instead of strings,
 * `gradientColor` instead of a hard-coded hex, an `active` prop so arrow keys
 * are ignored while another surface (the player) owns the keyboard, and the
 * upstream Tab hijack removed so focus can still reach the search box. Item
 * spacing moved from a per-item margin onto the scroll container, so a consumer
 * can lay the items out as a grid; arrow keys follow whatever grid it picks.
 * The pointer moves the highlight on `mousemove` rather than `mouseenter`:
 * enter also fires when the list re-lays out under a still pointer, which stole
 * the highlight from the keyboard on every filter keystroke.
 */
import { motion, useInView } from 'motion-v'
import { defineComponent, h, onMounted, onUnmounted, ref, watch } from 'vue'

const AnimatedItem = defineComponent({
  name: 'AnimatedItem',
  props: {
    index: { type: Number, required: true },
    delay: { type: Number, default: 0 },
    animated: { type: Boolean, default: true }
  },
  emits: ['mousemove', 'click'],
  setup(props, { slots, emit }) {
    const itemRef = ref<HTMLElement | null>(null)
    const inView = useInView(itemRef, { amount: 0.5, once: false })
    return () =>
      h(
        motion.div,
        {
          ref: itemRef,
          'data-index': props.index,
          style: { cursor: 'pointer' },
          initial: props.animated ? { scale: 0.92, opacity: 0 } : false,
          animate: !props.animated || inView.value ? { scale: 1, opacity: 1 } : { scale: 0.92, opacity: 0 },
          transition: { duration: 0.22, delay: props.delay },
          onMousemove: (e: MouseEvent) => emit('mousemove', e),
          onClick: (e: MouseEvent) => emit('click', e)
        },
        slots.default?.()
      )
  }
})

interface AnimatedListProps {
  items: T[]
  itemKey?: (item: T, index: number) => string | number
  showGradients?: boolean
  enableArrowNavigation?: boolean
  active?: boolean
  animated?: boolean
  className?: string
  gradientColor?: string
  initialSelectedIndex?: number
}

const props = withDefaults(defineProps<AnimatedListProps>(), {
  itemKey: undefined,
  showGradients: true,
  enableArrowNavigation: true,
  active: true,
  animated: true,
  className: '',
  gradientColor: '#120F17',
  initialSelectedIndex: -1
})

const emit = defineEmits<{ itemSelected: [item: T, index: number] }>()

const listRef = ref<HTMLDivElement | null>(null)
const selectedIndex = ref(props.initialSelectedIndex)
const keyboardNav = ref(false)
const topGradientOpacity = ref(0)
const bottomGradientOpacity = ref(1)

const keyOf = (item: T, index: number): string | number => (props.itemKey ? props.itemKey(item, index) : index)

let lastX = -1
let lastY = -1
/** Only a pointer that actually moved takes the highlight. */
const onPointer = (e: MouseEvent, index: number): void => {
  if (e.clientX === lastX && e.clientY === lastY) return
  lastX = e.clientX
  lastY = e.clientY
  selectedIndex.value = index
}

const select = (item: T, index: number): void => {
  selectedIndex.value = index
  emit('itemSelected', item, index)
}

const handleScroll = (e: Event): void => {
  const target = e.target as HTMLDivElement
  const { scrollTop, scrollHeight, clientHeight } = target
  topGradientOpacity.value = Math.min(scrollTop / 50, 1)
  const bottomDistance = scrollHeight - (scrollTop + clientHeight)
  bottomGradientOpacity.value = scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 50, 1)
}

/** Columns the container actually rendered, so up/down move a visual row, not one item. */
const columnCount = (): number => {
  const el = listRef.value
  if (!el) return 1
  const cols = getComputedStyle(el).gridTemplateColumns
  return cols && cols !== 'none' ? cols.split(' ').filter(Boolean).length : 1
}

/**
 * Left/right belong to the caret whenever there is text to move through, so they
 * only drive the list when the focused field is empty (or is not a field at all).
 */
const caretOwnsHorizontal = (): boolean => {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return false
  return el.value.length > 0
}

const move = (e: KeyboardEvent, delta: number): void => {
  e.preventDefault()
  keyboardNav.value = true
  selectedIndex.value = Math.min(Math.max(selectedIndex.value + delta, 0), props.items.length - 1)
}

const handleKeyDown = (e: KeyboardEvent): void => {
  if (!props.active || !props.items.length) return
  if (e.key === 'ArrowDown') {
    move(e, columnCount())
  } else if (e.key === 'ArrowUp') {
    move(e, -columnCount())
  } else if (e.key === 'ArrowRight' && !caretOwnsHorizontal()) {
    move(e, 1)
  } else if (e.key === 'ArrowLeft' && !caretOwnsHorizontal()) {
    move(e, -1)
  } else if (e.key === 'Enter') {
    if (selectedIndex.value >= 0 && selectedIndex.value < props.items.length) {
      e.preventDefault()
      emit('itemSelected', props.items[selectedIndex.value], selectedIndex.value)
    }
  }
}

watch([selectedIndex, keyboardNav], () => {
  if (!keyboardNav.value || selectedIndex.value < 0 || !listRef.value) return
  const container = listRef.value
  const selectedItem = container.querySelector(`[data-index="${selectedIndex.value}"]`) as HTMLElement | null
  if (selectedItem) {
    const extraMargin = 50
    const containerScrollTop = container.scrollTop
    const containerHeight = container.clientHeight
    const itemTop = selectedItem.offsetTop
    const itemBottom = itemTop + selectedItem.offsetHeight
    if (itemTop < containerScrollTop + extraMargin) {
      container.scrollTo({ top: itemTop - extraMargin, behavior: 'smooth' })
    } else if (itemBottom > containerScrollTop + containerHeight - extraMargin) {
      container.scrollTo({ top: itemBottom - containerHeight + extraMargin, behavior: 'smooth' })
    }
  }
  keyboardNav.value = false
})

// Keep the highlight on a valid row when the list is filtered.
watch(
  () => props.items.length,
  (len) => {
    if (selectedIndex.value >= len) selectedIndex.value = len - 1
    if (len && selectedIndex.value < 0) selectedIndex.value = 0
  }
)

onMounted(() => {
  if (props.enableArrowNavigation) window.addEventListener('keydown', handleKeyDown)
  if (props.items.length && selectedIndex.value < 0) selectedIndex.value = 0
})

onUnmounted(() => {
  if (props.enableArrowNavigation) window.removeEventListener('keydown', handleKeyDown)
})
</script>
