// Persona simultaneo: os dois lados reiniciam o ICE no mesmo instante (como no restartIce automático
// depois de 4 s em 'disconnected', que dispara nas duas pontas quase juntas).
// A (peer "ana", impolite com B) e B (peer "beto", polite) transmitem e assistem um ao outro.
// Só pares, transmissões começadas uma depois da outra (sem colisão no começo); os dois reiniciam juntos, 3 rodadas.
// Esperado: o vídeo continua nos dois sentidos (buraco < 3 s) e nada é refeito.
import { check, closeAll, finish, fail, makeStream, newGroup, person, sleep, until, type Person } from './lib'
import { captureLogs, everyPair, linkTable, mismatched, note, recovers, summary, waitVideo } from './simultaneo-util'

interface In {
  frames: number
  packets: number
  bytes: number
  n: number
}

async function inbound(v: Person, s: Person): Promise<In> {
  const link = v.session.links.get(s.client.peerId)
  const r: In = { frames: 0, packets: 0, bytes: 0, n: 0 }
  if (!link) return r
  try {
    for (const st of (await link.pc.getStats()).values())
      if (st.type === 'inbound-rtp' && st.kind === 'video') {
        r.frames += st.framesDecoded ?? 0
        r.packets += st.packetsReceived ?? 0
        r.bytes += st.bytesReceived ?? 0
        r.n++
      }
  } catch {
    // fechando
  }
  return r
}

/** Acompanha por `ms` e devolve o maior buraco sem quadros novos em cada sentido, e se os pacotes pararam. */
async function watchGap(A: Person, B: Person, ms: number): Promise<{ ab: number; ba: number; log: string[] }> {
  const dirs: [Person, Person][] = [
    [B, A],
    [A, B]
  ]
  const last = await Promise.all(dirs.map(([v, s]) => inbound(v, s)))
  const lastAt = dirs.map(() => Date.now())
  const gap = dirs.map(() => 0)
  const log: string[] = []
  const end = Date.now() + ms
  let tick = 0
  while (Date.now() < end) {
    await sleep(200)
    const now = await Promise.all(dirs.map(([v, s]) => inbound(v, s)))
    dirs.forEach(([v, s], i) => {
      if (now[i].frames > last[i].frames || now[i].frames < last[i].frames) lastAt[i] = Date.now()
      gap[i] = Math.max(gap[i], Date.now() - lastAt[i])
      if (tick % 10 === 0) log.push(`${v.name}<-${s.name} q=${now[i].frames} pac=${now[i].packets} kB=${Math.round(now[i].bytes / 1000)} inbound=${now[i].n}`)
      last[i] = now[i]
    })
    tick++
  }
  return { ba: gap[0], ab: gap[1], log }
}

async function run(): Promise<void> {
  const keys = await newGroup()
  const A = person(keys, 'Ana')
  const B = person(keys, 'Beto')
  const pair = [A, B]
  captureLogs(pair)
  await until(() => pair.every((p) => p.client.status === 'conectado'))
  const room = A.client.state.rooms[0]
  for (const p of pair) p.client.join(room.id)
  await until(() => pair.every((p) => p.session.links.size === 1))
  note(`polite: A=${A.session.links.get(B.client.peerId)?.polite} B=${B.session.links.get(A.client.peerId)?.polite}`)
  // Sem colisão no começo: A transmite e B assiste; só depois B transmite e A assiste.
  await A.session.startStreaming(makeStream(10), 'A')
  await until(() => !!B.client.state.members.find((m) => m.peerId === A.client.peerId)?.streaming)
  B.session.watch(A.client.peerId, true)
  await waitVideo([[B, A]], 15000)
  await sleep(2000)
  await B.session.startStreaming(makeStream(200), 'B')
  await until(() => !!A.client.state.members.find((m) => m.peerId === B.client.peerId)?.streaming)
  A.session.watch(B.client.peerId, true)
  check('vídeo nos dois sentidos antes', (await waitVideo(everyPair(pair), 15000)).length === 0)
  await sleep(3000)

  const rounds: [string, Person[]][] = [
    ['os dois reiniciam juntos', [A, B]],
    ['os dois reiniciam juntos (2)', [A, B]],
    ['os dois reiniciam juntos (3)', [A, B]]
  ]
  for (const [label, who] of rounds) {
    const t = Date.now()
    note(`>>> ${label}`)
    for (let i = 0; i < (label.includes('3 vezes') ? 3 : 1); i++) {
      for (const p of who) for (const l of p.session.links.values()) l.pc.restartIce()
      await sleep(300)
    }
    const g = await watchGap(A, B, 15000)
    note(`<<< ${label}: maior buraco B<-A=${g.ba} ms, A<-B=${g.ab} ms; ${linkTable(pair)}`)
    for (const line of g.log.slice(0, 6)) note('   ' + line)
    note(summary(label, t))
    check(`${label}: pontas casadas e estáveis`, mismatched(pair).length === 0, mismatched(pair).join('; '))
    check(`${label}: vídeo B<-A sem buraco maior que 3 s`, g.ba < 3000, `${g.ba} ms`)
    check(`${label}: vídeo A<-B sem buraco maior que 3 s`, g.ab < 3000, `${g.ab} ms`)
    check(`${label}: nada refeito`, recovers(t).length === 0, recovers(t).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))
    await sleep(2000)
  }
  closeAll(pair)
  finish()
}

run().catch(fail)
