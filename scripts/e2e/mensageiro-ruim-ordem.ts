// mensageiro-ruim: a cifragem assíncrona de sendSignal (não aguardada) pode trocar a ordem dos sinais?
// Mede a ordem de chegada (1) numa negociação normal e (2) numa rajada com tamanhos alternados.
import { check, closeAll, finish, fail, isLive, makeStream, newGroup, note, person, recordIncoming, sleep, until, verboseLogs } from './lib'

verboseLogs()

async function run(): Promise<void> {
  const keys = await newGroup()
  const A = person(keys, 'Ana')
  const B = person(keys, 'Beto')
  await until(() => A.client.status === 'conectado' && B.client.status === 'conectado')
  const room = A.client.state.rooms[0]
  A.client.join(room.id)
  B.client.join(room.id)
  await until(() => A.session.links.size === 1 && B.session.links.size === 1)

  // (1) negociação normal, várias vezes
  const seen = recordIncoming(B)
  let badNeg = 0
  for (let i = 0; i < 5; i++) {
    seen.length = 0
    await A.session.startStreaming(makeStream(i * 40), 'Jogo')
    await until(() => isLive(B, A))
    B.session.watch(A.client.peerId, true)
    await until(() => !!B.session.links.get(A.client.peerId)?.remote, 8000)
    await sleep(1500)
    const firstOffer = seen.indexOf('offer')
    const firstIce = seen.indexOf('ice')
    if (firstIce !== -1 && firstOffer !== -1 && firstIce < firstOffer) badNeg++
    note(`negociação ${i}: B recebeu ${seen.join(',')}`)
    B.session.watch(A.client.peerId, false)
    A.session.stopStreaming()
    await sleep(800)
  }
  check('negociação: nenhum candidato chega antes da oferta (5 rodadas)', badNeg === 0, `${badNeg} de 5 fora de ordem`)

  // (2) rajada: tamanhos alternados (40 KB e 10 B), numerados. Abaixo do limite de 300 mensagens / 10 s.
  const got: number[] = []
  B.client.onSignal((_f, p: any) => {
    if (p?.k === 'seq') got.push(p.n)
  })
  const big = 'x'.repeat(40_000)
  const N = 120
  for (let n = 0; n < N; n++) void A.client.sendSignal(B.client.peerId, { k: 'seq', n, pad: n % 2 === 0 ? big : '' })
  await until(() => got.length === N, 10000)
  let inversions = 0
  for (let i = 1; i < got.length; i++) if (got[i] < got[i - 1]) inversions++
  note(`rajada: chegaram ${got.length}/${N}, ${inversions} inversões; início ${got.slice(0, 12).join(',')}`)
  check('rajada: todos chegam', got.length === N, `${got.length}/${N}`)
  check('rajada: chegam na ordem em que foram enviados', inversions === 0, `${inversions} inversões`)

  closeAll([A, B])
  finish()
}

run().catch(fail)
