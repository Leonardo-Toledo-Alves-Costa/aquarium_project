// Contrato entre o processo principal (Electron) e a interface.

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string
}

export interface AquarioApi {
  listSources(): Promise<CaptureSource[]>
  selectSource(id: string): Promise<void>
  platform: string
}

export const IPC = {
  listSources: 'capture:list-sources',
  selectSource: 'capture:select-source'
} as const
