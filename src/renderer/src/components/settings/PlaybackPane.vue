<script setup lang="ts">
import type { Settings } from '@shared/types'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import { settings, updateSettings } from '@/composables/useLibrary'
import { osReduced } from '@/composables/useMotion'

type ToggleKey = keyof Pick<Settings, 'hoverPreview' | 'editOnOpen' | 'autoplayNext'>

const toggles: Array<{ key: ToggleKey; icon: string; title: string; description: string }> = [
  {
    key: 'hoverPreview',
    icon: 'eye',
    title: 'Hover to scrub',
    description: 'Move across a card to preview the clip without opening it.'
  },
  {
    key: 'editOnOpen',
    icon: 'scissors',
    title: 'Open clips in edit mode',
    description: 'Start with the trim timeline showing. Press E or Esc to leave it; off, E enters it when you want.'
  },
  {
    key: 'autoplayNext',
    icon: 'list-video',
    title: 'Autoplay next clip',
    description: 'When a clip ends, continue with the next one in the grid.'
  }
]
</script>

<template>
  <div class="stack">
    <SettingsPanel title="Playing clips" description="How the grid and the player behave while you browse." flush>
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
            size="lg"
            :aria-label="t.title"
            @update:model-value="(v: boolean) => updateSettings({ [t.key]: v })"
          />
        </template>
      </SettingsRow>
    </SettingsPanel>

    <SettingsPanel title="Motion" description="Card reveals, view changes and player transitions." flush>
      <SettingsRow
        icon="sparkles"
        title="Animations"
        description="Transform and opacity only — nothing loops in the background while a game runs."
      >
        <template #trailing>
          <USwitch
            :model-value="settings.animations"
            size="lg"
            aria-label="Animations"
            @update:model-value="(v: boolean) => updateSettings({ animations: v })"
          />
        </template>
      </SettingsRow>
      <div v-if="osReduced" class="note">
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Windows is asking for reduced motion"
          description="Animations stay off while that system setting is on, whatever this switch says."
        />
      </div>
    </SettingsPanel>
  </div>
</template>

<style scoped>
.note {
  padding: var(--s-4) var(--s-6);
  border-top: 1px solid var(--border);
}
</style>
