import { computed, ref } from 'vue'
import { view } from './useLibrary'

/**
 * The settings screen is one shell with a sub-menu rail. Every pane is a tab
 * id; the rail, the pane hero and the title-bar breadcrumb all read the same
 * section table so a new pane only has to be described once.
 */
export type SettingsTab =
  | 'folders'
  | 'clips'
  | 'indexing'
  | 'playback'
  | 'themes'
  | 'os'
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
        keywords: 'add folder path drive shadowplay videos rescan remove'
      },
      {
        id: 'clips',
        label: 'Clips',
        icon: 'i-lucide-scissors',
        description: 'Where trimmed clips are exported to, one sub-folder per game.',
        keywords: 'export trim output folder cut mute clips directory save'
      },
      {
        id: 'indexing',
        label: 'Indexing & previews',
        icon: 'i-lucide-radar',
        description: 'How new recordings are picked up, and how their poster frames get built.',
        keywords: 'watch thumbnails ffmpeg workers concurrency scan cache'
      },
      {
        id: 'playback',
        label: 'Playback',
        icon: 'i-lucide-list-video',
        description: 'What happens when you hover a card, and when a clip reaches its end.',
        keywords: 'hover scrub autoplay next animations motion transitions'
      }
    ]
  },
  {
    label: 'Appearance',
    sections: [
      {
        id: 'themes',
        label: 'Themes',
        icon: 'i-lucide-palette',
        description: 'The colours the chrome is painted in. Thumbnails and clips are never tinted.',
        keywords: 'theme colour color oled black dark amoled accent palette appearance look'
      }
    ]
  },
  {
    label: 'System',
    sections: [
      {
        id: 'os',
        label: 'OS settings',
        icon: 'i-lucide-app-window',
        description: 'What closing the window does, and whether Sift keeps working once it is out of sight.',
        keywords: 'os tray background close minimize hide quit exit taskbar windows notification area system'
      }
    ]
  },
  {
    label: 'Insights',
    sections: [
      {
        id: 'stats',
        label: 'Stats',
        icon: 'i-lucide-chart-column',
        description: 'What Sift has indexed, and what the library is made of.',
        keywords: 'clips games playtime activity months codecs resolution formats totals'
      },
      {
        id: 'storage',
        label: 'Storage',
        icon: 'i-lucide-hard-drive',
        description: 'What sits on your disk, and how much of it actually belongs to Sift.',
        keywords: 'disk space cache database app data free drive size'
      }
    ]
  },
  {
    label: 'About',
    sections: [
      {
        id: 'info',
        label: 'Info',
        icon: 'i-lucide-info',
        description: 'This build, what it is currently using, and what it keeps to itself.',
        keywords: 'version electron chromium node memory uptime ffmpeg platform privacy'
      }
    ]
  }
]

const ALL_SECTIONS = SETTINGS_GROUPS.flatMap((g) => g.sections)

export const settingsTab = ref<SettingsTab>('folders')
export const settingsQuery = ref('')

export const activeSection = computed<SettingsSection>(
  () => ALL_SECTIONS.find((s) => s.id === settingsTab.value) ?? ALL_SECTIONS[0]
)

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
        s.keywords.includes(q)
    )
  })).filter((g) => g.sections.length > 0)
})

export function openSettings(tab: SettingsTab = 'folders'): void {
  settingsTab.value = tab
  settingsQuery.value = ''
  view.value = 'settings'
}
