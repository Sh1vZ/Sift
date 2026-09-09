<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { GridSize, SortBy } from '@shared/types'
import {
  exportGroupBy,
  exportSort,
  favouriteGroupBy,
  favouriteSort,
  favouritesHaveImages,
  filtersFor,
  gameHasImages,
  gridGroupBy,
  MEDIA_FILTERS,
  settings,
  SHARE_FILTERS,
  updateSettings,
  type FilterScope,
  type GridGroup,
} from '@/composables/useLibrary'

/**
 * The row under a grid's title, the same on a game's clips, on the Clips view
 * and on Favourites: a name filter, the two state toggles that compose
 * ("unwatched favourites"), the order, and one View menu for the rarer
 * choices — grouping, the sharing filter, card size. It binds straight to the
 * module state for its scope, the house pattern for view state; the parent
 * only says which grid it stands over. The game rail the two cross-game
 * screens put beneath it is `GameFilter`, bound to the same state.
 */
const props = defineProps<{ scope: FilterScope }>()

const filters = computed(() => filtersFor(props.scope))

const allSortOptions: Array<{ value: SortBy; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name' },
  { value: 'duration', label: 'Longest' },
  { value: 'size', label: 'Largest' },
  { value: 'favourite', label: 'Favourites first' },
]

/** Pinning favourites to the top is no order at all on a grid that is only favourites. */
const sortOptions = computed(() =>
  props.scope === 'favourites'
    ? allSortOptions.filter((o) => o.value !== 'favourite')
    : allSortOptions,
)

/** The in-game order is a persisted setting; the Clips and Favourites orders reset with the app. */
const sortModel = computed({
  get: () => {
    if (props.scope === 'clips') return exportSort.value
    if (props.scope === 'favourites') return favouriteSort.value
    return settings.value.sort
  },
  set: (v: SortBy) => {
    if (props.scope === 'clips') exportSort.value = v
    else if (props.scope === 'favourites') favouriteSort.value = v
    else void updateSettings({ sort: v })
  },
})

const groupOptions: Array<{ value: GridGroup; label: string; icon: string }> = [
  { value: 'game', label: 'By game', icon: 'i-lucide-gamepad-2' },
  { value: 'date', label: 'By date', icon: 'i-lucide-calendar' },
  { value: 'none', label: 'No grouping', icon: 'i-lucide-layout-grid' },
]

/** A game's grid is one game already, so it offers the other two. */
const scopeGroupOptions = computed(() =>
  props.scope === 'library' ? groupOptions.filter((g) => g.value !== 'game') : groupOptions,
)

/** Where each grid starts: exports under their games, favourites flat, a game by date. */
const DEFAULT_GROUP: Record<FilterScope, GridGroup> = {
  library: 'date',
  clips: 'game',
  favourites: 'none',
}

/** The in-game grouping is a persisted setting, like its order; the other two reset with the app. */
const groupModel = computed<GridGroup>({
  get: () => {
    if (props.scope === 'clips') return exportGroupBy.value
    if (props.scope === 'favourites') return favouriteGroupBy.value
    return gridGroupBy.value
  },
  set: (v) => {
    if (props.scope === 'clips') exportGroupBy.value = v
    else if (props.scope === 'favourites') favouriteGroupBy.value = v
    else if (v !== 'game') void updateSettings({ groupBy: v })
  },
})
const sizeOptions: Array<{ value: GridSize; label: string; icon: string }> = [
  { value: 'large', label: 'Large cards', icon: 'i-lucide-grid-2x2' },
  { value: 'comfortable', label: 'Comfortable cards', icon: 'i-lucide-layout-grid' },
  { value: 'compact', label: 'Compact cards', icon: 'i-lucide-grid-3x3' },
]

/** Keeps the menu open on a pick, so several view options can be set in one visit. */
const stayOpen = (e: Event): void => e.preventDefault()

const viewItems = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = []
  groups.push([
    { label: 'Group', type: 'label' },
    ...scopeGroupOptions.value.map<DropdownMenuItem>((g) => ({
      label: g.label,
      icon: g.icon,
      type: 'checkbox',
      checked: groupModel.value === g.value,
      onSelect: stayOpen,
      onUpdateChecked: (on: boolean) => {
        if (on) groupModel.value = g.value
      },
    })),
  ])
  groups.push([
    { label: 'Sharing', type: 'label' },
    ...SHARE_FILTERS.map<DropdownMenuItem>((s) => ({
      label: s.label,
      icon: s.icon,
      type: 'checkbox',
      checked: filters.value.share === s.value,
      onSelect: stayOpen,
      onUpdateChecked: (on: boolean) => {
        if (on) filters.value.share = s.value
      },
    })),
  ])
  groups.push([
    { label: 'Card size', type: 'label' },
    ...sizeOptions.map<DropdownMenuItem>((s) => ({
      label: s.label,
      icon: s.icon,
      type: 'checkbox',
      checked: settings.value.gridSize === s.value,
      onSelect: stayOpen,
      onUpdateChecked: (on: boolean) => {
        if (on) void updateSettings({ gridSize: s.value })
      },
    })),
  ])
  return groups
})

/** How many view options sit off their default; shown on the View button. */
const viewChanges = computed(
  () =>
    Number(groupModel.value !== DEFAULT_GROUP[props.scope]) +
    Number(filters.value.share !== 'all') +
    Number(settings.value.gridSize !== 'large'),
)

/**
 * The kind control earns its place wherever there is a choice to make: a game
 * with screenshots, or a Favourites grid holding both. A filter already set is
 * never hidden from the person who set it.
 */
const showKindFilter = computed(
  () =>
    filters.value.kind !== 'all' ||
    (props.scope === 'library' && gameHasImages.value) ||
    (props.scope === 'favourites' && favouritesHaveImages.value),
)

// ------------------------------------------------------------ name filter

const filterInput = ref<{ inputRef: HTMLInputElement | null } | null>(null)

/** Esc clears the filter; a second Esc leaves the field, so the next one goes back. */
function onFilterKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  if (filters.value.query) filters.value.query = ''
  else filterInput.value?.inputRef?.blur()
}

/** `/` and Ctrl+F land here through `registerSearch`. */
function focus(): void {
  filterInput.value?.inputRef?.select()
}
defineExpose({ focus })
</script>

<template>
  <div class="toolbar" role="toolbar" aria-label="Filter and sort">
    <UInput
      ref="filterInput"
      v-model="filters.query"
      class="filter"
      icon="i-lucide-search"
      size="xl"
      placeholder="Filter by name"
      spellcheck="false"
      autocomplete="off"
      aria-label="Filter clips by name"
      :ui="{ trailing: 'pe-1.5' }"
      @keydown="onFilterKey"
    >
      <template v-if="filters.query" #trailing>
        <UButton
          color="neutral"
          variant="link"
          size="sm"
          icon="i-lucide-x"
          aria-label="Clear filter"
          @click="filters.query = ''"
        />
      </template>
    </UInput>

    <!-- Left out on the Favourites screen: the screen is that filter. -->
    <UButton
      v-if="scope !== 'favourites'"
      label="Favourites"
      icon="i-lucide-heart"
      :color="filters.favourites ? 'primary' : 'neutral'"
      :variant="filters.favourites ? 'soft' : 'subtle'"
      :aria-pressed="filters.favourites"
      @click="filters.favourites = !filters.favourites"
    />
    <UButton
      label="Unwatched"
      icon="i-lucide-eye-off"
      :color="filters.unwatched ? 'primary' : 'neutral'"
      :variant="filters.unwatched ? 'soft' : 'subtle'"
      :aria-pressed="filters.unwatched"
      @click="filters.unwatched = !filters.unwatched"
    />

    <!-- Only where there is a choice to make: a game with no screenshots keeps
         the row it always had. See showKindFilter. -->
    <UFieldGroup v-if="showKindFilter" role="group" aria-label="Show videos, screenshots or both">
      <UTooltip v-for="m in MEDIA_FILTERS" :key="m.value" :text="m.label">
        <UButton
          :icon="m.icon"
          :color="filters.kind === m.value ? 'primary' : 'neutral'"
          :variant="filters.kind === m.value ? 'soft' : 'subtle'"
          square
          :aria-label="m.label"
          :aria-pressed="filters.kind === m.value"
          @click="filters.kind = m.value"
        />
      </UTooltip>
    </UFieldGroup>

    <USelect
      v-model="sortModel"
      :items="sortOptions"
      icon="i-lucide-arrow-up-down"
      class="w-48"
      aria-label="Sort clips"
    />

    <UChip :show="viewChanges > 0" :text="viewChanges" color="primary" size="lg" inset>
      <UDropdownMenu :items="viewItems" :content="{ align: 'end' }" :ui="{ content: 'min-w-56' }">
        <UButton
          label="View"
          icon="i-lucide-sliders-horizontal"
          trailing-icon="i-lucide-chevron-down"
          color="neutral"
          variant="subtle"
          aria-label="View options: grouping, sharing filter and card size"
        />
      </UDropdownMenu>
    </UChip>

    <slot name="actions" />
  </div>
</template>

<style scoped>
/* Wraps rather than truncating the title: at the 980px minimum the row simply
   takes two lines. */
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-3);
}
.filter {
  flex: 1 1 220px;
  min-width: 220px;
  max-width: 420px;
}
</style>
