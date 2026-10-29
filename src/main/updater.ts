// Atualização automática pelo GitHub Releases, com assinatura nossa.
//
// O electron-updater baixa o instalador e confere o sha512 do latest.yml. Como o latest.yml vem
// do mesmo lugar que o instalador, isso não protege contra uma conta do GitHub invadida. Por isso
// cada release traz no latest.yml o campo aquariumSignature (Ed25519, feito por
// scripts/release.mjs com uma chave que só existe no PC de quem publica), e o app só instala
// depois de conferir essa assinatura contra o arquivo baixado.

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { autoUpdater, type BaseUpdater, type UpdateDownloadedEvent } from 'electron-updater'
import { createHash, verify } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { IPC, type UpdateState } from '../shared/ipc'
import { stopAudioCapture } from './audio'
import { logger } from './log'
import { UPDATE_PUBLIC_KEY } from './update-key'

const log = logger('updater')

const FIRST_CHECK_DELAY = 5_000
const CHECK_INTERVAL = 4 * 60 * 60_000

let state: UpdateState = { ready: false }
/** Transmitindo ou assistindo (avisado pela interface). */
let busy = false
/** Uma verificação ou download ficou para quando a pessoa parar de transmitir ou assistir. */
let deferred = false
let downloading = false
let restarting = false
/** Versão recusada nesta sessão: não baixa de novo a cada verificação. */
let rejectedVersion: string | null = null

function setState(next: UpdateState): void {
  state = next
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.updateState, state)
}

function sha512Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('base64')))
  })
}

async function isSigned(event: UpdateDownloadedEvent): Promise<boolean> {
  const signature = (event as { aquariumSignature?: unknown }).aquariumSignature
  if (typeof signature !== 'string') return false
  try {
    // O hash vem do arquivo em disco, não do latest.yml.
    const message = Buffer.from(`aquarium-update-v1:${event.version}:${await sha512Of(event.downloadedFile)}`)
    return verify(null, message, UPDATE_PUBLIC_KEY, Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

function check(): void {
  if (restarting || state.ready || downloading) return
  if (busy) {
    deferred = true
    return
  }
  autoUpdater.checkForUpdates().catch((err: Error) => log.warn('falha ao procurar atualização', { message: err.message }))
}

function download(): void {
  if (busy) {
    deferred = true
    return
  }
  downloading = true
  autoUpdater.downloadUpdate().catch((err: Error) => {
    downloading = false
    log.warn('falha ao baixar atualização', { message: err.message })
  })
}

async function restartAndInstall(): Promise<void> {
  if (!state.ready || restarting) return
  if (busy) {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options = {
      type: 'question' as const,
      buttons: ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      title: 'Atualizar o Aquarium',
      message: `Atualizar para a versão ${state.version} agora?`,
      detail: 'Isso encerra o que você está transmitindo ou assistindo. O Aquarium reabre sozinho em alguns segundos.'
    }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response !== 0) return
  }
  restarting = true
  log.info('reiniciando para instalar', { version: state.version })
  await stopAudioCapture()
  // Silencioso e reabrindo o app no fim.
  autoUpdater.quitAndInstall(true, true)
}

export function registerUpdater(): void {
  ipcMain.handle(IPC.getUpdateState, () => state)
  ipcMain.handle(IPC.installUpdate, () => restartAndInstall())
  ipcMain.handle(IPC.checkForUpdates, () => {
    if (app.isPackaged) check()
  })
  ipcMain.handle(IPC.setBusy, (_event, value: unknown) => {
    busy = value === true
    if (!busy && deferred) {
      deferred = false
      // Se já havia uma versão encontrada, checkForUpdates encontra de novo e o download segue.
      check()
    }
  })

  // Em desenvolvimento não há app-update.yml nem instalador para trocar.
  if (!app.isPackaged) return

  // O download e a instalação ao fechar são controlados aqui, depois da assinatura conferida.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.disableWebInstaller = true

  autoUpdater.on('update-available', (info) => {
    log.info('atualização disponível', { version: info.version })
    if (info.version !== rejectedVersion) download()
  })
  autoUpdater.on('update-downloaded', async (event) => {
    downloading = false
    if (!(await isSigned(event))) {
      log.warn('assinatura inválida ou ausente', { version: event.version })
      rejectedVersion = event.version
      await rm(event.downloadedFile, { force: true })
      return
    }
    if (state.ready) return
    log.info('atualização baixada e conferida', { version: event.version })
    setState({ ready: true, version: event.version })
    // Quem clicou em "Depois" recebe a versão nova ao fechar o app.
    app.once('quit', (_event, exitCode) => {
      // No Windows o autoUpdater é um NsisUpdater, que sabe instalar sem reiniciar o app.
      if (!restarting && exitCode === 0) (autoUpdater as BaseUpdater).install(true, false)
    })
  })
  autoUpdater.on('error', (err) => {
    downloading = false
    log.warn('erro no atualizador', { message: err.message })
  })

  setTimeout(check, FIRST_CHECK_DELAY)
  setInterval(check, CHECK_INTERVAL)
}
