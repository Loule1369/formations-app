import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useProjetActif } from '../lib/ProjetActifContext'

const STATUT_LABELS = {
  besoin_exprime: 'Besoin exprimé',
  devis_envoye: 'Devis envoyé',
  valide: 'Validé',
  saisi_queoval: 'Saisi QUEOVAL',
  termine: 'Terminé',
}

const OPTION_FORMATION_SPECIFIQUE = '__specifique__'

function ligneVide() {
  return { formationId: '', nbParticipants: 1, nbGroupes: 1 }
}

// Conversion heures → jours pour le chiffrage : un palier par demi-journée de 4h, arrondi au-dessus
// (6h/7h/8h = 1 jour, 9-12h = 1,5 jour, 13-16h = 2 jours...).
function heuresEnJours(heures) {
  return Math.ceil(heures / 4) * 0.5
}

export default function ExpressionBesoin() {
  const { definirProjetActif } = useProjetActif()
  const [clients, setClients] = useState([])
  const [formations, setFormations] = useState([])
  const [demandesRecentes, setDemandesRecentes] = useState([])

  const [clientId, setClientId] = useState('')
  const [nouveauClientNom, setNouveauClientNom] = useState('')
  const [notes, setNotes] = useState('')
  const [lignes, setLignes] = useState([ligneVide()])
  const [modaleFormationSpecifique, setModaleFormationSpecifique] = useState(null) // { index, nom, dureeAnimation, dureePreparation }

  const [chargement, setChargement] = useState(true)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [succes, setSucces] = useState('')

  async function chargerDonnees() {
    setChargement(true)
    setErreur('')
    const [clientsRes, formationsRes, demandesRes] = await Promise.all([
      supabase.from('clients').select('id, nom').order('nom'),
      supabase
        .from('formations_catalogue')
        .select('id, code, nom, duree_h, prix')
        .order('nom'),
      supabase
        .from('demandes')
        .select('id, statut, date_creation, clients(nom)')
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    if (clientsRes.error || formationsRes.error || demandesRes.error) {
      setErreur(
        (clientsRes.error || formationsRes.error || demandesRes.error).message,
      )
    } else {
      setClients(clientsRes.data)
      setFormations(formationsRes.data)
      setDemandesRecentes(demandesRes.data)
    }
    setChargement(false)
  }

  useEffect(() => {
    chargerDonnees()
  }, [])

  function majLigne(index, champ, valeur) {
    setLignes((prev) =>
      prev.map((l, i) => (i === index ? { ...l, [champ]: valeur } : l)),
    )
  }

  function ajouterLigne() {
    setLignes((prev) => [...prev, ligneVide()])
  }

  function supprimerLigne(index) {
    setLignes((prev) => prev.filter((_, i) => i !== index))
  }

  // Crée une formation "à la volée" dans le catalogue (nom + durées définies par le chef de projet) :
  // elle se comporte ensuite exactement comme une formation du catalogue partout ailleurs (Planning,
  // Chiffrage) — mêmes tarifs jour (colonne A du fichier de référence), même logique de planification.
  async function creerFormationSpecifique() {
    if (!modaleFormationSpecifique) return
    const { index, nom, dureeAnimation, dureePreparation } = modaleFormationSpecifique
    if (!nom.trim()) {
      setErreur('Indiquez un nom pour la formation spécifique.')
      return
    }
    const dureeH = Number(dureeAnimation) || 0
    const dureePrepH = Number(dureePreparation) || 0
    const { data, error } = await supabase
      .from('formations_catalogue')
      .insert({
        nom: nom.trim(),
        duree_h: dureeH,
        duree_prep_h: dureePrepH,
        jours_animation_catalogue: heuresEnJours(dureeH),
        jours_preparation_catalogue: heuresEnJours(dureePrepH),
      })
      .select('id, code, nom, duree_h, prix')
      .single()
    if (error) {
      setErreur(error.message)
      return
    }
    setFormations((prev) => [...prev, data].sort((a, b) => a.nom.localeCompare(b.nom)))
    majLigne(index, 'formationId', data.id)
    setModaleFormationSpecifique(null)
    setErreur('')
  }

  async function envoyer(e) {
    e.preventDefault()
    setErreur('')
    setSucces('')

    const lignesValides = lignes.filter((l) => l.formationId)
    if (!clientId && !nouveauClientNom.trim()) {
      setErreur('Choisissez un client existant ou saisissez le nom d’un nouveau client.')
      return
    }
    if (lignesValides.length === 0) {
      setErreur('Ajoutez au moins une formation.')
      return
    }

    setEnvoi(true)
    try {
      let finalClientId = clientId
      let finalClientNom = clients.find((c) => c.id === clientId)?.nom || ''
      if (!finalClientId) {
        const { data, error } = await supabase
          .from('clients')
          .insert({ nom: nouveauClientNom.trim() })
          .select('id')
          .single()
        if (error) throw error
        finalClientId = data.id
        finalClientNom = nouveauClientNom.trim()
      }

      const { data: demande, error: demandeError } = await supabase
        .from('demandes')
        .insert({ client_id: finalClientId, notes: notes.trim() || null })
        .select('id')
        .single()
      if (demandeError) throw demandeError

      const lignesAInserer = lignesValides.flatMap((l) => {
        const nbGroupes = Math.max(1, Number(l.nbGroupes) || 1)
        if (nbGroupes === 1) {
          return [{ demande_id: demande.id, formation_id: l.formationId, nb_participants: Number(l.nbParticipants) || 1, groupe: null }]
        }
        return Array.from({ length: nbGroupes }, (_, i) => ({
          demande_id: demande.id,
          formation_id: l.formationId,
          nb_participants: Number(l.nbParticipants) || 1,
          groupe: i + 1,
        }))
      })

      const { error: lignesError } = await supabase.from('demande_lignes').insert(lignesAInserer)
      if (lignesError) throw lignesError

      definirProjetActif(demande.id, finalClientNom)
      setSucces(`Demande enregistrée et définie comme projet actif pour "${finalClientNom}".`)
      setClientId('')
      setNouveauClientNom('')
      setNotes('')
      setLignes([ligneVide()])
      chargerDonnees()
    } catch (err) {
      setErreur(err.message)
    } finally {
      setEnvoi(false)
    }
  }

  if (chargement) return <p>Chargement…</p>

  return (
    <div className="page">
      <h1>Nouvelle expression de besoin</h1>

      <form onSubmit={envoyer} className="form-besoin">
        <fieldset>
          <legend>Client</legend>
          <label>
            Client existant
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value)
                if (e.target.value) setNouveauClientNom('')
              }}
            >
              <option value="">— Choisir —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ou nouveau client
            <input
              type="text"
              placeholder="Nom du client"
              value={nouveauClientNom}
              onChange={(e) => {
                setNouveauClientNom(e.target.value)
                if (e.target.value) setClientId('')
              }}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Formations demandées</legend>
          <p className="astuce">Participants / Groupes (si plusieurs sessions de la même formation sont nécessaires)</p>
          {lignes.map((ligne, index) => (
            <div className="ligne-formation" key={index}>
              <select
                value={ligne.formationId}
                onChange={(e) => {
                  if (e.target.value === OPTION_FORMATION_SPECIFIQUE) {
                    setModaleFormationSpecifique({ index, nom: '', dureeAnimation: '', dureePreparation: '' })
                    return
                  }
                  majLigne(index, 'formationId', e.target.value)
                }}
              >
                <option value="">— Choisir une formation —</option>
                <option value={OPTION_FORMATION_SPECIFIQUE}>+ Créer une formation spécifique…</option>
                {formations.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nom} ({f.duree_h}h)
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={ligne.nbParticipants}
                onChange={(e) => majLigne(index, 'nbParticipants', e.target.value)}
                title="Nombre de participants"
              />
              <input
                type="number"
                min="1"
                value={ligne.nbGroupes}
                onChange={(e) => majLigne(index, 'nbGroupes', e.target.value)}
                title="Nombre de groupes (sessions distinctes de cette formation)"
              />
              {lignes.length > 1 && (
                <button type="button" onClick={() => supprimerLigne(index)}>
                  Retirer
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={ajouterLigne}>
            + Ajouter une formation
          </button>
        </fieldset>

        <fieldset>
          <legend>Notes</legend>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contexte, contraintes particulières..."
          />
        </fieldset>

        {erreur && <p className="message erreur">{erreur}</p>}
        {succes && <p className="message succes">{succes}</p>}

        <button type="submit" disabled={envoi}>
          {envoi ? 'Enregistrement…' : 'Enregistrer la demande'}
        </button>
      </form>

      <section>
        <h2>Dernières demandes</h2>
        {demandesRecentes.length === 0 ? (
          <p>Aucune demande pour l’instant.</p>
        ) : (
          <ul className="liste-demandes">
            {demandesRecentes.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="lien-reprendre"
                  onClick={() => definirProjetActif(d.id, d.clients?.nom)}
                >
                  <strong>{d.clients?.nom}</strong> — {STATUT_LABELS[d.statut] || d.statut} — {d.date_creation}
                  <span className="astuce-reprendre"> (cliquer pour en faire le projet actif)</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {modaleFormationSpecifique && (
        <div className="modale-fond" onMouseDown={() => setModaleFormationSpecifique(null)}>
          <div className="modale-contenu" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Formation spécifique</h3>
            <label>
              Nom de la formation
              <input
                type="text"
                value={modaleFormationSpecifique.nom}
                onChange={(e) =>
                  setModaleFormationSpecifique((prev) => ({ ...prev, nom: e.target.value }))
                }
                autoFocus
              />
            </label>
            <label>
              Durée d'animation (heures)
              <input
                type="number"
                min="0"
                step="0.5"
                value={modaleFormationSpecifique.dureeAnimation}
                onChange={(e) =>
                  setModaleFormationSpecifique((prev) => ({ ...prev, dureeAnimation: e.target.value }))
                }
              />
            </label>
            <label>
              Durée de préparation (heures)
              <input
                type="number"
                min="0"
                step="0.5"
                value={modaleFormationSpecifique.dureePreparation}
                onChange={(e) =>
                  setModaleFormationSpecifique((prev) => ({ ...prev, dureePreparation: e.target.value }))
                }
              />
            </label>
            <p className="astuce">
              Le coût sera calculé avec les mêmes tarifs jour que les autres formations (préparation,
              animation). L'administratif par défaut (0,5 j) reste inchangé.
            </p>
            {erreur && <p className="message erreur">{erreur}</p>}
            <div className="modale-actions">
              <button type="button" onClick={() => setModaleFormationSpecifique(null)}>Annuler</button>
              <button type="button" onClick={creerFormationSpecifique}>Créer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
