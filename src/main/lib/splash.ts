import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { ThemeId, WarmupClip } from '@shared/types'

/**
 * Launch splash. A second, transparent renderer entry (`splash.html`) shown
 * while the main process opens the library and the app renderer boots — the
 * window the user actually works in stays hidden until it has a real frame, so
 * this is what fills the gap instead of nothing at all.
 *
 * It has no preload and no IPC surface: main drives it with
 * `executeJavaScript`, which the page answers through the small `window.sift`
 * handle in `src/renderer/src/splash.ts`.
 *
 * It has a second job: compiling the player's video shaders. Chromium draws a
 * <video> through Skia, and the first draw of a frame format compiles a pixel
 * shader for it — for HDR recordings (HEVC Main10, PQ) a tone-mapping shader
 * that fxc takes 200–300 ms over with the GPU process's main thread blocked,
 * so everything on screen freezes with it. Electron never persists the
 * display compositor's shader cache (Chromium's GetGrShaderDiskCacheDirectory
 * is empty there), so that hit the first clip opened after every launch. The
 * app window cannot help: hidden windows are not composited, so nothing drawn
 * in it before the reveal reaches the GPU. This one is on screen, so `warm`
 * has it draw one frame of a clip per codec behind the card, and the freeze
 * lands where the only thing moving is a progress sweep.
 */

/** Kept on screen at least this long once painted, so a fast boot reads as a launch and not a flicker. */
const MIN_VISIBLE_MS = 900
/** Room the handoff leaves after `warm` for its frames to decode and draw: a decoder start plus two or three compiles. Bounded like the rest. */
const WARM_MS = 1000
/** Matches the `.leaving` transition in styles/splash.css. */
const FADE_MS = 260
/** Hard cap: the splash never outlives a renderer that failed to signal ready. */
const MAX_VISIBLE_MS = 10_000

export interface Splash {
  /** Re-point the splash at the persisted theme and motion setting once the library is open. */
  theme(id: ThemeId, animations: boolean): void
  status(text: string): void
  version(v: string): void
  /** Draw one frame of each clip behind the card, so the player's video shaders exist before it does. */
  warm(clips: WarmupClip[]): void
  /** Fade out, reveal the main window, close. Safe to call more than once. */
  finish(): void
}

export function createSplash(getMainWindow: () => BrowserWindow | null): Splash {
  const win = new BrowserWindow({
    width: 460,
    height: 300,
    center: true,
    show: false,
    frame: false,
    transparent: true,
    // Windows would draw a rectangular shadow behind the rounded card; the card
    // brings its own --shadow-lg.
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Nothing in the page is interactive, and taking focus here would pull it
    // off whatever the user was doing while the app boots.
    focusable: false,
    title: 'Sift',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  let paintedAt = 0
  let warmedAt = 0
  let done = false

  const loaded = new Promise<void>((resolve) => {
    win.webContents.once('did-finish-load', () => resolve())
    win.webContents.once('did-fail-load', () => resolve())
  })

  /** Queued until the page has run its module script, so `window.sift` exists. */
  const run = (js: string): void => {
    void loaded.then(() => {
      if (win.isDestroyed()) return
      void win.webContents.executeJavaScript(js).catch(() => undefined)
    })
  }

  win.once('ready-to-show', () => {
    paintedAt = Date.now()
    // showInactive, not show: `focusable: false` keeps focus out, and this keeps
    // the taskbar and the foreground window undisturbed as well.
    win.showInactive()
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/splash.html`)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/splash.html'))
  }

  /** Failsafe, armed below: the splash never outlives a renderer that failed to signal ready. */
  let cap: NodeJS.Timeout | undefined

  const reveal = (): void => {
    const main = getMainWindow()
    if (main && !main.isDestroyed()) {
      main.show()
      main.focus()
    }
  }

  const splash: Splash = {
    theme(id, animations) {
      run(`window.sift?.theme(${JSON.stringify(id)}, ${animations === true})`)
    },
    status(text) {
      run(`window.sift?.status(${JSON.stringify(text)})`)
    },
    version(v) {
      run(`window.sift?.version(${JSON.stringify(v)})`)
    },
    warm(clips) {
      if (!clips.length || done) return
      warmedAt = Date.now()
      run(`window.sift?.warm(${JSON.stringify(clips)})`)
    },
    finish() {
      if (done) return
      done = true
      clearTimeout(cap)
      // A boot that beat the splash to the screen still gets its moment; one
      // that never painted at all hands over immediately. A frame that has not
      // been drawn compiles nothing, so the warm-up gets its moment too.
      const visible = paintedAt ? Math.max(0, MIN_VISIBLE_MS - (Date.now() - paintedAt)) : 0
      const warm = warmedAt ? Math.max(0, WARM_MS - (Date.now() - warmedAt)) : 0
      const wait = Math.max(visible, warm)
      setTimeout(() => {
        run('window.sift?.leave()')
        // The app window comes up under the fading splash, which is on top.
        reveal()
        setTimeout(() => {
          if (!win.isDestroyed()) win.close()
        }, FADE_MS)
      }, wait)
    },
  }

  cap = setTimeout(() => splash.finish(), MAX_VISIBLE_MS)

  return splash
}
