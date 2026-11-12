import { fmtDate } from './dates'
import type { Kunde } from '../types'

// Kurzfassung dessen, was laut Akte schon über einen Kunden bekannt ist (Notizen und Dateinamen).
// Geht an die Internet-Recherche, damit sie unterscheiden kann, was neu ist und was wir schon wussten.
export function akteWissen(kunde: Kunde): string {
  return [
    ...kunde.activities.slice(0, 15).map((a) => `- Notiz ${fmtDate(a.date)}: ${a.text}`),
    ...(kunde.dokumente ?? []).slice(0, 40).map((d) => `- Dokument (nur Dateiname bekannt): ${d.name}`),
  ]
    .join('\n')
    .slice(0, 6000)
}
