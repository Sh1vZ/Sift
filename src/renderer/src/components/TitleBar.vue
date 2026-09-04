<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { goGames, screen, selectedGame } from '@/composables/useLibrary'
import { activityLabel } from '@/composables/useActivity'
import { activeSection, openSettings, settingsTab } from '@/composables/useSettings'
import { installUpdate, update, updatePill } from '@/composables/useUpdates'

const api = window.api
const maximized = ref(false)
let off: (() => void) | null = null

onMounted(async () => {
  maximized.value = await api.window.isMaximized()
  off = api.on('window:maximized', (v) => (maximized.value = v))
})
onBeforeUnmount(() => off?.())

interface Crumb {
  label: string
  icon?: string
  /** Set on every crumb but the current one: the trail is navigation, not a label. */
  onSelect?: () => void
}

const crumbs = computed<Crumb[]>(() => {
  const home: Crumb = { label: 'Sift', icon: 'i-lucide-play', onSelect: goGames }
  switch (screen.value) {
    case 'settings':
      return [
        home,
        { label: 'Settings', onSelect: () => openSettings(settingsTab.value) },
        { label: activeSection.value.label },
      ]
    case 'game':
      return [home, { label: 'Games', onSelect: goGames }, { label: selectedGame.value ?? '' }]
    case 'clips':
      return [home, { label: 'Clips' }]
    default:
      return [home, { label: 'Games' }]
  }
})

const status = activityLabel
</script>

<template>
  <header class="titlebar">
    <div class="drag">
      <UBreadcrumb
        :items="crumbs"
        separator-icon="i-lucide-slash"
        :ui="{ link: 'gap-0', separatorIcon: 'size-3.5 text-dimmed' }"
      >
        <template #item="{ item, active }">
          <UButton
            v-if="item.onSelect && !active"
            class="crumb"
            :icon="item.icon"
            :label="item.label"
            color="neutral"
            variant="link"
            size="sm"
            :ui="{ base: 'p-0 gap-1.5', leadingIcon: 'size-4' }"
            @click="item.onSelect()"
          />
          <span v-else class="crumb crumb-current">
            <UIcon v-if="item.icon" :name="item.icon" class="size-4" />
            {{ item.label }}
          </span>
        </template>
      </UBreadcrumb>
    </div>
    <Transition name="fade">
      <UTooltip
        v-if="updatePill"
        :text="
          updatePill.ready
            ? `Sift ${update.version} is downloaded — restart to install it`
            : `Downloading Sift ${update.version} in the background`
        "
      >
        <!-- A button, not a badge: this is the primary way to install an update,
             so it has to be reachable and activatable from the keyboard. -->
        <UButton
          class="update"
          :icon="updatePill.icon"
          :label="updatePill.label"
          :color="updatePill.ready ? 'primary' : 'neutral'"
          variant="subtle"
          size="sm"
          :disabled="!updatePill.ready"
          @click="installUpdate()"
        />
      </UTooltip>
    </Transition>
    <Transition name="fade">
      <UBadge
        v-if="status"
        class="status"
        color="primary"
        variant="subtle"
        size="md"
        icon="i-lucide-loader-circle"
        :label="status"
        :ui="{ leadingIcon: 'animate-spin' }"
      />
    </Transition>
    <div class="controls">
      <UButton
        class="wc"
        icon="i-lucide-minus"
        color="neutral"
        variant="ghost"
        square
        :ui="{ leadingIcon: 'size-4' }"
        aria-label="Minimize"
        @click="api.window.minimize()"
      />
      <UButton
        class="wc"
        :icon="maximized ? 'i-lucide-copy' : 'i-lucide-square'"
        color="neutral"
        variant="ghost"
        square
        :ui="{ leadingIcon: 'size-3.5' }"
        :aria-label="maximized ? 'Restore' : 'Maximize'"
        @click="api.window.toggleMaximize()"
      />
      <UButton
        class="wc wc-close"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        square
        :ui="{ leadingIcon: 'size-4' }"
        aria-label="Close"
        @click="api.window.close()"
      />
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  position: relative;
  z-index: 20;
  display: flex;
  align-items: center;
  height: var(--titlebar-h);
  flex: 0 0 auto;
  background: var(--bg-0);
  border-bottom: 1px solid var(--border);
}
.drag {
  flex: 1;
  display: flex;
  align-items: center;
  height: 100%;
  padding-left: 14px;
  -webkit-app-region: drag;
}
/* Crumbs are buttons, so they must opt out of the drag strip around them;
   the empty strip still moves the window. */
.crumb {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-heading);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--fg-muted);
  -webkit-app-region: no-drag;
  transition: color var(--dur-fast) var(--ease-out);
}
.crumb:hover {
  color: var(--fg);
}
.crumb-current {
  color: var(--fg);
  cursor: default;
}
.status {
  margin-right: 12px;
  -webkit-app-region: no-drag;
}
/* Sits left of the scan badge so both can show at once during a first scan. */
.update {
  margin-right: 10px;
  -webkit-app-region: no-drag;
}
.controls {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}
/* Nuxt UI's button base is `inline-flex items-center` only, so a hand-set width
   leaves the icon at the start - centre it explicitly. */
.wc {
  width: 46px;
  height: 100%;
  justify-content: center;
  padding: 0;
  border-radius: 0;
  color: var(--fg-muted);
}
.wc:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--fg);
}
.wc-close:hover {
  background: var(--destructive);
  color: #fff;
}
</style>
