// Persona instavel: o WebSocket de alguém pisca (a ligação P2P continua boa).
// Mede quanto tempo quem assiste fica sem quadros. Com a mídia funcionando, o vídeo não deveria parar.
import { check, closeAll, dropSignaling, finish, fail, isLive, makeStream, newGroup, note, person, sleep, until } from './lib'
import { frameMeter, realClose, verboseLogs } from './instavel-util'

const MAX_GAP_MS = 2000

async function run(): Promise<void> {
  verboseLogs()
  const keys = await newGroup()
  const A = person(keys, 'Miguel')
  const B = person(keys, 'Bia')
  const all = [A, B]
  check('conectam', await until(() => all.every((p) => p.client.status === 'conectado')))
  const room = A.client.state.rooms[0]
  for (const p of all) p.client.join(room.id)
  check('na sala', await until(() => all.every((p) => p.session.links.size === 1)))
  await A.session.startStreaming(makeStream(0), 'Jogo')
  await until(() => isLive(B, A))
  B.session.watch(A.client.peerId, true)
  check('B recebe A', await until(() => !!B.session.links.get(A.client.peerId)?.remote))
  const meter = frameMeter(B, A)
  await sleep(3000)

  const cases: [string, () => void, typeof A][] = [
    ['queda 1006 de quem transmite (sem o servidor perceber)', () => dropSignaling(A, 1006), A],
    ['queda 1001 de quem transmite (sem o servidor perceber)', () => dropSignaling(A, 1001), A],
    ['close real 4000 de quem transmite (servidor percebe; 1000 agora é saída de propósito)', () => realClose(A, 4000), A],
    ['queda 1006 de quem assiste', () => dropSignaling(B, 1006), B],
    ['close real 4000 de quem assiste', () => realClose(B, 4000), B]
  ]
  for (const [name, act, who] of cases) {
    meter.reset()
    note('>>> ' + name)
    const before = who.client.connections
    act()
    await until(() => who.client.connections > before && who.client.status === 'conectado', 20000)
    await until(() => !!B.session.links.get(A.client.peerId)?.remote, 20000)
    await sleep(5000)
    const gap = meter.gap()
    note(`<<< ${name}: maior buraco sem quadros em B = ${gap} ms, ligações usadas = ${meter.linkCount()}`)
    check(`${name}: vídeo em B sem buraco > ${MAX_GAP_MS} ms`, gap <= MAX_GAP_MS, `buraco ${gap} ms, ligações ${meter.linkCount()}`)
    check(`${name}: a ligação P2P (que estava boa) é mantida`, meter.linkCount() === 1, `ligações usadas ${meter.linkCount()}`)
    await sleep(2000)
  }
  meter.stop()
  closeAll(all)
  finish()
}

run().catch(fail)
