// Persona simultaneo: malha de 5; todos começam a transmitir e a assistir todos, e logo em seguida
// (DELAY ms) todos caem do servidor juntos, no meio das negociações. Sinais se perdem; vários pares
// ficam fora de 'stable' e os dois lados de cada um refazem a ligação quase ao mesmo tempo.
// Esperado: em até 40 s todos os pares casados e com vídeo; no máximo 2 "refazendo" por par;
// nenhuma "refazendo" depois de convergir.
import { check, closeAll, finish, fail, sleep, until } from './lib'
import { realDrop } from './instavel-util'
import { allStream, allWatch, everyPair, linkTable, mesh, mismatched, note, recovers, summary, waitVideo } from './simultaneo-util'

const DELAYS = [150, 400]

async function round(delay: number): Promise<void> {
  const all = await mesh(['Miguel', 'Bia', 'Rafa', 'Leo', 'Duda'])
  const t = Date.now()
  note(`>>> todos transmitem e assistem; ${delay} ms depois todos caem do servidor`)
  void allStream(all)
  allWatch(all)
  await sleep(delay)
  for (const p of all) realDrop(p)
  const ok = await until(() => mismatched(all).length === 0 && everyPair(all).every(([v, s]) => !!v.session.links.get(s.client.peerId)?.remote), 40000)
  const tc = Date.now()
  const missing = await waitVideo(everyPair(all), 10000)
  note(`<<< ${delay} ms: convergiu=${ok} em ${tc - t} ms`)
  check(`${delay} ms: pontas casadas e "remote" em todos os pares em até 40 s`, ok, mismatched(all).join('; ') + ' || ' + linkTable(all))
  check(`${delay} ms: vídeo em todos os pares em até 10 s depois de casar`, missing.length === 0, missing.join('; '))
  await sleep(15000)
  note(summary(`${delay} ms`, t))
  const r = recovers(t)
  const perPair = new Map<string, number>()
  for (const e of r) {
    const key = [e.owner, e.details?.name].sort().join('-')
    perPair.set(key, (perPair.get(key) ?? 0) + 1)
  }
  const many = [...perPair].filter(([, n]) => n > 2)
  check(`${delay} ms: no máximo 2 "refazendo" por par`, many.length === 0, many.map(([k, n]) => `${k}:${n}`).join(', '))
  check(`${delay} ms: nada refeito depois de convergir`, recovers(tc).length === 0, recovers(tc).map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))
  const end = await waitVideo(everyPair(all), 3000)
  check(`${delay} ms: vídeo em todos os pares no fim`, end.length === 0, end.join('; '))
  closeAll(all)
  await sleep(2000)
}

async function run(): Promise<void> {
  for (const d of DELAYS) await round(d)
  finish()
}

run().catch(fail)
