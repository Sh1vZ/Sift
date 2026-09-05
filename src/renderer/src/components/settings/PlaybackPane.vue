<script setup lang="ts">
import type { Settings } from '@shared/types'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import { settings, updateSettings } from '@/composables/useLibrary'
import { osReduced } from '@/composables/useMotion'
import { openShortcuts } from '@/composables/useShortcuts'

type ToggleKey = keyof Pick<Settings, 'hoverPreview' | 'editOnOpen' | 'autoplayNext'>

const toggles: Array<{
  key: ToggleKey
  id: string
  icon: string
  title: string
  description: string
}> = [
  {
    key: 'hoverPreview',
    id: 'hover-scrub',
    icon: 'eye',
    title: 'Hover to scrub',
    description: 'Move across a card to preview the clip without opening it.',
  },
  {
    key: 'editOnOpen',
    id: 'edit-on-open',
    icon: 'scissors',
    title: 'Open clips in edit mode',
    description:
      'Start with the trim timeline showing. Press E or Esc to cancel the trim; off, E enters it when you want.',
  },
  {
    key: 'autoplayNext',
    id: 'autoplay-next',
    icon: 'list-video',
    title: 'Autoplay next clip',
    description: 'When a clip ends, continue with the next one in the grid.',
  },
]

/**
 * ShadowPlay and OBS write game audio and the mic as separate tracks. Track
 * numbers rather than names because the recorder tags neither: which is which
 * is a per-setup fact the player's mixer shows in full.
 */
const audioTrackOptions = [
  { label: 'All tracks', value: -1 },
  { label: 'Track 1', value: 0 },
  { label: 'Track 2', value: 1 },
  { label: 'Track 3', value: 2 },
]
</script>

<template>
  <div class="stack">
    <SettingsPanel
      title="Playing clips"
      description="How the grid and the player behave while you browse."
      flush
    >
      <SettingsRow
        v-for="t in toggles"
        :id="t.id"
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
        id="default-audio-track"
        icon="audio-lines"
        title="Default audio track"
        description="Which track a clip with several starts on — ShadowPlay and OBS record game audio and mic apart. Name the tracks and mix them from the player's audio button."
      >
        <template #trailing>
          <USelect
            :model-value="settings.defaultAudioTrack"
            :items="audioTrackOptions"
            icon="i-lucide-audio-lines"
            class="w-40"
            aria-label="Default audio track"
            @update:model-value="(v: number) => updateSettings({ defaultAudioTrack: v })"
          />
        </template>
      </SettingsRow>
    </SettingsPanel>

    <SettingsPanel
      title="Keyboard"
      description="Sift is built to be driven without the mouse."
      flush
    >
      <SettingsRow
        id="shortcuts"
        icon="keyboard"
        title="Keyboard shortcuts"
        description="Every key for the library, the player and edit mode. Press ? anywhere to see them."
      >
        <template #trailing>
          <UButton
            icon="i-lucide-keyboard"
            label="Show shortcuts"
            color="neutral"
            variant="subtle"
            @click="openShortcuts()"
          />
        </template>
      </SettingsRow>
    </SettingsPanel>

    <SettingsPanel
      title="Motion"
      description="Card reveals, view changes and player transitions."
      flush
    >
      <SettingsRow
        id="animations"
        icon="sparkles"
        title="Animations"
        description="Transform and opacity only — nothing loops in the background while a game runs."
      >
        <template #trailing>
          <USwitch
            :model-value="settings.animations"
            aria-label="Animations"
            @update:model-value="(v: boolean) => updateSettings({ animations: v })"
          />
        </template>
      </SettingsRow>
      <template v-if="osReduced" #note>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Windows is asking for reduced motion"
          description="Animations stay off while that system setting is on, whatever this switch says."
        />
      </template>
    </SettingsPanel>
  </div>
</template>
