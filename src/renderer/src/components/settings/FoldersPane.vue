<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LibraryFolder } from '@shared/types'
import DropWash from '../DropWash.vue'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import {
  addFolder,
  folders,
  recordings,
  removeFolder,
  rescan,
  scan,
} from '@/composables/useLibrary'
import { useFolderDrop } from '@/composables/useDropFolders'
import { confirm } from '@/composables/useDialogs'

/** The clips folder has its own pane; this list is the recording roots only. */
const libraryFolders = computed(() => folders.value.filter((f) => f.kind === 'library'))
const withThumbs = computed(() => recordings.value.filter((c) => c.thumb).length)

const summary = computed(() => {
  const f = libraryFolders.value.length
  return `${recordings.value.length} clips indexed across ${f} folder${f === 1 ? '' : 's'} · ${withThumbs.value} with previews. Drop a folder here to add it.`
})

/** Folders whose removal is still stopping watchers and dropping clips; their button spins. */
const removing = ref<string[]>([])

// The whole panel body takes a dropped folder.
const zone = ref<HTMLElement | null>(null)
const { dropping } = useFolderDrop(zone)

async function remove(folder: LibraryFolder): Promise<void> {
  const ok = await confirm({
    title: 'Remove this folder?',
    message: 'Its clips leave the library. Nothing on disk is renamed, moved or deleted.',
    detail: folder.path,
    detailIcon: 'i-lucide-folder',
    confirmLabel: 'Remove',
    danger: true,
  })
  if (!ok) return
  removing.value = [...removing.value, folder.id]
  try {
    await removeFolder(folder)
  } finally {
    removing.value = removing.value.filter((id) => id !== folder.id)
  }
}
</script>

<template>
  <div class="stack">
    <SettingsPanel title="Watched folders" :description="summary" flush>
      <template #actions>
        <UButton
          icon="i-lucide-folder-plus"
          label="Add folder"
          color="primary"
          size="lg"
          @click="addFolder()"
        />
      </template>

      <div ref="zone" class="slot">
        <Transition name="dissolve">
          <UEmpty
            v-if="!libraryFolders.length"
            key="empty"
            class="panel-empty"
            icon="i-lucide-folder"
            title="No folders yet"
            description="Add the one ShadowPlay records to — usually your Videos folder — or drop it here."
            variant="subtle"
            size="sm"
            :actions="[
              { label: 'Add folder', icon: 'i-lucide-folder-plus', onClick: () => addFolder() },
            ]"
          />
          <ul v-else key="rows" class="rows">
            <SettingsRow
              v-for="f in libraryFolders"
              :key="f.id"
              tag="li"
              :icon="f.available ? 'hard-drive' : 'alert'"
              :tone="f.available ? 'default' : 'warning'"
              :title="f.name"
            >
              <template #title>
                <div class="folder-name">
                  <span class="truncate">{{ f.name }}</span>
                  <UBadge
                    v-if="!f.available"
                    color="warning"
                    variant="subtle"
                    size="md"
                    label="Not reachable"
                  />
                  <UBadge
                    v-else-if="scan.active && scan.folder === f.name"
                    color="primary"
                    variant="subtle"
                    size="md"
                    icon="i-lucide-loader-circle"
                    label="Scanning"
                    :ui="{ leadingIcon: 'animate-spin' }"
                  />
                </div>
              </template>

              <p class="folder-path truncate" :title="f.path">{{ f.path }}</p>

              <template #trailing>
                <UBadge
                  color="neutral"
                  variant="soft"
                  size="md"
                  :label="`${f.clipCount} clips`"
                  class="mono count"
                />
                <UTooltip text="Rescan this folder">
                  <UButton
                    icon="i-lucide-refresh-cw"
                    color="neutral"
                    variant="ghost"
                    square
                    size="lg"
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
                    size="lg"
                    :loading="removing.includes(f.id)"
                    :disabled="removing.includes(f.id)"
                    aria-label="Remove folder"
                    @click="remove(f)"
                  />
                </UTooltip>
              </template>
            </SettingsRow>
          </ul>
        </Transition>
        <Transition name="fade">
          <DropWash v-if="dropping" />
        </Transition>
      </div>
    </SettingsPanel>

    <SettingsPanel
      title="Rescan"
      description="Walks every reachable folder again and picks up anything the watcher missed."
    >
      <UButton
        icon="i-lucide-refresh-cw"
        label="Rescan all folders"
        color="neutral"
        variant="subtle"
        size="lg"
        :disabled="!libraryFolders.length || scan.active"
        :loading="scan.active"
        @click="rescan()"
      />
    </SettingsPanel>
  </div>
</template>

<style scoped>
/* Holds the box the list and the empty state animate inside; without it the
   leaving one, which goes absolute mid-transition, would anchor to the window. */
.slot {
  position: relative;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.panel-empty {
  padding: var(--s-6);
}
.folder-name {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  font-weight: 600;
  font-size: var(--text-md);
}
.folder-path {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
  user-select: text;
}
.count {
  margin-right: var(--s-2);
}
/* Hold the destructive action off the one beside it so it is never a mis-click. */
.danger {
  margin-left: var(--s-1);
}
</style>
