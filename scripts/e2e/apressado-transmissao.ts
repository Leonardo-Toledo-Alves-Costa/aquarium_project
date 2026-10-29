// Persona apressado: liga e desliga a transmissão em rajada com alguém assistindo.
// Cada ciclo deixa um transceptor novo (removeTrack não libera o antigo) e a oferta cresce.
import { check, closeAll, finish, fail, fps, isLive, makeStream, note, sleep, until } from './lib'
import { countLogs, linkInfo, logCount, pair, since, snapshot } from './apressado-util'

const CYCLES = Number(new URLSearchParams(location.search).get('n') ?? 25)

async function run(): Promise<void> {
  countLogs(false)
  const { A, B } = await pair(true, true)
  check('B recebe A no começo', (await fps(B, A)) > 5)
  const snap = snapshot()
  note(`antes: ${linkInfo(A, B)}`)
  for (let i = 0; i < CYCLES; i++) {
    A.session.stopStreaming()
    await sleep(150)
    await A.session.startStreaming(makeStream(i * 10), 'Jogo')
    await sleep(150)
    if (i % 5 === 4) note(`ciclo ${i + 1}: ${linkInfo(A, B)}`)
  }
  note('rajada terminou; esperando assentar')
  const ok = await until(() => isLive(B, A) && !!B.session.links.get(A.client.peerId)?.remote?.getVideoTracks().length, 20000)
  await sleep(3000)
  const f = await fps(B, A)
  note(`depois: ${linkInfo(A, B)} / ${linkInfo(B, A)}`)
  note(`A: status=${A.client.status} erro=${A.client.error} conexões=${A.client.connections}`)
  check(`depois de ${CYCLES} ciclos liga/desliga, B volta a receber A`, ok && f > 5, `fps ${f}; ${linkInfo(B, A)}`)
  check('ninguém refez a conexão', since(snap, 'refazendo a conexão') === 0, `${since(snap, 'refazendo a conexão')} vezes`)
  check('A não perdeu o servidor', A.client.connections === 1 && B.client.connections === 1, `A ${A.client.connections}, B ${B.client.connections}`)
  const tx = A.session.links.get(B.client.peerId)?.pc.getTransceivers().length ?? 0
  check('transceptores não acumulam', tx <= 4, `${tx} transceptores, sdp ${A.session.links.get(B.client.peerId)?.pc.localDescription?.sdp.length}`)
  note(`logs: refazendo=${logCount('refazendo a conexão')} repetir-assistir=${logCount('o vídeo não veio; repito o pedido para assistir')} repetir-parar=${logCount('o vídeo continua vindo sem eu assistir; repito o pedido para parar')} sinal-problema=${logCount('sinal com problema')} falha-negociar=${logCount('falha ao negociar')} ws-fechado=${logCount('websocket fechado')}`)
  closeAll([A, B])
  finish()
}

run().catch(fail)
