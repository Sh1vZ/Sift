import { app, type BrowserWindow, dialog, nativeImage, type NativeImage } from 'electron'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { THEME_BRAND } from '@shared/themes'
import type { ThemeId } from '@shared/types'
import { registerIpc } from './ipc'
import { perfLog, userDataOverride } from './lib/env'
import { ICON_SIZE, renderAppIcon } from './lib/icon'
import { Library } from './lib/library'
import { ensureDirs } from './lib/paths'
import { installProtocol, registerScheme } from './lib/protocol'
import { createSplash, type Splash } from './lib/splash'
import { createTray, type AppTray } from './lib/tray'
import { createUpdater, type Updater } from './lib/updater'
import { createMainWindow, placementOf, type WindowPlacement } from './lib/window'
import { createYouTube, type YouTube } from './lib/youtube'

// Optional isolated profile (separate library, cache and single-instance lock) —
// handy for testing a build next to a running instance. See src/main/lib/env.ts.
if (userDataOverride) app.setPath('userData', userDataOverride)

// Lets Chromium use the GPU's HEVC decoder for ShadowPlay recordings that use it.
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')

registerScheme()

/**
 * A handle on V8's collector, or null where it could not be had.
 *
 * Sift spends most of its life in the tray with no window, and an idle main
 * process allocates almost nothing — so V8 has no reason to collect the garbage
 * a scan or a snapshot left behind, and the working set stays at its high-water
 * mark for as long as the app sits there. `trimMemory` gives it that reason
 * once, right after the renderer goes.
 *
 * The flag is flipped here, at module load, and put back immediately: V8 reads
 * it when a context installs its globals, and toggling flags long after startup
 * is the part that is unsupported. One `gc` handle, kept for the process.
 */
const forceGc: (() => void) | null = (() => {
  try {
    setFlagsFromString('--expose-gc')
    const gc: unknown = runInNewContext('gc')
    return typeof gc === 'function' ? (gc as () => void) : null
  } catch {
    return null
  } finally {
    try {
      setFlagsFromString('--no-expose-gc')
    } catch {
      // Nothing depends on the flag going back; `forceGc` is already captured.
    }
  }
})()

/**
 * How long a window hidden to the tray is kept before it is destroyed. Long
 * enough that closing by accident can be undone with no reload, short enough
 * that the memory is back well before anyone notices it was held.
 */
const TRAY_RELEASE_MS = 5_000
/** Let the renderer's process finish exiting before asking main to collect after it. */
const TRIM_DELAY_MS = 2_000
/**
 * The restore splash is on screen for less than the launch one: there is no
 * library to open behind it, only a renderer to boot, and padding that out
 * would make coming back feel slower than it is.
 */
const RESTORE_SPLASH_MS = 400

let mainWindow: BrowserWindow | null = null
let library: Library | null = null
let splash: Splash | null = null
let tray: AppTray | null = null
let updater: Updater | null = null
let youtube: YouTube | null = null
/** Set as soon as a quit begins, so the close handler stops hiding the window. */
let quitting = false
/** The user chose "Quit anyway" over a running upload (or Windows is shutting down). */
let quitConfirmed = false
/** Geometry of the window that went to the tray, so the one built to replace it matches. */
let placement: WindowPlacement | null = null
/** Armed while a hidden window waits to be destroyed; cleared the moment it is wanted again. */
let releaseTimer: NodeJS.Timeout | null = null
/** Whether the current window's renderer has reported its first frame. */
let rendererReady = false
/** A tray "Settings…" that arrived while the window was still being built. */
let pendingSettings = false

/**
 * A YouTube upload cannot be resumed after a restart, so leaving mid-upload
 * throws the sent bytes away. Asked once per quit attempt, never during an OS
 * shutdown (see `session-end`).
 */
async function confirmQuitOverUpload(parent: BrowserWindow | null): Promise<boolean> {
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    title: 'Upload in progress',
    message: 'A YouTube upload is still running.',
    detail: 'Quitting cancels it. The part already sent is discarded and the video is not created.',
    buttons: ['Keep uploading', 'Quit anyway'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const { response } =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, opts)
      : await dialog.showMessageBox(opts)
  return response === 1
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  /**
   * The taskbar and tray icon follow the theme. It is drawn here from the
   * theme's brand colours (lib/icon.ts) rather than read from build/icon.png,
   * which stays the neutral icon for the installer, the shortcuts and the
   * window's first paint. One render per theme, cached until the theme changes.
   * Windows draws a *pinned* app from its shortcut, so a pinned Sift keeps the
   * neutral icon while running; unpinned, Alt+Tab and the tray all switch.
   */
  let iconTheme: ThemeId | null = null
  let appIcon: NativeImage | null = null
  function currentIcon(): NativeImage {
    const theme = library?.settings.theme ?? 'sift'
    if (!appIcon || theme !== iconTheme) {
      iconTheme = theme
      appIcon = nativeImage.createFromBuffer(renderAppIcon(THEME_BRAND[theme], ICON_SIZE))
    }
    return appIcon
  }
  function syncIcon(): void {
    const icon = currentIcon()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setIcon(icon)
    tray?.setIcon(icon)
  }

  /** The tray exists only while closing means 'hide', so nothing hides with no way back. */
  function syncTray(enabled: boolean): void {
    if (!enabled) {
      tray?.destroy()
      tray = null
      return
    }
    if (tray) return
    tray = createTray({
      icon: currentIcon(),
      show: () => showMainWindow(),
      onSettings: () => openSettingsPane(),
    })
  }

  function cancelRelease(): void {
    if (!releaseTimer) return
    clearTimeout(releaseTimer)
    releaseTimer = null
  }

  /**
   * Destroy the window a moment after it hides to the tray.
   *
   * Nearly all of Sift's memory is the renderer's: Chromium's own per-process
   * floor, the clip grid, the decoded posters, the player's decoder. Hiding the
   * window already has the renderer drop what it can (see `window:visible` in
   * lib/window.ts), but a hidden renderer is still a whole process, and Sift is
   * meant to sit in the tray through a session of a game without being felt. So
   * the window goes entirely, and its renderer process with it.
   *
   * Main is untouched: the folder watchers, the export queue and a running
   * upload all keep going, and the library stays open. Coming back therefore
   * costs a renderer boot and nothing else — no rescan, no reopened database.
   * What is lost is the renderer's own view state: the screen the user was on,
   * the scroll position, an open search.
   */
  function scheduleRelease(): void {
    cancelRelease()
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      const win = mainWindow
      if (!win || win.isDestroyed() || win.isVisible()) return
      mainWindow = null
      // destroy, not close: close would run the handler below and hide it again.
      win.destroy()
      setTimeout(trimMemory, TRIM_DELAY_MS)
    }, TRAY_RELEASE_MS)
  }

  /** See `forceGc`. Runs once the renderer's process is gone, so it collects after it too. */
  function trimMemory(): void {
    if (mainWindow) return
    try {
      forceGc?.()
    } catch {
      // Best effort by definition; the window release above is the part that matters.
    }
  }

  /**
   * Bring the window back, building it again when the tray release has already
   * taken it. Everything that can ask for the window — the tray icon, its menu,
   * a second launch, the dock on macOS — comes through here.
   */
  function showMainWindow(): void {
    // A quit already under way tears the window down; putting it back on screen
    // now would only show the user a window in the middle of shutting down.
    if (quitting) return
    cancelRelease()
    const win = mainWindow
    if (win && !win.isDestroyed()) {
      // Still coming up behind the splash, which is on screen and will reveal it
      // on its own: showing a blank frame now would only get in the way. Once
      // the splash has given up and revealed it anyway, isVisible() says so.
      if (!rendererReady && !win.isVisible()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      return
    }
    if (!library) return
    // The same handover as a launch, minus the two parts only a cold start
    // needs: the library is already open, and the player's shaders live in a GPU
    // process that outlived the window, so there is nothing to warm.
    splash = createSplash(() => mainWindow, { minVisibleMs: RESTORE_SPLASH_MS })
    splash.version(app.getVersion())
    splash.theme(library.settings.theme, library.settings.animations)
    splash.status('Loading your clips…')
    mainWindow = wireWindow(createMainWindow({ autoShow: false, placement }))
    syncIcon()
  }

  /** The tray's Settings item: restore the window, then put it on the OS pane. */
  function openSettingsPane(): void {
    showMainWindow()
    if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:open-settings', null)
      return
    }
    // A window still booting has nothing listening yet; `window:ready` sends it.
    pendingSettings = true
  }

  /**
   * The per-window wiring. Split out of `createMainWindow` because it is the
   * half that talks to app-level state, and out of `whenReady` because a tray
   * release means the window is built more than once per run.
   */
  function wireWindow(win: BrowserWindow): BrowserWindow {
    rendererReady = false

    win.on('closed', () => {
      if (win === mainWindow) mainWindow = null
    })

    // With 'minimize on close' on, closing hides the window instead of ending the
    // process: the folder watchers and the export queue keep running, and the
    // tray becomes the only way out. Covers the titlebar X (window:close routes
    // through win.close()) and Alt+F4 alike.
    win.on('close', (e) => {
      // With minimize-to-tray on, closing only hides the window and the upload
      // carries on, so the question is only asked when closing really quits.
      if (
        !quitting &&
        !quitConfirmed &&
        !library?.settings.minimizeToTray &&
        youtube?.uploads.hasActive()
      ) {
        e.preventDefault()
        void confirmQuitOverUpload(win).then((ok) => {
          if (!ok) return
          quitConfirmed = true
          win.close()
        })
        return
      }
      if (quitting || !library?.settings.minimizeToTray) return
      e.preventDefault()
      // Read while the window is still up: this is the shape a restore rebuilds.
      placement = placementOf(win)
      win.hide()
      scheduleRelease()
      if (library.settings.trayHintShown) return
      // Said once, ever: the notification area is often collapsed behind the
      // overflow chevron, so a silent hide reads as a crash.
      tray?.hint()
      library.setSettings({ trayHintShown: true })
    })

    // Windows is logging off or shutting down: never hold that up with a prompt.
    win.on('session-end', () => {
      quitConfirmed = true
    })

    return win
  }

  void app.whenReady().then(async () => {
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

    // Same lazy send as the Library emitter above: the window does not exist yet
    // — and, once the tray release has taken it, does not exist again until the
    // user asks for it. Anything sent meanwhile is dropped, and picked up from
    // the snapshot the next renderer fetches on boot.
    updater = createUpdater({
      emit: (name, payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(name, payload)
      },
      quit: () => app.quit(),
    })

    // The one module that talks to the network, and only on the user's say-so.
    const lib = library
    youtube = createYouTube({
      emit: (name, payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(name, payload)
      },
      store: lib.store,
      getClip: (id) => lib.clip(id),
      listClips: () => Object.values(lib.store.data.clips),
      patchClip: (patch) => lib.patchClip(patch),
      checkStatus: () => lib.store.data.settings.youtubeCheckStatus,
      recordActivity: (input) => lib.activity.record(input),
    })
    // Videos the last run left processing pick up where they stopped. Quitting
    // is never held up for one: `hasActive()` counts moving bytes only.
    youtube.resume()

    installProtocol((id) => library?.clipPath(id))
    // The player's video shaders, compiled behind the splash card rather than
    // on the first clip opened (see lib/splash.ts). Needs the protocol above.
    splash.warm(library.warmupClips())
    registerIpc(
      library,
      () => mainWindow,
      () => {
        rendererReady = true
        splash?.finish()
        // Dropped rather than kept: `finish` closes over everything it still
        // needs, and a released window builds a splash of its own.
        splash = null
        if (!pendingSettings) return
        pendingSettings = false
        mainWindow?.webContents.send('app:open-settings', null)
      },
      (s) => {
        syncIcon()
        syncTray(s.minimizeToTray)
        updater?.setAutoCheck(s.autoCheckUpdates)
      },
      updater,
      youtube,
    )
    updater.setAutoCheck(library.settings.autoCheckUpdates)

    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    mainWindow = wireWindow(createMainWindow({ autoShow: false }))
    // Still hidden behind the splash, so the themed icon is in place before the
    // taskbar button ever shows.
    syncIcon()

    syncTray(library.settings.minimizeToTray)

    // SIFT_PERF_LOG=1: what each process costs, sampled from main so the numbers
    // keep coming while the window is hidden — and after a tray release has
    // taken the renderer away, which is the measurement this exists for. `Tab`
    // is the renderer; the total is roughly what Task Manager shows for Sift.
    if (perfLog) {
      setInterval(() => {
        const metrics = app.getAppMetrics()
        let total = 0
        for (const m of metrics) {
          const ws = Math.round((m.memory?.workingSetSize ?? 0) / 1024)
          total += ws
          // eslint-disable-next-line no-console -- SIFT_PERF_LOG exists to print this
          console.log(
            `[perf] ${m.type}#${m.pid} cpu=${m.cpu.percentCPUUsage.toFixed(1)}% ws=${ws}MB`,
          )
        }
        const state = !mainWindow ? 'released' : mainWindow.isVisible() ? 'shown' : 'hidden'
        // eslint-disable-next-line no-console -- SIFT_PERF_LOG exists to print this
        console.log(`[perf] total ws=${total}MB procs=${metrics.length} window=${state}`)
      }, 5000)
    }

    app.on('activate', () => showMainWindow())
  })

  app.on('window-all-closed', () => {
    // A window destroyed on its way to the tray is not the end of the app: the
    // tray icon is still there, and it exists only while it is the way back.
    if (tray) return
    if (process.platform !== 'darwin') app.quit()
  })

  let shuttingDown = false
  app.on('before-quit', (event) => {
    // The tray's Quit item and an update install skip the window's close
    // handler, so the upload question is asked here too.
    if (!shuttingDown && !quitConfirmed && youtube?.uploads.hasActive()) {
      event.preventDefault()
      void confirmQuitOverUpload(mainWindow).then((ok) => {
        if (!ok) return
        quitConfirmed = true
        app.quit()
      })
      return
    }
    // Every quit path passes through here first — the tray's Quit item,
    // window-all-closed, a Windows session shutdown — so this one flag is
    // enough to tell the close handler that this is a real exit.
    quitting = true
    // Nothing builds a window from here on, and a pending release has been
    // overtaken by the real teardown below.
    cancelRelease()
    if (shuttingDown || !library) return
    event.preventDefault()
    shuttingDown = true
    updater?.dispose()
    // Drop the icon straight away: quitting flushes the library first, and a
    // tray icon left sitting there through it looks like nothing happened.
    tray?.destroy()
    tray = null
    const lib = library
    // The running upload is aborted first: it has nothing to flush, and the
    // library close below waits on nothing that depends on it.
    void (youtube?.shutdown() ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => lib.shutdown())
      .finally(() => {
        // Order matters: quitAndInstall spawns the NSIS installer *before* it quits,
        // so running it any earlier would have the installer fighting file locks
        // against a library still flushing its WAL. It calls app.quit() itself,
        // which re-enters this handler and falls out at the shuttingDown guard.
        if (updater?.wantsInstall()) updater.runInstaller()
        else app.quit()
      })
  })
}
