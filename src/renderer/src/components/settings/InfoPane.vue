<script setup lang="ts">
import { computed, onMounted } from 'vue'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import { appVersion, now } from '@/composables/useLibrary'
import { appStats, refreshStats, statsError, statsLoading } from '@/composables/useStats'
import { formatBytes, formatRelative, formatSpan } from '@/utils/format'

const measuredLabel = computed(() =>
  appStats.value ? `Measured ${formatRelative(appStats.value.generatedAtMs, now.value).toLowerCase()}` : 'Measuring…'
)

onMounted(() => {
  if (!appStats.value) void refreshStats()
})
</script>

<template>
  <div class="stack">
    <SettingsPanel title="App" description="This build and what it is currently using." flush>
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

      <UAlert
        v-if="statsError && !appStats"
        class="panel-alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Could not read the runtime details"
        :description="statsError"
        :actions="[{ label: 'Try again', color: 'neutral', variant: 'subtle', onClick: () => refreshStats() }]"
      />
      <div v-else-if="!appStats" class="skeletons">
        <div v-for="i in 4" :key="i" class="skeleton-row">
          <USkeleton class="size-9 rounded-lg" />
          <div class="skeleton-text">
            <USkeleton class="h-4 w-44" />
            <USkeleton class="mt-2 h-3 w-72" />
          </div>
          <USkeleton class="h-5 w-14" />
        </div>
      </div>
      <template v-else>
        <SettingsRow
          icon="package"
          :title="`Sift ${appStats.runtime.appVersion}`"
          :description="`Electron ${appStats.runtime.electron} · Chromium ${appStats.runtime.chrome} · Node ${appStats.runtime.node}`"
        >
          <template #trailing>
            <UBadge color="neutral" variant="subtle" size="sm" :label="appStats.runtime.platform" class="mono" />
          </template>
        </SettingsRow>

        <SettingsRow
          icon="memory"
          title="Memory in use"
          :description="`Working set across ${appStats.runtime.processCount} process${appStats.runtime.processCount === 1 ? '' : 'es'}.`"
          :value="formatBytes(appStats.runtime.memoryBytes)"
        />

        <SettingsRow
          icon="activity"
          title="Running for"
          :description="measuredLabel"
          :value="formatSpan(appStats.runtime.uptimeMs / 1000)"
        />

        <SettingsRow
          :icon="appStats.runtime.ffmpeg ? 'zap' : 'alert'"
          :tone="appStats.runtime.ffmpeg ? 'default' : 'warning'"
          title="Bundled ffmpeg"
          :description="
            appStats.runtime.ffmpeg
              ? 'Probing and preview generation are available.'
              : 'Not found — durations and previews cannot be generated.'
          "
        >
          <template #trailing>
            <UBadge
              :color="appStats.runtime.ffmpeg ? 'primary' : 'warning'"
              variant="subtle"
              size="sm"
              :label="appStats.runtime.ffmpeg ? 'Ready' : 'Missing'"
            />
          </template>
        </SettingsRow>
      </template>
    </SettingsPanel>

    <SettingsPanel title="Local-first" description="What Sift does and does not do with your recordings." flush>
      <SettingsRow
        icon="hard-drive"
        title="Files stay put"
        description="Clips are read where they live. Sift never copies, moves, renames or re-encodes a recording unless you ask it to."
      />
      <SettingsRow
        icon="database"
        title="Nothing is uploaded"
        description="The index, the previews and every number on these screens are built and kept on this PC."
      />
    </SettingsPanel>

    <p class="about">Sift {{ appVersion }} · Local-first, nothing leaves your PC.</p>
  </div>
</template>

<style scoped>
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
.about {
  font-size: var(--text-xs);
  color: var(--fg-dim);
}
</style>
