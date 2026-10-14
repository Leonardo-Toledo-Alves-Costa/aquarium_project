import { useState } from 'react'
import { generateGroupCode, GroupCodeError, normalizeGroupCode } from '../group/group-code'
import { updateSettings, useSettings } from '../settings'
import { copyText } from './hooks'
import { IconTank } from './icons'

type Step = 'nome' | 'criar' | 'entrar'

export function Onboarding({ onDone, onManual }: { onDone: (code: string) => void; onManual: () => void }): React.JSX.Element {
  const settings = useSettings()
  const [name, setName] = useState(settings.name)
  const [step, setStep] = useState<Step>('nome')
  const [newCode] = useState(generateGroupCode)
  const [typed, setTyped] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const nameOk = name.trim().length > 0 && name.trim().length <= 32

  const finish = async (code: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.aquarium.saveGroupCode(code)
      updateSettings({ name: name.trim() })
      onDone(code)
    } catch {
      setError('Não foi possível guardar o código do grupo neste computador.')
      setBusy(false)
    }
  }

  const join = (): void => {
    try {
      finish(normalizeGroupCode(typed))
    } catch (err) {
      setError(err instanceof GroupCodeError ? err.message : 'Código inválido.')
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="brand-row">
          <IconTank size={28} />
          <span className="brand-name">Aquarium</span>
        </div>

        {step === 'nome' && (
          <>
            <h1>Como o grupo te chama?</h1>
            <div className="field">
              <label htmlFor="ob-name">Seu nome</label>
              <input
                id="ob-name"
                value={name}
                maxLength={32}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Miguel"
              />
            </div>
            <div className="choice-row">
              <button className="btn primary" disabled={!nameOk} onClick={() => setStep('entrar')}>
                Entrar em um grupo
              </button>
              <button className="btn" disabled={!nameOk} onClick={() => setStep('criar')}>
                Criar um grupo novo
              </button>
            </div>
          </>
        )}

        {step === 'criar' && (
          <>
            <h1>Seu grupo novo</h1>
            <p className="muted">
              Este é o código do grupo. Mande para quem você quer no grupo: quem tiver o código entra. Guarde em lugar
              seguro; para tirar alguém do grupo, será preciso criar um código novo.
            </p>
            <div className="code-box">
              <code>{newCode}</code>
              <button
                className="btn"
                onClick={async () => {
                  if (await copyText(newCode)) setCopied(true)
                }}
              >
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <div className="choice-row">
              <button className="btn primary" disabled={busy} onClick={() => finish(newCode)}>
                Entrar no grupo
              </button>
              <button className="btn ghost" onClick={() => setStep('nome')}>
                Voltar
              </button>
            </div>
          </>
        )}

        {step === 'entrar' && (
          <>
            <h1>Código do grupo</h1>
            <div className="field">
              <label htmlFor="ob-code">Cole o código que te mandaram</label>
              <input
                id="ob-code"
                value={typed}
                autoFocus
                onChange={(e) => setTyped(e.target.value)}
                placeholder="AQG-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
                className="mono"
              />
            </div>
            <div className="choice-row">
              <button className="btn primary" disabled={!typed.trim() || busy} onClick={join}>
                Entrar
              </button>
              <button className="btn ghost" onClick={() => setStep('nome')}>
                Voltar
              </button>
            </div>
          </>
        )}

        {error && <p className="alert">{error}</p>}

        <button className="link" onClick={onManual}>
          Usar conexão manual por códigos (sem servidor)
        </button>
      </div>
    </div>
  )
}
