import { BrowserWindow, shell } from 'electron'
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
 * `autoShow: false` leaves the window hidden once it has painted, so the splash
 * can hold the screen until the renderer says the library is up and then reveal
 * it (see lib/splash.ts). Everything else about the window is unchanged.
 */
export function createMainWindow({ autoShow = true }: { autoShow?: boolean } = {}): BrowserWindow {
  const win = new BrowserWindow({
    icon: appIconPath(),
    width: 1440,
    height: 900,
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
      spellcheck: false
    }
  })

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

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  return win
}
