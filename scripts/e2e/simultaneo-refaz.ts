// Persona simultaneo: os dois lados refazem a mesma ligação ao mesmo tempo.
// A e B transmitem e assistem um ao outro; as duas pontas do par são fechadas (killPeer) com um
// intervalo entre elas de 0 a 1,5 s, e cada lado dispara recover() no seu checkHealth.
// Esperado: convergem para um par de ligações casadas (remoteId de cada lado = id do outro),
// vídeo nos dois sentidos, e nenhuma nova "refazendo a conexão" depois que convergem.
import { check, closeAll, finish, fail, killPeer, sleep, until } from './lib'
import { allStream, allWatch, everyPair, linkTable, mesh, mismatched, note, recovers, summary, waitVideo } from './simultaneo-util'

const OFFSETS = [0, 0, 250, 500, 750, 1000, 1500]

async function run(): Promise<void> {
  const all = await mesh(['Miguel', 'Bia'])
  const [A, B] = all
  await allStream(all)
  allWatch(all)
  check('vídeo nos dois sentidos antes', (await waitVideo(everyPair(all), 15000)).length === 0)

  for (const offset of OFFSETS) {
    // recover() vale uma vez a cada 10 s por pessoa: espera o prazo da rodada anterior passar.
    await sleep(11000)
    const t = Date.now()
    note(`>>> rodada ${offset} ms: fecho a ponta de A, e a de B ${offset} ms depois`)
    killPeer(A, B)
    if (offset) await sleep(offset)
    killPeer(B, A)
    const converged = await until(() => mismatched(all).length === 0, 20000)
    const tc = Date.now()
    const missing = await waitVideo(everyPair(all), 10000)
    note(`<<< convergiu=${converged} em ${tc - t} ms; ${linkTable(all)}`)
    check(`rodada ${offset} ms: ligações casadas de novo`, converged, mismatched(all).join('; ') + ' || ' + linkTable(all))
    check(`rodada ${offset} ms: vídeo nos dois sentidos`, missing.length === 0, missing.join('; '))
    await sleep(8000)
    const r = recovers(t)
    note(summary(`rodada ${offset} ms`, t))
    check(`rodada ${offset} ms: no máximo 2 "refazendo" (um por lado)`, r.length <= 2, r.map((e) => `${e.owner}->${e.details?.name}`).join(', '))
    check(`rodada ${offset} ms: nada refeito depois de convergir`, recovers(tc).length === 0, recovers(tc).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))
  }

  closeAll(all)
  finish()
}

run().catch(fail)
