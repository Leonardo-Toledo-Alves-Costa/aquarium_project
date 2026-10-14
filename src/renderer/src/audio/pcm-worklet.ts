// Roda na thread de áudio: recebe PCM 16 bits estéreo do aquarium-audio.exe e toca na
// velocidade do relógio de áudio, com um colchão pequeno para absorver irregularidades.

declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

const CAPACITY = 48000 // 1 s de quadros
const PREBUFFER = 1440 // 30 ms antes de começar (ou recomeçar depois de esvaziar)
const MAX_LATENCY = 7200 // acima de 150 ms, descarta o excesso
const TARGET_AFTER_DROP = 2880 // volta para 60 ms

class PcmPlayer extends AudioWorkletProcessor {
  private left = new Float32Array(CAPACITY)
  private right = new Float32Array(CAPACITY)
  private read = 0
  private write = 0
  private size = 0
  private playing = false

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent) => {
      const source: MessagePort | undefined = event.data?.port
      if (source) source.onmessage = (e: MessageEvent<Uint8Array>) => this.push(e.data)
    }
  }

  private push(bytes: Uint8Array): void {
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1)
    for (let i = 0; i + 1 < samples.length; i += 2) {
      this.left[this.write] = samples[i] / 32768
      this.right[this.write] = samples[i + 1] / 32768
      this.write = (this.write + 1) % CAPACITY
      if (this.size < CAPACITY) this.size++
      else this.read = (this.read + 1) % CAPACITY
    }
    if (this.size > MAX_LATENCY) {
      const drop = this.size - TARGET_AFTER_DROP
      this.read = (this.read + drop) % CAPACITY
      this.size -= drop
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [outL, outR] = outputs[0]
    const frames = outL.length
    if (!this.playing && this.size >= PREBUFFER) this.playing = true
    if (!this.playing || this.size < frames) {
      this.playing = false
      outL.fill(0)
      outR?.fill(0)
      return true
    }
    for (let i = 0; i < frames; i++) {
      outL[i] = this.left[this.read]
      if (outR) outR[i] = this.right[this.read]
      this.read = (this.read + 1) % CAPACITY
    }
    this.size -= frames
    return true
  }
}

// O áudio é gerado a 48 kHz; o AudioContext é criado nessa mesma taxa para não reamostrar.
if (sampleRate !== 48000) console.warn('pcm-player: taxa de amostragem inesperada', sampleRate)
registerProcessor('pcm-player', PcmPlayer)
