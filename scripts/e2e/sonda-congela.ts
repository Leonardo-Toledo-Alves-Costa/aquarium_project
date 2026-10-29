// Sonda: a janela congela no R2 do simultaneo-restart (todos reiniciam o ICE, param e voltam a
// transmitir juntos)? Um relógio imprime a cada 500 ms; se ele parar, a janela travou.
import { finish, fail, makeStream, sleep, type Person } from './lib'
import { allStream, allWatch, everyPair, mesh, note, waitVideo } from './simultaneo-util'

function restartAll(all: Person[]): void {
  for (const p of all) for (const l of p.session.links.values()) l.pc.restartIce()
}

async function run(): Promise<void> {
  let ticks = 0
  setInterval(() => note(`relógio ${++ticks}`), 500)
  const all = await mesh(['Miguel', 'Bia', 'Rafa', 'Leo', 'Duda'])
  await allStream(all)
  allWatch(all)
  note(`vídeo antes: faltando ${(await waitVideo(everyPair(all), 20000)).length}`)
  await sleep(2000)
  note('>>> restart + stop')
  restartAll(all)
  for (const p of all) p.session.stopStreaming()
  await sleep(200)
  restartAll(all)
  note('>>> voltando a transmitir')
  for (const p of all) {
    note(`start ${p.name}`)
    await p.session.startStreaming(makeStream(Math.random() * 360), p.name)
    note(`start ${p.name} ok`)
  }
  await sleep(10000)
  note(`vídeo depois: faltando ${(await waitVideo(everyPair(all), 10000)).length}`)
  finish()
}

run().catch(fail)
