import { Fragment, useEffect, useState } from 'react'
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
const TARIF_JOUR_ANIMATION_PV = 1200
const TARIF_JOUR_PREP_PV = 920
const TARIF_JOUR_PV_PR = 637.44 // même coût de revient journalier, que ce soit animation ou préparation

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

// Conversion heures → jours pour le chiffrage : un palier par demi-journée de 4h, arrondi au-dessus
// (6h/7h/8h = 1 jour, 9-12h = 1,5 jour, 13-16h = 2 jours...).
function heuresEnJours(heures) {
  return Math.ceil(heures / 4) * 0.5
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
  return {
    libelle: categorie === 'ascentline' ? 'Nombre de licences Ascentline' : 'Nouvelle ligne',
    quantite: 1,
    prix_unitaire: 0,
    prix_revient: 0,
    origine: null,
    categorie,
    commentaires: '',
  }
}

// FORDOC (sous-traitant) toujours en tête des frais de déplacement, les services internes ensuite.
function comparerLignesDeplacement(a, b) {
  const aFordoc = a.libelle.includes('FORDOC') ? 0 : 1
  const bFordoc = b.libelle.includes('FORDOC') ? 0 : 1
  if (aFordoc !== bFordoc) return aFordoc - bFordoc
  return a.libelle.localeCompare(b.libelle)
}

// Modules e-learning du catalogue de référence (aucune heure/jour associé : contenu autonome, tarif
// à saisir manuellement) — juste une liste pour aller plus vite, pas de lien avec le Planning.
const MODULES_ELEARNING = [
  "CONVOYEURS INTELIS : Comprendre le fonctionnement (e-learning)",
  "XPTS : Comprendre le fonctionnement (e-learning)",
  "JIVARO : S'approprier le fonctionnement (e-learning)",
  'ODATIO WMS : Ergonomie (e-learning)',
  'ODATIO WMS : Règles métier (e-learning)',
  'HYPERVISION : Piloter les flux (e-learning)',
  "Les coulisses d'un entrepôt : Découvrir les flux logistiques (e-learning)",
  'Former vos équipes : Les bases de la pédagogie (e-learning)',
  'XPTS : Intervenir en sécurité (e-learning)',
  'Designer de documents (LM Report) (e-learning)',
  'BO : Prise en main (e-learning)',
  "CONSOMMABLES : Comprendre le système d'encollage (e-learning)",
]

export default function Chiffrage() {
  const { demandeId, clientNom } = useProjetActif()
  const [scenarios, setScenarios] = useState([])
  const [scenarioId, setScenarioId] = useState('')
  const [lignes, setLignes] = useState([])
  const [formateurs, setFormateurs] = useState([])
  const [catalogue, setCatalogue] = useState([])
  const [resume, setResume] = useState(null)

  const [message, setMessage] = useState('')
  const [succes, setSucces] = useState('')
  const [generation, setGeneration] = useState(false)
  const [confirmerReinitialisation, setConfirmerReinitialisation] = useState(false)

  useEffect(() => {
    supabase
      .from('formateurs')
      .select('id, nom, service')
      .then(({ data }) => data && setFormateurs(data))
    supabase
      .from('formations_catalogue')
      .select('id, nom, jours_animation_catalogue, jours_preparation_catalogue')
      .order('nom')
      .then(({ data }) => data && setCatalogue(data))
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
    chargerResume()
  }, [scenarioId])

  // Dès qu'un scénario est sélectionné, on resynchronise automatiquement les lignes générées depuis le
  // planning (formations + déplacement) — pas besoin de cliquer le bouton à chaque ouverture. Ça évite
  // qu'une formation supprimée dans le Planning continue d'apparaître ici tant qu'on n'a pas pensé à
  // régénérer manuellement. Les lignes touchées à la main (badge Manuel) ne sont jamais concernées.
  useEffect(() => {
    if (!scenarioId || formateurs.length === 0) return
    genererDepuisPlanning()
  }, [scenarioId, formateurs.length])

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

  async function chargerResume() {
    const { data } = await supabase
      .from('demandes')
      .select('remise_pv, arrondi_pv, arrondi_pr')
      .eq('id', demandeId)
      .single()
    setResume({
      remisePv: data?.remise_pv || 0, // pourcentage de remise (pas un montant)
      arrondiPv: data?.arrondi_pv || 0,
      arrondiPr: data?.arrondi_pr || 0,
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
          'type, date, heure_debut, heure_fin, formateur_id, demande_ligne_id, demande_lignes(formation_id, groupe, formations_catalogue(nom, jours_animation_catalogue, jours_preparation_catalogue))',
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
      // Heures RÉELLEMENT posées dans le planning (tous groupes confondus) par formation — si le chef
      // de projet a raccourci/allongé des blocs à la main, le chiffrage doit suivre, pas rester figé sur
      // la durée du catalogue.
      const heuresReellesParFormation = {}
      for (const c of formations) {
        const formationId = c.demande_lignes?.formation_id
        if (!formationId) continue
        heuresReellesParFormation[formationId] =
          (heuresReellesParFormation[formationId] || 0) + dureeHeures(c.heure_debut, c.heure_fin)
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
      // Une formation déjà représentée par une ligne Manuel (touchée à la main, ou ajoutée depuis le
      // catalogue avant même d'être planifiée) ne doit pas EN PLUS recevoir sa propre ligne générée
      // automatiquement — sinon la même formation apparaît sur 2 lignes.
      const formationIdsManuels = new Set(
        lignes
          .filter((l) => l.categorie === 'formation' && l.origine !== 'planning' && l.formation_id)
          .map((l) => l.formation_id),
      )

      const lignesFormations = []
      for (const [formationId, { catalogue: cat, nbGroupes }] of Object.entries(parFormationId)) {
        if (!cat) continue
        if (formationIdsManuels.has(formationId)) continue
        const joursPrep = cat.jours_preparation_catalogue || 0
        // Jours d'animation calculés depuis les heures RÉELLES du planning (tous groupes confondus),
        // pas depuis la valeur figée du catalogue — sinon raccourcir un bloc dans le planning n'a
        // jamais aucun effet sur le chiffrage. Repli sur le catalogue si la formation n'est pas encore
        // planifiée (ex. ajoutée à la main dans le chiffrage sans bloc dans le planning).
        const heuresReelles = heuresReellesParFormation[formationId] || 0
        const joursAnimTotal =
          heuresReelles > 0 ? heuresEnJours(heuresReelles) : arrondi2((cat.jours_animation_catalogue || 0) * nbGroupes)
        const joursAnimUnitaire = nbGroupes > 0 ? arrondi2(joursAnimTotal / nbGroupes) : joursAnimTotal
        const joursTotal = arrondi2(joursPrep + joursAnimTotal)
        lignesFormations.push({
          demande_id: demandeId,
          libelle: cat.nom,
          quantite: 1,
          jours_preparation: joursPrep,
          nb_groupes: nbGroupes,
          jours_animation_unitaire: joursAnimUnitaire,
          prix_unitaire: arrondi2(joursPrep * TARIF_JOUR_PREP_PV + joursAnimTotal * TARIF_JOUR_ANIMATION_PV),
          prix_revient: arrondi2(joursTotal * TARIF_JOUR_PV_PR),
          origine: 'planning',
          categorie: 'formation',
          formation_id: formationId,
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

  // Contrairement au bouton normal (qui protège les lignes touchées à la main, marquées "Manuel"),
  // celui-ci efface VRAIMENT tout (formations + déplacement, y compris les lignes modifiées) avant de
  // régénérer — utile après avoir régénéré le planning pour repartir d'une feuille blanche en test.
  async function reinitialiserCompletement() {
    if (!scenarioId) return
    if (!confirmerReinitialisation) {
      setConfirmerReinitialisation(true)
      return
    }
    setConfirmerReinitialisation(false)
    await supabase.from('devis_lignes').delete().eq('demande_id', demandeId).in('categorie', ['formation', 'deplacement'])
    await genererDepuisPlanning()
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

  // Ajoute une formation choisie dans le catalogue (jours prépa/animation pré-remplis depuis l'Excel
  // de référence), ou une ligne texte libre si aucune formation du catalogue ne correspond.
  async function ajouterFormationCatalogue(catalogueId) {
    if (!catalogueId) return
    if (catalogueId === 'libre') {
      await ajouterLigneLibre('formation')
      return
    }
    const cat = catalogue.find((f) => f.id === catalogueId)
    if (!cat) return
    const joursPrep = cat.jours_preparation_catalogue || 0
    const joursAnim = cat.jours_animation_catalogue || 0
    const { data, error } = await supabase
      .from('devis_lignes')
      .insert({
        demande_id: demandeId,
        categorie: 'formation',
        libelle: cat.nom,
        quantite: 1,
        jours_preparation: joursPrep,
        nb_groupes: 1,
        jours_animation_unitaire: joursAnim,
        prix_unitaire: arrondi2(joursPrep * TARIF_JOUR_PREP_PV + joursAnim * TARIF_JOUR_ANIMATION_PV),
        prix_revient: arrondi2((joursPrep + joursAnim) * TARIF_JOUR_PV_PR),
        origine: null,
        formation_id: cat.id,
      })
      .select('*')
      .single()
    if (error) {
      setMessage(error.message)
      return
    }
    setLignes((prev) => [...prev, data])
  }

  // Ajoute un module e-learning choisi dans la liste de référence (tarif à saisir à la main, aucune
  // heure/jour associé), ou une ligne texte libre.
  async function ajouterLigneElearning(nom) {
    if (!nom) return
    if (nom === 'libre') {
      await ajouterLigneLibre('elearning')
      return
    }
    const { data, error } = await supabase
      .from('devis_lignes')
      .insert({ ...ligneVide('elearning'), libelle: nom, demande_id: demandeId })
      .select('*')
      .single()
    if (error) {
      setMessage(error.message)
      return
    }
    setLignes((prev) => [...prev, data])
  }

  // Toute saisie manuelle (même sur une ligne générée depuis le planning) bascule l'origine sur
  // "Manuel" : le badge Origine doit refléter si la valeur AFFICHÉE vient du planning ou a été touchée
  // à la main, pas seulement comment la ligne a été créée. Ça la protège aussi d'un futur "Régénérer".
  function modifierLigneLocal(id, champ, valeur) {
    setLignes((prev) => prev.map((l) => (l.id === id ? { ...l, [champ]: valeur, origine: null } : l)))
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
        origine: ligne.origine,
      })
      .eq('id', ligne.id)
  }

  async function sauvegarderLigne(id) {
    const ligne = lignes.find((l) => l.id === id)
    if (!ligne) return
    await persisterLigne(ligne)
  }

  // Pour les lignes "Formations" : jours de préparation, jours d'animation (pour 1 seule formation)
  // et nombre de groupes pilotent directement le PV et le PR (comme des formules dans le fichier
  // Excel de référence) — recalculés à chaque saisie. "Jours animation" n'est PAS multiplié par le
  // nombre de groupes dans son propre champ : c'est le total (jours_prep + animation × nb_groupes)
  // qui porte la multiplication, pour que le calcul reste visible.
  function sauvegarderChampFormation(id) {
    setLignes((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l
        const joursPrep = Number(l.jours_preparation) || 0
        const joursAnim = Number(l.jours_animation_unitaire) || 0
        const nbGroupes = Number(l.nb_groupes) || 0
        const joursAnimTotal = joursAnim * nbGroupes
        const joursTotal = joursPrep + joursAnimTotal
        const ligneMaj = {
          ...l,
          prix_unitaire: arrondi2(joursPrep * TARIF_JOUR_PREP_PV + joursAnimTotal * TARIF_JOUR_ANIMATION_PV),
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

  // Déplace une ligne d'un cran (haut/bas) au sein de sa catégorie, en renumérotant tout le groupe
  // (0, 1, 2...) pour un ordre toujours propre, quel que soit l'historique des valeurs précédentes.
  async function deplacerLigne(id, direction) {
    const ligne = lignes.find((l) => l.id === id)
    if (!ligne) return
    const memeCategorie = lignes
      .filter((l) => l.categorie === ligne.categorie)
      .sort(
        (a, b) =>
          (Number(a.ordre) || 0) - (Number(b.ordre) || 0) ||
          (a.created_at || '').localeCompare(b.created_at || ''),
      )
    const index = memeCategorie.findIndex((l) => l.id === id)
    const nouvelIndex = index + direction
    if (nouvelIndex < 0 || nouvelIndex >= memeCategorie.length) return

    const reordonnee = [...memeCategorie]
    ;[reordonnee[index], reordonnee[nouvelIndex]] = [reordonnee[nouvelIndex], reordonnee[index]]
    const nouvelOrdre = new Map(reordonnee.map((l, i) => [l.id, i]))

    setLignes((prev) => prev.map((l) => (nouvelOrdre.has(l.id) ? { ...l, ordre: nouvelOrdre.get(l.id) } : l)))
    await Promise.all(
      [...nouvelOrdre.entries()].map(([ligneId, ordre]) =>
        supabase.from('devis_lignes').update({ ordre }).eq('id', ligneId),
      ),
    )
  }

  function modifierResumeLocal(champ, valeur) {
    setResume((prev) => ({ ...prev, [champ]: valeur }))
  }

  async function sauvegarderRemiseArrondi() {
    // remise_pv stocke le POURCENTAGE de remise (pas un montant) ; remise_pr n'est plus utilisé (la
    // remise ne s'applique qu'au PV) mais reste à 0 pour ne pas laisser une vieille valeur incohérente.
    await supabase
      .from('demandes')
      .update({
        remise_pv: Number(resume?.remisePv) || 0,
        remise_pr: 0,
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
    const joursAnim = (Number(l.jours_animation_unitaire) || 0) * (Number(l.nb_groupes) || 0)
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
    { libelle: 'Formation (animation)', pv: animPv, pr: animPr },
    { libelle: 'Formation (préparation & évaluation)', pv: prepPv, pr: prepPr },
    { libelle: 'Administratif', pv: tAdmin.pv, pr: tAdmin.pr },
    { libelle: 'Modules e-learning', pv: tElearning.pv, pr: tElearning.pr },
    { libelle: 'Licences Ascentline', pv: tAscentline.pv, pr: tAscentline.pr },
    { libelle: 'Frais de déplacement', pv: tDeplacement.pv, pr: tDeplacement.pr },
    { libelle: 'Frais divers', pv: tAutre.pv, pr: tAutre.pr },
  ]
  const sousTotalPv = lignesRecap.reduce((s, l) => s + l.pv, 0)
  const sousTotalPr = lignesRecap.reduce((s, l) => s + l.pr, 0)
  // La remise est un pourcentage appliqué au PV uniquement (le PR/coût de revient ne bouge pas), ce qui
  // fait mécaniquement baisser la marge — comme une vraie remise commerciale.
  const remisePourcentage = Number(resume?.remisePv) || 0
  const remiseMontantPv = arrondi2(sousTotalPv * (remisePourcentage / 100))
  const totalPv = sousTotalPv - remiseMontantPv
  const totalPr = sousTotalPr

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
        <button
          type="button"
          onClick={reinitialiserCompletement}
          disabled={generation || !scenarioId}
          className={confirmerReinitialisation ? 'bouton-danger' : ''}
          title="Efface aussi les lignes Formations/Déplacement modifiées à la main, puis régénère"
        >
          {confirmerReinitialisation ? 'Confirmer : tout effacer (y compris Manuel) ?' : 'Tout réinitialiser'}
        </button>
      </div>
      <p className="astuce">
        « Générer / réinitialiser » (re)calcule les lignes automatiques (formations, nuits, repas,
        heures de déplacement) sans toucher les lignes Formations/Déplacement modifiées à la main
        (badge Manuel) ni les autres catégories (administratif, e-learning, licences Ascentline...).
        « Tout réinitialiser » efface aussi les lignes Manuel des catégories Formations/Déplacement —
        utile après avoir régénéré le planning pour repartir d'une feuille blanche.
      </p>

      {message && <p className="message erreur">{message}</p>}
      {succes && <p className="message succes">{succes}</p>}

      <div className="table-devis-scroll">
        <table className="table-devis">
          <thead>
            <tr>
              <th>Libellé</th>
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
            {CATEGORIES.map((cat) => {
              const lignesCat = lignes.filter((l) => l.categorie === cat)
              // Ordre manuel (boutons ▲▼) prioritaire ; à égalité, FORDOC en tête pour les frais de
              // déplacement, sinon ordre de création.
              lignesCat.sort((a, b) => {
                const diffOrdre = (Number(a.ordre) || 0) - (Number(b.ordre) || 0)
                if (diffOrdre !== 0) return diffOrdre
                if (cat === 'deplacement') return comparerLignesDeplacement(a, b)
                return (a.created_at || '').localeCompare(b.created_at || '')
              })
              const estFormation = cat === 'formation'
              const t = totaux(lignesCat)
              return (
                <Fragment key={cat}>
                  <tr className="ligne-categorie">
                    <td colSpan={11}>{CATEGORIE_LABELS[cat]}</td>
                  </tr>
                  {lignesCat.map((l) => {
                    const joursPrep = Number(l.jours_preparation) || 0
                    const joursAnim = Number(l.jours_animation_unitaire) || 0
                    const nbGroupes = Number(l.nb_groupes) || 0
                    const joursTotal = arrondi2(joursPrep + joursAnim * nbGroupes)
                    const pv = Number(l.prix_unitaire) || 0
                    const pr = Number(l.prix_revient) || 0
                    const totalLignePV = l.categorie === 'formation' ? pv : Number(l.quantite || 0) * pv
                    const totalLignePR = l.categorie === 'formation' ? pr : Number(l.quantite || 0) * pr
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
                        {l.categorie === 'formation' ? (
                          <>
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
                                onBlur={() => sauvegarderChampFormation(l.id)}
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
                          </>
                        ) : (
                          <>
                            <td>
                              <input
                                type="number"
                                min="0"
                                value={l.quantite}
                                onChange={(e) => modifierLigneLocal(l.id, 'quantite', e.target.value)}
                                onBlur={() => sauvegarderLigne(l.id)}
                              />
                            </td>
                            <td>—</td>
                            <td>—</td>
                            <td>—</td>
                          </>
                        )}
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
                        <td>{margeTaux(totalLignePV, totalLignePR).toFixed(0)}%</td>
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
                        <td className="cellule-actions">
                          <button type="button" title="Monter" onClick={() => deplacerLigne(l.id, -1)}>▲</button>
                          <button type="button" title="Descendre" onClick={() => deplacerLigne(l.id, 1)}>▼</button>
                          <button type="button" title="Supprimer" onClick={() => supprimerLigne(l.id)}>×</button>
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="ligne-ajout">
                    <td>
                      {estFormation && (
                        <select
                          className="select-ajout"
                          value=""
                          onChange={(e) => ajouterFormationCatalogue(e.target.value)}
                        >
                          <option value="" disabled>+ Ajouter une formation…</option>
                          {catalogue.map((f) => (
                            <option key={f.id} value={f.id}>{f.nom}</option>
                          ))}
                          <option value="libre">Autre (texte libre)</option>
                        </select>
                      )}
                      {cat === 'elearning' && (
                        <select
                          className="select-ajout"
                          value=""
                          onChange={(e) => ajouterLigneElearning(e.target.value)}
                        >
                          <option value="" disabled>+ Ajouter un module e-learning…</option>
                          {MODULES_ELEARNING.map((nom) => (
                            <option key={nom} value={nom}>{nom}</option>
                          ))}
                          <option value="libre">Autre (texte libre)</option>
                        </select>
                      )}
                      {!estFormation && cat !== 'elearning' && (
                        <button type="button" className="bouton-lien" onClick={() => ajouterLigneLibre(cat)}>
                          + Ajouter une ligne « {CATEGORIE_LABELS[cat]} »
                        </button>
                      )}
                    </td>
                    <td colSpan={10}></td>
                  </tr>
                  {lignesCat.length > 0 && (
                    <tr className="ligne-sous-total">
                      <td><strong>Sous-total {CATEGORIE_LABELS[cat]}</strong></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td><strong>{t.pv.toFixed(2)} €</strong></td>
                      <td><strong>{t.pr.toFixed(2)} €</strong></td>
                      <td><strong>{t.taux.toFixed(0)}%</strong></td>
                      <td></td>
                      <td></td>
                      <td></td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <section className="section-devis">
        <h2>Récapitulatif du projet</h2>

        <div className="table-devis-scroll">
          <table className="table-devis table-recap-financier">
            <tbody>
              {lignesRecap.map((l) => (
                <tr key={l.libelle}>
                  <td>{l.libelle}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td>{l.pv.toFixed(2)} €</td>
                  <td>{l.pr.toFixed(2)} €</td>
                  <td>{margeTaux(l.pv, l.pr).toFixed(0)}%</td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              ))}
              <tr className="ligne-forte">
                <td><strong>Sous-total</strong></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td><strong>{sousTotalPv.toFixed(2)} €</strong></td>
                <td><strong>{sousTotalPr.toFixed(2)} €</strong></td>
                <td><strong>{margeTaux(sousTotalPv, sousTotalPr).toFixed(0)}%</strong></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td>Remise</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td>
                  <span className="input-pourcentage">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={resume?.remisePv ?? 0}
                      onChange={(e) => modifierResumeLocal('remisePv', e.target.value)}
                      onBlur={sauvegarderRemiseArrondi}
                    />
                    <span>%</span>
                  </span>
                </td>
                <td>—</td>
                <td>-{remiseMontantPv.toFixed(2)} €</td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr className="ligne-forte">
                <td><strong>Total</strong></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td><strong>{totalPv.toFixed(2)} €</strong></td>
                <td><strong>{totalPr.toFixed(2)} €</strong></td>
                <td><strong>{margeTaux(totalPv, totalPr).toFixed(0)}%</strong></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td>Arrondi</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
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
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
