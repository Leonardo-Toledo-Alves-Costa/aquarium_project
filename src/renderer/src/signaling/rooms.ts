// Sinalização pelo servidor de salas: presença, salas e repasse de sinais cifrados.

import {
  CLOSE,
  PROTOCOL_VERSION,
  type ClientMessage,
  type GroupState,
  type MemberInfo,
  type ServerMessage
} from '../../../shared/rooms-protocol'
import { fromBase64Url, toBase64Url, type GroupKeys } from '../group/group-code'

export type ConnectionStatus = 'conectando' | 'conectado' | 'reconectando' | 'recusado'

export interface RoomClientOptions {
  serverUrl: string
  keys: GroupKeys
  peerId: string
  name: string
}

type SignalHandler = (from: string, payload: unknown) => void

const RETRY_DELAYS = [500, 1000, 2000, 5000, 10000]

export class RoomClient {
  state: GroupState = { rooms: [], members: [] }
  status: ConnectionStatus = 'conectando'
  /** Motivo de uma recusa (código errado, versão antiga) ou do último erro. */
  error: string | null = null

  private ws?: WebSocket
  private listeners = new Set<() => void>()
  private signalHandlers = new Set<SignalHandler>()
  private retry = 0
  private pingTimer?: ReturnType<typeof setInterval>
  private retryTimer?: ReturnType<typeof setTimeout>
  private closed = false
  private roomId: string | null = null
  private streaming: { active: boolean; label?: string } = { active: false }

  constructor(private readonly options: RoomClientOptions) {
    this.connect()
  }

  get peerId(): string {
    return this.options.peerId
  }

  get me(): MemberInfo | undefined {
    return this.state.members.find((m) => m.peerId === this.options.peerId)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onSignal(handler: SignalHandler): () => void {
    this.signalHandlers.add(handler)
    return () => this.signalHandlers.delete(handler)
  }

  join(roomId: string | null): void {
    this.roomId = roomId
    if (roomId === null) this.streaming = { active: false }
    this.send({ t: 'join', roomId })
  }

  setStreaming(active: boolean, label?: string): void {
    this.streaming = { active, label }
    this.send({ t: 'stream', active, label })
  }

  setName(name: string): void {
    this.options.name = name
    this.send({ t: 'profile', name })
  }

  createRoom(name: string): void {
    this.send({ t: 'room-create', name })
  }

  renameRoom(roomId: string, name: string): void {
    this.send({ t: 'room-rename', roomId, name })
  }

  deleteRoom(roomId: string): void {
    this.send({ t: 'room-delete', roomId })
  }

  async sendSignal(to: string, payload: unknown): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plain = new TextEncoder().encode(JSON.stringify(payload))
    const cipher = await crypto.subtle.encrypt(
      // Os dados extras amarram a mensagem a quem envia e a quem recebe.
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${this.options.peerId}>${to}`) },
      this.options.keys.signalKey,
      plain
    )
    this.send({ t: 'signal', to, data: `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}` })
  }

  close(): void {
    this.closed = true
    clearInterval(this.pingTimer)
    clearTimeout(this.retryTimer)
    this.ws?.close()
  }

  private connect(): void {
    const url = `${this.options.serverUrl.replace(/\/$/, '')}/g/${this.options.keys.id}/ws`
    const ws = new WebSocket(url)
    this.ws = ws

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          auth: this.options.keys.auth,
          peerId: this.options.peerId,
          name: this.options.name
        } satisfies ClientMessage)
      )
      clearInterval(this.pingTimer)
      this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25_000)
    })

    ws.addEventListener('message', (event) => {
      if (event.data === 'pong') return
      let message: ServerMessage
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      this.handle(message)
    })

    ws.addEventListener('close', (event) => {
      clearInterval(this.pingTimer)
      if (this.closed || this.ws !== ws) return
      if (event.code === CLOSE.auth || event.code === CLOSE.version || event.code === CLOSE.replaced) {
        this.status = 'recusado'
        if (event.code === CLOSE.replaced) this.error = 'Você abriu o Aquarium em outro lugar com este mesmo aparelho.'
        this.emit()
        return
      }
      this.status = 'reconectando'
      this.emit()
      const delay = RETRY_DELAYS[Math.min(this.retry++, RETRY_DELAYS.length - 1)]
      this.retryTimer = setTimeout(() => this.connect(), delay)
    })
  }

  private handle(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.retry = 0
        this.status = 'conectado'
        this.error = null
        this.state = message.state
        // Volta para a sala e o estado em que estava (depois de uma queda, ou pedidos feitos antes de conectar).
        if (this.roomId !== null) {
          this.send({ t: 'join', roomId: this.roomId })
          if (this.streaming.active) this.send({ t: 'stream', ...this.streaming })
        }
        this.emit()
        break
      case 'state':
        this.state = message.state
        this.emit()
        break
      case 'signal':
        this.decrypt(message.from, message.data).then((payload) => {
          if (payload === undefined) return
          for (const handler of this.signalHandlers) handler(message.from, payload)
        })
        break
      case 'error':
        this.error = message.message
        this.emit()
        break
    }
  }

  private async decrypt(from: string, data: string): Promise<unknown> {
    try {
      const [iv, cipher] = data.split('.')
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64Url(iv), additionalData: new TextEncoder().encode(`${from}>${this.options.peerId}`) },
        this.options.keys.signalKey,
        fromBase64Url(cipher)
      )
      return JSON.parse(new TextDecoder().decode(plain))
    } catch {
      // Sinal adulterado ou de quem não tem a chave do grupo: ignorado.
      return undefined
    }
  }

  /** Só depois do "welcome": antes disso o servidor ainda confere a senha e recusaria. */
  private send(message: ClientMessage): void {
    if (this.status === 'conectado' && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
