// Peças comuns a quem transmite e a quem assiste.

import { errorInfo, logger } from '../log'

const log = logger('rtc')

// Servidores STUN públicos: só informam o endereço público de cada PC, nunca veem o vídeo.
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
]

// H.264 primeiro porque é o codec com codificação por GPU mais comum no Windows.
const DEFAULT_CODEC_ORDER = ['video/H264', 'video/VP9', 'video/VP8']

export type PeerStatus = 'aguardando' | 'conectando' | 'conectado' | 'instavel' | 'falhou' | 'encerrado'

export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' })
}

export function peerStatus(pc: RTCPeerConnection): PeerStatus {
  switch (pc.connectionState) {
    case 'new':
      return 'aguardando'
    case 'connected':
      return 'conectado'
    case 'disconnected':
      return 'instavel'
    case 'failed':
      return 'falhou'
    case 'closed':
      return 'encerrado'
    default:
      return 'conectando'
  }
}

/**
 * Sem servidor de sinalização não dá para mandar endereços aos poucos,
 * então esperamos a coleta e colocamos tudo em um código só. A coleta às vezes
 * demora a "terminar" por causa de interfaces de rede sem saída; por isso
 * encerramos pouco depois do primeiro endereço público (srflx) chegar.
 */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 5000, afterPublicMs = 1000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    let early: ReturnType<typeof setTimeout> | undefined
    const done = (): void => {
      clearTimeout(timer)
      clearTimeout(early)
      pc.removeEventListener('icegatheringstatechange', onChange)
      pc.removeEventListener('icecandidate', onCandidate)
      resolve()
    }
    const onChange = (): void => {
      if (pc.iceGatheringState === 'complete') done()
    }
    const onCandidate = (event: RTCPeerConnectionIceEvent): void => {
      if (event.candidate?.type === 'srflx' && !early) early = setTimeout(done, afterPublicMs)
    }
    const timer = setTimeout(done, timeoutMs)
    pc.addEventListener('icegatheringstatechange', onChange)
    pc.addEventListener('icecandidate', onCandidate)
  })
}

/** Ordena os codecs oferecidos; o escolhido vai na frente e os outros ficam de reserva. */
export function preferVideoCodecs(transceiver: RTCRtpTransceiver, preferredMime?: string): void {
  const capabilities = RTCRtpReceiver.getCapabilities('video')
  if (!capabilities) return
  const order = preferredMime
    ? [preferredMime, ...DEFAULT_CODEC_ORDER.filter((m) => m !== preferredMime)]
    : DEFAULT_CODEC_ORDER
  const rank = (mime: string): number => {
    const i = order.indexOf(mime)
    return i === -1 ? order.length : i
  }
  const sorted = [...capabilities.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType))
  try {
    transceiver.setCodecPreferences(sorted)
  } catch (err) {
    log.warn('não foi possível definir a preferência de codec', { error: errorInfo(err) })
  }
}
