import { useEffect, useRef, useState } from 'react'
import type { CaptureSource } from '../../../shared/ipc'
import { PRESETS, type PresetId } from '../rtc/presets'
import { updateSettings, useSettings, type AudioMode } from '../settings'
import { useDismiss } from './hooks'
import { IconClose } from './icons'

// Janelas que não fazem sentido transmitir.
const HIDDEN_WINDOWS = /^(Aquarium|NVIDIA GeForce Overlay.*|Nova notificação|Program Manager)$/i

export function SourcePicker({ onPick, onClose }: { onPick: (source: CaptureSource) => void; onClose: () => void }): React.JSX.Element {
  const settings = useSettings()
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)

  const load = (): void => {
    window.aquarium
      .listSources()
      .then((list) => setSources(list.filter((s) => s.kind === 'screen' || !HIDDEN_WINDOWS.test(s.name))))
      .catch(() => setError('Não foi possível listar as telas e janelas.'))
  }
  useEffect(load, [])

  const source = sources?.find((s) => s.id === selected)

  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal picker" role="dialog" aria-label="Escolher o que transmitir">
        <div className="modal-head">
          <h2>O que você quer transmitir?</h2>
          <button className="btn ghost small" onClick={load}>
            Atualizar
          </button>
          <button className="icon-btn" aria-label="Fechar" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>

        {sources === null ? (
          <p className="muted">Carregando telas e janelas…</p>
        ) : (
          <div className="source-grid">
            {sources.map((s) => (
              <button
                key={s.id}
                className={`source ${s.id === selected ? 'selected' : ''}`}
                aria-pressed={s.id === selected}
                onClick={() => setSelected(s.id)}
                onDoubleClick={() => onPick(s)}
              >
                <img src={s.thumbnail} alt="" />
                <span className="source-kind">{s.kind === 'screen' ? 'Tela' : 'Janela'}</span>
                <span className="source-name">{s.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="picker-options">
          <div className="field">
            <label htmlFor="pk-preset">Qualidade</label>
            <select
              id="pk-preset"
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
            <label htmlFor="pk-audio">Áudio</label>
            <select id="pk-audio" value={settings.audioMode} onChange={(e) => updateSettings({ audioMode: e.target.value as AudioMode })}>
              <option value="app">Só o app transmitido</option>
              <option value="all">Todos os apps (menos Discord e Aquarium)</option>
              <option value="none">Sem áudio</option>
            </select>
          </div>
        </div>
        {source?.kind === 'screen' && settings.audioMode === 'app' && (
          <p className="field-hint">Com a tela inteira não existe "o app transmitido": vai o áudio de todos os apps, menos Discord e Aquarium.</p>
        )}
        <p className="field-hint">Em jogos, use o modo "janela sem borda": a tela cheia exclusiva pode aparecer preta para quem assiste.</p>
        {error && <p className="alert">{error}</p>}

        <div className="choice-row end">
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!source} onClick={() => source && onPick(source)}>
            Transmitir
          </button>
        </div>
      </div>
    </div>
  )
}
