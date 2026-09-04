import { ref } from 'vue'
import { dialog } from './useDialogs'
import { clipQuery, goGames, screen } from './useLibrary'
import { isOpen as playerOpen } from './usePlayer'
import { openSettings, settingsTab } from './useSettings'
import { whatsNew } from './useUpdates'
import { uploadDialog } from './useUploads'

/**
 * App-wide keys. The player owns the keyboard while it is up (its own handler
 * covers playback), so outside `?` this only acts on the library screens.
 * Installed in the capture phase from App.vue: it runs before every bubble
 * listener the views register, and stops the event only when it handled it.
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
      { chords: [['/'], ['ctrl', 'F']], label: 'Search games, filter clips' },
      { chords: [['backspace'], ['alt', 'arrowleft']], label: 'Back to games' },
      { chords: [['escape']], label: 'Clear the filter, then back' },
      { chords: [['arrowup'], ['arrowdown'], ['enter']], label: 'Move through games, open one' },
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

function modalOpen(): boolean {
  return (
    dialog.value !== null ||
    uploadDialog.value !== null ||
    whatsNew.value !== null ||
    shortcutsOpen.value
  )
}

function onKey(e: KeyboardEvent): void {
  if (modalOpen() || inField(e)) return
  let handled = true
  if (e.key === '?') openShortcuts()
  else if (playerOpen.value) handled = false
  else if (e.ctrlKey && e.key === ',') openSettings(settingsTab.value)
  else if ((e.ctrlKey && e.key.toLowerCase() === 'f') || e.key === '/') {
    if (focusSearch.value) focusSearch.value()
    else handled = false
  } else if (
    screen.value === 'game' &&
    (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft') || e.key === 'Escape')
  ) {
    if (e.key === 'Escape' && clipQuery.value) clipQuery.value = ''
    else goGames()
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
