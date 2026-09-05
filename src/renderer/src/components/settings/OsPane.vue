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
        id="minimize-to-tray"
        icon="tray"
        title="Minimize to the tray instead of quitting"
        description="Sift keeps watching your folders and finishing exports while the window is away. Open it again from the tray icon."
      >
        <template #trailing>
          <USwitch
            :model-value="settings.minimizeToTray"
            aria-label="Minimize to the tray instead of quitting"
            @update:model-value="(v: boolean) => updateSettings({ minimizeToTray: v })"
          />
        </template>
      </SettingsRow>
      <template v-if="settings.minimizeToTray" #note>
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-app-window"
          title="Quitting is now a tray job"
          description="Right-click Sift in the notification area and choose Quit Sift. Windows may keep the icon hidden behind the ‹ chevron until you drag it out."
        />
      </template>
    </SettingsPanel>
  </div>
</template>
