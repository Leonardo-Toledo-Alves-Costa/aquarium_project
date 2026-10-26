import { useEffect, useReducer, useRef, useState } from 'react'
import type { CaptureSource } from '../../../shared/ipc'
import { CopyBox, CopyDiagnosticsButton, FailureHelp, StatsLine, StatusChip, useStats } from '../components/common'
import { formatDiagnostics } from '../diagnostics'
import { Broadcaster, type ViewerSlot } from '../rtc/broadcaster'
import {
  CODECS,
  PRESETS,
  PRIORITIES,
  type CodecChoice,
  type PresetId,
  type Priority,
  type StreamSettings
} from '../rtc/presets'
import { CodeError, decodeDescription, encodeDescription } from '../signaling/manual'

export function TransmitView(): React.JSX.Element {
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [settings, setSettings] = useState<StreamSettings>({
    preset: PRESETS.jogo,
    priority: PRESETS.jogo.defaultPriority,
    codec: 'auto'
  })
  const [broadcaster, setBroadcaster] = useState<Broadcaster | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const broadcasterRef = useRef<Broadcaster | null>(null)

  const loadSources = (): void => {
    window.aquarium
      .listSources()
      .then(setSources)
      .catch(() => setError('Não foi possível listar as telas e janelas.'))
  }

  useEffect(loadSources, [])

  useEffect(() => {
    broadcasterRef.current = broadcaster
    if (!broadcaster) return
    return broadcaster.subscribe(rerender)
  }, [broadcaster])

  // Ao sair da tela, encerra a transmissão.
  useEffect(() => () => broadcasterRef.current?.stop(), [])

  const start = async (): Promise<void> => {
    if (!sourceId) return
    setBusy(true)
    setError(null)
    try {
      await window.aquarium.selectSource(sourceId)
      setBroadcaster(await Broadcaster.start(settings))
    } catch (err) {
      console.error(err)
      setError('Não foi possível capturar essa fonte. Tente outra tela ou janela.')
    } finally {
      setBusy(false)
    }
  }

  const changeSettings = (changes: Partial<StreamSettings>): void => {
    const next = { ...settings, ...changes }
    setSettings(next)
    if (broadcaster && !broadcaster.stopped) broadcaster.update(next)
  }

  const stop = (): void => {
    broadcaster?.stop()
    setBroadcaster(null)
    loadSources()
  }

  const addViewer = async (): Promise<void> => {
    if (!broadcaster) return
    setBusy(true)
    try {
      await broadcaster.addViewer()
    } finally {
      setBusy(false)
    }
  }

  const live = !!broadcaster && !broadcaster.stopped
  const controls = <QualityControls settings={settings} live={live} onChange={changeSettings} />

  if (!live) {
    return (
      <section className="stack">
        <div className="section-head">
          <h1>Escolha o que transmitir</h1>
          <button className="ghost" onClick={loadSources}>
            Atualizar lista
          </button>
        </div>
        {broadcaster?.stopped && <p className="help">A transmissão terminou porque a janela capturada foi fechada.</p>}
        {sources === null ? (
          <p className="muted">Carregando telas e janelas…</p>
        ) : (
          <div className="source-grid">
            {sources.map((s) => (
              <button
                key={s.id}
                className={`source ${s.id === sourceId ? 'selected' : ''}`}
                onClick={() => setSourceId(s.id)}
                aria-pressed={s.id === sourceId}
              >
                <img src={s.thumbnail} alt="" />
                <span className="source-kind">{s.kind === 'screen' ? 'Tela' : 'Janela'}</span>
                <span className="source-name">{s.name}</span>
              </button>
            ))}
          </div>
        )}
        {controls}
        <div className="row">
          <button className="primary big" disabled={!sourceId || busy} onClick={start}>
            {busy ? 'Iniciando…' : 'Começar a transmitir'}
          </button>
        </div>
        <p className="muted small">
          Em jogos, use o modo "janela sem borda": a tela cheia exclusiva pode aparecer preta para quem assiste.
          {' No modo manual vai só a imagem, sem áudio.'}
        </p>
        {error && <p className="help bad">{error}</p>}
      </section>
    )
  }

  return (
    <section className="stack">
      <div className="section-head">
        <h1>Transmitindo</h1>
        <button className="danger" onClick={stop}>
          Parar transmissão
        </button>
      </div>

      <div className="live">
        <Preview stream={broadcaster.stream} />
        <div className="stack">
          {controls}
          <p className="muted small">
            {broadcaster.hasAudio ? 'Com áudio do sistema.' : 'Sem áudio.'} Cada espectador recebe uma cópia do vídeo;
            o mesh funciona bem até 3 ou 4 pessoas.
          </p>
          <button className="primary" disabled={busy} onClick={addViewer}>
            {busy ? 'Gerando convite…' : 'Adicionar espectador'}
          </button>
        </div>
      </div>

      {broadcaster.viewers.length === 0 ? (
        <p className="muted">Ninguém assistindo ainda. Clique em "Adicionar espectador" para gerar um convite.</p>
      ) : (
        <div className="stack">
          {broadcaster.viewers.map((slot) => (
            <ViewerCard key={slot.id} slot={slot} broadcaster={broadcaster} />
          ))}
        </div>
      )}
    </section>
  )
}

function QualityControls({
  settings,
  live,
  onChange
}: {
  settings: StreamSettings
  live: boolean
  onChange: (changes: Partial<StreamSettings>) => void
}): React.JSX.Element {
  return (
    <div className="controls">
      <div className="field">
        <label className="field-label" htmlFor="preset">
          Qualidade
        </label>
        <select
          id="preset"
          value={settings.preset.id}
          onChange={(e) => {
            const preset = PRESETS[e.target.value as PresetId]
            onChange({ preset, priority: preset.defaultPriority })
          }}
        >
          {Object.values(PRESETS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.description}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="priority">
          Quando faltar banda
        </label>
        <select
          id="priority"
          value={settings.priority}
          onChange={(e) => onChange({ priority: e.target.value as Priority })}
        >
          {(Object.keys(PRIORITIES) as Priority[]).map((id) => (
            <option key={id} value={id}>
              {PRIORITIES[id].label}: {PRIORITIES[id].description}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="codec">
          Codec{live && ' (vale para os próximos espectadores)'}
        </label>
        <select id="codec" value={settings.codec} onChange={(e) => onChange({ codec: e.target.value as CodecChoice })}>
          {(Object.keys(CODECS) as CodecChoice[]).map((id) => (
            <option key={id} value={id}>
              {CODECS[id].label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function Preview({ stream }: { stream: MediaStream }): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return <video ref={ref} className="preview" autoPlay muted playsInline />
}

function ViewerCard({ slot, broadcaster }: { slot: ViewerSlot; broadcaster: Broadcaster }): React.JSX.Element {
  const [invite, setInvite] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  const stats = useStats(slot.stats, slot.status === 'conectado' || slot.status === 'instavel')

  useEffect(() => {
    encodeDescription(slot.offer).then(setInvite)
  }, [slot.offer])

  const connect = async (): Promise<void> => {
    setError(null)
    try {
      await broadcaster.acceptAnswer(slot.id, await decodeDescription(reply, 'answer'))
    } catch (err) {
      setError(err instanceof CodeError ? err.message : 'Não foi possível usar essa resposta. Gere um convite novo.')
    }
  }

  const diagnostics = (): string =>
    formatDiagnostics(
      {
        role: 'transmitindo',
        viewer: slot.label,
        settings: broadcaster.settings,
        codec: slot.codec,
        capture: broadcaster.capture
      },
      stats
    )

  return (
    <article className="card">
      <div className="card-head">
        <h2>{slot.label}</h2>
        <StatusChip status={slot.status} />
        <div className="card-actions">
          {slot.answered && <CopyDiagnosticsButton build={diagnostics} />}
          <button className="ghost small" onClick={() => broadcaster.removeViewer(slot.id)}>
            Remover
          </button>
        </div>
      </div>

      {!slot.answered && (
        <div className="pair">
          <CopyBox label="1. Mande este convite para quem vai assistir" value={invite || 'Gerando…'} />
          <div className="field">
            <label className="field-label" htmlFor={`reply-${slot.id}`}>
              2. Cole aqui a resposta que a pessoa devolver
            </label>
            <textarea
              id={`reply-${slot.id}`}
              className="code"
              rows={3}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="AQ1.R…"
            />
            <button className="primary" disabled={!reply.trim()} onClick={connect}>
              Conectar
            </button>
          </div>
        </div>
      )}

      {error && <p className="help bad">{error}</p>}
      {slot.status === 'falhou' && <FailureHelp />}
      <StatsLine sample={stats} />
    </article>
  )
}
