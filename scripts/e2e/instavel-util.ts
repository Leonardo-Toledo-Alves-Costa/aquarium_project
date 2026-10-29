// Ajudantes da persona "instavel": log detalhado com horário e medidor de buracos no vídeo.
import { sleep, type Person } from './lib'

const t0 = Date.now()
const rel = (): string => `+${((Date.now() - t0) / 1000).toFixed(2)}s`

/** Faz os logs do app saírem com os detalhes em JSON e o horário relativo. */
export function verboseLogs(): void {
  ;(window as any).aquarium.log = (level: string, scope: string, message: string, details?: unknown) => {
    console.log(`LOG ${rel()} ${level} [${scope}] ${message} ${details === undefined ? '' : JSON.stringify(details)}`)
  }
}

async function framesDecoded(pc: RTCPeerConnection): Promise<number | undefined> {
  try {
    const stats = await pc.getStats()
    for (const s of stats.values()) if (s.type === 'inbound-rtp' && s.kind === 'video') return s.framesDecoded as number
  } catch {
    // fechando
  }
  return undefined
}

/**
 * Mede, a cada 100 ms, se `viewer` recebeu um quadro novo de `from` (na ligação atual e com `remote`).
 * `gap()` devolve o maior intervalo sem quadros desde `reset()`, incluindo o intervalo em andamento.
 */
export function frameMeter(viewer: Person, from: Person) {
  let lastFrameAt = Date.now()
  let maxGap = 0
  let lastLink = ''
  let lastCount = -1
  let links = new Set<string>()
  let running = true
  void (async () => {
    while (running) {
      const link = viewer.session.links.get(from.client.peerId)
      if (link && link.remote && link.pc.connectionState !== 'closed') {
        const n = await framesDecoded(link.pc)
        if (n !== undefined) {
          if (link.id !== lastLink) {
            links.add(link.id)
            lastLink = link.id
            lastCount = n
            if (n > 0) {
              const now = Date.now()
              maxGap = Math.max(maxGap, now - lastFrameAt)
              lastFrameAt = now
            }
          } else if (n > lastCount) {
            lastCount = n
            const now = Date.now()
            maxGap = Math.max(maxGap, now - lastFrameAt)
            lastFrameAt = now
          }
        }
      }
      await sleep(100)
    }
  })()
  return {
    reset(): void {
      lastFrameAt = Date.now()
      maxGap = 0
      links = new Set(lastLink ? [lastLink] : [])
    },
    gap(): number {
      return Math.max(maxGap, Date.now() - lastFrameAt)
    },
    /** Há quanto tempo chegou o último quadro (ms). */
    sinceLast(): number {
      return Date.now() - lastFrameAt
    },
    /** Quantas ligações diferentes apareceram desde reset() (1 = a mesma de antes). */
    linkCount(): number {
      return links.size
    },
    stop(): void {
      running = false
    }
  }
}

/** Fecha de verdade o WebSocket (o servidor percebe na hora), com um código qualquer. */
export function realClose(p: Person, code = 1000): void {
  const ws = (p.client as any).ws as WebSocket
  ws.close(code === 1000 || (code >= 3000 && code < 5000) ? code : 1000)
}

/**
 * Queda de verdade: o servidor vê o socket fechar na hora e o app recebe o close na hora
 * (o close real chega ~10 s depois, quando o app já trocou de socket, e é ignorado).
 */
export function realDrop(p: Person, code = 1006): void {
  const ws = (p.client as any).ws as WebSocket
  if (ws.readyState === WebSocket.CONNECTING) return ws.close() // o close real chega logo
  if (ws.readyState !== WebSocket.OPEN) return // já caindo, esperando a nova tentativa
  ws.close()
  ws.dispatchEvent(new CloseEvent('close', { code }))
}

/**
 * Conexão meio morta: o socket continua "aberto", mas nada sai e nada chega (sem evento de close).
 * Devolve uma função que desfaz.
 */
export function freezeSignaling(p: Person): () => void {
  const client = p.client as any
  const ws = client.ws as WebSocket
  const send = ws.send
  ws.send = () => {}
  const handle = client.handle
  client.handle = () => {}
  return () => {
    ws.send = send
    client.handle = handle
  }
}
