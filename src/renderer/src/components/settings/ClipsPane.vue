<script setup lang="ts">
import {
  chooseClipsDir,
  clipsFolder,
  defaultClipsDir,
  exportedClips,
  resetClipsDir,
  revealClipsDir,
} from '@/composables/useLibrary'
import { computed } from 'vue'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'

const isDefault = computed(
  () =>
    !clipsFolder.value ||
    clipsFolder.value.path.toLowerCase() === defaultClipsDir.value.toLowerCase(),
)
const summary = computed(() => {
  const n = exportedClips.value.length
  return n
    ? `${n} clip${n === 1 ? '' : 's'} exported so far, one sub-folder per game.`
    : 'No clips exported yet. The folder is created with your first export.'
})
</script>

<template>
  <div class="stack">
    <SettingsPanel title="Clips folder" :description="summary" flush>
      <template #actions>
        <UButton
          icon="i-lucide-folder-search"
          label="Change…"
          color="primary"
          @click="chooseClipsDir()"
        />
      </template>

      <SettingsRow
        v-if="clipsFolder"
        id="clips-folder"
        icon="folder-output"
        :tone="!clipsFolder.available && exportedClips.length ? 'warning' : 'default'"
        :title="clipsFolder.name"
        :path="clipsFolder.path"
      >
        <template #badges>
          <UBadge v-if="isDefault" color="neutral" variant="subtle" label="Default" />
          <UBadge
            v-if="!clipsFolder.available && exportedClips.length"
            color="warning"
            variant="subtle"
            label="Not reachable"
          />
          <UBadge
            v-else-if="!clipsFolder.available"
            color="neutral"
            variant="soft"
            label="Created on first export"
          />
        </template>

        <template #trailing>
          <UBadge
            color="neutral"
            variant="soft"
            :label="`${exportedClips.length} clips`"
            class="mono count"
          />
          <UButton
            icon="i-lucide-folder-open"
            label="Open folder"
            color="neutral"
            variant="subtle"
            size="sm"
            :disabled="!clipsFolder.available"
            @click="revealClipsDir()"
          />
          <UButton
            v-if="!isDefault"
            icon="i-lucide-rotate-ccw"
            label="Reset"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Reset to the default clips folder"
            @click="resetClipsDir()"
          />
        </template>
      </SettingsRow>
    </SettingsPanel>
  </div>
</template>

<style scoped>
.count {
  margin-right: var(--s-1);
}
</style>
