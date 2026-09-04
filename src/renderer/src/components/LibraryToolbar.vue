<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { GridSize, GroupBy, SortBy } from '@shared/types'
import {
  exportSort,
  filtersFor,
  gridGroupBy,
  settings,
  SHARE_FILTERS,
  updateSettings,
  type FilterScope,
} from '@/composables/useLibrary'

/**
 * The row under a grid's title, the same on a game's clips and on the Clips
 * view: a name filter, the two state toggles that compose ("unwatched
 * favourites"), the order, and one View menu for the rarer choices — grouping,
 * the sharing filter, card size. It binds straight to the module state for its
 * scope, the house pattern for view state; the parent only says which grid it
 * stands over.
 */
const props = defineProps<{ scope: FilterScope }>()

const filters = computed(() => filtersFor(props.scope))

const sortOptions: Array<{ value: SortBy; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name' },
  { value: 'duration', label: 'Longest' },
  { value: 'size', label: 'Largest' },
  { value: 'favourite', label: 'Favourites first' },
]

/** The in-game order is a persisted setting; the Clips order resets with the app. */
const sortModel = computed({
  get: () => (props.scope === 'clips' ? exportSort.value : settings.value.sort),
  set: (v: SortBy) => {
    if (props.scope === 'clips') exportSort.value = v
    else void updateSettings({ sort: v })
  },
})

const groupOptions: Array<{ value: GroupBy; label: string; icon: string }> = [
  { value: 'date', label: 'By date', icon: 'i-lucide-calendar' },
  { value: 'none', label: 'No grouping', icon: 'i-lucide-layout-grid' },
]
const sizeOptions: Array<{ value: GridSize; label: string; icon: string }> = [
  { value: 'large', label: 'Large cards', icon: 'i-lucide-grid-2x2' },
  { value: 'comfortable', label: 'Comfortable cards', icon: 'i-lucide-layout-grid' },
  { value: 'compact', label: 'Compact cards', icon: 'i-lucide-grid-3x3' },
]

/** Keeps the menu open on a pick, so several view options can be set in one visit. */
const stayOpen = (e: Event): void => e.preventDefault()

const viewItems = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = []
  if (props.scope === 'library')
    groups.push([
      { label: 'Group', type: 'label' },
      ...groupOptions.map<DropdownMenuItem>((g) => ({
        label: g.label,
        icon: g.icon,
        type: 'checkbox',
        checked: gridGroupBy.value === g.value,
        onSelect: stayOpen,
        onUpdateChecked: (on: boolean) => {
          if (on) void updateSettings({ groupBy: g.value })
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
    Number(props.scope === 'library' && gridGroupBy.value !== 'date') +
    Number(filters.value.share !== 'all') +
    Number(settings.value.gridSize !== 'large'),
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

    <UButton
      label="Favourites"
      icon="i-lucide-star"
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
