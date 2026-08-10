import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useProjetActif } from '../lib/ProjetActifContext'

export default function SelecteurProjet() {
  const { demandeId, definirProjetActif } = useProjetActif()
  const [recents, setRecents] = useState([])

  async function charger() {
    const { data } = await supabase
      .from('demandes')
      .select('id, statut, clients(nom)')
      .order('created_at', { ascending: false })
      .limit(10)
    setRecents(data || [])
  }

  useEffect(() => {
    charger()
  }, [demandeId])

  function changer(id) {
    const d = recents.find((r) => r.id === id)
    definirProjetActif(id, d?.clients?.nom || '')
  }

  return (
    <label className="selecteur-projet">
      Projet actif
      <select value={demandeId} onChange={(e) => changer(e.target.value)}>
        <option value="">— Aucun —</option>
        {recents.map((d) => (
          <option key={d.id} value={d.id}>
            {d.clients?.nom} ({d.statut})
          </option>
        ))}
      </select>
    </label>
  )
}
