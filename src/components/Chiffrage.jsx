import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { grouperVoyages, dureeHeures } from '../lib/dates'
import { useProjetActif } from '../lib/ProjetActifContext'

// Tarifs de référence (source : "2026_Outil de chiffrage des offres de formation.xlsx", feuille "Autres tarifs" / "ACTIF").
const TARIF_NUIT_HOTEL_PV = 135
const TARIF_NUIT_HOTEL_PR = 120
const TARIF_REPAS_PV = 30
const TARIF_REPAS_PR = 25
const TARIF_HORAIRE_PV = 150
const TARIF_HORAIRE_PR_PAR_SERVICE = { FORDOC: 79.68, SAV: 84.52, DIH: 68.65, INSTALL: 81.01 }
const TARIF_HORAIRE_PR_DEFAUT = 79.68
const JOUR_H = 7 // longueur conventionnelle d'une journée pour convertir des heures en "jours"
const TARIF_JOUR_ANIMATION_PV = 1200
const TARIF_JOUR_PREP_PV = 920
const TARIF_JOUR_PV_PR = 637.44 // même coût de revient journalier, que ce soit animation ou préparation

const STATUT_LABELS = {
  besoin_exprime: 'Besoin exprimé',
  devis_envoye: 'Devis envoyé',
  valide: 'Validé',
  saisi_queoval: 'Saisi QUEOVAL',
  termine: 'Terminé',
}

const CATEGORIES = ['formation', 'administratif', 'elearning', 'ascentline', 'deplacement', 'autre']
const CATEGORIE_LABELS = {
  formation: 'Formations',
  administratif: 'Administratif',
  elearning: 'Modules e-learning',
  ascentline: 'Licences Ascentline',
  deplacement: 'Déplacement & hébergement',
  autre: 'Frais divers',
}

function arrondi2(n) {
  return Math.round(n * 100) / 100
}

function margeTaux(pv, pr) {
  return pv > 0 ? ((pv - pr) / pv) * 100 : 0
}

function ligneVide(categorie) {
  if (categorie === 'formation') {
    return {
      libelle: 'Nouvelle formation',
      quantite: 1,
      prix_unitaire: 0,
      prix_revient: 0,
      origine: null,
      categorie,
      jours_preparation: 0,
      nb_groupes: 1,
      jours_animation_unitaire: 0,
      commentaires: '',
    }
  }
  return { libelle: 'Nouvelle ligne', quantite: 1, prix_unitaire: 0, prix_revient: 0, origine: null, categorie }
}

// FORDOC (sous-traitant) toujours en tête des frais de déplacement, les services internes ensuite.
function comparerLignesDeplacement(a, b) {
  const aFordoc = a.libelle.includes('FORDOC') ? 0 : 1
  const bFordoc = b.libelle.includes('FORDOC') ? 0 : 1
  if (aFordoc !== bFordoc) return aFordoc - bFordoc
  return a.libelle.localeCompare(b.libelle)
}

export default function Chiffrage() {
  const { demandeId, clientNom } = useProjetActif()
  const [scenarios, setScenarios] = useState([])
  const [scenarioId, setScenarioId] = useState('')
  const [lignes, setLignes] = useState([])
  const [formateurs, setFormateurs] = useState([])
  const [resume, setResume] = useState(null)

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

  useEffect(() => {
    if (!scenarioId) {
      setResume(null)
      return
    }
    chargerResume(scenarioId)
  }, [scenarioId])

  // Dès qu'un scénario est sélectionné et qu'aucune ligne n'existe encore, on génère le devis
  // théorique automatiquement — pas besoin de cliquer le bouton à chaque ouverture.
  useEffect(() => {
    if (!scenarioId || lignes.length > 0) return
    if (formateurs.length === 0) return
    genererDepuisPlanning()
  }, [scenarioId, lignes.length, formateurs.length])

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

  async function chargerResume(scenarioIdCible) {
    const [demandeRes, creneauxRes] = await Promise.all([
      supabase
        .from('demandes')
        .select('statut, date_creation, notes, remise_pv, remise_pr, arrondi_pv, arrondi_pr')
        .eq('id', demandeId)
        .single(),
      supabase.from('creneaux').select('date, formateur_id').eq('scenario_id', scenarioIdCible).eq('type', 'formation'),
    ])
    const dates = (creneauxRes.data || []).map((c) => c.date).sort()
    const formateurIds = [...new Set((creneauxRes.data || []).map((c) => c.formateur_id))]
    setResume({
      statut: demandeRes.data?.statut,
      dateCreation: demandeRes.data?.date_creation,
      notes: demandeRes.data?.notes,
      remisePv: demandeRes.data?.remise_pv || 0,
      remisePr: demandeRes.data?.remise_pr || 0,
      arrondiPv: demandeRes.data?.arrondi_pv || 0,
      arrondiPr: demandeRes.data?.arrondi_pr || 0,
      formateurNoms: formateurIds.map((id) => formateurs.find((f) => f.id === id)?.nom || id),
      dateDebut: dates[0],
      dateFin: dates[dates.length - 1],
    })
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
        .select(
          'type, date, heure_debut, heure_fin, formateur_id, demande_ligne_id, demande_lignes(formation_id, groupe, formations_catalogue(nom, duree_h, duree_prep_h))',
        )
        .eq('scenario_id', scenarioId)

      const formations = (creneaux || []).filter((c) => c.type === 'formation')
      const deplacements = (creneaux || []).filter((c) => c.type === 'deplacement')

      // Une ligne par groupe planifié (déduplique matin/après-midi/plusieurs jours d'un même groupe).
      const parLigne = {}
      for (const c of formations) {
        if (!c.demande_ligne_id) continue
        parLigne[c.demande_ligne_id] = c.demande_lignes
      }
      // Regroupe par formation (et non par groupe) : une seule ligne récapitulative dont le nombre de
      // groupes, les jours de préparation et les jours d'animation (déjà multipliés par le nb de groupes)
      // reproduisent la structure du fichier Excel de référence.
      const parFormationId = {}
      for (const dl of Object.values(parLigne)) {
        if (!dl?.formation_id) continue
        if (!parFormationId[dl.formation_id]) parFormationId[dl.formation_id] = { catalogue: dl.formations_catalogue, nbGroupes: 0 }
        parFormationId[dl.formation_id].nbGroupes += 1
      }
      const lignesFormations = []
      for (const { catalogue: cat, nbGroupes } of Object.values(parFormationId)) {
        if (!cat) continue
        const joursPrep = arrondi2((cat.duree_prep_h || 0) / JOUR_H)
        const joursAnimTotal = arrondi2(((cat.duree_h || 0) / JOUR_H) * nbGroupes)
        const joursTotal = arrondi2(joursPrep + joursAnimTotal)
        lignesFormations.push({
          demande_id: demandeId,
          libelle: cat.nom,
          quantite: 1,
          jours_preparation: joursPrep,
          nb_groupes: nbGroupes,
          jours_animation_unitaire: joursAnimTotal,
          prix_unitaire: arrondi2(joursPrep * TARIF_JOUR_PREP_PV + joursAnimTotal * TARIF_JOUR_ANIMATION_PV),
          prix_revient: arrondi2(joursTotal * TARIF_JOUR_PV_PR),
          origine: 'planning',
          categorie: 'formation',
        })
      }

      // Nuits d'hôtel et repas déduits des JOURS DE FORMATION réels (pas des dates des blocs
      // "Déplacement", qui ne sont que les 2 bornes arrivée/départ et cassent le calcul sur
      // plusieurs semaines) — même logique de regroupement en missions que dans le Planning.
      const joursParFormateur = {}
      for (const c of formations) {
        if (!joursParFormateur[c.formateur_id]) joursParFormateur[c.formateur_id] = new Set()
        joursParFormateur[c.formateur_id].add(c.date)
      }

      const nuitsParService = {}
      const joursParService = {}
      for (const [formateurId, joursSet] of Object.entries(joursParFormateur)) {
        const service = serviceDuFormateur(formateurId)
        const tri = [...joursSet].sort()
        joursParService[service] = (joursParService[service] || 0) + tri.length
        for (const voyage of grouperVoyages(tri)) {
          const nuits = Math.round(
            (new Date(voyage.fin + 'T00:00:00').getTime() - new Date(voyage.debut + 'T00:00:00').getTime()) /
              (24 * 60 * 60 * 1000),
          )
          nuitsParService[service] = (nuitsParService[service] || 0) + Math.max(nuits, 0)
        }
      }

      const lignesFrais = []
      const tousServices = new Set([...Object.keys(nuitsParService), ...Object.keys(joursParService)])
      for (const service of tousServices) {
        const nuits = nuitsParService[service] || 0
        const jours = joursParService[service] || 0
        if (nuits > 0) {
          lignesFrais.push({
            demande_id: demandeId,
            libelle: `Nuits d'hôtel — ${service}`,
            quantite: nuits,
            prix_unitaire: TARIF_NUIT_HOTEL_PV,
            prix_revient: TARIF_NUIT_HOTEL_PR,
            origine: 'planning',
            categorie: 'deplacement',
          })
        }
        const totalRepas = nuits + jours
        if (totalRepas > 0) {
          lignesFrais.push({
            demande_id: demandeId,
            libelle: `Repas — ${service}`,
            quantite: totalRepas,
            prix_unitaire: TARIF_REPAS_PV,
            prix_revient: TARIF_REPAS_PR,
            origine: 'planning',
            categorie: 'deplacement',
          })
        }
      }

      // Heures de déplacement facturées : durée réelle des blocs "Déplacement" (ajustables à la main
      // dans le Planning pour refléter le vrai temps de trajet), ventilées par service du formateur.
      const heuresDeplacementParService = {}
      for (const c of deplacements) {
        const service = serviceDuFormateur(c.formateur_id)
        heuresDeplacementParService[service] = (heuresDeplacementParService[service] || 0) + dureeHeures(c.heure_debut, c.heure_fin)
      }
      for (const [service, heures] of Object.entries(heuresDeplacementParService)) {
        if (heures <= 0) continue
        lignesFrais.push({
          demande_id: demandeId,
          libelle: `Heures de déplacement — ${service}`,
          quantite: Math.round(heures * 2) / 2,
          prix_unitaire: TARIF_HORAIRE_PV,
          prix_revient: TARIF_HORAIRE_PR_PAR_SERVICE[service] || TARIF_HORAIRE_PR_DEFAUT,
          origine: 'planning',
          categorie: 'deplacement',
        })
      }

      await supabase.from('devis_lignes').delete().eq('demande_id', demandeId).eq('origine', 'planning')
      const nouvellesLignes = [...lignesFormations, ...lignesFrais]
      if (nouvellesLignes.length > 0) {
        await supabase.from('devis_lignes').insert(nouvellesLignes)
      }

      // Ligne "Administratif" par défaut (0.5 jour) : ajoutée une seule fois, jamais recalculée
      // ensuite — au chef de projet de l'ajuster selon le temps administratif réellement nécessaire.
      if (!lignes.some((l) => l.categorie === 'administratif')) {
        await supabase.from('devis_lignes').insert({
          demande_id: demandeId,
          libelle: 'Préparation / administratif / transport',
          quantite: 0.5,
          prix_unitaire: TARIF_JOUR_PREP_PV,
          prix_revient: TARIF_JOUR_PV_PR,
          origine: null,
          categorie: 'administratif',
        })
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
      .insert({ ...ligneVide(categorie), demande_id: demandeId })
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

  async function persisterLigne(ligne) {
    await supabase
      .from('devis_lignes')
      .update({
        libelle: ligne.libelle,
        quantite: Number(ligne.quantite) || 0,
        prix_unitaire: Number(ligne.prix_unitaire) || 0,
        prix_revient: Number(ligne.prix_revient) || 0,
        categorie: ligne.categorie,
        jours_preparation: ligne.jours_preparation === '' || ligne.jours_preparation == null ? null : Number(ligne.jours_preparation),
        nb_groupes: ligne.nb_groupes === '' || ligne.nb_groupes == null ? null : Number(ligne.nb_groupes),
        jours_animation_unitaire:
          ligne.jours_animation_unitaire === '' || ligne.jours_animation_unitaire == null
            ? null
            : Number(ligne.jours_animation_unitaire),
        commentaires: ligne.commentaires || null,
      })
      .eq('id', ligne.id)
  }

  async function sauvegarderLigne(id) {
    const ligne = lignes.find((l) => l.id === id)
    if (!ligne) return
    await persisterLigne(ligne)
  }

  // Pour les lignes "Formations" : jours de préparation et jours d'animation pilotent directement le
  // PV et le PR (comme des formules dans le fichier Excel de référence) — recalculés à chaque saisie.
  function sauvegarderChampFormation(id) {
    setLignes((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l
        const joursPrep = Number(l.jours_preparation) || 0
        const joursAnim = Number(l.jours_animation_unitaire) || 0
        const joursTotal = joursPrep + joursAnim
        const ligneMaj = {
          ...l,
          prix_unitaire: arrondi2(joursPrep * TARIF_JOUR_PREP_PV + joursAnim * TARIF_JOUR_ANIMATION_PV),
          prix_revient: arrondi2(joursTotal * TARIF_JOUR_PV_PR),
        }
        persisterLigne(ligneMaj)
        return ligneMaj
      }),
    )
  }

  async function supprimerLigne(id) {
    await supabase.from('devis_lignes').delete().eq('id', id)
    setLignes((prev) => prev.filter((l) => l.id !== id))
  }

  function modifierResumeLocal(champ, valeur) {
    setResume((prev) => ({ ...prev, [champ]: valeur }))
  }

  async function sauvegarderRemiseArrondi() {
    await supabase
      .from('demandes')
      .update({
        remise_pv: Number(resume?.remisePv) || 0,
        remise_pr: Number(resume?.remisePr) || 0,
        arrondi_pv: Number(resume?.arrondiPv) || 0,
        arrondi_pr: Number(resume?.arrondiPr) || 0,
      })
      .eq('id', demandeId)
  }

  function totaux(liste) {
    const pv = liste.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix_unitaire || 0), 0)
    const pr = liste.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix_revient || 0), 0)
    return { pv, pr, marge: pv - pr, taux: margeTaux(pv, pr) }
  }

  if (!demandeId) {
    return (
      <div className="page page-large">
        <h1>Chiffrage</h1>
        <p>Aucun projet actif. Créez ou reprenez une demande depuis « Expression de besoin ».</p>
      </div>
    )
  }

  // Récapitulatif financier — reproduit exactement la structure du fichier Excel de référence :
  // formation animation / préparation séparées, puis les autres catégories, sous-total, remise, total, arrondi.
  const lignesFormationsCat = lignes.filter((l) => l.categorie === 'formation')
  let animPv = 0
  let animPr = 0
  let prepPv = 0
  let prepPr = 0
  for (const l of lignesFormationsCat) {
    const joursPrep = Number(l.jours_preparation) || 0
    const joursAnim = Number(l.jours_animation_unitaire) || 0
    animPv += joursAnim * TARIF_JOUR_ANIMATION_PV
    animPr += joursAnim * TARIF_JOUR_PV_PR
    prepPv += joursPrep * TARIF_JOUR_PREP_PV
    prepPr += joursPrep * TARIF_JOUR_PV_PR
  }
  const tAdmin = totaux(lignes.filter((l) => l.categorie === 'administratif'))
  const tElearning = totaux(lignes.filter((l) => l.categorie === 'elearning'))
  const tAscentline = totaux(lignes.filter((l) => l.categorie === 'ascentline'))
  const tDeplacement = totaux(lignes.filter((l) => l.categorie === 'deplacement'))
  const tAutre = totaux(lignes.filter((l) => l.categorie === 'autre'))

  const lignesRecap = [
    { libelle: 'FORMATION (animation)', pv: animPv, pr: animPr },
    { libelle: 'FORMATION (préparation & évaluation)', pv: prepPv, pr: prepPr },
    { libelle: 'ADMINISTRATIF', pv: tAdmin.pv, pr: tAdmin.pr },
    { libelle: 'MODULES E-LEARNING', pv: tElearning.pv, pr: tElearning.pr },
    { libelle: 'LICENCES ASCENTLINE', pv: tAscentline.pv, pr: tAscentline.pr },
    { libelle: 'FRAIS DE DEPLACEMENTS', pv: tDeplacement.pv, pr: tDeplacement.pr },
    { libelle: 'FRAIS DIVERS', pv: tAutre.pv, pr: tAutre.pr },
  ]
  const sousTotalPv = lignesRecap.reduce((s, l) => s + l.pv, 0)
  const sousTotalPr = lignesRecap.reduce((s, l) => s + l.pr, 0)
  const remisePv = Number(resume?.remisePv) || 0
  const remisePr = Number(resume?.remisePr) || 0
  const totalPv = sousTotalPv - remisePv
  const totalPr = sousTotalPr - remisePr

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
        Ce bouton (re)calcule uniquement les lignes automatiques (formations, nuits, repas, heures de
        déplacement) à partir du planning. Les lignes ajoutées à la main (administratif, e-learning,
        licences Ascentline...) ne sont jamais touchées.
      </p>

      {message && <p className="message erreur">{message}</p>}
      {succes && <p className="message succes">{succes}</p>}

      {CATEGORIES.map((cat) => {
        const lignesCat = lignes.filter((l) => l.categorie === cat)
        if (cat === 'deplacement') lignesCat.sort(comparerLignesDeplacement)
        const t = totaux(lignesCat)

        if (cat === 'formation') {
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
                        <th>Formation</th>
                        <th>Jours prépa</th>
                        <th>Nb groupes</th>
                        <th>Jours animation</th>
                        <th>Jours total</th>
                        <th>PV HT</th>
                        <th>PR HT</th>
                        <th>Marge</th>
                        <th>Commentaires</th>
                        <th>Origine</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignesCat.map((l) => {
                        const joursPrep = Number(l.jours_preparation) || 0
                        const joursAnim = Number(l.jours_animation_unitaire) || 0
                        const joursTotal = arrondi2(joursPrep + joursAnim)
                        const pv = Number(l.prix_unitaire) || 0
                        const pr = Number(l.prix_revient) || 0
                        return (
                          <tr key={l.id}>
                            <td>
                              <input
                                type="text"
                                className="input-libelle"
                                value={l.libelle}
                                onChange={(e) => modifierLigneLocal(l.id, 'libelle', e.target.value)}
                                onBlur={() => sauvegarderLigne(l.id)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={l.jours_preparation ?? 0}
                                onChange={(e) => modifierLigneLocal(l.id, 'jours_preparation', e.target.value)}
                                onBlur={() => sauvegarderChampFormation(l.id)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="1"
                                value={l.nb_groupes ?? 1}
                                onChange={(e) => modifierLigneLocal(l.id, 'nb_groupes', e.target.value)}
                                onBlur={() => sauvegarderLigne(l.id)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={l.jours_animation_unitaire ?? 0}
                                onChange={(e) => modifierLigneLocal(l.id, 'jours_animation_unitaire', e.target.value)}
                                onBlur={() => sauvegarderChampFormation(l.id)}
                              />
                            </td>
                            <td>{joursTotal.toFixed(1)}</td>
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
                            <td>{(pv - pr).toFixed(2)} €</td>
                            <td>
                              <input
                                type="text"
                                className="input-commentaires"
                                value={l.commentaires || ''}
                                onChange={(e) => modifierLigneLocal(l.id, 'commentaires', e.target.value)}
                                onBlur={() => sauvegarderLigne(l.id)}
                              />
                            </td>
                            <td>
                              <span className={`badge-origine ${l.origine === 'planning' ? 'auto' : 'manuel'}`}>
                                {l.origine === 'planning' ? 'Planning' : 'Manuel'}
                              </span>
                            </td>
                            <td>
                              <button type="button" onClick={() => supprimerLigne(l.id)}>×</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Sous-total {CATEGORIE_LABELS[cat]}</strong></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td><strong>{t.pv.toFixed(2)} €</strong></td>
                        <td><strong>{t.pr.toFixed(2)} €</strong></td>
                        <td><strong>{t.marge.toFixed(2)} € ({t.taux.toFixed(0)}%)</strong></td>
                        <td></td>
                        <td></td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <button type="button" onClick={() => ajouterLigneLibre(cat)}>
                + Ajouter une formation
              </button>
            </section>
          )
        }

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
                      <th>Qté</th>
                      <th>PV unitaire HT</th>
                      <th>PR unitaire HT</th>
                      <th>Total PV HT</th>
                      <th>Total PR HT</th>
                      <th>Marge</th>
                      <th>Origine</th>
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
                              className="input-libelle"
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
                            <span className={`badge-origine ${l.origine === 'planning' ? 'auto' : 'manuel'}`}>
                              {l.origine === 'planning' ? 'Planning' : 'Manuel'}
                            </span>
                          </td>
                          <td>
                            <button type="button" onClick={() => supprimerLigne(l.id)}>×</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td><strong>Sous-total {CATEGORIE_LABELS[cat]}</strong></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td><strong>{t.pv.toFixed(2)} €</strong></td>
                      <td><strong>{t.pr.toFixed(2)} €</strong></td>
                      <td><strong>{t.marge.toFixed(2)} € ({t.taux.toFixed(0)}%)</strong></td>
                      <td></td>
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

      <section className="section-devis">
        <h2>Récapitulatif du projet</h2>
        <p className="astuce">
          Prêt à transmettre à l'administration des ventes et à reprendre dans l'outil de gestion de projet.
        </p>

        <div className="table-devis-scroll">
          <table className="table-devis table-recap-info">
            <tbody>
              <tr><th>Client</th><td>{clientNom}</td></tr>
              {resume && (
                <>
                  <tr><th>Statut de la demande</th><td>{STATUT_LABELS[resume.statut] || resume.statut}</td></tr>
                  <tr><th>Demande créée le</th><td>{resume.dateCreation}</td></tr>
                  {resume.notes && <tr><th>Notes</th><td>{resume.notes}</td></tr>}
                  {resume.dateDebut && (
                    <tr><th>Période de formation</th><td>du {resume.dateDebut} au {resume.dateFin}</td></tr>
                  )}
                  <tr>
                    <th>Formateur(s)</th>
                    <td>{resume.formateurNoms.length > 0 ? resume.formateurNoms.join(', ') : '—'}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-devis-scroll">
          <table className="table-devis table-recap-financier">
            <thead>
              <tr>
                <th>Libellé</th>
                <th>PV HT</th>
                <th>PR HT</th>
                <th>Marge</th>
              </tr>
            </thead>
            <tbody>
              {lignesRecap.map((l) => (
                <tr key={l.libelle}>
                  <td>{l.libelle}</td>
                  <td>{l.pv.toFixed(2)} €</td>
                  <td>{l.pr.toFixed(2)} €</td>
                  <td>{margeTaux(l.pv, l.pr).toFixed(0)}%</td>
                </tr>
              ))}
              <tr className="ligne-forte">
                <td><strong>SOUS-TOTAL</strong></td>
                <td><strong>{sousTotalPv.toFixed(2)} €</strong></td>
                <td><strong>{sousTotalPr.toFixed(2)} €</strong></td>
                <td><strong>{margeTaux(sousTotalPv, sousTotalPr).toFixed(0)}%</strong></td>
              </tr>
              <tr>
                <td>REMISE</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={resume?.remisePv ?? 0}
                    onChange={(e) => modifierResumeLocal('remisePv', e.target.value)}
                    onBlur={sauvegarderRemiseArrondi}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={resume?.remisePr ?? 0}
                    onChange={(e) => modifierResumeLocal('remisePr', e.target.value)}
                    onBlur={sauvegarderRemiseArrondi}
                  />
                </td>
                <td></td>
              </tr>
              <tr className="ligne-forte">
                <td><strong>TOTAL</strong></td>
                <td><strong>{totalPv.toFixed(2)} €</strong></td>
                <td><strong>{totalPr.toFixed(2)} €</strong></td>
                <td><strong>{margeTaux(totalPv, totalPr).toFixed(0)}%</strong></td>
              </tr>
              <tr>
                <td>ARRONDI</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={resume?.arrondiPv ?? 0}
                    onChange={(e) => modifierResumeLocal('arrondiPv', e.target.value)}
                    onBlur={sauvegarderRemiseArrondi}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={resume?.arrondiPr ?? 0}
                    onChange={(e) => modifierResumeLocal('arrondiPr', e.target.value)}
                    onBlur={sauvegarderRemiseArrondi}
                  />
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
