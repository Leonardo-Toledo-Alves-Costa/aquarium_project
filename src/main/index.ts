import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, powerMonitor, safeStorage, session } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC, type CaptureSource } from '../shared/ipc'
import { registerAudio } from './audio'
import { logger, registerLog, startLog } from './log'
import { registerUpdater } from './updater'

startLog()
const log = logger('main')

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
    title: 'Aquarium',
    backgroundColor: '#131417',
    autoHideMenuBar: true,
    // Sem a barra de título do Windows: os botões dela ficam por cima da barra de transmissões,
    // com as cores do app. A barra tem 52px (styles.css); 51 deixa aparecer a linha de baixo dela.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#131417', symbolColor: '#cfd2d7', height: 51 },
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
  win.webContents.on('unresponsive', () => log.warn('a interface parou de responder'))
  win.webContents.on('responsive', () => log.info('a interface voltou a responder'))
  win.webContents.on('did-fail-load', (_event, code, description) => log.error('a interface não carregou', { code, description }))
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
      // Só vídeo. O áudio do sistema inteiro ('loopback') levaria junto o Discord e o próprio
      // Aquarium; o áudio da transmissão vem do aquarium-audio.exe, por programa.
      callback({ video: source })
    },
    { useSystemPicker: false }
  )
}

function registerGroupCode(): void {
  const file = (): string => join(app.getPath('userData'), 'group-code.bin')

  ipcMain.handle(IPC.loadGroupCode, async (): Promise<string | null> => {
    try {
      return safeStorage.decryptString(await readFile(file()))
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.saveGroupCode, async (_event, code: unknown) => {
    if (code === null) {
      await rm(file(), { force: true })
      return
    }
    if (typeof code !== 'string' || code.length > 64) throw new Error('Código do grupo inválido')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('O sistema não oferece armazenamento cifrado')
    await writeFile(file(), safeStorage.encryptString(code))
  })
}

// Uma janela só no app instalado: abrir de novo traz a que já está aberta. Duas usariam a mesma
// identidade no grupo, e o servidor derrubaria uma delas. (Em dev fica livre, para testar ao lado do instalado.)
const single = !app.isPackaged || app.requestSingleInstanceLock()
if (!single) {
  log.info('o app já está aberto; esta cópia fecha')
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

app.whenReady().then(() => {
  if (!single) return
  // Sem o menu padrão no app instalado: os atalhos dele (Ctrl+- e Ctrl+=) mudariam o tamanho da
  // interface inteira, e as teclas - e + já servem para o zoom da transmissão.
  if (app.isPackaged) Menu.setApplicationMenu(null)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))

  // Suspender e voltar derruba as conexões; ajuda a explicar quedas no log.
  powerMonitor.on('suspend', () => log.info('computador suspenso'))
  powerMonitor.on('resume', () => log.info('computador voltou da suspensão'))

  registerLog()
  registerCapture()
  registerGroupCode()
  registerAudio()
  registerUpdater()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
