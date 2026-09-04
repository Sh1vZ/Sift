<script setup lang="ts">
import { computed, ref } from 'vue'
import GameMergeHints from './GameMergeHints.vue'
import Icon from './Icon.vue'
import AnimatedList from './bits/AnimatedList.vue'
import SpotlightCard from './bits/SpotlightCard.vue'
import { mergeGamesDialog, renameGameDialog, splitGameDialog } from '@/composables/useGameNames'
import {
  filteredGames,
  gameQuery,
  newestClipOf,
  now,
  openGame,
  rescan,
  revealClip,
  scan,
  type GameSummary,
} from '@/composables/useLibrary'
import { motionEnabled } from '@/composables/useMotion'
import { activeTheme } from '@/composables/useTheme'
import { toast } from '@/composables/useToasts'
import { isOpen as playerOpen } from '@/composables/usePlayer'
import { visible as windowVisible } from '@/composables/useWindowVisibility'
import { formatBytes, formatDuration, formatRelative } from '@/utils/format'

/**
 * The list of game cards under the Games header. The search and the sort live
 * in LibraryView's tools row, bound to the same module state this reads.
 */
const api = window.api

const keyOf = (g: GameSummary): string => g.name
const open = (g: GameSummary): void => openGame(g.name)

/** A game's actions: what you can do to it without stepping in. */
function gameMenu(g: GameSummary, targets: GameSummary[]) {
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
    // Renaming and merging are what a card looks like, never what is on disk.
    // Dragging one card onto another does the same merge; this is the path a
    // keyboard reaches.
    [
      { label: 'Rename…', icon: 'i-lucide-pencil', onSelect: () => void renameGameDialog(g) },
      {
        label: 'Merge into…',
        icon: 'i-lucide-merge',
        disabled: targets.length < 2,
        children: targets
          .filter((t) => t.name !== g.name)
          .map((t) => ({ label: t.name, onSelect: () => void mergeGamesDialog(g, t) })),
      },
      // Only a card showing a name the user chose has somewhere to go back to.
      ...(g.renamed
        ? [
            {
              label: g.sources.length > 1 ? 'Undo merge' : 'Use folder name',
              icon: 'i-lucide-split',
              onSelect: () => void splitGameDialog(g),
            },
          ]
        : []),
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

/**
 * Built once per list rather than per card: `newestClipOf` walks every
 * recording, and the list re-renders on each hover as the selection follows the
 * pointer. Two menus per card off the same map costs nothing.
 */
const gameMenus = computed(() => {
  const targets = filteredGames.value
  const menus: Record<string, ReturnType<typeof gameMenu>> = {}
  for (const g of targets) menus[g.name] = gameMenu(g, targets)
  return menus
})

// ------------------------------------------------------------ drag to merge
// Both ends of the drag live in the one v-for below, so the state is local.
// `useFolderDrop` on the stage gates on `dataTransfer.types` carrying 'Files',
// which a card drag never does — the two never see each other's drags.

const DRAG_TYPE = 'application/x-sift-game'
const dragging = ref<GameSummary | null>(null)
const dropTarget = ref<string | null>(null)
/** The first drag of a session says what dropping does; after that the ring on the target is enough. */
let dragHintShown = false

function onDragStart(e: DragEvent, g: GameSummary): void {
  dragging.value = g
  dropTarget.value = null
  // Chromium refuses to start a drag that carries nothing.
  e.dataTransfer?.setData(DRAG_TYPE, g.name)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  if (!dragHintShown) {
    dragHintShown = true
    toast(
      'info',
      'Drop it on another game to merge them',
      'Only the card changes — nothing on disk moves.',
    )
  }
}

function onDragEnd(): void {
  dragging.value = null
  dropTarget.value = null
}

function onDragOver(e: DragEvent, g: GameSummary): void {
  if (!dragging.value || dragging.value.name === g.name) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTarget.value = g.name
}

function onDragLeave(g: GameSummary): void {
  if (dropTarget.value === g.name) dropTarget.value = null
}

function onDrop(e: DragEvent, g: GameSummary): void {
  const from = dragging.value
  onDragEnd()
  if (!from || from.name === g.name) return
  e.preventDefault()
  void mergeGamesDialog(from, g)
}

// Arrow keys belong to an open menu while one is up, not to the list underneath.
const menuOpen = ref(false)
</script>

<template>
  <div class="browser">
    <GameMergeHints />

    <div class="stage">
      <Transition name="crossfade">
        <AnimatedList
          v-if="filteredGames.length"
          key="list"
          :items="filteredGames"
          :item-key="keyOf"
          :active="!playerOpen && !menuOpen"
          :animated="motionEnabled"
          :gradient-color="activeTheme.colors.bg1"
          class-name="games-list"
          @item-selected="open"
        >
          <template #default="{ item: g, selected }">
            <UContextMenu
              :items="gameMenus[g.name]"
              :ui="{ content: 'min-w-52' }"
              @update:open="menuOpen = $event"
            >
              <!-- The card is a <button>, so the menu button cannot sit inside
                   it; it rides alongside and follows the card's nudge. -->
              <div
                class="game-slot"
                :class="{
                  'is-dragging': dragging?.name === g.name,
                  'is-drop': dropTarget === g.name,
                }"
                draggable="true"
                @dragstart="onDragStart($event, g)"
                @dragend="onDragEnd"
                @dragover="onDragOver($event, g)"
                @dragleave="onDragLeave(g)"
                @drop="onDrop($event, g)"
              >
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

                <UDropdownMenu
                  :items="gameMenus[g.name]"
                  :content="{ align: 'end' }"
                  :ui="{ content: 'min-w-52' }"
                  @update:open="menuOpen = $event"
                >
                  <!-- Not draggable, so reaching for the menu never starts a merge. -->
                  <UButton
                    class="kebab"
                    draggable="false"
                    icon="i-lucide-ellipsis-vertical"
                    color="neutral"
                    variant="ghost"
                    square
                    size="sm"
                    :aria-label="`More actions for ${g.name}`"
                    @click.stop
                    @keydown.enter.stop
                  />
                </UDropdownMenu>
              </div>
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

/* Holds the box the list and the empty state animate inside; without it the
   leaving one, which goes absolute mid-transition, would cover the header. */
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

/* Holds the card and the menu button that cannot live inside it. */
.game-slot {
  position: relative;
  height: 100%;
}
/* Drag to merge. Colour and opacity only: these are repeated elements, and
   moving them would shuffle the grid under the pointer mid-drag. */
.game-slot.is-dragging {
  opacity: 0.45;
}
/* The same language `DropWash` speaks for a folder drop, so a drop target reads
   the same wherever it is: the primary wash, never the rose/amber accent. */
.game-slot.is-drop :deep(.game) {
  border-color: var(--border-active);
  background: var(--primary-soft);
  box-shadow: var(--glow-primary);
}
/* Above the card's spotlight wash, clear of the chevron. Dimmed at rest rather
   than hidden: an affordance you cannot see is one you cannot find. */
.game-slot .kebab {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  opacity: 0.7;
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur) var(--ease-out);
}
.game-slot:hover .kebab,
.game-slot:focus-within .kebab {
  opacity: 1;
}
/* The card slides a little when it is the selected row; the button rides with
   it rather than hanging off the edge it left behind. */
.game.is-selected ~ .kebab,
.game:focus-visible ~ .kebab {
  transform: translateX(4px);
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
