import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { userDataOverride } from './lib/env'
import { Library } from './lib/library'
import { ensureDirs } from './lib/paths'
import { installProtocol, registerScheme } from './lib/protocol'
import { createMainWindow } from './lib/window'

// Optional isolated profile (separate library, cache and single-instance lock) —
// handy for testing a build next to a running instance. See src/main/lib/env.ts.
if (userDataOverride) app.setPath('userData', userDataOverride)

// Lets Chromium use the GPU's HEVC decoder for ShadowPlay recordings that use it.
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')

registerScheme()

let mainWindow: BrowserWindow | null = null
let library: Library | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.sift.app')
    ensureDirs()

    library = new Library((name, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(name, payload)
    })
    await library.init()

    installProtocol((id) => library?.clipPath(id))
    registerIpc(library, () => mainWindow)

    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    mainWindow = createMainWindow()
    mainWindow.on('closed', () => (mainWindow = null))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  let shuttingDown = false
  app.on('before-quit', (event) => {
    if (shuttingDown || !library) return
    event.preventDefault()
    shuttingDown = true
    void library.shutdown().finally(() => app.quit())
  })
}
