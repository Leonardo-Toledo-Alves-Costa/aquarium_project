// mensageiro-ruim, sem adulterar sinais: o próprio app perde sinais enviados enquanto o WebSocket
// está caído (RoomClient.send descarta). Duas situações reais:
// (1) quem transmite perde a conexão com o servidor no instante em que gera a oferta;
// (2) quem assiste clica "Assistir" enquanto está "reconectando".
import { check, closeAll, dropSignaling, finish, fail, fps, isLive, makeStream, newGroup, note, person, signaling, sleep, until, verboseLogs, type Person } from './lib'

verboseLogs()

async function pair(): Promise<[Person, Person]> {
  const keys = await newGroup()
  const A = person(keys, 'Ana')
  const B = person(keys, 'Beto')
  await until(() => A.client.status === 'conectado' && B.client.status === 'conectado')
  const room = A.client.state.rooms[0]
  A.client.join(room.id)
  B.client.join(room.id)
  await until(() => A.session.links.size === 1 && B.session.links.size === 1)
  return [A, B]
}

async function receiving(B: Person, A: Person, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (B.session.links.get(A.client.peerId)?.remote?.getVideoTracks().length && (await fps(B, A)) > 5) return true
    await sleep(300)
  }
  return false
}

/** Fecha o WebSocket de verdade (o servidor também vê a queda), como um Wi-Fi que caiu. */
function hardDrop(p: Person): void {
  ;((p.client as any).ws as WebSocket).close()
}

async function scenario1(hard: boolean): Promise<void> {
  const label = `queda ${hard ? 'real' : 'simulada'} de A ao gerar a oferta`
  note('--- ' + label)
  const [A, B] = await pair()
  await A.session.startStreaming(makeStream(0), 'Jogo')
  await until(() => isLive(B, A))
  // Quando o pedido de B chega, a conexão de A com o servidor cai (antes da oferta assíncrona sair).
  const off = A.client.onSignal((_from, p: any) => {
    if (p?.k === 'watch' && p.on) {
      off()
      if (hard) hardDrop(A)
      else dropSignaling(A)
    }
  })
  B.session.watch(A.client.peerId, true)
  await until(() => A.client.status === 'reconectando', 3000)
  await until(() => A.client.status === 'conectado', 10000)
  const ok = await receiving(B, A, 20000)
  check(`${label}: B recebe quadros de A em 20 s após A reconectar`, ok, `A=${signaling(A, B)} B=${signaling(B, A)}`)
  closeAll([A, B])
}

async function scenario2(): Promise<void> {
  const label = 'B clica Assistir enquanto reconecta'
  note('--- ' + label)
  const [A, B] = await pair()
  await A.session.startStreaming(makeStream(0), 'Jogo')
  await until(() => isLive(B, A))
  dropSignaling(B)
  await until(() => B.client.status === 'reconectando', 3000)
  B.session.watch(A.client.peerId, true) // a interface deixa clicar; o pedido não sai
  await until(() => B.client.status === 'conectado', 10000)
  const ok = await receiving(B, A, 20000)
  check(`${label}: B recebe quadros de A em 20 s após reconectar`, ok, `iWatch=${B.session.links.get(A.client.peerId)?.iWatch} A.theyWatch=${A.session.links.get(B.client.peerId)?.theyWatch}`)
  closeAll([A, B])
}

async function run(): Promise<void> {
  await scenario1(false)
  await scenario1(true)
  await scenario2()
  finish()
}

run().catch(fail)
