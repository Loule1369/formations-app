import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [mode, setMode] = useState('connexion')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [message, setMessage] = useState('')
  const [succes, setSucces] = useState('')
  const [envoi, setEnvoi] = useState(false)

  async function valider(e) {
    e.preventDefault()
    setMessage('')
    setSucces('')
    setEnvoi(true)
    try {
      if (mode === 'connexion') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password: motDePasse })
        if (error) throw error
        setSucces('Compte créé. Si une confirmation par email est demandée, vérifiez votre boîte mail, sinon vous êtes déjà connecté.')
      }
    } catch (err) {
      setMessage(err.message)
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <div className="page">
      <h1>{mode === 'connexion' ? 'Connexion' : 'Créer un compte'}</h1>
      <form onSubmit={valider} className="form-besoin">
        <fieldset>
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Mot de passe
            <input
              type="password"
              required
              minLength={6}
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
            />
          </label>
        </fieldset>

        {message && <p className="message erreur">{message}</p>}
        {succes && <p className="message succes">{succes}</p>}

        <button type="submit" disabled={envoi}>
          {envoi ? 'Patientez…' : mode === 'connexion' ? 'Se connecter' : 'Créer le compte'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === 'connexion' ? 'creation' : 'connexion')}
        className="lien-mode"
      >
        {mode === 'connexion' ? "Pas encore de compte ? En créer un" : 'Déjà un compte ? Se connecter'}
      </button>
    </div>
  )
}
