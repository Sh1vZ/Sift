<script setup lang="ts">
import { computed } from 'vue'
import type { Settings } from '@shared/types'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import { allClips, folders, scan, settings, updateSettings } from '@/composables/useLibrary'

type ToggleKey = keyof Pick<Settings, 'watchFolders' | 'generateThumbnails'>

const toggles: Array<{ key: ToggleKey; icon: string; title: string; description: string }> = [
  {
    key: 'watchFolders',
    icon: 'radar',
    title: 'Watch folders',
    description:
      'Pick up new recordings the moment they finish writing. Uses a lightweight OS file watcher.',
  },
  {
    key: 'generateThumbnails',
    icon: 'image',
    title: 'Generate thumbnails',
    description:
      'Poster frames and hover-scrub strips are rendered once by ffmpeg at low CPU priority and cached.',
  },
]

const workerOptions = [1, 2, 3, 4].map((n) => ({
  label: `${n} worker${n === 1 ? '' : 's'}`,
  value: n,
}))

const pending = computed(() => allClips.value.filter((c) => c.probeState === 'pending').length)
</script>

<template>
  <div class="stack">
    <Transition name="collapse">
      <div v-if="scan.active || scan.pending">
        <div class="collapse-body">
          <UAlert
            color="primary"
            variant="subtle"
            icon="i-lucide-loader-circle"
            :title="scan.active ? `Scanning ${scan.folder}` : 'Building previews'"
            :description="
              scan.active
                ? `${scan.found} new clip${scan.found === 1 ? '' : 's'} found so far.`
                : `${scan.pending} clip${scan.pending === 1 ? '' : 's'} still queued.`
            "
            :ui="{ icon: 'animate-spin' }"
          />
        </div>
      </div>
    </Transition>

    <SettingsPanel
      title="Indexing"
      description="How Sift notices new recordings and turns them into cards."
      flush
    >
      <SettingsRow
        v-for="t in toggles"
        :key="t.key"
        :icon="t.icon"
        :title="t.title"
        :description="t.description"
      >
        <template #trailing>
          <USwitch
            :model-value="settings[t.key]"
            :aria-label="t.title"
            @update:model-value="(v: boolean) => updateSettings({ [t.key]: v })"
          />
        </template>
      </SettingsRow>

      <SettingsRow
        icon="cpu"
        title="Preview workers"
        description="How many clips are processed at once. Keep it low while gaming; raise it to chew through a big backlog faster."
      >
        <template #trailing>
          <USelect
            :model-value="settings.concurrency"
            :items="workerOptions"
            icon="i-lucide-cpu"
            class="w-36"
            aria-label="Preview workers"
            @update:model-value="(v: number) => updateSettings({ concurrency: v })"
          />
        </template>
      </SettingsRow>
    </SettingsPanel>

    <SettingsPanel
      title="Queue"
      description="What the preview workers still have in front of them."
      flush
    >
      <SettingsRow
        icon="timer"
        title="Waiting to be probed"
        :description="
          folders.length
            ? 'Duration, resolution and codec are read by ffprobe the first time a clip is seen.'
            : 'Nothing is indexed yet — add a folder first.'
        "
        :value="String(pending)"
      />
      <SettingsRow
        icon="film"
        title="Clips indexed"
        description="Every recording Sift currently knows about."
        :value="String(allClips.length)"
      />
    </SettingsPanel>
  </div>
</template>
