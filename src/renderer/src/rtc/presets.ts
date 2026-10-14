export type PresetId = 'jogo' | 'video' | 'codigo'

export interface Preset {
  id: PresetId
  label: string
  description: string
  fps: number
  /** Altura máxima da captura; sem valor, usa a resolução nativa da tela. */
  maxHeight?: number
  /** Bits por segundo, por espectador. */
  maxBitrate: number
  contentHint: 'motion' | 'detail' | 'text'
  degradation: 'maintain-framerate' | 'maintain-resolution' | 'balanced'
}

export const PRESETS: Record<PresetId, Preset> = {
  jogo: {
    id: 'jogo',
    label: 'Jogo',
    description: '1080p · 60 fps · até 10 Mbps',
    fps: 60,
    maxHeight: 1080,
    maxBitrate: 10_000_000,
    contentHint: 'motion',
    degradation: 'maintain-framerate'
  },
  video: {
    id: 'video',
    label: 'Vídeo',
    description: '1080p · 30 fps · até 5 Mbps',
    fps: 30,
    maxHeight: 1080,
    maxBitrate: 5_000_000,
    contentHint: 'motion',
    degradation: 'balanced'
  },
  codigo: {
    id: 'codigo',
    label: 'Código e texto',
    description: 'resolução nativa · 15 fps · até 2,5 Mbps',
    fps: 15,
    maxBitrate: 2_500_000,
    contentHint: 'text',
    degradation: 'maintain-resolution'
  }
}
