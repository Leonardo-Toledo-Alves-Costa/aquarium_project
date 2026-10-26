// Limite automático de banda por espectador.
// O WebRTC só percebe a rede cheia quando os pacotes já estão atrasando; em links longos
// isso aparece como travamentos. Aqui o teto desce rápido quando o atraso ou a perda sobem
// e volta a subir devagar quando a rede fica estável.

export type BandwidthMode = 'auto' | number // número = teto fixo em Mbps

export interface NetworkSample {
  rttMs?: number
  /** Fração de pacotes perdidos informada por quem recebe (0 a 1). */
  fractionLost?: number
  /** Jitter informado por quem recebe, em ms. */
  jitterMs?: number
}

/** Amostras de atraso guardadas: ~1 minuto, com uma leitura a cada ~2 s. */
const RTT_WINDOW = 30

export class BitrateGovernor {
  /** Teto atual em bits por segundo. */
  cap: number
  /** Atrasos do último minuto: a base é o menor deles, e não o menor desde sempre. */
  private rtts: number[] = []
  private stableTicks = 0

  constructor(
    private readonly presetMax: () => number,
    private readonly mode: () => BandwidthMode
  ) {
    this.cap = this.limit()
  }

  /** Teto máximo possível agora: o da qualidade escolhida ou o fixo, o que for menor. */
  limit(): number {
    const mode = this.mode()
    return mode === 'auto' ? this.presetMax() : Math.min(this.presetMax(), mode * 1_000_000)
  }

  private floor(): number {
    return Math.max(800_000, this.limit() * 0.2)
  }

  /** Chamado a cada ~2 s. Devolve true quando o teto mudou o suficiente para reaplicar. */
  update(sample: NetworkSample): boolean {
    const before = this.cap
    const limit = this.limit()

    if (this.mode() !== 'auto') {
      this.cap = limit
      return Math.abs(this.cap - before) > before * 0.05
    }

    // Leitura zerada (antes de a rota estabilizar) não vira base: com ela, qualquer rota
    // de 45 ms pareceria congestionada para sempre e o teto nunca mais subiria.
    const rtt = sample.rttMs !== undefined && sample.rttMs > 0 ? sample.rttMs : undefined
    if (rtt !== undefined) {
      this.rtts.push(rtt)
      if (this.rtts.length > RTT_WINDOW) this.rtts.shift()
    }
    const baseRtt = Math.min(...this.rtts)
    const rttRise = rtt !== undefined ? rtt - baseRtt : 0
    const congested = rttRise > Math.max(40, baseRtt) || (sample.fractionLost ?? 0) > 0.05 || (sample.jitterMs ?? 0) > 60

    if (congested) {
      this.cap = Math.max(this.floor(), this.cap * 0.75)
      this.stableTicks = 0
    } else if (++this.stableTicks >= 3) {
      // ~6 s estável: sobe 15%. Do piso ao teto leva pouco mais de um minuto.
      this.cap = Math.min(limit, this.cap * 1.15)
      this.stableTicks = 0
    }
    this.cap = Math.min(this.cap, limit)
    return Math.abs(this.cap - before) > before * 0.05
  }
}
