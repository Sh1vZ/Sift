<script setup lang="ts">
import { computed } from 'vue'
import ShinyText from './bits/ShinyText.vue'
import { motionEnabled } from '@/composables/useMotion'
import { games, goGames, scan, screen, view } from '@/composables/useLibrary'
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
    onSelect: () => goGames()
  }
])

const footerItems = computed<NavItem[]>(() => [
  {
    label: 'Settings',
    icon: 'i-lucide-sliders-horizontal',
    active: view.value === 'settings',
    onSelect: () => openSettings(settingsTab.value)
  }
])

const scanLabel = computed(() => {
  if (scan.value.active) return `Scanning ${scan.value.folder} · ${scan.value.found} new`
  if (scan.value.pending) return `Generating previews · ${scan.value.pending} queued`
  return ''
})

/* Collapsed links are 40px squares centred in the rail; the pill background
   and the focus ring both follow the link box. */
const navUi = {
  link: 'h-10 justify-center px-0 rounded-lg',
  linkLeadingIcon: 'size-5'
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="28" height="28">
          <defs>
            <linearGradient id="mark-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#a78bfa" />
              <stop offset="1" stop-color="#7c3aed" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#mark-g)" />
          <path d="M12.5 10.5v11l9-5.5z" fill="#fff" />
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
      <Transition name="pop">
        <UTooltip v-if="scanLabel" :text="scanLabel" :content="{ side: 'right' }">
          <div class="activity" role="status" :aria-label="scanLabel">
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          </div>
        </UTooltip>
      </Transition>
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
  filter: drop-shadow(0 6px 14px rgba(124, 58, 237, 0.55));
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
  padding: var(--s-3) 10px 0;
}
.footer {
  width: 100%;
  padding: 10px;
  border-top: 1px solid var(--border);
}
/* Scan activity collapses to one spinning glyph; the detail is in the tooltip. */
.activity {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  margin-bottom: var(--s-2);
  border-radius: var(--r-md);
  background: var(--bg-2);
  border: 1px solid var(--border);
  color: var(--secondary);
}
</style>
