// Persona apressado: quem transmite troca a janela compartilhada algumas vezes (com áudio), com alguém assistindo.
// Cada troca chama startStreaming de novo, que tira as trilhas e põe novas: a oferta SDP cresce a cada troca.
import { check, closeAll, finish, fail, fps, makeStream, note, sleep, until } from './lib'
import { countLogs, framesMeter, linkInfo, logCount, pair, since, snapshot } from './apressado-util'

const SWITCHES = 7

async function run(): Promise<void> {
  countLogs(true)
  const { A, B } = await pair(false)
  await A.session.startStreaming(makeStream(0, 640, 360, true), 'Jogo')
  await until(() => !!B.client.state.members.find((m) => m.peerId === A.client.peerId)?.streaming)
  B.session.watch(A.client.peerId, true)
  await until(() => !!B.session.links.get(A.client.peerId)?.remote)
  await sleep(1500)
  check('B recebe A no começo', (await fps(B, A)) > 5)
  const snap = snapshot()
  const meter = framesMeter(B, A)
  await sleep(500)
  for (let i = 0; i < SWITCHES; i++) {
    meter.reset()
    await A.session.startStreaming(makeStream(40 * (i + 1), 640, 360, true), `Janela ${i + 2}`)
    await sleep(400)
    await until(() => meter.sinceLast() < 300, 15000)
    await sleep(2000)
    note(`troca ${i + 1}: buraco ${meter.gap()} ms; erro A=${A.client.error}; ${linkInfo(A, B)}`)
    check(`troca de janela ${i + 1}: vídeo volta em menos de 3 s`, meter.gap() < 3000, `buraco ${meter.gap()} ms; sdp ${A.session.links.get(B.client.peerId)?.pc.localDescription?.sdp.length}; erro do servidor: ${A.client.error}`)
  }
  check(`${SWITCHES} trocas de janela sem refazer a conexão`, since(snap, 'refazendo a conexão') === 0, `${since(snap, 'refazendo a conexão')} vezes`)
  check('nenhum erro do servidor na tela de A', A.client.error === null, String(A.client.error))
  check('A não foi desconectado do servidor', A.client.connections === 1, `${A.client.connections} conexões`)
  note(`logs: refazendo=${logCount('refazendo a conexão')} erro-servidor=${logCount('erro do servidor')}`)
  meter.stop()
  closeAll([A, B])
  finish()
}

run().catch(fail)
