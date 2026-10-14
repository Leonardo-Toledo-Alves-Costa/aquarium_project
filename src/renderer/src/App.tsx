import { useEffect, useState } from 'react'
import { GroupApp } from './ui/GroupApp'
import { Onboarding } from './ui/Onboarding'
import { TransmitView } from './views/TransmitView'
import { WatchView } from './views/WatchView'

type Manual = 'inicio' | 'transmitir' | 'assistir'

export function App(): React.JSX.Element {
  const [code, setCode] = useState<string | null | undefined>(undefined)
  const [manual, setManual] = useState<Manual | null>(null)

  useEffect(() => {
    window.aquarium.loadGroupCode().then(setCode)
  }, [])

  if (manual) return <ManualMode mode={manual} onMode={setManual} onExit={() => setManual(null)} />
  if (code === undefined) return <div className="splash" role="status">Abrindo…</div>
  if (code === null) return <Onboarding onDone={setCode} onManual={() => setManual('inicio')} />

  return (
    <GroupApp
      code={code}
      onManual={() => setManual('inicio')}
      onLeaveGroup={async () => {
        await window.aquarium.saveGroupCode(null)
        setCode(null)
      }}
    />
  )
}

/** O modo da v0.2: convite e resposta trocados por mensagem, sem servidor. */
function ManualMode({ mode, onMode, onExit }: { mode: Manual; onMode: (m: Manual) => void; onExit: () => void }): React.JSX.Element {
  return (
    <div className="manual">
      <header className="manual-bar">
        <span className="brand-name">Aquarium · conexão manual</span>
        <button className="btn ghost" onClick={() => (mode === 'inicio' ? onExit() : onMode('inicio'))}>
          {mode === 'inicio' ? 'Voltar às salas' : 'Voltar'}
        </button>
      </header>
      <main className="manual-content">
        {mode === 'inicio' && (
          <div className="home">
            <h1>Conexão manual</h1>
            <p className="muted">Para quando o servidor de salas estiver fora do ar: quem transmite manda um convite, quem assiste devolve uma resposta.</p>
            <div className="home-choices">
              <button className="choice" onClick={() => onMode('transmitir')}>
                <strong>Transmitir minha tela</strong>
                <span>Escolha uma tela ou janela e gere convites.</span>
              </button>
              <button className="choice" onClick={() => onMode('assistir')}>
                <strong>Assistir</strong>
                <span>Cole o convite que alguém te mandou.</span>
              </button>
            </div>
          </div>
        )}
        {mode === 'transmitir' && <TransmitView />}
        {mode === 'assistir' && <WatchView />}
      </main>
    </div>
  )
}
