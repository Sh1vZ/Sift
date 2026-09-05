import { BrowserWindow, screen, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { openDevTools, userDataOverride } from './env'
import { appIconPath } from './paths'

function preloadPath(): string {
  const dir = join(import.meta.dirname, '../preload')
  for (const name of ['index.mjs', 'index.js', 'index.cjs']) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return join(dir, 'index.js')
}

/**
 * Where the window was and what shape it was in. Carried across a tray release
 * (see `scheduleRelease` in main/index.ts), which destroys the window outright,
 * so the one that replaces it comes back exactly where the user left it instead
 * of at the default size in the middle of the screen.
 */
export interface WindowPlacement {
  bounds: Electron.Rectangle
  maximized: boolean
}

/**
 * The window's geometry, or null once it is gone. `getNormalBounds` and not
 * `getBounds`: a maximized window reports the whole work area, and storing that
 * as the restored size would lose the size the user actually chose.
 */
export function placementOf(win: BrowserWindow): WindowPlacement | null {
  if (win.isDestroyed()) return null
  return { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
}

/**
 * Whether a remembered rectangle still lands on a connected display. A laptop
 * undocked while Sift sat in the tray would otherwise restore the window onto a
 * monitor that is no longer there, with no way to drag it back.
 */
function onScreen(r: Electron.Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    return (
      r.x < a.x + a.width && r.x + r.width > a.x && r.y < a.y + a.height && r.y + r.height > a.y
    )
  })
}

/**
 * `autoShow: false` leaves the window hidden once it has painted, so the splash
 * can hold the screen until the renderer says the library is up and then reveal
 * it (see lib/splash.ts). Everything else about the window is unchanged.
 *
 * `placement` restores the geometry of a window that was destroyed on its way to
 * the tray; omitted (or off-screen) it falls back to the default size, centred.
 */
export function createMainWindow({
  autoShow = true,
  placement = null,
}: { autoShow?: boolean; placement?: WindowPlacement | null } = {}): BrowserWindow {
  const saved = placement && onScreen(placement.bounds) ? placement.bounds : null
  const win = new BrowserWindow({
    icon: appIconPath(),
    // Position only when it was remembered; without x/y Electron centres the window.
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    minWidth: 980,
    minHeight: 620,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f0f23',
    title: userDataOverride ? 'Sift (dev profile)' : 'Sift',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  // Before the first show, so a window restored from the tray never appears at
  // its normal size and then snaps out. The renderer asks for the state itself
  // on mount (`window:is-maximized`), so the event this fires going nowhere yet
  // costs nothing.
  if (placement?.maximized) win.maximize()

  win.on('ready-to-show', () => {
    if (autoShow) win.show()
    if (openDevTools) win.webContents.openDevTools({ mode: 'detach' })
  })
  // Keep the profile marker in the title bar instead of letting the page title replace it.
  if (userDataOverride) win.on('page-title-updated', (e) => e.preventDefault())
  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))

  // Whether the window is actually on screen — the renderer releases its video,
  // its grid rows and its decoded images while it is not. Derived from the
  // window rather than tracked through the events, because Windows does not
  // reliably emit 'restore' (a maximized window can come back as 'maximize'
  // alone); asking every time means a missed event self-heals on the next one
  // instead of leaving the app idle while it is visible.
  //
  // The window is hidden on purpose between creation and the splash handing over
  // (see lib/splash.ts), and a renderer told it is hidden during boot would drop
  // the rows out of its very first paint. Nothing is reported until the window
  // has been on screen once; the renderer assumes it is visible until then.
  let shown = false
  let lastVisible: boolean | null = null
  const pushVisible = (): void => {
    if (win.isDestroyed() || !shown) return
    // isVisible() stays true for a minimized window, hence the second check.
    const visible = win.isVisible() && !win.isMinimized()
    if (visible === lastVisible) return
    lastVisible = visible
    win.webContents.send('window:visible', visible)
  }
  win.on('show', () => {
    shown = true
    pushVisible()
  })
  win.on('hide', pushVisible)
  win.on('minimize', pushVisible)
  win.on('restore', pushVisible)
  win.on('maximize', pushVisible)
  win.on('unmaximize', pushVisible)
  win.on('focus', pushVisible)
  // A reload (devtools, HMR) starts a renderer that assumes it is visible; put it
  // straight if the window is not. No-ops during boot, per `shown` above.
  win.webContents.on('did-finish-load', () => {
    lastVisible = null
    pushVisible()
  })

  // A file dropped where no handler claims it would otherwise navigate the
  // window to file:// and take the app down with it. Nothing in Sift navigates
  // on purpose (reloads go through webContents.reload, which does not fire this).
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  return win
}
