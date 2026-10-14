// Trilha de áudio da transmissão, alimentada pelo aquarium-audio.exe.
// A trilha existe sempre (em silêncio no modo "sem áudio"), então trocar de modo
// durante a transmissão não exige renegociar a conexão com quem assiste.

import type { AudioOptions } from '../../../shared/ipc'
import workletUrl from './pcm-worklet.ts?worker&url'

export interface AppAudio {
  track: MediaStreamTrack
  setMode(options: AudioOptions): Promise<void>
  setVolume(volume: number): void
  stop(): void
}

function nextAudioPort(): Promise<MessagePort> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent): void => {
      if (event.data?.type === 'aquarium-audio-port' && event.ports[0]) {
        window.removeEventListener('message', onMessage)
        resolve(event.ports[0])
      }
    }
    window.addEventListener('message', onMessage)
  })
}

export async function startAppAudio(options: AudioOptions, volume: number): Promise<AppAudio> {
  const context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
  await context.audioWorklet.addModule(workletUrl)
  const player = new AudioWorkletNode(context, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] })
  const gain = context.createGain()
  gain.gain.value = volume
  const destination = context.createMediaStreamDestination()
  player.connect(gain).connect(destination)

  const port = nextAudioPort()
  await window.aquarium.startAudio(options)
  const audioPort = await port
  player.port.postMessage({ port: audioPort }, [audioPort])

  const track = destination.stream.getAudioTracks()[0]
  track.contentHint = 'music'
  return {
    track,
    setMode: (next) => window.aquarium.updateAudio(next),
    setVolume: (v) => {
      gain.gain.value = v
    },
    stop: () => {
      window.aquarium.stopAudio()
      track.stop()
      context.close()
    }
  }
}
