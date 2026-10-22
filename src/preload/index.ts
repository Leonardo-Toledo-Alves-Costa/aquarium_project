import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AquariumApi, type UpdateState } from '../shared/ipc'

const api: AquariumApi = {
  listSources: () => ipcRenderer.invoke(IPC.listSources),
  selectSource: (id) => ipcRenderer.invoke(IPC.selectSource, id),
  startAudio: (options) => ipcRenderer.invoke(IPC.startAudio, options),
  updateAudio: (options) => ipcRenderer.invoke(IPC.updateAudio, options),
  stopAudio: () => ipcRenderer.invoke(IPC.stopAudio),
  loadGroupCode: () => ipcRenderer.invoke(IPC.loadGroupCode),
  saveGroupCode: (code) => ipcRenderer.invoke(IPC.saveGroupCode, code),
  getUpdateState: () => ipcRenderer.invoke(IPC.getUpdateState),
  onUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState): void => listener(state)
    ipcRenderer.on(IPC.updateState, handler)
    return () => ipcRenderer.removeListener(IPC.updateState, handler)
  },
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  setBusy: (busy) => ipcRenderer.invoke(IPC.setBusy, busy),
  platform: process.platform
}

contextBridge.exposeInMainWorld('aquarium', api)

// MessagePort não passa pelo contextBridge; vai para a página por window.postMessage.
ipcRenderer.on(IPC.audioPort, (event) => {
  window.postMessage({ type: 'aquarium-audio-port' }, '*', event.ports)
})
