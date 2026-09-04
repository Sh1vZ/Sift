import { computed, ref } from 'vue'
import { settings, updateSettings } from './useLibrary'

/**
 * Whether the sidebar shows as the icon-only rail. Two inputs: the user's
 * collapse toggle (a persisted setting) and the window width — under 1200px
 * the labelled column would cost the clip grid a card column, so the rail is
 * forced and the toggle hides. One computed drives both the CSS class and the
 * menu's tooltips, so the two can never disagree at the boundary.
 */
const RAIL_BELOW = '(max-width: 1199px)'
const narrow = window.matchMedia(RAIL_BELOW)

export const railForced = ref(narrow.matches)
narrow.addEventListener('change', (e) => (railForced.value = e.matches))

export const isRail = computed(() => railForced.value || settings.value.sidebarCollapsed)

/** Ctrl+B and the chevron at the bottom of the sidebar. A no-op while the window forces the rail. */
export function toggleSidebar(): void {
  if (railForced.value) return
  void updateSettings({ sidebarCollapsed: !settings.value.sidebarCollapsed })
}
