<script setup lang="ts">
import { computed, onMounted } from 'vue'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import { appVersion, now, settings, updateSettings } from '@/composables/useLibrary'
import { appStats, refreshStats, statsError, statsLoading } from '@/composables/useStats'
import {
  canUpdate,
  checkForUpdates,
  checking,
  installUpdate,
  openChangelog,
  releaseUrl,
  update,
  updateReady,
} from '@/composables/useUpdates'
import { formatBytes, formatRelative, formatSpan } from '@/utils/format'

const measuredLabel = computed(() =>
  appStats.value
    ? `Measured ${formatRelative(appStats.value.generatedAtMs, now.value).toLowerCase()}`
    : 'Measuring…',
)

const updateIcon = computed(() => {
  switch (update.value.status) {
    case 'downloaded':
      return 'check'
    case 'error':
      return 'alert'
    case 'checking':
    case 'downloading':
      return 'loader'
    default:
      return 'package'
  }
})

const updateTitle = computed(() => {
  const u = update.value
  switch (u.status) {
    case 'unsupported':
      return 'Updates are off in a development build'
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Sift ${u.version} found`
    case 'downloading':
      return `Downloading Sift ${u.version}`
    case 'downloaded':
      return `Sift ${u.version} is ready`
    case 'up-to-date':
      return 'Sift is up to date'
    case 'error':
      return 'Could not check for updates'
    default:
      return `Sift ${u.currentVersion || appVersion.value}`
  }
})

const updateDescription = computed(() => {
  const u = update.value
  switch (u.status) {
    case 'unsupported':
      return 'A packaged build checks GitHub for new versions and installs them in the background.'
    case 'downloading':
      return u.bytesPerSecond ? `${formatBytes(u.bytesPerSecond)}/s` : 'Starting…'
    case 'downloaded':
      return 'Restarting takes a few seconds. Your library and exports are untouched.'
    case 'error':
      return u.error
    default:
      // A background check that failed keeps its reason here rather than raising
      // an alarm the user never asked for.
      if (u.error) return u.error
      return u.checkedAtMs
        ? `Checked ${formatRelative(u.checkedAtMs, now.value).toLowerCase()}`
        : 'New versions are downloaded in the background.'
  }
})

/** Only worth showing while an update is actually on the table. */
const showNotes = computed(
  () =>
    Boolean(update.value.notes) &&
    ['available', 'downloading', 'downloaded'].includes(update.value.status),
)

onMounted(() => {
  if (!appStats.value) void refreshStats()
})
</script>

<template>
  <div class="stack">
    <SettingsPanel title="Updates" description="Sift keeps itself current in the background." flush>
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          label="Check now"
          color="neutral"
          variant="subtle"
          :loading="checking"
          :disabled="!canUpdate"
          @click="checkForUpdates()"
        />
      </template>

      <SettingsRow
        id="updates"
        :icon="updateIcon"
        :tone="update.status === 'error' ? 'warning' : 'default'"
        :title="updateTitle"
        :description="updateDescription"
      >
        <template #trailing>
          <!-- The one action that restarts the app sits with the row that
               announces it, away from the harmless Check now above. -->
          <UButton
            v-if="updateReady"
            icon="i-lucide-circle-arrow-up"
            label="Restart now"
            color="primary"
            variant="solid"
            @click="installUpdate()"
          />
          <UBadge
            v-else-if="update.status === 'up-to-date'"
            color="neutral"
            variant="subtle"
            size="sm"
            label="Up to date"
          />
        </template>

        <UProgress
          v-if="update.status === 'downloading'"
          class="mt-3"
          :model-value="Math.round(update.progress * 100)"
          size="sm"
        />
        <template v-if="showNotes">
          <div class="notes">
            <!-- Plain text: main flattens the HTML the release feed serves, so
                 there is never markup here to render. -->
            <pre class="notes-body">{{ update.notes }}</pre>
          </div>
        </template>
        <div class="notes-links">
          <UButton
            label="Full changelog"
            icon="i-lucide-history"
            color="neutral"
            variant="link"
            size="sm"
            @click="openChangelog()"
          />
          <!-- target=_blank so setWindowOpenHandler sends it to the browser; a
               plain link would navigate the app window. -->
          <a class="notes-link" :href="releaseUrl" target="_blank" rel="noreferrer">Release page</a>
        </div>
      </SettingsRow>

      <SettingsRow
        id="auto-updates"
        icon="download"
        title="Check for updates automatically"
        description="Looks for a new version shortly after launch and every few hours. Check now always works."
      >
        <template #trailing>
          <USwitch
            :model-value="settings.autoCheckUpdates"
            aria-label="Check for updates automatically"
            @update:model-value="(v: boolean) => updateSettings({ autoCheckUpdates: v })"
          />
        </template>
      </SettingsRow>
    </SettingsPanel>

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

      <div class="slot">
        <Transition name="dissolve">
          <UAlert
            v-if="statsError && !appStats"
            key="error"
            class="panel-alert"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Could not read the runtime details"
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
                <USkeleton class="h-4 w-44" />
                <USkeleton class="mt-2 h-3 w-72" />
              </div>
              <USkeleton class="h-5 w-14" />
            </div>
          </div>
          <div v-else key="rows">
            <SettingsRow
              id="app-runtime"
              icon="package"
              :title="`Sift ${appStats.runtime.appVersion}`"
              :description="`Electron ${appStats.runtime.electron} · Chromium ${appStats.runtime.chrome} · Node ${appStats.runtime.node}`"
            >
              <template #trailing>
                <UBadge
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  :label="appStats.runtime.platform"
                  class="mono"
                />
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
          </div>
        </Transition>
      </div>
    </SettingsPanel>

    <SettingsPanel
      title="Local-first"
      description="What Sift does and does not do with your recordings."
      flush
    >
      <SettingsRow
        id="local-first"
        icon="hard-drive"
        title="Files stay put"
        description="Clips are read where they live. Sift never copies, moves, renames or re-encodes a recording unless you ask it to."
      />
      <SettingsRow
        icon="database"
        title="Nothing is uploaded unless you say so"
        description="The index, the previews and every number on these screens are built and kept on this PC. The only thing that ever leaves is a clip you send to YouTube yourself, through your own Google project."
      />
    </SettingsPanel>

    <p class="about">Sift {{ appVersion }} · Local-first, nothing leaves your PC unasked.</p>
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
.notes {
  margin-top: var(--s-3);
  max-height: 180px;
  overflow-y: auto;
  padding: var(--s-3);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-2);
}
.notes-body {
  margin: 0;
  font-family: inherit;
  font-size: var(--text-base);
  line-height: 1.5;
  color: var(--fg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.notes-links {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  margin-top: var(--s-2);
}
.notes-link {
  font-size: var(--text-sm);
  color: var(--secondary);
}
.notes-link:hover {
  text-decoration: underline;
}
.about {
  font-size: var(--text-xs);
  color: var(--fg-dim);
}
</style>
