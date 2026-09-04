<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import AnimatedList from './bits/AnimatedList.vue'
import SpotlightCard from './bits/SpotlightCard.vue'
import {
  filteredGames,
  gameQuery,
  gameSort,
  games,
  newestClipOf,
  now,
  openGame,
  rescan,
  revealClip,
  scan,
  type GameSort,
  type GameSummary,
} from '@/composables/useLibrary'
import { motionEnabled } from '@/composables/useMotion'
import { registerSearch } from '@/composables/useShortcuts'
import { activeTheme } from '@/composables/useTheme'
import { isOpen as playerOpen } from '@/composables/usePlayer'
import { visible as windowVisible } from '@/composables/useWindowVisibility'
import { formatBytes, formatDuration, formatRelative } from '@/utils/format'

const api = window.api

const sortOptions: Array<{ label: string; value: GameSort; icon: string }> = [
  { label: 'Recent activity', value: 'recent', icon: 'i-lucide-clock' },
  { label: 'Name', value: 'name', icon: 'i-lucide-arrow-up-down' },
  { label: 'Most clips', value: 'count', icon: 'i-lucide-film' },
]

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && gameQuery.value) {
    gameQuery.value = ''
    e.stopPropagation()
  }
}

// `/` and Ctrl+F land here while this screen is up.
const search = ref<{ inputRef: HTMLInputElement | null } | null>(null)
let offSearch: (() => void) | null = null
onMounted(() => {
  offSearch = registerSearch(() => search.value?.inputRef?.select())
})
onBeforeUnmount(() => offSearch?.())

const keyOf = (g: GameSummary): string => g.name
const open = (g: GameSummary): void => openGame(g.name)

/** Right-click on a game: what you can do to it without stepping in. */
function gameMenu(g: GameSummary) {
  const newest = newestClipOf(g.name)
  return [
    [
      { label: 'Open', icon: 'i-lucide-arrow-right', onSelect: () => open(g) },
      {
        label: 'Show folder in Explorer',
        icon: 'i-lucide-folder-open',
        disabled: !newest,
        onSelect: () => {
          if (newest) revealClip(newest)
        },
      },
    ],
    [
      {
        label: 'Rescan folders',
        icon: 'i-lucide-refresh-cw',
        disabled: scan.value.active,
        onSelect: () => void rescan(),
      },
    ],
  ]
}
</script>

<template>
  <div class="browser">
    <div class="tools">
      <UInput
        ref="search"
        v-model="gameQuery"
        class="search"
        icon="i-lucide-search"
        size="xl"
        placeholder="Search games…"
        autofocus
        spellcheck="false"
        autocomplete="off"
        aria-label="Search games"
        :ui="{ trailing: 'pe-1.5' }"
        @keydown="onKey"
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

      <div class="kbds" aria-hidden="true">
        <UKbd value="arrowup" /><UKbd value="arrowdown" /><UKbd value="arrowleft" /><UKbd
          value="arrowright"
        />
        <span>move</span>
        <UKbd value="enter" />
        <span>open</span>
      </div>

      <USelect
        v-model="gameSort"
        :items="sortOptions"
        size="lg"
        icon="i-lucide-arrow-up-down"
        class="w-48"
        aria-label="Sort games"
      />

      <UBadge
        color="neutral"
        variant="subtle"
        size="md"
        :label="`${filteredGames.length} of ${games.length}`"
        class="mono"
      />
    </div>

    <div class="stage">
      <Transition name="crossfade">
        <AnimatedList
          v-if="filteredGames.length"
          key="list"
          :items="filteredGames"
          :item-key="keyOf"
          :active="!playerOpen"
          :animated="motionEnabled"
          :gradient-color="activeTheme.colors.bg1"
          class-name="games-list"
          @item-selected="open"
        >
          <template #default="{ item: g, selected }">
            <UContextMenu :items="gameMenu(g)" :ui="{ content: 'min-w-52' }">
              <SpotlightCard
                as="button"
                class="game"
                :class="{ 'is-selected': selected }"
                :spotlight-color="activeTheme.spotlight"
                :title="g.name"
              >
                <span class="cover">
                  <!-- The list is not windowed, so every cover stays decoded. Dropping
                       them while the window is away is the bulk of what a hidden
                       Games screen was holding; the box keeps its aspect ratio, so
                       falling back to the placeholder shifts nothing. -->
                  <img
                    v-if="g.cover && windowVisible"
                    :src="api.thumbUrl(g.cover)"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <Icon v-else name="gamepad" :size="24" :stroke="1.6" />
                </span>
                <span class="text">
                  <span class="name truncate">{{ g.name }}</span>
                  <span class="stats">
                    <UBadge
                      color="primary"
                      variant="soft"
                      size="md"
                      :label="`${g.count} clip${g.count === 1 ? '' : 's'}`"
                    />
                    <span class="mono">{{ formatDuration(g.totalDuration) }}</span>
                    <span class="dot">·</span>
                    <span>{{ formatBytes(g.totalSize) }}</span>
                  </span>
                  <span class="last truncate"
                    >Last clip {{ formatRelative(g.latestMs, now).toLowerCase() }}</span
                  >
                </span>
                <Icon name="chevron-right" :size="20" class="chev" />
              </SpotlightCard>
            </UContextMenu>
          </template>
        </AnimatedList>

        <UEmpty
          v-else
          key="empty"
          class="empty"
          icon="i-lucide-search"
          :title="`No games match “${gameQuery}”`"
          description="Try a shorter name — the search also ignores spaces and punctuation."
          :actions="[
            {
              label: 'Clear search',
              color: 'neutral',
              variant: 'subtle',
              onClick: () => (gameQuery = ''),
            },
          ]"
        />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.browser {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.tools {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 28px 14px;
}
.search {
  flex: 1;
  max-width: 520px;
}
.kbds {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
  white-space: nowrap;
}
.kbds span {
  margin: 0 4px 0 2px;
}
.tools > .mono {
  margin-left: auto;
}

/* Holds the box the list and the empty state animate inside; without it the
   leaving one, which goes absolute mid-transition, would cover the search row. */
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* AnimatedList fills the remaining height. Rows flow into as many columns as the
   window gives them - one on a narrow window, several on a wide one - so the list
   uses the full width the clip grid already does instead of hugging the left edge. */
.browser :deep(.games-list) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.browser :deep(.animated-list-scroll) {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 470px), 1fr));
  align-content: start;
  gap: var(--s-3);
  padding: var(--s-1) 28px var(--s-12);
}

.game {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  height: 100%;
  padding: 10px 14px 10px 10px;
  border-radius: var(--r-lg);
  background: var(--bg-2);
  border: 1px solid var(--border);
  text-align: left;
  color: var(--fg);
  cursor: pointer;
  transition:
    transform var(--dur) var(--ease-out),
    border-color var(--dur) var(--ease-out),
    box-shadow var(--dur) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.game.is-selected,
.game:focus-visible {
  transform: translateX(4px);
  background: var(--bg-3);
  border-color: var(--border-active);
  box-shadow: var(--glow-primary);
}
.cover {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: clamp(132px, 34%, 168px);
  aspect-ratio: 16 / 9;
  flex: 0 0 auto;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--bg-4);
  color: var(--fg-dim);
  box-shadow: inset 0 0 0 1px var(--border);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 500ms var(--ease-out);
}
.game.is-selected .cover img {
  transform: scale(1.05);
}
.text {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.name {
  font-family: var(--font-heading);
  font-size: var(--text-lg);
  font-weight: 600;
}
.stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.dot {
  color: var(--fg-dim);
}
.last {
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.game .chev {
  position: relative;
  z-index: 1;
  color: var(--fg-dim);
  transition:
    transform var(--dur) var(--ease-spring),
    color var(--dur-fast) var(--ease-out);
}
.game.is-selected .chev {
  color: var(--secondary);
  transform: translateX(3px);
}
.empty {
  flex: 1;
}
</style>
