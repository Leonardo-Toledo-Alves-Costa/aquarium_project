import type { CaptureInfo } from './rtc/broadcaster'
import { CODECS, PRIORITIES, type CodecChoice, type StreamSettings } from './rtc/presets'
import type { StatsSample } from './rtc/stats'

export const num = (n: number): string => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
export const mbps = (kbps: number): string => `${num(kbps / 1000)} Mbps`

export const LIMITATION_TEXT: Record<string, string> = {
  cpu: 'CPU/GPU',
  bandwidth: 'banda',
  other: 'outro motivo'
}

export function describeRoute(sample: StatsSample): string | undefined {
  const r = sample.route
  if (!r) return undefined
  const kind = r.direct ? `Direto · ${r.ipVersion} · ${r.localType} → ${r.remoteType}` : `Relay · ${r.ipVersion}`
  return `${kind} · ${r.protocol?.toUpperCase() ?? '?'}${r.rttMs !== undefined ? ` · ${r.rttMs} ms de ida e volta` : ''}`
}

function size(w?: number, h?: number): string {
  return w && h ? `${w}×${h}` : '?'
}

function codecLine(sample: StatsSample): string | undefined {
  if (!sample.codec) return undefined
  const extra = [sample.implementation, sample.hardware ? 'GPU' : undefined].filter(Boolean).join(', ')
  return extra ? `${sample.codec} (${extra})` : sample.codec
}

interface SenderContext {
  role: 'transmitindo'
  viewer: string
  settings: StreamSettings
  /** Codec escolhido quando esse espectador foi adicionado. */
  codec: CodecChoice
  capture: CaptureInfo
}

interface ReceiverContext {
  role: 'assistindo'
}

/** Texto para colar no grupo quando a qualidade não estiver boa. */
export function formatDiagnostics(context: SenderContext | ReceiverContext, sample: StatsSample | null): string {
  const lines = [
    `Aquarium ${__APP_VERSION__} · diagnóstico (${context.role}) · ${new Date().toLocaleString('pt-BR')}`,
    `Sistema: ${window.aquarium.platform}`
  ]

  if (context.role === 'transmitindo') {
    const { preset, priority } = context.settings
    lines.push(`Espectador: ${context.viewer}`)
    lines.push(
      `Configuração: ${preset.label} · prioridade ${PRIORITIES[priority].label} · codec ${CODECS[context.codec].label}`
    )
    lines.push(`Captura: ${size(context.capture.width, context.capture.height)} a ${num(context.capture.fps ?? 0)} fps`)
  }

  if (!sample) {
    lines.push('Sem dados de conexão ainda.')
    return lines.join('\n')
  }

  lines.push(`Rota: ${describeRoute(sample) ?? '?'}`)
  const verb = context.role === 'transmitindo' ? 'Enviando' : 'Recebendo'
  const parts = [`${size(sample.width, sample.height)} a ${num(sample.fps ?? 0)} fps`]
  if (sample.kbps !== undefined) parts.push(mbps(sample.kbps))
  if (sample.targetKbps !== undefined) parts.push(`alvo ${mbps(sample.targetKbps)}`)
  if (sample.route?.availableKbps !== undefined) parts.push(`banda estimada ${mbps(sample.route.availableKbps)}`)
  lines.push(`${verb}: ${parts.join(' · ')}`)
  const codec = codecLine(sample)
  if (codec) lines.push(`Codec: ${codec}`)

  if (context.role === 'transmitindo') {
    if (sample.sourceHeight) {
      lines.push(`Saindo da captura: ${size(sample.sourceWidth, sample.sourceHeight)} a ${num(sample.sourceFps ?? 0)} fps`)
    }
    lines.push(`Limitação agora: ${sample.limitation && sample.limitation !== 'none' ? LIMITATION_TEXT[sample.limitation] : 'nenhuma'}`)
    if (sample.limitationSeconds) {
      const t = sample.limitationSeconds
      lines.push(`Tempo limitado: banda ${num(t.bandwidth)} s · CPU/GPU ${num(t.cpu)} s · outro ${num(t.other)} s`)
    }
  } else {
    const extra: string[] = []
    if (sample.lossPercent !== undefined) extra.push(`perda ${num(sample.lossPercent)}%`)
    if (sample.jitterMs !== undefined) extra.push(`jitter ${sample.jitterMs} ms`)
    if (sample.framesDropped !== undefined) extra.push(`quadros descartados ${sample.framesDropped}`)
    if (sample.freezeCount !== undefined) extra.push(`travamentos ${sample.freezeCount} (${num(sample.freezeSeconds ?? 0)} s)`)
    if (extra.length) lines.push(`Recepção: ${extra.join(' · ')}`)
  }

  return lines.join('\n')
}
