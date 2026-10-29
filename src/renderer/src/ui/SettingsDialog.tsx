import { useRef, useState } from 'react'
import { CODECS, PRESETS, PRIORITIES, type CodecChoice, type PresetId, type Priority } from '../rtc/presets'
import { DEFAULT_SERVER, serverUrlOf, updateSettings, useSettings, type AudioMode } from '../settings'
import type { RoomClient } from '../signaling/rooms'
import { copyText, useDismiss } from './hooks'
import { IconClose, IconLock } from './icons'
import { playSound } from './sounds'
import { BandwidthPicker } from './StreamOptions'

type Section = 'perfil' | 'transmissao' | 'grupo' | 'rede' | 'sobre'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'perfil', label: 'Perfil' },
  { id: 'transmissao', label: 'Transmissão e áudio' },
  { id: 'grupo', label: 'Grupo e salas' },
  { id: 'rede', label: 'Rede e diagnóstico' },
  { id: 'sobre', label: 'Sobre' }
]

export function SettingsDialog({
  client,
  groupCode,
  streaming,
  onClose,
  onLeaveGroup,
  onManual
}: {
  client: RoomClient
  groupCode: string
  streaming: boolean
  onClose: () => void
  onLeaveGroup: () => void
  onManual: () => void
}): React.JSX.Element {
  const [section, setSection] = useState<Section>('transmissao')
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)

  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal settings" role="dialog" aria-label="Configurações">
        <nav className="settings-nav" aria-label="Seções">
          <span className="settings-title">Configurações</span>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`settings-tab ${section === s.id ? 'current' : ''}`} aria-current={section === s.id} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <div className="modal-head">
            <h2>{SECTIONS.find((s) => s.id === section)!.label}</h2>
            <button className="icon-btn" aria-label="Fechar" onClick={onClose}>
              <IconClose size={16} />
            </button>
          </div>
          {section === 'perfil' && <ProfileSection />}
          {section === 'transmissao' && <StreamSection />}
          {section === 'grupo' && <GroupSection client={client} groupCode={groupCode} streaming={streaming} onLeaveGroup={onLeaveGroup} />}
          {section === 'rede' && <NetworkSection client={client} onManual={onManual} />}
          {section === 'sobre' && (
            <div className="settings-section">
              <p>Aquarium {__APP_VERSION__}</p>
              <p className="muted">Compartilhamento de tela P2P para uso interno. O vídeo vai direto entre os PCs; o servidor só ajuda a se encontrarem.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProfileSection(): React.JSX.Element {
  const settings = useSettings()
  const [name, setName] = useState(settings.name)
  const valid = name.trim().length > 0 && name.trim().length <= 32
  return (
    <div className="settings-section">
      <div className="field">
        <label htmlFor="st-name">Seu nome no grupo</label>
        <input id="st-name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="choice-row">
        <button className="btn primary" disabled={!valid || name.trim() === settings.name} onClick={() => updateSettings({ name: name.trim() })}>
          Salvar nome
        </button>
      </div>
    </div>
  )
}

function StreamSection(): React.JSX.Element {
  const settings = useSettings()
  const [newApp, setNewApp] = useState('')
  const addApp = (): void => {
    let exe = newApp.trim()
    if (!exe) return
    if (!/\.exe$/i.test(exe)) exe += '.exe'
    if (!settings.blockedApps.some((a) => a.toLowerCase() === exe.toLowerCase())) updateSettings({ blockedApps: [...settings.blockedApps, exe] })
    setNewApp('')
  }

  return (
    <div className="settings-section">
      <div className="two-col">
        <div className="field">
          <label htmlFor="st-preset">Qualidade padrão</label>
          <select
            id="st-preset"
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
          <label htmlFor="st-priority">Quando faltar banda</label>
          <select id="st-priority" value={settings.priority} onChange={(e) => updateSettings({ priority: e.target.value as Priority })}>
            {(Object.keys(PRIORITIES) as Priority[]).map((id) => (
              <option key={id} value={id}>
                {PRIORITIES[id].label}: {PRIORITIES[id].description}
              </option>
            ))}
          </select>
        </div>
      </div>

      <BandwidthPicker />

      <div className="two-col">
        <div className="field">
          <label htmlFor="st-codec">Codec (vale para os próximos espectadores)</label>
          <select id="st-codec" value={settings.codec} onChange={(e) => updateSettings({ codec: e.target.value as CodecChoice })}>
            {(Object.keys(CODECS) as CodecChoice[]).map((id) => (
              <option key={id} value={id}>
                {CODECS[id].label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="st-audio">Áudio padrão ao transmitir</label>
          <select id="st-audio" value={settings.audioMode} onChange={(e) => updateSettings({ audioMode: e.target.value as AudioMode })}>
            <option value="app">Só o app transmitido</option>
            <option value="all">Todos os apps</option>
            <option value="none">Sem áudio</option>
          </select>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Apps que nunca entram no áudio da transmissão</span>
        <div className="chips">
          {['Discord', 'Aquarium'].map((name) => (
            <span key={name} className="chip locked">
              <IconLock size={14} /> {name} <span className="muted">sempre</span>
            </span>
          ))}
          {settings.blockedApps.map((exe) => (
            <span key={exe} className="chip">
              {exe}
              <button
                className="chip-remove"
                aria-label={`Tirar ${exe} da lista`}
                onClick={() => updateSettings({ blockedApps: settings.blockedApps.filter((a) => a !== exe) })}
              >
                <IconClose size={12} />
              </button>
            </span>
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            addApp()
          }}
        >
          <label htmlFor="st-newapp" className="sr-only">
            Nome do programa
          </label>
          <input id="st-newapp" value={newApp} onChange={(e) => setNewApp(e.target.value)} placeholder="Ex.: Spotify.exe" />
          <button className="btn" type="submit" disabled={!newApp.trim()}>
            Adicionar app
          </button>
        </form>
        <span className="field-hint">Escreva o nome do programa como aparece no Gerenciador de Tarefas, na aba Detalhes.</span>
      </div>

      <div className="field">
        <div className="slider-field">
          <label htmlFor="st-effects">
            <span>Volume dos efeitos sonoros</span>
            <span>{settings.effectsVolume === 0 ? 'desligados' : `${Math.round(settings.effectsVolume * 100)}%`}</span>
          </label>
          <div className="inline-form">
            <input
              id="st-effects"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.effectsVolume * 100)}
              onChange={(e) => updateSettings({ effectsVolume: Number(e.target.value) / 100 })}
              onPointerUp={(e) => playSound('entrou-na-sala', Number(e.currentTarget.value) / 100)}
            />
            <button className="btn small" type="button" disabled={settings.effectsVolume === 0} onClick={() => playSound('transmissao-comecou')}>
              Ouvir
            </button>
          </div>
        </div>
        <span className="field-hint">Avisos curtos quando alguém entra ou sai da sua sala, começa ou para de transmitir, ou começa a te assistir.</span>
      </div>
    </div>
  )
}

function GroupSection({
  client,
  groupCode,
  streaming,
  onLeaveGroup
}: {
  client: RoomClient
  groupCode: string
  streaming: boolean
  onLeaveGroup: () => void
}): React.JSX.Element {
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  return (
    <div className="settings-section">
      <div className="field">
        <span className="field-label">Código do grupo</span>
        <div className="code-box">
          <code>{show ? groupCode : `AQG-${'••••-'.repeat(6)}${groupCode.slice(-2)}`}</code>
          <button className="btn small" onClick={() => setShow((v) => !v)}>
            {show ? 'Esconder' : 'Mostrar'}
          </button>
          <button
            className="btn small"
            onClick={async () => {
              if (await copyText(groupCode)) setCopied(true)
            }}
          >
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <span className="field-hint">Quem tiver este código entra no grupo. Mande só para quem você quer aqui.</span>
      </div>

      <div className="field">
        <span className="field-label">Salas</span>
        <div className="room-list">
          {client.state.rooms.map((r) => (
            <div key={r.id} className="room-row">
              {editing?.id === r.id ? (
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (editing.name.trim()) client.renameRoom(r.id, editing.name.trim())
                    setEditing(null)
                  }}
                >
                  <label htmlFor={`rn-${r.id}`} className="sr-only">
                    Novo nome
                  </label>
                  <input id={`rn-${r.id}`} autoFocus maxLength={32} value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} />
                  <button className="btn small" type="submit">
                    Salvar
                  </button>
                </form>
              ) : (
                <span className="room-row-name">{r.name}</span>
              )}
              {editing?.id !== r.id && (
                <>
                  <button className="btn ghost small" onClick={() => setEditing({ id: r.id, name: r.name })}>
                    Renomear
                  </button>
                  {confirmDelete === r.id ? (
                    <button
                      className="btn danger small"
                      onClick={() => {
                        client.deleteRoom(r.id)
                        setConfirmDelete(null)
                      }}
                    >
                      Confirmar exclusão
                    </button>
                  ) : (
                    <button className="btn ghost small" onClick={() => setConfirmDelete(r.id)}>
                      Apagar
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Sair do grupo neste computador</span>
        {confirmLeave ? (
          <div className="choice-row">
            <button className="btn danger" onClick={onLeaveGroup}>
              Sair do grupo
            </button>
            <button className="btn ghost" onClick={() => setConfirmLeave(false)}>
              Cancelar
            </button>
          </div>
        ) : (
          <div className="choice-row">
            <button className="btn" onClick={() => setConfirmLeave(true)}>
              Sair do grupo…
            </button>
          </div>
        )}
        <span className="field-hint">
          O código é apagado deste computador. Para voltar, será preciso colar o código de novo.
          {streaming && ' Sua transmissão para junto.'}
        </span>
      </div>
    </div>
  )
}

function NetworkSection({ client, onManual }: { client: RoomClient; onManual: () => void }): React.JSX.Element {
  const settings = useSettings()
  const [server, setServer] = useState(serverUrlOf(settings))
  const valid = /^wss?:\/\/[^\s]+$/.test(server.trim())
  const current = serverUrlOf(settings)
  return (
    <div className="settings-section">
      <div className="field">
        <label htmlFor="st-server">Servidor de salas</label>
        <input id="st-server" className="mono" value={server} onChange={(e) => setServer(e.target.value)} />
        <span className="field-hint">
          Situação: {client.status}. Padrão desta versão: <code>{DEFAULT_SERVER}</code>
        </span>
      </div>
      <div className="choice-row">
        <button
          className="btn primary"
          disabled={!valid || server.trim() === current}
          onClick={() => updateSettings({ serverUrl: server.trim() === DEFAULT_SERVER ? '' : server.trim() })}
        >
          Salvar servidor
        </button>
        <button
          className="btn ghost"
          disabled={!settings.serverUrl}
          onClick={() => {
            setServer(DEFAULT_SERVER)
            updateSettings({ serverUrl: '' })
          }}
        >
          Voltar ao padrão
        </button>
      </div>
      <div className="field">
        <span className="field-label">Sem servidor</span>
        <div className="choice-row">
          <button className="btn" onClick={onManual}>
            Abrir conexão manual por códigos
          </button>
        </div>
        <span className="field-hint">O modo antigo: um convite e uma resposta trocados por mensagem, para quando o servidor estiver fora do ar.</span>
      </div>
      <div className="field">
        <span className="field-label">Registro de conexão</span>
        <div className="choice-row">
          <button className="btn" onClick={() => void window.aquarium.openLogsFolder()}>
            Abrir pasta dos logs
          </button>
        </div>
        <span className="field-hint">
          Se a conexão cair ou travar, mande o arquivo do dia (aquarium-ano-mês-dia.log) para quem cuida do app. Ele não guarda o código do grupo nem endereços IP.
        </span>
      </div>
    </div>
  )
}
