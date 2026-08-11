import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { JOUR_MS, heureEnDecimal, decimalEnHeure, dureeHeures, formatDate, parseDate, grouperVoyages } from '../lib/dates'
import { useProjetActif } from '../lib/ProjetActifContext'

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
  const { demandeId, clientNom } = useProjetActif()
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
  const [confirmerRegeneration, setConfirmerRegeneration] = useState(false)
  const [redimensionnementEnCours, setRedimensionnementEnCours] = useState(null)
  const blocRefs = useRef({})

  function heureFinDurantRedimensionnement(creneau, hauteurPx) {
    const duree = Math.max(0.5, Math.round((hauteurPx / HOUR_HEIGHT) * 2) / 2)
    return decimalEnHeure(Math.min(heureEnDecimal(creneau.heure_debut) + duree, WINDOW_END))
  }

  // Couleur déterministe par formation (même code = même couleur, quel que soit le projet ou le formateur).
  function formationCouleur(code) {
    if (!code) return '#4a4a4a'
    let hash = 0
    for (let i = 0; i < code.length; i++) {
      hash = (hash * 31 + code.charCodeAt(i)) % 997
    }
    return PALETTE[Math.abs(hash) % PALETTE.length]
  }

  function nomFormateur(formateurId) {
    return formateurs.find((f) => f.id === formateurId)?.nom || '?'
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
    supabase
      .from('formateurs')
      .select('id, nom, statut, base_depart')
      .order('nom')
      .then(({ data }) => data && setFormateurs(data))
  }, [])

  useEffect(() => {
    if (demandeId && formateurs.length === 0) return // attend le chargement des formateurs
    chargerDemande(demandeId)
  }, [demandeId, formateurs.length])

  async function chargerDemande(id) {
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

  // Le tout premier jour du plan par défaut est toujours un lundi (arrivée le matin, formation
  // l'après-midi) : un projet se planifie sur une semaine complète, pas "à partir d'aujourd'hui".
  function prochainLundi(date) {
    const d = new Date(date)
    while (d.getDay() !== 1) {
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

  const HEURE_DEBUT_JOUR = 8
  const MAX_DUREE_JOUR = 8
  const HEURE_DEBUT_LUNDI = 13.5 // le lundi matin est réservé au trajet par défaut
  const MAX_DUREE_DEMARRAGE_APRES_MIDI = 3 // un 1er jour qui démarre l'après-midi (ex. lundi) reste court, le reste bascule le lendemain matin
  const PAUSE_DEJEUNER_DEBUT = 12
  const PAUSE_DEJEUNER_FIN = 13.5
  const DUREE_MIN_MATINEE_PLEINE = 4 // en dessous, une session matinale isolée est recalée pour finir à midi
  const DUREE_MIN_DEMARRAGE_NOUVELLE_FORMATION = 2 // une nouvelle formation ne démarre pas dans un reliquat trop court (ex. 11h-12h) : elle attend l'après-midi ou le lendemain

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

  // Génère le planning par défaut en optimisant le remplissage : une nouvelle formation continue sur
  // le créneau restant du jour en cours (si la place le permet) au lieu de systématiquement sauter au
  // jour suivant — ça évite les petits "bouts" de formation isolés sur une journée dédiée pour presque rien.
  async function genererPlanningParDefaut(demandeIdCible, scenarioIdCible, lignesData) {
    if (!lignesData || lignesData.length === 0 || formateurs.length === 0) return
    let jourCourant = null
    let heureCourante = null
    let heureFinJourCourant = null
    const blocs = []

    function capaciteRestanteJour() {
      const pauseAVenir = heureCourante < PAUSE_DEJEUNER_DEBUT
      const budget = pauseAVenir
        ? heureFinJourCourant - heureCourante - (PAUSE_DEJEUNER_FIN - PAUSE_DEJEUNER_DEBUT)
        : heureFinJourCourant - heureCourante
      return Math.max(0, budget)
    }

    function demarrerNouveauJour() {
      jourCourant =
        jourCourant === null
          ? prochainLundi(new Date(new Date().toDateString()))
          : jourOuvreSuivant(jourCourant)
      const demarreApresMidi = jourCourant.getDay() === 1
      heureCourante = demarreApresMidi ? HEURE_DEBUT_LUNDI : HEURE_DEBUT_JOUR
      heureFinJourCourant = demarreApresMidi
        ? HEURE_DEBUT_LUNDI + MAX_DUREE_DEMARRAGE_APRES_MIDI
        : HEURE_DEBUT_JOUR + MAX_DUREE_JOUR + (PAUSE_DEJEUNER_FIN - PAUSE_DEJEUNER_DEBUT)
    }

    // Une NOUVELLE formation ne démarre que s'il reste assez de place avant la prochaine coupure
    // (déjeuner ou fin de journée) ; sinon on saute directement à la coupure suivante plutôt que
    // de caser un reliquat de 1h juste avant midi. Les blocs suivants de la MÊME formation, eux,
    // peuvent toujours utiliser un reliquat court (c'est la fin naturelle d'un multi-jours).
    function garantirPlaceDemarrage(dureeLigne) {
      while (true) {
        if (jourCourant === null || capaciteRestanteJour() <= 0) {
          demarrerNouveauJour()
          continue
        }
        if (capaciteRestanteJour() >= Math.min(dureeLigne, DUREE_MIN_DEMARRAGE_NOUVELLE_FORMATION)) return
        if (heureCourante < PAUSE_DEJEUNER_DEBUT) {
          heureCourante = PAUSE_DEJEUNER_FIN
        } else {
          demarrerNouveauJour()
        }
      }
    }

    for (const ligne of lignesData) {
      const formateur = trouverFormateurPourCode(ligne.formations_catalogue?.code)
      let dureeRestante = ligne.formations_catalogue?.duree_h || 4
      garantirPlaceDemarrage(dureeRestante)
      while (dureeRestante > 0) {
        if (jourCourant === null || capaciteRestanteJour() <= 0) {
          demarrerNouveauJour()
        }
        const dureeChunk = Math.min(dureeRestante, capaciteRestanteJour())
        const segments = decouperAvecPauseDejeuner(heureCourante, dureeChunk)
        for (const segment of segments) {
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
        heureCourante = segments[segments.length - 1].heure_fin
        if (heureCourante >= PAUSE_DEJEUNER_DEBUT && heureCourante < PAUSE_DEJEUNER_FIN) {
          heureCourante = PAUSE_DEJEUNER_FIN
        }
        dureeRestante -= dureeChunk
      }
    }

    // Post-traitement : une session matinale courte (<4h) restée seule ce jour-là (rien l'après-midi)
    // est recalée pour finir à midi plutôt que de trainer en début de matinée avec un grand vide après.
    const parJour = {}
    for (const b of blocs) {
      if (!parJour[b.date]) parJour[b.date] = []
      parJour[b.date].push(b)
    }
    for (const blocsJour of Object.values(parJour)) {
      if (blocsJour.length !== 1) continue
      const b = blocsJour[0]
      const debut = heureEnDecimal(b.heure_debut)
      const fin = heureEnDecimal(b.heure_fin)
      if (debut < PAUSE_DEJEUNER_DEBUT && fin <= PAUSE_DEJEUNER_DEBUT && fin - debut < DUREE_MIN_MATINEE_PLEINE) {
        b.heure_debut = decimalEnHeure(PAUSE_DEJEUNER_DEBUT - (fin - debut))
        b.heure_fin = decimalEnHeure(PAUSE_DEJEUNER_DEBUT)
      }
    }

    await supabase.from('creneaux').insert(blocs)
    await synchroniserDeplacements(scenarioIdCible, demandeIdCible)
  }

  // Recalcule les blocs "Déplacement" (avant/après chaque mission) à partir des blocs "Formation"
  // actuels : un aller la veille du 1er jour, un retour le soir du dernier jour. Un bloc déplacement
  // que le chef de projet a ajusté à la main (modifie_manuellement) n'est jamais recalculé/écrasé,
  // tant que la mission dont il dépend existe toujours à peu près à la même date.
  async function synchroniserDeplacements(scenarioIdCible, demandeIdCible) {
    const { data: formationsActuelles } = await supabase
      .from('creneaux')
      .select('date, heure_debut, heure_fin, formateur_id')
      .eq('scenario_id', scenarioIdCible)
      .eq('type', 'formation')
      .order('date')

    const { data: deplacementsExistants } = await supabase
      .from('creneaux')
      .select('id, date, formateur_id, modifie_manuellement')
      .eq('scenario_id', scenarioIdCible)
      .eq('type', 'deplacement')

    const cle = (formateurId, date) => `${formateurId}|${date}`
    const clesManuelles = new Set(
      (deplacementsExistants || []).filter((d) => d.modifie_manuellement).map((d) => cle(d.formateur_id, d.date)),
    )

    const parFormateur = {}
    for (const bloc of formationsActuelles || []) {
      if (!parFormateur[bloc.formateur_id]) parFormateur[bloc.formateur_id] = []
      parFormateur[bloc.formateur_id].push(bloc)
    }

    const clesAttendues = new Set()
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
        clesAttendues.add(cle(formateurId, arrivee.date))
        if (!clesManuelles.has(cle(formateurId, arrivee.date))) {
          nouveauxDeplacements.push({
            demande_id: demandeIdCible,
            demande_ligne_id: null,
            scenario_id: scenarioIdCible,
            formateur_id: formateurId,
            type: 'deplacement',
            ...arrivee,
          })
        }

        const blocsDernierJour = tri.filter((b) => b.date === voyage.fin)
        const finMax = Math.max(...blocsDernierJour.map((b) => heureEnDecimal(b.heure_fin)))
        const debutRetour = Math.max(finMax, WINDOW_END - DUREE_DEPLACEMENT)
        const depart = {
          date: voyage.fin,
          heure_debut: decimalEnHeure(debutRetour),
          heure_fin: decimalEnHeure(Math.min(debutRetour + DUREE_DEPLACEMENT, WINDOW_END)),
        }
        clesAttendues.add(cle(formateurId, depart.date))
        if (!clesManuelles.has(cle(formateurId, depart.date))) {
          nouveauxDeplacements.push({
            demande_id: demandeIdCible,
            demande_ligne_id: null,
            scenario_id: scenarioIdCible,
            formateur_id: formateurId,
            type: 'deplacement',
            ...depart,
          })
        }
      }
    }

    const idsAConserver = new Set(
      (deplacementsExistants || [])
        .filter((d) => d.modifie_manuellement && clesAttendues.has(cle(d.formateur_id, d.date)))
        .map((d) => d.id),
    )
    const idsASupprimer = (deplacementsExistants || [])
      .filter((d) => !idsAConserver.has(d.id))
      .map((d) => d.id)
    if (idsASupprimer.length > 0) {
      await supabase.from('creneaux').delete().in('id', idsASupprimer)
    }
    if (nouveauxDeplacements.length > 0) {
      await supabase.from('creneaux').insert(nouveauxDeplacements)
    }
  }

  async function rafraichirDeplacements(scenarioIdCible) {
    const { data } = await supabase
      .from('creneaux')
      .select('id, type, date, heure_debut, heure_fin, formateur_id, demande_ligne_id, demande_lignes(groupe, formations_catalogue(nom, code))')
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
    setConfirmerRegeneration(false)
    setBlocEnConfirmation('')
    const { data } = await supabase
      .from('creneaux')
      .select('id, type, date, heure_debut, heure_fin, formateur_id, demande_ligne_id, demande_lignes(groupe, formations_catalogue(nom, code))')
      .eq('scenario_id', id)
      .order('date')
    setCreneaux(data || [])
  }

  // Écrase entièrement le scénario en cours et le régénère avec les règles les plus récentes.
  // Contrairement à la génération automatique (qui n'a lieu qu'à la toute première ouverture),
  // ce bouton force le recalcul même si le scénario existe déjà et a été modifié manuellement.
  async function regenererPlanningComplet() {
    if (!confirmerRegeneration) {
      setConfirmerRegeneration(true)
      return
    }
    setConfirmerRegeneration(false)
    setMessage('')
    setSucces('')
    await supabase.from('creneaux').delete().eq('scenario_id', scenarioId)
    await genererPlanningParDefaut(demandeId, scenarioId, lignes)
    await chargerScenario(scenarioId)
    setSucces('Planning régénéré avec les règles actuelles.')
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
    await synchroniserDeplacements(scenarioId, demandeId)
    await chargerScenario(scenarioId)
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
      .update({
        date: nouvelleDate,
        heure_debut: nouvelleHeureDebut,
        heure_fin: nouvelleHeureFin,
        ...(creneau.type === 'deplacement' ? { modifie_manuellement: true } : {}),
      })
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

    await supabase
      .from('creneaux')
      .update({
        heure_fin: nouvelleHeureFin,
        ...(creneau.type === 'deplacement' ? { modifie_manuellement: true } : {}),
      })
      .eq('id', creneau.id)
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

  // Glisser/redimensionner maison (aucune bibliothèque tierce) : la position pendant le geste est
  // appliquée directement sur le DOM via une ref, sans passer par React — donc parfaitement fluide
  // et sans aucun décalage possible avec la souris. On ne recalcule/persiste qu'au relâchement.
  function demarrerGlisser(e, c, pos) {
    if (e.target.closest('.planning-bloc-select, .planning-bloc-supprimer, .planning-bloc-poignee')) return
    e.preventDefault()
    const node = blocRefs.current[c.id]
    const startX = e.clientX
    const startY = e.clientY
    let dx = 0
    let dy = 0

    function onMove(ev) {
      dx = ev.clientX - startX
      dy = ev.clientY - startY
      if (node) node.style.transform = `translate(${dx}px, ${dy}px)`
    }
    async function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (node) node.style.transform = ''
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        await deplacerBloc(c, pos.x + dx, pos.y + dy)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function demarrerRedimensionner(e, c, pos) {
    e.stopPropagation()
    e.preventDefault()
    const node = blocRefs.current[c.id]
    const startY = e.clientY
    let hauteur = pos.height

    function onMove(ev) {
      hauteur = Math.max(HOUR_HEIGHT / 2, pos.height + (ev.clientY - startY))
      if (node) node.style.height = `${hauteur}px`
      setRedimensionnementEnCours({ id: c.id, heureFin: heureFinDurantRedimensionnement(c, hauteur) })
    }
    async function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setRedimensionnementEnCours(null)
      await redimensionnerBloc(c, hauteur)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
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

  if (!demandeId) {
    return (
      <div className="page page-large">
        <h1>Planning</h1>
        <p>Aucun projet actif. Créez ou reprenez une demande depuis « Expression de besoin ».</p>
      </div>
    )
  }

  return (
    <div className="page page-large">
      <h1>Planning — {clientNom}</h1>

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
            <button
              type="button"
              onClick={regenererPlanningComplet}
              disabled={!scenarioId}
              className={confirmerRegeneration ? 'bouton-danger' : ''}
              title="Efface et recalcule tout le planning de ce scénario avec les règles actuelles"
            >
              {confirmerRegeneration ? 'Confirmer : tout écraser et régénérer ?' : 'Régénérer le planning'}
            </button>
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
            {Object.values(
              lignes.reduce((acc, l) => {
                if (l.formation_id && !acc[l.formation_id]) acc[l.formation_id] = l
                return acc
              }, {}),
            ).map((l) => (
              <span key={l.formation_id} className="legende-item">
                <span
                  className="legende-pastille"
                  style={{ background: formationCouleur(l.formations_catalogue?.code) }}
                />
                {l.formations_catalogue?.nom}
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
                const estFormation = c.type === 'formation'
                const couleur = estFormation ? formationCouleur(c.demande_lignes?.formations_catalogue?.code) : '#888'
                return (
                  <div
                    key={c.id}
                    ref={(node) => {
                      blocRefs.current[c.id] = node
                    }}
                    className={`planning-bloc ${c.type}`}
                    style={{
                      position: 'absolute',
                      left: pos.x,
                      top: pos.y,
                      width: pos.width,
                      height: pos.height,
                      ...(estFormation ? { background: couleur } : { borderColor: couleur }),
                    }}
                    onMouseDown={(e) => demarrerGlisser(e, c, pos)}
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
                        <div
                          className="planning-bloc-titre"
                          title={`${c.demande_lignes?.formations_catalogue?.nom || ''}${c.demande_lignes?.groupe ? ` (Groupe ${c.demande_lignes.groupe})` : ''}`}
                        >
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
                        <div className="planning-bloc-titre">Déplacement — {nomFormateur(c.formateur_id)}</div>
                        <div className="planning-bloc-heures">
                          {c.heure_debut.slice(0, 5)}–
                          {(redimensionnementEnCours?.id === c.id
                            ? redimensionnementEnCours.heureFin
                            : c.heure_fin
                          ).slice(0, 5)}
                        </div>
                      </>
                    )}
                    <div
                      className="planning-bloc-poignee"
                      onMouseDown={(e) => demarrerRedimensionner(e, c, pos)}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
