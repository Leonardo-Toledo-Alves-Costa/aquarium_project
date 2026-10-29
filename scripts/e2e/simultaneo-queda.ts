// Persona simultaneo: malha de 5, todos transmitindo e assistindo todos; todos caem do servidor juntos.
// Rodada 1: queda real de todos ao mesmo tempo (o servidor vê todos saírem).
// Rodada 2: queda real de todos + duas ligações P2P fechadas no mesmo instante.
// Rodada 3: socket de todos congelado (nada entra nem sai) até o app perceber (20 s) e reconectar.
// Esperado: o vídeo continua (as ligações P2P não dependem do servidor), nenhuma ligação é refeita
// sem motivo, e no fim cada par tem as duas pontas casadas e vídeo chegando.
import { check, closeAll, finish, fail, killPeer, sleep, until } from './lib'
import { frameMeter, freezeSignaling, realDrop } from './instavel-util'
import { allStream, allWatch, everyPair, linkTable, mesh, mismatched, note, recovers, summary, waitVideo } from './simultaneo-util'

async function run(): Promise<void> {
  const all = await mesh(['Miguel', 'Bia', 'Rafa', 'Leo', 'Duda'])
  const [A, B, C, D, E] = all
  await allStream(all)
  allWatch(all)
  check('vídeo em todos os pares antes', (await waitVideo(everyPair(all), 20000)).length === 0)
  const meters = [frameMeter(B, A), frameMeter(A, B), frameMeter(E, C), frameMeter(C, D)]
  const ids = (): string => all.map((p) => [...p.session.links.values()].map((l) => l.id).join(',')).join('|')

  // --- rodada 1 ---
  await sleep(2000)
  let before = ids()
  let conns = all.map((p) => p.client.connections)
  for (const m of meters) m.reset()
  let t = Date.now()
  note('>>> rodada 1: queda real de todos ao mesmo tempo')
  for (const p of all) realDrop(p)
  check('r1: todos reconectam', await until(() => all.every((p, i) => p.client.status === 'conectado' && p.client.connections > conns[i]), 20000))
  await sleep(8000)
  note(summary('r1', t) + ` buracos=${meters.map((m) => m.gap()).join(',')} ms`)
  check('r1: nenhuma ligação refeita', recovers(t).length === 0, recovers(t).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))
  check('r1: as mesmas ligações de antes', ids() === before)
  check('r1: vídeo sem buraco maior que 2 s', meters.every((m) => m.gap() < 2000), meters.map((m) => m.gap()).join(','))
  let missing = await waitVideo(everyPair(all), 10000)
  check('r1: vídeo em todos os pares no fim', missing.length === 0, missing.join('; '))
  check('r1: pontas casadas', mismatched(all).length === 0, mismatched(all).join('; '))

  // --- rodada 2 ---
  await sleep(11000)
  conns = all.map((p) => p.client.connections)
  t = Date.now()
  note('>>> rodada 2: queda real de todos + A-B e C-D fechadas dos dois lados no mesmo instante')
  for (const p of all) realDrop(p)
  killPeer(A, B)
  killPeer(B, A)
  killPeer(C, D)
  killPeer(D, C)
  const conv = await until(() => mismatched(all).length === 0, 30000)
  const tc = Date.now()
  note(`<<< r2: convergiu=${conv} em ${tc - t} ms; ${linkTable(all)}`)
  check('r2: pontas casadas de novo em até 30 s', conv, mismatched(all).join('; ') + ' || ' + linkTable(all))
  missing = await waitVideo(everyPair(all), 15000)
  check('r2: vídeo em todos os pares no fim', missing.length === 0, missing.join('; '))
  await sleep(10000)
  note(summary('r2', t))
  check('r2: no máximo 4 "refazendo" (as duas pontas de A-B e C-D)', recovers(t).length <= 4, recovers(t).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))
  check('r2: nada refeito depois de convergir', recovers(tc).length === 0, recovers(tc).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))

  // --- rodada 3 ---
  await sleep(2000)
  before = ids()
  conns = all.map((p) => p.client.connections)
  for (const m of meters) m.reset()
  t = Date.now()
  note('>>> rodada 3: socket de todos congelado ao mesmo tempo')
  const unfreeze: ((() => void) | null)[] = all.map(freezeSignaling)
  // Cada um volta ao normal assim que percebe a queda (senão o socket novo também ficaria surdo).
  const back = await until(() => {
    all.forEach((p, i) => {
      if (unfreeze[i] && p.client.status !== 'conectado') {
        unfreeze[i]!()
        unfreeze[i] = null
      }
    })
    return all.every((p, i) => p.client.connections > conns[i] && p.client.status === 'conectado')
  }, 45000)
  note(`<<< r3: todos reconectaram=${back} em ${Date.now() - t} ms`)
  for (const u of unfreeze) u?.()
  check('r3: todos percebem e reconectam em até 45 s', back, all.map((p) => `${p.name}:${p.client.status}`).join(' '))
  await sleep(8000)
  note(summary('r3', t) + ` buracos=${meters.map((m) => m.gap()).join(',')} ms`)
  check('r3: nenhuma ligação refeita', recovers(t).length === 0, recovers(t).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))
  check('r3: as mesmas ligações de antes', ids() === before)
  check('r3: vídeo sem buraco maior que 2 s', meters.every((m) => m.gap() < 2000), meters.map((m) => m.gap()).join(','))
  missing = await waitVideo(everyPair(all), 10000)
  check('r3: vídeo em todos os pares no fim', missing.length === 0, missing.join('; '))
  check('r3: pontas casadas', mismatched(all).length === 0, mismatched(all).join('; '))

  for (const m of meters) m.stop()
  closeAll(all)
  finish()
}

run().catch(fail)
