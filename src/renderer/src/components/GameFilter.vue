<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { filtersFor, gamesFor, type FilterScope } from '@/composables/useLibrary'
import { motionEnabled } from '@/composables/useMotion'

/**
 * The row of game chips under the toolbar on the two grids that cross games,
 * Clips and Favourites. A click narrows the grid to that game, a second click
 * on the same chip widens it again, and Ctrl+click (or Shift+click) adds games
 * to the selection. Fullest game first, so the chips that narrow the most sit
 * nearest, with the count on each saying why. Past the window's width the row
 * scrolls sideways under the wheel, with a fade and an arrow at whichever edge
 * has more. Like the toolbar it binds straight to the module state for its
 * scope; the parent only says which grid it stands over.
 */
const props = defineProps<{ scope: FilterScope }>()

const filters = computed(() => filtersFor(props.scope))
const games = computed(() => gamesFor(props.scope))
const total = computed(() => games.value.reduce((n, g) => n + g.count, 0))
const selected = computed(() => new Set(filters.value.games))

/** Pill-shaped and in the game's own case: the label is a name, not a control. */
const chipUi = { base: 'rounded-full normal-case tracking-normal', label: 'max-w-64' }

function pick(name: string, e: MouseEvent): void {
  const f = filters.value
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    f.games = f.games.includes(name) ? f.games.filter((g) => g !== name) : [...f.games, name]
    return
  }
  f.games = f.games.length === 1 && f.games[0] === name ? [] : [name]
}

function clear(): void {
  filters.value.games = []
}

// ------------------------------------------------------------ sideways

const rail = ref<HTMLElement | null>(null)
const canLeft = ref(false)
const canRight = ref(false)

/** Which edges hide more chips; drives the fades and the arrows. */
function update(): void {
  const el = rail.value
  if (!el) return
  canLeft.value = el.scrollLeft > 1
  canRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

/** A plain wheel is vertical, and the row has no vertical to give, so it takes the turn sideways. */
function onWheel(e: WheelEvent): void {
  const el = rail.value
  if (!el || el.scrollWidth <= el.clientWidth) return
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  e.preventDefault()
  el.scrollLeft += e.deltaY
}

function nudge(dir: -1 | 1): void {
  const el = rail.value
  if (!el) return
  el.scrollBy({
    left: dir * el.clientWidth * 0.7,
    behavior: motionEnabled.value ? 'smooth' : 'auto',
  })
}

let observer: ResizeObserver | null = null
onMounted(() => {
  const el = rail.value
  if (!el) return
  observer = new ResizeObserver(update)
  observer.observe(el)
  update()
})
onBeforeUnmount(() => observer?.disconnect())

// A game arriving or leaving changes the row's width; measure once it has rendered.
watch(games, () => void nextTick(update))
</script>

<template>
  <div class="games" :class="{ 'fade-left': canLeft, 'fade-right': canRight }">
    <Transition name="fade">
      <UButton
        v-if="canLeft"
        class="edge edge-left"
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="ghost"
        size="sm"
        square
        aria-label="Scroll games left"
        @click="nudge(-1)"
      />
    </Transition>

    <div
      ref="rail"
      class="rail"
      role="group"
      aria-label="Filter by game"
      @scroll.passive="update"
      @wheel="onWheel"
    >
      <UButton
        label="All games"
        size="md"
        :color="selected.size ? 'neutral' : 'primary'"
        :variant="selected.size ? 'subtle' : 'soft'"
        :aria-pressed="!selected.size"
        :ui="chipUi"
        @click="clear"
      >
        <template #trailing>
          <span class="count mono">{{ total }}</span>
        </template>
      </UButton>

      <UButton
        v-for="g in games"
        :key="g.name"
        :label="g.name"
        size="md"
        :color="selected.has(g.name) ? 'primary' : 'neutral'"
        :variant="selected.has(g.name) ? 'soft' : 'subtle'"
        :aria-pressed="selected.has(g.name)"
        :ui="chipUi"
        @click="pick(g.name, $event)"
      >
        <template #trailing>
          <span class="count mono">{{ g.count }}</span>
        </template>
      </UButton>
    </div>

    <Transition name="fade">
      <UButton
        v-if="canRight"
        class="edge edge-right"
        icon="i-lucide-chevron-right"
        color="neutral"
        variant="ghost"
        size="sm"
        square
        aria-label="Scroll games right"
        @click="nudge(1)"
      />
    </Transition>
  </div>
</template>

<style scoped>
.games {
  position: relative;
  min-width: 0;
}
/* The negative margin and matching padding give the focus ring room: the
   overflow clip would otherwise cut it on every side. */
.rail {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin: -4px;
  padding: 4px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}
.rail::-webkit-scrollbar {
  display: none;
}
/* Chips keep their width: a flex row would otherwise squeeze them to fit
   rather than overflow, and truncate every name. */
.rail > * {
  flex: 0 0 auto;
}
.count {
  font-size: var(--text-xs);
  color: var(--fg-muted);
}
/* The fades are alpha ramps, not colours, so black and transparent are the
   mask's own words rather than theme tokens. */
.fade-left .rail {
  mask-image: linear-gradient(90deg, transparent, black 56px);
}
.fade-right .rail {
  mask-image: linear-gradient(90deg, black calc(100% - 56px), transparent);
}
.fade-left.fade-right .rail {
  mask-image: linear-gradient(90deg, transparent, black 56px, black calc(100% - 56px), transparent);
}
.edge {
  position: absolute;
  top: 50%;
  z-index: 1;
  transform: translateY(-50%);
}
.edge-left {
  left: -4px;
}
.edge-right {
  right: -4px;
}
</style>
