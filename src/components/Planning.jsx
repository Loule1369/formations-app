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

  const [message, setMessage] = useState('')
  const [succes, setSucces] = useState('')
  const [confirmerSuppressionScenario, setConfirmerSuppressionScenario] = useState(false)
  const [confirmerRegeneration, setConfirmerRegeneration] = useState(false)
  const [redimensionnementEnCours, setRedimensionnementEnCours] = useState(null)
  const [blocSelectionneId, setBlocSelectionneId] = useState('')
  const [menuContextuel, setMenuContextuel] = useState(null) // { x, y, creneau }
  const [modaleParticipants, setModaleParticipants] = useState(null) // { ligneId, valeur }
  const [modaleFormateur, setModaleFormateur] = useState(null) // { creneau, valeur }
  const blocRefs = useRef({})
  const blocCopieRef = useRef(null)
  const pileUndoRef = useRef([]) // pile de snapshots de `creneaux` avant chaque action, pour Ctrl+Z
  const MAX_UNDO = 20

  // À appeler AVANT toute mutation des créneaux (suppression, duplication, déplacement, redimensionnement,
  // changement de formateur...) pour pouvoir y revenir avec Ctrl+Z. Ne couvre que les blocs du scénario en
  // cours — pas les opérations sur les scénarios eux-mêmes (dupliquer/supprimer/retenir un scénario).
  function empilerUndo() {
    pileUndoRef.current.push(creneaux)
    if (pileUndoRef.current.length > MAX_UNDO) pileUndoRef.current.shift()
  }

  // Réconcilie la base avec un snapshot : supprime ce qui a été ajouté depuis, remet à jour ce qui a
  // changé (upsert par id), sans toucher aux autres scénarios.
  async function restaurerCreneaux(snapshot) {
    const idsSnapshot = new Set(snapshot.map((c) => c.id))
    const idsASupprimer = creneaux.filter((c) => !idsSnapshot.has(c.id)).map((c) => c.id)
    if (idsASupprimer.length > 0) {
      await supabase.from('creneaux').delete().in('id', idsASupprimer)
    }
    if (snapshot.length > 0) {
      await supabase.from('creneaux').upsert(
        snapshot.map((c) => ({
          id: c.id,
          demande_id: demandeId,
          demande_ligne_id: c.demande_ligne_id,
          scenario_id: scenarioId,
          formateur_id: c.formateur_id,
          type: c.type,
          date: c.date,
          heure_debut: c.heure_debut,
          heure_fin: c.heure_fin,
          modifie_manuellement: c.modifie_manuellement || false,
        })),
      )
    }
    setCreneaux(snapshot)
    if (idsSnapshot.has(blocSelectionneId)) {
      // le bloc sélectionné existe toujours dans le snapshot, on le garde sélectionné
    } else {
      setBlocSelectionneId('')
    }
  }

  async function annulerDerniereAction() {
    const snapshot = pileUndoRef.current.pop()
    if (!snapshot) {
      setMessage('Rien à annuler.')
      return
    }
    setMessage('')
    setSucces('')
    await restaurerCreneaux(snapshot)
    setSucces('Dernière action annulée (Ctrl+Z).')
  }

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
    return parseDate(min)
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

  // Un clic simple (sans glisser) sélectionne un bloc : Ctrl+C le copie, Ctrl+V le colle
  // (dupliqué le lendemain, à glisser ensuite où besoin), Suppr/Retour arrière le supprime.
  useEffect(() => {
    function surTouche(e) {
      if (e.key === 'Escape') {
        setMenuContextuel(null)
        setModaleParticipants(null)
        return
      }
      const balise = document.activeElement?.tagName
      if (balise === 'INPUT' || balise === 'SELECT' || balise === 'TEXTAREA') return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (blocSelectionneId) {
          e.preventDefault()
          supprimerBloc(blocSelectionneId)
        }
        return
      }
      if (!(e.ctrlKey || e.metaKey)) return
      const touche = e.key.toLowerCase()
      if (touche === 'c') {
        const bloc = creneaux.find((c) => c.id === blocSelectionneId)
        if (bloc) {
          e.preventDefault()
          blocCopieRef.current = bloc
          setSucces('Bloc copié — Ctrl+V pour le coller.')
        }
      } else if (touche === 'v' && blocCopieRef.current) {
        e.preventDefault()
        dupliquerBloc(blocCopieRef.current)
      } else if (touche === 'z') {
        e.preventDefault()
        annulerDerniereAction()
      }
    }
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [creneaux, blocSelectionneId, scenarioId, demandeId])

  // Ferme le menu contextuel dès qu'on clique ailleurs (le menu lui-même arrête la propagation).
  useEffect(() => {
    if (!menuContextuel) return
    function fermer() {
      setMenuContextuel(null)
    }
    window.addEventListener('mousedown', fermer)
    window.addEventListener('contextmenu', fermer)
    return () => {
      window.removeEventListener('mousedown', fermer)
      window.removeEventListener('contextmenu', fermer)
    }
  }, [menuContextuel])

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

  // Nombre de jours nécessaires pour une formation de "dureeTotale" heures démarrant à "jourDepart",
  // en tenant compte du plafond réduit d'un 1er jour qui démarre l'après-midi (lundi = arrivée le
  // matin, ou enchaînement direct sur l'après-midi d'un jour déjà bien entamé par une autre formation).
  function calculerJoursNecessaires(dureeTotale, premierJourApresMidi) {
    if (premierJourApresMidi) {
      const reste = Math.max(0, dureeTotale - MAX_DUREE_DEMARRAGE_APRES_MIDI)
      return 1 + Math.ceil(reste / MAX_DUREE_JOUR)
    }
    return Math.max(1, Math.ceil(dureeTotale / MAX_DUREE_JOUR))
  }

  // Répartit la durée totale en remplissant chaque jour au maximum (plutôt qu'en la divisant à parts
  // égales) : le reliquat atterrit entièrement sur le DERNIER jour, en un seul bloc. Combiné à
  // heureDebutPourJour (qui cale un reliquat court contre la pause déjeuner), ça évite d'éparpiller
  // une formation en petits bouts d'après-midi sur plusieurs jours différents — un seul jour "plus
  // léger" à la fin plutôt que plusieurs journées coupées de la même façon.
  function repartirDureeParJour(jourDepart, dureeTotale, n, premierJourApresMidi) {
    const jours = []
    let d = new Date(jourDepart)
    let dureeRestante = dureeTotale
    for (let i = 0; i < n; i++) {
      const plafond = i === 0 && premierJourApresMidi ? MAX_DUREE_DEMARRAGE_APRES_MIDI : MAX_DUREE_JOUR
      const dureeJour = Math.min(dureeRestante, plafond)
      jours.push({ date: new Date(d), duree: dureeJour })
      dureeRestante -= dureeJour
      if (i < n - 1) d = jourOuvreSuivant(d)
    }
    return jours
  }

  // Heure de démarrage d'un jour "normal" (ni lundi, ni enchaînement forcé l'après-midi) : un bloc
  // court qui tient dans la matinée (≤ 4h) se cale contre la pause déjeuner pour finir à 12h pile —
  // un point d'arrêt net — plutôt que de démarrer dès 8h et laisser l'après-midi mort.
  function heureDebutPourJour(duree) {
    if (duree <= PAUSE_DEJEUNER_DEBUT - HEURE_DEBUT_JOUR) {
      return PAUSE_DEJEUNER_DEBUT - duree
    }
    return HEURE_DEBUT_JOUR
  }

  // Génère le planning par défaut : chaque formation reste groupée sur des jours consécutifs sans
  // traverser un week-end (repoussée au lundi suivant si besoin) et remplit chaque jour au maximum
  // (le reliquat, s'il y en a un, forme un seul bloc net sur le dernier jour). On n'enchaîne jamais 2
  // formations (même groupe ou pas) au sein d'une même demi-journée — mais si la matinée d'un jour est
  // déjà entièrement prise par la FIN d'une formation, la formation suivante peut démarrer sur
  // l'après-midi COMPLÈTE de ce même jour plutôt que de perdre une demi-journée : chaque groupe garde
  // sa demi-journée pleine et dédiée, ce qui reste cohérent avec des équipes postées (une équipe le
  // matin, une autre l'après-midi), sans jamais les mélanger sur le même créneau.
  async function genererPlanningParDefaut(demandeIdCible, scenarioIdCible, lignesData) {
    if (!lignesData || lignesData.length === 0 || formateurs.length === 0) return
    let jourCourant = null
    let finJourCourant = null
    const blocs = []

    for (const ligne of lignesData) {
      const formateur = trouverFormateurPourCode(ligne.formations_catalogue?.code)
      const dureeTotale = ligne.formations_catalogue?.duree_h || 4

      let jourDepart
      let heureDebutForcee = null
      if (jourCourant === null) {
        jourDepart = prochainLundi(new Date(new Date().toDateString()))
      } else if (finJourCourant !== null && finJourCourant <= PAUSE_DEJEUNER_DEBUT) {
        jourDepart = jourCourant
        heureDebutForcee = PAUSE_DEJEUNER_FIN
      } else {
        jourDepart = jourOuvreSuivant(jourCourant)
      }
      let premierJourApresMidi = jourDepart.getDay() === 1 || heureDebutForcee !== null

      // Si la formation tient dans une journée normale (≤ MAX_DUREE_JOUR) mais que la capacité réduite
      // du 1er jour (lundi réservé à l'arrivée) est trop courte pour l'accueillir en entier, mieux vaut
      // décaler tout le bloc au lendemain que de le couper en 2 jours avec un petit reliquat.
      if (
        heureDebutForcee === null &&
        jourDepart.getDay() === 1 &&
        dureeTotale > MAX_DUREE_DEMARRAGE_APRES_MIDI &&
        dureeTotale <= MAX_DUREE_JOUR
      ) {
        jourDepart = jourOuvreSuivant(jourDepart)
        premierJourApresMidi = false
      }

      let n = calculerJoursNecessaires(dureeTotale, premierJourApresMidi)
      if (heureDebutForcee === null && jourDepart.getDay() + (n - 1) > 5) {
        // Traverserait le week-end : on préfère démarrer la semaine suivante plutôt que de couper
        // la formation par deux jours de coupure.
        jourDepart = prochainLundi(jourDepart)
        premierJourApresMidi = true
        n = calculerJoursNecessaires(dureeTotale, premierJourApresMidi)
      }

      const jours = repartirDureeParJour(jourDepart, dureeTotale, n, premierJourApresMidi)
      jours.forEach(({ date, duree }, index) => {
        const heureDebutJour =
          index === 0 && heureDebutForcee !== null
            ? heureDebutForcee
            : date.getDay() === 1
              ? HEURE_DEBUT_LUNDI
              : heureDebutPourJour(duree)
        const segments = decouperAvecPauseDejeuner(heureDebutJour, duree)
        for (const segment of segments) {
          blocs.push({
            demande_id: demandeIdCible,
            demande_ligne_id: ligne.id,
            scenario_id: scenarioIdCible,
            formateur_id: formateur.id,
            type: 'formation',
            date: formatDate(date),
            heure_debut: decimalEnHeure(segment.heure_debut),
            heure_fin: decimalEnHeure(segment.heure_fin),
          })
        }
        if (index === jours.length - 1) {
          finJourCourant = segments[segments.length - 1].heure_fin
        }
      })
      jourCourant = jours[jours.length - 1].date
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
    // Ne vide la pile d'annulation que si on change réellement de scénario — un rechargement du même
    // scénario (ex. après "Régénérer le planning") ne doit pas empêcher d'annuler ce qui vient d'être fait.
    if (id !== scenarioId) pileUndoRef.current = []
    setScenarioId(id)
    setNomCopie('')
    setConfirmerSuppressionScenario(false)
    setConfirmerRegeneration(false)
    setBlocSelectionneId('')
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
    empilerUndo()
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

  async function supprimerBloc(id) {
    empilerUndo()
    if (blocSelectionneId === id) setBlocSelectionneId('')
    // Retire le bloc de l'état local tout de suite : sans ça, seuls les blocs "Déplacement" sont
    // rafraîchis par finaliserMutation, et le bloc supprimé (une formation) restait affiché à l'écran
    // bien qu'il soit déjà effacé en base — donnant l'impression que la suppression ne fonctionnait pas.
    setCreneaux((prev) => prev.filter((c) => c.id !== id))
    await supabase.from('creneaux').delete().eq('id', id)
    await finaliserMutation()
  }

  // Duplique un bloc (formation ou déplacement) le jour suivant, à glisser ensuite où besoin.
  async function dupliquerBloc(creneau) {
    empilerUndo()
    setMessage('')
    setSucces('')
    const indexActuel = jours.findIndex((j) => formatDate(j) === creneau.date)
    const nouvelleDate = formatDate(jours[Math.min(indexActuel + 1, DAYS_SHOWN - 1)])
    const { error } = await supabase.from('creneaux').insert({
      demande_id: demandeId,
      demande_ligne_id: creneau.demande_ligne_id,
      scenario_id: scenarioId,
      formateur_id: creneau.formateur_id,
      type: creneau.type,
      date: nouvelleDate,
      heure_debut: creneau.heure_debut,
      heure_fin: creneau.heure_fin,
      modifie_manuellement: creneau.type === 'deplacement',
    })
    if (error) {
      setMessage(error.message)
      return
    }
    if (creneau.type === 'formation') {
      await synchroniserDeplacements(scenarioId, demandeId)
    }
    await chargerScenario(scenarioId)
  }

  // Supprime TOUS les blocs d'une même formation (tous les jours d'un même groupe), pas juste celui
  // sur lequel on a cliqué.
  async function supprimerFormation(demandeLigneId) {
    if (!demandeLigneId) return
    const idsASupprimer = creneaux.filter((c) => c.demande_ligne_id === demandeLigneId).map((c) => c.id)
    if (idsASupprimer.length === 0) return
    empilerUndo()
    if (idsASupprimer.includes(blocSelectionneId)) setBlocSelectionneId('')
    setCreneaux((prev) => prev.filter((c) => !idsASupprimer.includes(c.id)))
    await supabase.from('creneaux').delete().in('id', idsASupprimer)
    await finaliserMutation()
    setSucces('Formation supprimée.')
  }

  // Duplique tous les blocs d'une même formation (tous les jours d'un même groupe) d'un coup, en
  // conservant les écarts entre jours d'origine, positionnés juste après le dernier jour existant.
  async function dupliquerFormationEntiere(creneau) {
    if (!creneau.demande_ligne_id) return
    setMessage('')
    setSucces('')
    const blocsFormation = creneaux.filter((c) => c.demande_ligne_id === creneau.demande_ligne_id)
    if (blocsFormation.length === 0) return
    empilerUndo()

    const datesTriees = [...new Set(blocsFormation.map((b) => b.date))].sort()
    const mappingDates = {}
    let curseur = jourOuvreSuivant(parseDate(datesTriees[datesTriees.length - 1]))
    for (const d of datesTriees) {
      mappingDates[d] = formatDate(curseur)
      curseur = jourOuvreSuivant(curseur)
    }

    const { error } = await supabase.from('creneaux').insert(
      blocsFormation.map((c) => ({
        demande_id: demandeId,
        demande_ligne_id: c.demande_ligne_id,
        scenario_id: scenarioId,
        formateur_id: c.formateur_id,
        type: c.type,
        date: mappingDates[c.date],
        heure_debut: c.heure_debut,
        heure_fin: c.heure_fin,
      })),
    )
    if (error) {
      setMessage(error.message)
      return
    }
    await synchroniserDeplacements(scenarioId, demandeId)
    await chargerScenario(scenarioId)
    setSucces(`Formation dupliquée sur ${datesTriees.length} jour(s), à partir du ${mappingDates[datesTriees[0]]}.`)
  }

  // Change le formateur d'un créneau : pour une formation, s'applique à tous les blocs de la même
  // formation (comme le menu déroulant déjà présent sur le bloc) ; pour un déplacement, seulement ce
  // bloc-là (marqué comme modifié à la main pour ne pas être écrasé par la prochaine synchronisation).
  async function changerFormateurCreneau(creneau, nouveauFormateurId) {
    if (creneau.type === 'formation') {
      await changerFormateurBloc(creneau, nouveauFormateurId)
      return
    }
    const conflit = await conflitAvecPlanningsRetenus(
      nouveauFormateurId,
      creneau.date,
      creneau.heure_debut,
      creneau.heure_fin,
      creneau.id,
    )
    if (conflit) {
      setMessage(conflit)
      return
    }
    empilerUndo()
    setMessage('')
    setCreneaux((prev) =>
      prev.map((c) => (c.id === creneau.id ? { ...c, formateur_id: nouveauFormateurId } : c)),
    )
    await supabase
      .from('creneaux')
      .update({ formateur_id: nouveauFormateurId, modifie_manuellement: true })
      .eq('id', creneau.id)
  }

  async function enregistrerFormateur() {
    if (!modaleFormateur) return
    await changerFormateurCreneau(modaleFormateur.creneau, modaleFormateur.valeur)
    setModaleFormateur(null)
  }

  async function enregistrerParticipants() {
    if (!modaleParticipants) return
    const { ligneId, valeur } = modaleParticipants
    const nb = Math.max(1, Number(valeur) || 1)
    const { error } = await supabase.from('demande_lignes').update({ nb_participants: nb }).eq('id', ligneId)
    if (error) {
      setMessage(error.message)
      return
    }
    setLignes((prev) => prev.map((l) => (l.id === ligneId ? { ...l, nb_participants: nb } : l)))
    setModaleParticipants(null)
    setSucces('Nombre de participants enregistré.')
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

    empilerUndo()
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

    empilerUndo()
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

    empilerUndo()
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
    // Seul le clic GAUCHE démarre un glisser. Sans cette garde, le clic droit déclenchait aussi
    // preventDefault() ici, ce qui annule l'événement "contextmenu" natif dans certains navigateurs
    // (Firefox notamment) — le menu contextuel ne s'ouvrait donc jamais.
    if (e.button !== 0) return
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
      } else {
        // Simple clic (sans glisser) : sélectionne le bloc, prêt pour Ctrl+C / Ctrl+V.
        setBlocSelectionneId(c.id)
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
            Clic droit sur un bloc pour supprimer/dupliquer la formation entière, changer le formateur ou renseigner les participants. Ctrl+Z annule la dernière action (déplacement, suppression, duplication...).
            Les blocs « Déplacement » (gris, avant/après chaque mission) sont recalculés automatiquement, vous n'avez pas à les toucher.
          </p>

          <div className="planning-scroll">
            <div
              className="planning-inner"
              style={{
                width: LEFT_COL_WIDTH + DAYS_SHOWN * DAY_WIDTH,
                height: HEADER_HEIGHT + COL_HEIGHT,
              }}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setBlocSelectionneId('')
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
                    className={`planning-bloc ${c.type}${blocSelectionneId === c.id ? ' selectionne' : ''}`}
                    style={{
                      position: 'absolute',
                      left: pos.x,
                      top: pos.y,
                      width: pos.width,
                      height: pos.height,
                      ...(estFormation ? { background: couleur } : { borderColor: couleur }),
                    }}
                    onMouseDown={(e) => demarrerGlisser(e, c, pos)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setBlocSelectionneId(c.id)
                      setMenuContextuel({ x: e.clientX, y: e.clientY, creneau: c })
                    }}
                  >
                    {estFormation && (
                      <button
                        className="planning-bloc-supprimer"
                        onClick={() => supprimerBloc(c.id)}
                        title="Retirer ce bloc"
                      >
                        ×
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
                          {' · '}
                          {nomFormateur(c.formateur_id)}
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

          {menuContextuel && (
            <div
              className="menu-contextuel"
              style={{ left: menuContextuel.x, top: menuContextuel.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button type="button" onClick={() => { supprimerBloc(menuContextuel.creneau.id); setMenuContextuel(null) }}>
                Supprimer le bloc
              </button>
              {menuContextuel.creneau.type === 'formation' && (
                <button
                  type="button"
                  onClick={() => { supprimerFormation(menuContextuel.creneau.demande_ligne_id); setMenuContextuel(null) }}
                >
                  Supprimer la formation
                </button>
              )}
              <button type="button" onClick={() => { dupliquerBloc(menuContextuel.creneau); setMenuContextuel(null) }}>
                Dupliquer le bloc
              </button>
              {menuContextuel.creneau.type === 'formation' && (
                <button
                  type="button"
                  onClick={() => { dupliquerFormationEntiere(menuContextuel.creneau); setMenuContextuel(null) }}
                >
                  Dupliquer la formation
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setModaleFormateur({ creneau: menuContextuel.creneau, valeur: menuContextuel.creneau.formateur_id })
                  setMenuContextuel(null)
                }}
              >
                Changer le formateur
              </button>
              {menuContextuel.creneau.type === 'formation' && (
                <button
                  type="button"
                  onClick={() => {
                    const ligne = lignes.find((l) => l.id === menuContextuel.creneau.demande_ligne_id)
                    setModaleParticipants({
                      ligneId: menuContextuel.creneau.demande_ligne_id,
                      valeur: ligne?.nb_participants || 1,
                    })
                    setMenuContextuel(null)
                  }}
                >
                  Renseigner les participants
                </button>
              )}
            </div>
          )}

          {modaleParticipants && (
            <div className="modale-fond" onMouseDown={() => setModaleParticipants(null)}>
              <div className="modale-contenu" onMouseDown={(e) => e.stopPropagation()}>
                <h3>Nombre de participants</h3>
                <input
                  type="number"
                  min="1"
                  value={modaleParticipants.valeur}
                  onChange={(e) => setModaleParticipants((prev) => ({ ...prev, valeur: e.target.value }))}
                  autoFocus
                />
                <div className="modale-actions">
                  <button type="button" onClick={() => setModaleParticipants(null)}>Annuler</button>
                  <button type="button" onClick={enregistrerParticipants}>Enregistrer</button>
                </div>
              </div>
            </div>
          )}

          {modaleFormateur && (
            <div className="modale-fond" onMouseDown={() => setModaleFormateur(null)}>
              <div className="modale-contenu" onMouseDown={(e) => e.stopPropagation()}>
                <h3>Changer le formateur</h3>
                <select
                  value={modaleFormateur.valeur}
                  onChange={(e) => setModaleFormateur((prev) => ({ ...prev, valeur: e.target.value }))}
                  autoFocus
                >
                  {formateurs.map((f) => (
                    <option key={f.id} value={f.id}>{f.nom}</option>
                  ))}
                </select>
                <div className="modale-actions">
                  <button type="button" onClick={() => setModaleFormateur(null)}>Annuler</button>
                  <button type="button" onClick={enregistrerFormateur}>Enregistrer</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
