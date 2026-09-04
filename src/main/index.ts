import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { perfLog, userDataOverride } from './lib/env'
import { Library } from './lib/library'
import { ensureDirs } from './lib/paths'
import { installProtocol, registerScheme } from './lib/protocol'
import { createSplash, type Splash } from './lib/splash'
import { createTray, type AppTray } from './lib/tray'
import { createUpdater, type Updater } from './lib/updater'
import { createMainWindow } from './lib/window'

// Optional isolated profile (separate library, cache and single-instance lock) —
// handy for testing a build next to a running instance. See src/main/lib/env.ts.
if (userDataOverride) app.setPath('userData', userDataOverride)

// Lets Chromium use the GPU's HEVC decoder for ShadowPlay recordings that use it.
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')

registerScheme()

let mainWindow: BrowserWindow | null = null
let library: Library | null = null
let splash: Splash | null = null
let tray: AppTray | null = null
let updater: Updater | null = null
/** Set as soon as a quit begins, so the close handler stops hiding the window. */
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    // The window may be hidden in the tray, so relaunching has to show it.
    mainWindow.show()
    mainWindow.focus()
  })

  /** The tray exists only while closing means 'hide', so nothing hides with no way back. */
  function syncTray(enabled: boolean): void {
    if (!enabled) {
      tray?.destroy()
      tray = null
      return
    }
    if (tray) return
    tray = createTray({
      getWindow: () => mainWindow,
      onSettings: () => mainWindow?.webContents.send('app:open-settings', null)
    })
  }

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.sift.app')
    ensureDirs()

    // Up first, so there is something on screen for the rest of this function.
    // It holds until the renderer reports its first frame (`window:ready`), and
    // gives up on its own if that never arrives.
    splash = createSplash(() => mainWindow)
    splash.version(app.getVersion())
    splash.status('Opening library…')

    library = new Library((name, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(name, payload)
    })
    await library.init()
    splash.theme(library.settings.theme, library.settings.animations)
    splash.status('Loading your clips…')

    // Same lazy send as the Library emitter above: the window does not exist yet.
    updater = createUpdater({
      emit: (name, payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(name, payload)
      },
      quit: () => app.quit()
    })

    installProtocol((id) => library?.clipPath(id))
    registerIpc(
      library,
      () => mainWindow,
      () => splash?.finish(),
      (s) => {
        syncTray(s.minimizeToTray)
        updater?.setAutoCheck(s.autoCheckUpdates)
      },
      updater
    )
    updater.setAutoCheck(library.settings.autoCheckUpdates)

    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    mainWindow = createMainWindow({ autoShow: false })
    mainWindow.on('closed', () => (mainWindow = null))

    // With 'minimize on close' on, closing hides the window instead of ending the
    // process: the folder watchers and the export queue keep running, and the
    // tray becomes the only way out. Covers the titlebar X (window:close routes
    // through win.close()) and Alt+F4 alike.
    mainWindow.on('close', (e) => {
      if (quitting || !library?.settings.minimizeToTray) return
      e.preventDefault()
      mainWindow?.hide()
      if (library.settings.trayHintShown) return
      // Said once, ever: the notification area is often collapsed behind the
      // overflow chevron, so a silent hide reads as a crash.
      tray?.hint()
      library.setSettings({ trayHintShown: true })
    })

    syncTray(library.settings.minimizeToTray)

    // SIFT_PERF_LOG=1: what each process costs, sampled from main so the numbers
    // keep coming while the window is hidden. `Tab` is the renderer.
    if (perfLog) {
      setInterval(() => {
        for (const m of app.getAppMetrics()) {
          const ws = Math.round((m.memory?.workingSetSize ?? 0) / 1024)
          console.log(`[perf] ${m.type}#${m.pid} cpu=${m.cpu.percentCPUUsage.toFixed(1)}% ws=${ws}MB`)
        }
      }, 5000)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  let shuttingDown = false
  app.on('before-quit', (event) => {
    // Every quit path passes through here first — the tray's Quit item,
    // window-all-closed, a Windows session shutdown — so this one flag is
    // enough to tell the close handler that this is a real exit.
    quitting = true
    if (shuttingDown || !library) return
    event.preventDefault()
    shuttingDown = true
    updater?.dispose()
    // Drop the icon straight away: quitting flushes the library first, and a
    // tray icon left sitting there through it looks like nothing happened.
    tray?.destroy()
    tray = null
    void library.shutdown().finally(() => {
      // Order matters: quitAndInstall spawns the NSIS installer *before* it quits,
      // so running it any earlier would have the installer fighting file locks
      // against a library still flushing its WAL. It calls app.quit() itself,
      // which re-enters this handler and falls out at the shuttingDown guard.
      if (updater?.wantsInstall()) updater.runInstaller()
      else app.quit()
    })
  })
}
