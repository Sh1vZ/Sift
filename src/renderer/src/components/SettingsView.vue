<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import FoldersPane from './settings/FoldersPane.vue'
import ClipsPane from './settings/ClipsPane.vue'
import IndexingPane from './settings/IndexingPane.vue'
import PlaybackPane from './settings/PlaybackPane.vue'
import ThemesPane from './settings/ThemesPane.vue'
import OsPane from './settings/OsPane.vue'
import YouTubePane from './settings/YouTubePane.vue'
import StatsPane from './settings/StatsPane.vue'
import StoragePane from './settings/StoragePane.vue'
import InfoPane from './settings/InfoPane.vue'
import {
  activeSection,
  matchedGroups,
  matchedRows,
  revealRow,
  sectionLabel,
  settingsQuery,
  settingsTab,
  type SettingsGroup,
  type SettingsTab,
} from '@/composables/useSettings'
import { registerSearch } from '@/composables/useShortcuts'

// `/` and Ctrl+F land in the rail search while settings are up.
const search = ref<{ inputRef: HTMLInputElement | null } | null>(null)
let offSearch: (() => void) | null = null
onMounted(() => {
  offSearch = registerSearch(() => search.value?.inputRef?.select())
})
onBeforeUnmount(() => offSearch?.())

interface RailGroup {
  label: string
  items: Array<{ label: string; icon: string; active: boolean; onSelect: () => void }>
}

const select = (id: SettingsTab): void => {
  settingsTab.value = id
}

const railGroups = computed<RailGroup[]>(() =>
  matchedGroups.value.map((g: SettingsGroup) => ({
    label: g.label,
    items: g.sections.map((s) => ({
      label: s.label,
      icon: s.icon,
      active: settingsTab.value === s.id,
      onSelect: () => select(s.id),
    })),
  })),
)

/**
 * Individual settings the search found; picking one opens its pane and flashes the row.
 * The section travels as `description` and is drawn under the label, so a long
 * setting name is never cut short by a badge beside it.
 */
const rowItems = computed(() =>
  matchedRows.value.map((r) => ({
    label: r.label,
    description: sectionLabel(r.tab),
    icon: 'i-lucide-corner-down-right',
    onSelect: () => revealRow(r.id),
  })),
)

const navUi = {
  link: 'h-11 px-3 gap-3 text-base font-medium rounded-lg',
  linkLeadingIcon: 'size-5',
  linkLabel: 'truncate',
}

/** Two-line hits: the rail is narrow, so the label wraps instead of truncating. */
const rowsUi = {
  link: 'min-h-11 py-2 px-3 gap-3 text-base font-medium rounded-lg text-left',
  linkLeadingIcon: 'size-5',
  linkLabel: 'flex min-w-0 flex-col items-start leading-tight',
}

/** Enter jumps to the first match — a section, else a row — so the box alone can drive the rail. */
function onSearchKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && settingsQuery.value) {
    settingsQuery.value = ''
    e.stopPropagation()
    return
  }
  if (e.key !== 'Enter') return
  const first = matchedGroups.value[0]?.sections[0]
  if (first) select(first.id)
  else if (matchedRows.value[0]) revealRow(matchedRows.value[0].id)
}
</script>

<template>
  <section class="view">
    <!-- Sub-menu rail: the settings screen's own navigation, one step lighter
         than the app sidebar so the two rails never read as one block. -->
    <nav class="rail" aria-label="Settings sections">
      <div class="rail-search">
        <UInput
          ref="search"
          v-model="settingsQuery"
          icon="i-lucide-search"
          placeholder="Search settings"
          spellcheck="false"
          autocomplete="off"
          aria-label="Search settings"
          :ui="{ root: 'w-full', trailing: 'pe-1' }"
          @keydown="onSearchKey"
        >
          <template v-if="settingsQuery" #trailing>
            <UButton
              color="neutral"
              variant="link"
              size="sm"
              icon="i-lucide-x"
              aria-label="Clear search"
              @click="settingsQuery = ''"
            />
          </template>
        </UInput>
      </div>

      <div class="rail-scroll">
        <div class="rail-slot">
          <Transition name="dissolve">
            <div v-if="railGroups.length || rowItems.length" key="groups">
              <template v-for="g in railGroups" :key="g.label">
                <div class="group-title">{{ g.label }}</div>
                <UNavigationMenu
                  orientation="vertical"
                  color="primary"
                  variant="pill"
                  highlight
                  highlight-color="primary"
                  :items="g.items"
                  :ui="navUi"
                />
              </template>
              <!-- Settings the words matched, not only the sections that mention them. -->
              <template v-if="settingsQuery && rowItems.length">
                <div class="group-title">Settings</div>
                <UNavigationMenu
                  orientation="vertical"
                  color="primary"
                  variant="pill"
                  :items="rowItems"
                  :ui="rowsUi"
                >
                  <template #item-label="{ item }">
                    <span class="hit-label">{{ item.label }}</span>
                    <span class="hit-where">{{ item.description }}</span>
                  </template>
                </UNavigationMenu>
              </template>
            </div>

            <UEmpty
              v-else
              key="empty"
              class="rail-empty"
              icon="i-lucide-search-x"
              title="No match"
              :description="`Nothing in settings matches “${settingsQuery}”.`"
              variant="subtle"
              size="sm"
            />
          </Transition>
        </div>
      </div>
    </nav>

    <!-- Text-led pane: one centred reading column, like every settings screen. -->
    <div class="pane">
      <div class="page">
        <!-- One short head, not a hero: the rail and the breadcrumb already say
             where you are, so the first control sits within reach of the title. -->
        <header class="pane-head">
          <h1>{{ activeSection.label }}</h1>
          <p class="pane-sub">{{ activeSection.description }}</p>
        </header>

        <Transition name="fade" mode="out-in">
          <FoldersPane v-if="settingsTab === 'folders'" key="folders" />
          <ClipsPane v-else-if="settingsTab === 'clips'" key="clips" />
          <IndexingPane v-else-if="settingsTab === 'indexing'" key="indexing" />
          <PlaybackPane v-else-if="settingsTab === 'playback'" key="playback" />
          <ThemesPane v-else-if="settingsTab === 'themes'" key="themes" />
          <OsPane v-else-if="settingsTab === 'os'" key="os" />
          <YouTubePane v-else-if="settingsTab === 'youtube'" key="youtube" />
          <StatsPane v-else-if="settingsTab === 'stats'" key="stats" />
          <StoragePane v-else-if="settingsTab === 'storage'" key="storage" />
          <InfoPane v-else key="info" />
        </Transition>
      </div>
    </div>
  </section>
</template>

<style scoped>
.view {
  flex: 1;
  min-height: 0;
  display: flex;
}

.rail {
  display: flex;
  flex-direction: column;
  width: var(--submenu-w);
  flex: 0 0 auto;
  min-height: 0;
  background: var(--bg-1);
  border-right: 1px solid var(--border);
}
.rail-search {
  padding: var(--s-4) var(--s-3) var(--s-2);
}
.rail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--s-2) var(--s-3) var(--s-6);
}
.group-title {
  margin: var(--s-3) var(--s-2) var(--s-2);
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
.rail-slot {
  position: relative;
}
/* The theme's label slot is nowrap; the lines themselves wrap so nothing is cut. */
.hit-label,
.hit-where {
  white-space: normal;
  overflow-wrap: anywhere;
}

.hit-where {
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--fg-dim);
}

.rail-empty {
  padding: var(--s-6) var(--s-2);
}

.pane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}
.page {
  max-width: var(--page-max);
  /* 28px matches the gutter the clip grid uses, so the column keeps the same
     edge spacing once the window is too narrow to centre it. */
  margin: 0 auto;
  padding: var(--s-6) 28px var(--s-10);
}

.pane-head {
  margin-bottom: var(--s-6);
}
.pane-head h1 {
  font-size: var(--text-xl);
  font-weight: 700;
}
.pane-sub {
  max-width: 64ch;
  margin-top: var(--s-1);
  font-size: var(--text-base);
  line-height: 1.5;
  color: var(--fg-muted);
}

/* Every pane stacks panels with the same rhythm. */
.page :deep(.stack) {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}
</style>
