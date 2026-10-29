// Persona apressado: entrar e sair da sala em rajada, trocar de sala enquanto conecta,
// e a espera de 30 s por quem sumiu do servidor quando alguém troca de sala ou sai de verdade.
import { check, closeAll, finish, fail, fps, isLive, makeStream, newGroup, note, person, sleep, until, type Person } from './lib'
import { realDrop } from './instavel-util'
import { countLogs, inboundKbps, linkInfo, pair, since, snapshot } from './apressado-util'

const ONLY = new Set<string>([]) // vazio: todos

function want(name: string): boolean {
  return ONLY.size === 0 || ONLY.has(name)
}

/** Segura `p` fora do servidor (queda real, sem nova tentativa) até chamar a função devolvida. */
function holdOffline(p: Person): () => void {
  const c = p.client as any
  c.connect = () => {}
  realDrop(p, 1006)
  return () => {
    delete c.connect
    c.connect()
  }
}

async function trio(): Promise<{ A: Person; B: Person; C: Person; r1: string; r2: string }> {
  const keys = await newGroup()
  const A = person(keys, 'Miguel')
  const B = person(keys, 'Bia')
  const C = person(keys, 'Rafa')
  await until(() => [A, B, C].every((p) => p.client.status === 'conectado'))
  const [r1, r2] = [A.client.state.rooms[0].id, A.client.state.rooms[1].id]
  A.client.join(r1)
  C.client.join(r2)
  await until(() => A.client.me?.roomId === r1 && C.client.me?.roomId === r2)
  await A.session.startStreaming(makeStream(0), 'Jogo A')
  await C.session.startStreaming(makeStream(180), 'Jogo C')
  await until(() => isLive(B, A) && isLive(B, C))
  return { A, B, C, r1, r2 }
}

async function run(): Promise<void> {
  countLogs(true)

  for (const endInside of [false, true]) {
    const tag = `entra e sai 5x em menos de 1 s, termina ${endInside ? 'dentro' : 'fora'}`
    if (!want('entra-sai')) break
    note(`>>> ${tag}`)
    const { A, B, r1 } = await trio()
    const snap = snapshot()
    for (let i = 0; i < 5; i++) {
      B.client.join(r1)
      await sleep(150 + Math.random() * 300)
      B.client.join(null)
      await sleep(100 + Math.random() * 200)
    }
    if (endInside) B.client.join(r1)
    await sleep(6000)
    if (endInside) {
      B.session.watch(A.client.peerId, true)
      const ok = await until(() => !!B.session.links.get(A.client.peerId)?.remote, 10000)
      check(`${tag}: B assiste A`, ok && (await fps(B, A)) > 5, linkInfo(B, A))
      check(`${tag}: uma ligação de cada lado`, A.session.links.size === 1 && B.session.links.size === 1, `A ${A.session.links.size}, B ${B.session.links.size}`)
    } else {
      check(`${tag}: A sem ligação com B`, !A.session.links.has(B.client.peerId), linkInfo(A, B))
      check(`${tag}: B sem ligações`, B.session.links.size === 0, linkInfo(B, A))
      check(`${tag}: ninguém fantasma em A`, A.session.missingMembers.length === 0)
    }
    check(`${tag}: sem refazer a conexão`, since(snap, 'refazendo a conexão') === 0, `${since(snap, 'refazendo a conexão')} vezes`)
    closeAll([A, B])
  }

  if (want('troca')) {
    const tag = 'troca de sala a cada 300 ms (6x), termina na sala de C'
    note(`>>> ${tag}`)
    const { A, B, C, r1, r2 } = await trio()
    const snap = snapshot()
    for (let i = 0; i < 6; i++) {
      B.client.join(i % 2 === 0 ? r1 : r2)
      if (i === 0) B.session.watch(A.client.peerId, true)
      await sleep(300)
    }
    await sleep(5000)
    B.session.watch(C.client.peerId, true)
    const ok = await until(() => !!B.session.links.get(C.client.peerId)?.remote, 10000)
    await sleep(2000)
    check(`${tag}: B assiste C`, ok && (await fps(B, C)) > 5, linkInfo(B, C))
    check(`${tag}: B sem ligação com A`, !B.session.links.has(A.client.peerId) && !A.session.links.has(B.client.peerId), `${linkInfo(B, A)} / ${linkInfo(A, B)}`)
    check(`${tag}: A não envia nada`, [...A.session.links.values()].every((l) => l.senders.length === 0), `${A.session.links.size} ligações`)
    check(`${tag}: sem refazer a conexão`, since(snap, 'refazendo a conexão') === 0, `${since(snap, 'refazendo a conexão')} vezes`)
    closeAll([A, B, C])
  }

  if (want('fora-troca')) {
    const tag = 'A cai do servidor e B troca de sala logo depois'
    note(`>>> ${tag}`)
    const { A, B, C, r1, r2 } = await trio()
    B.client.join(r1)
    await until(() => B.session.links.has(A.client.peerId))
    B.session.watch(A.client.peerId, true)
    await until(() => !!B.session.links.get(A.client.peerId)?.remote)
    await sleep(1500)
    const back = holdOffline(A)
    await until(() => !B.client.state.members.some((m) => m.peerId === A.client.peerId), 5000)
    await sleep(300)
    B.client.join(r2)
    await until(() => B.client.me?.roomId === r2)
    await sleep(3000)
    const kbps = await inboundKbps(B, A)
    const ghosts = B.session.missingMembers.map((m) => `${m.name}${m.streaming ? ' AO VIVO' : ''}`)
    note(`<<< ${tag}: ${kbps} kbps de A; fantasmas na sala nova de B: ${ghosts.join(',') || '-'}; ${linkInfo(B, A)}`)
    check(`${tag}: B fechou a ligação com A`, !B.session.links.has(A.client.peerId), linkInfo(B, A))
    check(`${tag}: A não aparece na sala nova de B`, ghosts.length === 0, ghosts.join(','))
    check(`${tag}: B não recebe mais vídeo de A`, kbps < 50, `${kbps} kbps`)
    back()
    await until(() => A.client.status === 'conectado')
    await sleep(3000)
    check(`${tag}: depois que A volta, B não está ligado a A`, !B.session.links.has(A.client.peerId) && !A.session.links.has(B.client.peerId), `${linkInfo(B, A)} / ${linkInfo(A, B)}`)
    void C
    closeAll([A, B, C])
  }

  if (want('fora-sai')) {
    const tag = 'A cai do servidor e B sai da sala'
    note(`>>> ${tag}`)
    const { A, B } = await pair(true, true)
    const back = holdOffline(A)
    await until(() => !B.client.state.members.some((m) => m.peerId === A.client.peerId), 5000)
    B.client.join(null)
    await sleep(3000)
    check(`${tag}: B fechou a ligação com A`, !B.session.links.has(A.client.peerId), linkInfo(B, A))
    back()
    await until(() => A.client.status === 'conectado')
    await sleep(3000)
    check(`${tag}: A fechou a ligação com B`, !A.session.links.has(B.client.peerId), linkInfo(A, B))
    closeAll([A, B])
  }

  if (want('fecha-app')) {
    const tag = 'quem transmite fecha o app de vez'
    note(`>>> ${tag}`)
    const { A, B } = await pair(true, true)
    const t = Date.now()
    closeAll([A])
    const gone = await until(() => !B.session.links.has(A.client.peerId) && B.session.missingMembers.length === 0, 40000)
    const ms = Date.now() - t
    note(`<<< ${tag}: fantasma por ${ms} ms`)
    check(`${tag}: some da tela de B em até 5 s`, gone && ms < 5000, `${ms} ms (${gone ? 'sumiu' : 'não sumiu'})`)
    closeAll([B])
  }

  if (want('fecha-sem-avisar')) {
    const tag = 'quem transmite some sem fechar a ligação (app travado/encerrado à força)'
    note(`>>> ${tag}`)
    const { A, B } = await pair(true, true)
    const t = Date.now()
    // só o servidor percebe; a ligação P2P fica sem resposta
    A.client.close()
    for (const l of A.session.links.values()) for (const s of l.senders) void s.replaceTrack(null)
    const gone = await until(() => !B.session.links.has(A.client.peerId) && B.session.missingMembers.length === 0, 45000)
    const ms = Date.now() - t
    note(`<<< ${tag}: fantasma por ${ms} ms; ${linkInfo(B, A)}`)
    check(`${tag}: some da tela de B`, gone, `${ms} ms`)
    closeAll([A, B])
  }

  finish()
}

run().catch(fail)
