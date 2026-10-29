// Ajudantes da persona "apressado": contagem de mensagens do log do app e montagem rápida de cenários.
import { isLive, makeStream, newGroup, person, sleep, until, type Person } from './lib'

const t0 = Date.now()
const counts: Record<string, number> = {}
let echo = false

/** Conta cada mensagem de log do app (e opcionalmente imprime com horário). */
export function countLogs(print = false): void {
  echo = print
  ;(window as any).aquarium.log = (level: string, scope: string, message: string, details?: unknown) => {
    counts[message] = (counts[message] ?? 0) + 1
    if (echo) console.log(`LOG +${((Date.now() - t0) / 1000).toFixed(2)}s ${level} [${scope}] ${message} ${details === undefined ? '' : JSON.stringify(details)}`)
  }
}

export function logCount(message: string): number {
  return counts[message] ?? 0
}

/** Diferença das contagens desde um retrato. */
export function snapshot(): Record<string, number> {
  return { ...counts }
}
export function since(snap: Record<string, number>, message: string): number {
  return (counts[message] ?? 0) - (snap[message] ?? 0)
}

/** A transmite, B assiste (opcional), os dois na primeira sala. */
export async function pair(streaming = true, watching = true): Promise<{ A: Person; B: Person; roomId: string; keys: any }> {
  const keys = await newGroup()
  const A = person(keys, 'Miguel')
  const B = person(keys, 'Bia')
  await until(() => [A, B].every((p) => p.client.status === 'conectado'))
  const roomId = A.client.state.rooms[0].id
  A.client.join(roomId)
  B.client.join(roomId)
  await until(() => A.session.links.get(B.client.peerId)?.pc.connectionState === 'connected')
  if (streaming) {
    await A.session.startStreaming(makeStream(0), 'Jogo')
    await until(() => isLive(B, A))
    if (watching) {
      B.session.watch(A.client.peerId, true)
      await until(() => !!B.session.links.get(A.client.peerId)?.remote)
      await sleep(1000)
    }
  }
  return { A, B, roomId, keys }
}

async function inboundVideo(pc: RTCPeerConnection): Promise<{ bytes: number; frames: number }> {
  let bytes = 0
  let frames = 0
  try {
    const stats = await pc.getStats()
    for (const s of stats.values()) {
      if (s.type === 'inbound-rtp' && s.kind === 'video') {
        bytes += s.bytesReceived ?? 0
        frames += s.framesDecoded ?? 0
      }
    }
  } catch {
    // fechando
  }
  return { bytes, frames }
}

/** Quantos kbps de vídeo `viewer` recebe de `from` (somando todas as trilhas), medido em `ms`. */
export async function inboundKbps(viewer: Person, from: Person, ms = 2000): Promise<number> {
  const link = viewer.session.links.get(from.client.peerId)
  if (!link) return 0
  const a = await inboundVideo(link.pc)
  await sleep(ms)
  const b = await inboundVideo(link.pc)
  return Math.round(((b.bytes - a.bytes) * 8) / ms)
}

/** Resumo de uma ligação para as mensagens dos checks. */
export function linkInfo(p: Person, other: Person): string {
  const l = p.session.links.get(other.client.peerId)
  if (!l) return `${p.name}->${other.name}: sem ligação`
  return (
    `${p.name}->${other.name}: ${l.id}/${l.pc.connectionState}/${l.pc.signalingState} iWatch=${l.iWatch} theyWatch=${l.theyWatch} ` +
    `remote=${!!l.remote} incoming=${!!l.incoming} senders=${l.senders.length} transceivers=${l.pc.getTransceivers().length} ` +
    `sdp=${l.pc.localDescription?.sdp.length ?? 0}`
  )
}

/**
 * Como o frameMeter, mas soma os quadros de todas as trilhas de vídeo recebidas (com várias trocas de
 * trilha, a primeira estatística "inbound-rtp" pode ser de uma trilha antiga e parada).
 */
export function framesMeter(viewer: Person, from: Person) {
  let lastFrameAt = Date.now()
  let maxGap = 0
  let lastKey = ''
  let running = true
  void (async () => {
    while (running) {
      const link = viewer.session.links.get(from.client.peerId)
      if (link && link.remote && link.pc.connectionState !== 'closed') {
        const { frames } = await inboundVideo(link.pc)
        const key = `${link.id}:${frames}`
        if (frames > 0 && key !== lastKey) {
          if (lastKey.split(':')[0] === link.id) {
            const now = Date.now()
            maxGap = Math.max(maxGap, now - lastFrameAt)
            lastFrameAt = now
          }
          lastKey = key
        }
      }
      await sleep(100)
    }
  })()
  return {
    reset(): void {
      lastFrameAt = Date.now()
      maxGap = 0
    },
    gap: (): number => Math.max(maxGap, Date.now() - lastFrameAt),
    sinceLast: (): number => Date.now() - lastFrameAt,
    stop(): void {
      running = false
    }
  }
}
