// Peças comuns dos testes de conexão: pessoas de mentira, transmissões sintéticas e falhas provocadas.
import { generateGroupCode, deriveGroupKeys, type GroupKeys } from '../../src/renderer/src/group/group-code'
import { RoomClient } from '../../src/renderer/src/signaling/rooms'
import { RoomSession, type SessionSettings } from '../../src/renderer/src/rtc/room-session'
import { PRESETS } from '../../src/renderer/src/rtc/presets'

declare const SERVER_URL: string

// O preload não existe aqui; só o que a sessão usa.
;(window as any).aquarium ??= { checkForUpdates: async () => {}, platform: 'e2e', log: () => {} }

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function until(cond: () => boolean, ms = 15000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await sleep(100)
  }
  return false
}

const checks: string[] = []
const started = Date.now()

/** Registra um passo; nunca lança, para o teste seguir e mostrar todas as falhas. */
export function check(name: string, ok: boolean, extra = ''): boolean {
  checks.push((ok ? 'OK     ' : 'FALHOU ') + name + (extra ? ' -- ' + extra : ''))
  return ok
}

/** Linha com horário relativo, para cruzar com os logs. */
export function note(text: string): void {
  console.log(`[+${((Date.now() - started) / 1000).toFixed(1)}s] ${text}`)
}

export function finish(): void {
  console.log('RESULT ' + checks.join('\n'))
}

export function fail(err: unknown): void {
  console.log('ERROR ' + ((err as Error)?.stack ?? err) + '\n' + checks.join('\n'))
}

export const DEFAULT_SETTINGS: SessionSettings = { preset: PRESETS.jogo, priority: 'nitidez', codec: 'auto', bandwidth: 'auto' }

export interface Person {
  name: string
  client: RoomClient
  session: RoomSession
}

/** Um grupo novo a cada teste, para rodadas em paralelo não se misturarem no mesmo servidor. */
export async function newGroup(): Promise<GroupKeys> {
  return deriveGroupKeys(generateGroupCode())
}

export function person(keys: GroupKeys, name: string, settings = DEFAULT_SETTINGS): Person {
  const client = new RoomClient({ serverUrl: SERVER_URL, keys, peerId: `peer-${name.toLowerCase()}-${Date.now()}`, name })
  return { name, client, session: new RoomSession(client, settings) }
}

/** Tela sintética que muda a cada quadro, com um tom de áudio baixo. */
export function makeStream(hue: number, width = 640, height = 360, withAudio = false): MediaStream {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  let f = 0
  setInterval(() => {
    ctx.fillStyle = `hsl(${(hue + f++) % 360},60%,40%)`
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 40px sans-serif'
    ctx.fillText(String(f), 20, 60)
  }, 33)
  const tracks = [...canvas.captureStream(30).getVideoTracks()]
  if (withAudio) {
    const audio = new AudioContext()
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    gain.gain.value = 0.02
    const dest = audio.createMediaStreamDestination()
    osc.connect(gain).connect(dest)
    osc.start()
    tracks.push(...dest.stream.getAudioTracks())
  }
  return new MediaStream(tracks)
}

/** Quadros por segundo que `viewer` está recebendo de `from` (0 se nada chega). */
export async function fps(viewer: Person, from: Person): Promise<number> {
  const link = viewer.session.links.get(from.client.peerId)
  if (!link?.remote) return 0
  await link.inStats.sample()
  await sleep(1200)
  return Math.round((await link.inStats.sample()).fps ?? 0)
}

export function isLive(viewer: Person, streamer: Person): boolean {
  return !!viewer.client.state.members.find((m) => m.peerId === streamer.client.peerId)?.streaming
}

// --- falhas provocadas ---

/** Queda da conexão com o servidor: o cliente percebe e reconecta. */
export function dropSignaling(p: Person, code = 1006): void {
  ;((p.client as any).ws as WebSocket).dispatchEvent(new CloseEvent('close', { code }))
}

/** Derruba a ligação P2P com `other` sem avisar ninguém (como um NAT que esqueceu a rota). */
export function killPeer(p: Person, other: Person): void {
  p.session.links.get(other.client.peerId)?.pc.close()
}

/**
 * Intercepta os sinais P2P que `p` envia. `rule` decide o destino de cada sinal:
 * 'pass' entrega, 'drop' perde, um número atrasa em ms, 'dup' entrega duas vezes.
 * Devolve uma função que desfaz a interceptação.
 */
export function tamperSignals(p: Person, rule: (to: string, n: number) => 'pass' | 'drop' | 'dup' | number): () => void {
  const client = p.client as any
  const original = client.sendSignal.bind(client)
  let n = 0
  client.sendSignal = (to: string, ...rest: unknown[]) => {
    const r = rule(to, n++)
    if (r === 'drop') return Promise.resolve()
    if (r === 'dup') {
      original(to, ...rest)
      return original(to, ...rest)
    }
    if (typeof r === 'number') {
      setTimeout(() => original(to, ...rest), r)
      return Promise.resolve()
    }
    return original(to, ...rest)
  }
  return () => {
    client.sendSignal = original
  }
}

export function closeAll(people: Person[]): void {
  for (const p of people) {
    p.session.close()
    p.client.close()
  }
}

export { generateGroupCode }

// --- acrescentado pelo testador mensageiro-ruim ---

/** Os detalhes dos logs do app saem como JSON no console do teste (sem isso viram "[object Object]"). */
export function verboseLogs(): void {
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) =>
      original(...args.map((a) => (a && typeof a === 'object' && !(a instanceof Error) ? safeJson(a) : a)))
  }
}

function safeJson(a: unknown): string {
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

export type SignalKind = 'offer' | 'answer' | 'ice' | 'ice-end' | 'watch' | 'hello' | '?'

/** Tipo de um sinal P2P da sessão, para regras de `tamperSignalsBy`. */
export function signalKind(payload: any): SignalKind {
  if (payload?.k === 'desc') return payload.desc?.type === 'offer' ? 'offer' : payload.desc?.type === 'answer' ? 'answer' : '?'
  if (payload?.k === 'ice') return payload.candidate?.candidate ? 'ice' : 'ice-end'
  if (payload?.k === 'watch') return 'watch'
  if (payload?.k === 'hello') return 'hello'
  return '?'
}

/**
 * Como `tamperSignals`, mas a regra vê o tipo do sinal ('offer', 'answer', 'ice'...) e quantos
 * daquele tipo já passaram. Cada sinal decidido vai para `log` (se dado), para conferir no teste.
 */
export function tamperSignalsBy(
  p: Person,
  rule: (kind: SignalKind, nOfKind: number, to: string, payload: any) => 'pass' | 'drop' | 'dup' | number,
  log?: string[]
): () => void {
  const client = p.client as any
  const original = client.sendSignal.bind(client)
  const counts: Record<string, number> = {}
  client.sendSignal = (to: string, payload: any) => {
    const kind = signalKind(payload)
    const n = (counts[kind] = (counts[kind] ?? 0) + 1) - 1
    const r = rule(kind, n, to, payload)
    log?.push(`${p.name}:${kind}#${n}:${r}`)
    if (r === 'drop') return Promise.resolve()
    if (r === 'dup') {
      original(to, payload)
      return original(to, payload)
    }
    if (typeof r === 'number') {
      setTimeout(() => original(to, payload), r)
      return Promise.resolve()
    }
    return original(to, payload)
  }
  return () => {
    client.sendSignal = original
  }
}

/** Registra a ordem em que `p` recebe sinais P2P (tipo e de quem), antes da sessão tratar. */
export function recordIncoming(p: Person): SignalKind[] {
  const seen: SignalKind[] = []
  p.client.onSignal((_from, payload) => seen.push(signalKind(payload)))
  return seen
}

/** Estado da negociação de `p` com `other` ('-' se não há ligação). */
export function signaling(p: Person, other: Person): string {
  return p.session.links.get(other.client.peerId)?.pc.signalingState ?? '-'
}
