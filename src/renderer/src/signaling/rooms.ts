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
import { errorInfo, logger } from '../log'

const log = logger('sinalizacao')

export type ConnectionStatus = 'conectando' | 'conectado' | 'reconectando' | 'recusado'

export interface RoomClientOptions {
  serverUrl: string
  keys: GroupKeys
  peerId: string
  name: string
}

type SignalHandler = (from: string, payload: unknown) => void

const RETRY_DELAYS = [500, 1000, 2000, 5000, 10000]
/** Sem nada do servidor por esse tempo, mando um ping (o servidor responde "pong" sem acordar). */
const PING_MS = 10_000
/** Sem nada do servidor por esse tempo, a conexão está morta mesmo que o socket diga "aberto". */
const DEAD_MS = 20_000

export class RoomClient {
  state: GroupState = { rooms: [], members: [] }
  status: ConnectionStatus = 'conectando'
  /** Quantas vezes a conexão com o servidor foi aceita (sobe a cada reconexão). */
  connections = 0
  /** Motivo de uma recusa (código errado, versão antiga) ou do último erro. */
  error: string | null = null
  /** Quem fechou o app de propósito (aviso do servidor): sem esperar a volta dessa pessoa. */
  readonly departed = new Set<string>()

  private ws?: WebSocket
  private listeners = new Set<() => void>()
  private signalHandlers = new Set<SignalHandler>()
  private retry = 0
  private heartbeatTimer: ReturnType<typeof setInterval>
  private retryTimer?: ReturnType<typeof setTimeout>
  /** Última mensagem do servidor (inclusive "pong") e último ping enviado. */
  private lastSeen = 0
  private pingSentAt = 0
  private closed = false
  private roomId: string | null = null
  private streaming: { active: boolean; label?: string } = { active: false }
  /** Voltando para a sala depois de uma queda, até o servidor confirmar. */
  private rejoining = false
  /** Sinais que não saíram porque o servidor estava desconectado (só para o log). */
  private unsent = { count: 0, to: new Set<string>() }
  /** Sinais são decifrados e entregues em fila, na ordem em que chegaram. */
  private inbox: Promise<void> = Promise.resolve()

  constructor(private readonly options: RoomClientOptions) {
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 1000)
    // Fechar a janela avisa o servidor na hora (código 1000), e ele avisa os outros.
    window.addEventListener('pagehide', this.onPageHide)
    this.connect()
  }

  private onPageHide = (): void => this.close()

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
    log.info(roomId === null ? 'saindo da sala' : 'entrando na sala', { roomId, from: this.roomId })
    this.roomId = roomId
    if (roomId === null) this.streaming = { active: false }
    this.send({ t: 'join', roomId })
  }

  setStreaming(active: boolean, label?: string): void {
    log.info(active ? 'transmissão anunciada' : 'fim da transmissão anunciado')
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
    log.info('desconectando do servidor (fechado pelo app)')
    this.closed = true
    clearInterval(this.heartbeatTimer)
    clearTimeout(this.retryTimer)
    window.removeEventListener('pagehide', this.onPageHide)
    this.ws?.close(1000)
  }

  /**
   * Percebe uma conexão meio morta (Wi-Fi trocando de rede, volta da hibernação): o socket continua
   * "aberto", mas nada chega. Sem isso, o close só viria minutos depois, e para os outros eu já teria saído.
   */
  private heartbeat(): void {
    const ws = this.ws
    if (this.status !== 'conectado' || !ws || ws.readyState !== WebSocket.OPEN) return
    const now = Date.now()
    if (now - this.lastSeen > DEAD_MS) {
      log.warn('servidor sem resposta; reconectando', { silentMs: now - this.lastSeen, pingMs: this.pingSentAt ? now - this.pingSentAt : null })
      // Não espero o close desse socket: ele pode demorar ou nunca chegar.
      this.ws = undefined
      try {
        // Código de queda, não de saída: se chegar ao servidor, os outros continuam esperando a volta.
        ws.close(4000)
      } catch {
        // Já fechado.
      }
      this.logUnsent()
      this.reconnect()
    } else if (now - this.lastSeen >= PING_MS && now - this.pingSentAt >= PING_MS) {
      this.pingSentAt = now
      ws.send('ping')
    }
  }

  private reconnect(): void {
    this.status = 'reconectando'
    this.emit()
    const delay = RETRY_DELAYS[Math.min(this.retry++, RETRY_DELAYS.length - 1)]
    log.info('nova tentativa agendada', { delayMs: delay, attempt: this.retry })
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }

  private connect(): void {
    const url = `${this.options.serverUrl.replace(/\/$/, '')}/g/${this.options.keys.id}/ws`
    // Só o servidor: o caminho da URL tem o id do grupo.
    log.info('conectando ao servidor', { host: new URL(url).host, attempt: this.retry })
    const ws = new WebSocket(url)
    this.ws = ws
    let openedAt = 0
    let welcomed = this.connections

    ws.addEventListener('open', () => {
      // Um socket que eu já abandonei abrindo atrasado derrubaria o atual (o servidor troca pelo mais novo).
      if (this.ws !== ws) {
        log.info('websocket antigo abriu atrasado; fechado')
        ws.close()
        return
      }
      openedAt = Date.now()
      log.info('websocket aberto')
      ws.send(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          auth: this.options.keys.auth,
          peerId: this.options.peerId,
          name: this.options.name,
          roomId: this.roomId,
          streaming: this.streaming.active,
          streamLabel: this.streaming.label
        } satisfies ClientMessage)
      )
    })

    ws.addEventListener('message', (event) => {
      if (this.ws !== ws) return
      this.lastSeen = Date.now()
      if (event.data === 'pong') return
      let message: ServerMessage
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      this.handle(message)
    })

    ws.addEventListener('error', () => log.warn('erro no websocket'))

    ws.addEventListener('close', (event) => {
      const details = {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        upMs: openedAt ? Date.now() - openedAt : null,
        welcomed: this.connections > welcomed
      }
      if (this.closed || this.ws !== ws) {
        log.info('websocket antigo fechado', details)
        return
      }
      log.warn('websocket fechado', details)
      this.logUnsent()
      if (event.code === CLOSE.auth || event.code === CLOSE.version || event.code === CLOSE.replaced) {
        this.status = 'recusado'
        // Versão recusada pelo servidor: procura a atualização agora, sem esperar a próxima verificação.
        if (event.code === CLOSE.version) void window.aquarium.checkForUpdates()
        if (event.code === CLOSE.replaced) this.error = 'Você abriu o Aquarium em outro lugar com este mesmo aparelho.'
        log.error('conexão recusada pelo servidor; sem nova tentativa', { code: event.code })
        this.emit()
        return
      }
      this.reconnect()
    })
  }

  private handle(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.connections++
        this.retry = 0
        this.status = 'conectado'
        this.error = null
        this.rejoining = false
        this.logUnsent()
        log.info('conectado ao servidor', {
          connections: this.connections,
          members: message.state.members.length,
          rooms: message.state.rooms.length,
          rejoin: this.roomId,
          streaming: this.streaming.active
        })
        this.pingSentAt = 0
        this.setState(message.state)
        // Volta para a sala e o estado em que estava (depois de uma queda, ou pedidos feitos antes de conectar).
        // O servidor 0.5.1 já me pôs de volta pelo hello; os anteriores precisam do join.
        if (this.me?.roomId !== this.roomId || !!this.me?.streaming !== this.streaming.active) {
          if (this.me?.roomId !== this.roomId) this.send({ t: 'join', roomId: this.roomId })
          if (this.roomId !== null && !!this.me?.streaming !== this.streaming.active) this.send({ t: 'stream', ...this.streaming })
          if (this.roomId !== null) {
            this.rejoining = true
            this.setState(this.state)
          }
        }
        this.emit()
        break
      case 'state':
        this.setState(message.state)
        this.emit()
        break
      case 'signal':
        this.inbox = this.inbox.then(async () => {
          const payload = await this.decrypt(message.from, message.data)
          if (payload === undefined) return
          // Entregues na ordem de chegada; cada conexão trata os seus em fila (RoomSession.onSignal).
          for (const handler of this.signalHandlers) handler(message.from, payload)
        }).catch((err) => log.warn('falha ao tratar um sinal', { from: message.from, error: errorInfo(err) }))
        break
      case 'left':
        log.info('saiu do grupo (fechou o app)', { peer: message.peerId })
        this.departed.add(message.peerId)
        this.emit()
        break
      case 'error':
        log.warn('erro do servidor', { code: message.code, message: message.message })
        this.error = message.message
        this.emit()
        break
    }
  }

  private setState(state: GroupState): void {
    if (state !== this.state) logPresence(this.state, state, this.options.peerId)
    this.state = state
    for (const m of state.members) this.departed.delete(m.peerId)
    // A sala em que eu estava foi apagada: o servidor já me tirou dela; não tento voltar numa reconexão.
    if (this.roomId !== null && !state.rooms.some((r) => r.id === this.roomId)) {
      log.info('a sala em que eu estava foi apagada', { roomId: this.roomId })
      this.roomId = null
      this.streaming = { active: false }
      this.rejoining = false
    }
    if (!this.rejoining) return
    const me = this.me
    if (me?.roomId === this.roomId && me.streaming === this.streaming.active) {
      log.info('servidor confirmou a volta para a sala', { roomId: this.roomId })
      this.rejoining = false
    } else if (me) {
      // Até o servidor confirmar, vale a sala de antes. Sem isso, a sessão veria "fora da sala"
      // por um instante e fecharia as conexões e a própria transmissão.
      Object.assign(me, { roomId: this.roomId, streaming: this.streaming.active, streamLabel: this.streaming.label })
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
      log.warn('sinal ignorado: não foi possível decifrar', { from })
      return undefined
    }
  }

  /** Só depois do "welcome": antes disso o servidor ainda confere a senha e recusaria. */
  private send(message: ClientMessage): void {
    if (this.status === 'conectado' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else if (message.t === 'signal') {
      // Perdido de vez: o app não reenvia sinais. Uma oferta perdida aqui pode travar a conexão.
      this.unsent.count++
      this.unsent.to.add(message.to)
    }
  }

  private logUnsent(): void {
    if (this.unsent.count === 0) return
    log.warn('sinais não enviados enquanto desconectado', { count: this.unsent.count, to: [...this.unsent.to] })
    this.unsent = { count: 0, to: new Set() }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Quem entrou, saiu, mudou de sala ou começou/parou de transmitir, comparando dois estados do grupo. */
function logPresence(before: GroupState, after: GroupState, self: string): void {
  const old = new Map(before.members.map((m) => [m.peerId, m]))
  for (const m of after.members) {
    // A minha própria entrada muda de mentira durante a volta para a sala (ver setState).
    if (m.peerId === self) {
      old.delete(self)
      continue
    }
    const prev = old.get(m.peerId)
    old.delete(m.peerId)
    const who = { peer: m.peerId, name: m.name }
    if (!prev) {
      log.info('ficou online', { ...who, roomId: m.roomId, streaming: m.streaming })
      continue
    }
    if (prev.roomId !== m.roomId) log.info('mudou de sala', { ...who, from: prev.roomId, to: m.roomId })
    if (prev.streaming !== m.streaming) log.info(m.streaming ? 'começou a transmitir' : 'parou de transmitir', who)
  }
  old.delete(self)
  for (const m of old.values()) log.info('ficou offline', { peer: m.peerId, name: m.name, roomId: m.roomId })
}
