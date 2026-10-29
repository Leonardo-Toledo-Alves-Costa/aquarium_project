// mensageiro-ruim: atrasos (200 a 3000 ms), duplicatas e entrega fora de ordem dos sinais P2P.
// Cada caso é um par novo: A transmite, B assiste. Passa se B recebe quadros de A em 20 s.
import {
  check, closeAll, finish, fail, fps, isLive, makeStream, newGroup, note, person, signaling, sleep,
  tamperSignalsBy, until, verboseLogs, type Person, type SignalKind
} from './lib'

verboseLogs()

type Rule = (kind: SignalKind, n: number) => 'pass' | 'drop' | 'dup' | number
const rand = (a: number, b: number): number => Math.round(a + Math.random() * (b - a))
const pass: Rule = () => 'pass'

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

async function scenario(label: string, ruleA: Rule, ruleB: Rule, rounds = 1): Promise<void> {
  note('--- ' + label)
  const [A, B] = await pair()
  const log: string[] = []
  tamperSignalsBy(A, ruleA, log)
  tamperSignalsBy(B, ruleB, log)
  let failed = 0
  let detail = ''
  // Várias rodadas de assistir / parar na mesma ligação: cada uma é uma renegociação.
  await A.session.startStreaming(makeStream(0), 'Jogo')
  await until(() => isLive(B, A))
  for (let r = 0; r < rounds; r++) {
    B.session.watch(A.client.peerId, true)
    const ok = await receiving(B, A, 20000)
    if (!ok) {
      failed++
      detail ||= `rodada ${r}: A=${signaling(A, B)} B=${signaling(B, A)} A.theyWatch=${A.session.links.get(B.client.peerId)?.theyWatch} conexão=${B.session.links.get(A.client.peerId)?.pc.connectionState}`
      note(`${label} rodada ${r} falhou; sinais: ${log.join(' ')}`)
    }
    log.length = 0
    B.session.watch(A.client.peerId, false)
    await sleep(3500) // deixa os sinais atrasados da rodada chegarem
  }
  check(`${label}: B recebe A em todas as ${rounds} rodadas`, failed === 0, `${failed} falhas; ${detail}`)
  closeAll([A, B])
}

async function run(): Promise<void> {
  const only = (kinds: SignalKind[], r: (n: number) => 'pass' | 'drop' | 'dup' | number): Rule => (k, n) => (kinds.includes(k) ? r(n) : 'pass')
  await scenario('oferta de A atrasada 2 s (candidatos chegam antes)', only(['offer'], () => 2000), pass, 3)
  await scenario('resposta de B atrasada 2 s (candidatos de B antes)', pass, only(['answer'], () => 2000), 3)
  await scenario('todos os sinais de A com atraso aleatório 200-3000 ms', () => rand(200, 3000), pass, 3)
  await scenario('todos os sinais de B com atraso aleatório 200-3000 ms', pass, () => rand(200, 3000), 3)
  await scenario('os dois lados com atraso aleatório 200-3000 ms', () => rand(200, 3000), () => rand(200, 3000), 4)
  await scenario('tudo de A duplicado', () => 'dup', pass, 3)
  await scenario('tudo de B duplicado', pass, () => 'dup', 3)
  await scenario('duplicado e atrasado nos dois lados', () => (Math.random() < 0.5 ? 'dup' : rand(200, 1500)), () => (Math.random() < 0.5 ? 'dup' : rand(200, 1500)), 4)
  await scenario('todos os candidatos de A perdidos', only(['ice', 'ice-end'], () => 'drop'), pass, 2)
  finish()
}

run().catch(fail)
