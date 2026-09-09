<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Clip, ExportJob } from '@shared/types'
import ClipGrid from './ClipGrid.vue'
import GameFilter from './GameFilter.vue'
import LibraryToolbar from './LibraryToolbar.vue'
import CountUp from './bits/CountUp.vue'
import SplitText from './bits/SplitText.vue'
import { exportJobs, jobsById } from '@/composables/useExports'
import {
  chooseClipsDir,
  clearFilters,
  clipSections,
  clipsFilters,
  clipsFolder,
  clipsStats,
  exportedClips,
  exportGames,
  exportGroupBy,
  exportSort,
  goGames,
  orderedExports,
  revealClipsDir,
  settings,
  type Section,
} from '@/composables/useLibrary'
import { motionEnabled } from '@/composables/useMotion'
import { registerSearch } from '@/composables/useShortcuts'
import { formatBytes, formatDuration } from '@/utils/format'

const filters = clipsFilters

/** "from Apex Legends", for the empty states, while the game rail narrows the grid. */
const where = computed(() => {
  const g = filters.games
  return g.length === 1 ? ` from ${g[0]}` : g.length ? ' from those games' : ''
})

/** Names whichever filter emptied the grid, so the empty state is actionable. */
const filteredTitle = computed(() => {
  if (filters.favourites && filters.unwatched) return `No unwatched favourites${where.value}`
  if (filters.favourites) return `No favourite clips${where.value} yet`
  if (filters.unwatched) return `You've watched every clip${where.value}`
  if (filters.share === 'shared') return `No clips${where.value} on YouTube yet`
  if (filters.share === 'unshared') return `Every clip${where.value} is on YouTube`
  return `No clips${where.value}`
})

/** A job's stand-in card until the real clip arrives through `clips:added`. */
function placeholder(job: ExportJob): Clip {
  return {
    id: `job:${job.id}`,
    path: '',
    name: job.name,
    title: job.name,
    ext: job.ext,
    kind: 'video',
    folderId: '',
    game: job.game,
    sourceGame: job.game,
    size: 0,
    mtimeMs: 0,
    recordedAtMs: job.createdAtMs,
    duration: job.end - job.start,
    width: 0,
    height: 0,
    fps: 0,
    vcodec: '',
    hdr: false,
    hasAudio: !job.muted,
    audioTracks: [],
    thumb: job.sourceThumb,
    sprite: '',
    spriteFrames: 0,
    render: '',
    probeState: 'pending',
    sourceId: job.sourceId,
    trimStart: job.start,
    trimEnd: job.end,
    muted: job.muted,
    createdAtMs: job.createdAtMs,
    youtubeId: '',
    youtubeAccountId: '',
    youtubeStage: '',
    youtubeReason: '',
    youtubeCheckedAtMs: 0,
    youtubeWatchUntilMs: 0,
    favourite: false,
    seenAtMs: 0,
  }
}

/**
 * Live and failed jobs lead their game's section, or the grid when there are
 * no game headers; finished ones are already real clips. A job for a game the
 * rail has filtered out stays off the grid with the rest of that game.
 */
const sectionsWithJobs = computed<Section[]>(() => {
  const wanted = filters.games
  const jobs = exportJobs.value.filter(
    (j) => j.state !== 'done' && (!wanted.length || wanted.includes(j.game)),
  )
  if (!jobs.length) return clipSections.value
  const out = clipSections.value.map((s) => ({ ...s, clips: s.clips.slice() }))
  const byGame = exportGroupBy.value === 'game'
  for (const job of [...jobs].reverse()) {
    const key = byGame ? `g:${job.game}` : (out[0]?.key ?? 'all')
    let section = out.find((s) => s.key === key)
    if (!section) {
      section = { key, title: byGame ? job.game : null, clips: [] }
      out.unshift(section)
    }
    section.clips.unshift(placeholder(job))
  }
  return out
})

const hasContent = computed(() => sectionsWithJobs.value.length > 0)
const unreachable = computed(() =>
  Boolean(clipsFolder.value && !clipsFolder.value.available && exportedClips.value.length),
)
const resetKey = computed(
  () =>
    `${settings.value.gridSize}|${exportSort.value}|${exportGroupBy.value}|${filters.share}|${filters.favourites}|${filters.unwatched}|${filters.games.join(',')}|${filters.query}`,
)
/** Exports exist, but a filter hides all of them. */
const filteredOut = computed(() => !hasContent.value && exportedClips.value.length > 0)
/** The name filter or another filter is hiding some exports. */
const narrowed = computed(() => orderedExports.value.length !== exportedClips.value.length)

// `/` and Ctrl+F land in the toolbar's filter while this view is up.
const toolbar = ref<{ focus: () => void } | null>(null)
let offSearch: (() => void) | null = null
onMounted(() => {
  offSearch = registerSearch(() => toolbar.value?.focus())
})
onBeforeUnmount(() => offSearch?.())
</script>

<template>
  <section class="view">
    <header class="head">
      <div class="title-row">
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

          <div class="stats-slot">
            <Transition name="dissolve">
              <p v-if="clipsStats.count" key="totals" class="stats">
                <span>
                  <template v-if="narrowed">{{ orderedExports.length }} of </template>
                  <CountUp v-if="motionEnabled" :to="clipsStats.count" :duration="0.9" /><template
                    v-else
                    >{{ clipsStats.count }}</template
                  >
                  clip{{ clipsStats.count === 1 ? '' : 's' }}
                </span>
                <span class="dot">·</span>
                <span class="mono">{{ formatDuration(clipsStats.duration) }}</span>
                <span class="dot">·</span>
                <span>{{ formatBytes(clipsStats.size) }}</span>
              </p>
              <p v-else key="none" class="stats">No clips exported yet</p>
            </Transition>
          </div>
        </div>

        <UTooltip :text="clipsFolder?.path ?? ''">
          <UButton
            icon="i-lucide-folder-open"
            label="Open folder"
            color="neutral"
            variant="subtle"
            :disabled="!clipsFolder?.available"
            @click="revealClipsDir()"
          />
        </UTooltip>
      </div>

      <Transition name="fade">
        <div v-if="exportedClips.length" class="tools-row">
          <LibraryToolbar ref="toolbar" scope="clips" />
        </div>
      </Transition>

      <!-- Only once there is a choice to make: one game's exports need no rail. -->
      <Transition name="fade">
        <GameFilter v-if="exportGames.length > 1" scope="clips" />
      </Transition>
    </header>

    <Transition name="collapse">
      <div v-if="unreachable">
        <div class="collapse-body">
          <UAlert
            class="warn"
            icon="i-lucide-triangle-alert"
            color="warning"
            variant="subtle"
            title="Clips folder not reachable"
            :description="`${clipsFolder?.path} is not available right now. Clips are kept in the list, but they cannot be played or exported to until it is back.`"
            :actions="[
              {
                label: 'Change folder…',
                icon: 'i-lucide-folder-search',
                color: 'neutral',
                variant: 'subtle',
                onClick: () => chooseClipsDir(),
              },
            ]"
          />
        </div>
      </div>
    </Transition>

    <!-- Grid and empty state occupy the same box and cross-fade, so exporting the
         first clip (or deleting the last one) is a dissolve, not a snap. -->
    <div class="stage">
      <Transition name="crossfade">
        <ClipGrid
          v-if="hasContent"
          key="grid"
          :sections="sectionsWithJobs"
          variant="export"
          :jobs-by-id="jobsById"
          :reset-key="resetKey"
        />

        <!-- The name filter hid every export: say so, ahead of the other filters. -->
        <UEmpty
          v-else-if="filteredOut && filters.query"
          key="nomatch"
          class="empty"
          icon="i-lucide-search-x"
          :title="`No clips${where} match “${filters.query}”`"
          description="Try a shorter name — the filter also ignores spaces and punctuation."
        >
          <template #actions>
            <UButton
              label="Clear filter"
              color="neutral"
              variant="subtle"
              @click="filters.query = ''"
            />
          </template>
        </UEmpty>

        <UEmpty
          v-else-if="filteredOut"
          key="filtered"
          class="empty"
          icon="i-lucide-filter-x"
          :title="filteredTitle"
          :description="
            filters.favourites || filters.unwatched || filters.games.length
              ? 'Clear the filter to see the rest of your clips.'
              : 'The sharing filter is hiding the rest.'
          "
        >
          <template #actions>
            <UButton label="Show all" color="primary" @click="clearFilters('clips')" />
          </template>
        </UEmpty>

        <UEmpty
          v-else
          key="empty"
          class="empty"
          icon="i-lucide-scissors"
          title="No clips exported yet"
          :description="`Trim any recording — press E in the player — and export it. Clips land in ${clipsFolder?.path ?? 'your clips folder'} and show up here, grouped by game.`"
        >
          <template #actions>
            <UButton
              icon="i-lucide-gamepad-2"
              label="Browse games"
              color="primary"
              @click="goGames()"
            />
          </template>
        </UEmpty>
      </Transition>
    </div>
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
  flex-direction: column;
  gap: var(--s-4);
  padding: 22px 28px 18px;
}
.title-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--s-4);
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
/* The gap lives on the slot, not on the line: the leaving line goes absolute
   mid-transition, where a margin would be dropped and shift it a few pixels. */
.stats-slot {
  position: relative;
  margin-top: 4px;
}
.stats {
  display: flex;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dot {
  color: var(--fg-dim);
}
.tools-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-3);
}
.warn {
  margin: 0 28px var(--s-4);
}
/* Holds the box both branches animate inside; without it the leaving one, which
   goes absolute mid-transition, would anchor to the window. */
.stage {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
/* No colour here: UEmpty already dims its description on its own. */
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
