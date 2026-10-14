// Peças comuns a quem transmite e a quem assiste.

// Servidores STUN públicos: só informam o endereço público de cada PC, nunca veem o vídeo.
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
]

// H.264 primeiro porque é o codec com codificação por GPU mais comum no Windows.
const VIDEO_CODEC_ORDER = ['video/H264', 'video/VP9', 'video/VP8']

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
 * então esperamos a coleta terminar e colocamos tudo em um código só.
 */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 5000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = (): void => {
      if (pc.iceGatheringState === 'complete') done()
    }
    const timer = setTimeout(done, timeoutMs)
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

export function preferVideoCodecs(transceiver: RTCRtpTransceiver): void {
  const capabilities = RTCRtpReceiver.getCapabilities('video')
  if (!capabilities) return
  const rank = (mime: string): number => {
    const i = VIDEO_CODEC_ORDER.indexOf(mime)
    return i === -1 ? VIDEO_CODEC_ORDER.length : i
  }
  const sorted = [...capabilities.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType))
  try {
    transceiver.setCodecPreferences(sorted)
  } catch (err) {
    console.warn('Não foi possível definir a preferência de codec', err)
  }
}
