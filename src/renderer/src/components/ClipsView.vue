<script setup lang="ts">
import { exportJobs, jobsById } from '@/composables/useExports'
import {
  chooseClipsDir,
  clipSections,
  clipsFolder,
  clipsStats,
  exportedClips,
  goGames,
  revealClipsDir,
  settings,
  updateSettings,
  type Section
} from '@/composables/useLibrary'
import { motionEnabled } from '@/composables/useMotion'
import { formatBytes, formatDuration } from '@/utils/format'
import type { Clip, ExportJob, GridSize } from '@shared/types'
import { computed } from 'vue'
import ClipGrid from './ClipGrid.vue'
import CountUp from './bits/CountUp.vue'
import SplitText from './bits/SplitText.vue'

const sizeOptions: Array<{ value: GridSize; icon: string; label: string }> = [
  { value: 'large', icon: 'i-lucide-grid-2x2', label: 'Large cards' },
  { value: 'comfortable', icon: 'i-lucide-layout-grid', label: 'Comfortable cards' },
  { value: 'compact', icon: 'i-lucide-grid-3x3', label: 'Compact cards' }
]

/** A job's stand-in card until the real clip arrives through `clips:added`. */
function placeholder(job: ExportJob): Clip {
  return {
    id: `job:${job.id}`,
    path: '',
    name: job.name,
    title: job.name,
    ext: job.ext,
    folderId: '',
    game: job.game,
    size: 0,
    mtimeMs: 0,
    recordedAtMs: job.createdAtMs,
    duration: job.end - job.start,
    width: 0,
    height: 0,
    fps: 0,
    vcodec: '',
    hasAudio: !job.muted,
    thumb: job.sourceThumb,
    sprite: '',
    spriteFrames: 0,
    probeState: 'pending',
    sourceId: job.sourceId,
    trimStart: job.start,
    trimEnd: job.end,
    muted: job.muted,
    createdAtMs: job.createdAtMs
  }
}

/** Live and failed jobs lead their game's section; finished ones are already real clips. */
const sectionsWithJobs = computed<Section[]>(() => {
  const jobs = exportJobs.value.filter((j) => j.state !== 'done')
  if (!jobs.length) return clipSections.value
  const out = clipSections.value.map((s) => ({ ...s, clips: s.clips.slice() }))
  for (const job of [...jobs].reverse()) {
    const key = `g:${job.game}`
    let section = out.find((s) => s.key === key)
    if (!section) {
      section = { key, title: job.game, clips: [] }
      out.unshift(section)
    }
    section.clips.unshift(placeholder(job))
  }
  return out
})

const hasContent = computed(() => sectionsWithJobs.value.length > 0)
const unreachable = computed(() => Boolean(clipsFolder.value && !clipsFolder.value.available && exportedClips.value.length))
const resetKey = computed(() => settings.value.gridSize)
</script>

<template>
  <section class="view">
    <header class="head">
      <div class="head-text">
        <SplitText
          v-if="motionEnabled"
          text="Clips"
          tag="h1"
          class-name="title"
          split-type="chars"
          :delay="18"
          :duration="0.55"
          ease="power3.out"
          :from="{ opacity: 0, y: 22 }"
          :to="{ opacity: 1, y: 0 }"
          text-align="left"
          immediate
        />
        <h1 v-else class="title">Clips</h1>

        <p v-if="clipsStats.count" class="stats">
          <span>
            <CountUp v-if="motionEnabled" :to="clipsStats.count" :duration="0.9" /><template v-else>{{ clipsStats.count }}</template>
            clip{{ clipsStats.count === 1 ? '' : 's' }}
          </span>
          <span class="dot">·</span>
          <span class="mono">{{ formatDuration(clipsStats.duration) }}</span>
          <span class="dot">·</span>
          <span>{{ formatBytes(clipsStats.size) }}</span>
        </p>
        <p v-else class="stats">Nothing exported yet</p>
      </div>

      <div class="toolbar">
        <UFieldGroup size="md" aria-label="Card size">
          <UTooltip v-for="s in sizeOptions" :key="s.value" :text="s.label">
            <UButton
              :icon="s.icon"
              square
              :color="settings.gridSize === s.value ? 'primary' : 'neutral'"
              :variant="settings.gridSize === s.value ? 'soft' : 'subtle'"
              :aria-pressed="settings.gridSize === s.value"
              :aria-label="s.label"
              @click="updateSettings({ gridSize: s.value })"
            />
          </UTooltip>
        </UFieldGroup>

        <UTooltip :text="clipsFolder?.path ?? ''">
          <UButton
            icon="i-lucide-folder-open"
            label="Open folder"
            color="primary"
            size="lg"
            :disabled="!clipsFolder?.available"
            @click="revealClipsDir()"
          />
        </UTooltip>
      </div>
    </header>

    <UAlert
      v-if="unreachable"
      class="warn"
      icon="i-lucide-triangle-alert"
      color="warning"
      variant="subtle"
      title="Clips folder not reachable"
      :description="`${clipsFolder?.path} is not available right now. Clips are kept in the list, but they cannot be played or exported to until it is back.`"
      :actions="[{ label: 'Change folder…', icon: 'i-lucide-folder-search', color: 'neutral', variant: 'subtle', onClick: () => chooseClipsDir() }]"
    />

    <ClipGrid v-if="hasContent" :sections="sectionsWithJobs" variant="export" :jobs-by-id="jobsById" :reset-key="resetKey" />

    <UEmpty
      v-else
      class="empty"
      icon="i-lucide-scissors"
      title="No clips yet"
      :description="`Open a recording, press E to trim it, and export. Clips land in ${clipsFolder?.path ?? 'your clips folder'} and show up here, grouped by game.`"
    >
      <template #actions>
        <UButton icon="i-lucide-gamepad-2" label="Browse games" color="primary" size="lg" @click="goGames()" />
      </template>
    </UEmpty>
  </section>
</template>

<style scoped>
.view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 28px 18px;
}
.head-text {
  min-width: 0;
}
.title {
  display: block;
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: 0.01em;
  overflow: hidden;
  white-space: nowrap;
  max-width: 100%;
}
.stats {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}
.dot {
  color: var(--fg-dim);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.warn {
  margin: 0 28px var(--s-4);
}
/* No colour here: it would cascade into the actions, and Nuxt UI's own text
   utilities cannot override an inherited colour on a button (see base.css).
   UEmpty already dims its description on its own. */
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px;
  text-align: center;
}
</style>
