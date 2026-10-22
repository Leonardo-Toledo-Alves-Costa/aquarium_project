import { useCallback, useEffect, useRef, useState } from 'react'
import type { MemberInfo } from '../../../shared/rooms-protocol'
import { audioOptions, startCapture, type Capture } from '../capture'
import { formatDiagnostics } from '../diagnostics'
import { PRESETS, PRIORITIES, type PresetId, type Priority } from '../rtc/presets'
import type { PeerLink, RoomSession } from '../rtc/room-session'
import { updateSettings, useSettings, type AudioMode } from '../settings'
import type { RoomClient } from '../signaling/rooms'
import { Avatar } from './Avatar'
import { ContextMenu, MenuItem, MenuSeparator, MenuTitle, type MenuPosition } from './ContextMenu'
import { copyText, useDismiss, useStats, useStreamAudio, useSubscribe, useUpdateState } from './hooks'
import {
  IconChevronDown,
  IconDownload,
  IconEye,
  IconFocus,
  IconGear,
  IconMore,
  IconPlus,
  IconScreen,
  IconSideBySide,
  IconSignal,
  IconSliders,
  IconSpeaker,
  IconSpeakerOff,
  IconTank,
  IconUsers
} from './icons'
import { SettingsDialog } from './SettingsDialog'
import { SourcePicker } from './SourcePicker'

type Tile =
  | { kind: 'own'; id: string; peerId: string; name: string; label: string; stream: MediaStream }
  | { kind: 'remote'; id: string; peerId: string; name: string; label: string; stream: MediaStream; link: PeerLink }
  | { kind: 'waiting'; id: string; peerId: string; name: string; label: string; watching: boolean }

const AUDIO_OPTIONS: { id: AudioMode; label: string; hint: string }[] = [
  { id: 'app', label: 'Só o app transmitido', hint: 'o som do jogo ou programa, nada mais' },
  { id: 'all', label: 'Todos os apps', hint: 'tudo que toca no PC, menos os bloqueados' },
  { id: 'none', label: 'Sem áudio', hint: 'só a imagem' }
]

export function Palco({
  client,
  session,
  groupCode,
  onLeaveGroup,
  onManual
}: {
  client: RoomClient
  session: RoomSession
  groupCode: string
  onLeaveGroup: () => void
  onManual: () => void
}): React.JSX.Element {
  useSubscribe(client)
  useSubscribe(session)
  const settings = useSettings()
  const [picker, setPicker] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [creatingRoom, setCreatingRoom] = useState(false)
  const [menu, setMenu] = useState<{ tileId: string; at: MenuPosition } | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [masterMuted, setMasterMuted] = useState(false)
  const [mutedPeers, setMutedPeers] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const me = client.me
  const roomId = me?.roomId ?? null
  const room = client.state.rooms.find((r) => r.id === roomId) ?? null
  const roomMembers = client.state.members.filter((m) => roomId !== null && m.roomId === roomId)
  const tiles = buildTiles(session, roomMembers, client.peerId)
  const focused = tiles.find((t) => t.id === focusId) ?? tiles[0]

  // Transmitindo ou assistindo: a atualização espera para baixar, e reiniciar pede confirmação.
  const busy = session.local !== null || [...session.links.values()].some((l) => l.iWatch)
  useEffect(() => {
    void window.aquarium.setBusy(busy)
  }, [busy])

  const join = (id: string | null): void => {
    if (session.local && id !== roomId) session.stopStreaming()
    client.join(id)
    setFocusId(null)
  }

  const captureRef = useRef<Capture | null>(null)

  // Trocar o modo de áudio ou a lista de bloqueados vale na hora, sem parar a transmissão.
  useEffect(() => {
    const capture = captureRef.current
    capture?.audio?.setMode(audioOptions(capture.source, settings))
  }, [settings.audioMode, settings.blockedApps])

  useEffect(() => {
    captureRef.current?.audio?.setVolume(settings.sendVolume)
  }, [settings.sendVolume])

  const startStreaming = async (source: Parameters<typeof startCapture>[0]): Promise<void> => {
    setPicker(false)
    try {
      const capture = await startCapture(source, PRESETS[settings.presetId], settings)
      captureRef.current = capture
      await session.startStreaming(capture.stream, capture.label, () => {
        capture.stop()
        if (captureRef.current === capture) captureRef.current = null
      })
      setFocusId('me')
    } catch (err) {
      console.error(err)
      setError('Não foi possível capturar essa tela ou janela. Tente outra.')
    }
  }

  const openMenu = (tileId: string, at: MenuPosition): void => setMenu({ tileId, at })
  const menuTile = menu ? tiles.find((t) => t.id === menu.tileId) : undefined

  return (
    <div className="palco">
      <TopBar
        client={client}
        roomName={room?.name ?? null}
        roomMembers={roomMembers}
        onJoin={join}
        onCreateRoom={() => setCreatingRoom(true)}
        onPeople={() => setPeopleOpen((v) => !v)}
      />

      <main className={`stage layout-${settings.layout}`}>
        {(client.status === 'recusado' || client.error) && (
          <p className="alert stage-alert">
            {client.status === 'recusado' && !client.error ? 'O servidor recusou a entrada no grupo.' : client.error}
          </p>
        )}
        {error && (
          <p className="alert stage-alert" onClick={() => setError(null)}>
            {error}
          </p>
        )}

        {roomId === null ? (
          <Lobby client={client} onJoin={join} onCreate={() => setCreatingRoom(true)} />
        ) : tiles.length === 0 ? (
          <div className="empty">
            <IconScreen size={56} />
            <h2>Ninguém está transmitindo em {room?.name}</h2>
            <p className="muted">Qualquer pessoa da sala pode transmitir. Use o botão Transmitir aqui embaixo.</p>
          </div>
        ) : settings.layout === 'foco' && tiles.length > 1 ? (
          <div className="focus-layout">
            <TileView tile={focused} big {...tileProps()} />
            <div className="strip">
              {tiles
                .filter((t) => t.id !== focused.id)
                .map((t) => (
                  <TileView key={t.id} tile={t} {...tileProps()} />
                ))}
            </div>
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: `repeat(${tiles.length > 1 ? 2 : 1}, minmax(0, 1fr))` }}>
            {tiles.map((t) => (
              <TileView key={t.id} tile={t} {...tileProps()} />
            ))}
          </div>
        )}
      </main>

      <RoomRail client={client} roomId={roomId} onJoin={join} onCreate={() => setCreatingRoom(true)} />

      <Dock
        inRoom={roomId !== null}
        streaming={!!session.local}
        masterMuted={masterMuted}
        layout={settings.layout}
        onStream={(at) => (session.local ? openMenu('me', at) : setPicker(true))}
        onToggleMute={() => setMasterMuted((v) => !v)}
        onToggleLayout={() => updateSettings({ layout: settings.layout === 'lado' ? 'foco' : 'lado' })}
        onSettings={() => setSettingsOpen(true)}
        onLeave={() => join(null)}
      />

      {peopleOpen && <PeopleDrawer client={client} onClose={() => setPeopleOpen(false)} />}

      {menu && menuTile && (
        <ContextMenu at={menu.at} label="Opções da transmissão" onClose={() => setMenu(null)}>
          {menuTile.kind === 'own' ? (
            <OwnMenu
              session={session}
              label={menuTile.label}
              nameOf={(peerId) => client.state.members.find((m) => m.peerId === peerId)?.name ?? peerId}
              onChangeSource={() => {
                setMenu(null)
                setPicker(true)
              }}
              onClose={() => setMenu(null)}
            />
          ) : menuTile.kind === 'remote' ? (
            <RemoteMenu
              tile={menuTile}
              session={session}
              muted={mutedPeers.has(menuTile.peerId)}
              onToggleMute={() =>
                setMutedPeers((prev) => {
                  const next = new Set(prev)
                  if (next.has(menuTile.peerId)) next.delete(menuTile.peerId)
                  else next.add(menuTile.peerId)
                  return next
                })
              }
              onClose={() => setMenu(null)}
            />
          ) : null}
        </ContextMenu>
      )}

      {picker && <SourcePicker onPick={startStreaming} onClose={() => setPicker(false)} />}
      {creatingRoom && (
        <CreateRoomDialog
          onCreate={(name) => {
            client.createRoom(name)
            setCreatingRoom(false)
          }}
          onClose={() => setCreatingRoom(false)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          client={client}
          groupCode={groupCode}
          onClose={() => setSettingsOpen(false)}
          onLeaveGroup={onLeaveGroup}
          onManual={onManual}
        />
      )}
    </div>
  )

  function tileProps(): Omit<TileViewProps, 'tile' | 'big'> {
    return {
      session,
      masterMuted,
      mutedPeers,
      volumes: settings.volumes,
      onMenu: openMenu,
      onFocus: (id) => {
        setFocusId(id)
        if (settings.layout !== 'foco') updateSettings({ layout: 'foco' })
      }
    }
  }
}

function buildTiles(session: RoomSession, roomMembers: MemberInfo[], selfId: string): Tile[] {
  const tiles: Tile[] = []
  const me = roomMembers.find((m) => m.peerId === selfId)
  if (session.local) {
    tiles.push({ kind: 'own', id: 'me', peerId: selfId, name: me?.name ?? 'Você', label: session.local.label, stream: session.local.stream })
  }
  for (const m of roomMembers) {
    if (m.peerId === selfId || !m.streaming) continue
    const link = session.links.get(m.peerId)
    const label = m.streamLabel ?? 'Tela'
    if (link?.iWatch && link.remote) {
      tiles.push({ kind: 'remote', id: m.peerId, peerId: m.peerId, name: m.name, label, stream: link.remote, link })
    } else {
      tiles.push({ kind: 'waiting', id: m.peerId, peerId: m.peerId, name: m.name, label, watching: !!link?.iWatch })
    }
  }
  return tiles
}

// ---------- barra superior ----------

function TopBar({
  client,
  roomName,
  roomMembers,
  onJoin,
  onCreateRoom,
  onPeople
}: {
  client: RoomClient
  roomName: string | null
  roomMembers: MemberInfo[]
  onJoin: (id: string | null) => void
  onCreateRoom: () => void
  onPeople: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, () => setOpen(false), open)
  const status = client.status
  const update = useUpdateState()

  return (
    <header className="topbar">
      <div className="switcher" ref={ref}>
        <button className="switcher-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <IconTank size={18} />
          <span className="switcher-text">
            <span className="switcher-room">{roomName ?? 'Nenhuma sala'}</span>
            <span className="switcher-hint">trocar de sala</span>
          </span>
          <IconChevronDown size={16} />
        </button>
        {open && (
          <div className="dropdown" role="menu" aria-label="Salas">
            {client.state.rooms.map((r) => {
              const members = client.state.members.filter((m) => m.roomId === r.id)
              const live = members.filter((m) => m.streaming).length
              return (
                <button
                  key={r.id}
                  role="menuitem"
                  className={`dropdown-item ${r.name === roomName ? 'current' : ''}`}
                  onClick={() => {
                    onJoin(r.id)
                    setOpen(false)
                  }}
                >
                  <span>{r.name}</span>
                  <span className="dropdown-meta">
                    {live > 0 && <span className="live-text">{live} ao vivo</span>}
                    {members.length > 0 ? `${members.length} ${members.length === 1 ? 'pessoa' : 'pessoas'}` : 'vazia'}
                  </span>
                </button>
              )
            })}
            <div className="menu-sep" />
            <button
              role="menuitem"
              className="dropdown-item accent"
              onClick={() => {
                setOpen(false)
                onCreateRoom()
              }}
            >
              Criar sala
            </button>
          </div>
        )}
      </div>

      <div className="stack-avatars" aria-label={`${roomMembers.length} na sala`}>
        {roomMembers.slice(0, 6).map((m) => (
          <span key={m.peerId} title={m.name}>
            <Avatar peerId={m.peerId} name={m.name} size={30} />
          </span>
        ))}
        {roomName && <span className="muted stack-count">{roomMembers.length} na sala</span>}
      </div>

      <div className="spacer" />

      <span className={`conn conn-${status}`} role="status">
        <IconSignal size={14} />
        {status === 'conectado' ? 'conectado' : status === 'recusado' ? 'recusado' : status === 'reconectando' ? 'reconectando…' : 'conectando…'}
      </span>
      <button className="icon-btn" aria-label="Pessoas do grupo" onClick={onPeople}>
        <IconUsers size={18} />
      </button>
      {update.ready && (
        <button
          className="icon-btn update-ready"
          aria-label={`Atualização ${update.version} pronta. Reiniciar para instalar`}
          title={`Versão ${update.version} pronta: clique para reiniciar e atualizar`}
          onClick={() => void window.aquarium.installUpdate()}
        >
          <IconDownload size={18} />
        </button>
      )}
    </header>
  )
}

// ---------- salas ----------

function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
}

function RoomRail({
  client,
  roomId,
  onJoin,
  onCreate
}: {
  client: RoomClient
  roomId: string | null
  onJoin: (id: string) => void
  onCreate: () => void
}): React.JSX.Element {
  return (
    <nav className="rail" aria-label="Salas do grupo">
      {client.state.rooms.map((r) => {
        const live = client.state.members.some((m) => m.roomId === r.id && m.streaming)
        const count = client.state.members.filter((m) => m.roomId === r.id).length
        return (
          <button
            key={r.id}
            className={`rail-btn ${r.id === roomId ? 'current' : ''}`}
            title={`${r.name}${count ? ` · ${count} na sala` : ''}${live ? ' · ao vivo' : ''}`}
            aria-label={`${r.name}${r.id === roomId ? ' (sala atual)' : ''}${live ? ', alguém transmitindo' : ''}`}
            onClick={() => onJoin(r.id)}
          >
            {initials(r.name)}
            {live && <span className="rail-live" />}
          </button>
        )
      })}
      <button className="rail-btn add" aria-label="Criar sala" title="Criar sala" onClick={onCreate}>
        <IconPlus size={18} />
      </button>
    </nav>
  )
}

function Lobby({ client, onJoin, onCreate }: { client: RoomClient; onJoin: (id: string) => void; onCreate: () => void }): React.JSX.Element {
  return (
    <div className="lobby">
      <h1>Escolha uma sala</h1>
      <div className="lobby-grid">
        {client.state.rooms.map((r) => {
          const members = client.state.members.filter((m) => m.roomId === r.id)
          const live = members.filter((m) => m.streaming)
          return (
            <button key={r.id} className="lobby-card" onClick={() => onJoin(r.id)}>
              <span className="lobby-name">{r.name}</span>
              <span className="lobby-meta">
                {live.length > 0 ? <span className="live-text">{live.map((m) => m.name).join(', ')} ao vivo</span> : members.length > 0 ? `${members.length} na sala` : 'vazia'}
              </span>
              <span className="lobby-avatars">
                {members.map((m) => (
                  <Avatar key={m.peerId} peerId={m.peerId} name={m.name} size={24} />
                ))}
              </span>
            </button>
          )
        })}
        <button className="lobby-card add" onClick={onCreate}>
          <IconPlus size={20} />
          <span>Criar sala</span>
        </button>
      </div>
    </div>
  )
}

function CreateRoomDialog({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const ref = useRef<HTMLFormElement>(null)
  useDismiss(ref, onClose)
  return (
    <div className="modal-backdrop">
      <form
        ref={ref}
        className="modal small"
        role="dialog"
        aria-label="Criar sala"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onCreate(name.trim())
        }}
      >
        <h2>Nova sala</h2>
        <div className="field">
          <label htmlFor="room-name">Nome da sala</label>
          <input id="room-name" autoFocus maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Filme de sexta" />
        </div>
        <div className="choice-row">
          <button type="submit" className="btn primary" disabled={!name.trim()}>
            Criar
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------- transmissões ----------

interface TileViewProps {
  tile: Tile
  big?: boolean
  session: RoomSession
  masterMuted: boolean
  mutedPeers: Set<string>
  volumes: Record<string, number>
  onMenu: (tileId: string, at: MenuPosition) => void
  onFocus: (tileId: string) => void
}

function TileView({ tile, big, session, masterMuted, mutedPeers, volumes, onMenu, onFocus }: TileViewProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const ref = useRef<HTMLElement>(null)
  const stream = tile.kind === 'waiting' ? null : tile.stream
  const remoteStream = tile.kind === 'remote' ? tile.stream : null
  useStreamAudio(remoteStream, volumes[tile.peerId] ?? 1, masterMuted || mutedPeers.has(tile.peerId))
  const stats = useStats(tile.kind === 'remote' ? tile.link.inStats : undefined, tile.kind === 'remote')
  const watchers = tile.kind === 'own' ? [...session.links.values()].filter((l) => l.theyWatch).length : 0

  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream
  }, [stream])

  const fullscreen = (): void => {
    if (document.fullscreenElement) document.exitFullscreen()
    else ref.current?.requestFullscreen()
  }

  return (
    <section
      ref={ref}
      id={`tile-${tile.id}`}
      className={`tile ${big ? 'big' : ''} ${tile.kind}`}
      aria-label={tile.kind === 'own' ? 'Sua transmissão' : `Transmissão de ${tile.name}`}
      onContextMenu={(e) => {
        e.preventDefault()
        if (tile.kind !== 'waiting') onMenu(tile.id, { x: e.clientX, y: e.clientY })
      }}
      onDoubleClick={() => (big ? fullscreen() : onFocus(tile.id))}
    >
      {stream ? (
        <video ref={videoRef} autoPlay playsInline muted />
      ) : (
        <div className="tile-waiting">
          <IconScreen size={48} />
          <span className="tile-waiting-label">{tile.label}</span>
          {tile.kind === 'waiting' && (
            <button className="btn primary" disabled={tile.watching} onClick={() => session.watch(tile.peerId, true)}>
              {tile.watching ? 'Conectando…' : 'Assistir'}
            </button>
          )}
        </div>
      )}

      <div className="tile-name">
        <Avatar peerId={tile.peerId} name={tile.name} size={24} />
        <span>{tile.kind === 'own' ? `${tile.name} (você)` : tile.name}</span>
        <span className="live-pill">AO VIVO</span>
        {stream && <span className="tile-label">{tile.label}</span>}
      </div>

      {tile.kind === 'own' && (
        <div className="tile-chip">
          <IconEye size={14} /> {watchers === 0 ? 'ninguém assistindo' : `${watchers} assistindo`}
        </div>
      )}
      {tile.kind === 'remote' && stats?.height && (
        <div className="tile-chip mono">
          {stats.height}p · {Math.round(stats.fps ?? 0)} fps{stats.route?.rttMs !== undefined ? ` · ${stats.route.rttMs} ms` : ''}
        </div>
      )}

      {tile.kind !== 'waiting' && (
        <button
          className="tile-more"
          aria-label="Opções da transmissão"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onMenu(tile.id, { x: r.left, y: r.bottom + 4 })
          }}
        >
          <IconMore size={18} />
        </button>
      )}
    </section>
  )
}

function RemoteMenu({
  tile,
  session,
  muted,
  onToggleMute,
  onClose
}: {
  tile: Extract<Tile, { kind: 'remote' }>
  session: RoomSession
  muted: boolean
  onToggleMute: () => void
  onClose: () => void
}): React.JSX.Element {
  const settings = useSettings()
  const volume = Math.round((settings.volumes[tile.peerId] ?? 1) * 100)
  const [copied, setCopied] = useState(false)
  return (
    <>
      <MenuTitle>
        <Avatar peerId={tile.peerId} name={tile.name} size={22} /> Transmissão de {tile.name}
      </MenuTitle>
      <div className="menu-slider">
        <label htmlFor="menu-volume">
          <span>Volume</span>
          <span>{volume}%</span>
        </label>
        <input
          id="menu-volume"
          type="range"
          min={0}
          max={200}
          step={5}
          value={volume}
          onChange={(e) => updateSettings({ volumes: { ...settings.volumes, [tile.peerId]: Number(e.target.value) / 100 } })}
        />
      </div>
      <button role="menuitemcheckbox" aria-checked={muted} className="menu-item" onClick={onToggleMute}>
        <span>Silenciar o áudio</span>
        <span className={`toggle ${muted ? 'on' : ''}`} aria-hidden="true" />
      </button>
      <MenuItem
        onClick={() => {
          document.getElementById(`tile-${tile.id}`)?.requestFullscreen()
          onClose()
        }}
      >
        Tela cheia
      </MenuItem>
      <MenuItem
        onClick={async () => {
          const sample = await tile.link.inStats.sample()
          if (await copyText(formatDiagnostics({ role: 'assistindo' }, sample))) setCopied(true)
        }}
      >
        {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        danger
        onClick={() => {
          session.watch(tile.peerId, false)
          onClose()
        }}
      >
        Parar de assistir
      </MenuItem>
    </>
  )
}

function OwnMenu({
  session,
  label,
  nameOf,
  onChangeSource,
  onClose
}: {
  session: RoomSession
  label: string
  nameOf: (peerId: string) => string
  onChangeSource: () => void
  onClose: () => void
}): React.JSX.Element {
  const settings = useSettings()
  const [copied, setCopied] = useState(false)

  const diagnostics = async (): Promise<string> => {
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

  return (
    <>
      <MenuTitle>
        <span className="live-pill">AO VIVO</span> Sua transmissão · {label}
      </MenuTitle>
      <div className="menu-section">Áudio da transmissão</div>
      <div role="group" aria-label="Áudio da transmissão">
        {AUDIO_OPTIONS.map((o) => (
          <button
            key={o.id}
            role="menuitemradio"
            aria-checked={settings.audioMode === o.id}
            className={`menu-radio ${settings.audioMode === o.id ? 'on' : ''}`}
            onClick={() => updateSettings({ audioMode: o.id })}
          >
            <span className="radio-dot" aria-hidden="true" />
            <span className="menu-radio-text">
              <span>{o.label}</span>
              <span className="menu-hint">{o.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="menu-note">Discord e Aquarium nunca entram na transmissão, para não dar retorno.</p>
      <div className="menu-slider">
        <label htmlFor="menu-send-volume">
          <span>Volume enviado</span>
          <span>{Math.round(settings.sendVolume * 100)}%</span>
        </label>
        <input
          id="menu-send-volume"
          type="range"
          min={0}
          max={150}
          step={5}
          value={Math.round(settings.sendVolume * 100)}
          disabled={settings.audioMode === 'none'}
          onChange={(e) => updateSettings({ sendVolume: Number(e.target.value) / 100 })}
        />
      </div>
      <MenuSeparator />
      <MenuItem onClick={onChangeSource}>Trocar tela ou janela</MenuItem>
      <MenuItem
        onClick={async () => {
          if (await copyText(await diagnostics())) setCopied(true)
        }}
      >
        {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
      </MenuItem>
      <MenuItem
        danger
        onClick={() => {
          session.stopStreaming()
          onClose()
        }}
      >
        Parar de transmitir
      </MenuItem>
    </>
  )
}

// ---------- barra inferior ----------

function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), ms)
    const wake = (): void => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), ms)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [ms])
  return idle
}

function Dock({
  inRoom,
  streaming,
  masterMuted,
  layout,
  onStream,
  onToggleMute,
  onToggleLayout,
  onSettings,
  onLeave
}: {
  inRoom: boolean
  streaming: boolean
  masterMuted: boolean
  layout: 'lado' | 'foco'
  onStream: (at: MenuPosition) => void
  onToggleMute: () => void
  onToggleLayout: () => void
  onSettings: () => void
  onLeave: () => void
}): React.JSX.Element {
  const idle = useIdle(3000)
  const [quality, setQuality] = useState(false)

  return (
    <div className={`dock ${idle && inRoom && !quality ? 'idle' : ''}`} role="toolbar" aria-label="Controles da sala">
      <button
        className={`dock-btn ${streaming ? 'live' : 'primary'}`}
        disabled={!inRoom}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onStream({ x: r.left, y: r.top - 8 - 420 })
        }}
      >
        <IconScreen />
        {streaming ? 'Transmitindo' : 'Transmitir'}
      </button>
      <button className="dock-btn" aria-pressed={masterMuted} onClick={onToggleMute}>
        {masterMuted ? <IconSpeakerOff /> : <IconSpeaker />}
        {masterMuted ? 'Sem som' : 'Som'}
      </button>
      <div className="dock-anchor">
        <button className="dock-btn" aria-expanded={quality} onClick={() => setQuality((v) => !v)}>
          <IconSliders />
          Qualidade
        </button>
        {quality && <QualityPopover onClose={() => setQuality(false)} />}
      </div>
      <button className="dock-btn" disabled={!inRoom} onClick={onToggleLayout}>
        {layout === 'lado' ? <IconSideBySide /> : <IconFocus />}
        {layout === 'lado' ? 'Lado a lado' : 'Foco'}
      </button>
      <button className="dock-btn" onClick={onSettings}>
        <IconGear />
        Configurações
      </button>
      <div className="dock-sep" />
      <button className="dock-btn outline" disabled={!inRoom} onClick={onLeave}>
        Sair da sala
      </button>
    </div>
  )
}

function QualityPopover({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useSettings()
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(onClose, [onClose])
  useDismiss(ref, close)
  return (
    <div ref={ref} className="popover" role="dialog" aria-label="Qualidade da transmissão">
      <div className="field">
        <label htmlFor="q-preset">Qualidade</label>
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

// ---------- pessoas ----------

function PeopleDrawer({ client, onClose }: { client: RoomClient; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const groups = [
    ...client.state.rooms.map((r) => ({ title: r.name, members: client.state.members.filter((m) => m.roomId === r.id) })),
    { title: 'Fora das salas', members: client.state.members.filter((m) => m.roomId === null) }
  ].filter((g) => g.members.length > 0)

  return (
    <aside ref={ref} className="drawer" aria-label="Pessoas do grupo">
      <h2>Online · {client.state.members.length}</h2>
      {groups.map((g) => (
        <div key={g.title} className="drawer-group">
          <span className="drawer-title">{g.title}</span>
          {g.members.map((m) => (
            <div key={m.peerId} className="drawer-person">
              <Avatar peerId={m.peerId} name={m.name} size={30} />
              <span className="drawer-person-text">
                <span>
                  {m.name}
                  {m.peerId === client.peerId ? ' (você)' : ''}
                </span>
                {m.streaming && <span className="live-text">transmitindo {m.streamLabel ?? ''}</span>}
              </span>
            </div>
          ))}
        </div>
      ))}
    </aside>
  )
}
