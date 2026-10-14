// Ajustes no SDP que a API do WebRTC não expõe de outra forma.

const VIDEO_CODECS = new Set(['H264', 'VP8', 'VP9', 'AV1'])

export interface BitrateHints {
  startKbps: number
  minKbps: number
  maxKbps: number
}

/**
 * Acrescenta os parâmetros x-google-*-bitrate aos codecs de vídeo. Aplicado na resposta
 * recebida por quem transmite, faz o codificador começar com mais banda em vez de ~300 kbps
 * e não descer abaixo do piso.
 */
export function withBitrateHints(sdp: string, hints: BitrateHints): string {
  const lines = sdp.split('\r\n')
  const params = `x-google-start-bitrate=${hints.startKbps};x-google-min-bitrate=${hints.minKbps};x-google-max-bitrate=${hints.maxKbps}`

  const videoPayloads = new Set<string>()
  let inVideo = false
  for (const line of lines) {
    if (line.startsWith('m=')) inVideo = line.startsWith('m=video')
    const match = inVideo && /^a=rtpmap:(\d+) ([^/]+)\//.exec(line)
    if (match && VIDEO_CODECS.has(match[2].toUpperCase())) videoPayloads.add(match[1])
  }

  const withFmtp = new Set<string>()
  const result = lines.map((line) => {
    const match = /^a=fmtp:(\d+) (.*)$/.exec(line)
    if (!match || !videoPayloads.has(match[1])) return line
    withFmtp.add(match[1])
    const existing = match[2].split(';').filter((p) => !p.startsWith('x-google-'))
    return `a=fmtp:${match[1]} ${[...existing, params].join(';')}`
  })

  // Codecs sem linha fmtp (como o VP8) ganham uma logo depois do rtpmap.
  return result
    .flatMap((line) => {
      const match = /^a=rtpmap:(\d+) /.exec(line)
      if (match && videoPayloads.has(match[1]) && !withFmtp.has(match[1])) {
        return [line, `a=fmtp:${match[1]} ${params}`]
      }
      return [line]
    })
    .join('\r\n')
}
