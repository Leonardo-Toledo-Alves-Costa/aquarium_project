import { useEffect, useRef, useState } from 'react'
import type { MemberInfo } from '../../../shared/rooms-protocol'
import { formatDiagnostics } from '../diagnostics'
import type { PeerLink, RoomSession } from '../rtc/room-session'
import { Avatar } from './Avatar'
import { MenuItem, MenuSeparator, MenuTitle, type MenuPosition } from './ContextMenu'
import { copyText, useStats, useStreamAudio } from './hooks'
import {
  IconExitFullscreen,
  IconEye,
  IconFullscreen,
  IconMore,
  IconPlay,
  IconSpeaker,
  IconSpeakerOff,
  IconZoomIn,
  IconZoomOut
} from './icons'

export type Tile =
  | { kind: 'own'; id: string; peerId: string; name: string; label: string; stream: MediaStream }
  | { kind: 'remote'; id: string; peerId: string; name: string; label: string; stream: MediaStream; link: PeerLink }
  | { kind: 'waiting'; id: string; peerId: string; name: string; label: string; watching: boolean }

/** Uma aba por pessoa transmitindo na sala; a sua por último. */
export function buildTiles(session: RoomSession, roomMembers: MemberInfo[], selfId: string): Tile[] {
  const tiles: Tile[] = []
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
  if (session.local) {
    const me = roomMembers.find((m) => m.peerId === selfId)
    tiles.push({ kind: 'own', id: 'me', peerId: selfId, name: me?.name ?? 'Você', label: session.local.label, stream: session.local.stream })
  }
  return tiles
}

// ---------- zoom ----------

export type ZoomAction = 'in' | 'out' | 'toggle' | 'reset'
interface Zoom {
  s: number
  x: number
  y: number
}
const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 }
const LEVELS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5]
const MAX_ZOOM = LEVELS[LEVELS.length - 1]

/** Próximo degrau de zoom para cima (1) ou para baixo (-1). */
function nextLevel(s: number, dir: 1 | -1): number {
  return dir > 0 ? (LEVELS.find((l) => l > s * 1.01) ?? MAX_ZOOM) : ([...LEVELS].reverse().find((l) => l < s * 0.99) ?? 1)
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** Não deixa a imagem ampliada sair da moldura (conta só o vídeo, sem as faixas pretas). */
function clampZoom(z: Zoom, box: DOMRect, video: HTMLVideoElement | null): Zoom {
  const s = clamp(z.s, 1, MAX_ZOOM)
  if (s < 1.01) return NO_ZOOM
  const vw = video?.videoWidth || box.width
  const vh = video?.videoHeight || box.height
  const fit = Math.min(box.width / vw, box.height / vh)
  const mx = Math.max(0, (vw * fit * s - box.width) / 2)
  const my = Math.max(0, (vh * fit * s - box.height) / 2)
  return { s, x: clamp(z.x, -mx, mx), y: clamp(z.y, -my, my) }
}

/** Amplia mantendo parado o ponto (px, py), medido a partir do centro da moldura. */
function zoomAt(z: Zoom, s: number, px: number, py: number): Zoom {
  const k = s / z.s
  return { s, x: px - k * (px - z.x), y: py - k * (py - z.y) }
}

// ---------- abas ----------

export function StreamTabs({
  tiles,
  activeId,
  view,
  onSelect
}: {
  tiles: Tile[]
  activeId: string | null
  view: 'abas' | 'lado'
  onSelect: (tile: Tile) => void
}): React.JSX.Element {
  return (
    <div className="tabs" role="tablist" aria-label="Transmissões da sala">
      {tiles.map((t, i) => {
        const watching = t.kind !== 'waiting' || t.watching
        const selected = view === 'abas' ? t.id === activeId : watching
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={selected}
            className={`tab ${selected ? 'on' : ''} ${watching ? '' : 'idle'}`}
            title={t.kind === 'own' ? 'Prévia da sua transmissão' : watching ? `Assistindo ${t.name}` : `Assistir ${t.name}`}
            onClick={() => onSelect(t)}
          >
            <span className="live-dot" />
            <span className="tab-name">{t.kind === 'own' ? 'Sua tela' : t.name}</span>
            <span className="tab-label">{t.label}</span>
            {i < 9 && <kbd>{i + 1}</kbd>}
          </button>
        )
      })}
    </div>
  )
}

// ---------- uma transmissão ----------

export interface TileViewProps {
  tile: Tile
  session: RoomSession
  muted: boolean
  volume: number
  fullscreen: boolean
  onWatch: (peerId: string) => void
  onToggleMute: (peerId: string) => void
  onVolume: (peerId: string, volume: number) => void
  onMenu: (tileId: string, at: MenuPosition, anchor?: HTMLElement) => void
  onFullscreen: () => void
  onHover: (tileId: string | null) => void
  registerZoom: (tileId: string, zoom: ((action: ZoomAction) => void) | null) => void
}

export function TileView({
  tile,
  session,
  muted,
  volume,
  fullscreen,
  onWatch,
  onToggleMute,
  onVolume,
  onMenu,
  onFullscreen,
  onHover,
  registerZoom
}: TileViewProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const ref = useRef<HTMLElement>(null)
  const stream = tile.kind === 'waiting' ? null : tile.stream
  useStreamAudio(tile.kind === 'remote' ? tile.stream : null, volume, muted)
  const stats = useStats(tile.kind === 'remote' ? tile.link.inStats : undefined, tile.kind === 'remote')
  const watchers = tile.kind === 'own' ? [...session.links.values()].filter((l) => l.theyWatch).length : 0

  const [zoom, setZoomState] = useState<Zoom>(NO_ZOOM)
  const zoomRef = useRef(zoom)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; from: Zoom; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  const setZoom = (next: Zoom): void => {
    const box = ref.current?.getBoundingClientRect()
    const z = box ? clampZoom(next, box, videoRef.current) : NO_ZOOM
    zoomRef.current = z
    setZoomState(z)
  }

  // Ponto de referência do zoom: onde está o mouse, ou o centro se o mouse está fora.
  const focus = (): { x: number; y: number } => pointer.current ?? { x: 0, y: 0 }
  const zoomStep = (dir: 1 | -1, at = focus()): void => {
    const z = zoomRef.current
    setZoom(zoomAt(z, nextLevel(z.s, dir), at.x, at.y))
  }
  const act = (action: ZoomAction): void => {
    if (!stream) return
    if (action === 'reset') setZoom(NO_ZOOM)
    else if (action === 'in') zoomStep(1)
    else if (action === 'out') zoomStep(-1)
    else if (zoomRef.current.s > 1) setZoom(NO_ZOOM)
    else setZoom(zoomAt(NO_ZOOM, 2, focus().x, focus().y))
  }
  const actRef = useRef(act)
  actRef.current = act

  useEffect(() => {
    registerZoom(tile.id, (action) => actRef.current(action))
    return () => registerZoom(tile.id, null)
  }, [tile.id, registerZoom])

  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream
  }, [stream])

  // O onWheel do React é passivo e não consegue impedir a rolagem; aqui o listener é do DOM.
  useEffect(() => {
    const el = ref.current
    if (!el || !stream) return
    // Um degrau a cada "clique" da roda; no touchpad, que manda passos pequenos, soma até dar um clique.
    let wheel = 0
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && zoomRef.current.s <= 1) return
      e.preventDefault()
      wheel += e.deltaY
      if (Math.abs(wheel) < 50) return
      const r = el.getBoundingClientRect()
      zoomStep(wheel < 0 ? 1 : -1, { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 })
      wheel = 0
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [stream])

  const onPointerMove = (e: React.PointerEvent): void => {
    const r = e.currentTarget.getBoundingClientRect()
    pointer.current = { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    setDragging(true)
    setZoom({ s: d.from.s, x: d.from.x + dx, y: d.from.y + dy })
  }

  const endDrag = (): void => {
    drag.current = null
    setDragging(false)
  }

  const z = zoom
  const zoomed = z.s > 1
  const percent = `${Math.round(z.s * 100)}%`

  return (
    <section
      ref={ref}
      className={`tile ${tile.kind} ${zoomed ? 'zoomed' : ''} ${dragging ? 'dragging' : ''}`}
      aria-label={tile.kind === 'own' ? 'Sua transmissão' : `Transmissão de ${tile.name}`}
      onContextMenu={(e) => {
        e.preventDefault()
        if (tile.kind !== 'waiting') onMenu(tile.id, { x: e.clientX, y: e.clientY })
      }}
      onDoubleClick={(e) => {
        if (stream && !(e.target as HTMLElement).closest('button, input')) onFullscreen()
      }}
      onPointerEnter={() => onHover(tile.id)}
      onPointerLeave={() => {
        pointer.current = null
        onHover(null)
      }}
      onPointerMove={onPointerMove}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, input')) return
        if (e.button === 1) {
          e.preventDefault()
          setZoom(NO_ZOOM)
        } else if (e.button === 0 && zoomRef.current.s > 1) {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: zoomRef.current, moved: false }
        }
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={zoomed ? { transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` } : undefined}
        />
      ) : (
        tile.kind === 'waiting' && (
          <div className="waiting-card">
            <div className="waiting-head">
              <Avatar peerId={tile.peerId} name={tile.name} size={40} />
              <span className="waiting-text">
                <strong>{tile.name} está transmitindo</strong>
                <span>{tile.label}</span>
              </span>
              <span className="live-pill">AO VIVO</span>
            </div>
            <button className="btn primary" disabled={tile.watching} onClick={() => onWatch(tile.peerId)}>
              {!tile.watching && <IconPlay size={16} />}
              {tile.watching ? 'Conectando…' : 'Assistir agora'}
            </button>
          </div>
        )
      )}

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

      {stream &&
        (zoomed ? (
          <button className="zoom-pill" onClick={() => setZoom(NO_ZOOM)}>
            <IconZoomIn size={16} />
            <strong>{percent}</strong>
            <span>· Voltar ao normal</span>
            <kbd>0</kbd>
          </button>
        ) : (
          <div className="tile-name">
            <Avatar peerId={tile.peerId} name={tile.name} size={24} />
            <span>{tile.kind === 'own' ? `${tile.name} (você)` : tile.name}</span>
            <span className="live-pill">AO VIVO</span>
          </div>
        ))}

      {stream && (
        <div className="hud" role="toolbar" aria-label="Controles da transmissão">
          {tile.kind === 'remote' && (
            <>
              <button className="hud-btn" aria-label={muted ? `Ativar o som de ${tile.name}` : `Silenciar ${tile.name}`} aria-pressed={muted} onClick={() => onToggleMute(tile.peerId)}>
                {muted ? <IconSpeakerOff size={18} /> : <IconSpeaker size={18} />}
              </button>
              <label htmlFor={`vol-${tile.id}`} className="sr-only">
                Volume de {tile.name}
              </label>
              <input
                id={`vol-${tile.id}`}
                className="hud-volume"
                type="range"
                min={0}
                max={200}
                step={5}
                value={Math.round(volume * 100)}
                onChange={(e) => onVolume(tile.peerId, Number(e.target.value) / 100)}
              />
              <span className="hud-value hud-volume">{Math.round(volume * 100)}%</span>
              <span className="hud-sep" />
            </>
          )}
          <button className="hud-btn" aria-label="Diminuir zoom (-)" disabled={!zoomed} onClick={() => zoomStep(-1, { x: 0, y: 0 })}>
            <IconZoomOut size={18} />
          </button>
          <span className="hud-value">{percent}</span>
          <button className="hud-btn" aria-label="Aumentar zoom (+)" disabled={z.s >= MAX_ZOOM} onClick={() => zoomStep(1, { x: 0, y: 0 })}>
            <IconZoomIn size={18} />
          </button>
          <span className="hud-sep" />
          <button
            className="hud-btn"
            aria-label="Mais opções"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              onMenu(tile.id, { x: r.right - 260, y: r.top - 8 - 220 }, e.currentTarget)
            }}
          >
            <IconMore size={18} />
          </button>
          <button className="hud-btn" aria-label={fullscreen ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'} onClick={onFullscreen}>
            {fullscreen ? <IconExitFullscreen size={18} /> : <IconFullscreen size={18} />}
          </button>
        </div>
      )}
    </section>
  )
}

// ---------- menus de uma transmissão ----------

export function RemoteMenu({
  tile,
  muted,
  onToggleMute,
  onStopWatching,
  onClose
}: {
  tile: Extract<Tile, { kind: 'remote' }>
  muted: boolean
  onToggleMute: () => void
  onStopWatching: () => void
  onClose: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <MenuTitle>
        <Avatar peerId={tile.peerId} name={tile.name} size={22} /> Transmissão de {tile.name}
      </MenuTitle>
      <button role="menuitemcheckbox" aria-checked={muted} className="menu-item" onClick={onToggleMute}>
        <span>Silenciar o áudio</span>
        <span className={`toggle ${muted ? 'on' : ''}`} aria-hidden="true" />
      </button>
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
          onStopWatching()
          onClose()
        }}
      >
        Parar de assistir
      </MenuItem>
    </>
  )
}

export function OwnMenu({
  label,
  onChangeSource,
  onDiagnostics,
  onStop
}: {
  label: string
  onChangeSource: () => void
  onDiagnostics: () => Promise<boolean>
  onStop: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <MenuTitle>
        <span className="live-pill">AO VIVO</span> Sua transmissão · {label}
      </MenuTitle>
      <MenuItem onClick={onChangeSource}>Trocar tela ou janela</MenuItem>
      <MenuItem onClick={async () => setCopied(await onDiagnostics())}>{copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}</MenuItem>
      <MenuSeparator />
      <MenuItem danger onClick={onStop}>
        Parar de transmitir
      </MenuItem>
    </>
  )
}
