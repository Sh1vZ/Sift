<script setup lang="ts">
import { computed } from 'vue'
import ShinyText from './bits/ShinyText.vue'
import ActivityPanel from './ActivityPanel.vue'
import { motionEnabled } from '@/composables/useMotion'
import { exportedClips, games, goClips, goGames, screen, view } from '@/composables/useLibrary'
import { activityBusy, activityCount, activityOpen } from '@/composables/useActivity'
import { openSettings, settingsTab } from '@/composables/useSettings'

/**
 * Icon-only rail. Labels live in the tooltip Nuxt UI renders for a collapsed
 * vertical menu, so anything that cannot be said in one glyph — the game you
 * have drilled into, the scan detail — belongs in the title bar or a tooltip.
 */
interface NavItem {
  label: string
  icon: string
  active?: boolean
  tooltip?: { text: string }
  onSelect: () => void
}

const libraryItems = computed<NavItem[]>(() => [
  {
    label: 'Games',
    icon: 'i-lucide-gamepad-2',
    active: screen.value === 'games' || screen.value === 'game',
    tooltip: { text: `Games · ${games.value.length}` },
    onSelect: () => goGames(),
  },
  {
    label: 'Clips',
    icon: 'i-lucide-scissors',
    active: screen.value === 'clips',
    tooltip: { text: `Clips · ${exportedClips.value.length}` },
    onSelect: () => goClips(),
  },
])

const footerItems = computed<NavItem[]>(() => [
  {
    label: 'Settings',
    icon: 'i-lucide-sliders-horizontal',
    active: view.value === 'settings',
    onSelect: () => openSettings(settingsTab.value),
  },
])

/* Collapsed links are 44px squares centred in the rail; the pill background
   and the focus ring both follow the link box. */
const navUi = {
  link: 'h-11 justify-center px-0 rounded-lg',
  linkLeadingIcon: 'size-6',
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="28" height="28">
          <defs>
            <linearGradient id="mark-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style="stop-color: var(--secondary)" />
              <stop offset="1" style="stop-color: var(--primary)" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#mark-g)" />
          <path d="M12.5 10.5v11l9-5.5z" style="fill: var(--on-primary)" />
        </svg>
      </span>
      <ShinyText
        text="Sift"
        class-name="wordmark"
        color="#c4b5fd"
        shine-color="#ffffff"
        :speed="2.4"
        :delay="7"
        :disabled="!motionEnabled"
      />
    </div>

    <nav class="nav" aria-label="Main">
      <UNavigationMenu
        orientation="vertical"
        collapsed
        tooltip
        color="primary"
        variant="pill"
        :items="libraryItems"
        :ui="navUi"
      />
    </nav>

    <div class="footer">
      <!-- Everything running in the background, in one list. The badge counts
           live jobs; finished ones wait in the panel until dismissed. -->
      <UPopover
        v-model:open="activityOpen"
        :content="{ side: 'right', align: 'end', sideOffset: 10 }"
        :ui="{ content: 'p-0' }"
      >
        <UChip
          class="activity-chip"
          :text="activityCount"
          :show="activityCount > 0"
          color="primary"
          size="lg"
          inset
        >
          <UTooltip
            :text="activityCount ? `Activity · ${activityCount} active` : 'Activity'"
            :content="{ side: 'right' }"
          >
            <UButton
              class="activity"
              :icon="activityBusy ? 'i-lucide-loader-circle' : 'i-lucide-activity'"
              :color="activityCount || view === 'activity' ? 'primary' : 'neutral'"
              variant="ghost"
              square
              size="lg"
              :ui="{ leadingIcon: activityBusy ? 'animate-spin size-6' : 'size-6' }"
              aria-label="Activity"
              :aria-expanded="activityOpen"
            />
          </UTooltip>
        </UChip>
        <template #content>
          <ActivityPanel />
        </template>
      </UPopover>
      <UNavigationMenu
        orientation="vertical"
        collapsed
        tooltip
        color="primary"
        variant="pill"
        :items="footerItems"
        :ui="navUi"
      />
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: var(--sidebar-w);
  flex: 0 0 auto;
  background: var(--bg-0);
  border-right: 1px solid var(--border);
}
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-1);
  width: 100%;
  padding: var(--s-3) 0 10px;
  /* The rail has no room for a section label, so a hairline does the dividing. */
  border-bottom: 1px solid var(--border);
}
.mark {
  display: inline-flex;
  filter: drop-shadow(0 6px 14px color-mix(in srgb, var(--primary) 55%, transparent));
}
/* Four characters is all the rail can hold, so the wordmark drops to --text-xs
   and keeps just enough tracking to still read as the logotype. */
.wordmark {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.nav {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  padding: var(--s-3) 8px 0;
}
.footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-2);
  width: 100%;
  padding: 10px 8px;
  border-top: 1px solid var(--border);
}
.footer :deep(nav) {
  width: 100%;
}
.activity-chip {
  display: flex;
}
/* Same box as a rail link, so the column reads as one stack. */
.activity {
  width: 44px;
  height: 44px;
  justify-content: center;
  padding: 0;
  border-radius: var(--r-md);
}
</style>
