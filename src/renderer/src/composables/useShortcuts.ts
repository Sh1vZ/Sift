import { ref } from 'vue'
import { dialog } from './useDialogs'
import { clipQuery, goBack, screen } from './useLibrary'
import { isOpen as playerOpen } from './usePlayer'
import { openSearch, searchOpen } from './useSearch'
import { openSettings, settingsTab } from './useSettings'
import { toggleSidebar } from './useSidebar'
import { whatsNew } from './useUpdates'
import { uploadDialog } from './useUploads'

/**
 * App-wide keys. The player owns the keyboard while it is up (its own handler
 * covers playback), so outside `?`, Ctrl+K and Ctrl+B this only acts on the
 * library screens. Installed in the capture phase from App.vue: it runs before
 * every bubble listener the views register, and stops the event only when it
 * handled it.
 */
export const shortcutsOpen = ref(false)

export function openShortcuts(): void {
  shortcutsOpen.value = true
}

/**
 * Whichever search box is on screen registers here, so `/` and Ctrl+F always
 * land in the right field: the games search, a game's clip filter, or the
 * settings rail search.
 */
export const focusSearch = ref<(() => void) | null>(null)

export function registerSearch(fn: () => void): () => void {
  focusSearch.value = fn
  return () => {
    if (focusSearch.value === fn) focusSearch.value = null
  }
}

export interface ShortcutRow {
  /** Alternatives, each a chord of key names `UKbd` understands. */
  chords: string[][]
  label: string
}

export interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Library',
    rows: [
      { chords: [['ctrl', 'K']], label: 'Search every clip' },
      { chords: [['/'], ['ctrl', 'F']], label: 'Search games, filter clips' },
      { chords: [['backspace'], ['alt', 'arrowleft']], label: 'Back' },
      { chords: [['escape']], label: 'Clear the filter, then back' },
      { chords: [['arrowup'], ['arrowdown'], ['enter']], label: 'Move through games, open one' },
      { chords: [['ctrl', 'B']], label: 'Collapse or expand the sidebar' },
      { chords: [['ctrl', ',']], label: 'Settings' },
      { chords: [['?']], label: 'This list' },
    ],
  },
  {
    title: 'Player',
    rows: [
      { chords: [['Space'], ['K']], label: 'Play / pause' },
      { chords: [['arrowleft'], ['arrowright']], label: 'Seek 5 s' },
      { chords: [['J'], ['L']], label: 'Seek 10 s' },
      { chords: [[','], ['.']], label: 'Step one frame' },
      { chords: [['0'], ['9']], label: 'Jump to 0–90 %' },
      { chords: [['arrowup'], ['arrowdown']], label: 'Volume' },
      { chords: [['M']], label: 'Mute' },
      { chords: [['N'], ['P']], label: 'Next / previous clip' },
      { chords: [['S']], label: 'Favourite' },
      { chords: [['F']], label: 'Fullscreen' },
      { chords: [['I']], label: 'Details pane' },
      { chords: [['E']], label: 'Trim & export' },
      { chords: [['escape']], label: 'Back' },
    ],
  },
  {
    title: 'Edit mode',
    rows: [
      { chords: [['['], [']']], label: 'Set start / end to the playhead' },
      { chords: [['{'], ['}']], label: 'Jump to start / end' },
      { chords: [['shift', 'M']], label: 'Mute the export' },
      { chords: [['shift', 'R']], label: 'Reset the range' },
      { chords: [['ctrl', 'enter']], label: 'Export' },
      { chords: [['escape']], label: 'Leave edit mode' },
    ],
  },
]

function inField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable
}

/** An open menu or listbox owns Esc and the arrows; Back must not fire under it. */
function inOverlay(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return Boolean(
    el?.closest?.('[role="menu"], [role="menuitem"], [role="listbox"], [role="option"]'),
  )
}

function modalOpen(): boolean {
  return (
    dialog.value !== null ||
    uploadDialog.value !== null ||
    whatsNew.value !== null ||
    shortcutsOpen.value ||
    searchOpen.value
  )
}

function onKey(e: KeyboardEvent): void {
  if (modalOpen()) return
  // Ctrl+K and Ctrl+B come before the in-field bail so they work from a filter
  // box, and before the player check so they work over an open player. Being
  // on the capture phase, stopping them here keeps them away from the player's
  // own `k`.
  if (e.ctrlKey && e.key.toLowerCase() === 'k') {
    openSearch()
    e.preventDefault()
    e.stopImmediatePropagation()
    return
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'b') {
    toggleSidebar()
    e.preventDefault()
    e.stopImmediatePropagation()
    return
  }
  if (inField(e) || inOverlay(e)) return
  let handled = true
  if (e.key === '?') openShortcuts()
  else if (playerOpen.value) handled = false
  else if (e.ctrlKey && e.key === ',') openSettings(settingsTab.value)
  else if ((e.ctrlKey && e.key.toLowerCase() === 'f') || e.key === '/') {
    if (focusSearch.value) focusSearch.value()
    else handled = false
  } else if (
    screen.value !== 'games' &&
    (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft') || e.key === 'Escape')
  ) {
    // Inside a game, Esc empties the filter first; the next one leaves.
    if (e.key === 'Escape' && screen.value === 'game' && clipQuery.value) clipQuery.value = ''
    else goBack()
  } else handled = false
  if (handled) {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
}

export function installShortcuts(): () => void {
  window.addEventListener('keydown', onKey, { capture: true })
  return () => window.removeEventListener('keydown', onKey, { capture: true })
}
