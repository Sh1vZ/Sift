import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from 'electron'
import type { Api } from '@shared/api'
import type { EventMap, EventName } from '@shared/types'

const api: Api = {
  library: {
    snapshot: () => ipcRenderer.invoke('library:snapshot'),
    addFolder: () => ipcRenderer.invoke('library:add-folder'),
    addFolderPath: (path) => ipcRenderer.invoke('library:add-folder-path', path),
    removeFolder: (id) => ipcRenderer.invoke('library:remove-folder', id),
    rescan: (folderId) => ipcRenderer.invoke('library:rescan', folderId ?? ''),
    setSettings: (patch) => ipcRenderer.invoke('library:set-settings', patch),
    setGameAlias: (sources, display) =>
      ipcRenderer.invoke('library:set-game-alias', sources, display),
    stats: () => ipcRenderer.invoke('library:stats'),
    revealData: () => ipcRenderer.invoke('library:reveal-data'),
    setClipsDir: (path) => ipcRenderer.invoke('library:set-clips-dir', path),
    chooseClipsDir: () => ipcRenderer.invoke('library:choose-clips-dir'),
    revealClipsDir: () => ipcRenderer.invoke('library:reveal-clips-dir'),
  },
  clips: {
    rename: (id, name) => ipcRenderer.invoke('clip:rename', id, name),
    delete: (id, permanent) => ipcRenderer.invoke('clip:delete', id, permanent === true),
    reveal: (id) => ipcRenderer.invoke('clip:reveal', id),
    copyPath: (id) => ipcRenderer.invoke('clip:copy-path', id),
    copyFile: (id) => ipcRenderer.invoke('clip:copy-file', id),
    export: (req) => ipcRenderer.invoke('clip:export', req),
    openYouTube: (id) => ipcRenderer.invoke('clip:open-youtube', id),
    copyYouTubeLink: (id) => ipcRenderer.invoke('clip:copy-youtube-link', id),
    removeFromYouTube: (id) => ipcRenderer.invoke('clip:remove-youtube', id),
    checkOnYouTube: (id) => ipcRenderer.invoke('clip:check-youtube', id),
    setFavourite: (id, favourite) =>
      ipcRenderer.invoke('clip:set-favourite', id, favourite === true),
    setSeen: (id, seen) => ipcRenderer.invoke('clip:set-seen', id, seen === true),
  },
  exports: {
    cancel: (id) => ipcRenderer.invoke('export:cancel', id),
    dismiss: (id) => ipcRenderer.invoke('export:dismiss', id),
  },
  youtube: {
    state: () => ipcRenderer.invoke('youtube:state'),
    addAccount: (clientId, clientSecret, label) =>
      ipcRenderer.invoke('youtube:add-account', clientId, clientSecret, label),
    addAccountJson: (text) => ipcRenderer.invoke('youtube:add-account-json', text),
    importAccountFiles: () => ipcRenderer.invoke('youtube:import-account-files'),
    renameAccount: (id, label) => ipcRenderer.invoke('youtube:rename-account', id, label),
    connect: (id) => ipcRenderer.invoke('youtube:connect', id),
    cancelConnect: () => ipcRenderer.invoke('youtube:cancel-connect'),
    disconnect: (id) => ipcRenderer.invoke('youtube:disconnect', id),
    removeAccount: (id) => ipcRenderer.invoke('youtube:remove-account', id),
    playlists: (accountId, refresh) =>
      ipcRenderer.invoke('youtube:playlists', accountId, refresh === true),
    createPlaylist: (accountId, title, privacy) =>
      ipcRenderer.invoke('youtube:create-playlist', accountId, title, privacy),
  },
  uploads: {
    list: () => ipcRenderer.invoke('upload:list'),
    start: (req) => ipcRenderer.invoke('upload:start', req),
    cancel: (id) => ipcRenderer.invoke('upload:cancel', id),
    dismiss: (id) => ipcRenderer.invoke('upload:dismiss', id),
  },
  updates: {
    get: () => ipcRenderer.invoke('updates:get'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => void ipcRenderer.invoke('updates:install'),
    whatsNew: () => ipcRenderer.invoke('updates:whats-new'),
    dismissWhatsNew: () => void ipcRenderer.invoke('updates:dismiss-whats-new'),
    changelog: () => ipcRenderer.invoke('updates:changelog'),
  },
  window: {
    minimize: () => void ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => void ipcRenderer.invoke('window:toggle-maximize'),
    close: () => void ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    ready: () => void ipcRenderer.invoke('window:ready'),
    clearCache: () => webFrame.clearCache(),
  },
  on<K extends EventName>(name: K, handler: (payload: EventMap[K]) => void) {
    const listener = (_e: IpcRendererEvent, payload: EventMap[K]): void => handler(payload)
    ipcRenderer.on(name, listener)
    return () => ipcRenderer.off(name, listener)
  },
  mediaUrl: (clipId) => `clip://media/${clipId}`,
  thumbUrl: (file) => `clip://thumb/${encodeURIComponent(file)}`,
  // The renderer never sees `File.path`; this is the one sanctioned way to a path.
  pathForFile: (file) => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('api', api)
