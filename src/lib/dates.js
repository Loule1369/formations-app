export const JOUR_MS = 24 * 60 * 60 * 1000

export function heureEnDecimal(hhmmss) {
  const [h, m] = hhmmss.split(':').map(Number)
  return h + m / 60
}

export function decimalEnHeure(dec) {
  const snap = Math.round(dec * 2) / 2
  const h = Math.floor(snap)
  const m = snap - h === 0.5 ? '30' : '00'
  return `${String(h).padStart(2, '0')}:${m}:00`
}

export function dureeHeures(debut, fin) {
  return Math.max(0.5, heureEnDecimal(fin) - heureEnDecimal(debut))
}

// Toujours raisonner en heure locale : toISOString() (UTC) décale la date d'un jour
// pour un utilisateur en France dès qu'on manipule un minuit local.
export function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const j = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${j}`
}

// Parse une date stockée ("YYYY-MM-DD") en minuit LOCAL, jamais en UTC.
export function parseDate(dateStr) {
  return new Date(dateStr + 'T00:00:00')
}

function intervalleContientWeekend(dateDebut, dateFin) {
  let d = parseDate(dateDebut)
  const fin = parseDate(dateFin)
  d.setTime(d.getTime() + JOUR_MS)
  while (d < fin) {
    if (d.getDay() === 0 || d.getDay() === 6) return true
    d.setTime(d.getTime() + JOUR_MS)
  }
  return false
}

// Un même formateur reste sur place tant que l'écart entre deux jours de mission ne dépasse pas
// un jour creux isolé. Dès qu'un week-end s'intercale, il rentre chez lui (retour vendredi soir,
// aller lundi matin) : regroupe donc des dates de formation (triées) en "voyages" continus.
const ECART_MAX_MEME_MISSION = 2

export function grouperVoyages(datesTriees) {
  const groupes = []
  let courant = null
  for (const date of datesTriees) {
    if (!courant) {
      courant = { debut: date, fin: date }
    } else {
      const ecart = Math.round((parseDate(date).getTime() - parseDate(courant.fin).getTime()) / JOUR_MS)
      const traverseWeekend = intervalleContientWeekend(courant.fin, date)
      if (!traverseWeekend && ecart <= ECART_MAX_MEME_MISSION) {
        courant.fin = date
      } else {
        groupes.push(courant)
        courant = { debut: date, fin: date }
      }
    }
  }
  if (courant) groupes.push(courant)
  return groupes
}
