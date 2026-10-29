// Persona instavel: quedas reais (o servidor percebe) em sequência, no meio do join e no meio da negociação.
// Cada cenário usa um grupo novo com duas pessoas: A transmite, B assiste.
import { check, closeAll, finish, fail, isLive, killPeer, makeStream, newGroup, note, person, sleep, until, type Person } from './lib'
import { frameMeter, realDrop, verboseLogs } from './instavel-util'

const RECOVER_MS = 20_000

async function setup(streaming = true, watching = true): Promise<{ A: Person; B: Person; roomId: string }> {
  const keys = await newGroup()
  const A = person(keys, 'Miguel')
  const B = person(keys, 'Bia')
  await until(() => [A, B].every((p) => p.client.status === 'conectado'))
  const roomId = A.client.state.rooms[0].id
  B.client.join(roomId)
  await until(() => B.client.me?.roomId === roomId)
  if (streaming) {
    A.client.join(roomId)
    await until(() => A.session.links.size === 1 && B.session.links.size === 1)
    await A.session.startStreaming(makeStream(0), 'Jogo')
    await until(() => isLive(B, A))
    if (watching) {
      B.session.watch(A.client.peerId, true)
      await until(() => !!B.session.links.get(A.client.peerId)?.remote)
      await sleep(1500)
    }
  }
  return { A, B, roomId }
}

async function recovered(A: Person, B: Person): Promise<boolean> {
  const meter = frameMeter(B, A)
  const t = Date.now()
  const ok = await until(() => Date.now() - t > 1500 && A.client.status === 'conectado' && B.client.status === 'conectado' && meter.sinceLast() < 400, RECOVER_MS)
  meter.stop()
  return ok
}

function state(A: Person, B: Person): string {
  const bl = B.session.links.get(A.client.peerId)
  const al = A.session.links.get(B.client.peerId)
  return `A:${A.client.status}/${A.client.error ?? '-'} sala=${A.client.me?.roomId} live=${!!A.session.local}; ` +
    `B:${B.client.status} vê A ao vivo=${isLive(B, A)}; linkB=${bl?.id}/${bl?.pc.connectionState} iWatch=${bl?.iWatch} remote=${!!bl?.remote}; ` +
    `linkA=${al?.id}/${al?.pc.connectionState} theyWatch=${al?.theyWatch} senders=${al?.senders.length}`
}

async function run(): Promise<void> {
  verboseLogs()

  {
    note('>>> 1. uma queda real de quem transmite')
    const { A, B } = await setup()
    const meter = frameMeter(B, A)
    await sleep(500)
    meter.reset()
    realDrop(A, 1006)
    await until(() => A.client.connections > 1 && meter.sinceLast() < 300 && !!B.session.links.get(A.client.peerId)?.remote, RECOVER_MS)
    await sleep(2000)
    note(`<<< 1: buraco ${meter.gap()} ms; ${state(A, B)}`)
    check('1. queda real de quem transmite: vídeo volta', meter.gap() < RECOVER_MS, `buraco ${meter.gap()} ms`)
    meter.stop()
    closeAll([A, B])
  }

  for (const [n, spacing] of [
    [5, 700],
    [5, 150]
  ] as const) {
    note(`>>> 2. ${n} quedas reais de quem transmite a cada ${spacing} ms`)
    const { A, B } = await setup()
    for (let i = 0; i < n; i++) {
      realDrop(A, [1006, 1001, 1011, 1000, 1006][i % 5])
      await sleep(spacing)
    }
    const ok = await recovered(A, B)
    note(`<<< 2 (${spacing} ms): ${state(A, B)}`)
    check(`2. rajada de ${n} quedas a cada ${spacing} ms: A volta e B recebe`, ok, state(A, B))
    check(`2. rajada a cada ${spacing} ms: A não foi recusado`, A.client.status !== 'recusado', String(A.client.error))
    closeAll([A, B])
  }

  {
    note('>>> 3. queda logo depois do join (A entra na sala e cai)')
    const { A, B, roomId } = await setup(false)
    A.client.join(roomId)
    realDrop(A, 1006)
    await until(() => A.client.status === 'conectado' && A.client.me?.roomId === roomId, RECOVER_MS)
    await A.session.startStreaming(makeStream(30), 'Jogo')
    B.session.watch(A.client.peerId, true)
    const ok = await recovered(A, B)
    note(`<<< 3: ${state(A, B)}`)
    check('3. queda durante o join: A fica na sala e B o assiste', ok && A.client.me?.roomId === roomId, state(A, B))
    closeAll([A, B])
  }

  {
    note('>>> 3b. queda antes do join sair (join pedido enquanto reconecta)')
    const { A, B, roomId } = await setup(false)
    realDrop(A, 1006)
    A.client.join(roomId)
    await until(() => A.client.status === 'conectado', RECOVER_MS)
    await A.session.startStreaming(makeStream(30), 'Jogo')
    await until(() => isLive(B, A), 5000)
    B.session.watch(A.client.peerId, true)
    const ok = await recovered(A, B)
    note(`<<< 3b: ${state(A, B)}`)
    check('3b. join durante a reconexão: A entra na sala e B o assiste', ok && A.client.me?.roomId === roomId, state(A, B))
    closeAll([A, B])
  }

  for (const delay of [0, 20, 60]) {
    note(`>>> 4. B pede para assistir e cai ${delay} ms depois (oferta/resposta no meio)`)
    const { A, B } = await setup(true, false)
    B.session.watch(A.client.peerId, true)
    if (delay) await sleep(delay)
    realDrop(B, 1006)
    const ok = await recovered(A, B)
    note(`<<< 4 (${delay} ms): ${state(A, B)}`)
    check(`4. queda de quem assiste ${delay} ms após pedir: B passa a receber`, ok, state(A, B))
    closeAll([A, B])
  }

  for (const delay of [0, 20, 60]) {
    note(`>>> 5. A começa a transmitir para quem já pediu e cai ${delay} ms depois`)
    const { A, B } = await setup(true)
    A.session.stopStreaming()
    await until(() => !isLive(B, A))
    await A.session.startStreaming(makeStream(60), 'Jogo')
    if (delay) await sleep(delay)
    realDrop(A, 1006)
    const ok = await recovered(A, B)
    note(`<<< 5 (${delay} ms): ${state(A, B)}`)
    check(`5. queda de quem transmite ${delay} ms após começar: B volta a receber`, ok, state(A, B))
    closeAll([A, B])
  }

  {
    note('>>> 6. killPeer e queda do servidor ao mesmo tempo (do lado de quem assiste)')
    const { A, B } = await setup()
    killPeer(B, A)
    realDrop(B, 1006)
    const ok = await recovered(A, B)
    note(`<<< 6: ${state(A, B)}`)
    check('6. killPeer + queda simultânea: B volta a receber', ok, state(A, B))
    closeAll([A, B])
  }

  finish()
}

run().catch(fail)
