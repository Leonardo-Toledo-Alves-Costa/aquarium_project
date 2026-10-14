// Preferências do usuário, guardadas neste computador.
// O código do grupo NÃO fica aqui: vai cifrado pelo processo principal (safeStorage).

import { useSyncExternalStore } from 'react'
import type { BandwidthMode } from './rtc/governor'
import { PRESETS, type CodecChoice, type PresetId, type Priority } from './rtc/presets'
import type { SessionSettings } from './rtc/room-session'

export type AudioMode = 'app' | 'all' | 'none'
export type LayoutMode = 'lado' | 'foco'

export interface AppSettings {
  name: string
  peerId: string
  serverUrl: string
  presetId: PresetId
  priority: Priority
  codec: CodecChoice
  bandwidth: BandwidthMode
  audioMode: AudioMode
  /** Volume do áudio enviado, de 0 a 1,5. */
  sendVolume: number
  /** Apps (nome do .exe) que nunca entram no áudio, além de Discord e Aquarium. */
  blockedApps: string[]
  layout: LayoutMode
  /** Volume por pessoa assistida, de 0 a 2. */
  volumes: Record<string, number>
}

export const DEFAULT_SERVER: string = import.meta.env.VITE_AQUARIUM_SERVER ?? 'ws://127.0.0.1:8787'

/**
 * Nunca entram no áudio da transmissão, para não dar retorno.
 * O próprio Aquarium é excluído pelo número do processo, não pelo nome.
 */
export const ALWAYS_BLOCKED = ['Discord.exe', 'DiscordPTB.exe', 'DiscordCanary.exe', 'Aquarium.exe']

const KEY = 'aquarium.settings'

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return 'p' + [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20)
}

function load(): AppSettings {
  const defaults: AppSettings = {
    name: '',
    peerId: randomId(),
    serverUrl: DEFAULT_SERVER,
    presetId: 'jogo',
    priority: PRESETS.jogo.defaultPriority,
    codec: 'auto',
    bandwidth: 'auto',
    audioMode: 'app',
    sendVolume: 1,
    blockedApps: [],
    layout: 'lado',
    volumes: {}
  }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const merged = { ...defaults, ...saved }
    if (!saved.peerId) localStorage.setItem(KEY, JSON.stringify(merged))
    return merged
  } catch {
    return defaults
  }
}

let current = load()
const listeners = new Set<() => void>()

export function getSettings(): AppSettings {
  return current
}

export function updateSettings(changes: Partial<AppSettings>): void {
  current = { ...current, ...changes }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Sem armazenamento: as preferências valem só até fechar o app.
  }
  for (const listener of listeners) listener()
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSettings
  )
}

export function sessionSettings(s: AppSettings): SessionSettings {
  return { preset: PRESETS[s.presetId], priority: s.priority, codec: s.codec, bandwidth: s.bandwidth }
}
