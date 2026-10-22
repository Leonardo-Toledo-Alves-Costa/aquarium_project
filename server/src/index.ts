// Servidor de salas do Aquarium: um Durable Object por grupo.
// Só responde a WebSocket em /g/<grupo>/ws; todo o resto é 404.

import { DurableObject } from 'cloudflare:workers'
import {
  CLOSE,
  DEFAULT_ROOMS,
  GROUP_ID_PATTERN,
  LIMITS,
  MIN_PROTOCOL_VERSION,
  PEER_ID_PATTERN,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type GroupState,
  type MemberInfo,
  type RoomInfo,
  type ServerMessage
} from '../../src/shared/rooms-protocol'

export interface Env {
  GROUPS: DurableObjectNamespace<GroupRoom>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const match = /^\/g\/([^/]+)\/ws$/.exec(url.pathname)
    if (!match || !GROUP_ID_PATTERN.test(match[1]) || request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Not found', { status: 404 })
    }
    const stub = env.GROUPS.get(env.GROUPS.idFromName(match[1]))
    return stub.fetch(request)
  }
} satisfies ExportedHandler<Env>

/** O que o servidor lembra de cada conexão; sobrevive à hibernação do objeto. */
interface Connection {
  authed: boolean
  peerId?: string
  name?: string
  roomId: string | null
  streaming: boolean
  streamLabel?: string
  ip: string
  windowStart: number
  windowCount: number
}

const encoder = new TextEncoder()

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > 0 && text.length <= max ? text : null
}

export class GroupRoom extends DurableObject<Env> {
  private rooms?: RoomInfo[]
  /** Tentativas de entrada com código errado, por IP. Zera se o objeto hibernar. */
  private failures = new Map<string, { count: number; since: number }>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Mantém a conexão viva sem acordar o objeto (não conta como requisição).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
    const failure = this.failures.get(ip)
    if (failure && failure.count >= 5 && Date.now() - failure.since < 10 * 60_000) {
      return new Response('Too many attempts', { status: 429 })
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    const connection: Connection = { authed: false, roomId: null, streaming: false, ip, windowStart: Date.now(), windowCount: 0 }
    server.serializeAttachment(connection)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const connection = ws.deserializeAttachment() as Connection
    if (typeof raw !== 'string' || raw.length > LIMITS.messageBytes) {
      return this.reject(ws, 'bad-request', 'Mensagem inválida', CLOSE.badRequest)
    }

    const now = Date.now()
    if (now - connection.windowStart > 10_000) {
      connection.windowStart = now
      connection.windowCount = 0
    }
    if (++connection.windowCount > LIMITS.messagesPer10s) {
      return this.reject(ws, 'rate-limit', 'Mensagens demais', CLOSE.rateLimit)
    }

    let message: ClientMessage
    try {
      message = JSON.parse(raw)
    } catch {
      return this.reject(ws, 'bad-request', 'Mensagem inválida', CLOSE.badRequest)
    }

    if (!connection.authed) {
      if (message.t !== 'hello') return this.reject(ws, 'auth', 'Identifique-se primeiro', CLOSE.auth)
      return this.hello(ws, connection, message)
    }

    ws.serializeAttachment(connection)
    switch (message.t) {
      case 'join':
        return this.join(ws, connection, message.roomId)
      case 'stream':
        return this.stream(ws, connection, message.active, message.label)
      case 'signal':
        return this.signal(ws, connection, message.to, message.data)
      case 'profile':
        return this.profile(ws, connection, message.name)
      case 'room-create':
        return this.roomCreate(ws, message.name)
      case 'room-rename':
        return this.roomRename(ws, message.roomId, message.name)
      case 'room-delete':
        return this.roomDelete(message.roomId)
      default:
        return this.reject(ws, 'bad-request', 'Tipo de mensagem desconhecido')
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.broadcastState(ws)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastState(ws)
  }

  private async hello(ws: WebSocket, connection: Connection, message: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
    if (typeof message.v !== 'number' || message.v < MIN_PROTOCOL_VERSION || message.v > PROTOCOL_VERSION) {
      return this.reject(ws, 'version', 'Versão do Aquarium diferente da do servidor. Atualize o app.', CLOSE.version)
    }
    const name = cleanText(message.name, LIMITS.nameLength)
    if (!name || typeof message.peerId !== 'string' || !PEER_ID_PATTERN.test(message.peerId) || typeof message.auth !== 'string' || message.auth.length !== 43) {
      return this.reject(ws, 'bad-request', 'Dados de entrada inválidos', CLOSE.badRequest)
    }

    const hash = await sha256Hex(message.auth)
    const stored = await this.ctx.storage.get<string>('authHash')
    if (!stored) {
      // Primeira pessoa com esse código: o grupo passa a existir.
      await this.ctx.storage.put('authHash', hash)
      await this.saveRooms(DEFAULT_ROOMS.map((roomName) => ({ id: crypto.randomUUID().slice(0, 8), name: roomName })))
    } else if (!crypto.subtle.timingSafeEqual(encoder.encode(stored), encoder.encode(hash))) {
      const previous = this.failures.get(connection.ip)
      // Passados os 10 minutos, a contagem recomeça (senão o bloqueio só valeria uma vez).
      const failure = previous && Date.now() - previous.since < 10 * 60_000 ? previous : { count: 0, since: Date.now() }
      failure.count++
      this.failures.set(connection.ip, failure)
      return this.reject(ws, 'auth', 'Código do grupo incorreto', CLOSE.auth)
    }

    // Mesmo aparelho reconectando: a conexão antiga sai.
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue
      const otherConnection = other.deserializeAttachment() as Connection
      if (otherConnection.authed && otherConnection.peerId === message.peerId) other.close(CLOSE.replaced, 'Conectado em outro lugar')
    }

    connection.authed = true
    connection.peerId = message.peerId
    connection.name = name
    ws.serializeAttachment(connection)
    this.send(ws, { t: 'welcome', peerId: message.peerId, state: await this.state() })
    this.broadcastState(undefined, ws)
  }

  private async join(ws: WebSocket, connection: Connection, roomId: string | null): Promise<void> {
    if (roomId !== null && !(await this.loadRooms()).some((r) => r.id === roomId)) {
      return this.reject(ws, 'bad-request', 'Essa sala não existe mais')
    }
    connection.roomId = roomId
    if (roomId === null) {
      connection.streaming = false
      connection.streamLabel = undefined
    }
    ws.serializeAttachment(connection)
    this.broadcastState()
  }

  private stream(ws: WebSocket, connection: Connection, active: boolean, label?: string): void {
    connection.streaming = !!active && connection.roomId !== null
    connection.streamLabel = connection.streaming ? (cleanText(label, LIMITS.streamLabelLength) ?? undefined) : undefined
    ws.serializeAttachment(connection)
    this.broadcastState()
  }

  private signal(ws: WebSocket, connection: Connection, to: string, data: string): void {
    if (typeof to !== 'string' || typeof data !== 'string' || data.length > LIMITS.signalBytes) {
      return this.reject(ws, 'bad-request', 'Sinal inválido')
    }
    if (connection.roomId === null) return
    for (const other of this.ctx.getWebSockets()) {
      const target = other.deserializeAttachment() as Connection
      // Só entre pessoas da mesma sala.
      if (target.authed && target.peerId === to && target.roomId === connection.roomId) {
        this.send(other, { t: 'signal', from: connection.peerId!, data })
        return
      }
    }
  }

  private profile(ws: WebSocket, connection: Connection, rawName: string): void {
    const name = cleanText(rawName, LIMITS.nameLength)
    if (!name) return this.reject(ws, 'bad-request', 'Nome inválido')
    connection.name = name
    ws.serializeAttachment(connection)
    this.broadcastState()
  }

  private async roomCreate(ws: WebSocket, rawName: string): Promise<void> {
    const name = cleanText(rawName, LIMITS.roomNameLength)
    if (!name) return this.reject(ws, 'bad-request', 'Nome de sala inválido')
    const rooms = await this.loadRooms()
    if (rooms.length >= LIMITS.rooms) return this.reject(ws, 'limit', `O grupo já tem ${LIMITS.rooms} salas`)
    await this.saveRooms([...rooms, { id: crypto.randomUUID().slice(0, 8), name }])
    this.broadcastState()
  }

  private async roomRename(ws: WebSocket, roomId: string, rawName: string): Promise<void> {
    const name = cleanText(rawName, LIMITS.roomNameLength)
    if (!name) return this.reject(ws, 'bad-request', 'Nome de sala inválido')
    await this.saveRooms((await this.loadRooms()).map((r) => (r.id === roomId ? { ...r, name } : r)))
    this.broadcastState()
  }

  private async roomDelete(roomId: string): Promise<void> {
    await this.saveRooms((await this.loadRooms()).filter((r) => r.id !== roomId))
    for (const other of this.ctx.getWebSockets()) {
      const connection = other.deserializeAttachment() as Connection
      if (connection.roomId === roomId) {
        connection.roomId = null
        connection.streaming = false
        connection.streamLabel = undefined
        other.serializeAttachment(connection)
      }
    }
    this.broadcastState()
  }

  private async loadRooms(): Promise<RoomInfo[]> {
    this.rooms ??= (await this.ctx.storage.get<RoomInfo[]>('rooms')) ?? []
    return this.rooms
  }

  private async saveRooms(rooms: RoomInfo[]): Promise<void> {
    this.rooms = rooms
    await this.ctx.storage.put('rooms', rooms)
  }

  private async state(exclude?: WebSocket): Promise<GroupState> {
    const members: MemberInfo[] = []
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue
      const c = ws.deserializeAttachment() as Connection
      if (!c.authed || !c.peerId || !c.name) continue
      members.push({ peerId: c.peerId, name: c.name, roomId: c.roomId, streaming: c.streaming, streamLabel: c.streamLabel })
    }
    return { rooms: await this.loadRooms(), members }
  }

  private broadcastState(exclude?: WebSocket, skip?: WebSocket): void {
    this.state(exclude).then((state) => {
      for (const ws of this.ctx.getWebSockets()) {
        if (ws === exclude || ws === skip) continue
        if ((ws.deserializeAttachment() as Connection).authed) this.send(ws, { t: 'state', state })
      }
    })
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message))
    } catch {
      // Conexão já fechada.
    }
  }

  private reject(ws: WebSocket, code: ErrorCode, message: string, closeCode?: number): void {
    this.send(ws, { t: 'error', code, message })
    if (closeCode) ws.close(closeCode, message.slice(0, 120))
  }
}
