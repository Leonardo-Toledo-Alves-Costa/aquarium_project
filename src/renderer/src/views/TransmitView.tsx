import { useEffect, useReducer, useRef, useState } from 'react'
import type { CaptureSource } from '../../../shared/ipc'
import { CopyBox, FailureHelp, StatsLine, StatusChip, useStats } from '../components/common'
import { Broadcaster, type ViewerSlot } from '../rtc/broadcaster'
import { PRESETS, type PresetId } from '../rtc/presets'
import { CodeError, decodeDescription, encodeDescription } from '../signaling/manual'

export function TransmitView(): React.JSX.Element {
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [presetId, setPresetId] = useState<PresetId>('jogo')
  const [broadcaster, setBroadcaster] = useState<Broadcaster | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const broadcasterRef = useRef<Broadcaster | null>(null)

  const loadSources = (): void => {
    window.aquario
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
      await window.aquario.selectSource(sourceId)
      setBroadcaster(await Broadcaster.start(PRESETS[presetId]))
    } catch (err) {
      console.error(err)
      setError('Não foi possível capturar essa fonte. Tente outra tela ou janela.')
    } finally {
      setBusy(false)
    }
  }

  const changePreset = (id: PresetId): void => {
    setPresetId(id)
    broadcaster?.setPreset(PRESETS[id])
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

  const presetPicker = (
    <div className="field">
      <label className="field-label" htmlFor="preset">
        Qualidade
      </label>
      <select id="preset" value={presetId} onChange={(e) => changePreset(e.target.value as PresetId)}>
        {Object.values(PRESETS).map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} · {p.description}
          </option>
        ))}
      </select>
    </div>
  )

  if (!broadcaster || broadcaster.stopped) {
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
        <div className="row">
          {presetPicker}
          <button className="primary big" disabled={!sourceId || busy} onClick={start}>
            {busy ? 'Iniciando…' : 'Começar a transmitir'}
          </button>
        </div>
        <p className="muted small">
          Em jogos, use o modo "janela sem borda": a tela cheia exclusiva pode aparecer preta para quem assiste.
          {window.aquario.platform === 'win32' && ' O áudio do computador inteiro vai junto com a imagem.'}
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
          {presetPicker}
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

  return (
    <article className="card">
      <div className="card-head">
        <h2>{slot.label}</h2>
        <StatusChip status={slot.status} />
        <button className="ghost small" onClick={() => broadcaster.removeViewer(slot.id)}>
          Remover
        </button>
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
