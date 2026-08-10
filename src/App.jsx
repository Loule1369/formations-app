import { useState } from 'react'
import ExpressionBesoin from './components/ExpressionBesoin'
import Planning from './components/Planning'
import './App.css'

function App() {
  const [page, setPage] = useState('besoin')

  return (
    <>
      <nav className="nav-principale">
        <button onClick={() => setPage('besoin')} disabled={page === 'besoin'}>
          Expression de besoin
        </button>
        <button onClick={() => setPage('planning')} disabled={page === 'planning'}>
          Planning
        </button>
      </nav>
      {page === 'besoin' ? <ExpressionBesoin /> : <Planning />}
    </>
  )
}

export default App
