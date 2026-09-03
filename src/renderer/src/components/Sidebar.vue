<script setup lang="ts">
import { computed } from 'vue'
import ShinyText from './bits/ShinyText.vue'
import { motionEnabled } from '@/composables/useMotion'
import { games, goGames, scan, screen, selectedGame, view } from '@/composables/useLibrary'

interface NavItem {
  label: string
  icon: string
  badge?: string
  active?: boolean
  class?: string
  onSelect: () => void
}

const libraryItems = computed<NavItem[]>(() => {
  const items: NavItem[] = [
    {
      label: 'Games',
      icon: 'i-lucide-gamepad-2',
      badge: String(games.value.length),
      active: screen.value === 'games' || screen.value === 'game',
      onSelect: () => goGames()
    }
  ]
  if (screen.value === 'game' && selectedGame.value) {
    items.push({
      label: selectedGame.value,
      icon: 'i-lucide-chevron-right',
      active: true,
      class: 'sub-item',
      onSelect: () => undefined
    })
  }
  return items
})

const footerItems = computed<NavItem[]>(() => [
  {
    label: 'Library & settings',
    icon: 'i-lucide-sliders-horizontal',
    active: view.value === 'folders',
    onSelect: () => (view.value = 'folders')
  },
  {
    label: 'Stats',
    icon: 'i-lucide-chart-column',
    active: view.value === 'stats',
    onSelect: () => (view.value = 'stats')
  }
])

const navUi = {
  link: 'h-9 px-2.5 gap-2.5 text-sm font-medium rounded-lg',
  linkLeadingIcon: 'size-4',
  linkLabel: 'truncate',
  linkTrailingBadge: 'font-heading font-semibold'
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
      <div class="section-title">Library</div>
      <UNavigationMenu
        orientation="vertical"
        color="primary"
        variant="pill"
        highlight
        highlight-color="primary"
        :items="libraryItems"
        :ui="navUi"
      />
    </nav>

    <div class="footer">
      <Transition name="pop">
        <div v-if="scan.active || scan.pending" class="activity">
          <div class="activity-text">
            <span v-if="scan.active" class="truncate">Scanning {{ scan.folder }}</span>
            <span v-else class="truncate">Generating previews</span>
            <span class="activity-sub">
              <template v-if="scan.active">{{ scan.found }} new · </template>{{ scan.pending }} queued
            </span>
          </div>
          <UProgress size="xs" color="primary" animation="carousel" />
        </div>
      </Transition>
      <UNavigationMenu
        orientation="vertical"
        color="primary"
        variant="pill"
        highlight
        highlight-color="primary"
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
  width: var(--sidebar-w);
  flex: 0 0 auto;
  background: var(--bg-0);
  border-right: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 14px;
}
.mark {
  display: inline-flex;
  filter: drop-shadow(0 6px 14px rgba(124, 58, 237, 0.55));
}
.wordmark {
  font-family: var(--font-display);
  font-size: 17px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.nav {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 0 10px;
}
.section-title {
  margin: 10px 8px 6px;
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--fg-dim);
}
.nav :deep(.sub-item) {
  margin-left: 18px;
  color: var(--secondary);
}
.footer {
  padding: 10px;
  border-top: 1px solid var(--border);
}
.activity {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--bg-2);
  border: 1px solid var(--border);
}
.activity-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--fg);
}
.activity-sub {
  font-size: var(--text-xs);
  color: var(--fg-muted);
}
</style>
