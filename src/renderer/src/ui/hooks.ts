import { useEffect, useReducer, useRef, useState } from 'react'
import type { StatsSample, StatsSampler } from '../rtc/stats'

/** Re-renderiza quando o objeto avisa que mudou (RoomClient, RoomSession). */
export function useSubscribe(target: { subscribe(listener: () => void): () => void } | null): void {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => target?.subscribe(rerender), [target])
}

export function useStats(sampler: StatsSampler | undefined, active: boolean): StatsSample | null {
  const [sample, setSample] = useState<StatsSample | null>(null)
  useEffect(() => {
    if (!sampler || !active) return
    let cancelled = false
    const tick = (): void => {
      sampler.sample().then((s) => !cancelled && setSample(s))
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sampler, active])
  return sample
}

let audioContext: AudioContext | null = null

/**
 * Toca o áudio de uma transmissão com volume próprio (até 200%).
 * O vídeo fica mudo; o som passa por um ganho do Web Audio.
 */
export function useStreamAudio(stream: MediaStream | null, volume: number, muted: boolean): void {
  const gainRef = useRef<GainNode | null>(null)

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return
    audioContext ??= new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    const gain = audioContext.createGain()
    source.connect(gain).connect(audioContext.destination)
    gainRef.current = gain
    audioContext.resume().catch(() => {})
    return () => {
      source.disconnect()
      gain.disconnect()
      gainRef.current = null
    }
  }, [stream, stream?.getAudioTracks().length])

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = muted ? 0 : volume
  }, [volume, muted, stream])
}

/** Fecha algo (menu, popover) ao clicar fora ou apertar Esc. */
export function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return
    const onPointer = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, onClose, active])
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
