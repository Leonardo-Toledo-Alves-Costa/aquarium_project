// Persona simultaneo: reinícios de ICE e negociações ao mesmo tempo nos dois lados.
// R1: malha de 5, todos transmitindo e assistindo; restartIce() nas duas pontas de todos os pares no
//     mesmo instante, 3 vezes seguidas (300 ms entre elas).
// R2: na mesma malha, restartIce() em todos os pares junto com todos parando e voltando a transmitir.
// R3: par novo (A, B): os dois começam a transmitir juntos e a primeira oferta de cada um se perde;
//     os dois ficam em have-local-offer e refazem a ligação ao mesmo tempo ("negociação parada").
// Esperado: R1 e R2 sem nenhuma "refazendo a conexão"; em todos, pontas casadas e vídeo em todos os pares.
import { check, closeAll, finish, fail, makeStream, newGroup, person, signaling, sleep, tamperSignalsBy, until, type Person } from './lib'
import { allStream, allWatch, captureLogs, everyPair, linkTable, mesh, mismatched, note, recovers, summary, waitVideo } from './simultaneo-util'

function restartAll(all: Person[]): void {
  for (const p of all) for (const l of p.session.links.values()) l.pc.restartIce()
}

async function run(): Promise<void> {
  const all = await mesh(['Miguel', 'Bia', 'Rafa', 'Leo', 'Duda'])
  await allStream(all)
  allWatch(all)
  check('vídeo em todos os pares antes', (await waitVideo(everyPair(all), 20000)).length === 0)
  await sleep(2000)

  let t = Date.now()
  note('>>> R1: restartIce nas duas pontas de todos os pares, 3 vezes')
  for (let i = 0; i < 3; i++) {
    restartAll(all)
    await sleep(300)
  }
  let ok = await until(() => mismatched(all).length === 0, 15000)
  check('R1: todos estáveis e casados', ok, mismatched(all).join('; '))
  let missing = await waitVideo(everyPair(all), 10000)
  check('R1: vídeo em todos os pares', missing.length === 0, missing.join('; '))
  await sleep(8000)
  note(summary('R1', t))
  check('R1: nenhuma ligação refeita', recovers(t).length === 0, recovers(t).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))

  await sleep(3000)
  t = Date.now()
  note('>>> R2: restartIce em todos + todos param e voltam a transmitir no mesmo instante')
  restartAll(all)
  for (const p of all) p.session.stopStreaming()
  await sleep(200)
  restartAll(all)
  await allStream(all)
  ok = await until(() => mismatched(all).length === 0, 15000)
  check('R2: todos estáveis e casados', ok, mismatched(all).join('; ') + ' || ' + linkTable(all))
  missing = await waitVideo(everyPair(all), 20000)
  check('R2: vídeo em todos os pares', missing.length === 0, missing.join('; ') + ' || ' + linkTable(all))
  await sleep(8000)
  note(summary('R2', t))
  check('R2: nenhuma ligação refeita', recovers(t).length === 0, recovers(t).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))
  closeAll(all)

  // --- R3 ---
  const keys = await newGroup()
  const A = person(keys, 'Ana')
  const B = person(keys, 'Beto')
  const pair = [A, B]
  captureLogs([...all, ...pair])
  await until(() => pair.every((p) => p.client.status === 'conectado'))
  const room = A.client.state.rooms[0]
  for (const p of pair) p.client.join(room.id)
  await until(() => pair.every((p) => p.session.links.size === 1))
  const lost: string[] = []
  const undo = pair.map((p) => tamperSignalsBy(p, (kind, n) => (kind === 'offer' && n === 0 ? 'drop' : 'pass'), lost))
  t = Date.now()
  note('>>> R3: A e B transmitem e assistem juntos; a primeira oferta de cada um se perde')
  await Promise.all([A.session.startStreaming(makeStream(10), 'A'), B.session.startStreaming(makeStream(200), 'B')])
  A.session.watch(B.client.peerId, true)
  B.session.watch(A.client.peerId, true)
  await sleep(1500)
  note(`R3: estado depois de 1,5 s: A=${signaling(A, B)} B=${signaling(B, A)}; perdidos: ${lost.filter((x) => x.endsWith('drop')).join(',')}`)
  ok = await until(() => mismatched(pair).length === 0 && waitVideoSync(pair), 30000)
  const tc = Date.now()
  missing = await waitVideo(everyPair(pair), 10000)
  note(`<<< R3: casados=${mismatched(pair).length === 0} em ${tc - t} ms; ${linkTable(pair)}`)
  check('R3: pontas casadas', mismatched(pair).length === 0, mismatched(pair).join('; ') + ' || ' + linkTable(pair))
  check('R3: vídeo nos dois sentidos', missing.length === 0, missing.join('; '))
  await sleep(12000)
  note(summary('R3', t))
  check('R3: no máximo 2 "refazendo"', recovers(t).length <= 2, recovers(t).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))
  check('R3: nada refeito depois de convergir', recovers(tc).length === 0, recovers(tc).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))
  for (const u of undo) u()
  closeAll(pair)
  finish()
}

function waitVideoSync(pair: Person[]): boolean {
  return pair.every((v) => pair.every((s) => s === v || !!v.session.links.get(s.client.peerId)?.remote))
}

run().catch(fail)
