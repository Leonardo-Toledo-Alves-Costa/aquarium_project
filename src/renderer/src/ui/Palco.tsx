import { useCallback, useEffect, useRef, useState } from 'react'
import { audioOptions, startCapture, type Capture } from '../capture'
import { errorInfo, logger } from '../log'
import { PRESETS } from '../rtc/presets'
import type { RoomSession } from '../rtc/room-session'
import { getSettings, updateSettings, useSettings } from '../settings'
import type { RoomClient } from '../signaling/rooms'
import { ContextMenu, type MenuPosition } from './ContextMenu'
import { copyText, useDismiss, useSubscribe } from './hooks'
import { IconExitFullscreen, IconPlus, IconScreen, IconSideBySide, IconSidebar } from './icons'
import { SettingsDialog } from './SettingsDialog'
import { Sidebar } from './Sidebar'
import { SourcePicker } from './SourcePicker'
import { useRoomSounds } from './sounds'
import { buildTiles, OwnMenu, RemoteMenu, StreamTabs, TileView, type Tile, type ZoomAction } from './Stage'
import { ownDiagnostics, StreamOptions } from './StreamOptions'

const log = logger('palco')

interface Confirm {
  title: string
  body: string
  action: string
  onConfirm: () => void
}

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
  useRoomSounds(client, session)
  const settings = useSettings()
  const [picker, setPicker] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [creatingRoom, setCreatingRoom] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [menu, setMenu] = useState<{ tileId: string; at: MenuPosition; anchor?: HTMLElement } | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [masterMuted, setMasterMuted] = useState(false)
  const [mutedPeers, setMutedPeers] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const optionsButton = useRef<HTMLButtonElement>(null)
  const stageRef = useRef<HTMLElement>(null)
  const hoverId = useRef<string | null>(null)
  const zoomers = useRef(new Map<string, (action: ZoomAction) => void>())
  const idle = useIdle(2500)

  const me = client.me
  const roomId = me?.roomId ?? null
  const room = client.state.rooms.find((r) => r.id === roomId) ?? null
  // Quem caiu do servidor há pouco com o vídeo ainda chegando continua com a aba até voltar.
  const roomMembers = [...client.state.members.filter((m) => roomId !== null && m.roomId === roomId), ...session.missingMembers]
  const tiles = buildTiles(session, roomMembers, client.peerId)
  const view = settings.view
  const active =
    tiles.find((t) => t.id === activeId) ??
    tiles.find((t) => t.kind === 'remote') ??
    tiles.find((t) => t.kind === 'waiting' && t.watching) ??
    tiles.find((t) => t.kind !== 'own') ??
    tiles[0]
  const nameOf = (peerId: string): string => client.state.members.find((m) => m.peerId === peerId)?.name ?? peerId

  // Transmitindo ou assistindo: a atualização espera para baixar, e reiniciar pede confirmação.
  const busy = session.local !== null || [...session.links.values()].some((l) => l.iWatch)
  useEffect(() => {
    void window.aquarium.setBusy(busy)
    return () => void window.aquarium.setBusy(false)
  }, [busy])

  // Ao abrir o app, volta para a última sala (só na primeira conexão; depois de uma queda,
  // o RoomClient já volta sozinho para a sala em que estava).
  const autoJoined = useRef(false)
  useEffect(() => {
    if (autoJoined.current || client.connections === 0) return
    autoJoined.current = true
    const last = getSettings().lastRoomId
    if (client.me?.roomId == null && last && client.state.rooms.some((r) => r.id === last)) client.join(last)
  }, [client, client.connections])

  useEffect(() => {
    if (roomId !== null) updateSettings({ lastRoomId: roomId })
  }, [roomId])

  // ---------- salas ----------

  /** Trocar de sala ou sair encerra a transmissão; nesse caso, pergunta antes. */
  const join = (id: string | null): void => {
    if (id === roomId) return
    const go = (): void => {
      if (session.local) session.stopStreaming()
      client.join(id)
      setActiveId(null)
      if (id === null) updateSettings({ lastRoomId: null })
    }
    if (!session.local) return go()
    const target = client.state.rooms.find((r) => r.id === id)
    setConfirm({
      title: target ? `Entrar em ${target.name}?` : 'Sair da sala?',
      body: target
        ? 'Sua transmissão vai parar, porque só dá para transmitir para a sala em que você está.'
        : 'Sua transmissão vai parar junto.',
      action: target ? 'Parar e trocar de sala' : 'Parar e sair',
      onConfirm: go
    })
  }

  // ---------- assistir ----------

  const watching = (peerId: string): boolean => !!session.links.get(peerId)?.iWatch

  /** Nas abas, só a transmissão escolhida é baixada; a sua tela é só uma prévia local. */
  const showOnly = (id: string): void => {
    for (const t of tiles) {
      if (t.kind === 'own') continue
      const want = t.peerId === id
      if (watching(t.peerId) !== want) session.watch(t.peerId, want)
    }
  }

  const selectTab = (tile: Tile): void => {
    setActiveId(tile.id)
    if (view === 'abas') showOnly(tile.id)
    else if (tile.kind !== 'own') session.watch(tile.peerId, !watching(tile.peerId))
  }

  const watch = (peerId: string): void => {
    setActiveId(peerId)
    if (view === 'abas') showOnly(peerId)
    else session.watch(peerId, true)
  }

  // Garantia das abas: se algo religar outra transmissão (quem parou e voltou em seguida volta a ser
  // assistido sozinho), fica só a da aba escolhida.
  useEffect(() => {
    if (view !== 'abas') return
    const watched = [...session.links.values()].filter((l) => l.iWatch)
    if (watched.length > 1) for (const l of watched) if (l.peerId !== active?.id) session.watch(l.peerId, false)
  })

  const setView = (next: 'abas' | 'lado'): void => {
    updateSettings({ view: next })
    if (next === 'abas' && active) showOnly(active.id)
  }

  // ---------- transmitir ----------

  const captureRef = useRef<Capture | null>(null)

  // Trocar o modo de áudio ou a lista de bloqueados vale na hora, sem parar a transmissão.
  useEffect(() => {
    const capture = captureRef.current
    capture?.audio?.setMode(audioOptions(capture.source, settings))
  }, [settings.audioMode, settings.blockedApps])

  useEffect(() => {
    captureRef.current?.audio?.setVolume(settings.sendVolume)
  }, [settings.sendVolume])

  useEffect(() => {
    if (!session.local) setOptionsOpen(false)
  }, [session.local])

  const startStreaming = async (source: Parameters<typeof startCapture>[0]): Promise<void> => {
    setPicker(false)
    try {
      const capture = await startCapture(source, PRESETS[settings.presetId], settings)
      captureRef.current = capture
      await session.startStreaming(capture.stream, capture.label, () => {
        capture.stop()
        if (captureRef.current === capture) captureRef.current = null
      })
    } catch (err) {
      log.error('falha ao começar a transmissão', { error: errorInfo(err) })
      setError('Não foi possível capturar essa tela ou janela. Tente outra.')
    }
  }

  // ---------- tela cheia, zoom e teclado ----------

  // A tela cheia é do palco inteiro: as abas e os menus continuam funcionando dentro dela.
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stageRef.current?.requestFullscreen()
  }
  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const registerZoom = useCallback((tileId: string, zoom: ((action: ZoomAction) => void) | null) => {
    if (zoom) zoomers.current.set(tileId, zoom)
    else zoomers.current.delete(tileId)
  }, [])

  const toggleMute = (peerId: string): void =>
    setMutedPeers((prev) => {
      const next = new Set(prev)
      if (next.has(peerId)) next.delete(peerId)
      else next.add(peerId)
      return next
    })

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return
    const target = e.target as HTMLElement | null
    // O controle de volume é um input, mas as teclas de atalho continuam valendo depois de mexer nele.
    if (target?.closest('input:not([type="range"]), select, textarea, [role="menu"], [role="dialog"]')) return
    if (document.querySelector('.modal-backdrop')) return
    const zoomTarget = view === 'abas' ? active?.id : (hoverId.current ?? active?.id)
    const key = e.key.toLowerCase()
    if (/^[1-9]$/.test(key)) {
      const tile = tiles[Number(key) - 1]
      if (tile) selectTab(tile)
    } else if (key === 'f') toggleFullscreen()
    else if (key === 'b' && !fullscreen) updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })
    else if (key === 'm') {
      const tile = tiles.find((t) => t.id === zoomTarget)
      if (tile?.kind === 'remote') toggleMute(tile.peerId)
    } else if (zoomTarget && (key === 'z' || key === '+' || key === '=' || key === '-' || key === '0')) {
      const action: ZoomAction = key === 'z' ? 'toggle' : key === '0' ? 'reset' : key === '-' ? 'out' : 'in'
      zoomers.current.get(zoomTarget)?.(action)
    } else return
    e.preventDefault()
  }
  const onKeyRef = useRef(onKey)
  onKeyRef.current = onKey
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => onKeyRef.current(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ---------- menus ----------

  // Clicar de novo no botão que abriu o menu fecha o menu.
  const openMenu = (tileId: string, at: MenuPosition, anchor?: HTMLElement): void =>
    setMenu((current) => (anchor && current?.anchor === anchor ? null : { tileId, at, anchor }))
  const menuTile = menu ? tiles.find((t) => t.id === menu.tileId) : undefined

  const tileProps = {
    session,
    onWatch: watch,
    onToggleMute: toggleMute,
    onVolume: (peerId: string, volume: number) => updateSettings({ volumes: { ...settings.volumes, [peerId]: volume } }),
    onMenu: openMenu,
    onFullscreen: toggleFullscreen,
    onHover: (id: string | null) => (hoverId.current = id),
    registerZoom
  }
  const tileView = (t: Tile): React.JSX.Element => (
    <TileView
      key={t.id}
      tile={t}
      muted={masterMuted || mutedPeers.has(t.peerId)}
      volume={settings.volumes[t.peerId] ?? 1}
      fullscreen={fullscreen}
      {...tileProps}
    />
  )
  const shown = view === 'abas' ? (active ? [active] : []) : tiles
  const collapsed = settings.sidebarCollapsed

  return (
    <div className={`palco ${collapsed ? 'collapsed' : ''}`}>
      {!collapsed && (
        <Sidebar
          client={client}
          session={session}
          roomId={roomId}
          masterMuted={masterMuted}
          optionsOpen={optionsOpen}
          optionsButton={optionsButton}
          onJoin={join}
          onLeave={() => join(null)}
          onCreateRoom={() => setCreatingRoom(true)}
          onDeleteRoom={(id, name) =>
            setConfirm({
              title: `Apagar a sala ${name}?`,
              body: 'Quem estiver nela volta para fora das salas, e as transmissões de dentro dela param.',
              action: 'Apagar sala',
              onConfirm: () => client.deleteRoom(id)
            })
          }
          onWatch={watch}
          onStream={() => setPicker(true)}
          onOptions={() => setOptionsOpen((v) => !v)}
          onChangeSource={() => setPicker(true)}
          onStop={() => session.stopStreaming()}
          onToggleMasterMute={() => setMasterMuted((v) => !v)}
          onSettings={() => setSettingsOpen(true)}
          onCollapse={() => updateSettings({ sidebarCollapsed: true })}
        />
      )}

      <main ref={stageRef} className={`stage ${fullscreen ? 'fullscreen' : ''} ${idle ? 'idle' : ''} view-${view}`}>
        <header className="stream-bar drag">
          {collapsed && !fullscreen && (
            <button className="bar-btn" aria-label="Mostrar a barra lateral (B)" title="Mostrar a barra lateral (B)" onClick={() => updateSettings({ sidebarCollapsed: false })}>
              <IconSidebar size={18} />
            </button>
          )}
          {room && <h1 className="bar-room">{room.name}</h1>}
          {tiles.length > 0 && <StreamTabs tiles={tiles} activeId={active?.id ?? null} view={view} onSelect={selectTab} />}
          <span className="spacer" />
          {tiles.length > 1 && (
            <button className={`bar-toggle ${view === 'lado' ? 'on' : ''}`} aria-pressed={view === 'lado'} onClick={() => setView(view === 'lado' ? 'abas' : 'lado')}>
              <IconSideBySide size={16} />
              Lado a lado
            </button>
          )}
          {fullscreen && (
            <button className="bar-toggle" onClick={toggleFullscreen}>
              <IconExitFullscreen size={16} />
              Sair da tela cheia
              <kbd>Esc</kbd>
            </button>
          )}
        </header>

        {(client.status === 'recusado' || client.error) && (
          <p className="alert stage-alert">{client.status === 'recusado' && !client.error ? 'O servidor recusou a entrada no grupo.' : client.error}</p>
        )}
        {error && (
          <p className="alert stage-alert" onClick={() => setError(null)}>
            {error}
          </p>
        )}

        <div className="stage-body">
          {roomId === null ? (
            <div className="empty">
              <h2>Escolha uma sala na barra lateral</h2>
              <p className="muted">Quem estiver transmitindo nela aparece aqui, uma aba por pessoa.</p>
              <button className="btn" onClick={() => setCreatingRoom(true)}>
                <IconPlus size={16} />
                Criar sala
              </button>
            </div>
          ) : tiles.length === 0 ? (
            <div className="empty">
              <h2>Ninguém está transmitindo em {room?.name}</h2>
              <p className="muted">Qualquer pessoa da sala pode mostrar a tela.</p>
              <button className="btn primary" onClick={() => setPicker(true)}>
                <IconScreen size={18} />
                Transmitir minha tela
              </button>
            </div>
          ) : (
            <div className={`tiles count-${shown.length > 1 ? 'many' : 'one'}`}>{shown.map(tileView)}</div>
          )}
        </div>

        {menu && menuTile && (
          <ContextMenu at={menu.at} label="Opções da transmissão" toggle={menu.anchor} onClose={() => setMenu(null)}>
            {menuTile.kind === 'own' ? (
              <OwnMenu
                label={menuTile.label}
                onChangeSource={() => {
                  setMenu(null)
                  setPicker(true)
                }}
                onDiagnostics={async () => copyText(await ownDiagnostics(session, nameOf))}
                onStop={() => {
                  setMenu(null)
                  session.stopStreaming()
                }}
              />
            ) : menuTile.kind === 'remote' ? (
              <RemoteMenu
                tile={menuTile}
                muted={mutedPeers.has(menuTile.peerId)}
                onToggleMute={() => toggleMute(menuTile.peerId)}
                onStopWatching={() => session.watch(menuTile.peerId, false)}
                onClose={() => setMenu(null)}
              />
            ) : null}
          </ContextMenu>
        )}
      </main>

      {optionsOpen && session.local && <StreamOptions session={session} nameOf={nameOf} toggle={optionsButton} onClose={() => setOptionsOpen(false)} />}
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
      {confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />}
      {settingsOpen && (
        <SettingsDialog
          client={client}
          groupCode={groupCode}
          streaming={session.local !== null}
          onClose={() => setSettingsOpen(false)}
          onLeaveGroup={onLeaveGroup}
          onManual={onManual}
        />
      )}
    </div>
  )
}

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

function ConfirmDialog({ confirm, onClose }: { confirm: Confirm; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal small" role="alertdialog" aria-label={confirm.title}>
        <h2>{confirm.title}</h2>
        <p className="muted">{confirm.body}</p>
        <div className="choice-row end">
          <button className="btn ghost" autoFocus onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn danger"
            onClick={() => {
              confirm.onConfirm()
              onClose()
            }}
          >
            {confirm.action}
          </button>
        </div>
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
