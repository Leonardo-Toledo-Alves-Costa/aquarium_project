// Registro em arquivo para diagnosticar quedas de conexão nos PCs de quem usa o app.
// Um arquivo por dia em <userData>/logs; ficam só os mais recentes, cada um com tamanho limitado
// (passando do limite, o arquivo vira .1.log e o de hoje recomeça, para guardar o fim do dia).
// Cada linha: horário ISO, nível, área, mensagem e, se houver, detalhes em JSON.
// Nunca registrar o código do grupo, a senha, chaves, SDP ou o conteúdo dos sinais.

import { app, ipcMain, shell } from 'electron'
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import { IPC, LOG_LEVELS, type LogLevel } from '../shared/ipc'

const KEEP_FILES = 5
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_MESSAGE = 1000
const MAX_DETAILS = 4000
/** Linhas que a interface pode mandar por minuto; o excesso é descartado e contado. */
const RENDERER_PER_MINUTE = 300

let dir: string | null = null
let currentFile: string | null = null
let currentBytes = 0

export function logsDir(): string {
  dir ??= join(app.getPath('userData'), 'logs')
  return dir
}

function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Apaga os arquivos mais antigos, deixando os KEEP_FILES mais recentes. */
function prune(): void {
  const files = readdirSync(logsDir())
    .filter((f) => /^aquarium-\d{4}-\d{2}-\d{2}(\.1)?\.log$/.test(f))
    .sort()
    .reverse()
  for (const f of files.slice(KEEP_FILES)) rmSync(join(logsDir(), f), { force: true })
}

function fileForToday(): string {
  const file = join(logsDir(), `aquarium-${today()}.log`)
  if (file !== currentFile) {
    mkdirSync(logsDir(), { recursive: true })
    currentFile = file
    try {
      currentBytes = statSync(file).size
    } catch {
      currentBytes = 0
    }
    prune()
  }
  return file
}

/** Última barreira: endereços IP que escapem em mensagens de erro (ex.: linhas de SDP) viram <ip>. */
function scrub(text: string): string {
  return text
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b|::[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6}\b/gi, '<ip>')
    .replace(/\bAQG-[0-9A-Z-]{10,}/gi, '<código>')
    // Linhas de SDP citadas em mensagens de erro do WebRTC.
    .replace(/(ice-pwd|ice-ufrag|fingerprint):\S+(?: \S+)?/gi, '$1:<removido>')
}

function stringify(details: unknown): string {
  try {
    const json = JSON.stringify(details)
    if (json === undefined) return ''
    return json.length > MAX_DETAILS ? `${json.slice(0, MAX_DETAILS)}…` : json
  } catch {
    return '"(detalhes não serializáveis)"'
  }
}

function write(level: LogLevel, scope: string, message: string, details?: unknown, raw = false): void {
  const extra = details === undefined ? '' : stringify(details)
  let text = message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…` : message
  if (extra) text += ` ${extra}`
  if (!raw) text = scrub(text)
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${text.replace(/\r?\n/g, ' ⏎ ')}\n`
  try {
    const file = fileForToday()
    if (currentBytes + line.length > MAX_FILE_BYTES) {
      // Arquivo cheio: o antigo vira .1.log (trocando um .1 anterior) e o de hoje recomeça.
      renameSync(file, file.replace(/\.log$/, '.1.log'))
      currentBytes = 0
      appendFileSync(file, `${new Date().toISOString()} INFO  [log] continuação; o começo está no .1.log\n`)
    }
    appendFileSync(file, line)
    currentBytes += Buffer.byteLength(line)
  } catch {
    // Disco cheio ou sem permissão: o log nunca derruba o app.
  }
}

function toConsole(level: LogLevel, scope: string, message: string, details?: unknown): void {
  const args = details === undefined ? [`[${scope}]`, message] : [`[${scope}]`, message, details]
  if (level === 'error') console.error(...args)
  else if (level === 'warn') console.warn(...args)
  else console.log(...args)
}

/** Erros viram { name, message, stack } (o JSON de um Error sai vazio). */
export function errorDetails(err: unknown): unknown {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack?.split('\n').slice(0, 6).join('\n') }
  return err
}

export interface Logger {
  info(message: string, details?: unknown): void
  warn(message: string, details?: unknown): void
  error(message: string, details?: unknown): void
}

export function logger(scope: string): Logger {
  const at =
    (level: LogLevel) =>
    (message: string, details?: unknown): void => {
      toConsole(level, scope, message, details)
      write(level, scope, message, details)
    }
  return { info: at('info'), warn: at('warn'), error: at('error') }
}

const log = logger('main')

/** Começa o arquivo e passa a registrar erros do processo principal. Chamar antes de tudo. */
export function startLog(): void {
  write(
    'info',
    'main',
    `Aquarium ${app.getVersion()} iniciado`,
    {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      os: `${process.platform} ${release()} ${process.arch}`,
      packaged: app.isPackaged,
      fuso: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    true
  )

  // "Monitor" só observa: não muda o que o Electron faz com o erro.
  process.on('uncaughtExceptionMonitor', (err) => log.error('exceção não tratada', errorDetails(err)))
  process.on('unhandledRejection', (reason) => log.error('promise rejeitada sem tratamento', errorDetails(reason)))
  app.on('render-process-gone', (_event, _contents, details) => log.error('a interface caiu', details))
  app.on('child-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') log.warn('processo interno do Electron caiu', details)
  })
  app.on('before-quit', () => log.info('fechando o app'))
}

export function registerLog(): void {
  let windowStart = Date.now()
  let count = 0
  let dropped = 0

  ipcMain.on(IPC.log, (_event, level: unknown, scope: unknown, message: unknown, details: unknown) => {
    if (typeof level !== 'string' || !LOG_LEVELS.includes(level as LogLevel)) return
    if (typeof scope !== 'string' || typeof message !== 'string') return
    const now = Date.now()
    if (now - windowStart > 60_000) {
      if (dropped > 0) write('warn', 'log', `${dropped} linhas da interface descartadas (excesso)`)
      windowStart = now
      count = 0
      dropped = 0
    }
    if (++count > RENDERER_PER_MINUTE) {
      dropped++
      return
    }
    write(level as LogLevel, scope.slice(0, 32), message, details)
  })

  ipcMain.handle(IPC.openLogsFolder, async () => {
    mkdirSync(logsDir(), { recursive: true })
    const error = await shell.openPath(logsDir())
    if (error) log.warn('não foi possível abrir a pasta dos logs', { error })
  })
}
