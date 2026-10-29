// Persona simultaneo: malha de 5; todos começam a transmitir e a assistir todos no mesmo instante.
// Esperado: os 20 pares recebem vídeo, nenhuma ligação é refeita (nada falhou de verdade),
// as pontas de cada par apontam uma para a outra e ninguém passa do limite de mensagens do servidor.
import { check, closeAll, finish, fail, isLive, sleep, until } from './lib'
import { allStream, allWatch, count, countSends, events, everyPair, linkTable, mesh, mismatched, note, recovers, signalOrder, summary, waitVideo } from './simultaneo-util'

const N = Number(new URLSearchParams(location.search).get('n') ?? 5)

async function run(): Promise<void> {
  const names = ['Miguel', 'Bia', 'Rafa', 'Leo', 'Duda', 'Caio'].slice(0, N)
  const all = await mesh(names)
  const sends = all.map(countSends)
  const order = all.map(signalOrder)
  // Ordem em que cada um recebe os sinais de cada outro (tipo e ufrag), para explicar candidatos recusados.
  const got = new Map<string, string[]>()
  for (const p of all)
    p.client.onSignal((from, payload: any) => {
      const key = p.name + '<-' + all.find((q) => q.client.peerId === from)?.name
      const ufrag = payload?.k === 'desc' ? /a=ice-ufrag:(\S+)/.exec(payload.desc?.sdp ?? '')?.[1]?.slice(0, 4) : payload?.candidate?.usernameFragment?.slice(0, 4)
      const kind = payload?.k === 'desc' ? payload.desc?.type : payload?.k
      got.set(key, [...(got.get(key) ?? []), `${kind}${ufrag ? '(' + ufrag + ')' : ''}`])
    })
  const t = Date.now()

  note('>>> todos transmitem e assistem todos ao mesmo tempo')
  await allStream(all)
  // Sem esperar o "ao vivo" chegar: o pedido vai junto com o anúncio.
  allWatch(all)
  const missing = await waitVideo(everyPair(all), 25000)
  note(`<<< vídeo em ${(Date.now() - t) / 1000} s; faltando: ${missing.join('; ')}`)
  check(`os ${all.length * (all.length - 1)} pares recebem vídeo em até 25 s`, missing.length === 0, missing.join('; ') + ' || ' + linkTable(all))
  check('todos se veem ao vivo', all.every((v) => all.every((s) => s === v || isLive(v, s))))

  await sleep(15000)
  const r = recovers(t)
  note(summary('depois de 15 s estáveis', t))
  check('nenhuma ligação refeita (nada falhou de verdade)', r.length === 0, r.map((e) => `${e.owner}->${e.details?.name}: ${e.details?.why}`).join(', '))
  const bad = mismatched(all)
  check('as duas pontas de cada par apontam uma para a outra', bad.length === 0, bad.join('; '))
  const still = await waitVideo(everyPair(all), 3000)
  check('vídeo continua chegando para todos no fim', still.length === 0, still.join('; '))
  const peak = Math.max(...sends.map((s) => s.max10s()))
  note(`mensagens ao servidor: pico por pessoa em 10 s = ${sends.map((s, i) => `${all[i].name}:${s.max10s()}`).join(' ')}`)
  check('ninguém perto do limite de 300 mensagens em 10 s', peak < 200, `pico ${peak}`)

  // Ninguém chamou restartIce e não houve queda: "ICE reiniciado" no log seria um alarme falso.
  const fakeRestart = count(/ICE reiniciado/, t)
  check('nenhum "ICE reiniciado" no log sem reinício de verdade', fakeRestart === 0, `${fakeRestart} linhas`)
  // Candidatos recusados porque chegaram enquanto a descrição remota ainda estava sendo aplicada.
  const lostIce = events.filter((e) => e.at >= t && e.message === 'sinal com problema' && e.details?.k === 'ice' && /remote description was null/.test(e.details?.error?.message ?? ''))
  for (const e of lostIce.slice(0, 3)) {
    const key = e.owner + '<-' + e.details?.name
    note(`recusado em ${key}; ${e.owner} recebeu, em ordem: ${(got.get(key) ?? []).join(' ')}`)
  }
  check('nenhum candidato ICE recusado por chegar antes da descrição remota', lostIce.length === 0, `${lostIce.length} recusados; estados: ${[...new Set(lostIce.map((e) => e.details?.signaling))].join(',')}`)
  const inv = order.flatMap((o) => o.inversions())
  note(`sinais que saíram fora da ordem pedida: ${inv.length}; ${inv.slice(0, 12).join('; ')}`)
  check('sinais saem na ordem em que a sessão pediu', inv.length === 0, `${inv.length} fora de ordem`)
  closeAll(all)
  finish()
}

run().catch(fail)
