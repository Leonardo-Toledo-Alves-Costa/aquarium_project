import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AquariumApi } from '../shared/ipc'

const api: AquariumApi = {
  listSources: () => ipcRenderer.invoke(IPC.listSources),
  selectSource: (id) => ipcRenderer.invoke(IPC.selectSource, id),
  platform: process.platform
}

contextBridge.exposeInMainWorld('aquarium', api)
