// Ajudantes da persona "simultaneo": malhas de várias pessoas, contagem de eventos do log por pessoa,
// conferência de ligações casadas (remoteId) e vídeo chegando em todos os pares.
import { check, makeStream, newGroup, note, person, sleep, until, type Person } from './lib'

const t0 = Date.now()
const rel = (): string => `+${((Date.now() - t0) / 1000).toFixed(2)}s`

export interface LogEvent {
  at: number
  level: string
  message: string
  owner: string
  details: any
}

export const events: LogEvent[] = []
let people: Person[] = []

/** Mensagens do log que valem uma linha na saída (o resto só é contado). */
const SHOW = /refazendo|recriou|antiga ignorad|colis|reiniciando o ICE|ICE reiniciado|sinal com problema|falha ao negociar|websocket fechado|o veio|continua vindo|sumiu do servidor|voltou ao servidor|o fechada|servidor reconectado|sem resposta|enviados enquanto/

/**
 * Cala o console do app (fica só o que o teste escreve) e guarda cada linha do log com o dono:
 * a pessoa cuja sessão tem a ligação citada, ou cujo cliente está ativo.
 */
export function captureLogs(all: Person[], show = SHOW): void {
  people = all
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      const first = String(args[0] ?? '')
      if (first.startsWith('[rtc]') || first.startsWith('[sinalizacao]') || first.startsWith('[janela]')) return
      original(...args)
    }
  }
  ;(window as any).aquarium.log = (level: string, scope: string, message: string, details?: any) => {
    const owner = ownerOf(details)
    events.push({ at: Date.now(), level, message, owner, details })
    if (show.test(message)) console.log(`LOG ${rel()} ${owner} ${level} [${scope}] ${message} ${details === undefined ? '' : JSON.stringify(details)}`)
  }
}

function ownerOf(details: any): string {
  const link = details?.link
  if (link) {
    for (const p of people) for (const l of p.session.links.values()) if (l.id === link) return p.name
  }
  // Sem ligação conhecida: a pessoa citada em "peer" é a outra ponta; o dono é desconhecido.
  return '?'
}

export function count(re: RegExp, since = 0): number {
  return events.filter((e) => e.at >= since && re.test(e.message)).length
}

export function recovers(since = 0): LogEvent[] {
  return events.filter((e) => e.at >= since && e.message === 'refazendo a conexão')
}

/** Mensagens enviadas ao servidor por pessoa, para comparar com o limite de 300 a cada 10 s. */
export function countSends(p: Person): { max10s: () => number; total: () => number } {
  const client = p.client as any
  const original = client.send.bind(client)
  const times: number[] = []
  client.send = (message: unknown) => {
    times.push(Date.now())
    return original(message)
  }
  return {
    total: () => times.length,
    max10s: () => {
      let best = 0
      let j = 0
      for (let i = 0; i < times.length; i++) {
        while (times[i] - times[j] > 10_000) j++
        best = Math.max(best, i - j + 1)
      }
      return best
    }
  }
}

/** n pessoas no mesmo grupo e na mesma sala, todas com ligação 'connected' entre si. */
export async function mesh(names: string[]): Promise<Person[]> {
  const keys = await newGroup()
  const all = names.map((n) => person(keys, n))
  captureLogs(all)
  check(`${names.length} conectam ao servidor`, await until(() => all.every((p) => p.client.status === 'conectado'), 20000))
  const room = all[0].client.state.rooms[0]
  for (const p of all) p.client.join(room.id)
  // Sem ninguém transmitindo as ligações ficam em 'new' (nada a negociar): basta cada um ter as outras.
  const ok = await until(() => all.every((p) => p.session.links.size === all.length - 1), 30000)
  check(`malha de ${names.length} montada`, ok, ok ? '' : linkTable(all))
  return all
}

export function allConnected(all: Person[]): boolean {
  return all.every(
    (p) =>
      p.session.links.size === all.length - 1 &&
      all.every((q) => q === p || p.session.links.get(q.client.peerId)?.pc.connectionState === 'connected')
  )
}

/** Pares em que as duas pontas não apontam uma para a outra (ligações trocadas, duplicadas ou faltando). */
export function mismatched(all: Person[]): string[] {
  const bad: string[] = []
  for (const a of all)
    for (const b of all) {
      if (a === b) continue
      const la = a.session.links.get(b.client.peerId)
      const lb = b.session.links.get(a.client.peerId)
      if (!la || !lb) bad.push(`${a.name}->${b.name}: ${la ? '' : 'sem ligação'}${lb ? '' : ' (outro lado sem ligação)'}`)
      else if (la.remoteId !== lb.id || la.pc.connectionState !== 'connected' || la.pc.signalingState !== 'stable')
        bad.push(`${a.name}->${b.name}: ${la.id}->${la.remoteId} (do outro lado ${lb.id}) ${la.pc.connectionState}/${la.pc.signalingState}`)
    }
  return bad
}

export function linkTable(all: Person[]): string {
  return all
    .map(
      (a) =>
        `${a.name}[` +
        [...a.session.links.values()]
          .map((l) => {
            const n = all.find((q) => q.client.peerId === l.peerId)?.name ?? '?'
            return `${n}:${l.id}->${l.remoteId ?? '-'} ${l.pc.connectionState}/${l.pc.signalingState}${l.iWatch ? ' W' : ''}${l.theyWatch ? ' T' : ''}${l.senders.length ? ' S' : ''}${l.remote ? ' R' : ''}`
          })
          .join(', ') +
        ']'
    )
    .join(' | ')
}

async function framesDecoded(pc: RTCPeerConnection): Promise<number> {
  try {
    const stats = await pc.getStats()
    for (const s of stats.values()) if (s.type === 'inbound-rtp' && s.kind === 'video') return (s.framesDecoded as number) ?? 0
  } catch {
    // fechando
  }
  return 0
}

/** Pares (quem assiste <- quem transmite) sem quadros novos em 1,5 s. Todos medidos ao mesmo tempo. */
export async function videoMissing(pairs: [Person, Person][]): Promise<string[]> {
  const first = await Promise.all(
    pairs.map(async ([v, s]) => {
      const link = v.session.links.get(s.client.peerId)
      return { link, n: link?.remote ? await framesDecoded(link.pc) : -1 }
    })
  )
  await sleep(1500)
  const missing: string[] = []
  await Promise.all(
    pairs.map(async ([v, s], i) => {
      const link = v.session.links.get(s.client.peerId)
      const before = first[i]
      if (!link?.remote) return missing.push(`${v.name}<-${s.name} sem remote`)
      if (link !== before.link) return missing.push(`${v.name}<-${s.name} ligação trocou durante a medida`)
      const n = await framesDecoded(link.pc)
      if (!(n > before.n)) missing.push(`${v.name}<-${s.name} parado (${before.n}->${n})`)
    })
  )
  return missing
}

/** Espera até `ms` que todos os pares recebam vídeo; devolve os que continuam faltando. */
export async function waitVideo(pairs: [Person, Person][], ms = 20000): Promise<string[]> {
  const end = Date.now() + ms
  let missing = await videoMissing(pairs)
  while (missing.length && Date.now() < end) {
    await sleep(500)
    missing = await videoMissing(pairs)
  }
  return missing
}

export function everyPair(all: Person[]): [Person, Person][] {
  return all.flatMap((v) => all.filter((s) => s !== v).map((s) => [v, s] as [Person, Person]))
}

/** Todos começam a transmitir no mesmo instante (sem await entre eles). */
export function allStream(all: Person[]): Promise<void[]> {
  return Promise.all(all.map((p, i) => p.session.startStreaming(makeStream(i * 70), `Tela ${p.name}`)))
}

/** Todos pedem para assistir todos, no mesmo instante. */
export function allWatch(all: Person[], on = true): void {
  for (const v of all) for (const s of all) if (v !== s) v.session.watch(s.client.peerId, on)
}

export function summary(label: string, since = 0): string {
  const r = recovers(since)
  const by = r.map((e) => `${e.owner}->${e.details?.name}(${e.details?.why})`).join(', ')
  return `${label}: refazendo=${r.length}${by ? ' [' + by + ']' : ''} troca=${count(/recriou a conex/, since)} antigas=${count(/antiga ignorad/, since)} colisões=${count(/colis/, since)} iceRestart=${count(/reiniciando o ICE/, since)} sinalComProblema=${count(/sinal com problema/, since)} repeteAssistir=${count(/o veio/, since)}`
}

export { note }

/**
 * Confere se os sinais de `p` saem para o servidor na ordem em que a sessão pediu: sendSignal cifra cada
 * um com await e sem fila, então um candidato pequeno pode passar na frente de uma descrição grande.
 * `inversions()` lista, por destino, cada sinal que saiu antes de outro pedido antes dele.
 */
export function signalOrder(p: Person): { inversions: () => string[] } {
  const client = p.client as any
  const original = client.sendSignal.bind(client)
  let seq = 0
  const done: { n: number; kind: string; to: string }[] = []
  client.sendSignal = async (to: string, payload: any) => {
    const n = seq++
    const kind = payload?.k === 'desc' ? payload.desc?.type : payload?.k === 'ice' ? (payload.candidate?.candidate ? 'ice' : 'ice-end') : payload?.k
    await original(to, payload)
    done.push({ n, kind, to })
  }
  return {
    inversions: () => {
      const out: string[] = []
      const maxBefore = new Map<string, { n: number; kind: string }>()
      for (const d of done) {
        const m = maxBefore.get(d.to)
        if (m && m.n > d.n) out.push(`${p.name}: ${d.kind}#${d.n} saiu depois de ${m.kind}#${m.n}`)
        if (!m || d.n > m.n) maxBefore.set(d.to, { n: d.n, kind: d.kind })
      }
      return out
    }
  }
}
