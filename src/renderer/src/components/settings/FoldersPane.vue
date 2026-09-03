<script setup lang="ts">
import { computed } from 'vue'
import type { LibraryFolder } from '@shared/types'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import { addFolder, allClips, folders, removeFolder, rescan, scan } from '@/composables/useLibrary'
import { confirm } from '@/composables/useDialogs'

const withThumbs = computed(() => allClips.value.filter((c) => c.thumb).length)

const summary = computed(() => {
  const f = folders.value.length
  return `${allClips.value.length} clips indexed across ${f} folder${f === 1 ? '' : 's'} · ${withThumbs.value} with previews.`
})

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
  <div class="stack">
    <SettingsPanel title="Watched folders" :description="summary" flush>
      <template #actions>
        <UButton icon="i-lucide-folder-plus" label="Add folder" color="primary" @click="addFolder()" />
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
        <SettingsRow
          v-for="f in folders"
          :key="f.id"
          tag="li"
          :icon="f.available ? 'hard-drive' : 'alert'"
          :tone="f.available ? 'default' : 'warning'"
          :title="f.name"
        >
          <template #title>
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
          </template>

          <p class="folder-path truncate" :title="f.path">{{ f.path }}</p>

          <template #trailing>
            <UBadge color="neutral" variant="soft" size="sm" :label="`${f.clipCount} clips`" class="mono count" />
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
          </template>
        </SettingsRow>
      </ul>
    </SettingsPanel>

    <SettingsPanel title="Rescan" description="Walks every reachable folder again and picks up anything the watcher missed.">
      <UButton
        icon="i-lucide-refresh-cw"
        label="Rescan all folders"
        color="neutral"
        variant="subtle"
        :disabled="!folders.length || scan.active"
        :loading="scan.active"
        @click="rescan()"
      />
    </SettingsPanel>
  </div>
</template>

<style scoped>
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
