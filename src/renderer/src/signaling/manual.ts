// Sinalização da opção A: o convite e a resposta viram textos que as pessoas
// copiam e colam (WhatsApp, por exemplo). Trocar para a opção B ou C significa
// substituir este módulo; a camada de WebRTC continua igual.

const PREFIX = 'AQ1'
const TAG = { offer: 'C', answer: 'R' } as const

export class CodeError extends Error {}

type DescriptionType = keyof typeof TAG

export async function encodeDescription(desc: RTCSessionDescriptionInit): Promise<string> {
  if ((desc.type !== 'offer' && desc.type !== 'answer') || !desc.sdp) {
    throw new Error('Descrição de sessão inválida')
  }
  const compressed = await transform(new TextEncoder().encode(desc.sdp), new CompressionStream('deflate-raw'))
  return `${PREFIX}.${TAG[desc.type]}.${toBase64Url(compressed)}`
}

export async function decodeDescription(code: string, expected: DescriptionType): Promise<RTCSessionDescriptionInit> {
  // Apps de mensagem às vezes quebram textos longos em várias linhas.
  const [prefix, tag, payload] = code.replace(/\s+/g, '').split('.')

  if (prefix?.startsWith('AQ') && prefix !== PREFIX) {
    throw new CodeError('Esse código é de outra versão do Aquário. Os dois precisam usar a mesma versão.')
  }
  if (prefix !== PREFIX || !tag || !payload) {
    throw new CodeError('Isso não parece um código do Aquário. Copie o código inteiro de novo.')
  }
  if (tag !== TAG[expected]) {
    throw new CodeError(
      expected === 'offer'
        ? 'Esse é um código de resposta. Aqui vai o convite de quem está transmitindo.'
        : 'Esse é um código de convite. Aqui vai a resposta de quem vai assistir.'
    )
  }

  try {
    const sdp = new TextDecoder().decode(await transform(fromBase64Url(payload), new DecompressionStream('deflate-raw')))
    return { type: expected, sdp }
  } catch {
    throw new CodeError('O código está incompleto ou foi alterado. Peça para copiarem de novo.')
  }
}

async function transform(
  data: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream
): Promise<Uint8Array<ArrayBuffer>> {
  const output = new Blob([data]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(output).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}
