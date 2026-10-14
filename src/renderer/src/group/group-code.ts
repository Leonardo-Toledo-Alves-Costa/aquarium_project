// Código do grupo: 128 bits aleatórios, mostrados como AQG-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX.
// Dele derivam três coisas independentes:
//  - id do grupo (vai na URL do servidor),
//  - senha de entrada (o servidor guarda só o hash),
//  - chave AES-GCM que cifra os sinais entre os PCs (o servidor nunca recebe).

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // base32 de Crockford: sem I, L, O, U
const PREFIX = 'AQG'

export interface GroupKeys {
  id: string
  auth: string
  signalKey: CryptoKey
}

export class GroupCodeError extends Error {}

export function generateGroupCode(): string {
  return formatCode(crypto.getRandomValues(new Uint8Array(16)))
}

/** Aceita o código com ou sem traços, maiúsculas ou minúsculas, e corrige I/L→1 e O→0. */
export function normalizeGroupCode(input: string): string {
  const bytes = parseCode(input)
  return formatCode(bytes)
}

export async function deriveGroupKeys(code: string): Promise<GroupKeys> {
  const secret = parseCode(code)
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const salt = new TextEncoder().encode('aquarium-v1')
  const bits = async (info: string, length: number): Promise<Uint8Array> =>
    new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info) }, base, length * 8)
    )
  const signalKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('aquarium/signal') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  return {
    id: toBase64Url(await bits('aquarium/group-id', 16)),
    auth: toBase64Url(await bits('aquarium/auth', 32)),
    signalKey
  }
}

function formatCode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return `${PREFIX}-${out.match(/.{1,4}/g)!.join('-')}`
}

function parseCode(input: string): Uint8Array<ArrayBuffer> {
  let text = input.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (text.startsWith(PREFIX)) text = text.slice(PREFIX.length)
  text = text.replace(/[IL]/g, '1').replace(/O/g, '0')
  if (text.length !== 26) throw new GroupCodeError('O código do grupo tem 26 caracteres depois de "AQG". Confira se copiou inteiro.')
  const bytes = new Uint8Array(16)
  let bits = 0
  let value = 0
  let index = 0
  for (const char of text) {
    const digit = ALPHABET.indexOf(char)
    if (digit === -1) throw new GroupCodeError(`O caractere "${char}" não existe em códigos do Aquarium.`)
    value = (value << 5) | digit
    bits += 5
    if (bits >= 8) {
      if (index < 16) bytes[index++] = (value >>> (bits - 8)) & 255
      bits -= 8
    }
  }
  return bytes
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}
