import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { grouperVoyages } from '../lib/dates'
import { useProjetActif } from '../lib/ProjetActifContext'

// Prix de vente / prix de revient HT (source : "2026_Outil de chiffrage des offres de formation.xlsx", feuille "Autres tarifs").
const TARIF_NUIT_HOTEL_PV = 135
const TARIF_NUIT_HOTEL_PR = 120
const TARIF_REPAS_PV = 30
const TARIF_REPAS_PR = 25

function ligneVide() {
  return { demande_id: '', libelle: 'Nouvelle ligne', quantite: 1, prix_unitaire: 0, prix_revient: 0, origine: null }
}

export default function Chiffrage() {
  const { demandeId, clientNom } = useProjetActif()
  const [scenarios, setScenarios] = useState([])
  const [scenarioId, setScenarioId] = useState('')
  const [lignes, setLignes] = useState([])

  const [message, setMessage] = useState('')
  const [succes, setSucces] = useState('')
  const [generation, setGeneration] = useState(false)

  useEffect(() => {
    if (!demandeId) {
      setScenarios([])
      setLignes([])
      setScenarioId('')
      return
    }
    chargerDemande(demandeId)
  }, [demandeId])

  async function chargerDemande(id) {
    setMessage('')
    setSucces('')
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
        .select('type, date, formateur_id, demande_ligne_id, demande_lignes(groupe, formations_catalogue(nom, prix, prix_revient))')
        .eq('scenario_id', scenarioId)

      const formations = (creneaux || []).filter((c) => c.type === 'formation')
      const deplacements = (creneaux || []).filter((c) => c.type === 'deplacement')

      // Une ligne par formation demandée (regroupe les blocs matin/après-midi/plusieurs jours).
      const parLigne = {}
      for (const c of formations) {
        if (!c.demande_ligne_id) continue
        parLigne[c.demande_ligne_id] = c.demande_lignes
      }
      const lignesFormations = Object.values(parLigne)
        .filter(Boolean)
        .map((dl) => ({
          demande_id: demandeId,
          libelle: `${dl.formations_catalogue?.nom || 'Formation'}${dl.groupe ? ` (Groupe ${dl.groupe})` : ''}`,
          quantite: 1,
          prix_unitaire: dl.formations_catalogue?.prix || 0,
          prix_revient: dl.formations_catalogue?.prix_revient || 0,
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
          prix_unitaire: TARIF_NUIT_HOTEL_PV,
          prix_revient: TARIF_NUIT_HOTEL_PR,
          origine: 'planning',
        })
        lignesFrais.push({
          demande_id: demandeId,
          libelle: 'Repas soir (déplacement)',
          quantite: totalNuits,
          prix_unitaire: TARIF_REPAS_PV,
          prix_revient: TARIF_REPAS_PR,
          origine: 'planning',
        })
      }
      if (joursFormation > 0) {
        lignesFrais.push({
          demande_id: demandeId,
          libelle: 'Repas midi (jours de formation)',
          quantite: joursFormation,
          prix_unitaire: TARIF_REPAS_PV,
          prix_revient: TARIF_REPAS_PR,
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
      .insert({ ...ligneVide(), demande_id: demandeId })
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
      .update({
        libelle: ligne.libelle,
        quantite: Number(ligne.quantite) || 0,
        prix_unitaire: Number(ligne.prix_unitaire) || 0,
        prix_revient: Number(ligne.prix_revient) || 0,
      })
      .eq('id', id)
  }

  async function supprimerLigne(id) {
    await supabase.from('devis_lignes').delete().eq('id', id)
    setLignes((prev) => prev.filter((l) => l.id !== id))
  }

  const totalPV = lignes.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix_unitaire || 0), 0)
  const totalPR = lignes.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix_revient || 0), 0)
  const margeTotale = totalPV - totalPR
  const tauxMarge = totalPV > 0 ? (margeTotale / totalPV) * 100 : 0

  if (!demandeId) {
    return (
      <div className="page page-large">
        <h1>Chiffrage</h1>
        <p>Aucun projet actif. Créez ou reprenez une demande depuis « Expression de besoin ».</p>
      </div>
    )
  }

  return (
    <div className="page page-large">
      <h1>Chiffrage — {clientNom}</h1>

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
          {generation ? 'Génération…' : 'Générer / réinitialiser depuis ce planning'}
        </button>
      </div>
      <p className="astuce">
        Ce bouton (re)calcule uniquement les lignes automatiques (formations, nuits, repas) à partir
        du planning — pratique pour repartir d'un chiffrage théorique propre. Les lignes que vous
        ajoutez à la main (ex. licences Ascentline) ne sont jamais touchées.
      </p>

      {message && <p className="message erreur">{message}</p>}
      {succes && <p className="message succes">{succes}</p>}

      <div className="table-devis-scroll">
        <table className="table-devis">
          <thead>
            <tr>
              <th>Libellé</th>
              <th>Origine</th>
              <th>Qté</th>
              <th>PV unitaire HT</th>
              <th>PR unitaire HT</th>
              <th>Total PV HT</th>
              <th>Total PR HT</th>
              <th>Marge</th>
              <th>Taux marge</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => {
              const totalLignePV = Number(l.quantite || 0) * Number(l.prix_unitaire || 0)
              const totalLignePR = Number(l.quantite || 0) * Number(l.prix_revient || 0)
              const margeLigne = totalLignePV - totalLignePR
              const tauxLigne = totalLignePV > 0 ? (margeLigne / totalLignePV) * 100 : 0
              return (
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
                    <span className={`badge-origine ${l.origine === 'planning' ? 'auto' : 'manuel'}`}>
                      {l.origine === 'planning' ? 'Planning' : 'Manuel'}
                    </span>
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
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.prix_revient}
                      onChange={(e) => modifierLigneLocal(l.id, 'prix_revient', e.target.value)}
                      onBlur={() => sauvegarderLigne(l.id)}
                    />
                  </td>
                  <td>{totalLignePV.toFixed(2)} €</td>
                  <td>{totalLignePR.toFixed(2)} €</td>
                  <td>{margeLigne.toFixed(2)} €</td>
                  <td>{totalLignePV > 0 ? `${tauxLigne.toFixed(0)}%` : '—'}</td>
                  <td>
                    <button type="button" onClick={() => supprimerLigne(l.id)}>×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={ajouterLigneLibre}>+ Ajouter une ligne libre</button>

      <div className="recap-devis">
        <p>Total prix de vente HT : <strong>{totalPV.toFixed(2)} €</strong></p>
        <p>Total prix de revient HT : <strong>{totalPR.toFixed(2)} €</strong></p>
        <p>Marge : <strong>{margeTotale.toFixed(2)} €</strong> ({tauxMarge.toFixed(0)}%)</p>
      </div>
    </div>
  )
}
