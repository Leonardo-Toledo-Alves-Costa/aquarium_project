// Linha de base: quedas rápidas da conexão com o servidor e sala apagada, com três pessoas numa sala.
// Se este teste falhar, o problema é do ambiente ou de uma regressão grande; investigue antes de qualquer outro.
import { check, closeAll, dropSignaling, finish, fail, fps, isLive, makeStream, newGroup, note, person, sleep, until } from './lib'

async function run(): Promise<void> {
  const keys = await newGroup()
  const A = person(keys, 'Miguel')
  const B = person(keys, 'Bia')
  const C = person(keys, 'Rafa')
  const all = [A, B, C]
  check('três conectam', await until(() => all.every((p) => p.client.status === 'conectado')))
  const room = A.client.state.rooms[0]
  for (const p of all) p.client.join(room.id)
  check('todos na sala', await until(() => all.every((p) => p.session.links.size === 2)))
  await A.session.startStreaming(makeStream(0), 'Jogo')
  await until(() => isLive(B, A))
  B.session.watch(A.client.peerId, true)
  C.session.watch(A.client.peerId, true)
  check('B e C recebem A', await until(() => !!B.session.links.get(A.client.peerId)?.remote && !!C.session.links.get(A.client.peerId)?.remote))
  check('quadros chegando em B', (await fps(B, A)) > 5)

  note('queda rápida de quem transmite')
  dropSignaling(A)
  check('A reconecta', (await until(() => A.client.status === 'reconectando', 3000)) && (await until(() => A.client.status === 'conectado')))
  await sleep(1500)
  check('A continua transmitindo depois da queda', A.session.local !== null)
  check('B vê A ao vivo', isLive(B, A))
  check('B volta a receber A', (await until(() => !!B.session.links.get(A.client.peerId)?.remote?.getVideoTracks().length)) && (await fps(B, A)) > 5)
  check('C volta a receber A', (await until(() => !!C.session.links.get(A.client.peerId)?.remote?.getVideoTracks().length)) && (await fps(C, A)) > 5)

  note('queda rápida de quem assiste')
  dropSignaling(B)
  check('B reconecta', (await until(() => B.client.status === 'reconectando', 3000)) && (await until(() => B.client.status === 'conectado')))
  await sleep(1500)
  check('B volta a receber A depois da própria queda', (await until(() => !!B.session.links.get(A.client.peerId)?.remote?.getVideoTracks().length)) && (await fps(B, A)) > 5)
  check('C não foi afetado', (await fps(C, A)) > 5)

  note('sala apagada com alguém transmitindo dentro')
  A.client.createRoom('Temporária')
  await until(() => A.client.state.rooms.some((r) => r.name === 'Temporária'))
  const temp = A.client.state.rooms.find((r) => r.name === 'Temporária')!
  A.client.join(temp.id)
  await until(() => A.client.me?.roomId === temp.id)
  await A.session.startStreaming(makeStream(90), 'Outro jogo')
  await until(() => isLive(C, A))
  C.client.deleteRoom(temp.id)
  check('sala apagada: A sai dela', await until(() => A.client.me?.roomId === null, 5000))
  check('sala apagada: A para de transmitir', A.session.local === null)
  dropSignaling(A)
  await until(() => A.client.status === 'conectado')
  await sleep(1500)
  check('depois da queda, A não tenta voltar à sala apagada', A.client.error === null, 'erro: ' + A.client.error)

  closeAll(all)
  finish()
}

run().catch(fail)
