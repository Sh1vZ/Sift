<script setup lang="ts">
import { onMounted } from 'vue'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import LibraryView from './components/LibraryView.vue'
import SettingsView from './components/SettingsView.vue'
import PlayerOverlay from './components/PlayerOverlay.vue'
import DialogHost from './components/DialogHost.vue'
import ToastBridge from './components/ToastBridge.vue'
import { initLibrary, ready, view } from '@/composables/useLibrary'
import { isOpen } from '@/composables/usePlayer'

onMounted(() => void initLibrary())
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
  background:
    radial-gradient(1200px 600px at 80% -10%, rgba(124, 58, 237, 0.14), transparent 60%),
    radial-gradient(800px 500px at -10% 110%, rgba(244, 63, 94, 0.07), transparent 60%),
    var(--bg-1);
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
