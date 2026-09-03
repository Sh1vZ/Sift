/**
 * Splash window script. Plain DOM, no Vue and no preload: the window exists to
 * paint one card while the main process opens the library, and the main process
 * drives it through `webContents.executeJavaScript` (see main/lib/splash.ts)
 * rather than an IPC channel, so nothing of the app's bridge is exposed here.
 *
 * Fonts and tokens are the app's own, imported the same way `main.ts` does —
 * never from a remote origin, which the CSP blocks anyway.
 */
import '@fontsource/russo-one'
import '@fontsource/chakra-petch/600.css'
import './styles/tokens.css'
import './styles/splash.css'
import { LAST_THEME_KEY, THEME_IDS, type ThemeId } from '@shared/types'

/** The handle main talks to. Every call is a no-op once the window is going away. */
interface SplashApi {
  theme(id: ThemeId, animations: boolean): void
  status(text: string): void
  version(v: string): void
  leave(): void
}

declare global {
  interface Window {
    sift?: SplashApi
  }
}

const root = document.documentElement

function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v)
}

// Paint in the user's theme straight away. Main sends the persisted setting a
// beat later; this is what keeps an OLED user from seeing indigo in between.
// Storage can be unavailable in odd profiles, and that is non-fatal.
try {
  const last = localStorage.getItem(LAST_THEME_KEY)
  if (isThemeId(last)) root.dataset.theme = last
} catch {
  /* no early theme — main sends the real one shortly */
}

window.sift = {
  theme(id, animations) {
    if (isThemeId(id)) root.dataset.theme = id
    root.classList.toggle('no-motion', !animations)
  },
  status(text) {
    const el = document.getElementById('status')
    if (el) el.textContent = text
  },
  version(v) {
    const el = document.getElementById('version')
    if (!el || !v) return
    el.textContent = `v${v}`
    el.hidden = false
  },
  leave() {
    root.classList.add('leaving')
  }
}
