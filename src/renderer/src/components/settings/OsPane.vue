<script setup lang="ts">
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import { settings, updateSettings } from '@/composables/useLibrary'
</script>

<template>
  <div class="stack">
    <SettingsPanel
      title="Closing the window"
      description="Whether the X ends Sift or just puts it away."
      flush
    >
      <SettingsRow
        icon="tray"
        title="Minimize to the tray instead of quitting"
        description="Sift keeps watching your folders and finishing exports while the window is away. Open it again from the tray icon."
      >
        <template #trailing>
          <USwitch
            :model-value="settings.minimizeToTray"
            size="lg"
            aria-label="Minimize to the tray instead of quitting"
            @update:model-value="(v: boolean) => updateSettings({ minimizeToTray: v })"
          />
        </template>
      </SettingsRow>
      <div v-if="settings.minimizeToTray" class="note">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-app-window"
          title="Quitting is now a tray job"
          description="Right-click Sift in the notification area and choose Quit Sift. Windows may keep the icon hidden behind the ‹ chevron until you drag it out."
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
