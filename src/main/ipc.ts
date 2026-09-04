import { type BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { THEME_IDS, type ExportRequest, type Settings } from '@shared/types'
import { YOUTUBE_PRIVACIES, type UploadRequest, type YouTubePrivacy } from '@shared/youtube'
import type { Library } from './lib/library'
import type { Updater } from './lib/updater'
import type { YouTube } from './lib/youtube'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)
const privacy = (v: unknown): YouTubePrivacy =>
  YOUTUBE_PRIVACIES.includes(v as YouTubePrivacy) ? (v as YouTubePrivacy) : 'private'
/** A client secret file is a few hundred bytes; anything larger is not one. */
const CLIENT_SECRET_MAX_BYTES = 64 * 1024

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
  /** Google projects, the upload queue and the quota ledger. */
  youtube: YouTube,
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
    if (p.youtubeCheckStatus !== undefined) p.youtubeCheckStatus = p.youtubeCheckStatus === true
    if (p.lastSeenVersion !== undefined) p.lastSeenVersion = str(p.lastSeenVersion)
    // Capped: an unbounded list of dismissals would grow with every rescan.
    if (p.dismissedGameMerges !== undefined)
      p.dismissedGameMerges = Array.isArray(p.dismissedGameMerges)
        ? p.dismissedGameMerges.map(str).filter(Boolean).slice(-50)
        : []
    const settings = library.setSettings(p)
    // Switching the checks back on has to start a tick; nothing else would
    // until the next upload.
    if (p.youtubeCheckStatus !== undefined) youtube.setCheckStatus(settings.youtubeCheckStatus)
    onSettingsApplied(settings)
    return settings
  })

  // Rebuilt field by field: the payload crosses the bridge as plain JSON.
  ipcMain.handle('library:set-game-alias', (_e, sources, display) =>
    library.setGameAlias(
      Array.isArray(sources) ? sources.map(str).filter(Boolean) : [],
      display === null || display === undefined ? null : str(display),
    ),
  )

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
  ipcMain.handle('clip:copy-file', (_e, id) => library.copyFile(str(id)))
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

  ipcMain.handle('clip:open-youtube', (_e, id) => youtube.openVideo(str(id)))
  ipcMain.handle('clip:copy-youtube-link', (_e, id) => youtube.copyLink(str(id)))
  ipcMain.handle('clip:remove-youtube', (_e, id) => youtube.removeVideo(str(id)))
  ipcMain.handle('clip:check-youtube', (_e, id) => youtube.checkVideo(str(id)))
  ipcMain.handle('clip:set-favourite', (_e, id, favourite) =>
    library.setFavourite(str(id), favourite === true),
  )
  ipcMain.handle('clip:set-seen', (_e, id, seen) => library.setSeen(str(id), seen === true))

  ipcMain.handle('export:cancel', (_e, id) => library.cancelExport(str(id)))
  ipcMain.handle('export:dismiss', (_e, id) => library.dismissExport(str(id)))

  const yt = youtube.accounts
  ipcMain.handle('youtube:state', () => yt.state())
  ipcMain.handle('youtube:add-account', (_e, clientId, secret, label) =>
    yt.add(str(clientId), str(secret), str(label)),
  )
  ipcMain.handle('youtube:add-account-json', (_e, text) => yt.addJson(str(text)))
  ipcMain.handle('youtube:import-account-files', async () => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose the client secret files downloaded from Google Cloud',
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [{ name: 'Google client secret', extensions: ['json'] }],
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled) return { ok: true, added: 0, cancelled: true }
    let added = 0
    const errors: string[] = []
    for (const file of result.filePaths) {
      try {
        const text = await readFile(file, { encoding: 'utf8' })
        if (text.length > CLIENT_SECRET_MAX_BYTES)
          throw new Error('File is too large to be a client secret.')
        const res = yt.addJson(text, basename(file, '.json'))
        if (res.ok) added++
        else errors.push(`${basename(file)}: ${res.error ?? 'not added'}`)
      } catch (err) {
        errors.push(`${basename(file)}: ${(err as Error).message}`)
      }
    }
    return errors.length ? { ok: false, added, error: errors.join('\n') } : { ok: true, added }
  })
  ipcMain.handle('youtube:rename-account', (_e, id, label) => yt.rename(str(id), str(label)))
  ipcMain.handle('youtube:connect', (_e, id) => yt.connect(str(id)))
  ipcMain.handle('youtube:cancel-connect', () => yt.cancelConnect())
  ipcMain.handle('youtube:disconnect', (_e, id) => yt.disconnect(str(id)))
  ipcMain.handle('youtube:remove-account', (_e, id) => yt.remove(str(id)))
  ipcMain.handle('youtube:playlists', (_e, id, refresh) => yt.playlists(str(id), refresh === true))
  ipcMain.handle('youtube:create-playlist', (_e, id, title, p) =>
    yt.createPlaylist(str(id), str(title), privacy(p)),
  )

  ipcMain.handle('upload:list', () => youtube.uploads.list())
  ipcMain.handle('upload:start', (_e, raw) => {
    // Rebuilt field by field: the request crosses the bridge as plain JSON.
    const r = (raw ?? {}) as Record<string, unknown>
    const req: UploadRequest = {
      clipId: str(r.clipId),
      title: str(r.title),
      description: str(r.description),
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
      privacy: privacy(r.privacy),
      playlistId: str(r.playlistId),
      madeForKids: r.madeForKids === true,
      accountId: str(r.accountId),
    }
    return youtube.uploads.enqueue(req)
  })
  ipcMain.handle('upload:cancel', (_e, id) => youtube.uploads.cancel(str(id)))
  ipcMain.handle('upload:dismiss', (_e, id) => youtube.uploads.dismiss(str(id)))

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
