import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { IPC, type CaptureSource } from '../shared/ipc'

// Permissões que a interface pode usar. Todo o resto é negado.
const ALLOWED_PERMISSIONS = new Set(['display-capture', 'media', 'clipboard-sanitized-write', 'fullscreen'])

// Fonte (tela ou janela) escolhida na interface antes de chamar getDisplayMedia.
let selectedSourceId: string | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Aquário',
    backgroundColor: '#0c1518',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // A transmissão precisa continuar com o app minimizado (ex.: enquanto se joga).
      backgroundThrottling: false
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerCapture(): void {
  ipcMain.handle(IPC.listSources, async (): Promise<CaptureSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 }
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.toDataURL()
    }))
  })

  ipcMain.handle(IPC.selectSource, (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Fonte de captura inválida')
    selectedSourceId = id
  })

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
      const source = sources.find((s) => s.id === selectedSourceId)
      if (!source) {
        callback({})
        return
      }
      // 'loopback' captura o áudio do sistema; o Electron só suporta isso no Windows.
      callback(process.platform === 'win32' ? { video: source, audio: 'loopback' } : { video: source })
    },
    { useSystemPicker: false }
  )
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))

  registerCapture()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
