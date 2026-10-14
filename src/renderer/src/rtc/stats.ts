// Leitura das estatísticas do WebRTC: o que a prova de conceito precisa medir.

type Stat = Record<string, any>

export interface RouteInfo {
  /** false quando o vídeo passa por um relay (TURN). */
  direct: boolean
  /** host = mesma rede ou IPv6 direto; srflx/prflx = atravessou o NAT; relay = intermediário. */
  localType: string
  remoteType: string
  ipVersion: 'IPv4' | 'IPv6' | '?'
  protocol: string
  rttMs?: number
}

export interface StatsSample {
  route?: RouteInfo
  fps?: number
  width?: number
  height?: number
  kbps?: number
  codec?: string
  /** Implementação do codificador/decodificador, quando o navegador informa. */
  implementation?: string
  hardware?: boolean
  /** Só para quem transmite: o que está segurando a qualidade (cpu, bandwidth, none). */
  limitation?: string
  packetsLost?: number
  jitterMs?: number
}

function ipVersionOf(...addresses: (string | undefined)[]): RouteInfo['ipVersion'] {
  for (const address of addresses) {
    if (!address || address.endsWith('.local')) continue
    return address.includes(':') ? 'IPv6' : 'IPv4'
  }
  return '?'
}

export class StatsSampler {
  private prevBytes?: number
  private prevTimestamp?: number

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly direction: 'enviando' | 'recebendo'
  ) {}

  async sample(): Promise<StatsSample> {
    const report = await this.pc.getStats()
    const byId = new Map<string, Stat>()
    report.forEach((s: Stat) => byId.set(s.id, s))

    let pair: Stat | undefined
    let rtp: Stat | undefined
    const rtpType = this.direction === 'enviando' ? 'outbound-rtp' : 'inbound-rtp'
    for (const s of byId.values()) {
      if (s.type === 'transport' && s.selectedCandidatePairId) pair = byId.get(s.selectedCandidatePairId)
      if (s.type === rtpType && s.kind === 'video') rtp = s
    }
    if (!pair) {
      for (const s of byId.values()) {
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) pair = s
      }
    }

    const sample: StatsSample = {}

    if (pair) {
      const local = byId.get(pair.localCandidateId)
      const remote = byId.get(pair.remoteCandidateId)
      if (local && remote) {
        sample.route = {
          direct: local.candidateType !== 'relay' && remote.candidateType !== 'relay',
          localType: local.candidateType,
          remoteType: remote.candidateType,
          ipVersion: ipVersionOf(remote.address, local.address),
          protocol: local.protocol,
          rttMs: typeof pair.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : undefined
        }
      }
    }

    if (rtp) {
      sample.fps = rtp.framesPerSecond
      sample.width = rtp.frameWidth
      sample.height = rtp.frameHeight
      sample.codec = byId.get(rtp.codecId)?.mimeType?.replace('video/', '')

      const bytes: number | undefined = this.direction === 'enviando' ? rtp.bytesSent : rtp.bytesReceived
      if (typeof bytes === 'number') {
        if (this.prevBytes !== undefined && this.prevTimestamp !== undefined && rtp.timestamp > this.prevTimestamp) {
          sample.kbps = Math.round(((bytes - this.prevBytes) * 8) / (rtp.timestamp - this.prevTimestamp))
        }
        this.prevBytes = bytes
        this.prevTimestamp = rtp.timestamp
      }

      if (this.direction === 'enviando') {
        sample.implementation = rtp.encoderImplementation
        sample.hardware = rtp.powerEfficientEncoder
        sample.limitation = rtp.qualityLimitationReason
      } else {
        sample.implementation = rtp.decoderImplementation
        sample.hardware = rtp.powerEfficientDecoder
        sample.packetsLost = rtp.packetsLost
        if (typeof rtp.jitter === 'number') sample.jitterMs = Math.round(rtp.jitter * 1000)
      }
    }

    return sample
  }
}
