// mensageiro-ruim: uma oferta ou resposta perdida no caminho trava a conexão para sempre?
// E o que o usuário faria para destravar (parar e voltar a assistir, parar e voltar a transmitir) resolve?
import {
  check, closeAll, dropSignaling, finish, fail, fps, isLive, makeStream, newGroup, note, person, signaling, sleep,
  tamperSignalsBy, until, verboseLogs, type Person, type SignalKind
} from './lib'

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

const hasTrack = (B: Person, A: Person): boolean => !!B.session.links.get(A.client.peerId)?.remote?.getVideoTracks().length
/** Trilha presente e quadros chegando de verdade (uma trilha sem quadros é tela preta). */
async function receiving(B: Person, A: Person, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (hasTrack(B, A) && (await fps(B, A)) > 5) return true
    await sleep(300)
  }
  return false
}

async function scenario(label: string, who: 'A' | 'B', dropKind: SignalKind): Promise<void> {
  note(`--- ${label}`)
  const [A, B] = await pair()
  const log: string[] = []
  // Perde só o primeiro sinal daquele tipo; o resto passa.
  const undo = tamperSignalsBy(who === 'A' ? A : B, (kind, n) => (kind === dropKind && n === 0 ? 'drop' : 'pass'), log)
  await A.session.startStreaming(makeStream(0), 'Jogo')
  await until(() => isLive(B, A))
  B.session.watch(A.client.peerId, true)
  const ok = await receiving(B, A, 15000)
  note(`${label}: sinais ${log.join(' ')}; A=${signaling(A, B)} B=${signaling(B, A)}`)
  check(`${label}: B recebe quadros de A em 15 s`, ok, `trilha=${hasTrack(B, A)} negociação A=${signaling(A, B)} B=${signaling(B, A)}`)
  undo()
  if (!ok) {
    // O que o usuário tentaria.
    B.session.watch(A.client.peerId, false)
    await sleep(500)
    B.session.watch(A.client.peerId, true)
    const ok2 = await receiving(B, A, 10000)
    check(`${label}: parar e voltar a assistir destrava`, ok2, `A=${signaling(A, B)} B=${signaling(B, A)}`)
    if (!ok2) {
      A.session.stopStreaming()
      await sleep(1000)
      await A.session.startStreaming(makeStream(60), 'Jogo')
      await until(() => isLive(B, A))
      B.session.watch(A.client.peerId, true)
      const ok3 = await receiving(B, A, 10000)
      check(`${label}: A parar e voltar a transmitir destrava`, ok3, `A=${signaling(A, B)} B=${signaling(B, A)}`)
      if (!ok3) {
        // Queda de conexão com o servidor de A: o servidor tira A da sala por um instante e a ligação é refeita.
        dropSignaling(A)
        await until(() => A.client.status === 'reconectando', 3000)
        await until(() => A.client.status === 'conectado', 10000)
        await sleep(500)
        B.session.watch(A.client.peerId, true)
        const ok4 = await receiving(B, A, 15000)
        check(`${label}: queda e volta da conexão de A com o servidor destrava`, ok4, `A=${signaling(A, B)} B=${signaling(B, A)}`)
        if (!ok4) {
          const room = B.client.me!.roomId!
          B.client.join(null)
          await sleep(1000)
          B.client.join(room)
          await until(() => B.session.links.size === 1)
          await sleep(500)
          B.session.watch(A.client.peerId, true)
          const ok5 = await receiving(B, A, 15000)
          check(`${label}: B sair e voltar para a sala destrava`, ok5, `A=${signaling(A, B)} B=${signaling(B, A)}`)
        }
      }
    }
  }
  closeAll([A, B])
}

async function run(): Promise<void> {
  await scenario('oferta de A perdida', 'A', 'offer')
  await scenario('resposta de B perdida', 'B', 'answer')
  await scenario('pedido de assistir perdido', 'B', 'watch')
  finish()
}

run().catch(fail)
