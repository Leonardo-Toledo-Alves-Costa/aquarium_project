// Mensagens entre o app e o servidor de salas (Cloudflare Worker).
// O servidor só vê quem está online, em que sala e quem está transmitindo.
// O conteúdo dos sinais (SDP, endereços) vai cifrado com a chave do grupo.

export const PROTOCOL_VERSION = 1
/**
 * Menor versão que o servidor ainda aceita. Ao mudar o protocolo, o servidor sobe PROTOCOL_VERSION
 * e mantém esta na anterior até todos atualizarem, para que ninguém fique trancado do lado de fora
 * enquanto a atualização automática chega. Publique o servidor antes do app.
 */
export const MIN_PROTOCOL_VERSION = 1

/** Identificador do grupo na URL: 22 caracteres base64url (128 bits de um hash do código). */
export const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/
export const PEER_ID_PATTERN = /^[A-Za-z0-9_-]{8,40}$/

export const LIMITS = {
  nameLength: 32,
  roomNameLength: 32,
  streamLabelLength: 60,
  rooms: 20,
  signalBytes: 60 * 1024,
  messageBytes: 64 * 1024,
  /** Mensagens por janela de 10 s antes de a conexão ser derrubada. */
  messagesPer10s: 300
} as const

export interface RoomInfo {
  id: string
  name: string
}

export interface MemberInfo {
  peerId: string
  name: string
  roomId: string | null
  streaming: boolean
  streamLabel?: string
}

export interface GroupState {
  rooms: RoomInfo[]
  members: MemberInfo[]
}

export type ClientMessage =
  | {
      t: 'hello'
      v: number
      auth: string
      peerId: string
      name: string
      /** Onde eu estava antes de uma queda (0.5.1+): o servidor já me põe de volta, sem eu sumir da sala. */
      roomId?: string | null
      streaming?: boolean
      streamLabel?: string
    }
  | { t: 'join'; roomId: string | null }
  | { t: 'stream'; active: boolean; label?: string }
  | { t: 'signal'; to: string; data: string }
  | { t: 'profile'; name: string }
  | { t: 'room-create'; name: string }
  | { t: 'room-rename'; roomId: string; name: string }
  | { t: 'room-delete'; roomId: string }

export type ErrorCode = 'auth' | 'version' | 'bad-request' | 'rate-limit' | 'limit'

export type ServerMessage =
  | { t: 'welcome'; peerId: string; state: GroupState }
  | { t: 'state'; state: GroupState }
  | { t: 'signal'; from: string; data: string }
  | { t: 'error'; code: ErrorCode; message: string }

/** Códigos de fechamento do WebSocket usados pelo servidor. */
export const CLOSE = {
  auth: 4001,
  version: 4002,
  replaced: 4003,
  rateLimit: 4004,
  badRequest: 4005
} as const

export const DEFAULT_ROOMS = ['Jogatina', 'Código', 'Cinema']
