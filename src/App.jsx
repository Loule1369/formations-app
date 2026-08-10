import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import Login from './components/Login'
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
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: abonnement } = supabase.auth.onAuthStateChange((_event, nouvelleSession) => {
      setSession(nouvelleSession)
    })
    return () => abonnement.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <p className="page">Chargement…</p>
  if (!session) return <Login />

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
        <span className="nav-spacer" />
        <span className="nav-utilisateur">{session.user.email}</span>
        <button onClick={() => supabase.auth.signOut()}>Déconnexion</button>
      </nav>
      <PageActive />
    </>
  )
}

export default App
