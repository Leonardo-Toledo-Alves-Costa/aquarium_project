// Persona simultaneo: o caso comum, uma pessoa só transmite e a outra assiste; a rede pisca e o
// restartIce automático dispara nas duas pontas ao mesmo tempo.
// Par 1: quem transmite é o lado polite (peerId maior). Par 2: quem transmite é o lado impolite.
// Esperado: quem assiste não fica mais de 3 s sem quadros, e nada é refeito.
import { check, closeAll, finish, fail, makeStream, newGroup, person, sleep, until, type Person } from './lib'
import { captureLogs, linkTable, note, recovers, summary, waitVideo } from './simultaneo-util'

async function frames(v: Person, s: Person): Promise<{ q: number; pac: number }> {
  const link = v.session.links.get(s.client.peerId)
  const r = { q: 0, pac: 0 }
  try {
    for (const st of (await link!.pc.getStats()).values())
      if (st.type === 'inbound-rtp' && st.kind === 'video') {
        r.q += st.framesDecoded ?? 0
        r.pac += st.packetsReceived ?? 0
      }
  } catch {
    // sem ligação
  }
  return r
}

async function scenario(streamerPolite: boolean, delayMs: number): Promise<void> {
  const keys = await newGroup()
  // O lado polite é quem tem o peerId maior ("peer-zeca-..." > "peer-ana-...").
  const low = person(keys, 'Ana')
  const high = person(keys, 'Zeca')
  const pair = [low, high]
  captureLogs(pair)
  const [S, V] = streamerPolite ? [high, low] : [low, high]
  const label = `transmite ${S.name} (${streamerPolite ? 'polite' : 'impolite'}), outro lado ${delayMs} ms depois`
  await until(() => pair.every((p) => p.client.status === 'conectado'))
  const room = low.client.state.rooms[0]
  for (const p of pair) p.client.join(room.id)
  await until(() => pair.every((p) => p.session.links.size === 1))
  await S.session.startStreaming(makeStream(30), 'Tela')
  await until(() => !!V.client.state.members.find((m) => m.peerId === S.client.peerId)?.streaming)
  V.session.watch(S.client.peerId, true)
  check(`${label}: vídeo chega antes`, (await waitVideo([[V, S]], 15000)).length === 0)
  await sleep(3000)

  const t = Date.now()
  note(`>>> ${label}`)
  V.session.links.get(S.client.peerId)!.pc.restartIce()
  if (delayMs) await sleep(delayMs)
  S.session.links.get(V.client.peerId)!.pc.restartIce()
  let last = await frames(V, S)
  let lastAt = Date.now()
  let gap = 0
  const end = Date.now() + 20000
  while (Date.now() < end) {
    await sleep(250)
    const now = await frames(V, S)
    if (now.q !== last.q) lastAt = Date.now()
    gap = Math.max(gap, Date.now() - lastAt)
    last = now
  }
  note(`<<< ${label}: maior buraco ${gap} ms; q=${last.q} pac=${last.pac}; ${linkTable(pair)}`)
  note(summary(label, t))
  check(`${label}: no máximo 3 s sem quadros`, gap < 3000, `${gap} ms${Date.now() - lastAt > 1000 ? ' (ainda parado)' : ''}`)
  check(`${label}: nada refeito`, recovers(t).length === 0)
  closeAll(pair)
}

async function run(): Promise<void> {
  await scenario(true, 0)
  await scenario(false, 0)
  await scenario(true, 150)
  await scenario(true, 600)
  finish()
}

run().catch(fail)
