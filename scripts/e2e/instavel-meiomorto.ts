// Persona instavel: conexão com o servidor meio morta.
// Caso 1: o socket de A não entrega nem recebe nada, mas não fecha (nenhum dos lados percebe).
// Caso 2: o servidor já deu A como caído (fechou do lado dele), mas o app de A nunca recebe o close.
// Esperado: com ping a cada 25 s, o app perceberia a falta de pong e reconectaria em até ~60 s.
import { check, closeAll, finish, fail, isLive, makeStream, newGroup, note, person, sleep, until } from './lib'
import { frameMeter, freezeSignaling, verboseLogs } from './instavel-util'

const DETECT_MS = 60_000

async function run(): Promise<void> {
  verboseLogs()
  const keys = await newGroup()
  const A = person(keys, 'Miguel')
  const B = person(keys, 'Bia')
  const all = [A, B]
  check('conectam', await until(() => all.every((p) => p.client.status === 'conectado')))
  const room = A.client.state.rooms[0]
  for (const p of all) p.client.join(room.id)
  await until(() => all.every((p) => p.session.links.size === 1))
  await A.session.startStreaming(makeStream(0), 'Jogo')
  await until(() => isLive(B, A))
  B.session.watch(A.client.peerId, true)
  check('B recebe A', await until(() => !!B.session.links.get(A.client.peerId)?.remote))
  const meter = frameMeter(B, A)
  await sleep(2000)

  note('>>> caso 1: socket de A congelado (nada entra nem sai, sem close)')
  let before = A.client.connections
  const unfreeze = freezeSignaling(A)
  const t1 = Date.now()
  const detected1 = await until(() => A.client.status !== 'conectado' || A.client.connections > before, DETECT_MS)
  note(`<<< caso 1: percebeu=${detected1} depois de ${Date.now() - t1} ms; status=${A.client.status}`)
  check(`caso 1: A percebe a conexão morta em até ${DETECT_MS / 1000} s`, detected1, `status ${A.client.status} após ${Math.round((Date.now() - t1) / 1000)} s`)
  unfreeze()
  if (!detected1) {
    // Força a volta ao normal para o próximo caso.
    ;((A.client as any).ws as WebSocket).dispatchEvent(new CloseEvent('close', { code: 1006 }))
  }
  await until(() => A.client.status === 'conectado' && !!B.session.links.get(A.client.peerId)?.remote, 20000)
  await sleep(3000)

  note('>>> caso 2: o servidor fecha A, mas o close nunca chega ao app de A')
  before = A.client.connections
  const client = A.client as any
  const real = client.ws as WebSocket
  // O app passa a olhar para um socket "aberto" que não faz nada; o real fecha e o servidor vê a saída.
  client.ws = { readyState: WebSocket.OPEN, send() {}, close() {} }
  real.close(1000)
  meter.reset()
  const t2 = Date.now()
  const offline = await until(() => !B.client.state.members.some((m) => m.peerId === A.client.peerId), 5000)
  note(`caso 2: B vê A offline=${offline}`)
  const detected2 = await until(() => A.client.status !== 'conectado' || A.client.connections > before, DETECT_MS)
  note(`<<< caso 2: A percebeu=${detected2} depois de ${Date.now() - t2} ms; status=${A.client.status}; buraco em B=${meter.gap()} ms; A ainda acha que transmite=${A.session.local !== null}; A vê B na sala=${A.session.links.has(B.client.peerId)}`)
  check(`caso 2: A percebe a queda em até ${DETECT_MS / 1000} s`, detected2, `status ${A.client.status} após ${Math.round((Date.now() - t2) / 1000)} s`)
  check('caso 2: B não fica mais de 60 s sem vídeo de A', meter.gap() < DETECT_MS, `buraco ${meter.gap()} ms`)
  meter.stop()
  closeAll(all)
  finish()
}

run().catch(fail)
