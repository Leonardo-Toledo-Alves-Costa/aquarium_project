// Persona apressado: assistir e parar de assistir alternando, rápido e devagar.
import { check, closeAll, finish, fail, fps, note, sleep, until } from './lib'
import { countLogs, inboundKbps, linkInfo, logCount, pair, since, snapshot } from './apressado-util'

const RETRY_WATCH = 'o vídeo não veio; repito o pedido para assistir'
const RETRY_STOP = 'o vídeo continua vindo sem eu assistir; repito o pedido para parar'

async function run(): Promise<void> {
  countLogs(true)

  for (const [toggles, spacing] of [
    [20, 100],
    [8, 1200]
  ] as const) {
    for (const endOn of [false, true]) {
      const n = endOn ? toggles + 1 : toggles
      const tag = `${n} alternâncias a cada ${spacing} ms, termina ${endOn ? 'assistindo' : 'sem assistir'}`
      note(`>>> ${tag}`)
      const { A, B } = await pair(true, false)
      const snap = snapshot()
      for (let i = 0; i < n; i++) {
        B.session.watch(A.client.peerId, i % 2 === 0)
        await sleep(spacing)
      }
      // espera assentar: o retryWatch tem 3 s, a renegociação é rápida
      await sleep(8000)
      const kbps = await inboundKbps(B, A)
      note(`<<< ${tag}: ${kbps} kbps; ${linkInfo(B, A)} / ${linkInfo(A, B)}; repetir-assistir=${since(snap, RETRY_WATCH)} repetir-parar=${since(snap, RETRY_STOP)} refazendo=${since(snap, 'refazendo a conexão')}`)
      if (endOn) {
        check(`${tag}: B recebe A`, (await fps(B, A)) > 5, linkInfo(B, A))
      } else {
        check(`${tag}: nada de vídeo chegando`, kbps < 50, `${kbps} kbps; ${linkInfo(B, A)}`)
        check(`${tag}: A não envia para B`, A.session.links.get(B.client.peerId)?.senders.length === 0, linkInfo(A, B))
      }
      check(`${tag}: sem refazer a conexão`, since(snap, 'refazendo a conexão') === 0, `${since(snap, 'refazendo a conexão')} vezes`)
      const tx = A.session.links.get(B.client.peerId)?.pc.getTransceivers().length ?? 0
      check(`${tag}: transceptores de A não acumulam`, tx <= 2, `${tx}; sdp ${A.session.links.get(B.client.peerId)?.pc.localDescription?.sdp.length}`)
      check(`${tag}: A sem erro do servidor e sem reconectar`, A.client.error === null && A.client.connections === 1, `erro ${A.client.error}, conexões ${A.client.connections}`)
      closeAll([A, B])
    }
  }
  note(`logs totais: repetir-assistir=${logCount(RETRY_WATCH)} repetir-parar=${logCount(RETRY_STOP)}`)
  finish()
}

run().catch(fail)
