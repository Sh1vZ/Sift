<script setup lang="ts">
import {
  chooseClipsDir,
  clipsFolder,
  defaultClipsDir,
  exportedClips,
  resetClipsDir,
  revealClipsDir
} from '@/composables/useLibrary'
import { computed } from 'vue'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'

const isDefault = computed(
  () => !clipsFolder.value || clipsFolder.value.path.toLowerCase() === defaultClipsDir.value.toLowerCase()
)
const summary = computed(() => {
  const n = exportedClips.value.length
  return n ? `${n} clip${n === 1 ? '' : 's'} exported so far, one sub-folder per game.` : 'Nothing exported yet. The folder is created with your first export.'
})

</script>

<template>
  <div class="stack">
    <SettingsPanel title="Clips folder" :description="summary" flush>
      <template #actions>
        <UButton icon="i-lucide-folder-search" label="Change…" color="primary" @click="chooseClipsDir()" />
      </template>

      <SettingsRow
        v-if="clipsFolder"
        icon="folder-output"
        :tone="!clipsFolder.available && exportedClips.length ? 'warning' : 'default'"
        :title="clipsFolder.name"
      >
        <template #title>
          <div class="folder-name">
            <span class="truncate">{{ clipsFolder.name }}</span>
            <UBadge v-if="isDefault" color="neutral" variant="subtle" size="sm" label="Default" />
            <UBadge
              v-if="!clipsFolder.available && exportedClips.length"
              color="warning"
              variant="subtle"
              size="sm"
              label="Not reachable"
            />
            <UBadge
              v-else-if="!clipsFolder.available"
              color="neutral"
              variant="soft"
              size="sm"
              label="Created on first export"
            />
          </div>
        </template>

        <p class="folder-path truncate" :title="clipsFolder.path">{{ clipsFolder.path }}</p>

        <template #trailing>
          <UBadge color="neutral" variant="soft" size="sm" :label="`${exportedClips.length} clips`" class="mono count" />
          <UTooltip text="Open in Explorer">
            <UButton
              icon="i-lucide-folder-open"
              color="neutral"
              variant="ghost"
              square
              aria-label="Open the clips folder"
              :disabled="!clipsFolder.available"
              @click="revealClipsDir()"
            />
          </UTooltip>
          <UTooltip v-if="!isDefault" text="Back to the default folder">
            <UButton
              icon="i-lucide-rotate-ccw"
              color="neutral"
              variant="ghost"
              square
              aria-label="Reset to the default clips folder"
              @click="resetClipsDir()"
            />
          </UTooltip>
        </template>
      </SettingsRow>
    </SettingsPanel>
  </div>
</template>

<style scoped>
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
</style>
