import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { grouperVoyages } from '../lib/dates'
import { useProjetActif } from '../lib/ProjetActifContext'

// Prix de vente / prix de revient HT (source : "2026_Outil de chiffrage des offres de formation.xlsx", feuille "Autres tarifs").
const TARIF_NUIT_HOTEL_PV = 135
const TARIF_NUIT_HOTEL_PR = 120
const TARIF_REPAS_PV = 30
const TARIF_REPAS_PR = 25

const CATEGORIES = ['formation', 'deplacement', 'administratif', 'ascentline', 'autre']
const CATEGORIE_LABELS = {
  formation: 'Formations',
  deplacement: 'Déplacement & hébergement',
  administratif: 'Administratif',
  ascentline: 'Licences Ascentline',
  autre: 'Autres',
}

function ligneVide() {
  return { libelle: 'Nouvelle ligne', quantite: 1, prix_unitaire: 0, prix_revient: 0, origine: null, categorie: 'autre' }
}

export default function Chiffrage() {
  const { demandeId, clientNom } = useProjetActif()
  const [scenarios, setScenarios] = useState([])
  const [scenarioId, setScenarioId] = useState('')
  const [lignes, setLignes] = useState([])
  const [formateurs, setFormateurs] = useState([])

  const [message, setMessage] = useState('')
  const [succes, setSucces] = useState('')
  const [generation, setGeneration] = useState(false)

  useEffect(() => {
    supabase
      .from('formateurs')
      .select('id, nom, service')
      .then(({ data }) => data && setFormateurs(data))
  }, [])

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

  function serviceDuFormateur(formateurId) {
    return formateurs.find((f) => f.id === formateurId)?.service || 'Autre service'
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
          categorie: 'formation',
        }))

      // Nuits d'hôtel et repas déduits des missions, ventilés par service du formateur (FORDOC, SAV, DIH...).
      const parFormateur = {}
      for (const c of deplacements) {
        if (!parFormateur[c.formateur_id]) parFormateur[c.formateur_id] = []
        parFormateur[c.formateur_id].push(c.date)
      }
      const nuitsParService = {}
      for (const [formateurId, dates] of Object.entries(parFormateur)) {
        const service = serviceDuFormateur(formateurId)
        const tri = [...new Set(dates)].sort()
        for (const voyage of grouperVoyages(tri)) {
          const nuits = Math.round(
            (new Date(voyage.fin + 'T00:00:00').getTime() - new Date(voyage.debut + 'T00:00:00').getTime()) /
              (24 * 60 * 60 * 1000),
          )
          nuitsParService[service] = (nuitsParService[service] || 0) + Math.max(nuits, 0)
        }
      }

      const joursParService = {}
      for (const c of formations) {
        const service = serviceDuFormateur(c.formateur_id)
        const cle = `${service}|${c.formateur_id}|${c.date}`
        joursParService[service] = joursParService[service] || new Set()
        joursParService[service].add(cle)
      }

      const lignesFrais = []
      for (const [service, nuits] of Object.entries(nuitsParService)) {
        if (nuits <= 0) continue
        lignesFrais.push({
          demande_id: demandeId,
          libelle: `Nuits d'hôtel — ${service}`,
          quantite: nuits,
          prix_unitaire: TARIF_NUIT_HOTEL_PV,
          prix_revient: TARIF_NUIT_HOTEL_PR,
          origine: 'planning',
          categorie: 'deplacement',
        })
        lignesFrais.push({
          demande_id: demandeId,
          libelle: `Repas soir — ${service}`,
          quantite: nuits,
          prix_unitaire: TARIF_REPAS_PV,
          prix_revient: TARIF_REPAS_PR,
          origine: 'planning',
          categorie: 'deplacement',
        })
      }
      for (const [service, joursSet] of Object.entries(joursParService)) {
        if (joursSet.size === 0) continue
        lignesFrais.push({
          demande_id: demandeId,
          libelle: `Repas midi — ${service}`,
          quantite: joursSet.size,
          prix_unitaire: TARIF_REPAS_PV,
          prix_revient: TARIF_REPAS_PR,
          origine: 'planning',
          categorie: 'deplacement',
        })
      }

      await supabase.from('devis_lignes').delete().eq('demande_id', demandeId).eq('origine', 'planning')
      const nouvellesLignes = [...lignesFormations, ...lignesFrais]
      if (nouvellesLignes.length > 0) {
        await supabase.from('devis_lignes').insert(nouvellesLignes)
      }
      await chargerLignes(demandeId)
      setSucces(
        `Devis généré : ${lignesFormations.length} formation(s), frais de déplacement ventilés par service. Vous pouvez tout ajuster ci-dessous.`,
      )
    } catch (err) {
      setMessage(err.message)
    } finally {
      setGeneration(false)
    }
  }

  async function ajouterLigneLibre(categorie) {
    const { data, error } = await supabase
      .from('devis_lignes')
      .insert({ ...ligneVide(), demande_id: demandeId, categorie })
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
        categorie: ligne.categorie,
      })
      .eq('id', id)
  }

  async function supprimerLigne(id) {
    await supabase.from('devis_lignes').delete().eq('id', id)
    setLignes((prev) => prev.filter((l) => l.id !== id))
  }

  function totaux(liste) {
    const pv = liste.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix_unitaire || 0), 0)
    const pr = liste.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix_revient || 0), 0)
    return { pv, pr, marge: pv - pr, taux: pv > 0 ? ((pv - pr) / pv) * 100 : 0 }
  }

  const totalGeneral = totaux(lignes)

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
        Ce bouton (re)calcule uniquement les lignes automatiques (formations, nuits, repas — ventilées
        par service de formateur) à partir du planning. Les lignes ajoutées à la main (administratif,
        licences Ascentline...) ne sont jamais touchées.
      </p>

      {message && <p className="message erreur">{message}</p>}
      {succes && <p className="message succes">{succes}</p>}

      {CATEGORIES.map((cat) => {
        const lignesCat = lignes.filter((l) => l.categorie === cat)
        const t = totaux(lignesCat)
        return (
          <section key={cat} className="section-devis">
            <h2>{CATEGORIE_LABELS[cat]}</h2>
            {lignesCat.length === 0 ? (
              <p className="astuce">Aucune ligne.</p>
            ) : (
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
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignesCat.map((l) => {
                      const totalLignePV = Number(l.quantite || 0) * Number(l.prix_unitaire || 0)
                      const totalLignePR = Number(l.quantite || 0) * Number(l.prix_revient || 0)
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
                          <td>{(totalLignePV - totalLignePR).toFixed(2)} €</td>
                          <td>
                            <button type="button" onClick={() => supprimerLigne(l.id)}>×</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>
                        <strong>Sous-total {CATEGORIE_LABELS[cat]}</strong>
                      </td>
                      <td><strong>{t.pv.toFixed(2)} €</strong></td>
                      <td><strong>{t.pr.toFixed(2)} €</strong></td>
                      <td><strong>{t.marge.toFixed(2)} € ({t.taux.toFixed(0)}%)</strong></td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <button type="button" onClick={() => ajouterLigneLibre(cat)}>
              + Ajouter une ligne « {CATEGORIE_LABELS[cat]} »
            </button>
          </section>
        )
      })}

      <div className="recap-devis">
        <h2>Récapitulatif</h2>
        {CATEGORIES.map((cat) => {
          const t = totaux(lignes.filter((l) => l.categorie === cat))
          if (t.pv === 0 && t.pr === 0) return null
          return (
            <p key={cat}>
              {CATEGORIE_LABELS[cat]} : <strong>{t.pv.toFixed(2)} €</strong> (marge {t.marge.toFixed(2)} €)
            </p>
          )
        })}
        <hr />
        <p>Total prix de vente HT : <strong>{totalGeneral.pv.toFixed(2)} €</strong></p>
        <p>Total prix de revient HT : <strong>{totalGeneral.pr.toFixed(2)} €</strong></p>
        <p>Marge : <strong>{totalGeneral.marge.toFixed(2)} €</strong> ({totalGeneral.taux.toFixed(0)}%)</p>
      </div>
    </div>
  )
}
