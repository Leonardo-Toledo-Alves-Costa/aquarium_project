// Persona apressado: duas abas da mesma pessoa (mesmo peerId) e liga/desliga a transmissão sem esperar,
// conferindo "AO VIVO" fantasma, ligações que sobram e laços de recover.
import { RoomClient } from '../../src/renderer/src/signaling/rooms'
import { RoomSession } from '../../src/renderer/src/rtc/room-session'
import { check, closeAll, DEFAULT_SETTINGS, finish, fail, fps, isLive, makeStream, note, sleep, until, type Person } from './lib'
import { realDrop } from './instavel-util'
import { countLogs, inboundKbps, linkInfo, pair, since, snapshot } from './apressado-util'

declare const SERVER_URL: string

/** Conta quantas vezes a sessão de `p` refez uma ligação. */
function countRecovers(p: Person): () => number {
  const s = p.session as any
  const original = s.recover.bind(s)
  let n = 0
  s.recover = (...args: unknown[]) => {
    const r = original(...args)
    if (r) n++
    return r
  }
  return () => n
}

async function run(): Promise<void> {
  countLogs(true)

  {
    const tag = 'duas abas: a segunda abre com o mesmo peerId enquanto a primeira transmite'
    note(`>>> ${tag}`)
    const { A, B, keys, roomId } = await pair(true, true)
    const recovers = countRecovers(A)
    const client = new RoomClient({ serverUrl: SERVER_URL, keys, peerId: A.client.peerId, name: A.name })
    const A2: Person = { name: 'Miguel2', client, session: new RoomSession(client, DEFAULT_SETTINGS) }
    await until(() => A2.client.status === 'conectado')
    A2.client.join(roomId)
    await until(() => A.client.status === 'recusado', 5000)
    await sleep(2000)
    await A2.session.startStreaming(makeStream(200), 'Aba 2')
    await sleep(1000)
    B.session.watch(A.client.peerId, true)
    const ok = await until(() => !!B.session.links.get(A.client.peerId)?.remote, 10000)
    note(`aba 1: status=${A.client.status} erro=${A.client.error} transmitindo=${!!A.session.local} ligações=${A.session.links.size} ${linkInfo(A, B)}`)
    check(`${tag}: aba 1 é recusada com aviso`, A.client.status === 'recusado' && !!A.client.error, String(A.client.error))
    check(`${tag}: B assiste a aba 2`, ok && (await fps(B, A)) > 5, linkInfo(B, A))
    await sleep(25000)
    note(`aba 1 depois de 25 s: ligações=${A.session.links.size} ${linkInfo(A, B)}; recovers=${recovers()}`)
    check(`${tag}: aba 1 não fica com ligações abertas`, [...A.session.links.values()].every((l) => l.pc.connectionState === 'closed' || l.pc.connectionState === 'new'), linkInfo(A, B))
    check(`${tag}: aba 1 não fica refazendo a ligação sem parar`, recovers() <= 1, `${recovers()} vezes em ~30 s`)
    check(`${tag}: aba 1 para de capturar a tela`, A.session.local === null, `local=${!!A.session.local}`)
    check(`${tag}: B continua assistindo a aba 2`, (await fps(B, A)) > 5, linkInfo(B, A))
    closeAll([A, A2, B])
  }

  for (const withDrop of [false, true]) {
    const tag = `liga/desliga a transmissão 10x sem esperar${withDrop ? ' com queda no meio' : ''}, termina desligado`
    note(`>>> ${tag}`)
    const { A, B } = await pair(true, true)
    const snap = snapshot()
    for (let i = 0; i < 10; i++) {
      void A.session.startStreaming(makeStream(i * 20), 'Jogo')
      if (withDrop && i === 5) realDrop(A, 1006)
      await sleep(30)
      A.session.stopStreaming()
      await sleep(30)
    }
    await sleep(8000)
    const kbps = await inboundKbps(B, A)
    note(`<<< ${tag}: ao vivo para B=${isLive(B, A)} ${kbps} kbps; ${linkInfo(B, A)}`)
    check(`${tag}: B não vê A ao vivo`, !isLive(B, A))
    check(`${tag}: nada de vídeo chegando em B`, kbps < 50 && !B.session.links.get(A.client.peerId)?.remote, `${kbps} kbps; ${linkInfo(B, A)}`)
    check(`${tag}: sem refazer a conexão`, since(snap, 'refazendo a conexão') === 0, `${since(snap, 'refazendo a conexão')} vezes`)
    // volta a transmitir: B volta a assistir sozinho (pediu antes, dentro do prazo)
    await A.session.startStreaming(makeStream(300), 'Jogo')
    const ok = await until(() => !!B.session.links.get(A.client.peerId)?.remote, 10000)
    check(`${tag}: ao voltar a transmitir, B volta a receber`, ok && (await fps(B, A)) > 5, linkInfo(B, A))
    closeAll([A, B])
  }

  finish()
}

run().catch(fail)
