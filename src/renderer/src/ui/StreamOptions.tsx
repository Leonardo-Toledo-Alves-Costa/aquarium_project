import { useRef, useState } from 'react'
import { formatDiagnostics } from '../diagnostics'
import { PRESETS, PRIORITIES, type PresetId, type Priority } from '../rtc/presets'
import type { RoomSession } from '../rtc/room-session'
import { updateSettings, useSettings, type AudioMode } from '../settings'
import { copyText, useDismiss } from './hooks'

export const AUDIO_OPTIONS: { id: AudioMode; label: string; hint: string }[] = [
  { id: 'app', label: 'Só o app transmitido', hint: 'o som do jogo ou programa, nada mais' },
  { id: 'all', label: 'Todos os apps', hint: 'tudo que toca no PC, menos os bloqueados' },
  { id: 'none', label: 'Sem áudio', hint: 'só a imagem' }
]

/** Diagnóstico de cada pessoa que assiste a sua transmissão, para colar numa conversa. */
export async function ownDiagnostics(session: RoomSession, nameOf: (peerId: string) => string): Promise<string> {
  const track = session.local?.stream.getVideoTracks()[0]
  const s = track?.getSettings()
  const parts: string[] = []
  for (const link of session.links.values()) {
    if (link.senders.length === 0) continue
    parts.push(
      formatDiagnostics(
        {
          role: 'transmitindo',
          viewer: nameOf(link.peerId),
          settings: session.currentSettings,
          codec: session.currentSettings.codec,
          capture: { width: s?.width, height: s?.height, fps: s?.frameRate }
        },
        await link.outStats.sample()
      )
    )
  }
  return parts.join('\n\n') || 'Ninguém está assistindo agora.'
}

/** Áudio e qualidade da sua transmissão, aberto pelo rodapé da barra lateral. */
export function StreamOptions({
  session,
  nameOf,
  toggle,
  onClose
}: {
  session: RoomSession
  nameOf: (peerId: string) => string
  toggle: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}): React.JSX.Element {
  const settings = useSettings()
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose, true, toggle)

  return (
    <div ref={ref} className="popover stream-options" role="dialog" aria-label="Áudio e qualidade da sua transmissão">
      <div className="popover-title">
        <span className="live-pill">AO VIVO</span> Sua transmissão · {session.local?.label}
      </div>

      <fieldset className="options-group">
        <legend className="section-label">Áudio</legend>
        {AUDIO_OPTIONS.map((o) => (
          <label key={o.id} className={`option ${settings.audioMode === o.id ? 'on' : ''}`} htmlFor={`audio-${o.id}`}>
            <input
              type="radio"
              id={`audio-${o.id}`}
              name="audio-mode"
              checked={settings.audioMode === o.id}
              onChange={() => updateSettings({ audioMode: o.id })}
            />
            <span className="option-text">
              <span>{o.label}</span>
              <span className="option-hint">{o.hint}</span>
            </span>
          </label>
        ))}
        <p className="field-hint">Discord e Aquarium nunca entram na transmissão, para não dar retorno.</p>
      </fieldset>

      <div className="slider-field">
        <label htmlFor="send-volume">
          <span>Volume enviado</span>
          <span>{Math.round(settings.sendVolume * 100)}%</span>
        </label>
        <input
          id="send-volume"
          type="range"
          min={0}
          max={150}
          step={5}
          value={Math.round(settings.sendVolume * 100)}
          disabled={settings.audioMode === 'none'}
          onChange={(e) => updateSettings({ sendVolume: Number(e.target.value) / 100 })}
        />
      </div>

      <div className="options-sep" />

      <div className="options-group">
        <span className="section-label">Qualidade</span>
        <div className="field">
          <label htmlFor="q-preset">Tipo de conteúdo</label>
          <select
            id="q-preset"
            value={settings.presetId}
            onChange={(e) => {
              const id = e.target.value as PresetId
              updateSettings({ presetId: id, priority: PRESETS[id].defaultPriority })
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
          <label htmlFor="q-priority">Quando faltar banda</label>
          <select id="q-priority" value={settings.priority} onChange={(e) => updateSettings({ priority: e.target.value as Priority })}>
            {(Object.keys(PRIORITIES) as Priority[]).map((id) => (
              <option key={id} value={id}>
                {PRIORITIES[id].label}: {PRIORITIES[id].description}
              </option>
            ))}
          </select>
        </div>
        <BandwidthPicker />
      </div>

      <button
        className="btn ghost"
        onClick={async () => {
          if (await copyText(await ownDiagnostics(session, nameOf))) setCopied(true)
        }}
      >
        {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
      </button>
    </div>
  )
}

export function BandwidthPicker(): React.JSX.Element {
  const settings = useSettings()
  const options: { value: 'auto' | number; label: string }[] = [
    { value: 'auto', label: 'Automático' },
    { value: 6, label: '6 Mbps' },
    { value: 10, label: '10 Mbps' },
    { value: 16, label: '16 Mbps' }
  ]
  return (
    <div className="field">
      <span id="bw-label" className="field-label">
        Limite de banda por pessoa assistindo
      </span>
      <div role="radiogroup" aria-labelledby="bw-label" className="pills">
        {options.map((o) => (
          <button
            key={o.label}
            role="radio"
            aria-checked={settings.bandwidth === o.value}
            className={`pill ${settings.bandwidth === o.value ? 'on' : ''}`}
            onClick={() => updateSettings({ bandwidth: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>
      {settings.bandwidth === 'auto' && (
        <span className="field-hint">No automático, o Aquarium baixa o teto quando a rede começa a atrasar, para evitar travamentos.</span>
      )}
    </div>
  )
}
