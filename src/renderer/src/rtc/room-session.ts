// Sessão de uma sala: uma conexão WebRTC com cada outra pessoa da sala (mesh).
// Qualquer um pode transmitir; o vídeo só vai para quem pediu para assistir.
// A negociação segue o padrão "perfect negotiation" do WebRTC, então os dois lados
// podem mudar o que enviam a qualquer momento sem combinar quem começa.

import { errorInfo, logger } from '../log'
import type { MemberInfo } from '../../../shared/rooms-protocol'
import type { RoomClient } from '../signaling/rooms'
import { BitrateGovernor, type BandwidthMode } from './governor'
import { createPeerConnection, peerStatus, preferVideoCodecs, type PeerStatus } from './peer'
import { CODECS, PRIORITIES, type StreamSettings } from './presets'
import { withBitrateHints, withMusicAudio } from './sdp'
import { currentRoute, StatsSampler } from './stats'

const log = logger('rtc')

export interface SessionSettings extends StreamSettings {
  bandwidth: BandwidthMode
}

type Signal = (
  | { k: 'desc'; desc: RTCSessionDescriptionInit }
  | { k: 'ice'; candidate: RTCIceCandidateInit | null }
  | { k: 'watch'; on: boolean }
  | { k: 'hello' }
) & {
  /** Conexão de quem envia (versões até a 0.4.0 não mandam). */
  lid?: string
  /** Conexão de quem recebe, como quem envia a conhece. */
  to?: string
}

/** Depois que alguém para de transmitir, por quanto tempo volto a assistir sozinho se a pessoa voltar. */
const REWATCH_GRACE_MS = 20_000
/** Uma linha de estatísticas por pessoa no log a cada tanto, enquanto há vídeo indo ou vindo. */
const STATS_LOG_MS = 30_000
/** Mudanças do limite automático de banda entram no log no máximo uma vez nesse intervalo. */
const GOVERNOR_LOG_MS = 10_000
/** Erros de coleta de candidatos registrados por conexão (os servidores STUN geram muitos). */
const MAX_CANDIDATE_ERRORS = 5
/**
 * Quem some da lista do servidor (queda da conexão dela com o servidor) mas continua com a ligação
 * P2P funcionando fica por esse tempo: dá para ela perceber a queda e voltar sem o vídeo parar.
 */
const MISSING_GRACE_MS = 30_000
/** Uma negociação que não termina nesse tempo perdeu um sinal: a conexão é refeita. */
const NEGOTIATION_TIMEOUT_MS = 6_000
/** Desconectada por esse tempo, tento reiniciar o ICE antes de desistir da conexão. */
const ICE_RESTART_AFTER_MS = 4_000
/** Uma mesma pessoa tem a conexão refeita no máximo uma vez nesse intervalo. */
const RECOVER_MIN_MS = 10_000
/** Pedi para assistir e o vídeo não veio: repito o pedido depois desse tempo (pode ter se perdido). */
const WATCH_RETRY_MS = 3_000

/** Tipo e protocolo de um candidato ICE, tirados da linha "candidate:" (o endereço fica de fora). */
function candidateKind(candidate: string): string {
  const typ = / typ (\w+)/.exec(candidate)?.[1] ?? '?'
  const protocol = /^(?:a=)?candidate:\S+ \d+ (\w+)/i.exec(candidate)?.[1]?.toLowerCase() ?? '?'
  return `${typ}/${protocol}`
}

/** O que chega, se ainda tem vídeo passando. */
function liveVideo(stream: MediaStream | null): MediaStream | null {
  return stream?.getVideoTracks().some((t) => t.readyState === 'live') ? stream : null
}

function countInto(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

/** ice-ufrag da descrição: muda quando um dos lados reinicia o ICE (o valor não vai para o log). */
function iceUfrag(desc: RTCSessionDescriptionInit | null | undefined): string | undefined {
  return desc?.sdp ? /a=ice-ufrag:(\S+)/.exec(desc.sdp)?.[1] : undefined
}

export class PeerLink {
  /** Identifica esta conexão; se a outra pessoa a recriar (queda do servidor), o número dela muda. */
  readonly id = crypto.randomUUID().slice(0, 8)
  /** Conexão do outro lado a que esta está ligada. */
  remoteId?: string
  readonly pc = createPeerConnection()
  readonly outStats = new StatsSampler(this.pc, 'enviando')
  readonly inStats = new StatsSampler(this.pc, 'recebendo')
  readonly governor: BitrateGovernor
  /** Eu pedi para assistir esta pessoa. */
  iWatch = false
  /** Esta pessoa pediu para me assistir. */
  theyWatch = false
  /** O que chega desta pessoa, assistindo ou não; `remote` só aponta para cá enquanto eu assisto. */
  incoming: MediaStream | null = null
  remote: MediaStream | null = null
  /** Quando o último pedido de assistir (ou de parar) foi enviado. */
  watchSentAt = 0
  /** Desde quando a negociação está aberta, a conexão está desconectada ou a pessoa sumiu do servidor (0: não está). */
  unstableSince = 0
  disconnectedSince = 0
  missingSince = 0
  iceRestarted = false
  /** Como o servidor mostrava a pessoa da última vez (para manter a aba enquanto ela some). */
  member?: MemberInfo
  senders: RTCRtpSender[] = []
  status: PeerStatus = 'aguardando'
  makingOffer = false
  ignoreOffer = false
  /** Só para o log: amostradores próprios, para não mexer nas contas de taxa da interface. */
  readonly logOut = new StatsSampler(this.pc, 'enviando')
  readonly logIn = new StatsSampler(this.pc, 'recebendo')
  localCandidates: Record<string, number> = {}
  remoteCandidates: Record<string, number> = {}
  candidateErrors = 0
  governorLoggedAt = 0
  localUfrag?: string
  remoteUfrag?: string

  constructor(
    readonly peerId: string,
    readonly polite: boolean,
    settings: () => SessionSettings
  ) {
    this.governor = new BitrateGovernor(
      () => settings().preset.maxBitrate,
      () => settings().bandwidth
    )
  }
}

export class RoomSession {
  readonly links = new Map<string, PeerLink>()
  local: { stream: MediaStream; label: string; stop?: () => void } | null = null
  /**
   * Quem eu quero assistir, mesmo que a conexão caia e volte. O valor é até quando continuo
   * querendo depois que a pessoa parou de transmitir (Infinity enquanto ela transmite).
   */
  private wanted = new Map<string, number>()
  private wantedRoom: string | null = null
  private connections = 0
  private listeners = new Set<() => void>()
  private unsubscribe: (() => void)[] = []
  private governorTimer: ReturnType<typeof setInterval>
  private statsTimer: ReturnType<typeof setInterval>
  private healthTimer: ReturnType<typeof setInterval>
  /** Quando cada pessoa teve a conexão refeita pela última vez. */
  private recoveredAt = new Map<string, number>()

  constructor(
    private readonly client: RoomClient,
    private settings: SessionSettings
  ) {
    this.unsubscribe.push(client.subscribe(() => this.sync()))
    this.unsubscribe.push(client.onSignal((from, payload) => this.onSignal(from, payload as Signal)))
    this.governorTimer = setInterval(() => this.governBitrate(), 2000)
    this.statsTimer = setInterval(() => void this.logStats(), STATS_LOG_MS)
    this.healthTimer = setInterval(() => this.checkHealth(), 1000)
    this.sync()
  }

  get roomId(): string | null {
    return this.client.me?.roomId ?? null
  }

  /** Quem sumiu do servidor há pouco mas continua com a ligação funcionando (ver MISSING_GRACE_MS). */
  get missingMembers(): MemberInfo[] {
    return [...this.links.values()].flatMap((l) => (l.missingSince && l.member ? [l.member] : []))
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  // ---------- transmitir ----------

  /** `stop` libera o que a captura usa além das trilhas (por exemplo, o módulo de áudio). */
  async startStreaming(stream: MediaStream, label: string, stop?: () => void): Promise<void> {
    this.stopStreaming(false)
    this.local = { stream, label, stop }
    const video = stream.getVideoTracks()[0]?.getSettings()
    log.info('transmissão começou', {
      tracks: stream.getTracks().map((t) => t.kind),
      width: video?.width,
      height: video?.height,
      fps: video?.frameRate,
      viewers: [...this.links.values()].filter((l) => l.theyWatch).map((l) => l.peerId)
    })
    this.applyTrackSettings()
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      log.info('a captura de vídeo terminou (janela fechada ou tela removida)')
      this.stopStreaming()
    })
    for (const link of this.links.values()) if (link.theyWatch) this.attach(link)
    this.client.setStreaming(true, label)
    this.emit()
  }

  stopStreaming(announce = true): void {
    if (!this.local) return
    log.info('transmissão parou', { announce })
    for (const link of this.links.values()) this.detach(link)
    for (const track of this.local.stream.getTracks()) track.stop()
    this.local.stop?.()
    this.local = null
    if (announce) this.client.setStreaming(false)
    this.emit()
  }

  async updateSettings(settings: SessionSettings): Promise<void> {
    this.settings = settings
    this.applyTrackSettings()
    await Promise.all([...this.links.values()].map((link) => this.applySenderParameters(link)))
    this.emit()
  }

  get currentSettings(): SessionSettings {
    return this.settings
  }

  // ---------- assistir ----------

  watch(peerId: string, on: boolean): void {
    if (on) this.wanted.set(peerId, Infinity)
    else this.wanted.delete(peerId)
    const link = this.links.get(peerId)
    log.info(on ? 'pedi para assistir' : 'parei de assistir', { peer: peerId, link: link?.id, status: link?.status })
    if (!link || link.iWatch === on) return
    link.iWatch = on
    // O vídeo pode já estar chegando (um "parar" anterior que se perdeu): aproveito sem esperar uma trilha nova.
    link.remote = on ? liveVideo(link.incoming) : null
    this.sendWatch(link, on)
    this.emit()
  }

  private sendWatch(link: PeerLink, on: boolean): void {
    link.watchSentAt = Date.now()
    this.signal(link.peerId, { k: 'watch', on })
  }

  close(): void {
    log.info('sessão encerrada', { links: this.links.size })
    this.stopStreaming()
    clearInterval(this.governorTimer)
    clearInterval(this.statsTimer)
    clearInterval(this.healthTimer)
    for (const off of this.unsubscribe) off()
    for (const link of this.links.values()) link.pc.close()
    this.links.clear()
  }

  // ---------- quem está na sala ----------

  private sync(): void {
    const me = this.client.me
    const roomId = me?.roomId ?? null
    const others = new Map(
      this.client.state.members
        .filter((m) => roomId !== null && m.roomId === roomId && m.peerId !== this.client.peerId)
        .map((m) => [m.peerId, m])
    )

    if (roomId !== this.wantedRoom) {
      log.info('sala atual', { roomId, from: this.wantedRoom, others: [...others.keys()] })
      this.wanted.clear()
      this.wantedRoom = roomId
    }
    // Reconectei ao servidor: quem está na 0.4.0 refaz a conexão comigo sem avisar (não manda o
    // número da conexão), então refaço a minha também. Com quem está na versão nova, a conexão continua.
    if (this.client.connections !== this.connections) {
      if (this.connections > 0) {
        const closed: string[] = []
        for (const [peerId, link] of this.links) {
          if (link.remoteId) continue
          closed.push(peerId)
          link.pc.close()
          this.links.delete(peerId)
        }
        log.info('servidor reconectado', { connections: this.client.connections, kept: this.links.size, recreated: closed })
      }
      this.connections = this.client.connections
    }

    const now = Date.now()
    for (const [peerId, link] of this.links) {
      if (others.has(peerId)) {
        if (link.missingSince) log.info('a pessoa voltou ao servidor; conexão mantida', { ...this.who(link), missingMs: now - link.missingSince })
        link.missingSince = 0
        continue
      }
      // Sumiu do servidor (não mudou de sala) com o vídeo ainda passando: espera ela voltar.
      const gone = roomId !== null && !this.client.state.members.some((m) => m.peerId === peerId)
      if (gone && link.pc.connectionState === 'connected' && (!link.missingSince || now - link.missingSince < MISSING_GRACE_MS)) {
        if (!link.missingSince) {
          link.missingSince = now
          log.info('a pessoa sumiu do servidor; mantenho a conexão por um tempo', { ...this.who(link), graceMs: MISSING_GRACE_MS })
        }
        continue
      }
      log.info('conexão fechada: a pessoa não está mais na sala', { peer: peerId, link: link.id, status: link.status, missingMs: link.missingSince ? now - link.missingSince : undefined })
      link.pc.close()
      this.links.delete(peerId)
    }
    for (const [peerId, member] of others) {
      const link = this.links.get(peerId) ?? this.createLink(peerId, undefined, 'na sala')
      link.member = member
      if (!member.streaming && link.iWatch) {
        log.info('parei de assistir: a pessoa parou de transmitir', { peer: peerId })
        link.iWatch = false
        link.remote = null
      }
      this.rewatch(link, member.streaming)
    }
    // Quem sumiu da sala (queda de conexão) também conta o prazo para eu desistir de assistir.
    for (const peerId of this.wanted.keys()) if (!others.has(peerId)) this.rewatch(undefined, false, peerId)
    if (roomId === null && this.local) this.stopStreaming(false)
    this.emit()
  }

  /**
   * Volta a assistir quem eu assistia, se a pessoa (re)começou a transmitir dentro do prazo.
   * Cobre a conexão recriada depois de uma queda e quem para e volta logo a transmitir.
   */
  private rewatch(link: PeerLink | undefined, streaming: boolean, peerId = link?.peerId): void {
    if (!peerId) return
    const until = this.wanted.get(peerId)
    if (until === undefined) return
    if (!streaming) {
      if (until === Infinity) this.wanted.set(peerId, Date.now() + REWATCH_GRACE_MS)
      else if (Date.now() > until) this.wanted.delete(peerId)
      return
    }
    this.wanted.set(peerId, Infinity)
    if (link && !link.iWatch) {
      log.info('voltando a assistir sozinho', { peer: peerId, link: link.id })
      link.iWatch = true
      link.remote = liveVideo(link.incoming)
      this.sendWatch(link, true)
    }
  }

  // ---------- conexões que se recuperam sozinhas ----------

  /** Uma vez por segundo: refaz o que travou e repete pedidos que podem ter se perdido. */
  private checkHealth(): void {
    const now = Date.now()
    let changed = false
    for (const link of [...this.links.values()]) {
      const { pc } = link
      // Quem sumiu do servidor e não voltou a tempo (ou cuja ligação caiu nesse meio-tempo).
      if (link.missingSince && (now - link.missingSince >= MISSING_GRACE_MS || pc.connectionState !== 'connected')) {
        this.sync()
        return
      }
      if (pc.signalingState === 'stable') link.unstableSince = 0
      else if (!link.unstableSince) link.unstableSince = now
      else if (now - link.unstableSince > NEGOTIATION_TIMEOUT_MS) {
        changed = this.recover(link, 'negociação parada') || changed
        continue
      }
      const state = pc.connectionState
      if (state === 'failed' || state === 'closed') {
        changed = this.recover(link, state === 'failed' ? 'conexão falhou' : 'conexão fechada') || changed
        continue
      }
      if (state === 'disconnected') {
        link.disconnectedSince ||= now
        if (!link.iceRestarted && now - link.disconnectedSince > ICE_RESTART_AFTER_MS) {
          link.iceRestarted = true
          log.warn('conexão instável; reiniciando o ICE', this.who(link))
          pc.restartIce()
        }
      } else {
        link.disconnectedSince = 0
        if (state === 'connected') link.iceRestarted = false
      }
      this.retryWatch(link, now)
    }
    if (changed) this.emit()
  }

  /**
   * Refaz a conexão com uma pessoa: o "hello" da nova faz o outro lado trocar a dele também
   * (replaceLink), e cada lado volta a assistir quem assistia.
   */
  private recover(link: PeerLink, why: string): boolean {
    const { peerId } = link
    if (this.links.get(peerId) !== link) return false
    const member = this.client.state.members.find((m) => m.peerId === peerId)
    if (!member || member.roomId === null || member.roomId !== this.roomId) {
      this.sync()
      return false
    }
    const now = Date.now()
    if (now - (this.recoveredAt.get(peerId) ?? 0) < RECOVER_MIN_MS) return false
    this.recoveredAt.set(peerId, now)
    log.warn('refazendo a conexão', {
      ...this.who(link),
      why,
      connection: link.pc.connectionState,
      signaling: link.pc.signalingState,
      watching: link.iWatch,
      watched: link.theyWatch
    })
    link.pc.close()
    this.links.delete(peerId)
    const fresh = this.createLink(peerId, undefined, why)
    this.rewatch(fresh, member.streaming)
    return true
  }

  /**
   * O pedido de assistir vai uma vez só e pode se perder (ou chegar fora de ordem): enquanto o que
   * chega não bate com o que eu quero, repito o pedido. Do outro lado, repetir não muda nada.
   */
  private retryWatch(link: PeerLink, now: number): void {
    if (now - link.watchSentAt < WATCH_RETRY_MS || link.pc.signalingState !== 'stable') return
    const streaming = !!this.client.state.members.find((m) => m.peerId === link.peerId)?.streaming
    const receiving = !!liveVideo(link.incoming)
    if (link.iWatch && streaming && !receiving && link.pc.connectionState !== 'connecting') {
      log.info('o vídeo não veio; repito o pedido para assistir', this.who(link))
      this.sendWatch(link, true)
    } else if (!link.iWatch && receiving) {
      log.info('o vídeo continua vindo sem eu assistir; repito o pedido para parar', this.who(link))
      this.sendWatch(link, false)
    }
  }

  /** `remoteId`: a conexão do outro lado, quando já se sabe qual é. */
  private createLink(peerId: string, remoteId: string | undefined, why: string): PeerLink {
    const link = new PeerLink(peerId, this.client.peerId > peerId, () => this.settings)
    link.remoteId = remoteId
    const { pc } = link
    this.links.set(peerId, link)
    log.info('nova conexão', { ...this.who(link), polite: link.polite, why })

    pc.addEventListener('negotiationneeded', async () => {
      try {
        link.makingOffer = true
        await pc.setLocalDescription()
        this.noteUfrag(link, 'local', pc.localDescription)
        log.info('oferta enviada', { ...this.who(link), type: pc.localDescription?.type })
        this.signal(peerId, { k: 'desc', desc: pc.localDescription!.toJSON() })
      } catch (err) {
        log.warn('falha ao negociar', { ...this.who(link), signaling: pc.signalingState, error: errorInfo(err) })
      } finally {
        link.makingOffer = false
      }
    })
    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate?.candidate) countInto(link.localCandidates, candidateKind(event.candidate.candidate))
      this.signal(peerId, { k: 'ice', candidate: event.candidate?.toJSON() ?? null })
    })
    pc.addEventListener('icecandidateerror', (event) => {
      // Sem o endereço local: só o código, o texto e o servidor STUN/TURN que falhou.
      if (++link.candidateErrors > MAX_CANDIDATE_ERRORS) return
      const e = event as RTCPeerConnectionIceErrorEvent
      log.warn('erro ao coletar candidato ICE', {
        ...this.who(link),
        errorCode: e.errorCode,
        errorText: e.errorText,
        url: e.url,
        last: link.candidateErrors === MAX_CANDIDATE_ERRORS
      })
    })
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'gathering') link.localCandidates = {}
      // Uma linha só com o que foi encontrado: sem "srflx" o STUN não respondeu.
      if (pc.iceGatheringState === 'complete') log.info('coleta de candidatos terminou', { ...this.who(link), candidates: link.localCandidates })
    })
    pc.addEventListener('iceconnectionstatechange', () => {
      log.info('ICE', { ...this.who(link), ice: pc.iceConnectionState })
    })
    pc.addEventListener('signalingstatechange', () => {
      log.info('negociação', { ...this.who(link), signaling: pc.signalingState })
    })
    pc.addEventListener('connectionstatechange', () => {
      link.status = peerStatus(pc)
      const level = pc.connectionState === 'failed' || pc.connectionState === 'disconnected' ? 'warn' : 'info'
      log[level]('conexão', { ...this.who(link), connection: pc.connectionState, ice: pc.iceConnectionState })
      if (link.status === 'conectado') {
        this.applySenderParameters(link)
        currentRoute(pc)
          .then((route) => log.info('rota escolhida', { ...this.who(link), ...route }))
          .catch(() => undefined)
      }
      this.emit()
    })
    pc.addEventListener('track', (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      log.info('trilha recebida', { ...this.who(link), kind: event.track.kind, watching: link.iWatch })
      event.track.addEventListener('ended', () => log.info('trilha recebida terminou', { ...this.who(link), kind: event.track.kind }))
      link.incoming = stream
      link.remote = link.iWatch ? stream : null
      stream.addEventListener('removetrack', (e) => {
        log.info('trilha removida', { ...this.who(link), kind: e.track.kind })
        if (stream.getTracks().length === 0) {
          if (link.remote === stream) link.remote = null
          if (link.incoming === stream) link.incoming = null
        }
        this.emit()
      })
      this.emit()
    })
    // Apresenta esta conexão: se o outro lado tinha uma conexão antiga comigo, ele a troca por uma nova.
    this.signal(peerId, { k: 'hello' })
    return link
  }

  /** A outra pessoa recriou a conexão comigo: troco a minha por uma nova, ligada à dela. */
  private replaceLink(old: PeerLink, remoteId: string): PeerLink {
    log.info('a outra pessoa recriou a conexão; troco a minha', { ...this.who(old), newRemote: remoteId, oldStatus: old.status })
    old.pc.close()
    this.links.delete(old.peerId)
    const link = this.createLink(old.peerId, remoteId, 'troca')
    const member = this.client.state.members.find((m) => m.peerId === old.peerId)
    this.rewatch(link, !!member?.streaming)
    this.emit()
    return link
  }

  // ---------- log ----------

  /** Quem é a pessoa desta conexão, para o log. */
  private who(link: PeerLink): Record<string, unknown> {
    const name = this.client.state.members.find((m) => m.peerId === link.peerId)?.name
    return { peer: link.peerId, name, link: link.id, remote: link.remoteId }
  }

  /** Só registra que o ICE foi reiniciado (o ice-ufrag mudou), nunca o valor. */
  private noteUfrag(link: PeerLink, side: 'local' | 'remote', desc: RTCSessionDescriptionInit | null | undefined): void {
    const ufrag = iceUfrag(desc)
    if (!ufrag) return
    const before = side === 'local' ? link.localUfrag : link.remoteUfrag
    if (before && before !== ufrag) log.info('ICE reiniciado', { ...this.who(link), side })
    if (side === 'local') link.localUfrag = ufrag
    else link.remoteUfrag = ufrag
  }

  /** Uma linha por pessoa com vídeo indo ou vindo: qualidade, rede e rota. */
  private async logStats(): Promise<void> {
    for (const link of this.links.values()) {
      const sending = link.senders.length > 0
      const receiving = !!link.remote
      if (link.status !== 'conectado' || (!sending && !receiving)) continue
      try {
        const out = sending ? await link.logOut.sample() : undefined
        const inn = receiving ? await link.logIn.sample() : undefined
        const route = (out ?? inn)?.route
        log.info('estatísticas', {
          ...this.who(link),
          route: route ? `${route.localType}>${route.remoteType}/${route.protocol}/${route.ipVersion}` : undefined,
          rttMs: route?.rttMs,
          ...(out && {
            out: {
              res: out.width && out.height ? `${out.width}x${out.height}` : undefined,
              fps: out.fps,
              kbps: out.kbps,
              targetKbps: out.targetKbps,
              availableKbps: out.route?.availableKbps,
              capKbps: Math.round(link.governor.cap / 1000),
              codec: out.codec,
              hw: out.hardware,
              limitation: out.limitation
            }
          }),
          ...(inn && {
            in: {
              res: inn.width && inn.height ? `${inn.width}x${inn.height}` : undefined,
              fps: inn.fps,
              kbps: inn.kbps,
              lossPercent: inn.lossPercent,
              jitterMs: inn.jitterMs,
              framesDropped: inn.framesDropped,
              freezes: inn.freezeCount,
              codec: inn.codec,
              hw: inn.hardware
            }
          })
        })
      } catch {
        // Conexão fechando no meio da leitura.
      }
    }
  }

  // ---------- sinais ----------

  private signal(to: string, payload: Signal): void {
    const link = this.links.get(to)
    this.client.sendSignal(to, { ...payload, lid: link?.id, to: link?.remoteId })
  }

  private async onSignal(from: string, signal: Signal): Promise<void> {
    let link = this.links.get(from)
    if (!link) {
      const member = this.client.state.members.find((m) => m.peerId === from)
      if (!member || member.roomId !== this.roomId) return
      link = this.createLink(from, signal.lid, `sinal ${signal.k}`)
    }
    if (signal.lid) {
      if (signal.to && signal.to !== link.id) {
        // Era para uma conexão minha que já fechei.
        log.info('sinal para uma conexão antiga ignorado', { ...this.who(link), k: signal.k, to: signal.to })
        return
      }
      if (!signal.to && link.remoteId && link.remoteId !== signal.lid) link = this.replaceLink(link, signal.lid)
      link.remoteId = signal.lid
    }
    const { pc } = link

    try {
      if (signal.k === 'watch') {
        log.info(signal.on ? 'pediu para me assistir' : 'parou de me assistir', { ...this.who(link), streaming: !!this.local })
        link.theyWatch = signal.on
        if (signal.on && this.local) this.attach(link)
        if (!signal.on) this.detach(link)
        this.emit()
      } else if (signal.k === 'desc') {
        const offerCollision = signal.desc.type === 'offer' && (link.makingOffer || pc.signalingState !== 'stable')
        link.ignoreOffer = !link.polite && offerCollision
        if (offerCollision) {
          log.info('colisão de ofertas', { ...this.who(link), polite: link.polite, ignored: link.ignoreOffer, signaling: pc.signalingState })
        }
        if (link.ignoreOffer) return
        log.info('descrição recebida', { ...this.who(link), type: signal.desc.type })
        this.noteUfrag(link, 'remote', signal.desc)
        await pc.setRemoteDescription(this.withHints(signal.desc))
        if (signal.desc.type === 'offer') {
          await pc.setLocalDescription()
          this.noteUfrag(link, 'local', pc.localDescription)
          log.info('resposta enviada', this.who(link))
          this.signal(from, { k: 'desc', desc: pc.localDescription!.toJSON() })
        }
        await this.applySenderParameters(link)
      } else if (signal.k === 'ice') {
        if (signal.candidate?.candidate) countInto(link.remoteCandidates, candidateKind(signal.candidate.candidate))
        else {
          // Fim dos candidatos da outra pessoa: um resumo por tipo, sem endereços.
          log.info('candidatos da outra pessoa', { ...this.who(link), candidates: link.remoteCandidates })
          link.remoteCandidates = {}
        }
        try {
          await pc.addIceCandidate(signal.candidate ?? undefined)
        } catch (err) {
          if (!link.ignoreOffer) throw err
        }
      }
    } catch (err) {
      log.warn('sinal com problema', { ...this.who(link), k: signal.k, signaling: pc.signalingState, error: errorInfo(err) })
    }
  }

  /** As dicas de banda no SDP recebido valem para o que nós enviamos a essa pessoa. */
  private withHints(desc: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
    if (!desc.sdp) return desc
    const { preset } = this.settings
    return {
      type: desc.type,
      sdp: withMusicAudio(
        withBitrateHints(desc.sdp, {
          startKbps: preset.startKbps,
          minKbps: preset.minKbps,
          maxKbps: preset.maxBitrate / 1000
        })
      )
    }
  }

  // ---------- envio ----------

  private attach(link: PeerLink): void {
    if (!this.local || link.senders.length > 0) return
    const { stream } = this.local
    for (const track of stream.getTracks()) {
      const sender = link.pc.addTrack(track, stream)
      link.senders.push(sender)
      if (track.kind === 'video') {
        const transceiver = link.pc.getTransceivers().find((t) => t.sender === sender)
        if (transceiver) preferVideoCodecs(transceiver, CODECS[this.settings.codec].mime)
      }
    }
  }

  private detach(link: PeerLink): void {
    if (link.pc.connectionState === 'closed') return
    for (const sender of link.senders) link.pc.removeTrack(sender)
    link.senders = []
  }

  private applyTrackSettings(): void {
    const track = this.local?.stream.getVideoTracks()[0]
    if (!track) return
    const { preset } = this.settings
    track.contentHint = preset.contentHint
    track
      .applyConstraints({
        frameRate: { max: preset.fps },
        ...(preset.maxHeight ? { height: { max: preset.maxHeight } } : {})
      })
      .catch((err) => log.warn('não foi possível ajustar a captura', { error: errorInfo(err) }))
  }

  private async applySenderParameters(link: PeerLink): Promise<void> {
    const { preset, priority } = this.settings
    for (const sender of link.senders) {
      if (sender.track?.kind !== 'video') continue
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string }
      if (!params.encodings?.length) continue
      params.encodings[0].maxBitrate = Math.round(Math.min(link.governor.cap, link.governor.limit()))
      params.encodings[0].maxFramerate = preset.fps
      params.encodings[0].scaleResolutionDownBy = 1
      params.degradationPreference = PRIORITIES[priority].degradation
      try {
        await sender.setParameters(params)
      } catch (err) {
        log.warn('não foi possível ajustar o envio', { ...this.who(link), error: errorInfo(err) })
      }
    }
  }

  private async governBitrate(): Promise<void> {
    for (const link of this.links.values()) {
      if (link.senders.length === 0 || link.status !== 'conectado') continue
      const network = await link.outStats.network()
      if (!link.governor.update(network)) continue
      const now = Date.now()
      if (now - link.governorLoggedAt >= GOVERNOR_LOG_MS) {
        link.governorLoggedAt = now
        log.info('limite de banda ajustado', {
          ...this.who(link),
          capKbps: Math.round(link.governor.cap / 1000),
          rttMs: network.rttMs,
          lossPercent: network.fractionLost !== undefined ? Math.round(network.fractionLost * 1000) / 10 : undefined,
          jitterMs: network.jitterMs
        })
      }
      await this.applySenderParameters(link)
    }
  }
}
