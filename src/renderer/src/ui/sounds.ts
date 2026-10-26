// Efeitos sonoros: gerados por scripts/sons/synth.py (síntese própria, sem arquivos de terceiros).

import { useEffect, useRef } from 'react'
import type { RoomSession } from '../rtc/room-session'
import { getSettings } from '../settings'
import type { RoomClient } from '../signaling/rooms'
import comecouAAssistir from '../assets/sons/comecou-a-assistir-voce.wav'
import conexaoCaiu from '../assets/sons/conexao-caiu.wav'
import conexaoVoltou from '../assets/sons/conexao-voltou.wav'
import entrouNaSala from '../assets/sons/entrou-na-sala.wav'
import saiuDaSala from '../assets/sons/saiu-da-sala.wav'
import transmissaoComecou from '../assets/sons/transmissao-comecou.wav'
import transmissaoTerminou from '../assets/sons/transmissao-terminou.wav'

const SOUNDS = {
  'conexao-caiu': conexaoCaiu,
  'conexao-voltou': conexaoVoltou,
  'entrou-na-sala': entrouNaSala,
  'saiu-da-sala': saiuDaSala,
  'transmissao-comecou': transmissaoComecou,
  'transmissao-terminou': transmissaoTerminou,
  'comecou-a-assistir-voce': comecouAAssistir
}
export type Sound = keyof typeof SOUNDS

/** Toca pelo próprio elemento de áudio, fora do caminho do som das transmissões. */
export function playSound(sound: Sound, volume = getSettings().effectsVolume): void {
  if (volume <= 0) return
  const audio = new Audio(SOUNDS[sound])
  audio.volume = Math.min(1, volume)
  audio.play().catch(() => {})
}

interface Snapshot {
  status: string
  roomId: string | null
  members: Set<string>
  streaming: Set<string>
  watchers: Set<string>
}

/** Depois de conectar ou reconectar, a lista de pessoas e de quem assiste se refaz: fica quieto um pouco. */
const QUIET_MS = 5000

/** Toca os efeitos quando algo muda na sua sala. Um som por vez, o mais importante. */
export function useRoomSounds(client: RoomClient, session: RoomSession): void {
  const previous = useRef<Snapshot | null>(null)
  const quietUntil = useRef(0)
  const connections = useRef(client.connections)

  const me = client.me
  const roomId = me?.roomId ?? null
  const inRoom = client.state.members.filter((m) => roomId !== null && m.roomId === roomId)
  const current: Snapshot = {
    status: client.status,
    roomId,
    members: new Set(inRoom.map((m) => m.peerId)),
    streaming: new Set(inRoom.filter((m) => m.streaming).map((m) => m.peerId)),
    watchers: new Set([...session.links.values()].filter((l) => l.theyWatch).map((l) => l.peerId))
  }

  useEffect(() => {
    const prev = previous.current
    previous.current = current
    const now = Date.now()
    if (client.connections !== connections.current) {
      connections.current = client.connections
      quietUntil.current = now + QUIET_MS
    }
    if (!prev) return

    if (prev.status === 'conectado' && current.status === 'reconectando') return playSound('conexao-caiu')
    if (prev.status === 'reconectando' && current.status === 'conectado') return playSound('conexao-voltou')
    if (current.status !== 'conectado' || now < quietUntil.current) return

    if (prev.roomId !== current.roomId) {
      if (current.roomId !== null) playSound('entrou-na-sala')
      else if (prev.roomId !== null) playSound('saiu-da-sala')
      return
    }
    if (current.roomId === null) return

    const added = (a: Set<string>, b: Set<string>): boolean => [...b].some((id) => !a.has(id))
    const stayed = (id: string): boolean => prev.members.has(id) && current.members.has(id)
    const started = [...current.streaming].some((id) => !prev.streaming.has(id) && stayed(id))
    const stopped = [...prev.streaming].some((id) => !current.streaming.has(id) && stayed(id))

    if (started) playSound('transmissao-comecou')
    else if (added(prev.watchers, current.watchers)) playSound('comecou-a-assistir-voce')
    else if (stopped) playSound('transmissao-terminou')
    else if (added(prev.members, current.members)) playSound('entrou-na-sala')
    else if (added(current.members, prev.members)) playSound('saiu-da-sala')
  })
}
