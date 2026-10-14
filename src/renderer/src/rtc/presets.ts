export type PresetId = 'jogo' | 'video' | 'codigo'

/** O que sacrificar quando a banda ou a placa de vídeo não dão conta. */
export type Priority = 'nitidez' | 'equilibrio' | 'fluidez'

export type CodecChoice = 'auto' | 'H264' | 'VP9' | 'AV1'

export interface Preset {
  id: PresetId
  label: string
  description: string
  fps: number
  /** Altura máxima da captura; sem valor, usa a resolução nativa da tela. */
  maxHeight?: number
  /** Teto de banda por espectador, em bits por segundo. */
  maxBitrate: number
  /** Banda com que a conexão começa, em kbps (o WebRTC começa em ~300 kbps se não for dito). */
  startKbps: number
  /** Piso de banda, em kbps, para a imagem não desmanchar em quedas curtas. */
  minKbps: number
  contentHint: 'motion' | 'detail' | 'text'
  defaultPriority: Priority
}

export const PRESETS: Record<PresetId, Preset> = {
  jogo: {
    id: 'jogo',
    label: 'Jogo',
    description: '1080p · 60 fps · até 16 Mbps',
    fps: 60,
    maxHeight: 1080,
    maxBitrate: 16_000_000,
    startKbps: 6000,
    minKbps: 1500,
    contentHint: 'motion',
    defaultPriority: 'nitidez'
  },
  video: {
    id: 'video',
    label: 'Vídeo',
    description: '1080p · 30 fps · até 8 Mbps',
    fps: 30,
    maxHeight: 1080,
    maxBitrate: 8_000_000,
    startKbps: 4000,
    minKbps: 1000,
    contentHint: 'motion',
    defaultPriority: 'nitidez'
  },
  codigo: {
    id: 'codigo',
    label: 'Código e texto',
    description: 'resolução nativa · 15 fps · até 4 Mbps',
    fps: 15,
    maxBitrate: 4_000_000,
    startKbps: 2500,
    minKbps: 800,
    contentHint: 'text',
    defaultPriority: 'nitidez'
  }
}

export const PRIORITIES: Record<Priority, { label: string; description: string; degradation: RTCDegradationPreference }> = {
  nitidez: {
    label: 'Nitidez',
    description: 'mantém a resolução; perde fps se faltar banda',
    degradation: 'maintain-resolution'
  },
  equilibrio: {
    label: 'Equilíbrio',
    description: 'reduz um pouco de cada',
    degradation: 'balanced'
  },
  fluidez: {
    label: 'Fluidez',
    description: 'mantém os fps; reduz a resolução se faltar banda',
    degradation: 'maintain-framerate'
  }
}

export const CODECS: Record<CodecChoice, { label: string; mime?: string }> = {
  auto: { label: 'Automático (H.264, depois VP9)' },
  H264: { label: 'H.264', mime: 'video/H264' },
  VP9: { label: 'VP9', mime: 'video/VP9' },
  AV1: { label: 'AV1 (experimental, pesado sem placa nova)', mime: 'video/AV1' }
}

export interface StreamSettings {
  preset: Preset
  priority: Priority
  codec: CodecChoice
}
