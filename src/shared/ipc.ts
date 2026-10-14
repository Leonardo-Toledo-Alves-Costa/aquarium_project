// Contrato entre o processo principal (Electron) e a interface.

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string
}

export interface AudioOptions {
  /** app: só o programa da janela; all: todos menos os bloqueados; none: sem áudio. */
  mode: 'app' | 'all' | 'none'
  sourceId: string
  /** Nomes de .exe que nunca entram. */
  blocked: string[]
}

export interface AquariumApi {
  listSources(): Promise<CaptureSource[]>
  selectSource(id: string): Promise<void>
  /**
   * Começa a captura de áudio por programa. Os dados (PCM 16 bits, 48 kHz, estéreo) chegam
   * por um MessagePort entregue à página com window.postMessage({ type: 'aquarium-audio-port' }).
   */
  startAudio(options: AudioOptions): Promise<void>
  /** Troca o modo sem trocar o canal (a trilha de áudio da transmissão continua a mesma). */
  updateAudio(options: AudioOptions): Promise<void>
  stopAudio(): Promise<void>
  /** Código do grupo, guardado cifrado pelo sistema (DPAPI no Windows). */
  loadGroupCode(): Promise<string | null>
  saveGroupCode(code: string | null): Promise<void>
  platform: string
}

export const IPC = {
  listSources: 'capture:list-sources',
  selectSource: 'capture:select-source',
  loadGroupCode: 'group:load-code',
  saveGroupCode: 'group:save-code',
  startAudio: 'audio:start',
  updateAudio: 'audio:update',
  stopAudio: 'audio:stop',
  audioPort: 'audio:port'
} as const
