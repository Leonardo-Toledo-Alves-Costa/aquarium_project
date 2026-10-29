// mensageiro-ruim: o servidor descarta sinais quando o destino está em outra sala ou offline.
// Corridas de troca de sala com transmissão em andamento: alguém fica sem vídeo no fim?
import { tamperSignalsBy, check, closeAll, finish, fail, fps, isLive, makeStream, newGroup, note, person, signaling, sleep, until, verboseLogs, type Person } from './lib'

verboseLogs()

async function receiving(B: Person, A: Person, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (B.session.links.get(A.client.peerId)?.remote?.getVideoTracks().length && (await fps(B, A)) > 5) return true
    await sleep(300)
  }
  return false
}

async function setup(): Promise<{ A: Person; B: Person; r1: string; r2: string }> {
  const keys = await newGroup()
  const A = person(keys, 'Ana')
  const B = person(keys, 'Beto')
  await until(() => A.client.status === 'conectado' && B.client.status === 'conectado')
  A.client.createRoom('Outra')
  await until(() => A.client.state.rooms.length >= 2 && B.client.state.rooms.length >= 2)
  const [r1, r2] = A.client.state.rooms.map((r) => r.id)
  A.client.join(r1)
  B.client.join(r1)
  await until(() => A.session.links.size === 1 && B.session.links.size === 1)
  await A.session.startStreaming(makeStream(0), 'Jogo')
  await until(() => isLive(B, A))
  B.session.watch(A.client.peerId, true)
  await receiving(B, A, 15000)
  return { A, B, r1, r2 }
}

/** Depois da corrida, B (re)pede para assistir e precisa receber quadros. */
async function afterRace(label: string, A: Person, B: Person, room: string): Promise<void> {
  await until(() => A.client.me?.roomId === room && B.client.me?.roomId === room && isLive(B, A), 5000)
  await sleep(300)
  B.session.watch(A.client.peerId, true)
  const ok = await receiving(B, A, 15000)
  check(`${label}: B recebe A no fim`, ok, `A.sala=${A.client.me?.roomId === room} B.sala=${B.client.me?.roomId === room} A=${signaling(A, B)} B=${signaling(B, A)} conexão=${B.session.links.get(A.client.peerId)?.pc.connectionState}`)
}

async function run(): Promise<void> {
  for (const d of [0, 20, 60, 150, 400]) {
    note(`--- os dois mudam de sala, B ${d} ms depois`)
    const { A, B, r2 } = await setup()
    A.client.join(r2)
    await sleep(d)
    B.client.join(r2)
    await afterRace(`os dois para outra sala (+${d} ms)`, A, B, r2)
    closeAll([A, B])
  }
  for (const d of [0, 20, 60, 150]) {
    note(`--- B sai e volta para a sala em ${d} ms`)
    const { A, B, r1, r2 } = await setup()
    B.client.join(r2)
    await sleep(d)
    B.client.join(r1)
    await afterRace(`B vai e volta (${d} ms)`, A, B, r1)
    closeAll([A, B])
  }
  for (const d of [0, 20, 60, 150]) {
    note(`--- A sai e volta para a sala em ${d} ms, transmitindo`)
    const { A, B, r1, r2 } = await setup()
    A.client.join(r2)
    await sleep(d)
    A.client.join(r1)
    await afterRace(`A vai e volta transmitindo (${d} ms)`, A, B, r1)
    closeAll([A, B])
  }
  for (const [away, back] of [[0, 600], [100, 400]]) {
    note(`--- oferta de A atrasada 300 ms; B sai em ${away} ms e volta em ${back} ms (o servidor descarta a oferta)`)
    const { A, B, r1, r2 } = await setup()
    B.session.watch(A.client.peerId, false)
    await sleep(1500)
    const log: string[] = []
    const undo = tamperSignalsBy(A, (k) => (k === 'offer' ? 300 : 'pass'), log)
    B.session.watch(A.client.peerId, true)
    await sleep(away)
    B.client.join(r2)
    await sleep(back - away)
    B.client.join(r1)
    await sleep(1000)
    undo()
    note('sinais de A: ' + log.join(' '))
    await afterRace(`oferta descartada pelo servidor na volta de B (${away}/${back} ms)`, A, B, r1)
    closeAll([A, B])
  }
  finish()
}

run().catch(fail)
