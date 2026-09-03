import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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
    stats: () => ipcRenderer.invoke('library:stats'),
    revealData: () => ipcRenderer.invoke('library:reveal-data')
  },
  clips: {
    rename: (id, name) => ipcRenderer.invoke('clip:rename', id, name),
    delete: (id) => ipcRenderer.invoke('clip:delete', id),
    reveal: (id) => ipcRenderer.invoke('clip:reveal', id),
    copyPath: (id) => ipcRenderer.invoke('clip:copy-path', id)
  },
  window: {
    minimize: () => void ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => void ipcRenderer.invoke('window:toggle-maximize'),
    close: () => void ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized')
  },
  on<K extends EventName>(name: K, handler: (payload: EventMap[K]) => void) {
    const listener = (_e: IpcRendererEvent, payload: EventMap[K]): void => handler(payload)
    ipcRenderer.on(name, listener)
    return () => ipcRenderer.off(name, listener)
  },
  mediaUrl: (clipId) => `clip://media/${clipId}`,
  thumbUrl: (file) => `clip://thumb/${encodeURIComponent(file)}`
}

contextBridge.exposeInMainWorld('api', api)
