import { Menu, Tray, app, type NativeImage } from 'electron'

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
 *
 * It never touches the window itself: hiding to the tray destroys it (see
 * `scheduleRelease` in main/index.ts), so "bring Sift back" can mean building a
 * new one. `show` is main's single entry point for that.
 */
export function createTray(opts: {
  /** The themed app icon (see `syncIcon` in main/index.ts). */
  icon: NativeImage
  /** Restore the window, building it again if the tray release already took it. */
  show: () => void
  /** Restore the window and put it on the OS pane of the settings screen. */
  onSettings: () => void
}): AppTray {
  let full = opts.icon

  const tray = new Tray(small(full))
  tray.setToolTip('Sift')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Sift', click: () => opts.show() },
      { type: 'separator' },
      { label: 'Settings…', click: () => opts.onSettings() },
      { type: 'separator' },
      // Goes through `before-quit`, which flushes the library and stops the
      // watchers before the process actually exits.
      { label: 'Quit Sift', click: () => app.quit() },
    ]),
  )
  // Windows convention: a plain left click on the icon brings the app back.
  tray.on('click', () => opts.show())
  tray.on('double-click', () => opts.show())

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
