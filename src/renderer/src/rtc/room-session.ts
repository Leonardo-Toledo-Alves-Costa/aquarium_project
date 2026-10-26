// Sessão de uma sala: uma conexão WebRTC com cada outra pessoa da sala (mesh).
// Qualquer um pode transmitir; o vídeo só vai para quem pediu para assistir.
// A negociação segue o padrão "perfect negotiation" do WebRTC, então os dois lados
// podem mudar o que enviam a qualquer momento sem combinar quem começa.

import type { RoomClient } from '../signaling/rooms'
import { BitrateGovernor, type BandwidthMode } from './governor'
import { createPeerConnection, peerStatus, preferVideoCodecs, type PeerStatus } from './peer'
import { CODECS, PRIORITIES, type StreamSettings } from './presets'
import { withBitrateHints, withMusicAudio } from './sdp'
import { StatsSampler } from './stats'

export interface SessionSettings extends StreamSettings {
  bandwidth: BandwidthMode
}

type Signal = (
  | { k: 'desc'; desc: RTCSessionDescriptionInit }
  | { k: 'ice'; candidate: RTCIceCandidateInit | null }
  | { k: 'watch'; on: boolean }
  | { k: 'hello' }
) & {
  /** Conexão de quem envia (versões até a 0.4.0 não mandam). */
  lid?: string
  /** Conexão de quem recebe, como quem envia a conhece. */
  to?: string
}

/** Depois que alguém para de transmitir, por quanto tempo volto a assistir sozinho se a pessoa voltar. */
const REWATCH_GRACE_MS = 20_000

export class PeerLink {
  /** Identifica esta conexão; se a outra pessoa a recriar (queda do servidor), o número dela muda. */
  readonly id = crypto.randomUUID().slice(0, 8)
  /** Conexão do outro lado a que esta está ligada. */
  remoteId?: string
  readonly pc = createPeerConnection()
  readonly outStats = new StatsSampler(this.pc, 'enviando')
  readonly inStats = new StatsSampler(this.pc, 'recebendo')
  readonly governor: BitrateGovernor
  /** Eu pedi para assistir esta pessoa. */
  iWatch = false
  /** Esta pessoa pediu para me assistir. */
  theyWatch = false
  remote: MediaStream | null = null
  senders: RTCRtpSender[] = []
  status: PeerStatus = 'aguardando'
  makingOffer = false
  ignoreOffer = false

  constructor(
    readonly peerId: string,
    readonly polite: boolean,
    settings: () => SessionSettings
  ) {
    this.governor = new BitrateGovernor(
      () => settings().preset.maxBitrate,
      () => settings().bandwidth
    )
  }
}

export class RoomSession {
  readonly links = new Map<string, PeerLink>()
  local: { stream: MediaStream; label: string; stop?: () => void } | null = null
  /**
   * Quem eu quero assistir, mesmo que a conexão caia e volte. O valor é até quando continuo
   * querendo depois que a pessoa parou de transmitir (Infinity enquanto ela transmite).
   */
  private wanted = new Map<string, number>()
  private wantedRoom: string | null = null
  private connections = 0
  private listeners = new Set<() => void>()
  private unsubscribe: (() => void)[] = []
  private governorTimer: ReturnType<typeof setInterval>

  constructor(
    private readonly client: RoomClient,
    private settings: SessionSettings
  ) {
    this.unsubscribe.push(client.subscribe(() => this.sync()))
    this.unsubscribe.push(client.onSignal((from, payload) => this.onSignal(from, payload as Signal)))
    this.governorTimer = setInterval(() => this.governBitrate(), 2000)
    this.sync()
  }

  get roomId(): string | null {
    return this.client.me?.roomId ?? null
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  // ---------- transmitir ----------

  /** `stop` libera o que a captura usa além das trilhas (por exemplo, o módulo de áudio). */
  async startStreaming(stream: MediaStream, label: string, stop?: () => void): Promise<void> {
    this.stopStreaming(false)
    this.local = { stream, label, stop }
    this.applyTrackSettings()
    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopStreaming())
    for (const link of this.links.values()) if (link.theyWatch) this.attach(link)
    this.client.setStreaming(true, label)
    this.emit()
  }

  stopStreaming(announce = true): void {
    if (!this.local) return
    for (const link of this.links.values()) this.detach(link)
    for (const track of this.local.stream.getTracks()) track.stop()
    this.local.stop?.()
    this.local = null
    if (announce) this.client.setStreaming(false)
    this.emit()
  }

  async updateSettings(settings: SessionSettings): Promise<void> {
    this.settings = settings
    this.applyTrackSettings()
    await Promise.all([...this.links.values()].map((link) => this.applySenderParameters(link)))
    this.emit()
  }

  get currentSettings(): SessionSettings {
    return this.settings
  }

  // ---------- assistir ----------

  watch(peerId: string, on: boolean): void {
    if (on) this.wanted.set(peerId, Infinity)
    else this.wanted.delete(peerId)
    const link = this.links.get(peerId)
    if (!link || link.iWatch === on) return
    link.iWatch = on
    if (!on) link.remote = null
    this.signal(peerId, { k: 'watch', on })
    this.emit()
  }

  close(): void {
    this.stopStreaming()
    clearInterval(this.governorTimer)
    for (const off of this.unsubscribe) off()
    for (const link of this.links.values()) link.pc.close()
    this.links.clear()
  }

  // ---------- quem está na sala ----------

  private sync(): void {
    const me = this.client.me
    const roomId = me?.roomId ?? null
    const others = new Map(
      this.client.state.members
        .filter((m) => roomId !== null && m.roomId === roomId && m.peerId !== this.client.peerId)
        .map((m) => [m.peerId, m])
    )

    if (roomId !== this.wantedRoom) {
      this.wanted.clear()
      this.wantedRoom = roomId
    }
    // Reconectei ao servidor: quem está na 0.4.0 refaz a conexão comigo sem avisar (não manda o
    // número da conexão), então refaço a minha também. Com quem está na versão nova, a conexão continua.
    if (this.client.connections !== this.connections) {
      if (this.connections > 0) {
        for (const [peerId, link] of this.links) {
          if (link.remoteId) continue
          link.pc.close()
          this.links.delete(peerId)
        }
      }
      this.connections = this.client.connections
    }

    for (const [peerId, link] of this.links) {
      if (!others.has(peerId)) {
        link.pc.close()
        this.links.delete(peerId)
      }
    }
    for (const [peerId, member] of others) {
      const link = this.links.get(peerId) ?? this.createLink(peerId)
      if (!member.streaming && link.iWatch) {
        link.iWatch = false
        link.remote = null
      }
      this.rewatch(link, member.streaming)
    }
    // Quem sumiu da sala (queda de conexão) também conta o prazo para eu desistir de assistir.
    for (const peerId of this.wanted.keys()) if (!others.has(peerId)) this.rewatch(undefined, false, peerId)
    if (roomId === null && this.local) this.stopStreaming(false)
    this.emit()
  }

  /**
   * Volta a assistir quem eu assistia, se a pessoa (re)começou a transmitir dentro do prazo.
   * Cobre a conexão recriada depois de uma queda e quem para e volta logo a transmitir.
   */
  private rewatch(link: PeerLink | undefined, streaming: boolean, peerId = link?.peerId): void {
    if (!peerId) return
    const until = this.wanted.get(peerId)
    if (until === undefined) return
    if (!streaming) {
      if (until === Infinity) this.wanted.set(peerId, Date.now() + REWATCH_GRACE_MS)
      else if (Date.now() > until) this.wanted.delete(peerId)
      return
    }
    this.wanted.set(peerId, Infinity)
    if (link && !link.iWatch) {
      link.iWatch = true
      this.signal(peerId, { k: 'watch', on: true })
    }
  }

  /** `remoteId`: a conexão do outro lado, quando já se sabe qual é. */
  private createLink(peerId: string, remoteId?: string): PeerLink {
    const link = new PeerLink(peerId, this.client.peerId > peerId, () => this.settings)
    link.remoteId = remoteId
    const { pc } = link
    this.links.set(peerId, link)

    pc.addEventListener('negotiationneeded', async () => {
      try {
        link.makingOffer = true
        await pc.setLocalDescription()
        this.signal(peerId, { k: 'desc', desc: pc.localDescription!.toJSON() })
      } catch (err) {
        console.warn('Falha ao negociar com', peerId, err)
      } finally {
        link.makingOffer = false
      }
    })
    pc.addEventListener('icecandidate', (event) => {
      this.signal(peerId, { k: 'ice', candidate: event.candidate?.toJSON() ?? null })
    })
    pc.addEventListener('connectionstatechange', () => {
      link.status = peerStatus(pc)
      if (link.status === 'conectado') this.applySenderParameters(link)
      this.emit()
    })
    pc.addEventListener('track', (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      link.remote = link.iWatch ? stream : null
      stream.addEventListener('removetrack', () => {
        if (stream.getTracks().length === 0 && link.remote === stream) link.remote = null
        this.emit()
      })
      this.emit()
    })
    // Apresenta esta conexão: se o outro lado tinha uma conexão antiga comigo, ele a troca por uma nova.
    this.signal(peerId, { k: 'hello' })
    return link
  }

  /** A outra pessoa recriou a conexão comigo: troco a minha por uma nova, ligada à dela. */
  private replaceLink(old: PeerLink, remoteId: string): PeerLink {
    old.pc.close()
    this.links.delete(old.peerId)
    const link = this.createLink(old.peerId, remoteId)
    const member = this.client.state.members.find((m) => m.peerId === old.peerId)
    this.rewatch(link, !!member?.streaming)
    this.emit()
    return link
  }

  // ---------- sinais ----------

  private signal(to: string, payload: Signal): void {
    const link = this.links.get(to)
    this.client.sendSignal(to, { ...payload, lid: link?.id, to: link?.remoteId })
  }

  private async onSignal(from: string, signal: Signal): Promise<void> {
    let link = this.links.get(from)
    if (!link) {
      const member = this.client.state.members.find((m) => m.peerId === from)
      if (!member || member.roomId !== this.roomId) return
      link = this.createLink(from, signal.lid)
    }
    if (signal.lid) {
      if (signal.to && signal.to !== link.id) return // era para uma conexão minha que já fechei
      if (!signal.to && link.remoteId && link.remoteId !== signal.lid) link = this.replaceLink(link, signal.lid)
      link.remoteId = signal.lid
    }
    const { pc } = link

    try {
      if (signal.k === 'watch') {
        link.theyWatch = signal.on
        if (signal.on && this.local) this.attach(link)
        if (!signal.on) this.detach(link)
        this.emit()
      } else if (signal.k === 'desc') {
        const offerCollision = signal.desc.type === 'offer' && (link.makingOffer || pc.signalingState !== 'stable')
        link.ignoreOffer = !link.polite && offerCollision
        if (link.ignoreOffer) return
        await pc.setRemoteDescription(this.withHints(signal.desc))
        if (signal.desc.type === 'offer') {
          await pc.setLocalDescription()
          this.signal(from, { k: 'desc', desc: pc.localDescription!.toJSON() })
        }
        await this.applySenderParameters(link)
      } else if (signal.k === 'ice') {
        try {
          await pc.addIceCandidate(signal.candidate ?? undefined)
        } catch (err) {
          if (!link.ignoreOffer) throw err
        }
      }
    } catch (err) {
      console.warn('Sinal com problema de', from, err)
    }
  }

  /** As dicas de banda no SDP recebido valem para o que nós enviamos a essa pessoa. */
  private withHints(desc: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
    if (!desc.sdp) return desc
    const { preset } = this.settings
    return {
      type: desc.type,
      sdp: withMusicAudio(
        withBitrateHints(desc.sdp, {
          startKbps: preset.startKbps,
          minKbps: preset.minKbps,
          maxKbps: preset.maxBitrate / 1000
        })
      )
    }
  }

  // ---------- envio ----------

  private attach(link: PeerLink): void {
    if (!this.local || link.senders.length > 0) return
    const { stream } = this.local
    for (const track of stream.getTracks()) {
      const sender = link.pc.addTrack(track, stream)
      link.senders.push(sender)
      if (track.kind === 'video') {
        const transceiver = link.pc.getTransceivers().find((t) => t.sender === sender)
        if (transceiver) preferVideoCodecs(transceiver, CODECS[this.settings.codec].mime)
      }
    }
  }

  private detach(link: PeerLink): void {
    if (link.pc.connectionState === 'closed') return
    for (const sender of link.senders) link.pc.removeTrack(sender)
    link.senders = []
  }

  private applyTrackSettings(): void {
    const track = this.local?.stream.getVideoTracks()[0]
    if (!track) return
    const { preset } = this.settings
    track.contentHint = preset.contentHint
    track
      .applyConstraints({
        frameRate: { max: preset.fps },
        ...(preset.maxHeight ? { height: { max: preset.maxHeight } } : {})
      })
      .catch((err) => console.warn('Não foi possível ajustar a captura', err))
  }

  private async applySenderParameters(link: PeerLink): Promise<void> {
    const { preset, priority } = this.settings
    for (const sender of link.senders) {
      if (sender.track?.kind !== 'video') continue
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string }
      if (!params.encodings?.length) continue
      params.encodings[0].maxBitrate = Math.round(Math.min(link.governor.cap, link.governor.limit()))
      params.encodings[0].maxFramerate = preset.fps
      params.encodings[0].scaleResolutionDownBy = 1
      params.degradationPreference = PRIORITIES[priority].degradation
      try {
        await sender.setParameters(params)
      } catch (err) {
        console.warn('Não foi possível ajustar o envio', err)
      }
    }
  }

  private async governBitrate(): Promise<void> {
    for (const link of this.links.values()) {
      if (link.senders.length === 0 || link.status !== 'conectado') continue
      const network = await link.outStats.network()
      if (link.governor.update(network)) await this.applySenderParameters(link)
    }
  }
}
