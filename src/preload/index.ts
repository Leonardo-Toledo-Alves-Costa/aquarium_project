import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AquarioApi } from '../shared/ipc'

const api: AquarioApi = {
  listSources: () => ipcRenderer.invoke(IPC.listSources),
  selectSource: (id) => ipcRenderer.invoke(IPC.selectSource, id),
  platform: process.platform
}

contextBridge.exposeInMainWorld('aquario', api)
