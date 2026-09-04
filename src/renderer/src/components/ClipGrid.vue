<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRef, watch } from 'vue'
import type { Clip, ExportJob } from '@shared/types'
import ClipCard from './ClipCard.vue'
import { GRID_PAD_X, useVirtualGrid } from '@/composables/useVirtualGrid'
import {
  copyClipPath,
  deleteClip,
  games,
  getClip,
  openGame,
  renameClip,
  revealClip,
  settings,
  type Section,
} from '@/composables/useLibrary'
import { cancelExport, dismissExport } from '@/composables/useExports'
import { staggerIn, type Rect } from '@/composables/useMotion'
import { openClip, openSource } from '@/composables/usePlayer'
import { confirmWithAlt, prompt } from '@/composables/useDialogs'
import { toast } from '@/composables/useToasts'

const props = withDefaults(
  defineProps<{
    sections: Section[]
    /** Anything that should restart the grid from the top with a fresh stagger. */
    resetKey: string
    /** `export` grids carry the Clips view's menu and card treatment. */
    variant?: 'recording' | 'export'
    /** Export jobs, keyed by id, for the `job:<id>` placeholder cards the Clips view mixes in. */
    jobsById?: Record<string, ExportJob>
  }>(),
  { variant: 'recording', jobsById: () => ({}) },
)

const JOB_PREFIX = 'job:'

const scroller = ref<HTMLElement | null>(null)
const gridSize = computed(() => settings.value.gridSize)
const { layout, visibleRows, scrollToTop } = useVirtualGrid(
  scroller,
  toRef(props, 'sections'),
  gridSize,
)

const pad = `${GRID_PAD_X}px`
const from = computed(() => (props.variant === 'export' ? 'clips' : 'library'))

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

async function rename(clip: Clip): Promise<void> {
  const name = await prompt({
    title: 'Rename clip',
    label: 'File name',
    value: clip.name,
    confirmLabel: 'Rename',
  })
  if (name?.trim() && name !== clip.name) await renameClip(clip, name)
}

async function remove(clip: Clip): Promise<void> {
  const choice = await confirmWithAlt({
    title: 'Delete this clip?',
    message:
      'It goes to the Recycle Bin, so you can still restore it from there. Deleting permanently erases the file from disk right away.',
    detail: clip.name + clip.ext,
    detailIcon: 'i-lucide-file-video',
    confirmLabel: 'Delete',
    danger: true,
    alt: { label: 'Delete permanently', danger: true },
  })
  if (choice !== 'cancel') await deleteClip(clip, choice === 'alt')
}

function showSource(clip: Clip): void {
  if (!openSource(clip))
    toast(
      'error',
      'Source not found',
      'The recording this clip was cut from is no longer in the library.',
    )
}

/** Right-click menu per card, rendered by Nuxt UI's <UContextMenu>. */
function menuItems(clip: Clip) {
  const job = jobOf(clip)
  if (job) {
    const active = job.state === 'queued' || job.state === 'running'
    return [
      [
        active
          ? {
              label: 'Cancel export',
              icon: 'i-lucide-x',
              color: 'error' as const,
              onSelect: () => void cancelExport(job.id),
            }
          : { label: 'Dismiss', icon: 'i-lucide-x', onSelect: () => dismissExport(job.id) },
      ],
    ]
  }
  const trim = {
    label: 'Trim & export',
    icon: 'i-lucide-scissors',
    disabled: clip.probeState !== 'ok' || !clip.duration,
    onSelect: () => openClip(clip, rectOf(clip), from.value, true),
  }
  const main = [
    {
      label: 'Play',
      icon: 'i-lucide-play',
      onSelect: () => openClip(clip, rectOf(clip), from.value),
    },
    trim,
  ]
  if (props.variant === 'export') {
    main.push(
      {
        label: 'Open source recording',
        icon: 'i-lucide-link',
        disabled: !clip.sourceId || !getClip(clip.sourceId),
        onSelect: () => showSource(clip),
      },
      {
        label: 'Go to game',
        icon: 'i-lucide-gamepad-2',
        disabled: !games.value.some((g) => g.name === clip.game),
        onSelect: () => openGame(clip.game),
      },
    )
  }
  main.push(
    { label: 'Show in Explorer', icon: 'i-lucide-folder-open', onSelect: () => revealClip(clip) },
    { label: 'Copy path', icon: 'i-lucide-copy', onSelect: () => void copyClipPath(clip) },
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => void rename(clip) },
  )
  return [
    main,
    [
      {
        label: 'Delete',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => void remove(clip),
      },
    ],
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
            gridTemplateColumns: `repeat(${layout.cols}, ${row.cardWidth}px)`,
          }"
        >
          <UContextMenu
            v-for="clip in row.clips"
            :key="clip.id"
            :items="menuItems(clip)"
            :ui="{ content: 'min-w-48' }"
          >
            <ClipCard :clip="clip" :variant="variant" :job="jobOf(clip)" @open="onOpen" />
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
