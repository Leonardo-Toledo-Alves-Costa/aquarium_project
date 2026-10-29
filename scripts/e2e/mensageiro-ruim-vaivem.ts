// mensageiro-ruim: os dois transmitem e se assistem (colisão de ofertas) com sinais atrasados e
// fora de ordem, e B liga/desliga "Assistir" em rajada. No fim, cada um recebe o outro?
import { check, closeAll, finish, fail, fps, isLive, makeStream, newGroup, note, person, signaling, sleep, tamperSignalsBy, until, verboseLogs, type Person } from './lib'

verboseLogs()

const rand = (a: number, b: number): number => Math.round(a + Math.random() * (b - a))

async function receiving(B: Person, A: Person, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (B.session.links.get(A.client.peerId)?.remote?.getVideoTracks().length && (await fps(B, A)) > 5) return true
    await sleep(300)
  }
  return false
}

async function run(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    note(`--- rodada ${round}`)
    const keys = await newGroup()
    const A = person(keys, 'Ana')
    const B = person(keys, 'Beto')
    await until(() => A.client.status === 'conectado' && B.client.status === 'conectado')
    const room = A.client.state.rooms[0]
    A.client.join(room.id)
    B.client.join(room.id)
    await until(() => A.session.links.size === 1 && B.session.links.size === 1)
    tamperSignalsBy(A, () => rand(200, 2000))
    tamperSignalsBy(B, () => rand(200, 2000))
    await Promise.all([A.session.startStreaming(makeStream(0), 'A'), B.session.startStreaming(makeStream(180), 'B')])
    await until(() => isLive(B, A) && isLive(A, B))
    A.session.watch(B.client.peerId, true)
    B.session.watch(A.client.peerId, true)
    await sleep(rand(100, 1500))
    // rajada de B: desliga, liga, desliga, liga
    for (const on of [false, true, false, true]) {
      B.session.watch(A.client.peerId, on)
      await sleep(150)
    }
    await sleep(4000) // tudo que estava atrasado já chegou
    const ab = await receiving(B, A, 15000)
    const ba = await receiving(A, B, 5000)
    const st = `A=${signaling(A, B)} B=${signaling(B, A)} B.iWatch=${B.session.links.get(A.client.peerId)?.iWatch} A.theyWatch=${A.session.links.get(B.client.peerId)?.theyWatch}`
    check(`rodada ${round}: B recebe A depois da rajada`, ab, st)
    check(`rodada ${round}: A recebe B`, ba, st)
    closeAll([A, B])
  }
  finish()
}

run().catch(fail)
