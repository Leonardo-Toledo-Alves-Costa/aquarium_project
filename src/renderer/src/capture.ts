// Monta o que vai ser transmitido: vídeo da tela/janela e o áudio por programa.

import type { AudioOptions, CaptureSource } from '../../shared/ipc'
import { startAppAudio, type AppAudio } from './audio/app-audio'
import type { Preset } from './rtc/presets'
import { ALWAYS_BLOCKED, type AppSettings } from './settings'

export interface Capture {
  stream: MediaStream
  label: string
  source: CaptureSource
  audio: AppAudio | null
  stop(): void
}

export function audioOptions(source: CaptureSource, settings: AppSettings): AudioOptions {
  return { mode: settings.audioMode, sourceId: source.id, blocked: [...ALWAYS_BLOCKED, ...settings.blockedApps] }
}

export async function startCapture(source: CaptureSource, preset: Preset, settings: AppSettings): Promise<Capture> {
  await window.aquarium.selectSource(source.id)
  // O áudio do sistema inteiro não é usado: ele levaria junto o Discord e o próprio Aquarium.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: preset.fps }, audio: false })

  let audio: AppAudio | null = null
  try {
    audio = await startAppAudio(audioOptions(source, settings), settings.sendVolume)
    stream.addTrack(audio.track)
  } catch (err) {
    console.warn('Transmissão sem áudio: a captura por programa não iniciou', err)
  }

  return {
    stream,
    label: labelFor(source),
    source,
    audio,
    stop: () => {
      audio?.stop()
      for (const track of stream.getTracks()) track.stop()
    }
  }
}

function labelFor(source: CaptureSource): string {
  if (source.kind === 'screen') return 'Tela inteira'
  // Títulos de janela costumam vir como "Documento - Programa"; o programa costuma ser a parte útil.
  const parts = source.name.split(/ [-–—] /)
  return (parts[parts.length - 1] || source.name).slice(0, 60)
}
