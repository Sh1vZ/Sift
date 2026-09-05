<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ShinyText from './bits/ShinyText.vue'
import ActivityPanel from './ActivityPanel.vue'
import { motionEnabled } from '@/composables/useMotion'
import { activeTheme } from '@/composables/useTheme'
import { exportedClips, games, goClips, goGames, screen, view } from '@/composables/useLibrary'
import { activityBusy, activityCount, activityLabel, activityOpen } from '@/composables/useActivity'
import { openSettings, settingsTab } from '@/composables/useSettings'
import { openShortcuts } from '@/composables/useShortcuts'
import { isRail, railForced, toggleSidebar } from '@/composables/useSidebar'

/**
 * The app's left column in two widths. Labelled — icon, name, count — at
 * --sidebar-w-expanded, or the icon-only rail at --sidebar-w when the user
 * collapses it or the window is too narrow to spare the room (see useSidebar).
 * The rail keeps Nuxt UI's collapsed-menu tooltips, so nothing is lost with
 * the labels; anything longer than a name — the game you are in, the scan
 * detail — belongs in the title bar.
 * The two widths ease into each other; railContent below is what keeps the
 * labels from popping while that runs.
 */
interface NavItem {
  label: string
  icon: string
  active?: boolean
  badge?: { label: number; size: 'md'; color: 'neutral'; variant: 'subtle'; class: string }
  tooltip?: { text: string; kbds?: string[] }
  onSelect: () => void
}

const count = (n: number): NavItem['badge'] =>
  n ? { label: n, size: 'md', color: 'neutral', variant: 'subtle', class: 'mono' } : undefined

const libraryItems = computed<NavItem[]>(() => [
  {
    label: 'Games',
    icon: 'i-lucide-gamepad-2',
    active: screen.value === 'games' || screen.value === 'game',
    badge: count(games.value.length),
    tooltip: { text: `Games · ${games.value.length}` },
    onSelect: () => goGames(),
  },
  {
    label: 'Clips',
    icon: 'i-lucide-scissors',
    active: screen.value === 'clips',
    badge: count(exportedClips.value.length),
    tooltip: { text: `Clips · ${exportedClips.value.length}` },
    onSelect: () => goClips(),
  },
])

const footerItems = computed<NavItem[]>(() => [
  {
    label: 'Shortcuts',
    icon: 'i-lucide-keyboard',
    tooltip: { text: 'Keyboard shortcuts', kbds: ['?'] },
    onSelect: () => openShortcuts(),
  },
  {
    label: 'Settings',
    icon: 'i-lucide-sliders-horizontal',
    active: view.value === 'settings',
    tooltip: { text: 'Settings', kbds: ['ctrl', ','] },
    onSelect: () => openSettings(settingsTab.value),
  },
])

/* The column takes --dur to change width, so the labelled content has to
   outlive the collapse: it stays mounted while the width animates and the
   column clips it, and the rail arrangement lands only once the width has.
   Expanding is the mirror — the labels are there from the first frame and the
   widening column reveals them. So this is the wider of the two states for as
   long as the transition runs; driving the content off isRail alone is the
   pop this avoids. */
const railContent = ref(isRail.value)

watch(isRail, (rail) => {
  // Expanding leads with the labels, and with motion off there is no width
  // transition to wait for either way.
  if (!rail || !motionEnabled.value) railContent.value = rail
})

/** The column's own width transition — never a child's colour or ring. */
function onWidthSettled(e: TransitionEvent): void {
  if (e.target === e.currentTarget && e.propertyName === 'width') railContent.value = isRail.value
}

/* Rail links are 44px squares centred in the column; expanded links are full
   rows at the app's base size. The pill background and the focus ring follow
   the link box either way. */
const navUi = computed(() =>
  railContent.value
    ? { link: 'h-11 justify-center px-0 rounded-lg', linkLeadingIcon: 'size-6' }
    : {
        link: 'h-11 px-3 gap-3 rounded-lg text-base font-medium',
        linkLeadingIcon: 'size-6',
        linkTrailingBadge: 'tabular-nums',
      },
)

const activityTitle = computed(() =>
  activityCount.value ? `Activity · ${activityCount.value} active` : 'Activity',
)
</script>

<template>
  <aside
    class="sidebar"
    :class="{ 'is-narrow': isRail, 'is-rail': railContent }"
    @transitionend="onWidthSettled"
  >
    <div class="brand">
      <span class="mark" aria-hidden="true">
        <!-- The "slats" mark: a play triangle sliced into bars like a sieve,
             the last bar fallen through in the accent colour. Same geometry
             as build/icon.png, but bare so it follows the active theme. -->
        <svg viewBox="0 0 64 64" width="28" height="28">
          <defs>
            <linearGradient id="mark-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style="stop-color: var(--secondary)" />
              <stop offset="1" style="stop-color: var(--primary)" />
            </linearGradient>
            <clipPath id="mark-slats">
              <rect x="0" y="12" width="64" height="8" />
              <rect x="0" y="22.5" width="64" height="8" />
              <rect x="0" y="33" width="64" height="8" />
            </clipPath>
            <clipPath id="mark-slat-last">
              <rect x="0" y="43.5" width="64" height="9" />
            </clipPath>
          </defs>
          <path d="M17 12 L51 32 L17 52 Z" clip-path="url(#mark-slats)" fill="url(#mark-g)" />
          <path
            d="M17 12 L51 32 L17 52 Z"
            clip-path="url(#mark-slat-last)"
            transform="translate(5 1)"
            style="fill: var(--accent)"
          />
        </svg>
      </span>
      <ShinyText
        text="Sift"
        class-name="wordmark"
        :color="activeTheme.colors.secondary"
        :shine-color="activeTheme.colors.fg"
        :speed="2.4"
        :delay="7"
        :disabled="!motionEnabled"
      />
    </div>

    <nav class="nav" aria-label="Main">
      <UNavigationMenu
        orientation="vertical"
        :collapsed="railContent"
        :tooltip="railContent"
        color="primary"
        variant="pill"
        :items="libraryItems"
        :ui="navUi"
      />
    </nav>

    <div class="footer">
      <!-- Everything running in the background, in one list. The badge counts
           live jobs; finished ones wait in the panel until dismissed. Expanded,
           the button also carries the one-line status the title bar shows. -->
      <UPopover
        v-model:open="activityOpen"
        :content="{ side: 'right', align: 'end', sideOffset: 10 }"
        :ui="{ content: 'p-0' }"
      >
        <UChip
          class="activity-chip"
          :text="activityCount"
          :show="railContent && activityCount > 0"
          color="primary"
          size="lg"
          inset
        >
          <UTooltip :text="activityTitle" :content="{ side: 'right' }" :disabled="!railContent">
            <UButton
              class="activity"
              :icon="activityBusy ? 'i-lucide-loader-circle' : 'i-lucide-activity'"
              :color="activityCount || view === 'activity' ? 'primary' : 'neutral'"
              variant="ghost"
              :square="railContent"
              :ui="{
                base: railContent
                  ? ''
                  : 'w-full justify-start px-3 gap-3 min-h-11 py-1.5 rounded-lg font-sans font-medium normal-case tracking-normal text-base',
                leadingIcon: activityBusy ? 'animate-spin size-6' : 'size-6',
              }"
              :aria-label="activityTitle"
              :aria-expanded="activityOpen"
            >
              <span v-if="!railContent" class="activity-text">
                <span>Activity</span>
                <span v-if="activityLabel" class="activity-status truncate">{{
                  activityLabel
                }}</span>
              </span>
              <UBadge
                v-if="!railContent && activityCount"
                class="activity-count mono"
                color="primary"
                variant="subtle"
                size="md"
                :label="activityCount"
              />
            </UButton>
          </UTooltip>
        </UChip>
        <template #content>
          <ActivityPanel />
        </template>
      </UPopover>

      <UNavigationMenu
        orientation="vertical"
        :collapsed="railContent"
        :tooltip="railContent"
        color="primary"
        variant="pill"
        :items="footerItems"
        :ui="navUi"
      />

      <!-- Hidden while the window forces the rail: the toggle would do nothing.
           Not called "collapse": that is a Tailwind utility (visibility: collapse). -->
      <UTooltip
        v-if="!railForced"
        :text="isRail ? 'Expand the sidebar' : 'Collapse the sidebar'"
        :kbds="['ctrl', 'B']"
        :content="{ side: 'right' }"
      >
        <UButton
          class="fold"
          :icon="isRail ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
          color="neutral"
          variant="ghost"
          square
          size="sm"
          :aria-label="isRail ? 'Expand the sidebar' : 'Collapse the sidebar'"
          :aria-expanded="!isRail"
          @click="toggleSidebar()"
        />
      </UTooltip>
    </div>
  </aside>
</template>

<style scoped>
/* Two classes, because the width and the arrangement no longer change at the
   same moment: `is-narrow` eases the column between its widths, `is-rail`
   restacks the content once that lands. `clip` rather than `hidden` so no
   scroll container is created — and it also drops the flex item's automatic
   minimum size, without which the expanded content would hold the column open
   mid-collapse. The grid beside it re-lays out through the transition; that
   is the same work a window resize already asks of it. */
.sidebar {
  display: flex;
  flex-direction: column;
  width: var(--sidebar-w-expanded);
  flex: 0 0 auto;
  overflow: clip;
  background: var(--bg-0);
  border-right: 1px solid var(--border);
  transition: width var(--dur) var(--ease-out);
}
.sidebar.is-narrow {
  width: var(--sidebar-w);
}
.sidebar.is-rail {
  align-items: center;
}
/* While the labels are still on screen the rows keep their full width, so text
   rides out of the column and back rather than reflowing on every frame of the
   transition. The fold button is left out: it tracks the right edge in, which
   is where it ends up anyway. */
.sidebar:not(.is-rail) .brand,
.sidebar:not(.is-rail) .nav {
  min-width: var(--sidebar-w-expanded);
}
/* The footer rows sit inside its 8px gutters, so they hold the width the open
   column gives them, not the column's own. */
.sidebar:not(.is-rail) .activity-chip,
.sidebar:not(.is-rail) .footer :deep(nav) {
  min-width: calc(var(--sidebar-w-expanded) - 16px);
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  width: 100%;
  height: 56px;
  padding: 0 var(--s-4);
  /* No room for a section label, so a hairline does the dividing. */
  border-bottom: 1px solid var(--border);
  transition: height var(--dur-fast) var(--ease-out);
}
.is-rail .brand {
  flex-direction: column;
  justify-content: center;
  gap: var(--s-1);
  /* 12 + 28 (mark) + 4 + 13 (wordmark) + 10 + 1 (border): the height `auto`
     would resolve to, pinned so the header can ease between the two
     arrangements instead of stepping 12px when the rail lands. Centred, so a
     pixel of font drift costs nothing. */
  height: 68px;
  padding: var(--s-3) 0 10px;
}
.mark {
  display: inline-flex;
  filter: drop-shadow(0 6px 14px color-mix(in srgb, var(--primary) 55%, transparent));
}
.wordmark {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  line-height: 1;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
/* Four characters is all the rail can hold, so the wordmark drops to --text-xs
   and keeps just enough tracking to still read as the logotype. */
.is-rail .wordmark {
  font-size: var(--text-xs);
  letter-spacing: 0.1em;
  /* The stacked wordmark belongs to the rail, and the rail lands after the
     width has — so it arrives instead of appearing under the mark. */
  animation: wordmark-in var(--dur) var(--ease-out);
}
@keyframes wordmark-in {
  from {
    opacity: 0;
  }
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
  gap: var(--s-1);
  width: 100%;
  padding: 10px 8px;
  border-top: 1px solid var(--border);
}
.is-rail .footer {
  align-items: center;
  gap: var(--s-2);
}
.footer :deep(nav) {
  width: 100%;
}
.activity-chip {
  display: flex;
  width: 100%;
}
.is-rail .activity-chip {
  width: auto;
}
/* Same box as a rail link, so the column reads as one stack. */
.is-rail .activity {
  width: 44px;
  height: 44px;
  justify-content: center;
  padding: 0;
  border-radius: var(--r-md);
}
.activity-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
  line-height: 1.25;
  text-align: left;
}
.activity-status {
  max-width: 100%;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--fg-muted);
}
.activity-count {
  flex: 0 0 auto;
}
.fold {
  align-self: flex-end;
  margin-top: var(--s-1);
}
.is-rail .fold {
  align-self: center;
}
</style>
