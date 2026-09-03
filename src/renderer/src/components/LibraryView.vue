<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import type { GridSize, GroupBy, SortBy } from '@shared/types'
import Icon from './Icon.vue'
import ClipGrid from './ClipGrid.vue'
import GamesBrowser from './GamesBrowser.vue'
import BlurText from './bits/BlurText.vue'
import CountUp from './bits/CountUp.vue'
import Folder from './bits/Folder.vue'
import SplitText from './bits/SplitText.vue'
import StarBorder from './bits/StarBorder.vue'
import {
  addFolder,
  allClips,
  folders,
  games,
  goGames,
  gridGroupBy,
  libraryStats,
  rescan,
  scan,
  screen,
  selectedGame,
  settings,
  updateSettings,
  visibleClips
} from '@/composables/useLibrary'
import { motionEnabled } from '@/composables/useMotion'
import { activeTheme } from '@/composables/useTheme'
import { formatBytes, formatDuration } from '@/utils/format'

// The WebGL aurora (and its ogl dependency) only loads when the empty state is actually shown.
const Aurora = defineAsyncComponent(() => import('./bits/Aurora.vue'))

const hasFolders = computed(() => folders.value.length > 0)
const inGame = computed(() => screen.value === 'game')
const title = computed(() => (inGame.value ? (selectedGame.value ?? '') : 'Games'))

const groupOptions: Array<{ value: GroupBy; label: string; icon: string }> = [
  { value: 'date', label: 'Date', icon: 'i-lucide-calendar' },
  { value: 'none', label: 'None', icon: 'i-lucide-layout-grid' }
]
const sizeOptions: Array<{ value: GridSize; icon: string; label: string }> = [
  { value: 'large', icon: 'i-lucide-grid-2x2', label: 'Large cards' },
  { value: 'comfortable', icon: 'i-lucide-layout-grid', label: 'Comfortable cards' },
  { value: 'compact', icon: 'i-lucide-grid-3x3', label: 'Compact cards' }
]
const sortOptions: Array<{ value: SortBy; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name' },
  { value: 'duration', label: 'Longest' },
  { value: 'size', label: 'Largest' }
]

const sortModel = computed({
  get: () => settings.value.sort,
  set: (v: SortBy) => void updateSettings({ sort: v })
})
</script>

<template>
  <section class="view">
    <header class="head">
      <div class="head-text">
        <Transition name="fade">
          <UButton
            v-if="inGame"
            class="back"
            icon="i-lucide-chevron-left"
            label="Games"
            color="primary"
            variant="link"
            size="xs"
            @click="goGames"
          />
        </Transition>
        <SplitText
          v-if="motionEnabled"
          :text="title"
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
        <h1 v-else class="title">{{ title }}</h1>

        <p v-if="inGame && libraryStats.count" class="stats">
          <span>
            <CountUp v-if="motionEnabled" :to="libraryStats.count" :duration="0.9" /><template v-else>{{ libraryStats.count }}</template>
            clip{{ libraryStats.count === 1 ? '' : 's' }}
          </span>
          <span class="dot">·</span>
          <span class="mono">{{ formatDuration(libraryStats.duration) }}</span>
          <span class="dot">·</span>
          <span>{{ formatBytes(libraryStats.size) }}</span>
        </p>
        <p v-else-if="!inGame && games.length" class="stats">
          <span>
            <CountUp v-if="motionEnabled" :to="games.length" :duration="0.9" /><template v-else>{{ games.length }}</template>
            game{{ games.length === 1 ? '' : 's' }}
          </span>
          <span class="dot">·</span>
          <span>
            <CountUp v-if="motionEnabled" :to="allClips.length" :duration="0.9" /><template v-else>{{ allClips.length }}</template>
            clip{{ allClips.length === 1 ? '' : 's' }}
          </span>
        </p>
        <p v-else class="stats">Nothing here yet</p>
      </div>

      <div v-if="hasFolders" class="toolbar">
        <template v-if="inGame">
          <UFieldGroup size="md" aria-label="Group clips by">
            <UButton
              v-for="g in groupOptions"
              :key="g.value"
              :icon="g.icon"
              :label="g.label"
              :color="gridGroupBy === g.value ? 'primary' : 'neutral'"
              :variant="gridGroupBy === g.value ? 'soft' : 'subtle'"
              :aria-pressed="gridGroupBy === g.value"
              @click="updateSettings({ groupBy: g.value })"
            />
          </UFieldGroup>

          <USelect v-model="sortModel" :items="sortOptions" size="md" icon="i-lucide-arrow-up-down" class="w-44" aria-label="Sort clips" />

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
        </template>

        <UTooltip text="Rescan folders">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            square
            size="lg"
            :loading="scan.active"
            aria-label="Rescan folders"
            @click="rescan()"
          />
        </UTooltip>
        <UButton icon="i-lucide-folder-plus" label="Add folder" color="primary" size="lg" @click="addFolder()" />
      </div>
    </header>

    <ClipGrid v-if="inGame && visibleClips.length" />

    <GamesBrowser v-else-if="!inGame && games.length" />

    <div v-else-if="!hasFolders" class="empty hero">
      <div v-if="motionEnabled" class="hero-bg" aria-hidden="true">
        <Aurora :color-stops="[activeTheme.colors.bg1, activeTheme.colors.primary, activeTheme.colors.accent]" :amplitude="1.1" :blend="0.6" :speed="0.6" />
      </div>

      <div class="hero-folder" role="button" tabindex="0" aria-label="Choose a folder" @click="addFolder()" @keydown.enter="addFolder()">
        <Folder :color="activeTheme.colors.primary" :size="1.5" :items="['', '', '']">
          <template #item-1><span class="paper p1" /></template>
          <template #item-2><span class="paper p2" /></template>
          <template #item-3><span class="paper p3" /></template>
        </Folder>
      </div>

      <BlurText
        v-if="motionEnabled"
        text="Your clips, in one place"
        tag="h2"
        class-name="hero-title"
        :delay="80"
        :step-duration="0.26"
      />
      <h2 v-else class="hero-title">Your clips, in one place</h2>
      <p>
        Point Sift at the folder ShadowPlay (or any recorder) saves to. Nothing is copied or
        moved — clips are indexed where they live and new ones show up automatically.
      </p>
      <div class="hero-actions">
        <StarBorder as="button" class="star-btn" color="#c4b5fd" speed="5s" :thickness="2" @click="addFolder()">
          <Icon name="folder-plus" :size="16" />
          Choose a folder
        </StarBorder>
      </div>
    </div>

    <UEmpty
      v-else
      class="empty"
      :icon="scan.active ? 'i-lucide-loader-circle' : 'i-lucide-radar'"
      :title="scan.active ? 'Scanning for clips…' : 'No clips found'"
      :description="
        scan.active
          ? `Looking through ${scan.folder}. Games appear as clips are found.`
          : 'No videos in your folders yet. Record something, or add another folder — new files are picked up the moment they finish writing.'
      "
      :ui="{ icon: scan.active ? 'animate-spin' : '' }"
    />
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
.back {
  margin: 0 0 4px -6px;
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
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px;
  text-align: center;
  color: var(--fg-muted);
}
.empty p {
  max-width: 440px;
  line-height: 1.55;
}
.hero {
  position: relative;
  overflow: hidden;
}
.hero-bg {
  position: absolute;
  inset: 0;
  opacity: 0.55;
  pointer-events: none;
  mask-image: linear-gradient(to bottom, black 30%, transparent 92%);
}
.hero-folder {
  position: relative;
  z-index: 1;
  padding: 44px 0 34px;
  cursor: pointer;
  border-radius: var(--r-lg);
  filter: drop-shadow(0 18px 30px color-mix(in srgb, var(--primary) 45%, transparent));
}
.paper {
  display: block;
  width: 100%;
  height: 100%;
}
.p1 {
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, white));
}
.p2 {
  background: linear-gradient(135deg, #34d399, #6ee7b7);
}
.p3 {
  background: linear-gradient(135deg, var(--secondary), color-mix(in srgb, var(--secondary) 70%, white));
}
.hero-title {
  position: relative;
  z-index: 1;
  justify-content: center;
  color: var(--fg);
  font-family: var(--font-heading);
  font-size: var(--text-xl);
  font-weight: 600;
}
.hero p,
.hero-actions {
  position: relative;
  z-index: 1;
}
.hero-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 12px;
}
/* StarBorder ships its own dark inner pill; restyle it as our primary button. */
.star-btn {
  cursor: pointer;
}
.star-btn :deep(.star-inner) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 22px;
  border-radius: 18px;
  background: linear-gradient(135deg, var(--primary-hover), var(--primary));
  border-color: color-mix(in srgb, var(--secondary) 45%, transparent);
  color: var(--on-primary);
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: var(--text-sm);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
</style>
