import { useState } from 'react'
import { TransmitView } from './views/TransmitView'
import { WatchView } from './views/WatchView'

type Mode = 'inicio' | 'transmitir' | 'assistir'

export function App(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('inicio')

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Aquarium</span>
        {mode !== 'inicio' && (
          <button className="ghost" onClick={() => setMode('inicio')}>
            Sair e voltar ao início
          </button>
        )}
      </header>

      <main className="content">
        {mode === 'inicio' && (
          <div className="home">
            <h1>O que você quer fazer?</h1>
            <div className="home-choices">
              <button className="choice" onClick={() => setMode('transmitir')}>
                <strong>Transmitir minha tela</strong>
                <span>Escolha uma tela ou janela e convide quem vai assistir.</span>
              </button>
              <button className="choice" onClick={() => setMode('assistir')}>
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
