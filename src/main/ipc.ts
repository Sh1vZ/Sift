import { BrowserWindow, dialog, ipcMain } from 'electron'
import { THEME_IDS, type Settings } from '@shared/types'
import type { Library } from './lib/library'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function registerIpc(library: Library, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('library:snapshot', () => library.snapshot())

  ipcMain.handle('library:add-folder', async () => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a folder that contains your clips',
      properties: ['openDirectory', 'dontAddToRecent']
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return { folder: null }
    return library.addFolder(result.filePaths[0])
  })

  ipcMain.handle('library:add-folder-path', (_e, p) => library.addFolder(str(p)))
  ipcMain.handle('library:remove-folder', (_e, id) => library.removeFolder(str(id)))
  ipcMain.handle('library:rescan', (_e, id) => library.rescan(str(id) || undefined))
  ipcMain.handle('library:set-settings', (_e, patch) => {
    const p = { ...((patch ?? {}) as Partial<Settings>) }
    // Unknown theme ids would leave the renderer on no theme block at all.
    if (p.theme !== undefined && !THEME_IDS.includes(p.theme)) delete p.theme
    return library.setSettings(p)
  })

  ipcMain.handle('library:stats', () => library.stats())
  ipcMain.handle('library:reveal-data', () => library.revealData())

  ipcMain.handle('clip:rename', (_e, id, name) => library.renameClip(str(id), str(name)))
  ipcMain.handle('clip:delete', (_e, id) => library.deleteClip(str(id)))
  ipcMain.handle('clip:reveal', (_e, id) => library.reveal(str(id)))
  ipcMain.handle('clip:copy-path', (_e, id) => library.copyPath(str(id)))

  ipcMain.handle('window:minimize', () => getWindow()?.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('window:close', () => getWindow()?.close())
  ipcMain.handle('window:is-maximized', () => getWindow()?.isMaximized() ?? false)
}
