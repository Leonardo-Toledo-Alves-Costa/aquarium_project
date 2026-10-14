import { createPeerConnection, peerStatus, preferVideoCodecs, waitForIceGathering, type PeerStatus } from './peer'
import { CODECS, PRIORITIES, type CodecChoice, type StreamSettings } from './presets'
import { withBitrateHints } from './sdp'
import { StatsSampler } from './stats'

export interface ViewerSlot {
  id: number
  label: string
  pc: RTCPeerConnection
  /** Convite (oferta SDP) a ser entregue a quem vai assistir. */
  offer: RTCSessionDescriptionInit
  answered: boolean
  status: PeerStatus
  stats: StatsSampler
  /** Codec escolhido quando o espectador foi adicionado; trocar exige um convite novo. */
  codec: CodecChoice
}

export interface CaptureInfo {
  width?: number
  height?: number
  fps?: number
}

/**
 * Lado de quem transmite. Mesh: uma conexão (e uma codificação) por espectador.
 * Não sabe como o convite e a resposta viajam; isso é papel da sinalização.
 */
export class Broadcaster {
  private slots: ViewerSlot[] = []
  private listeners = new Set<() => void>()
  private nextId = 1
  stopped = false

  private constructor(
    readonly stream: MediaStream,
    private current: StreamSettings
  ) {
    this.videoTrack.addEventListener('ended', () => this.stop())
  }

  /** A fonte (tela ou janela) já deve ter sido escolhida no processo principal. */
  static async start(settings: StreamSettings): Promise<Broadcaster> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: settings.preset.fps },
      audio: true
    })
    const broadcaster = new Broadcaster(stream, settings)
    await broadcaster.applyTrackSettings()
    return broadcaster
  }

  get settings(): StreamSettings {
    return this.current
  }

  get viewers(): readonly ViewerSlot[] {
    return this.slots
  }

  get hasAudio(): boolean {
    return this.stream.getAudioTracks().length > 0
  }

  get capture(): CaptureInfo {
    const s = this.videoTrack.getSettings()
    return { width: s.width, height: s.height, fps: s.frameRate }
  }

  private get videoTrack(): MediaStreamTrack {
    return this.stream.getVideoTracks()[0]
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  async addViewer(): Promise<ViewerSlot> {
    const { preset, codec } = this.current
    const pc = createPeerConnection()
    const video = pc.addTransceiver(this.videoTrack, {
      direction: 'sendonly',
      streams: [this.stream],
      sendEncodings: [{ maxBitrate: preset.maxBitrate, maxFramerate: preset.fps, scaleResolutionDownBy: 1 }]
    })
    preferVideoCodecs(video, CODECS[codec].mime)
    for (const audio of this.stream.getAudioTracks()) {
      pc.addTransceiver(audio, { direction: 'sendonly', streams: [this.stream] })
    }

    await pc.setLocalDescription(await pc.createOffer())
    await waitForIceGathering(pc)

    const id = this.nextId++
    const slot: ViewerSlot = {
      id,
      label: `Espectador ${id}`,
      pc,
      offer: pc.localDescription!.toJSON(),
      answered: false,
      status: 'aguardando',
      stats: new StatsSampler(pc, 'enviando'),
      codec
    }
    pc.addEventListener('connectionstatechange', () => {
      slot.status = peerStatus(pc)
      this.emit()
    })
    this.slots = [...this.slots, slot]
    this.emit()
    return slot
  }

  async acceptAnswer(id: number, answer: RTCSessionDescriptionInit): Promise<void> {
    const slot = this.slots.find((s) => s.id === id)
    if (!slot) throw new Error('Esse espectador não existe mais')
    if (answer.type !== 'answer' || !answer.sdp) throw new Error('O código colado não é uma resposta')
    const { preset } = this.current
    const sdp = withBitrateHints(answer.sdp, {
      startKbps: preset.startKbps,
      minKbps: preset.minKbps,
      maxKbps: preset.maxBitrate / 1000
    })
    await slot.pc.setRemoteDescription({ type: 'answer', sdp })
    slot.answered = true
    slot.status = peerStatus(slot.pc)
    await this.applySenderParameters(slot.pc)
    this.emit()
  }

  removeViewer(id: number): void {
    this.slots.find((s) => s.id === id)?.pc.close()
    this.slots = this.slots.filter((s) => s.id !== id)
    this.emit()
  }

  /** Qualidade e prioridade valem na hora; o codec só vale para os próximos espectadores. */
  async update(changes: Partial<StreamSettings>): Promise<void> {
    this.current = { ...this.current, ...changes }
    await this.applyTrackSettings()
    await Promise.all(this.slots.map((s) => this.applySenderParameters(s.pc)))
    this.emit()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    for (const slot of this.slots) slot.pc.close()
    for (const track of this.stream.getTracks()) track.stop()
    this.emit()
  }

  private async applyTrackSettings(): Promise<void> {
    const { preset } = this.current
    this.videoTrack.contentHint = preset.contentHint
    try {
      await this.videoTrack.applyConstraints({
        frameRate: { max: preset.fps },
        ...(preset.maxHeight ? { height: { max: preset.maxHeight } } : {})
      })
    } catch (err) {
      console.warn('Não foi possível ajustar a captura', err)
    }
  }

  private async applySenderParameters(pc: RTCPeerConnection): Promise<void> {
    const { preset, priority } = this.current
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string }
      if (!params.encodings?.length) continue
      params.encodings[0].maxBitrate = preset.maxBitrate
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
}
