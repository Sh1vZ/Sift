<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import type { Clip, ExportJob } from '@shared/types'
import ClipCard from './ClipCard.vue'
import { GRID_PAD_X, useVirtualGrid } from '@/composables/useVirtualGrid'
import {
  pendingByClip,
  reportVisibleClips,
  scopeOf,
  settings,
  type Section,
} from '@/composables/useLibrary'
import { clipMenuItems } from '@/composables/useClipMenu'
import { cancelExport, dismissExport } from '@/composables/useExports'
import { cancelUpload, uploadByClip } from '@/composables/useUploads'
import { staggerIn, type Rect } from '@/composables/useMotion'
import {
  current,
  openClip,
  source as playerSource,
  type PlayerSource,
} from '@/composables/usePlayer'

const props = withDefaults(
  defineProps<{
    sections: Section[]
    /** Anything that should restart the grid from the top with a fresh stagger. */
    resetKey: string
    /**
     * `export` grids carry the Clips view's menu and card treatment. `auto` picks
     * per card, for a grid holding both — each clip keeps the treatment it has
     * on its own screen.
     */
    variant?: 'recording' | 'export' | 'auto'
    /** Which list the player walks from here. Defaults to the one this variant stands for. */
    source?: PlayerSource
    /** Name the game on every card, not just on export cards — for grids that cross games. */
    showGame?: boolean
    /** Export jobs, keyed by id, for the `job:<id>` placeholder cards the Clips view mixes in. */
    jobsById?: Record<string, ExportJob>
  }>(),
  { variant: 'recording', source: undefined, showGame: false, jobsById: () => ({}) },
)

const JOB_PREFIX = 'job:'

const scroller = ref<HTMLElement | null>(null)
const gridSize = computed(() => settings.value.gridSize)
const { layout, visibleRows, scrollToTop, scrollToClip } = useVirtualGrid(
  scroller,
  toRef(props, 'sections'),
  gridSize,
)

const pad = `${GRID_PAD_X}px`
const from = computed<PlayerSource>(
  () => props.source ?? (props.variant === 'export' ? 'clips' : 'library'),
)

/** A card's treatment: fixed by the grid, or the one the clip's own screen gives it. */
const variantOf = (clip: Clip): 'recording' | 'export' =>
  props.variant === 'auto' ? (scopeOf(clip) === 'clips' ? 'export' : 'recording') : props.variant

async function animateIn(): Promise<void> {
  await nextTick()
  const cards = scroller.value ? Array.from(scroller.value.querySelectorAll('.clip-card')) : []
  staggerIn(cards)
}

watch(
  () => props.resetKey,
  () => {
    scrollToTop()
    void animateIn()
  },
)
onMounted(() => void animateIn())

// The grid keeps up with the player: stepping through clips with N/P scrolls
// the card into view underneath, so closing lands on it and you are where you
// left off rather than back at the top.
watch(current, (c) => {
  if (c && playerSource.value === from.value) scrollToClip(c.id)
})

// What is on screen goes to the front of the preview queue. Debounced past the
// scroll's own rAF, so a flick through the library reports where it stopped,
// not every row it passed.
const VISIBLE_REPORT_MS = 150
let visibleTimer = 0
watch(
  visibleRows,
  (rows) => {
    window.clearTimeout(visibleTimer)
    visibleTimer = window.setTimeout(() => {
      const ids: string[] = []
      for (const row of rows) {
        if (row.kind !== 'cards') continue
        for (const clip of row.clips) if (!clip.id.startsWith(JOB_PREFIX)) ids.push(clip.id)
      }
      reportVisibleClips(ids)
    }, VISIBLE_REPORT_MS)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  window.clearTimeout(visibleTimer)
  reportVisibleClips([])
})

const jobOf = (clip: Clip): ExportJob | undefined =>
  clip.id.startsWith(JOB_PREFIX) ? props.jobsById[clip.id.slice(JOB_PREFIX.length)] : undefined

function onOpen(clip: Clip, rect: DOMRect): void {
  openClip(
    clip,
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    from.value,
  )
}

function rectOf(clip: Clip): Rect | null {
  const el = scroller.value?.querySelector(`[data-clip-id="${clip.id}"] .thumb`)
  return el ? el.getBoundingClientRect() : null
}

/** A card's actions: the same list behind its right-click and its ⋯ button. */
const menuItems = (clip: Clip) =>
  clipMenuItems(clip, { variant: variantOf(clip), from: from.value, job: jobOf(clip), rectOf })
</script>

<template>
  <div ref="scroller" class="scroller">
    <div class="canvas" :style="{ height: `${layout.total}px` }">
      <template v-for="row in visibleRows" :key="row.key">
        <div
          v-if="row.kind === 'header'"
          class="row-header"
          :style="{ transform: `translateY(${row.top}px)`, left: pad, right: pad }"
        >
          <h2>{{ row.title }}</h2>
          <UBadge color="primary" variant="soft" size="md" :label="row.count" />
          <span class="rule" />
        </div>
        <div
          v-else
          class="row-cards"
          :style="{
            transform: `translateY(${row.top}px)`,
            left: pad,
            gridTemplateColumns: `repeat(${layout.cols}, ${row.cardWidth}px)`,
          }"
        >
          <UContextMenu
            v-for="clip in row.clips"
            :key="clip.id"
            :items="menuItems(clip)"
            :ui="{ content: 'min-w-52' }"
          >
            <ClipCard
              :clip="clip"
              :variant="variantOf(clip)"
              :show-game="showGame"
              :job="jobOf(clip)"
              :menu="menuItems(clip)"
              :upload="uploadByClip[clip.id]"
              :pending="pendingByClip[clip.id]"
              @open="onOpen"
              @cancel-upload="(id) => void cancelUpload(id)"
              @cancel-job="(id) => void cancelExport(id)"
              @dismiss-job="dismissExport"
            />
          </UContextMenu>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}
.canvas {
  position: relative;
  width: 100%;
}
.row-header,
.row-cards {
  position: absolute;
  top: 0;
  will-change: transform;
}
.row-header {
  display: flex;
  align-items: center;
  gap: 10px;
  /* Keep in step with HEADER_H in useVirtualGrid. */
  height: 56px;
  padding-top: 14px;
}
.row-header h2 {
  font-size: var(--text-lg);
  font-weight: 600;
  letter-spacing: 0.02em;
}
.rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--border-hover), transparent);
}
.row-cards {
  display: grid;
  column-gap: 18px;
}
</style>
