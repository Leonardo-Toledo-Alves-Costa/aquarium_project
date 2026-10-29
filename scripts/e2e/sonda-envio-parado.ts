// Sonda: o que as estatísticas mostram do lado de quem envia quando os dois reiniciam o ICE juntos
// e o vídeo de um sentido para (ver simultaneo-restart-par). Só imprime; não verifica nada.
import { closeAll, finish, fail, makeStream, newGroup, note, person, sleep, until, type Person } from './lib'

async function dump(from: Person, to: Person, label: string): Promise<void> {
  const link = from.session.links.get(to.client.peerId)
  if (!link) return note(`${label}: sem ligação`)
  const rows: string[] = []
  for (const s of (await link.pc.getStats()).values()) {
    if (s.type === 'media-source' && s.kind === 'video') rows.push(`source frames=${s.frames} fps=${s.framesPerSecond}`)
    if (s.type === 'outbound-rtp' && s.kind === 'video')
      rows.push(
        `out ssrc=${s.ssrc} mid=${s.mid} active=${s.active} enc=${s.framesEncoded} sent=${s.framesSent} pkts=${s.packetsSent} impl=${s.encoderImplementation} lim=${s.qualityLimitationReason} target=${s.targetBitrate}`
      )
    if (s.type === 'inbound-rtp' && s.kind === 'video') rows.push(`in mid=${s.mid} dec=${s.framesDecoded} pkts=${s.packetsReceived}`)
  }
  const tx = link.pc.getTransceivers().map((t) => `${t.mid}:${t.receiver.track.kind}:${t.direction}/${t.currentDirection}:${t.sender.track ? 'trilha' : '-'}`)
  note(`${label} [${link.polite ? 'polite' : 'impolite'}] ${link.pc.connectionState}/${link.pc.signalingState} tx=${tx.join(' ')} | ${rows.join(' | ')}`)
}

async function run(): Promise<void> {
  const keys = await newGroup()
  const A = person(keys, 'Ana')
  const B = person(keys, 'Beto')
  const pair = [A, B]
  await until(() => pair.every((p) => p.client.status === 'conectado'))
  const room = A.client.state.rooms[0]
  for (const p of pair) p.client.join(room.id)
  await until(() => pair.every((p) => p.session.links.size === 1))
  await Promise.all([A.session.startStreaming(makeStream(10), 'A'), B.session.startStreaming(makeStream(200), 'B')])
  A.session.watch(B.client.peerId, true)
  B.session.watch(A.client.peerId, true)
  await sleep(6000)
  await dump(A, B, 'antes A->B')
  await dump(B, A, 'antes B->A')
  for (const p of pair) for (const l of p.session.links.values()) l.pc.restartIce()
  for (let i = 0; i < 2; i++) {
    await sleep(2500)
    await dump(B, A, `+${(i + 1) * 2.5}s B->A`)
  }
  note('>>> religando a trilha do lado polite (replaceTrack null -> trilha)')
  const link = B.session.links.get(A.client.peerId)!
  for (const sender of link.senders) {
    const track = sender.track
    await sender.replaceTrack(null)
    await sender.replaceTrack(track)
  }
  for (let i = 0; i < 3; i++) {
    await sleep(2000)
    await dump(B, A, `religado +${(i + 1) * 2}s B->A`)
  }
  closeAll(pair)
  finish()
}

run().catch(fail)
