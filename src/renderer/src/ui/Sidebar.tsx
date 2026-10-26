import { useState } from 'react'
import type { MemberInfo } from '../../../shared/rooms-protocol'
import type { RoomSession } from '../rtc/room-session'
import type { RoomClient } from '../signaling/rooms'
import { Avatar } from './Avatar'
import { ContextMenu, MenuItem, MenuSeparator, MenuTitle, type MenuPosition } from './ContextMenu'
import { useUpdateState } from './hooks'
import {
  IconDownload,
  IconEye,
  IconGear,
  IconLeave,
  IconPlus,
  IconScreen,
  IconSidebar,
  IconSliders,
  IconSpeaker,
  IconSpeakerOff,
  IconStop,
  IconSwap,
  IconTank
} from './icons'

const STATUS_TEXT: Record<string, string> = {
  conectando: 'conectando…',
  reconectando: 'reconectando…',
  recusado: 'recusado pelo servidor'
}

/** Salas com quem está em cada uma, quem está ao vivo, e a sua transmissão no rodapé. */
export function Sidebar({
  client,
  session,
  roomId,
  masterMuted,
  optionsOpen,
  optionsButton,
  onJoin,
  onLeave,
  onCreateRoom,
  onDeleteRoom,
  onWatch,
  onStream,
  onOptions,
  onChangeSource,
  onStop,
  onToggleMasterMute,
  onSettings,
  onCollapse
}: {
  client: RoomClient
  session: RoomSession
  roomId: string | null
  masterMuted: boolean
  optionsOpen: boolean
  optionsButton: React.RefObject<HTMLButtonElement | null>
  onJoin: (roomId: string) => void
  onLeave: () => void
  onCreateRoom: () => void
  onDeleteRoom: (roomId: string, name: string) => void
  onWatch: (peerId: string) => void
  onStream: () => void
  onOptions: () => void
  onChangeSource: () => void
  onStop: () => void
  onToggleMasterMute: () => void
  onSettings: () => void
  onCollapse: () => void
}): React.JSX.Element {
  const update = useUpdateState()
  const [menu, setMenu] = useState<{ roomId: string; at: MenuPosition } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const { rooms, members } = client.state
  const outside = members.filter((m) => m.roomId === null)
  const menuRoom = menu ? rooms.find((r) => r.id === menu.roomId) : undefined
  const me = client.me

  return (
    <aside className="sidebar" aria-label="Salas e pessoas">
      <div className="sidebar-head drag">
        <span className="brand">Aquarium</span>
        {client.status !== 'conectado' && (
          <span className={`conn-warning ${client.status}`} role="status">
            {STATUS_TEXT[client.status] ?? client.status}
          </span>
        )}
        <span className="spacer" />
        {update.ready && (
          <button
            className="bar-btn update"
            aria-label={`Atualização ${update.version} pronta. Reiniciar para instalar`}
            title={`Versão ${update.version} pronta: clique para reiniciar e atualizar`}
            onClick={() => void window.aquarium.installUpdate()}
          >
            <IconDownload size={18} />
          </button>
        )}
        <button className="bar-btn" aria-label="Recolher a barra lateral (B)" title="Recolher a barra lateral (B)" onClick={onCollapse}>
          <IconSidebar size={18} />
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="section-label row">
          <span>Salas</span>
          <button className="bar-btn small" aria-label="Criar sala" title="Criar sala" onClick={onCreateRoom}>
            <IconPlus size={16} />
          </button>
        </div>

        {rooms.map((r) => {
          const inRoom = members.filter((m) => m.roomId === r.id)
          const current = r.id === roomId
          return (
            <div key={r.id} className="room">
              {renaming?.id === r.id ? (
                <form
                  className="room-rename"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (renaming.name.trim()) client.renameRoom(r.id, renaming.name.trim())
                    setRenaming(null)
                  }}
                >
                  <label htmlFor={`rename-${r.id}`} className="sr-only">
                    Novo nome da sala
                  </label>
                  <input
                    id={`rename-${r.id}`}
                    autoFocus
                    maxLength={32}
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: r.id, name: e.target.value })}
                    onBlur={() => setRenaming(null)}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                  />
                </form>
              ) : (
                <button
                  className={`room-btn ${current ? 'current' : ''} ${menu?.roomId === r.id ? 'menu-open' : ''}`}
                  aria-current={current}
                  onClick={() => onJoin(r.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ roomId: r.id, at: { x: e.clientX, y: e.clientY } })
                  }}
                >
                  <IconTank size={18} />
                  <span className="room-name">{r.name}</span>
                  {inRoom.length > 0 && <span className="room-count">{inRoom.length}</span>}
                </button>
              )}
              {inRoom.map((m) => (
                <Person key={m.peerId} member={m} self={m.peerId === client.peerId} sameRoom={current} session={session} onWatch={onWatch} />
              ))}
            </div>
          )
        })}

        {outside.length > 0 && (
          <>
            <div className="section-label">Fora das salas · {outside.length}</div>
            {outside.map((m) => (
              <div key={m.peerId} className="person outside">
                <Avatar peerId={m.peerId} name={m.name} size={24} />
                <span className="person-name">
                  {m.name}
                  {m.peerId === client.peerId ? ' (você)' : ''}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {roomId !== null && (
        <section className="own-stream" aria-label="Sua transmissão">
          {session.local ? (
            <>
              <div className="own-title">
                <span className="live-pill">AO VIVO</span>
                <strong>{session.local.label}</strong>
              </div>
              <OwnStats session={session} />
              <button ref={optionsButton} className="btn" aria-expanded={optionsOpen} onClick={onOptions}>
                <IconSliders size={16} />
                Áudio e qualidade
              </button>
              <div className="own-actions">
                <button className="btn" onClick={onChangeSource}>
                  <IconSwap size={16} />
                  Trocar janela
                </button>
                <button className="btn danger" onClick={onStop}>
                  <IconStop size={14} />
                  Parar
                </button>
              </div>
            </>
          ) : (
            <button className="btn primary wide" onClick={onStream}>
              <IconScreen size={18} />
              Transmitir minha tela
            </button>
          )}
        </section>
      )}

      <div className="user-strip">
        {me && <Avatar peerId={me.peerId} name={me.name} size={30} />}
        <span className="user-name">{me?.name ?? ''}</span>
        <button
          className="bar-btn"
          aria-pressed={masterMuted}
          aria-label={masterMuted ? 'Ativar o som das transmissões' : 'Silenciar todas as transmissões'}
          title={masterMuted ? 'Ativar o som das transmissões' : 'Silenciar todas as transmissões'}
          onClick={onToggleMasterMute}
        >
          {masterMuted ? <IconSpeakerOff size={18} /> : <IconSpeaker size={18} />}
        </button>
        <button className="bar-btn" aria-label="Configurações" title="Configurações" onClick={onSettings}>
          <IconGear size={18} />
        </button>
        <button className="bar-btn" aria-label="Sair da sala" title="Sair da sala" disabled={roomId === null} onClick={onLeave}>
          <IconLeave size={18} />
        </button>
      </div>

      {menu && menuRoom && (
        <ContextMenu at={menu.at} label={`Sala ${menuRoom.name}`} onClose={() => setMenu(null)}>
          <MenuTitle>{menuRoom.name}</MenuTitle>
          {menuRoom.id !== roomId && (
            <MenuItem
              onClick={() => {
                setMenu(null)
                onJoin(menuRoom.id)
              }}
            >
              Entrar na sala
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              setMenu(null)
              setRenaming({ id: menuRoom.id, name: menuRoom.name })
            }}
          >
            Renomear
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            danger
            onClick={() => {
              setMenu(null)
              onDeleteRoom(menuRoom.id, menuRoom.name)
            }}
          >
            Apagar sala
          </MenuItem>
        </ContextMenu>
      )}
    </aside>
  )
}

function Person({
  member,
  self,
  sameRoom,
  session,
  onWatch
}: {
  member: MemberInfo
  self: boolean
  sameRoom: boolean
  session: RoomSession
  onWatch: (peerId: string) => void
}): React.JSX.Element {
  const watching = !self && !!session.links.get(member.peerId)?.iWatch
  const watchers = self ? [...session.links.values()].filter((l) => l.theyWatch).length : 0
  return (
    <div className="person">
      <Avatar peerId={member.peerId} name={member.name} size={24} />
      <span className="person-text">
        <span className="person-name">
          {member.name}
          {self ? ' (você)' : ''}
        </span>
        {member.streaming && (
          <span className="person-live">
            <span className="live-dot" />
            {member.streamLabel ?? 'Tela'}
            {self && watchers > 0 ? ` · ${watchers} assistindo` : ''}
          </span>
        )}
      </span>
      {member.streaming && sameRoom && !self &&
        (watching ? (
          <span className="watching">
            <IconEye size={14} />
            vendo
          </span>
        ) : (
          <button className="btn small" onClick={() => onWatch(member.peerId)}>
            Assistir
          </button>
        ))}
    </div>
  )
}

function OwnStats({ session }: { session: RoomSession }): React.JSX.Element {
  const s = session.local?.stream.getVideoTracks()[0]?.getSettings()
  const watchers = [...session.links.values()].filter((l) => l.theyWatch).length
  const parts = [s?.height ? `${s.height}p` : null, s?.frameRate ? `${Math.round(s.frameRate)} fps` : null, watchers === 0 ? 'ninguém assistindo' : `${watchers} assistindo`]
  return <span className="own-stats">{parts.filter(Boolean).join(' · ')}</span>
}
