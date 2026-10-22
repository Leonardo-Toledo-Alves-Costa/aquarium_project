// Roda o aquarium-audio.exe (captura de áudio por programa) e repassa o PCM à página.

import { app, ipcMain, MessageChannelMain, type MessagePortMain, type WebContents } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, type AudioOptions } from '../shared/ipc'

const FRAME_BYTES = 4 // 2 canais × 16 bits

function helperPath(): string {
  // Em desenvolvimento, este arquivo roda de out/main/; o executável fica em native/bin/.
  return app.isPackaged
    ? join(process.resourcesPath, 'aquarium-audio.exe')
    : join(__dirname, '..', '..', 'native', 'bin', 'aquarium-audio.exe')
}

function validate(options: unknown): AudioOptions {
  const o = options as AudioOptions
  if (!o || !['app', 'all', 'none'].includes(o.mode) || typeof o.sourceId !== 'string' || !Array.isArray(o.blocked)) {
    throw new Error('Opções de áudio inválidas')
  }
  const blocked = o.blocked.filter((b) => typeof b === 'string' && /^[\w .()-]{1,64}\.exe$/i.test(b))
  return { mode: o.mode, sourceId: o.sourceId, blocked }
}

class AudioCapture {
  private port: MessagePortMain | null = null
  private child: ChildProcess | null = null
  private leftover: Buffer = Buffer.alloc(0)

  start(contents: WebContents, options: AudioOptions): void {
    this.stop()
    const { port1, port2 } = new MessageChannelMain()
    this.port = port1
    port1.start()
    contents.postMessage(IPC.audioPort, null, [port2])
    this.spawn(options)
  }

  update(options: AudioOptions): void {
    if (!this.port) return
    this.kill()
    this.spawn(options)
  }

  stop(): void {
    this.kill()
    this.port?.close()
    this.port = null
  }

  /** Para e espera o processo sair: o instalador não substitui um .exe aberto. */
  stopAndWait(): Promise<void> {
    const child = this.child
    this.stop()
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private spawn(options: AudioOptions): void {
    if (options.mode === 'none' || process.platform !== 'win32') return
    const exe = helperPath()
    if (!existsSync(exe)) {
      console.warn('aquarium-audio.exe não encontrado em', exe)
      return
    }
    // Tela inteira não tem "o app": nesse caso vale "todos os apps".
    const windowMatch = /^window:(\d+):/.exec(options.sourceId)
    const mode = options.mode === 'app' && windowMatch ? 'app' : 'all'
    const args = [mode, '--parent', String(process.pid), '--block', options.blocked.join(',')]
    if (mode === 'app') args.push('--window', windowMatch![1])

    console.log('[aquarium-audio] iniciando:', args.join(' '), `(fonte ${options.sourceId})`)
    const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    this.leftover = Buffer.alloc(0)
    child.stdout!.on('data', (data: Buffer) => {
      // Só manda quadros inteiros; o resto fica para o próximo pedaço.
      const all = this.leftover.length ? Buffer.concat([this.leftover, data]) : data
      const usable = all.length - (all.length % FRAME_BYTES)
      this.leftover = all.subarray(usable)
      if (usable > 0 && this.port) this.port.postMessage(new Uint8Array(all.subarray(0, usable)))
    })
    child.stderr!.on('data', (data: Buffer) => console.log('[aquarium-audio]', data.toString().trim()))
    child.on('exit', (code) => {
      if (this.child === child) this.child = null
      if (code) console.warn('aquarium-audio saiu com código', code)
    })
  }

  private kill(): void {
    this.child?.kill()
    this.child = null
  }
}

const capture = new AudioCapture()

export function stopAudioCapture(): Promise<void> {
  return capture.stopAndWait()
}

export function registerAudio(): void {
  ipcMain.handle(IPC.startAudio, (event, options: unknown) => capture.start(event.sender, validate(options)))
  ipcMain.handle(IPC.updateAudio, (_event, options: unknown) => capture.update(validate(options)))
  ipcMain.handle(IPC.stopAudio, () => capture.stop())
  app.on('before-quit', () => capture.stop())
}
