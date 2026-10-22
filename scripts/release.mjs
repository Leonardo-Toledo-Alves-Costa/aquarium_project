// Assinatura e publicação das atualizações do Aquarium.
//
//   node scripts/release.mjs keygen   cria a chave (uma vez) e grava a pública em src/main/update-key.ts
//   node scripts/release.mjs sign     assina o instalador descrito em dist/latest.yml
//   node scripts/release.mjs publish  cria a release v<versão> no GitHub com os arquivos assinados
//
// A chave privada fica fora do repositório (AQUARIUM_SIGNING_KEY, ou ~/.aquarium/update-signing-key.pem).
// Sem ela não dá para publicar uma atualização que o app aceite; guarde uma cópia em lugar seguro.

import { execFileSync } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const keyFile = process.env.AQUARIUM_SIGNING_KEY ?? join(homedir(), '.aquarium', 'update-signing-key.pem')
const publicKeyModule = join(root, 'src', 'main', 'update-key.ts')
// AQUARIUM_DIST troca a pasta (testes locais com outro servidor de atualização).
const dist = process.env.AQUARIUM_DIST ?? join(root, 'dist')
const SIGNATURE_FIELD = 'aquariumSignature'

/** O mesmo texto que src/main/updater.ts confere. */
const signedText = (version, sha512) => `aquarium-update-v1:${version}:${sha512}`

function fail(message) {
  console.error(message)
  process.exit(1)
}

function sha512Base64(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

function readManifest() {
  const file = join(dist, 'latest.yml')
  if (!existsSync(file)) fail('dist/latest.yml não existe. Rode "npm run dist:win" antes.')
  const text = readFileSync(file, 'utf8')
  const field = (name) => text.match(new RegExp(`^${name}: (.+)$`, 'm'))?.[1].trim().replace(/^'(.*)'$/, '$1')
  const version = field('version')
  const path = field('path')
  const sha512 = field('sha512')
  if (!version || !path || !sha512) fail('dist/latest.yml sem version, path ou sha512.')
  return { file, text, version, path, sha512 }
}

function keygen() {
  if (existsSync(keyFile)) {
    console.log(`A chave já existe em ${keyFile}; nada a fazer.`)
  } else {
    mkdirSync(dirname(keyFile), { recursive: true })
    const { privateKey } = generateKeyPairSync('ed25519')
    writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    console.log(`Chave privada criada em ${keyFile}. Faça uma cópia de segurança dela.`)
  }
  const publicPem = createPublicKey(createPrivateKey(readFileSync(keyFile))).export({ type: 'spki', format: 'pem' })
  writeFileSync(
    publicKeyModule,
    `// Chave pública das atualizações (gerada por scripts/release.mjs keygen).\n` +
      `// O app só instala uma atualização assinada pela chave privada correspondente.\n` +
      `export const UPDATE_PUBLIC_KEY = \`${publicPem.trim()}\`\n`
  )
  console.log(`Chave pública gravada em ${publicKeyModule}.`)
}

function signManifest() {
  if (!existsSync(keyFile)) fail(`Chave privada não encontrada em ${keyFile}.`)
  const manifest = readManifest()
  const installer = join(dist, manifest.path)
  if (!existsSync(installer)) fail(`${installer} não existe.`)
  if (sha512Base64(installer) !== manifest.sha512) fail('O sha512 do latest.yml não bate com o instalador em dist/.')

  const privateKey = createPrivateKey(readFileSync(keyFile))
  const message = Buffer.from(signedText(manifest.version, manifest.sha512))
  const signature = sign(null, message, privateKey)
  if (!verify(null, message, createPublicKey(privateKey), signature)) fail('A assinatura recém-criada não confere.')

  const embedded = readFileSync(publicKeyModule, 'utf8').match(/`([^`]+)`/)?.[1]
  if (embedded?.trim() !== createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).trim()) {
    fail('A chave pública dentro do app (src/main/update-key.ts) não é desta chave privada.')
  }

  const unsigned = manifest.text.replace(new RegExp(`^${SIGNATURE_FIELD}: .*\\r?\\n?`, 'm'), '').replace(/\s*$/, '\n')
  writeFileSync(manifest.file, `${unsigned}${SIGNATURE_FIELD}: ${signature.toString('base64')}\n`)
  console.log(`Assinado: ${manifest.path} (v${manifest.version}).`)
}

function publish() {
  const manifest = readManifest()
  if (!new RegExp(`^${SIGNATURE_FIELD}: `, 'm').test(manifest.text)) fail('latest.yml não está assinado. Rode "sign" antes.')
  const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  if (pkgVersion !== manifest.version) fail(`package.json está em ${pkgVersion}, mas dist/ é da ${manifest.version}.`)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  if (git('status', '--porcelain')) fail('Há mudanças sem commit. A release precisa sair de um commit publicado.')
  if (git('rev-parse', 'HEAD') !== git('rev-parse', '@{u}')) fail('O commit atual ainda não foi enviado (git push).')

  const tag = `v${manifest.version}`
  const files = [manifest.path, `${manifest.path}.blockmap`, 'latest.yml'].map((f) => join(dist, f))
  for (const f of files) if (!existsSync(f)) fail(`${f} não existe.`)
  // Release normal (não rascunho nem pré-lançamento): é a que o app encontra em /releases/latest.
  execFileSync('gh', ['release', 'create', tag, ...files, '--target', git('rev-parse', 'HEAD'), '--title', `Aquarium ${tag}`, '--generate-notes'], {
    cwd: root,
    stdio: 'inherit'
  })
}

const commands = { keygen, sign: signManifest, publish }
const command = commands[process.argv[2]]
if (!command) fail('Uso: node scripts/release.mjs keygen | sign | publish')
command()
