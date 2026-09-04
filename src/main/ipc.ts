import { type BrowserWindow, dialog, ipcMain } from 'electron'
import { THEME_IDS, type ExportRequest, type Settings } from '@shared/types'
import type { Library } from './lib/library'
import type { Updater } from './lib/updater'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)

async function pickFolder(win: BrowserWindow | null, title: string): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    title,
    properties: ['openDirectory', 'dontAddToRecent'],
  }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

export function registerIpc(
  library: Library,
  getWindow: () => BrowserWindow | null,
  onRendererReady: () => void,
  /** Runs after every accepted settings patch, so main can react to app-level flags. */
  onSettingsApplied: (settings: Settings) => void,
  /** The auto-update state machine; inert in development builds. */
  updates: Updater,
): void {
  ipcMain.handle('library:snapshot', () => library.snapshot())

  ipcMain.handle('library:add-folder', async () => {
    const path = await pickFolder(getWindow(), 'Choose a folder that contains your clips')
    return path ? library.addFolder(path) : { folder: null }
  })

  ipcMain.handle('library:add-folder-path', (_e, p) => library.addFolder(str(p)))
  ipcMain.handle('library:remove-folder', (_e, id) => library.removeFolder(str(id)))
  ipcMain.handle('library:rescan', (_e, id) => library.rescan(str(id) || undefined))
  ipcMain.handle('library:set-settings', (_e, patch) => {
    const p = { ...((patch ?? {}) as Partial<Settings>) }
    // Unknown theme ids would leave the renderer on no theme block at all.
    if (p.theme !== undefined && !THEME_IDS.includes(p.theme)) delete p.theme
    if (p.autoCheckUpdates !== undefined) p.autoCheckUpdates = p.autoCheckUpdates === true
    if (p.lastSeenVersion !== undefined) p.lastSeenVersion = str(p.lastSeenVersion)
    const settings = library.setSettings(p)
    onSettingsApplied(settings)
    return settings
  })

  ipcMain.handle('library:stats', () => library.stats())
  ipcMain.handle('library:reveal-data', () => library.revealData())

  ipcMain.handle('library:set-clips-dir', (_e, p) => library.setClipsDir(str(p)))
  ipcMain.handle('library:choose-clips-dir', async () => {
    const path = await pickFolder(getWindow(), 'Choose where exported clips are saved')
    return path ? library.setClipsDir(path) : { ok: true }
  })
  ipcMain.handle('library:reveal-clips-dir', () => library.revealClipsDir())

  ipcMain.handle('clip:rename', (_e, id, name) => library.renameClip(str(id), str(name)))
  ipcMain.handle('clip:delete', (_e, id, permanent) =>
    library.deleteClip(str(id), permanent === true),
  )
  ipcMain.handle('clip:reveal', (_e, id) => library.reveal(str(id)))
  ipcMain.handle('clip:copy-path', (_e, id) => library.copyPath(str(id)))
  ipcMain.handle('clip:export', (_e, raw) => {
    // Rebuilt field by field: the request crosses the bridge as plain JSON.
    const r = (raw ?? {}) as Record<string, unknown>
    const req: ExportRequest = {
      id: str(r.id),
      name: str(r.name),
      start: num(r.start),
      end: num(r.end),
      muted: r.muted === true,
    }
    return library.exportClip(req)
  })

  ipcMain.handle('export:cancel', (_e, id) => library.cancelExport(str(id)))
  ipcMain.handle('export:dismiss', (_e, id) => library.dismissExport(str(id)))

  ipcMain.handle('updates:get', () => updates.state())
  ipcMain.handle('updates:check', () => updates.check(true))
  ipcMain.handle('updates:install', () => updates.install())
  ipcMain.handle('updates:whats-new', () => library.whatsNew())
  ipcMain.handle('updates:dismiss-whats-new', () => library.dismissWhatsNew())
  ipcMain.handle('updates:changelog', () => library.changelog())

  ipcMain.handle('window:minimize', () => getWindow()?.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('window:close', () => getWindow()?.close())
  ipcMain.handle('window:is-maximized', () => getWindow()?.isMaximized() ?? false)
  ipcMain.handle('window:ready', () => {
    onRendererReady()
  })
}
