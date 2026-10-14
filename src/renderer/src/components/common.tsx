import { useEffect, useRef, useState } from 'react'
import type { PeerStatus } from '../rtc/peer'
import type { StatsSample, StatsSampler } from '../rtc/stats'

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

export function CopyBox({ label, value }: { label: string; value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      ref.current?.select()
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

const LIMITATION_TEXT: Record<string, string> = {
  cpu: 'qualidade limitada pela CPU/GPU',
  bandwidth: 'qualidade limitada pela banda',
  other: 'qualidade limitada (outro motivo)'
}

export function StatsLine({ sample }: { sample: StatsSample | null }): React.JSX.Element | null {
  if (!sample) return null
  const { route } = sample
  const items: string[] = []

  if (route) {
    items.push(
      route.direct
        ? `Direto · ${route.ipVersion} · ${route.localType} → ${route.remoteType}`
        : `Relay · ${route.ipVersion}`
    )
    if (route.rttMs !== undefined) items.push(`${route.rttMs} ms de ida e volta`)
  }
  if (sample.width && sample.height) items.push(`${sample.width}×${sample.height}`)
  if (sample.fps !== undefined) items.push(`${Math.round(sample.fps)} fps`)
  if (sample.kbps !== undefined) items.push(`${(sample.kbps / 1000).toFixed(1).replace('.', ',')} Mbps`)
  if (sample.codec) {
    const impl = sample.implementation ? ` (${sample.implementation}${sample.hardware ? ', GPU' : ''})` : ''
    items.push(`${sample.codec}${impl}`)
  }
  if (sample.packetsLost) items.push(`${sample.packetsLost} pacotes perdidos`)
  if (sample.jitterMs !== undefined) items.push(`jitter ${sample.jitterMs} ms`)

  const limitation = sample.limitation ? LIMITATION_TEXT[sample.limitation] : undefined

  return (
    <div className="stats">
      <span>{items.join('  ·  ')}</span>
      {limitation && <span className="stats-warn">{limitation}</span>}
    </div>
  )
}
