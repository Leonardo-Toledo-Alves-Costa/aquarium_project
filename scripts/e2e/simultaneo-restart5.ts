// Persona simultaneo: malha de 5, todos transmitindo e assistindo todos; restartIce() nas duas pontas
// de todos os pares no mesmo instante (como se a rede de todos piscasse junto e o restartIce
// automático disparasse em todo mundo). Acompanha cada par por 40 s: quadros e pacotes recebidos.
// Esperado: nenhum par fica mais de 3 s sem quadros novos.
import { check, closeAll, finish, fail, sleep, type Person } from './lib'
import { allStream, allWatch, everyPair, linkTable, mesh, mismatched, note, recovers, summary, waitVideo } from './simultaneo-util'

const REPEAT = 1
const WATCH_MS = 40000

async function inbound(v: Person, s: Person): Promise<{ frames: number; packets: number; n: number }> {
  const link = v.session.links.get(s.client.peerId)
  const r = { frames: 0, packets: 0, n: 0 }
  if (!link) return r
  try {
    for (const st of (await link.pc.getStats()).values())
      if (st.type === 'inbound-rtp' && st.kind === 'video') {
        r.frames += st.framesDecoded ?? 0
        r.packets += st.packetsReceived ?? 0
        r.n++
      }
  } catch {
    // fechando
  }
  return r
}

async function run(): Promise<void> {
  const all = await mesh(['Miguel', 'Bia', 'Rafa', 'Leo', 'Duda'])
  await allStream(all)
  allWatch(all)
  check('vídeo em todos os pares antes', (await waitVideo(everyPair(all), 20000)).length === 0)
  await sleep(3000)
  const pairs = everyPair(all)
  const polite = (v: Person, s: Person): string => (v.session.links.get(s.client.peerId)?.polite ? 'polite' : 'impolite')

  const t = Date.now()
  note(`>>> restartIce nas duas pontas de todos os pares (${REPEAT}x)`)
  for (let i = 0; i < REPEAT; i++) {
    for (const p of all) for (const l of p.session.links.values()) l.pc.restartIce()
    await sleep(300)
  }
  let last = await Promise.all(pairs.map(([v, s]) => inbound(v, s)))
  const lastAt = pairs.map(() => Date.now())
  const gap = pairs.map(() => 0)
  const end = Date.now() + WATCH_MS
  let tick = 0
  while (Date.now() < end) {
    await sleep(500)
    const now = await Promise.all(pairs.map(([v, s]) => inbound(v, s)))
    pairs.forEach((_, i) => {
      if (now[i].frames !== last[i].frames) lastAt[i] = Date.now()
      gap[i] = Math.max(gap[i], Date.now() - lastAt[i])
    })
    if (++tick % 8 === 0) {
      const stuck = pairs.flatMap(([v, s], i) => (Date.now() - lastAt[i] > 1500 ? [`${v.name}<-${s.name}(q=${now[i].frames},pac=${now[i].packets}${now[i].packets === last[i].packets ? ' sem pacotes' : ''})`] : []))
      note(`  +${Math.round((Date.now() - t) / 1000)} s parados: ${stuck.length} ${stuck.join(' ')}`)
    }
    last = now
  }
  const bad = pairs.flatMap(([v, s], i) => (gap[i] >= 3000 ? [`${v.name}(${polite(v, s)})<-${s.name}: ${Math.round(gap[i] / 1000)} s${Date.now() - lastAt[i] > 1500 ? ' (ainda parado)' : ''}`] : []))
  note(summary('restart', t))
  note(linkTable(all))
  // Diagnóstico de um par parado: os dois lados, transceptores, envio e par de candidatos.
  const i0 = pairs.findIndex((_, i) => gap[i] >= 3000)
  if (i0 >= 0) {
    const [v, s] = pairs[i0]
    for (const [me, other] of [[s, v], [v, s]] as [Person, Person][]) {
      const l = me.session.links.get(other.client.peerId)!
      const tr = l.pc.getTransceivers().map((x) => `${x.mid}:${x.direction}/${x.currentDirection}${x.sender.track ? ' track=' + x.sender.track.kind + ':' + x.sender.track.readyState : ''}`)
      const st = await l.pc.getStats()
      const out: string[] = []
      for (const r of st.values()) {
        if (r.type === 'outbound-rtp' && r.kind === 'video') out.push(`out mid=${r.mid} pac=${r.packetsSent} active=${r.active} lim=${r.qualityLimitationReason} enc=${r.encoderImplementation} fps=${r.framesPerSecond}`)
        if (r.type === 'inbound-rtp' && r.kind === 'video') out.push(`in mid=${r.mid} pac=${r.packetsReceived} q=${r.framesDecoded}`)
        if (r.type === 'transport') out.push(`transport ice=${r.iceState} dtls=${r.dtlsState} sel=${r.selectedCandidatePairId} sent=${r.bytesSent} recv=${r.bytesReceived}`)
        if (r.type === 'candidate-pair' && r.nominated) out.push(`pair ${r.id} ${r.state} sent=${r.bytesSent} recv=${r.bytesReceived}`)
      }
      note(`DIAG ${me.name}(${l.polite ? 'polite' : 'impolite'})->${other.name}: ${tr.join(' ')} | ${out.join(' | ')}`)
    }
  }
  check('nenhum par mais de 3 s sem quadros depois do restartIce', bad.length === 0, bad.join('; '))
  check('pontas casadas e estáveis', mismatched(all).length === 0, mismatched(all).join('; '))
  check('nada refeito', recovers(t).length === 0, recovers(t).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))
  closeAll(all)
  finish()
}

run().catch(fail)
