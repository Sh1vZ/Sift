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
