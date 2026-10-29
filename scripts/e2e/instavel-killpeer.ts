// Persona instavel: a ligação P2P morre de um lado só (NAT esqueceu a rota), o servidor segue normal.
// Esperado: em até 45 s quem assiste volta a receber vídeo (restartIce ou ligação nova).
// Roda os dois casos (morre do lado de quem assiste / de quem transmite) com pessoas novas.
import { check, closeAll, finish, fail, isLive, killPeer, makeStream, newGroup, note, person, sleep, until, type Person } from './lib'
import { frameMeter, verboseLogs } from './instavel-util'

const RECOVER_MS = 45_000

async function scenario(label: string, killSide: 'quem assiste' | 'quem transmite'): Promise<void> {
  const keys = await newGroup()
  const A = person(keys, 'Miguel')
  const B = person(keys, 'Bia')
  const all = [A, B]
  await until(() => all.every((p) => p.client.status === 'conectado'))
  const room = A.client.state.rooms[0]
  for (const p of all) p.client.join(room.id)
  await until(() => all.every((p) => p.session.links.size === 1))
  await A.session.startStreaming(makeStream(0), 'Jogo')
  await until(() => isLive(B, A))
  B.session.watch(A.client.peerId, true)
  check(`${label}: B recebe A antes`, await until(() => !!B.session.links.get(A.client.peerId)?.remote))
  const meter = frameMeter(B, A)
  await sleep(3000)
  meter.reset()
  note(`>>> ${label}: killPeer do lado de ${killSide}`)
  if (killSide === 'quem assiste') killPeer(B, A)
  else killPeer(A, B)
  const t = Date.now()
  const back = await until(() => meter.gap() < 500 && Date.now() - t > 1500, RECOVER_MS)
  const bLink = B.session.links.get(A.client.peerId)
  const aLink = A.session.links.get(B.client.peerId)
  note(
    `<<< ${label}: voltou=${back} buraco=${meter.gap()} ms; B vê ligação ${bLink?.id} status=${bLink?.status} pc=${bLink?.pc.connectionState}; ` +
      `A vê ligação ${aLink?.id} status=${aLink?.status} pc=${aLink?.pc.connectionState}`
  )
  check(`${label}: B volta a receber A em até ${RECOVER_MS / 1000} s`, back, `buraco ${meter.gap()} ms`)
  meter.stop()
  closeAll(all)
  await sleep(1000)
}

async function run(): Promise<void> {
  verboseLogs()
  await scenario('caso 1', 'quem assiste')
  await scenario('caso 2', 'quem transmite')
  finish()
}

run().catch(fail)

export type { Person }
