import { useState } from 'react'
import ExpressionBesoin from './components/ExpressionBesoin'
import Planning from './components/Planning'
import Chiffrage from './components/Chiffrage'
import './App.css'

const PAGES = {
  besoin: ExpressionBesoin,
  planning: Planning,
  chiffrage: Chiffrage,
}

function App() {
  const [page, setPage] = useState('besoin')
  const PageActive = PAGES[page]

  return (
    <>
      <nav className="nav-principale">
        <button onClick={() => setPage('besoin')} disabled={page === 'besoin'}>
          Expression de besoin
        </button>
        <button onClick={() => setPage('planning')} disabled={page === 'planning'}>
          Planning
        </button>
        <button onClick={() => setPage('chiffrage')} disabled={page === 'chiffrage'}>
          Chiffrage
        </button>
      </nav>
      <PageActive />
    </>
  )
}

export default App
