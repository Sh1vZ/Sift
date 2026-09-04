<script setup lang="ts">
import { nextTick, onMounted } from 'vue'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import LibraryView from './components/LibraryView.vue'
import ClipsView from './components/ClipsView.vue'
import SettingsView from './components/SettingsView.vue'
import PlayerOverlay from './components/PlayerOverlay.vue'
import DialogHost from './components/DialogHost.vue'
import ToastBridge from './components/ToastBridge.vue'
import WhatsNewDialog from './components/WhatsNewDialog.vue'
import { initLibrary, initialExports, ready, view } from '@/composables/useLibrary'
import { initExports } from '@/composables/useExports'
import { initUpdates } from '@/composables/useUpdates'
import { isOpen } from '@/composables/usePlayer'
import { openSettings } from '@/composables/useSettings'
import { initWindowVisibility } from '@/composables/useWindowVisibility'
// Side-effect import: applies the persisted theme to <html> before first paint.
import '@/composables/useTheme'

onMounted(async () => {
  // The tray's Settings item. Subscribed here rather than in useLibrary because
  // useSettings already imports from it; App is the root, so it never unmounts.
  window.api.on('app:open-settings', () => openSettings('os'))
  // Same reason: the window can hide at any point, so the subscription has to
  // outlive every view.
  initWindowVisibility()
  try {
    await initLibrary()
    initExports(initialExports.value)
    // Not awaited: the splash must not wait on the updater, and a failure here
    // is never a reason to hold up the library.
    void initUpdates()
  } finally {
    // The launch splash holds the screen until this lands: one frame after the
    // first real render, so the window is never revealed mid-paint. In the
    // `finally` on purpose — a boot that failed still has to reach the user.
    await nextTick()
    requestAnimationFrame(() => window.api.window.ready())
  }
})
</script>

<template>
  <UApp
    :toaster="{ position: 'bottom-right', duration: 4500, expand: true }"
    :tooltip="{ delayDuration: 250 }"
  >
    <div class="app">
      <TitleBar />
      <Transition name="fade">
        <div v-if="ready" class="body" :inert="isOpen">
          <Sidebar />
          <main class="main">
            <Transition name="view" mode="out-in">
              <LibraryView v-if="view === 'library'" key="library" />
              <ClipsView v-else-if="view === 'clips'" key="clips" />
              <SettingsView v-else key="settings" />
            </Transition>
          </main>
        </div>
      </Transition>
      <Transition name="fade">
        <PlayerOverlay v-if="isOpen" />
      </Transition>
      <DialogHost />
      <WhatsNewDialog />
      <ToastBridge />
    </div>
  </UApp>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* The washes live in tokens.css so each theme can recolour or drop them. */
  background: var(--app-wash), var(--bg-1);
}
.body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
</style>
