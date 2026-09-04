import { Menu, Tray, app, nativeImage, type BrowserWindow } from 'electron'
import { appIconPath } from './paths'

export interface AppTray {
  /** The "Sift is still running" balloon shown the first time the window hides. */
  hint(): void
  destroy(): void
}

/**
 * Sift's presence in the notification area. It exists only while
 * `minimizeToTray` is on — see `syncTray` in main/index.ts — because that is the
 * only state where the window can vanish and the user needs a way back.
 *
 * Returns null when the icon cannot be resolved on disk (see `appIconPath`): a
 * Tray built from an empty image draws nothing, which would strand a hidden
 * window with no way to reopen or quit the app.
 */
export function createTray(opts: {
  getWindow: () => BrowserWindow | null
  onSettings: () => void
}): AppTray | null {
  const file = appIconPath()
  if (!file) return null

  const full = nativeImage.createFromPath(file)
  if (full.isEmpty()) return null
  // The source is 512px; Windows draws the notification area at 16pt logical.
  const icon = full.resize({ width: 16, height: 16 })

  const show = (): void => {
    const win = opts.getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  const tray = new Tray(icon)
  tray.setToolTip('Sift')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Sift', click: show },
      { type: 'separator' },
      {
        label: 'Settings…',
        click: () => {
          show()
          opts.onSettings()
        },
      },
      { type: 'separator' },
      // Goes through `before-quit`, which flushes the library and stops the
      // watchers before the process actually exits.
      { label: 'Quit Sift', click: () => app.quit() },
    ]),
  )
  // Windows convention: a plain left click on the icon brings the app back.
  tray.on('click', show)
  tray.on('double-click', show)

  return {
    hint: () => {
      if (process.platform !== 'win32') return
      tray.displayBalloon({
        icon: full,
        iconType: 'custom',
        title: 'Sift is still running',
        content:
          'The window closed to the tray, so new recordings keep being indexed. Right-click the tray icon to quit.',
      })
    },
    destroy: () => tray.destroy(),
  }
}
