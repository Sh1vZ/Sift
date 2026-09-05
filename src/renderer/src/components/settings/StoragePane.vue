<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import { now } from '@/composables/useLibrary'
import {
  appStats,
  clearPreviews,
  libraryTotals,
  refreshStats,
  revealAppData,
  statsError,
  statsLoading,
} from '@/composables/useStats'
import { formatBytes, formatRelative } from '@/utils/format'
import { formatBitrate } from '@/utils/quality'

const n = new Intl.NumberFormat()

/** Everything Sift itself keeps under the app-data folder. */
const appDataBytes = computed(() => {
  const s = appStats.value?.storage
  if (!s) return 0
  return s.databaseBytes + s.cacheBytes + s.otherBytes
})

const diskUsedPct = computed(() => {
  const s = appStats.value?.storage
  if (!s?.diskTotalBytes) return 0
  return Math.round(((s.diskTotalBytes - s.diskFreeBytes) / s.diskTotalBytes) * 100)
})

const measuredLabel = computed(() =>
  appStats.value
    ? `Measured ${formatRelative(appStats.value.generatedAtMs, now.value).toLowerCase()}`
    : 'Measuring…',
)

const clearing = ref(false)
async function onClearPreviews(): Promise<void> {
  clearing.value = true
  try {
    await clearPreviews()
  } finally {
    clearing.value = false
  }
}

// Walking the app-data folder is on-demand, so only measure if nothing is cached.
onMounted(() => {
  if (!appStats.value) void refreshStats()
})
</script>

<template>
  <div class="stack">
    <SettingsPanel title="On disk" :description="measuredLabel" flush>
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          label="Refresh"
          color="neutral"
          variant="subtle"
          :loading="statsLoading"
          @click="refreshStats()"
        />
      </template>

      <div class="slot">
        <Transition name="dissolve">
          <UAlert
            v-if="statsError"
            key="error"
            class="panel-alert"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Could not measure the app data folder"
            :description="statsError"
            :actions="[
              {
                label: 'Try again',
                color: 'neutral',
                variant: 'subtle',
                onClick: () => refreshStats(),
              },
            ]"
          />
          <div v-else-if="!appStats" key="loading" class="skeletons">
            <div v-for="i in 4" :key="i" class="skeleton-row">
              <USkeleton class="size-9 rounded-lg" />
              <div class="skeleton-text">
                <USkeleton class="h-4 w-40" />
                <USkeleton class="mt-2 h-3 w-64" />
              </div>
              <USkeleton class="h-5 w-16" />
            </div>
          </div>
          <div v-else key="rows">
            <SettingsRow
              id="storage-recordings"
              icon="film"
              title="Recordings on disk"
              :description="`Across ${libraryTotals.folders} watched folder${libraryTotals.folders === 1 ? '' : 's'}. Indexed in place — never copied, moved or re-encoded.`"
              :value="formatBytes(libraryTotals.bytes)"
            />

            <SettingsRow
              v-if="libraryTotals.avgBitrate"
              id="storage-bitrate"
              icon="activity"
              title="Average bitrate"
              description="Size against duration across every probed clip. A high figure means a generous capture setting — it is what makes the library big, not what makes a clip look good."
              :value="formatBitrate(libraryTotals.avgBitrate)"
            />

            <SettingsRow
              id="storage-previews"
              icon="image"
              title="Preview cache"
              :description="`${n.format(appStats.storage.cacheFiles)} poster frames and hover-scrub strips, generated once and reused.`"
              :value="formatBytes(appStats.storage.cacheBytes)"
            >
              <template #trailing>
                <UButton
                  icon="i-lucide-eraser"
                  label="Clear previews"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  :disabled="!appStats.storage.cacheFiles"
                  :loading="clearing"
                  @click="onClearPreviews()"
                />
              </template>
            </SettingsRow>

            <SettingsRow
              id="storage-database"
              icon="database"
              title="Index database"
              :description="`SQLite record of ${n.format(libraryTotals.clips)} clip${libraryTotals.clips === 1 ? '' : 's'}, including the write-ahead log.`"
              :value="formatBytes(appStats.storage.databaseBytes)"
            />

            <SettingsRow
              id="storage-appdata"
              icon="box"
              title="App data"
              :path="appStats.storage.userDataPath"
              :value="formatBytes(appDataBytes)"
            >
              <template #trailing>
                <UButton
                  icon="i-lucide-folder-open"
                  label="Open folder"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  aria-label="Open the app data folder"
                  @click="revealAppData()"
                />
              </template>
            </SettingsRow>

            <SettingsRow
              v-if="appStats.storage.diskTotalBytes"
              id="storage-free"
              icon="gauge"
              title="Free on this drive"
              :description="`${formatBytes(appStats.storage.diskFreeBytes)} free of ${formatBytes(appStats.storage.diskTotalBytes)} · ${diskUsedPct}% used`"
            >
              <UProgress
                class="row-progress"
                size="xs"
                :model-value="diskUsedPct"
                :color="diskUsedPct >= 90 ? 'warning' : 'primary'"
                :aria-label="`Drive ${diskUsedPct}% full`"
              />
            </SettingsRow>
          </div>
        </Transition>
      </div>
    </SettingsPanel>

    <p class="about">Measured locally. Nothing on this screen leaves your PC.</p>
  </div>
</template>

<style scoped>
/* Holds the box the skeletons and the loaded rows animate inside. */
.slot {
  position: relative;
}
.panel-alert {
  margin: var(--s-5) var(--s-6);
}
.skeletons {
  padding: var(--s-2) 0;
}
.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-6);
}
.skeleton-text {
  flex: 1;
  min-width: 0;
}
.row-progress {
  margin-top: var(--s-2);
  max-width: 320px;
}
.about {
  font-size: var(--text-xs);
  color: var(--fg-dim);
}
</style>
