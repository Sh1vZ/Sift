<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ClipGrid from './ClipGrid.vue'
import LibraryToolbar from './LibraryToolbar.vue'
import CountUp from './bits/CountUp.vue'
import SplitText from './bits/SplitText.vue'
import {
  clearFilters,
  favourites,
  favouriteSections,
  favouriteSort,
  favouritesFilters,
  favouriteStats,
  goGames,
  orderedFavourites,
  settings,
} from '@/composables/useLibrary'
import { motionEnabled } from '@/composables/useMotion'
import { registerSearch } from '@/composables/useShortcuts'
import { formatBytes, formatDuration } from '@/utils/format'

/**
 * Everything hearted, from every game, in one flat run — recordings, exported
 * clips and screenshots together. The other two screens are organised by where
 * a file came from; this one is organised by the only thing its contents have
 * in common, so grouping it would undo the point.
 */
const filters = favouritesFilters

/** Names whichever filter emptied the grid, so the empty state is actionable. */
const filteredTitle = computed(() => {
  if (filters.unwatched) return "You've watched every favourite"
  if (filters.kind === 'image') return 'No favourite screenshots'
  if (filters.kind === 'video') return 'No favourite videos'
  return filters.share === 'shared'
    ? 'No favourites on YouTube yet'
    : 'Every favourite is on YouTube'
})

const hasContent = computed(() => favouriteSections.value.length > 0)
const resetKey = computed(
  () =>
    `${settings.value.gridSize}|${favouriteSort.value}|${filters.share}|${filters.kind}|${filters.unwatched}|${filters.query}`,
)
/** Favourites exist, but a filter hides all of them. */
const filteredOut = computed(() => !hasContent.value && favourites.value.length > 0)
/** The name filter or another filter is hiding some of them. */
const narrowed = computed(() => orderedFavourites.value.length !== favourites.value.length)

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
            text="Favourites"
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
          <h1 v-else class="title">Favourites</h1>

          <div class="stats-slot">
            <Transition name="dissolve">
              <p v-if="favouriteStats.count" key="totals" class="stats">
                <span>
                  <template v-if="narrowed">{{ orderedFavourites.length }} of </template>
                  <CountUp
                    v-if="motionEnabled"
                    :to="favouriteStats.count"
                    :duration="0.9"
                  /><template v-else>{{ favouriteStats.count }}</template> item{{
                    favouriteStats.count === 1 ? '' : 's'
                  }}
                </span>
                <template v-if="favouriteStats.duration">
                  <span class="dot">·</span>
                  <span class="mono">{{ formatDuration(favouriteStats.duration) }}</span>
                </template>
                <span class="dot">·</span>
                <span>{{ formatBytes(favouriteStats.size) }}</span>
              </p>
              <p v-else key="none" class="stats">Nothing favourited yet</p>
            </Transition>
          </div>
        </div>
      </div>

      <Transition name="fade">
        <div v-if="favourites.length" class="tools-row">
          <LibraryToolbar ref="toolbar" scope="favourites" />
        </div>
      </Transition>
    </header>

    <!-- Grid and empty state occupy the same box and cross-fade, so hearting the
         first clip (or unhearting the last) is a dissolve, not a snap. -->
    <div class="stage">
      <Transition name="crossfade">
        <ClipGrid
          v-if="hasContent"
          key="grid"
          :sections="favouriteSections"
          variant="auto"
          source="favourites"
          show-game
          :reset-key="resetKey"
        />

        <!-- The name filter hid everything: say so, ahead of the other filters. -->
        <UEmpty
          v-else-if="filteredOut && filters.query"
          key="nomatch"
          class="empty"
          icon="i-lucide-search-x"
          :title="`Nothing favourited matches “${filters.query}”`"
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
          description="Clear the filter to see the rest of your favourites."
        >
          <template #actions>
            <UButton label="Show all" color="primary" @click="clearFilters('favourites')" />
          </template>
        </UEmpty>

        <UEmpty
          v-else
          key="empty"
          class="empty"
          icon="i-lucide-heart"
          title="Nothing favourited yet"
          description="Hover any clip or screenshot and hit the heart — or press S while it is open — and it lands here, whichever game it came from."
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
