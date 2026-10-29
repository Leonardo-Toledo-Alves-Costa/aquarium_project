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

export const LOG_LEVELS = ['info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** Atualização baixada e com a assinatura conferida, esperando o app reiniciar. */
export type UpdateState = { ready: false } | { ready: true; version: string }

export interface AquariumApi {
  listSources(): Promise<CaptureSource[]>
  selectSource(id: string): Promise<void>
  /**
   * Começa a captura de áudio por programa. Os dados (PCM 16 bits, 48 kHz, estéreo) chegam
   * por um MessagePort entregue à página com window.postMessage({ type: 'aquarium-audio-port' }).
   * Devolve o número desta captura: só ele atualiza ou para a captura, para que parar a antiga
   * ao trocar de janela não derrube a nova.
   */
  startAudio(options: AudioOptions): Promise<number>
  /** Troca o modo sem trocar o canal (a trilha de áudio da transmissão continua a mesma). */
  updateAudio(id: number, options: AudioOptions): Promise<void>
  stopAudio(id: number): Promise<void>
  /** Código do grupo, guardado cifrado pelo sistema (DPAPI no Windows). */
  loadGroupCode(): Promise<string | null>
  saveGroupCode(code: string | null): Promise<void>
  getUpdateState(): Promise<UpdateState>
  /** Avisa quando o estado da atualização muda; devolve a função que para de avisar. */
  onUpdateState(listener: (state: UpdateState) => void): () => void
  /** Reinicia para instalar (pede confirmação se houver transmissão em andamento). */
  installUpdate(): Promise<void>
  checkForUpdates(): Promise<void>
  /** Transmitindo ou assistindo: o download da atualização espera, e reiniciar pede confirmação. */
  setBusy(busy: boolean): Promise<void>
  /** Grava uma linha no arquivo de log (sem resposta). `details` precisa ser um objeto simples. */
  log(level: LogLevel, scope: string, message: string, details?: unknown): void
  /** Abre no Explorer a pasta com os arquivos de log, para mandar a quem cuida do app. */
  openLogsFolder(): Promise<void>
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
  audioPort: 'audio:port',
  getUpdateState: 'updater:get-state',
  updateState: 'updater:state',
  installUpdate: 'updater:install',
  checkForUpdates: 'updater:check',
  setBusy: 'updater:busy',
  log: 'log:write',
  openLogsFolder: 'log:open-folder'
} as const
