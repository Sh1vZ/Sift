<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted } from 'vue'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import LibraryView from './components/LibraryView.vue'
import ClipsView from './components/ClipsView.vue'
import FavouritesView from './components/FavouritesView.vue'
import SettingsView from './components/SettingsView.vue'
import ActivityView from './components/ActivityView.vue'
import PlayerView from './components/PlayerView.vue'
import DialogHost from './components/DialogHost.vue'
import ToastBridge from './components/ToastBridge.vue'
import WhatsNewDialog from './components/WhatsNewDialog.vue'
import ShortcutsDialog from './components/ShortcutsDialog.vue'
import SearchDialog from './components/SearchDialog.vue'
import UploadDialog from './components/youtube/UploadDialog.vue'
import GifPreviewDialog from './components/GifPreviewDialog.vue'
import { initLibrary, initialActivity, initialExports, ready, view } from '@/composables/useLibrary'
import { initActivityHistory } from '@/composables/useActivityHistory'
import { initExports } from '@/composables/useExports'
import { initGifPreview } from '@/composables/useGifPreview'
import { initUpdates } from '@/composables/useUpdates'
import { initUploads } from '@/composables/useUploads'
import { initYouTube } from '@/composables/useYouTube'
import { fullscreen, isOpen } from '@/composables/usePlayer'
import { openSettings } from '@/composables/useSettings'
import { installShortcuts } from '@/composables/useShortcuts'
import { installDropGuard } from '@/composables/useDropFolders'
import { initWindowVisibility } from '@/composables/useWindowVisibility'
// Side-effect import: applies the persisted theme to <html> before first paint.
import '@/composables/useTheme'

let offShortcuts: (() => void) | null = null
let offDropGuard: (() => void) | null = null

onMounted(async () => {
  // The tray's Settings item. Subscribed here rather than in useLibrary because
  // useSettings already imports from it; App is the root, so it never unmounts.
  window.api.on('app:open-settings', () => openSettings('os'))
  // Same reason: the window can hide at any point, so the subscription has to
  // outlive every view.
  initWindowVisibility()
  offShortcuts = installShortcuts()
  offDropGuard = installDropGuard()
  try {
    await initLibrary()
    initExports(initialExports.value)
    initGifPreview()
    initActivityHistory(initialActivity.value)
    // Seeded from main like the updater: neither is part of the library snapshot.
    await initYouTube()
    await initUploads()
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

onBeforeUnmount(() => {
  offShortcuts?.()
  offDropGuard?.()
})
</script>

<template>
  <UApp
    :toaster="{ position: 'bottom-right', duration: 4500, expand: true }"
    :tooltip="{ delayDuration: 250 }"
  >
    <div class="app">
      <!-- Fullscreen is the player's: the chrome steps out so the main area,
           and the page in it, is the whole screen. -->
      <TitleBar v-show="!fullscreen" />
      <Transition name="fade">
        <div v-if="ready" class="body">
          <Sidebar v-show="!fullscreen" />
          <main class="main">
            <!-- The screen stays mounted under an open clip, inert, so the
                 close flip has its card to land on and the scroll is kept. -->
            <div class="screen" :inert="isOpen">
              <Transition name="view" mode="out-in">
                <LibraryView v-if="view === 'library'" key="library" />
                <ClipsView v-else-if="view === 'clips'" key="clips" />
                <FavouritesView v-else-if="view === 'favourites'" key="favourites" />
                <ActivityView v-else-if="view === 'activity'" key="activity" />
                <SettingsView v-else key="settings" />
              </Transition>
            </div>
            <Transition name="fade">
              <PlayerView v-if="isOpen" />
            </Transition>
          </main>
        </div>
      </Transition>
      <DialogHost />
      <WhatsNewDialog />
      <ShortcutsDialog />
      <SearchDialog />
      <UploadDialog />
      <GifPreviewDialog />
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
  /* Named so the player page can size its pane to the width it actually has. */
  container: main / inline-size;
}
.screen {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
</style>
