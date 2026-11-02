import type { Bereich } from '../types'

// Alle 7 Bereiche inkl. Immobilien (das in KUNDEN_BEREICHE bewusst fehlt, da es Objekte statt
// Kunden führt, siehe kundenBereiche.ts) — für Stellen, die wirklich alle Bereiche brauchen, z.B.
// die Zugriffs-Checkliste in der Mitarbeiter-Verwaltung und die rollenbasierte Routen-Absicherung.
export const ALLE_BEREICHE: { id: Bereich; label: string }[] = [
  { id: 'beratung', label: 'Unternehmensberatung' },
  { id: 'immobilien', label: 'Immobilien' },
  { id: 'erben', label: 'Erben' },
  { id: 'betriebsuebergabe', label: 'Betriebsübergabe' },
  { id: 'betriebsformen', label: 'Betriebsformen' },
  { id: 'akademie', label: 'Akademie' },
  { id: 'finanzierungen', label: 'Finanzierungen' },
]

export function bereichLabel(bereich: Bereich): string {
  return ALLE_BEREICHE.find((b) => b.id === bereich)?.label ?? bereich
}
