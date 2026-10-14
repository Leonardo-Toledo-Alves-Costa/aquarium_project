import { useEffect, useReducer, useRef, useState } from 'react'
import { CopyBox, CopyDiagnosticsButton, FailureHelp, StatsLine, StatusChip, useStats } from '../components/common'
import { formatDiagnostics } from '../diagnostics'
import { Receiver } from '../rtc/receiver'
import { CodeError, decodeDescription, encodeDescription } from '../signaling/manual'

export function WatchView(): React.JSX.Element {
  const [invite, setInvite] = useState('')
  const [reply, setReply] = useState<string | null>(null)
  const [receiver, setReceiver] = useState<Receiver | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const receiverRef = useRef<Receiver | null>(null)

  useEffect(() => {
    receiverRef.current = receiver
    if (!receiver) return
    return receiver.subscribe(rerender)
  }, [receiver])

  useEffect(() => () => receiverRef.current?.close(), [])

  const generateReply = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const next = new Receiver()
    try {
      const offer = await decodeDescription(invite, 'offer')
      const answer = await next.answer(offer)
      receiverRef.current?.close()
      setReceiver(next)
      setReply(await encodeDescription(answer))
    } catch (err) {
      next.close()
      setError(err instanceof CodeError ? err.message : 'Não foi possível usar esse convite. Peça um convite novo.')
    } finally {
      setBusy(false)
    }
  }

  const reset = (): void => {
    receiver?.close()
    setReceiver(null)
    setReply(null)
    setInvite('')
  }

  const status = receiver?.status
  const playing = status === 'conectado' || status === 'instavel'

  if (receiver && playing) {
    return <Player receiver={receiver} onLeave={reset} />
  }

  return (
    <section className="stack narrow">
      <h1>Assistir uma transmissão</h1>

      {!reply ? (
        <div className="field">
          <label className="field-label" htmlFor="invite">
            1. Cole o convite que te mandaram
          </label>
          <textarea
            id="invite"
            className="code"
            rows={4}
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            placeholder="AQ1.C…"
          />
          <button className="primary" disabled={!invite.trim() || busy} onClick={generateReply}>
            {busy ? 'Gerando resposta…' : 'Gerar resposta'}
          </button>
        </div>
      ) : (
        <>
          <CopyBox label="2. Mande esta resposta de volta para quem está transmitindo" value={reply} />
          <div className="row">
            {status && <StatusChip status={status} />}
            <span className="muted small">A imagem aparece assim que a pessoa colar a resposta.</span>
          </div>
          {status === 'falhou' && <FailureHelp />}
          <button className="ghost" onClick={reset}>
            Usar outro convite
          </button>
        </>
      )}

      {error && <p className="help bad">{error}</p>}
    </section>
  )
}

function Player({ receiver, onLeave }: { receiver: Receiver; onLeave: () => void }): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [muted, setMuted] = useState(false)
  const [showStats, setShowStats] = useState(true)
  const stats = useStats(receiver.stats, true)

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = receiver.stream
  }, [receiver.stream])

  const fullscreen = (): void => {
    if (document.fullscreenElement) document.exitFullscreen()
    else frameRef.current?.requestFullscreen()
  }

  return (
    <section className="player">
      <div className="player-frame" ref={frameRef} onDoubleClick={fullscreen}>
        <video ref={videoRef} autoPlay playsInline muted={muted} />
      </div>
      <div className="player-bar">
        <StatusChip status={receiver.status} />
        <button className="ghost" onClick={() => setMuted((m) => !m)}>
          {muted ? 'Ativar som' : 'Silenciar'}
        </button>
        <button className="ghost" onClick={fullscreen}>
          Tela cheia
        </button>
        <button className="ghost" onClick={() => setShowStats((s) => !s)}>
          {showStats ? 'Ocultar dados da conexão' : 'Mostrar dados da conexão'}
        </button>
        <CopyDiagnosticsButton build={() => formatDiagnostics({ role: 'assistindo' }, stats)} />
        <button className="danger" onClick={onLeave}>
          Sair
        </button>
      </div>
      {showStats && <StatsLine sample={stats} />}
    </section>
  )
}
