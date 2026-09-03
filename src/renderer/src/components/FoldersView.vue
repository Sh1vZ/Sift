<script setup lang="ts">
import { computed } from 'vue'
import type { LibraryFolder, Settings } from '@shared/types'
import Icon from './Icon.vue'
import {
  addFolder,
  allClips,
  appVersion,
  folders,
  removeFolder,
  rescan,
  scan,
  settings,
  updateSettings,
  view
} from '@/composables/useLibrary'
import { confirm } from '@/composables/useDialogs'

type ToggleKey = keyof Pick<
  Settings,
  'watchFolders' | 'generateThumbnails' | 'hoverPreview' | 'animations' | 'autoplayNext'
>

interface ToggleRow {
  key: ToggleKey
  icon: string
  title: string
  description: string
}

const toggles: ToggleRow[] = [
  {
    key: 'watchFolders',
    icon: 'radar',
    title: 'Watch folders',
    description: 'Pick up new recordings the moment they finish writing. Uses a lightweight OS file watcher.'
  },
  {
    key: 'generateThumbnails',
    icon: 'image',
    title: 'Generate thumbnails',
    description: 'Poster frames and hover-scrub strips are rendered once by ffmpeg at low CPU priority and cached.'
  },
  {
    key: 'hoverPreview',
    icon: 'eye',
    title: 'Hover to scrub',
    description: 'Move across a card to preview the clip without opening it.'
  },
  {
    key: 'animations',
    icon: 'sparkles',
    title: 'Animations',
    description: 'Card reveals and player transitions. Automatically off when Windows asks for reduced motion.'
  },
  {
    key: 'autoplayNext',
    icon: 'list-video',
    title: 'Autoplay next clip',
    description: 'When a clip ends, continue with the next one in the grid.'
  }
]

const workerOptions = [1, 2, 3, 4].map((n) => ({ label: `${n} worker${n === 1 ? '' : 's'}`, value: n }))
const withThumbs = computed(() => allClips.value.filter((c) => c.thumb).length)

async function remove(folder: LibraryFolder): Promise<void> {
  const ok = await confirm({
    title: 'Remove this folder?',
    message: 'Its clips leave the library. Nothing on disk is renamed, moved or deleted.',
    detail: folder.path,
    detailIcon: 'i-lucide-folder',
    confirmLabel: 'Remove',
    danger: true
  })
  if (ok) await removeFolder(folder)
}
</script>

<template>
  <section class="view">
    <div class="scroll">
      <!-- Text-led screen: one centred reading column rather than the full-width
           grid the library screens use. -->
      <div class="page">
        <header class="head">
          <div>
            <h1>Library &amp; settings</h1>
            <p class="sub">{{ allClips.length }} clips indexed · {{ withThumbs }} with previews</p>
          </div>
          <div class="head-actions">
            <UButton
              icon="i-lucide-chart-column"
              label="Stats"
              color="neutral"
              variant="subtle"
              size="lg"
              @click="view = 'stats'"
            />
            <UButton icon="i-lucide-folder-plus" label="Add folder" color="primary" size="lg" @click="addFolder()" />
          </div>
        </header>

        <UCard class="panel" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <h2 class="panel-title">Folders</h2>
            <p class="panel-sub">
              Clips are indexed where they live — Sift never copies, moves or renames a file.
            </p>
          </template>

          <UEmpty
            v-if="!folders.length"
            class="panel-empty"
            icon="i-lucide-folder"
            title="No folders yet"
            description="Add the one ShadowPlay records to — usually your Videos folder."
            variant="subtle"
            size="sm"
            :actions="[{ label: 'Add folder', icon: 'i-lucide-folder-plus', onClick: () => addFolder() }]"
          />
          <ul v-else class="rows">
            <li v-for="f in folders" :key="f.id" class="row">
              <span class="row-icon" :class="{ 'is-offline': !f.available }">
                <Icon :name="f.available ? 'hard-drive' : 'alert'" :size="18" />
              </span>
              <div class="row-text">
                <div class="folder-name">
                  <span class="truncate">{{ f.name }}</span>
                  <UBadge v-if="!f.available" color="warning" variant="subtle" size="sm" label="Not reachable" />
                  <UBadge
                    v-else-if="scan.active && scan.folder === f.name"
                    color="primary"
                    variant="subtle"
                    size="sm"
                    icon="i-lucide-loader-circle"
                    label="Scanning"
                    :ui="{ leadingIcon: 'animate-spin' }"
                  />
                </div>
                <p class="folder-path truncate" :title="f.path">{{ f.path }}</p>
              </div>
              <UBadge color="neutral" variant="soft" size="sm" :label="`${f.clipCount} clips`" class="mono" />
              <div class="folder-actions">
                <UTooltip text="Rescan this folder">
                  <UButton
                    icon="i-lucide-refresh-cw"
                    color="neutral"
                    variant="ghost"
                    square
                    aria-label="Rescan folder"
                    :disabled="!f.available"
                    @click="rescan(f.id)"
                  />
                </UTooltip>
                <UTooltip text="Remove from library">
                  <UButton
                    class="danger"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    square
                    aria-label="Remove folder"
                    @click="remove(f)"
                  />
                </UTooltip>
              </div>
            </li>
          </ul>
        </UCard>

        <UCard class="panel" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <h2 class="panel-title">Behaviour</h2>
            <p class="panel-sub">How Sift watches your folders, builds previews and plays clips.</p>
          </template>

          <div class="rows">
            <div v-for="t in toggles" :key="t.key" class="row">
              <span class="row-icon"><Icon :name="t.icon" :size="18" /></span>
              <div class="row-text">
                <span class="row-title">{{ t.title }}</span>
                <p class="row-desc">{{ t.description }}</p>
              </div>
              <USwitch
                :model-value="settings[t.key]"
                size="lg"
                :aria-label="t.title"
                @update:model-value="(v: boolean) => updateSettings({ [t.key]: v })"
              />
            </div>

            <div class="row">
              <span class="row-icon"><Icon name="cpu" :size="18" /></span>
              <div class="row-text">
                <span class="row-title">Preview workers</span>
                <p class="row-desc">
                  How many clips are processed at once. Keep it low while gaming; raise it to chew
                  through a big backlog faster.
                </p>
              </div>
              <USelect
                :model-value="settings.concurrency"
                :items="workerOptions"
                icon="i-lucide-cpu"
                class="w-36"
                aria-label="Preview workers"
                @update:model-value="(v: number) => updateSettings({ concurrency: v })"
              />
            </div>
          </div>
        </UCard>

        <p class="about">Sift {{ appVersion }} · Local-first, nothing leaves your PC.</p>
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
.scroll {
  flex: 1;
  overflow-y: auto;
}
.page {
  max-width: var(--page-max);
  /* 28px matches the gutter the clip grid uses, so the column keeps the same
     edge spacing once the window is too narrow to centre it. */
  margin: 0 auto;
  padding: var(--s-6) 28px var(--s-10);
}
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--s-4);
  margin-bottom: var(--s-6);
}
.head h1 {
  font-size: var(--text-2xl);
  font-weight: 700;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.sub {
  margin-top: var(--s-1);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

/* A panel is one titled card: header, then hairline-separated rows. */
.panel + .panel {
  margin-top: var(--s-5);
}
.panel-title {
  font-size: var(--text-md);
  font-weight: 600;
}
.panel-sub {
  margin-top: var(--s-1);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.panel-empty {
  padding: var(--s-6);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  /* Horizontal padding matches the card header so labels line up down the panel. */
  padding: var(--s-4) var(--s-6);
}
.row + .row {
  border-top: 1px solid var(--border);
}
.row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--secondary);
}
.row-icon.is-offline {
  background: rgba(251, 191, 36, 0.14);
  color: var(--warning);
}
.row-text {
  flex: 1;
  min-width: 0;
  margin-right: var(--s-2);
}
.row-title {
  font-weight: 600;
  font-size: var(--text-md);
}
.row-desc {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
  line-height: 1.45;
}
.folder-name {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  font-weight: 600;
  font-size: var(--text-md);
}
.folder-path {
  font-size: var(--text-sm);
  color: var(--fg-muted);
  user-select: text;
}
.folder-actions {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  margin-left: var(--s-2);
}
/* Hold the destructive action off the one beside it so it is never a mis-click. */
.folder-actions .danger {
  margin-left: var(--s-1);
}
.about {
  margin-top: var(--s-6);
  font-size: var(--text-xs);
  color: var(--fg-dim);
}
</style>
