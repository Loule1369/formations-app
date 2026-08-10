import { useEffect, useMemo, useState } from 'react'
import { Rnd } from 'react-rnd'
import { supabase } from '../lib/supabaseClient'
import { JOUR_MS, heureEnDecimal, decimalEnHeure, dureeHeures, formatDate, parseDate, grouperVoyages } from '../lib/dates'

const HOUR_HEIGHT = 36
const WINDOW_START = 7
const WINDOW_END = 22
const COL_HEIGHT = HOUR_HEIGHT * (WINDOW_END - WINDOW_START)
const DAY_WIDTH = 170
const HEADER_HEIGHT = 44
const LEFT_COL_WIDTH = 52
const DAYS_SHOWN = 21
const DUREE_DEPLACEMENT = 3

const PALETTE = ['#2e5c8a', '#8a2e5c', '#2e8a5c', '#8a6b2e', '#5c2e8a', '#2e8a8a', '#8a2e2e', '#4a4a4a']

// Répartit des blocs qui se chevauchent dans le temps en couloirs (coloration d'intervalles).
function assignerLanes(blocs) {
  const tri = [...blocs].sort((a, b) => heureEnDecimal(a.heure_debut) - heureEnDecimal(b.heure_debut))
  const finLanes = []
  const laneDeBloc = {}
  for (const bloc of tri) {
    let lane = finLanes.findIndex((fin) => heureEnDecimal(bloc.heure_debut) >= fin)
    if (lane === -1) {
      lane = finLanes.length
      finLanes.push(0)
    }
    finLanes[lane] = heureEnDecimal(bloc.heure_fin)
    laneDeBloc[bloc.id] = lane
  }
  return { laneDeBloc, nbLanes: finLanes.length || 1 }
}

function formatJourLabel(date) {
  return date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

export default function Planning() {
  const [demandes, setDemandes] = useState([])
  const [demandeId, setDemandeId] = useState('')
  const [lignes, setLignes] = useState([])
  const [formateurs, setFormateurs] = useState([])

  const [scenarios, setScenarios] = useState([])
  const [scenarioId, setScenarioId] = useState('')
  const [creneaux, setCreneaux] = useState([])
  const [nomCopie, setNomCopie] = useState('')

  const [ligneId, setLigneId] = useState('')
  const [formateurAjoutId, setFormateurAjoutId] = useState('')

  const [message, setMessage] = useState('')
  const [succes, setSucces] = useState('')
  const [blocEnConfirmation, setBlocEnConfirmation] = useState('')
  const [confirmerSuppressionScenario, setConfirmerSuppressionScenario] = useState(false)
  const [redimensionnementEnCours, setRedimensionnementEnCours] = useState(null)

  function heureFinDurantRedimensionnement(creneau, hauteurPx) {
    const duree = Math.max(0.5, Math.round((hauteurPx / HOUR_HEIGHT) * 2) / 2)
    return decimalEnHeure(Math.min(heureEnDecimal(creneau.heure_debut) + duree, WINDOW_END))
  }

  const formateurCouleur = (formateurId) => {
    const i = formateurs.findIndex((f) => f.id === formateurId)
    return PALETTE[i >= 0 ? i % PALETTE.length : 0]
  }

  const baseDate = useMemo(() => {
    if (creneaux.length === 0) return new Date(new Date().toDateString())
    const min = creneaux.reduce((m, c) => (c.date < m ? c.date : m), creneaux[0].date)
    return new Date(parseDate(min).getTime() - JOUR_MS)
  }, [creneaux])

  const jours = useMemo(
    () => Array.from({ length: DAYS_SHOWN }, (_, i) => new Date(baseDate.getTime() + i * JOUR_MS)),
    [baseDate],
  )

  const disposition = useMemo(() => {
    const parJour = {}
    for (const c of creneaux) {
      if (!parJour[c.date]) parJour[c.date] = []
      parJour[c.date].push(c)
    }
    const positions = {}
    for (const [date, blocs] of Object.entries(parJour)) {
      const jourIndex = Math.round((parseDate(date).getTime() - baseDate.getTime()) / JOUR_MS)
      if (jourIndex < 0 || jourIndex >= DAYS_SHOWN) continue
      const xJour = LEFT_COL_WIDTH + jourIndex * DAY_WIDTH

      // Les formations se partagent toute la largeur du jour entre elles, sans tenir compte des déplacements.
      const formations = blocs.filter((b) => b.type === 'formation')
      const { laneDeBloc: laneFormation, nbLanes: nbLanesFormation } = assignerLanes(formations)
      const largeurFormation = DAY_WIDTH / nbLanesFormation
      for (const bloc of formations) {
        positions[bloc.id] = {
          x: xJour + laneFormation[bloc.id] * largeurFormation,
          y: HEADER_HEIGHT + (heureEnDecimal(bloc.heure_debut) - WINDOW_START) * HOUR_HEIGHT,
          width: largeurFormation - 3,
          height: dureeHeures(bloc.heure_debut, bloc.heure_fin) * HOUR_HEIGHT - 3,
        }
      }

      // Les déplacements prennent toute la largeur du jour par défaut, et ne se partagent
      // la colonne (entre eux, jamais avec les formations) que s'ils sont plusieurs à se chevaucher.
      const deplacements = blocs.filter((b) => b.type === 'deplacement')
      const { laneDeBloc: laneDepl, nbLanes: nbLanesDepl } = assignerLanes(deplacements)
      const largeurDepl = DAY_WIDTH / nbLanesDepl
      for (const bloc of deplacements) {
        positions[bloc.id] = {
          x: xJour + laneDepl[bloc.id] * largeurDepl,
          y: HEADER_HEIGHT + (heureEnDecimal(bloc.heure_debut) - WINDOW_START) * HOUR_HEIGHT,
          width: largeurDepl - 3,
          height: dureeHeures(bloc.heure_debut, bloc.heure_fin) * HOUR_HEIGHT - 3,
        }
      }
    }
    return positions
  }, [creneaux, baseDate])

  useEffect(() => {
    async function chargerBase() {
      const [demandesRes, formateursRes] = await Promise.all([
        supabase.from('demandes').select('id, statut, clients(nom)').order('created_at', { ascending: false }),
        supabase.from('formateurs').select('id, nom, statut, base_depart').order('nom'),
      ])
      if (demandesRes.data) setDemandes(demandesRes.data)
      if (formateursRes.data) setFormateurs(formateursRes.data)
    }
    chargerBase()
  }, [])

  async function chargerDemande(id) {
    setDemandeId(id)
    setScenarioId('')
    setCreneaux([])
    setMessage('')
    setSucces('')
    if (!id) {
      setLignes([])
      setScenarios([])
      return
    }
    const [lignesRes, scenariosRes] = await Promise.all([
      supabase
        .from('demande_lignes')
        .select('id, formation_id, nb_participants, groupe, formations_catalogue(nom, duree_h, code)')
        .eq('demande_id', id)
        .order('created_at'),
      supabase.from('scenarios').select('id, nom, est_retenu').eq('demande_id', id).order('created_at'),
    ])
    setLignes(lignesRes.data || [])

    let scenariosList = scenariosRes.data || []
    if (scenariosList.length === 0) {
      const { data: nouveau } = await supabase
        .from('scenarios')
        .insert({ demande_id: id, nom: 'Option A' })
        .select('id, nom, est_retenu')
        .single()
      scenariosList = [nouveau]
      await genererPlanningParDefaut(id, nouveau.id, lignesRes.data || [])
    }
    setScenarios(scenariosList)
    chargerScenario(scenariosList[0].id)
  }

  // Premier jour ouvré à partir d'une date INCLUSE (utilisé pour le tout premier bloc : si on
  // planifie un lundi, le plan par défaut peut démarrer ce lundi même, pas le mardi suivant).
  function jourOuvreDepuis(date) {
    const d = new Date(date)
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setTime(d.getTime() + JOUR_MS)
    }
    return d
  }

  // Prochain jour ouvré APRÈS une date (exclue) : utilisé pour tous les blocs suivants, afin de ne
  // jamais réutiliser le même jour que le bloc précédent.
  function jourOuvreSuivant(date) {
    const d = new Date(date)
    do {
      d.setTime(d.getTime() + JOUR_MS)
    } while (d.getDay() === 0 || d.getDay() === 6)
    return d
  }

  function trouverFormateurPourCode(code) {
    if (formateurs.length === 0) return null
    return formateurs.find((f) => (f.competences || []).includes(code)) || formateurs[0]
  }

  const MAX_DUREE_JOUR = 7
  const HEURE_DEBUT_LUNDI = 13.5 // le lundi matin est réservé au trajet par défaut
  const MAX_DUREE_DEMARRAGE_APRES_MIDI = 3 // un 1er jour qui démarre l'après-midi (ex. lundi) reste court, le reste bascule le lendemain matin
  const PAUSE_DEJEUNER_DEBUT = 12
  const PAUSE_DEJEUNER_FIN = 13.5

  // Découpe un créneau qui chevaucherait la pause déjeuner en deux blocs (matin / après-midi).
  function decouperAvecPauseDejeuner(heureDebutJour, dureeJour) {
    if (heureDebutJour >= PAUSE_DEJEUNER_DEBUT || heureDebutJour + dureeJour <= PAUSE_DEJEUNER_DEBUT) {
      return [{ heure_debut: heureDebutJour, heure_fin: heureDebutJour + dureeJour }]
    }
    const dureeMatin = PAUSE_DEJEUNER_DEBUT - heureDebutJour
    const dureeApresMidi = dureeJour - dureeMatin
    return [
      { heure_debut: heureDebutJour, heure_fin: PAUSE_DEJEUNER_DEBUT },
      { heure_debut: PAUSE_DEJEUNER_FIN, heure_fin: PAUSE_DEJEUNER_FIN + dureeApresMidi },
    ]
  }

  async function genererPlanningParDefaut(demandeIdCible, scenarioIdCible, lignesData) {
    if (!lignesData || lignesData.length === 0 || formateurs.length === 0) return
    let jourCourant = null
    const blocs = []
    for (const ligne of lignesData) {
      const formateur = trouverFormateurPourCode(ligne.formations_catalogue?.code)
      let dureeRestante = ligne.formations_catalogue?.duree_h || 4
      while (dureeRestante > 0) {
        jourCourant =
          jourCourant === null
            ? jourOuvreDepuis(new Date(new Date().toDateString()))
            : jourOuvreSuivant(jourCourant)
        const demarreApresMidi = jourCourant.getDay() === 1
        const heureDebutJour = demarreApresMidi ? HEURE_DEBUT_LUNDI : 9
        const traversePause = heureDebutJour < PAUSE_DEJEUNER_DEBUT
        const budgetJour = traversePause
          ? WINDOW_END - heureDebutJour - (PAUSE_DEJEUNER_FIN - PAUSE_DEJEUNER_DEBUT)
          : WINDOW_END - heureDebutJour
        const plafondJour = demarreApresMidi ? MAX_DUREE_DEMARRAGE_APRES_MIDI : MAX_DUREE_JOUR
        const dureeJour = Math.min(dureeRestante, plafondJour, budgetJour)
        for (const segment of decouperAvecPauseDejeuner(heureDebutJour, dureeJour)) {
          blocs.push({
            demande_id: demandeIdCible,
            demande_ligne_id: ligne.id,
            scenario_id: scenarioIdCible,
            formateur_id: formateur.id,
            type: 'formation',
            date: formatDate(jourCourant),
            heure_debut: decimalEnHeure(segment.heure_debut),
            heure_fin: decimalEnHeure(segment.heure_fin),
          })
        }
        dureeRestante -= dureeJour
      }
    }
    await supabase.from('creneaux').insert(blocs)
    await synchroniserDeplacements(scenarioIdCible, demandeIdCible)
  }

  // Recalcule entièrement les blocs "Déplacement" (avant/après chaque mission) à partir
  // des blocs "Formation" actuels : un aller la veille du 1er jour, un retour le soir du dernier jour.
  async function synchroniserDeplacements(scenarioIdCible, demandeIdCible) {
    const { data: formationsActuelles } = await supabase
      .from('creneaux')
      .select('date, heure_debut, heure_fin, formateur_id')
      .eq('scenario_id', scenarioIdCible)
      .eq('type', 'formation')
      .order('date')

    await supabase.from('creneaux').delete().eq('scenario_id', scenarioIdCible).eq('type', 'deplacement')

    const parFormateur = {}
    for (const bloc of formationsActuelles || []) {
      if (!parFormateur[bloc.formateur_id]) parFormateur[bloc.formateur_id] = []
      parFormateur[bloc.formateur_id].push(bloc)
    }

    const nouveauxDeplacements = []
    for (const [formateurId, blocs] of Object.entries(parFormateur)) {
      const tri = [...blocs].sort((a, b) => a.date.localeCompare(b.date))
      for (const voyage of grouperVoyages(tri.map((b) => b.date))) {
        const debutEstLundi = parseDate(voyage.debut).getDay() === 1
        // Le lundi, le trajet se fait le matin même (pas de déplacement le dimanche par défaut).
        const arrivee = debutEstLundi
          ? {
              date: voyage.debut,
              heure_debut: decimalEnHeure(WINDOW_START),
              heure_fin: decimalEnHeure(PAUSE_DEJEUNER_DEBUT),
            }
          : {
              date: formatDate(new Date(parseDate(voyage.debut).getTime() - JOUR_MS)),
              heure_debut: decimalEnHeure(WINDOW_END - DUREE_DEPLACEMENT),
              heure_fin: decimalEnHeure(WINDOW_END),
            }
        nouveauxDeplacements.push({
          demande_id: demandeIdCible,
          demande_ligne_id: null,
          scenario_id: scenarioIdCible,
          formateur_id: formateurId,
          type: 'deplacement',
          ...arrivee,
        })

        const blocsDernierJour = tri.filter((b) => b.date === voyage.fin)
        const finMax = Math.max(...blocsDernierJour.map((b) => heureEnDecimal(b.heure_fin)))
        const debutRetour = Math.max(finMax, WINDOW_END - DUREE_DEPLACEMENT)
        nouveauxDeplacements.push({
          demande_id: demandeIdCible,
          demande_ligne_id: null,
          scenario_id: scenarioIdCible,
          formateur_id: formateurId,
          type: 'deplacement',
          date: voyage.fin,
          heure_debut: decimalEnHeure(debutRetour),
          heure_fin: decimalEnHeure(Math.min(debutRetour + DUREE_DEPLACEMENT, WINDOW_END)),
        })
      }
    }
    if (nouveauxDeplacements.length > 0) {
      await supabase.from('creneaux').insert(nouveauxDeplacements)
    }
  }

  async function rafraichirDeplacements(scenarioIdCible) {
    const { data } = await supabase
      .from('creneaux')
      .select('id, type, date, heure_debut, heure_fin, formateur_id, demande_ligne_id, demande_lignes(groupe, formations_catalogue(nom))')
      .eq('scenario_id', scenarioIdCible)
      .eq('type', 'deplacement')
    setCreneaux((prev) => [...prev.filter((c) => c.type !== 'deplacement'), ...(data || [])])
  }

  async function finaliserMutation() {
    await synchroniserDeplacements(scenarioId, demandeId)
    await rafraichirDeplacements(scenarioId)
  }

  async function chargerScenario(id) {
    setScenarioId(id)
    setNomCopie('')
    setConfirmerSuppressionScenario(false)
    setBlocEnConfirmation('')
    const { data } = await supabase
      .from('creneaux')
      .select('id, type, date, heure_debut, heure_fin, formateur_id, demande_ligne_id, demande_lignes(groupe, formations_catalogue(nom))')
      .eq('scenario_id', id)
      .order('date')
    setCreneaux(data || [])
  }

  async function dupliquerScenario() {
    setMessage('')
    setSucces('')
    const source = scenarios.find((s) => s.id === scenarioId)
    const nom = nomCopie.trim() || `${source?.nom || 'Scénario'} (copie)`

    const { data: nouveau, error: erreurScenario } = await supabase
      .from('scenarios')
      .insert({ demande_id: demandeId, nom })
      .select('id, nom, est_retenu')
      .single()
    if (erreurScenario) {
      setMessage(`Échec de la duplication : ${erreurScenario.message}`)
      return
    }

    const blocsFormation = creneaux.filter((c) => c.type === 'formation')
    if (blocsFormation.length > 0) {
      const { error: erreurCopie } = await supabase.from('creneaux').insert(
        blocsFormation.map((c) => ({
          demande_id: demandeId,
          demande_ligne_id: c.demande_ligne_id,
          scenario_id: nouveau.id,
          formateur_id: c.formateur_id,
          type: c.type,
          date: c.date,
          heure_debut: c.heure_debut,
          heure_fin: c.heure_fin,
        })),
      )
      if (erreurCopie) {
        setMessage(`Scénario créé mais échec de la copie des blocs : ${erreurCopie.message}`)
        setScenarios((prev) => [...prev, nouveau])
        chargerScenario(nouveau.id)
        return
      }
    }
    await synchroniserDeplacements(nouveau.id, demandeId)
    setScenarios((prev) => [...prev, nouveau])
    setSucces(`Scénario « ${nom} » créé avec ${blocsFormation.length} formation(s) copiée(s).`)
    chargerScenario(nouveau.id)
  }

  async function supprimerScenario() {
    if (scenarios.length <= 1) {
      setMessage('Impossible de supprimer le seul scénario de cette demande.')
      return
    }
    if (!confirmerSuppressionScenario) {
      setConfirmerSuppressionScenario(true)
      return
    }
    setConfirmerSuppressionScenario(false)
    await supabase.from('scenarios').delete().eq('id', scenarioId)
    const restants = scenarios.filter((s) => s.id !== scenarioId)
    setScenarios(restants)
    chargerScenario(restants[0].id)
  }

  async function retenirScenario() {
    await supabase.from('scenarios').update({ est_retenu: false }).eq('demande_id', demandeId)
    await supabase.from('scenarios').update({ est_retenu: true }).eq('id', scenarioId)
    setScenarios((prev) => prev.map((s) => ({ ...s, est_retenu: s.id === scenarioId })))
    setSucces('Ce scénario est maintenant le planning retenu pour ce client.')
  }

  async function ajouterBloc() {
    setSucces('')
    if (!formateurAjoutId) {
      setMessage('Choisissez un formateur avant d’ajouter un bloc.')
      return
    }
    if (!ligneId) {
      setMessage('Choisissez une formation avant d’ajouter un bloc.')
      return
    }
    const ligne = lignes.find((l) => l.id === ligneId)
    const duree = ligne?.formations_catalogue?.duree_h || 4
    const { error } = await supabase.from('creneaux').insert({
      demande_id: demandeId,
      scenario_id: scenarioId,
      demande_ligne_id: ligneId,
      formateur_id: formateurAjoutId,
      type: 'formation',
      date: formatDate(jours[1]),
      heure_debut: '09:00:00',
      heure_fin: decimalEnHeure(9 + Math.min(duree, WINDOW_END - 9)),
    })
    if (error) {
      setMessage(error.message)
      return
    }
    setMessage('')
    await finaliserMutation()
  }

  // Duplique une formation en un groupe supplémentaire (ex. 2 sessions pour 2 groupes de participants).
  // Chaque groupe est une ligne de demande indépendante, planifiable séparément.
  async function dupliquerGroupe(ligne) {
    setMessage('')
    setSucces('')
    const soeurs = lignes.filter((l) => l.formation_id === ligne.formation_id)
    const nouveauGroupe = Math.max(...soeurs.map((l) => l.groupe || 1)) + 1

    const sansGroupe = soeurs.filter((l) => !l.groupe)
    if (sansGroupe.length > 0) {
      await supabase.from('demande_lignes').update({ groupe: 1 }).in('id', sansGroupe.map((l) => l.id))
    }

    const { data, error } = await supabase
      .from('demande_lignes')
      .insert({
        demande_id: demandeId,
        formation_id: ligne.formation_id,
        nb_participants: ligne.nb_participants,
        groupe: nouveauGroupe,
      })
      .select('id, formation_id, nb_participants, groupe, formations_catalogue(nom, duree_h, code)')
      .single()
    if (error) {
      setMessage(error.message)
      return
    }

    setLignes((prev) => [
      ...prev.map((l) => (sansGroupe.some((s) => s.id === l.id) ? { ...l, groupe: 1 } : l)),
      data,
    ])
    setSucces(`Groupe ${nouveauGroupe} créé pour « ${ligne.formations_catalogue?.nom} ». Ajoutez-le au planning via le formulaire ci-dessous.`)
  }

  async function supprimerBloc(id) {
    if (blocEnConfirmation !== id) {
      setBlocEnConfirmation(id)
      return
    }
    setBlocEnConfirmation('')
    await supabase.from('creneaux').delete().eq('id', id)
    await finaliserMutation()
  }

  async function conflitAvecPlanningsRetenus(formateurId, date, heureDebut, heureFin, excluCreneauId) {
    const chevauche = (c) =>
      c.id !== excluCreneauId &&
      c.date === date &&
      c.formateur_id === formateurId &&
      heureEnDecimal(heureDebut) < heureEnDecimal(c.heure_fin) &&
      heureEnDecimal(heureFin) > heureEnDecimal(c.heure_debut)

    const conflitLocal = creneaux.find(chevauche)
    if (conflitLocal) return `Conflit dans ce scénario avec un autre bloc du même formateur.`

    const { data } = await supabase
      .from('creneaux')
      .select('id, date, heure_debut, heure_fin, formateur_id, demandes(clients(nom)), scenarios!inner(est_retenu, demande_id)')
      .eq('formateur_id', formateurId)
      .eq('date', date)
      .eq('scenarios.est_retenu', true)
      .neq('scenarios.demande_id', demandeId)
    const conflitExterne = (data || []).find(chevauche)
    if (conflitExterne) {
      return `Conflit : ce formateur est déjà retenu ce jour-là pour ${conflitExterne.demandes?.clients?.nom || 'un autre client'}.`
    }
    return null
  }

  async function deplacerBloc(creneau, xAbs, yAbs) {
    const jourIndex = Math.min(Math.max(Math.round((xAbs - LEFT_COL_WIDTH) / DAY_WIDTH), 0), DAYS_SHOWN - 1)
    const duree = dureeHeures(creneau.heure_debut, creneau.heure_fin)
    const heureBrute = WINDOW_START + (yAbs - HEADER_HEIGHT) / HOUR_HEIGHT
    const heureDebutSnap = Math.min(Math.max(Math.round(heureBrute * 2) / 2, WINDOW_START), WINDOW_END - duree)
    const nouvelleDate = formatDate(jours[jourIndex])
    const nouvelleHeureDebut = decimalEnHeure(heureDebutSnap)
    const nouvelleHeureFin = decimalEnHeure(heureDebutSnap + duree)

    if (nouvelleDate === creneau.date && nouvelleHeureDebut === creneau.heure_debut) return

    setMessage('')
    setCreneaux((prev) =>
      prev.map((c) =>
        c.id === creneau.id
          ? { ...c, date: nouvelleDate, heure_debut: nouvelleHeureDebut, heure_fin: nouvelleHeureFin }
          : c,
      ),
    )

    const conflit = await conflitAvecPlanningsRetenus(
      creneau.formateur_id,
      nouvelleDate,
      nouvelleHeureDebut,
      nouvelleHeureFin,
      creneau.id,
    )
    if (conflit) {
      setMessage(conflit)
      setCreneaux((prev) => prev.map((c) => (c.id === creneau.id ? creneau : c)))
      return
    }

    await supabase
      .from('creneaux')
      .update({ date: nouvelleDate, heure_debut: nouvelleHeureDebut, heure_fin: nouvelleHeureFin })
      .eq('id', creneau.id)

    if (creneau.type === 'formation') await finaliserMutation()
  }

  async function redimensionnerBloc(creneau, hauteurPx) {
    const dureeBrute = hauteurPx / HOUR_HEIGHT
    const duree = Math.max(0.5, Math.round(dureeBrute * 2) / 2)
    const nouvelleHeureFin = decimalEnHeure(
      Math.min(heureEnDecimal(creneau.heure_debut) + duree, WINDOW_END),
    )

    if (nouvelleHeureFin === creneau.heure_fin) return

    setMessage('')
    setCreneaux((prev) => prev.map((c) => (c.id === creneau.id ? { ...c, heure_fin: nouvelleHeureFin } : c)))

    const conflit = await conflitAvecPlanningsRetenus(
      creneau.formateur_id,
      creneau.date,
      creneau.heure_debut,
      nouvelleHeureFin,
      creneau.id,
    )
    if (conflit) {
      setMessage(conflit)
      setCreneaux((prev) => prev.map((c) => (c.id === creneau.id ? creneau : c)))
      return
    }

    await supabase.from('creneaux').update({ heure_fin: nouvelleHeureFin }).eq('id', creneau.id)
    await finaliserMutation()
  }

  // Une même formation peut être découpée en plusieurs blocs (matin/après-midi, plusieurs jours) :
  // changer le formateur sur l'un d'eux le change sur tous les blocs de cette même formation.
  async function changerFormateurBloc(creneau, nouveauFormateurId) {
    const freres = creneau.demande_ligne_id
      ? creneaux.filter((c) => c.demande_ligne_id === creneau.demande_ligne_id)
      : [creneau]

    for (const f of freres) {
      const conflit = await conflitAvecPlanningsRetenus(
        nouveauFormateurId,
        f.date,
        f.heure_debut,
        f.heure_fin,
        f.id,
      )
      if (conflit) {
        setMessage(conflit)
        return
      }
    }

    setMessage('')
    const idsFreres = new Set(freres.map((f) => f.id))
    setCreneaux((prev) => prev.map((c) => (idsFreres.has(c.id) ? { ...c, formateur_id: nouveauFormateurId } : c)))

    await supabase.from('creneaux').update({ formateur_id: nouveauFormateurId }).in('id', [...idsFreres])
    await finaliserMutation()
  }

  const alertesLegales = useMemo(() => {
    const alertes = []
    const parFormateurEtJour = {}
    for (const c of creneaux) {
      const cle = `${c.formateur_id}|${c.date}`
      if (!parFormateurEtJour[cle]) parFormateurEtJour[cle] = []
      parFormateurEtJour[cle].push(c)
    }
    for (const [cle, blocs] of Object.entries(parFormateurEtJour)) {
      const [formateurId, date] = cle.split('|')
      const nom = formateurs.find((f) => f.id === formateurId)?.nom || '?'
      const total = blocs.reduce((s, c) => s + dureeHeures(c.heure_debut, c.heure_fin), 0)
      if (total > 10) {
        alertes.push(`${nom} : ${total.toFixed(1)}h le ${date} (> 10h)`)
      }
      const finMax = Math.max(...blocs.map((c) => heureEnDecimal(c.heure_fin)))
      const cleLendemain = `${formateurId}|${formatDate(new Date(parseDate(date).getTime() + JOUR_MS))}`
      const blocsLendemain = parFormateurEtJour[cleLendemain]
      if (blocsLendemain) {
        const debutMin = Math.min(...blocsLendemain.map((c) => heureEnDecimal(c.heure_debut)))
        const repos = 24 - finMax + debutMin
        if (repos < 11) {
          alertes.push(`${nom} : ${repos.toFixed(1)}h de repos seulement entre le ${date} et le lendemain`)
        }
      }
    }
    return alertes
  }, [creneaux, formateurs])

  const avertissementsWeekend = useMemo(() => {
    return creneaux
      .filter((c) => c.type === 'formation' && [0, 6].includes(new Date(c.date + 'T00:00:00').getDay()))
      .map((c) => `${c.demande_lignes?.formations_catalogue?.nom || 'Formation'} placée le ${c.date} (week-end).`)
  }, [creneaux])

  return (
    <div className="page page-large">
      <h1>Planning</h1>

      <label>
        Demande à planifier
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
              Scénario
              <select value={scenarioId} onChange={(e) => chargerScenario(e.target.value)}>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom} {s.est_retenu ? '★ retenu' : ''}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="text"
              placeholder="Nom de la copie (optionnel)"
              value={nomCopie}
              onChange={(e) => setNomCopie(e.target.value)}
            />
            <button type="button" onClick={dupliquerScenario} disabled={!scenarioId}>
              Dupliquer ce scénario
            </button>
            <button type="button" onClick={retenirScenario} disabled={!scenarioId}>
              Retenir ce scénario
            </button>
            <button
              type="button"
              onClick={supprimerScenario}
              disabled={!scenarioId}
              className={confirmerSuppressionScenario ? 'bouton-danger' : ''}
            >
              {confirmerSuppressionScenario ? 'Confirmer la suppression ?' : 'Supprimer ce scénario'}
            </button>
          </div>

          <ul className="liste-lignes-demande">
            {lignes.map((l) => (
              <li key={l.id}>
                {l.formations_catalogue?.nom}
                {l.groupe ? <span className="badge-groupe">Groupe {l.groupe}</span> : null}
                <button type="button" onClick={() => dupliquerGroupe(l)}>
                  + Dupliquer (nouveau groupe)
                </button>
              </li>
            ))}
          </ul>

          <div className="barre-ajout">
            <select value={ligneId} onChange={(e) => setLigneId(e.target.value)}>
              <option value="">— Formation —</option>
              {lignes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.formations_catalogue?.nom}
                  {l.groupe ? ` (Groupe ${l.groupe})` : ''}
                </option>
              ))}
            </select>
            <select value={formateurAjoutId} onChange={(e) => setFormateurAjoutId(e.target.value)}>
              <option value="">— Formateur —</option>
              {formateurs.map((f) => (
                <option key={f.id} value={f.id}>{f.nom}</option>
              ))}
            </select>
            <button type="button" onClick={ajouterBloc}>+ Ajouter un bloc supplémentaire</button>
          </div>

          <div className="legende-formateurs">
            {formateurs.map((f) => (
              <span key={f.id} className="legende-item">
                <span className="legende-pastille" style={{ background: formateurCouleur(f.id) }} />
                {f.nom}
              </span>
            ))}
          </div>

          {message && <p className="message erreur">{message}</p>}
          {succes && <p className="message succes">{succes}</p>}
          {alertesLegales.length > 0 && (
            <ul className="message erreur">
              {alertesLegales.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
          {avertissementsWeekend.length > 0 && (
            <ul className="message info">
              {avertissementsWeekend.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}

          <p className="astuce">
            Un planning de départ a été généré automatiquement. Glissez un bloc de formation pour changer de jour/horaire, étirez le bord bas pour changer la durée, ou changez le formateur via le menu dans le bloc.
            Les blocs « Déplacement » (gris, avant/après chaque mission) sont recalculés automatiquement, vous n'avez pas à les toucher.
          </p>

          <div className="planning-scroll">
            <div
              className="planning-inner"
              style={{
                width: LEFT_COL_WIDTH + DAYS_SHOWN * DAY_WIDTH,
                height: HEADER_HEIGHT + COL_HEIGHT,
              }}
            >
              <div className="planning-coin" style={{ width: LEFT_COL_WIDTH, height: HEADER_HEIGHT }} />

              {jours.map((j, i) => (
                <div key={i}>
                  <div
                    className="planning-entete-jour"
                    style={{ left: LEFT_COL_WIDTH + i * DAY_WIDTH, width: DAY_WIDTH, height: HEADER_HEIGHT }}
                  >
                    {formatJourLabel(j)}
                  </div>
                  <div
                    className="planning-colonne-jour"
                    style={{ left: LEFT_COL_WIDTH + i * DAY_WIDTH, top: HEADER_HEIGHT, width: DAY_WIDTH, height: COL_HEIGHT }}
                  />
                </div>
              ))}

              {Array.from({ length: WINDOW_END - WINDOW_START + 1 }, (_, i) => WINDOW_START + i).map((h) => (
                <div
                  key={h}
                  className="planning-heure-repere"
                  style={{ top: HEADER_HEIGHT + (h - WINDOW_START) * HOUR_HEIGHT, width: LEFT_COL_WIDTH }}
                >
                  {h}h
                </div>
              ))}

              {creneaux.map((c) => {
                const pos = disposition[c.id]
                if (!pos) return null
                const couleur = formateurCouleur(c.formateur_id)
                const estFormation = c.type === 'formation'
                return (
                  <Rnd
                    key={c.id}
                    size={{ width: pos.width, height: pos.height }}
                    position={{ x: pos.x, y: pos.y }}
                    minHeight={HOUR_HEIGHT / 2}
                    bounds="parent"
                    disableDragging={!estFormation}
                    enableResizing={estFormation ? { bottom: true, top: false, left: false, right: false } : false}
                    dragGrid={[DAY_WIDTH, HOUR_HEIGHT / 2]}
                    resizeGrid={[DAY_WIDTH, HOUR_HEIGHT / 2]}
                    cancel=".planning-bloc-select, .planning-bloc-supprimer"
                    onDragStop={(e, d) => deplacerBloc(c, d.x, d.y)}
                    onResize={(e, dir, ref) =>
                      setRedimensionnementEnCours({ id: c.id, heureFin: heureFinDurantRedimensionnement(c, ref.offsetHeight) })
                    }
                    onResizeStop={(e, dir, ref) => {
                      setRedimensionnementEnCours(null)
                      redimensionnerBloc(c, ref.offsetHeight)
                    }}
                    className={`planning-bloc ${c.type}`}
                    style={estFormation ? { background: couleur } : { borderColor: couleur }}
                  >
                    {estFormation && (
                      <button
                        className="planning-bloc-supprimer"
                        onClick={() => supprimerBloc(c.id)}
                        title={blocEnConfirmation === c.id ? 'Cliquer pour confirmer' : 'Retirer ce bloc'}
                      >
                        {blocEnConfirmation === c.id ? '✓' : '×'}
                      </button>
                    )}
                    {estFormation ? (
                      <>
                        <div className="planning-bloc-titre">
                          {c.demande_lignes?.formations_catalogue?.nom}
                          {c.demande_lignes?.groupe ? ` (Groupe ${c.demande_lignes.groupe})` : ''}
                        </div>
                        <div className="planning-bloc-heures">
                          {c.heure_debut.slice(0, 5)}–
                          {(redimensionnementEnCours?.id === c.id
                            ? redimensionnementEnCours.heureFin
                            : c.heure_fin
                          ).slice(0, 5)}
                        </div>
                        <select
                          className="planning-bloc-select"
                          value={c.formateur_id}
                          onChange={(e) => changerFormateurBloc(c, e.target.value)}
                        >
                          {formateurs.map((f) => (
                            <option key={f.id} value={f.id}>{f.nom}</option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <>
                        <div className="planning-bloc-titre">Déplacement</div>
                        <div className="planning-bloc-heures">
                          {c.heure_debut.slice(0, 5)}–{c.heure_fin.slice(0, 5)}
                        </div>
                      </>
                    )}
                  </Rnd>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
