<script setup lang="ts">
import { onMounted } from 'vue'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import LibraryView from './components/LibraryView.vue'
import ClipsView from './components/ClipsView.vue'
import SettingsView from './components/SettingsView.vue'
import PlayerOverlay from './components/PlayerOverlay.vue'
import DialogHost from './components/DialogHost.vue'
import ToastBridge from './components/ToastBridge.vue'
import { initLibrary, initialExports, ready, view } from '@/composables/useLibrary'
import { initExports } from '@/composables/useExports'
import { isOpen } from '@/composables/usePlayer'
// Side-effect import: applies the persisted theme to <html> before first paint.
import '@/composables/useTheme'

onMounted(async () => {
  await initLibrary()
  initExports(initialExports.value)
})
</script>

<template>
  <UApp :toaster="{ position: 'bottom-right', duration: 4500, expand: true }" :tooltip="{ delayDuration: 250 }">
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
