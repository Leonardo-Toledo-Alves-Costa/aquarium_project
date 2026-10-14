import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AquariumApi } from '../shared/ipc'

const api: AquariumApi = {
  listSources: () => ipcRenderer.invoke(IPC.listSources),
  selectSource: (id) => ipcRenderer.invoke(IPC.selectSource, id),
  startAudio: (options) => ipcRenderer.invoke(IPC.startAudio, options),
  updateAudio: (options) => ipcRenderer.invoke(IPC.updateAudio, options),
  stopAudio: () => ipcRenderer.invoke(IPC.stopAudio),
  loadGroupCode: () => ipcRenderer.invoke(IPC.loadGroupCode),
  saveGroupCode: (code) => ipcRenderer.invoke(IPC.saveGroupCode, code),
  platform: process.platform
}

contextBridge.exposeInMainWorld('aquarium', api)

// MessagePort não passa pelo contextBridge; vai para a página por window.postMessage.
ipcRenderer.on(IPC.audioPort, (event) => {
  window.postMessage({ type: 'aquarium-audio-port' }, '*', event.ports)
})
