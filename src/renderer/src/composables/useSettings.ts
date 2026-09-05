import { computed, ref } from 'vue'
import { view } from './useLibrary'

/**
 * The settings screen is one shell with a sub-menu rail. Every pane is a tab
 * id; the rail, the pane head and the title-bar breadcrumb all read the same
 * section table so a new pane only has to be described once.
 */
export type SettingsTab =
  | 'folders'
  | 'clips'
  | 'indexing'
  | 'playback'
  | 'themes'
  | 'os'
  | 'youtube'
  | 'stats'
  | 'storage'
  | 'info'

export interface SettingsSection {
  id: SettingsTab
  label: string
  /** Written as an `i-lucide-*` literal so the Nuxt UI plugin bundles the SVG. */
  icon: string
  /** The line under the pane title. */
  description: string
  /** Extra words the rail search matches on, beyond the label. */
  keywords: string
}

export interface SettingsGroup {
  label: string
  sections: SettingsSection[]
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: 'Library',
    sections: [
      {
        id: 'folders',
        label: 'Folders',
        icon: 'i-lucide-folder',
        description:
          'Where Sift looks for recordings. Clips are indexed where they live — never copied, moved or renamed.',
        keywords: 'add folder path drive shadowplay videos rescan remove',
      },
      {
        id: 'clips',
        label: 'Clips',
        icon: 'i-lucide-scissors',
        description: 'Where trimmed clips are exported to, one sub-folder per game.',
        keywords: 'export trim output folder cut mute clips directory save',
      },
      {
        id: 'indexing',
        label: 'Indexing & previews',
        icon: 'i-lucide-radar',
        description: 'How new recordings are picked up, and how their previews get built.',
        keywords: 'watch thumbnails previews ffmpeg workers concurrency scan cache',
      },
      {
        id: 'playback',
        label: 'Playback',
        icon: 'i-lucide-list-video',
        description: 'What happens when you hover a card, and when a clip reaches its end.',
        keywords: 'hover scrub autoplay next animations motion transitions',
      },
    ],
  },
  {
    label: 'App',
    sections: [
      {
        id: 'themes',
        label: 'Themes',
        icon: 'i-lucide-palette',
        description: 'The colours the chrome is painted in. Thumbnails and clips are never tinted.',
        keywords: 'theme colour color oled black dark amoled accent palette appearance look',
      },
      {
        id: 'os',
        label: 'Window & tray',
        icon: 'i-lucide-app-window',
        description:
          'What closing the window does, and whether Sift keeps working once it is out of sight.',
        keywords:
          'os tray background close minimize hide quit exit taskbar windows notification area system window',
      },
    ],
  },
  {
    label: 'Sharing',
    sections: [
      {
        id: 'youtube',
        label: 'YouTube',
        icon: 'i-lucide-youtube',
        description:
          'Send clips to your channel from their cards, using your own Google projects and their daily quotas.',
        keywords:
          'youtube upload share google oauth playlist publish channel video link connect quota project',
      },
    ],
  },
  {
    label: 'Insights',
    sections: [
      {
        id: 'stats',
        label: 'Stats',
        icon: 'i-lucide-chart-column',
        description: 'What Sift has indexed, and what the library is made of.',
        keywords: 'clips games playtime activity months codecs resolution formats totals',
      },
      {
        id: 'storage',
        label: 'Storage',
        icon: 'i-lucide-hard-drive',
        description: 'What sits on your disk, and how much of it actually belongs to Sift.',
        keywords:
          'disk space cache database app data free drive size volume biggest oldest clean up',
      },
    ],
  },
  {
    label: 'About',
    sections: [
      {
        id: 'info',
        label: 'Info',
        icon: 'i-lucide-info',
        description: 'This build, keeping it current, and what it keeps to itself.',
        keywords:
          'version electron chromium node memory uptime ffmpeg platform privacy update updates upgrade release changelog download install restart beta channel',
      },
    ],
  },
]

const ALL_SECTIONS = SETTINGS_GROUPS.flatMap((g) => g.sections)

export const settingsTab = ref<SettingsTab>('folders')
export const settingsQuery = ref('')

export const activeSection = computed<SettingsSection>(
  () => ALL_SECTIONS.find((s) => s.id === settingsTab.value) ?? ALL_SECTIONS[0],
)

export const sectionLabel = (tab: SettingsTab): string =>
  ALL_SECTIONS.find((s) => s.id === tab)?.label ?? ''

/** Rail groups narrowed by the search box; a group with no hits drops out. */
export const matchedGroups = computed<SettingsGroup[]>(() => {
  const q = settingsQuery.value.trim().toLowerCase()
  if (!q) return SETTINGS_GROUPS
  return SETTINGS_GROUPS.map((g) => ({
    label: g.label,
    sections: g.sections.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.keywords.includes(q),
    ),
  })).filter((g) => g.sections.length > 0)
})

// ------------------------------------------------------------------ rows

/**
 * Every setting the panes render, so the search can find the row and not only
 * its section. Kept by hand beside the section table; a `SettingsRow` with the
 * same `id` scrolls into view and flashes when `revealRow` lands on it, and an
 * id with no row (a card grid, a chart) simply opens its pane.
 */
export interface SettingsRowIndex {
  id: string
  tab: SettingsTab
  label: string
  keywords: string
}

export const SETTINGS_ROWS: SettingsRowIndex[] = [
  { id: 'folders', tab: 'folders', label: 'Watched folders', keywords: 'add remove path drive' },
  { id: 'rescan', tab: 'folders', label: 'Rescan all folders', keywords: 'refresh walk missed' },
  {
    id: 'clips-folder',
    tab: 'clips',
    label: 'Clips folder',
    keywords: 'export output where trimmed change reset',
  },
  {
    id: 'watch-folders',
    tab: 'indexing',
    label: 'Watch folders',
    keywords: 'new recordings automatically watcher live',
  },
  {
    id: 'generate-previews',
    tab: 'indexing',
    label: 'Generate previews',
    keywords: 'thumbnails posters scrub strips ffmpeg',
  },
  {
    id: 'preview-workers',
    tab: 'indexing',
    label: 'Preview workers',
    keywords: 'concurrency cpu parallel jobs',
  },
  { id: 'queue', tab: 'indexing', label: 'Queue', keywords: 'pending probe indexed waiting' },
  { id: 'hover-scrub', tab: 'playback', label: 'Hover to scrub', keywords: 'preview card mouse' },
  {
    id: 'edit-on-open',
    tab: 'playback',
    label: 'Open clips in edit mode',
    keywords: 'trim timeline player default',
  },
  { id: 'autoplay-next', tab: 'playback', label: 'Autoplay next clip', keywords: 'continue end' },
  {
    id: 'default-audio-track',
    tab: 'playback',
    label: 'Default audio track',
    keywords: 'sound mic microphone game commentary shadowplay stream channel mixer',
  },
  { id: 'shortcuts', tab: 'playback', label: 'Keyboard shortcuts', keywords: 'keys hotkeys' },
  { id: 'animations', tab: 'playback', label: 'Animations', keywords: 'motion transitions' },
  { id: 'theme', tab: 'themes', label: 'Theme', keywords: 'colour color oled dark palette' },
  {
    id: 'minimize-to-tray',
    tab: 'os',
    label: 'Minimize to the tray instead of quitting',
    keywords: 'close window background quit exit',
  },
  {
    id: 'youtube-projects',
    tab: 'youtube',
    label: 'YouTube projects',
    keywords: 'connect google account sign in disconnect',
  },
  {
    id: 'youtube-check',
    tab: 'youtube',
    label: 'Check processing status',
    keywords: 'processing poll quota',
  },
  {
    id: 'youtube-add',
    tab: 'youtube',
    label: 'Add a YouTube project',
    keywords: 'client secret json paste google cloud',
  },
  {
    id: 'youtube-guide',
    tab: 'youtube',
    label: 'Set up a Google project',
    keywords: 'guide oauth consent credentials steps',
  },
  {
    id: 'youtube-audit',
    tab: 'youtube',
    label: 'Unverified projects upload as private',
    keywords: 'audit private verification limits',
  },
  { id: 'stats-previews', tab: 'stats', label: 'Previews built', keywords: 'poster coverage' },
  { id: 'stats-activity', tab: 'stats', label: 'Recording activity', keywords: 'months chart' },
  { id: 'stats-games', tab: 'stats', label: 'Biggest games', keywords: 'disk space ranking' },
  { id: 'stats-formats', tab: 'stats', label: 'Formats', keywords: 'resolution codec bitrate' },
  {
    id: 'storage-recordings',
    tab: 'storage',
    label: 'Recordings on disk',
    keywords: 'library size bytes total',
  },
  { id: 'storage-bitrate', tab: 'storage', label: 'Average bitrate', keywords: 'mbps capture' },
  { id: 'storage-previews', tab: 'storage', label: 'Preview cache', keywords: 'thumbnails clear' },
  { id: 'storage-database', tab: 'storage', label: 'Index database', keywords: 'sqlite db' },
  { id: 'storage-appdata', tab: 'storage', label: 'App data', keywords: 'folder open reveal' },
  {
    id: 'storage-drives',
    tab: 'storage',
    label: 'Drives',
    keywords: 'free space used volume c d partition per drive',
  },
  {
    id: 'storage-biggest',
    tab: 'storage',
    label: 'Biggest and oldest clips',
    keywords: 'largest heaviest first earliest file',
  },
  {
    id: 'storage-cleanup',
    tab: 'storage',
    label: 'Worth clearing out',
    keywords: 'clean cleanup free reclaim suggestions old duplicate unplayed',
  },
  {
    id: 'updates',
    tab: 'info',
    label: 'Updates',
    keywords: 'version check now restart install release notes changelog',
  },
  {
    id: 'auto-updates',
    tab: 'info',
    label: 'Check for updates automatically',
    keywords: 'background launch',
  },
  {
    id: 'app-runtime',
    tab: 'info',
    label: 'App',
    keywords: 'electron chromium node platform memory uptime ffmpeg',
  },
  { id: 'local-first', tab: 'info', label: 'Local-first', keywords: 'privacy network files stay' },
]

export const matchedRows = computed<SettingsRowIndex[]>(() => {
  const q = settingsQuery.value.trim().toLowerCase()
  if (!q) return []
  return SETTINGS_ROWS.filter((r) => r.label.toLowerCase().includes(q) || r.keywords.includes(q))
})

/** The row `revealRow` just landed on; its SettingsRow scrolls into view and flashes. */
export const highlightRow = ref<string | null>(null)
let highlightTimer = 0

export function revealRow(id: string): void {
  const row = SETTINGS_ROWS.find((r) => r.id === id)
  if (!row) return
  settingsTab.value = row.tab
  settingsQuery.value = ''
  highlightRow.value = id
  window.clearTimeout(highlightTimer)
  highlightTimer = window.setTimeout(() => {
    if (highlightRow.value === id) highlightRow.value = null
  }, 2400)
}

export function openSettings(tab: SettingsTab = 'folders'): void {
  settingsTab.value = tab
  settingsQuery.value = ''
  view.value = 'settings'
}
