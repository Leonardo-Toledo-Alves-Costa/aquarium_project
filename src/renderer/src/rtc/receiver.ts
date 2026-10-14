import { createPeerConnection, peerStatus, waitForIceGathering, type PeerStatus } from './peer'
import { StatsSampler } from './stats'

/** Lado de quem assiste: uma única conexão com quem transmite. */
export class Receiver {
  readonly pc = createPeerConnection()
  readonly stream = new MediaStream()
  readonly stats = new StatsSampler(this.pc, 'recebendo')
  status: PeerStatus = 'aguardando'
  private listeners = new Set<() => void>()

  constructor() {
    this.pc.addEventListener('track', (event) => {
      this.stream.addTrack(event.track)
      this.emit()
    })
    this.pc.addEventListener('connectionstatechange', () => {
      this.status = peerStatus(this.pc)
      this.emit()
    })
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  /** Recebe o convite e devolve a resposta que volta para quem transmite. */
  async answer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (offer.type !== 'offer') throw new Error('O código colado não é um convite')
    await this.pc.setRemoteDescription(offer)
    await this.pc.setLocalDescription(await this.pc.createAnswer())
    await waitForIceGathering(this.pc)
    this.status = peerStatus(this.pc)
    this.emit()
    return this.pc.localDescription!.toJSON()
  }

  close(): void {
    this.pc.close()
    for (const track of this.stream.getTracks()) track.stop()
    this.status = 'encerrado'
    this.emit()
  }
}
