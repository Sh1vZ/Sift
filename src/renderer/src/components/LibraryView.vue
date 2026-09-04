<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import Icon from './Icon.vue'
import ClipGrid from './ClipGrid.vue'
import DropWash from './DropWash.vue'
import GamesBrowser from './GamesBrowser.vue'
import LibraryToolbar from './LibraryToolbar.vue'
import BlurText from './bits/BlurText.vue'
import CountUp from './bits/CountUp.vue'
import Folder from './bits/Folder.vue'
import SplitText from './bits/SplitText.vue'
import StarBorder from './bits/StarBorder.vue'
import {
  addFolder,
  clearFilters,
  filteredGames,
  folders,
  gameClipCount,
  gameQuery,
  games,
  gameSort,
  goBack,
  libraryFilters,
  libraryStats,
  recordings,
  rescan,
  scan,
  screen,
  sections,
  selectedGame,
  settings,
  suggestedFolders,
  visibleClips,
  type GameSort,
} from '@/composables/useLibrary'
import { useFolderDrop } from '@/composables/useDropFolders'
import { motionEnabled } from '@/composables/useMotion'
import { openSettings } from '@/composables/useSettings'
import { registerSearch } from '@/composables/useShortcuts'
import { activeTheme } from '@/composables/useTheme'
import { basename, formatBytes, formatDuration } from '@/utils/format'

// The WebGL aurora (and its ogl dependency) only loads when the empty state is actually shown.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- .vue modules are untyped to eslint; vue-tsc type-checks this
const Aurora = defineAsyncComponent(() => import('./bits/Aurora.vue'))

const hasFolders = computed(() => folders.value.some((f) => f.kind === 'library'))
const inGame = computed(() => screen.value === 'game')
const title = computed(() => (inGame.value ? (selectedGame.value ?? '') : 'Games'))
const filters = libraryFilters

// Filter/sort/group/size changes restart the grid from the top with a stagger.
const gridResetKey = computed(
  () =>
    `${selectedGame.value}|${settings.value.sort}|${settings.value.groupBy}|${settings.value.gridSize}|${filters.share}|${filters.favourites}|${filters.unwatched}|${filters.query}`,
)
/** A filter is hiding some of this game's clips. */
const narrowed = computed(() => inGame.value && libraryStats.value.count !== gameClipCount.value)
/** The games search is hiding some games. */
const gamesNarrowed = computed(() => filteredGames.value.length !== games.value.length)

const gameSortOptions: Array<{ label: string; value: GameSort; icon: string }> = [
  { label: 'Recent activity', value: 'recent', icon: 'i-lucide-clock' },
  { label: 'Name', value: 'name', icon: 'i-lucide-arrow-up-down' },
  { label: 'Most clips', value: 'count', icon: 'i-lucide-film' },
]

/** Names whichever filter emptied the grid, so the empty state is actionable. */
const filteredTitle = computed(() => {
  if (filters.favourites && filters.unwatched) return 'No unwatched favourites in this game'
  if (filters.favourites) return 'Nothing from this game is a favourite yet'
  if (filters.unwatched) return "You've watched everything in this game"
  return filters.share === 'shared'
    ? 'Nothing from this game is on YouTube yet'
    : 'Every clip of this game is on YouTube'
})

/** Library-level actions rare enough to sit behind one button beside Add folder. */
const libraryMenu = computed<DropdownMenuItem[]>(() => [
  {
    label: 'Rescan folders',
    icon: 'i-lucide-refresh-cw',
    disabled: scan.value.active,
    onSelect: () => void rescan(),
  },
  {
    label: 'Folder settings',
    icon: 'i-lucide-folder-cog',
    onSelect: () => openSettings('folders'),
  },
])

/** Library folders on a drive that is not there right now. Their clips stay listed. */
const unreachable = computed(() =>
  folders.value.filter((f) => f.kind === 'library' && !f.available),
)
const unreachableTitle = computed(() =>
  unreachable.value.length === 1
    ? `${unreachable.value[0].name} is not reachable`
    : `${unreachable.value.length} folders are not reachable`,
)
const unreachableText = computed(() =>
  unreachable.value.length === 1
    ? `${unreachable.value[0].path} is not available right now. Its clips stay in the library but cannot be played until the drive is back.`
    : 'They are not available right now. Their clips stay in the library but cannot be played until the drives are back.',
)

// ------------------------------------------------------------ search focus

// `/` and Ctrl+F land in the games search on the home screen and in the clip
// filter inside a game; one registration decides at press time.
const toolbar = ref<{ focus: () => void } | null>(null)
const gameSearch = ref<{ inputRef: HTMLInputElement | null } | null>(null)
let offSearch: (() => void) | null = null
onMounted(() => {
  offSearch = registerSearch(() => {
    if (inGame.value) toolbar.value?.focus()
    else gameSearch.value?.inputRef?.select()
  })
})
onBeforeUnmount(() => offSearch?.())

function onGameSearchKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && gameQuery.value) {
    gameQuery.value = ''
    e.stopPropagation()
  }
}

// ------------------------------------------------------------- drop zone

// The whole stage takes a dropped folder on the home screen and the hero; a
// game's grid does not, so a slip there cannot add a folder by accident.
const stageEl = ref<HTMLElement | null>(null)
const { dropping } = useFolderDrop(stageEl, () => !inGame.value)
</script>

<template>
  <section class="view">
    <!-- Two rows, the same grammar on every content screen: the title and its
         primary actions, then the tools for the list below. -->
    <header class="head">
      <div class="title-row">
        <div class="head-text">
          <UTooltip v-if="inGame" text="Back" :kbds="['backspace']">
            <UButton
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="ghost"
              square
              aria-label="Back"
              @click="goBack"
            />
          </UTooltip>

          <div class="title-block">
            <!-- Keyed on the title: SplitText splits its text once on mount, so
                 stepping into a game has to remount it or the header keeps
                 saying Games. -->
            <SplitText
              v-if="motionEnabled"
              :key="title"
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

            <!-- All three summaries share one box, so the first scan finishing (or a
                 step into a game) swaps the line in place instead of relaying the header. -->
            <div class="stats-slot">
              <Transition name="dissolve">
                <p v-if="inGame && gameClipCount" key="game" class="stats">
                  <span>
                    <CountUp
                      v-if="motionEnabled"
                      :to="libraryStats.count"
                      :duration="0.9"
                    /><template v-else>{{ libraryStats.count }}</template>
                    <template v-if="narrowed"> of {{ gameClipCount }}</template>
                    clip{{ gameClipCount === 1 ? '' : 's' }}
                  </span>
                  <span class="dot">·</span>
                  <span class="mono">{{ formatDuration(libraryStats.duration) }}</span>
                  <span class="dot">·</span>
                  <span>{{ formatBytes(libraryStats.size) }}</span>
                </p>
                <p v-else-if="!inGame && games.length" key="games" class="stats">
                  <span>
                    <template v-if="gamesNarrowed">{{ filteredGames.length }} of </template>
                    <CountUp v-if="motionEnabled" :to="games.length" :duration="0.9" /><template
                      v-else
                      >{{ games.length }}</template
                    >
                    game{{ games.length === 1 ? '' : 's' }}
                  </span>
                  <span class="dot">·</span>
                  <span>
                    <CountUp
                      v-if="motionEnabled"
                      :to="recordings.length"
                      :duration="0.9"
                    /><template v-else>{{ recordings.length }}</template> clip{{
                      recordings.length === 1 ? '' : 's'
                    }}
                  </span>
                </p>
                <p v-else key="none" class="stats">No games yet</p>
              </Transition>
            </div>
          </div>
        </div>

        <Transition name="fade">
          <div v-if="hasFolders && !inGame" class="head-actions">
            <UButton
              icon="i-lucide-folder-plus"
              label="Add folder"
              color="primary"
              size="xl"
              @click="addFolder()"
            />
            <UDropdownMenu
              :items="libraryMenu"
              :content="{ align: 'end' }"
              :ui="{ content: 'min-w-52' }"
            >
              <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                square
                size="xl"
                :loading="scan.active"
                aria-label="More library actions"
              />
            </UDropdownMenu>
          </div>
        </Transition>
      </div>

      <Transition name="fade">
        <div v-if="hasFolders && (inGame || games.length)" class="tools-row">
          <LibraryToolbar v-if="inGame" ref="toolbar" scope="library" />
          <template v-else>
            <UInput
              ref="gameSearch"
              v-model="gameQuery"
              class="game-search"
              icon="i-lucide-search"
              size="xl"
              placeholder="Search games…"
              autofocus
              spellcheck="false"
              autocomplete="off"
              aria-label="Search games"
              :ui="{ trailing: 'pe-1.5' }"
              @keydown="onGameSearchKey"
            >
              <template v-if="gameQuery" #trailing>
                <UButton
                  color="neutral"
                  variant="link"
                  size="sm"
                  icon="i-lucide-x"
                  aria-label="Clear search"
                  @click="gameQuery = ''"
                />
              </template>
            </UInput>
            <USelect
              v-model="gameSort"
              :items="gameSortOptions"
              icon="i-lucide-arrow-up-down"
              class="w-52"
              aria-label="Sort games"
            />
          </template>
        </div>
      </Transition>
    </header>

    <!-- A drive that went away: the same banner the Clips view shows for its
         folder, so an offline library never reads as clips that vanished. -->
    <Transition name="collapse">
      <div v-if="unreachable.length && !inGame">
        <div class="collapse-body">
          <UAlert
            class="warn"
            icon="i-lucide-triangle-alert"
            color="warning"
            variant="subtle"
            :title="unreachableTitle"
            :description="unreachableText"
            :actions="[
              {
                label: 'Folder settings',
                icon: 'i-lucide-folder-cog',
                color: 'neutral',
                variant: 'subtle',
                onClick: () => openSettings('folders'),
              },
            ]"
          />
        </div>
      </div>
    </Transition>

    <!-- Grid, games browser and both empty states share one box and cross-fade.
         The first folder finishing its scan, or a game's last clip going away,
         then reads as a dissolve rather than the screen blinking to a new one. -->
    <div ref="stageEl" class="stage">
      <Transition name="crossfade">
        <ClipGrid
          v-if="inGame && visibleClips.length"
          key="grid"
          :sections="sections"
          :reset-key="gridResetKey"
        />

        <!-- The name filter hid every clip: say so, ahead of the other filters. -->
        <UEmpty
          v-else-if="inGame && filters.query"
          key="nomatch"
          class="empty"
          icon="i-lucide-search-x"
          :title="`No clips match “${filters.query}”`"
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

        <!-- A filter hid every clip of this game: say which one, instead of
             showing the no-clips screen. -->
        <UEmpty
          v-else-if="inGame && gameClipCount"
          key="filtered"
          class="empty"
          icon="i-lucide-filter-x"
          :title="filteredTitle"
          :description="
            filters.favourites || filters.unwatched
              ? 'Clear the filter to see the rest of this game.'
              : 'The sharing filter is hiding the rest.'
          "
        >
          <template #actions>
            <UButton label="Show all" color="primary" @click="clearFilters('library')" />
          </template>
        </UEmpty>

        <GamesBrowser v-else-if="!inGame && games.length" key="games" />

        <div v-else-if="!hasFolders" key="hero" class="empty hero">
          <div v-if="motionEnabled" class="hero-bg" aria-hidden="true">
            <Aurora
              :color-stops="[
                activeTheme.colors.bg1,
                activeTheme.colors.primary,
                activeTheme.colors.accent,
              ]"
              :amplitude="1.1"
              :blend="0.6"
              :speed="0.6"
            />
          </div>

          <div
            class="hero-folder"
            role="button"
            tabindex="0"
            aria-label="Choose a folder"
            @click="addFolder()"
            @keydown.enter="addFolder()"
            @keydown.space.prevent="addFolder()"
          >
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
            <StarBorder
              as="button"
              class="star-btn"
              :color="activeTheme.colors.secondary"
              speed="5s"
              :thickness="2"
              @click="addFolder()"
            >
              <Icon name="folder-plus" :size="16" />
              Choose a folder
            </StarBorder>
            <!-- The Videos folder main found: one click, no picker. -->
            <UTooltip v-for="p in suggestedFolders" :key="p" :text="p">
              <UButton
                :label="`Add ${basename(p)}`"
                icon="i-lucide-folder"
                color="neutral"
                variant="subtle"
                @click="addFolder(p)"
              />
            </UTooltip>
          </div>
          <p class="hero-hint">…or drop a folder anywhere on this screen.</p>
        </div>

        <UEmpty
          v-else
          key="empty"
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
      </Transition>

      <Transition name="fade">
        <DropWash v-if="dropping" />
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
  display: flex;
  align-items: center;
  gap: var(--s-3);
  min-width: 0;
}
.title-block {
  min-width: 0;
}
.title {
  display: block;
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: 0.01em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
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
.head-actions {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex: 0 0 auto;
}
.tools-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-3);
}
.game-search {
  flex: 1 1 240px;
  min-width: 240px;
  max-width: 420px;
}
.warn {
  margin: 0 28px var(--s-4);
}
/* Holds the box every branch animates inside; without it the leaving one, which
   goes absolute mid-transition, would anchor to the window. */
.stage {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
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
  background: linear-gradient(
    135deg,
    var(--success),
    color-mix(in srgb, var(--success) 70%, white)
  );
}
.p3 {
  background: linear-gradient(
    135deg,
    var(--secondary),
    color-mix(in srgb, var(--secondary) 70%, white)
  );
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
.hero-hint {
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
/* StarBorder ships its own dark inner pill; restyle it as our primary button. */
.star-btn {
  cursor: pointer;
}
.star-btn :deep(.star-inner) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 42px;
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
