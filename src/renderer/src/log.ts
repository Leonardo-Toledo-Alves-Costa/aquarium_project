// Log da interface: vai para o console e para o arquivo de log do processo principal.
// Nunca registrar o código do grupo, a senha, chaves, SDP, conteúdo de sinais nem endereços IP.

import type { LogLevel } from '../../shared/ipc'

export interface Logger {
  info(message: string, details?: Record<string, unknown>): void
  warn(message: string, details?: Record<string, unknown>): void
  error(message: string, details?: Record<string, unknown>): void
}

/** Erros viram { name, message, stack }: o JSON de um Error sai vazio e ele não passa pelo IPC. */
export function errorInfo(err: unknown): unknown {
  if (err instanceof Error || err instanceof DOMException) {
    return { name: err.name, message: err.message, stack: err.stack?.split('\n').slice(0, 6).join('\n') }
  }
  return typeof err === 'object' ? String(err) : err
}

function send(level: LogLevel, scope: string, message: string, details?: Record<string, unknown>): void {
  if (level === 'error') console.error(`[${scope}]`, message, details ?? '')
  else if (level === 'warn') console.warn(`[${scope}]`, message, details ?? '')
  else console.log(`[${scope}]`, message, details ?? '')
  try {
    // Passa por JSON para que só dados simples cheguem ao IPC.
    window.aquarium.log(level, scope, message, details === undefined ? undefined : JSON.parse(JSON.stringify(details)))
  } catch {
    // Fora do Electron (ou detalhes impossíveis de serializar): fica só no console.
  }
}

export function logger(scope: string): Logger {
  return {
    info: (message, details) => send('info', scope, message, details),
    warn: (message, details) => send('warn', scope, message, details),
    error: (message, details) => send('error', scope, message, details)
  }
}

/** Erros que escapam de tudo, e a rede do sistema caindo e voltando. Chamar uma vez ao abrir. */
export function captureGlobalErrors(): void {
  const log = logger('janela')
  window.addEventListener('error', (event) => {
    log.error('erro não tratado', { error: errorInfo(event.error ?? event.message), at: `${event.filename}:${event.lineno}:${event.colno}` })
  })
  window.addEventListener('unhandledrejection', (event) => log.error('promise rejeitada sem tratamento', { error: errorInfo(event.reason) }))
  window.addEventListener('offline', () => log.warn('o sistema ficou sem rede'))
  window.addEventListener('online', () => log.info('o sistema voltou a ter rede'))
}
