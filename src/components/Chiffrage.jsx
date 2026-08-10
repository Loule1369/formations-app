import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { grouperVoyages } from '../lib/dates'

const TARIF_NUIT_HOTEL = 120
const TARIF_REPAS = 25

export default function Chiffrage() {
  const [demandes, setDemandes] = useState([])
  const [demandeId, setDemandeId] = useState('')
  const [scenarios, setScenarios] = useState([])
  const [scenarioId, setScenarioId] = useState('')
  const [lignes, setLignes] = useState([])

  const [message, setMessage] = useState('')
  const [succes, setSucces] = useState('')
  const [generation, setGeneration] = useState(false)

  useEffect(() => {
    supabase
      .from('demandes')
      .select('id, statut, clients(nom)')
      .order('created_at', { ascending: false })
      .then(({ data }) => setDemandes(data || []))
  }, [])

  async function chargerDemande(id) {
    setDemandeId(id)
    setScenarioId('')
    setMessage('')
    setSucces('')
    if (!id) {
      setScenarios([])
      setLignes([])
      return
    }
    const [scenariosRes, lignesRes] = await Promise.all([
      supabase.from('scenarios').select('id, nom, est_retenu').eq('demande_id', id).order('created_at'),
      supabase.from('devis_lignes').select('*').eq('demande_id', id).order('created_at'),
    ])
    const scenariosList = scenariosRes.data || []
    setScenarios(scenariosList)
    setLignes(lignesRes.data || [])
    const retenu = scenariosList.find((s) => s.est_retenu)
    setScenarioId(retenu ? retenu.id : scenariosList[0]?.id || '')
  }

  async function chargerLignes(id) {
    const { data } = await supabase.from('devis_lignes').select('*').eq('demande_id', id).order('created_at')
    setLignes(data || [])
  }

  async function genererDepuisPlanning() {
    if (!scenarioId) {
      setMessage('Choisissez un scénario de planning avant de générer le devis.')
      return
    }
    setGeneration(true)
    setMessage('')
    setSucces('')
    try {
      const { data: creneaux } = await supabase
        .from('creneaux')
        .select('type, date, formateur_id, demande_ligne_id, demande_lignes(formations_catalogue(nom, prix))')
        .eq('scenario_id', scenarioId)

      const formations = (creneaux || []).filter((c) => c.type === 'formation')
      const deplacements = (creneaux || []).filter((c) => c.type === 'deplacement')

      // Une ligne par formation demandée (regroupe les blocs matin/après-midi/plusieurs jours).
      const parLigne = {}
      for (const c of formations) {
        if (!c.demande_ligne_id) continue
        parLigne[c.demande_ligne_id] = c.demande_lignes?.formations_catalogue
      }
      const lignesFormations = Object.values(parLigne)
        .filter(Boolean)
        .map((f) => ({
          demande_id: demandeId,
          libelle: f.nom,
          quantite: 1,
          prix_unitaire: f.prix || 0,
          origine: 'planning',
        }))

      // Nuits d'hôtel et repas déduits des missions (regroupement par formateur, weekends = retour au domicile).
      const parFormateur = {}
      for (const c of deplacements) {
        if (!parFormateur[c.formateur_id]) parFormateur[c.formateur_id] = []
        parFormateur[c.formateur_id].push(c.date)
      }
      let totalNuits = 0
      for (const dates of Object.values(parFormateur)) {
        const tri = [...new Set(dates)].sort()
        for (const voyage of grouperVoyages(tri)) {
          const nuits = Math.round(
            (new Date(voyage.fin + 'T00:00:00').getTime() - new Date(voyage.debut + 'T00:00:00').getTime()) /
              (24 * 60 * 60 * 1000),
          )
          totalNuits += Math.max(nuits, 0)
        }
      }
      const joursFormation = new Set(formations.map((c) => `${c.formateur_id}|${c.date}`)).size

      const lignesFrais = []
      if (totalNuits > 0) {
        lignesFrais.push({
          demande_id: demandeId,
          libelle: "Nuits d'hôtel formateur",
          quantite: totalNuits,
          prix_unitaire: TARIF_NUIT_HOTEL,
          origine: 'planning',
        })
        lignesFrais.push({
          demande_id: demandeId,
          libelle: 'Repas soir (déplacement)',
          quantite: totalNuits,
          prix_unitaire: TARIF_REPAS,
          origine: 'planning',
        })
      }
      if (joursFormation > 0) {
        lignesFrais.push({
          demande_id: demandeId,
          libelle: 'Repas midi (jours de formation)',
          quantite: joursFormation,
          prix_unitaire: TARIF_REPAS,
          origine: 'planning',
        })
      }

      await supabase.from('devis_lignes').delete().eq('demande_id', demandeId).eq('origine', 'planning')
      const nouvellesLignes = [...lignesFormations, ...lignesFrais]
      if (nouvellesLignes.length > 0) {
        await supabase.from('devis_lignes').insert(nouvellesLignes)
      }
      await chargerLignes(demandeId)
      setSucces(
        `Devis généré : ${lignesFormations.length} formation(s), ${totalNuits} nuit(s) d'hôtel, ${joursFormation} jour(s) de repas midi. Vous pouvez tout ajuster ci-dessous.`,
      )
    } catch (err) {
      setMessage(err.message)
    } finally {
      setGeneration(false)
    }
  }

  async function ajouterLigneLibre() {
    const { data, error } = await supabase
      .from('devis_lignes')
      .insert({ demande_id: demandeId, libelle: 'Nouvelle ligne', quantite: 1, prix_unitaire: 0, origine: null })
      .select('*')
      .single()
    if (error) {
      setMessage(error.message)
      return
    }
    setLignes((prev) => [...prev, data])
  }

  function modifierLigneLocal(id, champ, valeur) {
    setLignes((prev) => prev.map((l) => (l.id === id ? { ...l, [champ]: valeur } : l)))
  }

  async function sauvegarderLigne(id) {
    const ligne = lignes.find((l) => l.id === id)
    if (!ligne) return
    await supabase
      .from('devis_lignes')
      .update({ libelle: ligne.libelle, quantite: Number(ligne.quantite) || 0, prix_unitaire: Number(ligne.prix_unitaire) || 0 })
      .eq('id', id)
  }

  async function supprimerLigne(id) {
    await supabase.from('devis_lignes').delete().eq('id', id)
    setLignes((prev) => prev.filter((l) => l.id !== id))
  }

  const total = lignes.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix_unitaire || 0), 0)

  return (
    <div className="page page-large">
      <h1>Chiffrage</h1>

      <label>
        Demande à chiffrer
        <select value={demandeId} onChange={(e) => chargerDemande(e.target.value)}>
          <option value="">— Choisir une demande —</option>
          {demandes.map((d) => (
            <option key={d.id} value={d.id}>
              {d.clients?.nom} ({d.statut})
            </option>
          ))}
        </select>
      </label>

      {demandeId && (
        <>
          <div className="barre-scenarios">
            <label>
              Scénario de planning à chiffrer
              <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                <option value="">— Choisir —</option>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom} {s.est_retenu ? '★ retenu' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={genererDepuisPlanning} disabled={generation}>
              {generation ? 'Génération…' : 'Générer / régénérer le devis depuis ce planning'}
            </button>
          </div>

          {message && <p className="message erreur">{message}</p>}
          {succes && <p className="message succes">{succes}</p>}

          <table className="table-devis">
            <thead>
              <tr>
                <th>Libellé</th>
                <th>Quantité</th>
                <th>Prix unitaire HT</th>
                <th>Total HT</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id}>
                  <td>
                    <input
                      type="text"
                      value={l.libelle}
                      onChange={(e) => modifierLigneLocal(l.id, 'libelle', e.target.value)}
                      onBlur={() => sauvegarderLigne(l.id)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      value={l.quantite}
                      onChange={(e) => modifierLigneLocal(l.id, 'quantite', e.target.value)}
                      onBlur={() => sauvegarderLigne(l.id)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.prix_unitaire}
                      onChange={(e) => modifierLigneLocal(l.id, 'prix_unitaire', e.target.value)}
                      onBlur={() => sauvegarderLigne(l.id)}
                    />
                  </td>
                  <td>{(Number(l.quantite || 0) * Number(l.prix_unitaire || 0)).toFixed(2)} €</td>
                  <td>
                    <button type="button" onClick={() => supprimerLigne(l.id)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button type="button" onClick={ajouterLigneLibre}>+ Ajouter une ligne libre</button>

          <h2>Total HT : {total.toFixed(2)} €</h2>
        </>
      )}
    </div>
  )
}
