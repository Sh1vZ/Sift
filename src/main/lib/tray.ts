import { Menu, Tray, app, type BrowserWindow, type NativeImage } from 'electron'

export interface AppTray {
  /** The "Sift is still running" balloon shown the first time the window hides. */
  hint(): void
  /** Swap the icon, e.g. when the theme changes; the balloon picks it up too. */
  setIcon(icon: NativeImage): void
  destroy(): void
}

// The icon arrives at ICON_SIZE; Windows draws the notification area at 16pt logical.
const small = (icon: NativeImage): NativeImage => icon.resize({ width: 16, height: 16 })

/**
 * Sift's presence in the notification area. It exists only while
 * `minimizeToTray` is on — see `syncTray` in main/index.ts — because that is the
 * only state where the window can vanish and the user needs a way back.
 */
export function createTray(opts: {
  /** The themed app icon (see `syncIcon` in main/index.ts). */
  icon: NativeImage
  getWindow: () => BrowserWindow | null
  onSettings: () => void
}): AppTray {
  let full = opts.icon

  const show = (): void => {
    const win = opts.getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  const tray = new Tray(small(full))
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
    setIcon: (icon) => {
      full = icon
      tray.setImage(small(icon))
    },
    destroy: () => tray.destroy(),
  }
}
