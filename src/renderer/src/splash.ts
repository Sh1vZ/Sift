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
import { LAST_THEME_KEY, THEME_IDS, type ThemeId, type WarmupClip } from '@shared/types'

/** The handle main talks to. Every call is a no-op once the window is going away. */
interface SplashApi {
  theme(id: ThemeId, animations: boolean): void
  status(text: string): void
  version(v: string): void
  /** One frame of each clip, drawn behind the card — see main/lib/splash.ts for why. */
  warm(clips: WarmupClip[]): void
  leave(): void
}

/** Height of a warm-up frame: tall enough at any aspect for the corner radius to cut into it. */
const WARM_HEIGHT = 40

declare global {
  interface Window {
    sift?: SplashApi
  }
}

const root = document.documentElement

function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v)
}

function isWarmupClip(v: unknown): v is WarmupClip {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.width === 'number' &&
    typeof c.height === 'number' &&
    c.width > 0 &&
    c.height > 0
  )
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
  warm(clips) {
    const host = document.getElementById('warm')
    if (!host || !Array.isArray(clips)) return
    clips.filter(isWarmupClip).forEach((clip, i) => {
      // The player's stage in miniature, at the clip's exact aspect: the frame
      // fills the box and the rounded corners cut into the video rather than
      // into letterbox black. A different shape draws through a different
      // shader, and only the player's is worth compiling here.
      const r = clip.width / clip.height
      const width = Math.floor(WARM_HEIGHT * r)
      const box = document.createElement('div')
      box.className = 'warm'
      box.style.width = `${width}px`
      box.style.height = `${Math.floor(width / r)}px`
      box.style.top = `${i * (WARM_HEIGHT + 8)}px`
      const video = document.createElement('video')
      video.muted = true
      video.preload = 'auto'
      video.src = `clip://media/${encodeURIComponent(clip.id)}`
      box.appendChild(video)
      // The player crossfades its poster over the first frame: a translucent
      // layer inside the rounded stage, drawn while HDR is on screen. This is
      // that layer, so its shader is built here too.
      const veil = document.createElement('div')
      veil.className = 'warm-veil'
      box.appendChild(veil)
      host.appendChild(box)
    })
  },
  leave() {
    root.classList.add('leaving')
    // Hands the decoders back now rather than when the window goes, and takes
    // the boxes with them: the card fades out, and they would show through it.
    for (const v of document.querySelectorAll('video')) {
      v.removeAttribute('src')
      v.load()
    }
    document.getElementById('warm')?.replaceChildren()
  },
}
