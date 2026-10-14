import { useEffect, useRef, useState } from 'react'
import { describeRoute, LIMITATION_TEXT, mbps, num } from '../diagnostics'
import type { PeerStatus } from '../rtc/peer'
import { isDownscaled, type StatsSample, type StatsSampler } from '../rtc/stats'

const STATUS_TEXT: Record<PeerStatus, string> = {
  aguardando: 'Aguardando resposta',
  conectando: 'Conectando…',
  conectado: 'Conectado',
  instavel: 'Conexão instável',
  falhou: 'Não conectou',
  encerrado: 'Encerrado'
}

export function StatusChip({ status }: { status: PeerStatus }): React.JSX.Element {
  return <span className={`chip chip-${status}`}>{STATUS_TEXT[status]}</span>
}

export function FailureHelp(): React.JSX.Element {
  return (
    <p className="help bad">
      A conexão direta não funcionou. O mais provável é que um dos dois esteja atrás de CGNAT simétrico. Anote esse par
      no resultado do teste: esse caso precisa da opção B (relay próprio) ou C (rede privada).
    </p>
  )
}

async function copyText(text: string, fallback: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    fallback?.select()
    return false
  }
}

export function CopyBox({ label, value }: { label: string; value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  const copy = async (): Promise<void> => {
    if (await copyText(value, ref.current)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <textarea ref={ref} className="code" readOnly value={value} rows={3} onFocus={(e) => e.currentTarget.select()} />
      <button className="primary" onClick={copy}>
        {copied ? 'Copiado' : 'Copiar código'}
      </button>
    </div>
  )
}

/** Copia o diagnóstico na hora do clique, com os dados mais recentes. */
export function CopyDiagnosticsButton({ build }: { build: () => string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    if (await copyText(build(), null)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  return (
    <button className="ghost small" onClick={copy}>
      {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
    </button>
  )
}

export function useStats(sampler: StatsSampler, active: boolean): StatsSample | null {
  const [sample, setSample] = useState<StatsSample | null>(null)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const tick = (): void => {
      sampler.sample().then((s) => {
        if (!cancelled) setSample(s)
      })
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sampler, active])
  return sample
}

export function StatsLine({ sample }: { sample: StatsSample | null }): React.JSX.Element | null {
  if (!sample) return null
  const items: string[] = []
  const warnings: string[] = []

  const route = describeRoute(sample)
  if (route) items.push(route)

  if (sample.width && sample.height) {
    items.push(
      isDownscaled(sample)
        ? `${sample.width}×${sample.height} de ${sample.sourceWidth}×${sample.sourceHeight}`
        : `${sample.width}×${sample.height}`
    )
  }
  if (sample.fps !== undefined) items.push(`${Math.round(sample.fps)} fps`)
  if (sample.kbps !== undefined) items.push(mbps(sample.kbps))
  if (sample.route?.availableKbps !== undefined) items.push(`banda estimada ${mbps(sample.route.availableKbps)}`)
  if (sample.codec) {
    const impl = sample.implementation ? ` (${sample.implementation}${sample.hardware ? ', GPU' : ''})` : ''
    items.push(`${sample.codec}${impl}`)
  }
  if (sample.lossPercent) items.push(`perda ${num(sample.lossPercent)}%`)
  if (sample.freezeCount) items.push(`${sample.freezeCount} travamentos`)

  const reason = sample.limitation && sample.limitation !== 'none' ? sample.limitation : undefined
  const cause = reason === 'other' ? 'por outro motivo' : reason ? `por falta de ${LIMITATION_TEXT[reason]}` : ''
  if (isDownscaled(sample)) {
    warnings.push(`resolução reduzida ${cause}`.trim())
  } else if (reason) {
    warnings.push(`qualidade limitada ${cause}`)
  }

  return (
    <div className="stats">
      <span>{items.join('  ·  ')}</span>
      {warnings.map((w) => (
        <span key={w} className="stats-warn">
          {w}
        </span>
      ))}
    </div>
  )
}
