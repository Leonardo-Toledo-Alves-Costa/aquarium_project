// Leitura das estatísticas do WebRTC: o que a prova de conceito precisa medir.

import type { NetworkSample } from './governor'

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
  /** Banda que o WebRTC estima ter disponível para enviar, em kbps. */
  availableKbps?: number
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

  // Só para quem transmite
  /** O que está segurando a qualidade agora: cpu, bandwidth, other ou none. */
  limitation?: string
  /** Segundos acumulados com a qualidade limitada, por motivo. */
  limitationSeconds?: { cpu: number; bandwidth: number; other: number }
  targetKbps?: number
  /** Resolução e fps que saem da captura, antes da codificação. */
  sourceWidth?: number
  sourceHeight?: number
  sourceFps?: number

  // Só para quem assiste
  packetsLost?: number
  lossPercent?: number
  jitterMs?: number
  framesDropped?: number
  freezeCount?: number
  freezeSeconds?: number
}

function ipVersionOf(...addresses: (string | undefined)[]): RouteInfo['ipVersion'] {
  for (const address of addresses) {
    if (!address || address.endsWith('.local')) continue
    return address.includes(':') ? 'IPv6' : 'IPv4'
  }
  return '?'
}

const round1 = (n: number): number => Math.round(n * 10) / 10

export class StatsSampler {
  private prevBytes?: number
  private prevTimestamp?: number

  constructor(
    private readonly pc: RTCPeerConnection,
    readonly direction: 'enviando' | 'recebendo'
  ) {}

  async sample(): Promise<StatsSample> {
    const report = await this.pc.getStats()
    const byId = new Map<string, Stat>()
    report.forEach((s: Stat) => byId.set(s.id, s))

    let pair: Stat | undefined
    let rtp: Stat | undefined
    let source: Stat | undefined
    const rtpType = this.direction === 'enviando' ? 'outbound-rtp' : 'inbound-rtp'
    for (const s of byId.values()) {
      if (s.type === 'transport' && s.selectedCandidatePairId) pair = byId.get(s.selectedCandidatePairId)
      if (s.type === rtpType && s.kind === 'video') rtp = s
      if (s.type === 'media-source' && s.kind === 'video') source = s
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
          rttMs: typeof pair.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : undefined,
          // Do lado de quem assiste, essa estimativa é da banda de volta (controle), não do vídeo.
          availableKbps:
            this.direction === 'enviando' && typeof pair.availableOutgoingBitrate === 'number'
              ? Math.round(pair.availableOutgoingBitrate / 1000)
              : undefined
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
        const durations = rtp.qualityLimitationDurations
        if (durations) {
          sample.limitationSeconds = {
            cpu: round1(durations.cpu ?? 0),
            bandwidth: round1(durations.bandwidth ?? 0),
            other: round1(durations.other ?? 0)
          }
        }
        if (typeof rtp.targetBitrate === 'number') sample.targetKbps = Math.round(rtp.targetBitrate / 1000)
        if (source) {
          sample.sourceWidth = source.width
          sample.sourceHeight = source.height
          sample.sourceFps = source.framesPerSecond
        }
      } else {
        sample.implementation = rtp.decoderImplementation
        sample.hardware = rtp.powerEfficientDecoder
        sample.packetsLost = rtp.packetsLost
        if (typeof rtp.packetsLost === 'number' && typeof rtp.packetsReceived === 'number') {
          const total = rtp.packetsLost + rtp.packetsReceived
          sample.lossPercent = total > 0 ? round1((rtp.packetsLost / total) * 100) : 0
        }
        if (typeof rtp.jitter === 'number') sample.jitterMs = Math.round(rtp.jitter * 1000)
        sample.framesDropped = rtp.framesDropped
        sample.freezeCount = rtp.freezeCount
        if (typeof rtp.totalFreezesDuration === 'number') sample.freezeSeconds = round1(rtp.totalFreezesDuration)
      }
    }

    return sample
  }

  /** Atraso, perda e jitter do vídeo enviado, como quem recebe informa de volta (RTCP). */
  async network(): Promise<NetworkSample> {
    const report = await this.pc.getStats()
    const sample: NetworkSample = {}
    report.forEach((s: Stat) => {
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && typeof s.currentRoundTripTime === 'number') {
        sample.rttMs = Math.round(s.currentRoundTripTime * 1000)
      }
      if (s.type === 'remote-inbound-rtp' && s.kind === 'video') {
        if (typeof s.fractionLost === 'number') sample.fractionLost = s.fractionLost
        if (typeof s.jitter === 'number') sample.jitterMs = Math.round(s.jitter * 1000)
      }
    })
    return sample
  }
}

/** true quando o vídeo enviado está menor que a captura (o WebRTC reduziu a resolução). */
export function isDownscaled(sample: StatsSample): boolean {
  return !!(sample.height && sample.sourceHeight && sample.height < sample.sourceHeight * 0.95)
}
