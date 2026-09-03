<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Clip } from '@shared/types'
import ClipCard from './ClipCard.vue'
import { GRID_PAD_X, useVirtualGrid } from '@/composables/useVirtualGrid'
import { deleteClip, renameClip, revealClip, sections, selectedGame, settings } from '@/composables/useLibrary'
import { staggerIn, type Rect } from '@/composables/useMotion'
import { openClip } from '@/composables/usePlayer'
import { confirm, prompt } from '@/composables/useDialogs'

const scroller = ref<HTMLElement | null>(null)
const gridSize = computed(() => settings.value.gridSize)
const { layout, visibleRows, scrollToTop } = useVirtualGrid(scroller, sections, gridSize)

const pad = `${GRID_PAD_X}px`

// Filter/sort/group/size changes restart the view from the top with a stagger.
const resetKey = computed(
  () => `${selectedGame.value}|${settings.value.sort}|${settings.value.groupBy}|${settings.value.gridSize}`
)

async function animateIn(): Promise<void> {
  await nextTick()
  const cards = scroller.value ? Array.from(scroller.value.querySelectorAll('.clip-card')) : []
  staggerIn(cards)
}

watch(resetKey, () => {
  scrollToTop()
  void animateIn()
})
onMounted(() => void animateIn())

function onOpen(clip: Clip, rect: DOMRect): void {
  openClip(clip, { left: rect.left, top: rect.top, width: rect.width, height: rect.height })
}

function rectOf(clip: Clip): Rect | null {
  const el = scroller.value?.querySelector(`[data-clip-id="${clip.id}"] .thumb`)
  return el ? el.getBoundingClientRect() : null
}

async function rename(clip: Clip): Promise<void> {
  const name = await prompt({ title: 'Rename clip', label: 'File name', value: clip.name, confirmLabel: 'Rename' })
  if (name !== null && name.trim() && name !== clip.name) await renameClip(clip, name)
}

async function remove(clip: Clip): Promise<void> {
  const ok = await confirm({
    title: 'Delete this clip?',
    message: 'It goes to the Recycle Bin, so you can still restore it from there.',
    detail: clip.name + clip.ext,
    detailIcon: 'i-lucide-file-video',
    confirmLabel: 'Delete',
    danger: true
  })
  if (ok) await deleteClip(clip)
}

/** Right-click menu per card, rendered by Nuxt UI's <UContextMenu>. */
function menuItems(clip: Clip) {
  return [
    [
      { label: 'Play', icon: 'i-lucide-play', onSelect: () => openClip(clip, rectOf(clip)) },
      { label: 'Show in Explorer', icon: 'i-lucide-folder-open', onSelect: () => revealClip(clip) },
      { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => void rename(clip) }
    ],
    [{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => void remove(clip) }]
  ]
}
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
          <UBadge color="primary" variant="soft" size="sm" :label="row.count" />
          <span class="rule" />
        </div>
        <div
          v-else
          class="row-cards"
          :style="{
            transform: `translateY(${row.top}px)`,
            left: pad,
            gridTemplateColumns: `repeat(${layout.cols}, ${row.cardWidth}px)`
          }"
        >
          <UContextMenu v-for="clip in row.clips" :key="clip.id" :items="menuItems(clip)" :ui="{ content: 'min-w-48' }">
            <ClipCard :clip="clip" @open="onOpen" />
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
  height: 48px;
  padding-top: 10px;
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
