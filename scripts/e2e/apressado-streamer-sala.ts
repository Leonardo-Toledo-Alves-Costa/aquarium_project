// Persona apressado: quem transmite troca de sala em rajada (a transmissão vai junto).
import { check, closeAll, finish, fail, fps, isLive, makeStream, newGroup, note, person, sleep, until } from './lib'
import { countLogs, inboundKbps, linkInfo, since, snapshot } from './apressado-util'

async function run(): Promise<void> {
  countLogs(true)
  for (const endIn of ['r1', 'r2'] as const) {
    const tag = `A transmite e troca de sala 5x a cada 300 ms, termina em ${endIn === 'r1' ? 'na sala de B' : 'na sala de C'}`
    note(`>>> ${tag}`)
    const keys = await newGroup()
    const A = person(keys, 'Miguel')
    const B = person(keys, 'Bia')
    const C = person(keys, 'Rafa')
    await until(() => [A, B, C].every((p) => p.client.status === 'conectado'))
    const [r1, r2] = [A.client.state.rooms[0].id, A.client.state.rooms[1].id]
    A.client.join(r1)
    B.client.join(r1)
    C.client.join(r2)
    await until(() => B.session.links.has(A.client.peerId))
    await A.session.startStreaming(makeStream(0), 'Jogo')
    await until(() => isLive(B, A))
    B.session.watch(A.client.peerId, true)
    await until(() => !!B.session.links.get(A.client.peerId)?.remote)
    await sleep(1500)
    const snap = snapshot()
    const seq = endIn === 'r1' ? [r2, r1, r2, r1, r2, r1] : [r2, r1, r2, r1, r2]
    for (const r of seq) {
      A.client.join(r)
      await sleep(300)
    }
    await sleep(6000)
    const ckbps = await inboundKbps(C, A)
    note(`<<< ${tag}: ${linkInfo(B, A)} / ${linkInfo(C, A)} / A ligações=${A.session.links.size}; C recebe ${ckbps} kbps`)
    check(`${tag}: A continua transmitindo`, !!A.session.local && isLive(B, A) && isLive(C, A))
    if (endIn === 'r1') {
      check(`${tag}: B volta a receber A sozinho`, (await until(() => !!B.session.links.get(A.client.peerId)?.remote, 8000)) && (await fps(B, A)) > 5, linkInfo(B, A))
      check(`${tag}: C sem ligação com A`, !C.session.links.has(A.client.peerId) && ckbps < 50, linkInfo(C, A))
    } else {
      check(`${tag}: B sem ligação com A`, !B.session.links.has(A.client.peerId), linkInfo(B, A))
      check(`${tag}: C não recebe A sem pedir`, ckbps < 50, `${ckbps} kbps`)
      C.session.watch(A.client.peerId, true)
      check(`${tag}: C assiste A quando pede`, (await until(() => !!C.session.links.get(A.client.peerId)?.remote, 8000)) && (await fps(C, A)) > 5, linkInfo(C, A))
    }
    check(`${tag}: uma ligação só em A`, A.session.links.size === 1, `${A.session.links.size}`)
    check(`${tag}: sem refazer a conexão`, since(snap, 'refazendo a conexão') === 0, `${since(snap, 'refazendo a conexão')} vezes`)
    closeAll([A, B, C])
  }
  finish()
}

run().catch(fail)
