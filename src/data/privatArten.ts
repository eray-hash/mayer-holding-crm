import type { PrivatArt } from '../types'

// Private Unterbereiche (Bereich Privat → Beratung, Erben, …): je Art der Statusablauf, die Vorlagen und der
// Fragenkatalog des gleichnamigen Mayer-Bereichs — die Daten bleiben privat (kunden.bereich = 'privat',
// kunden.privat_art = Art). Immobilien-Kunden haben eigene Seiten (src/pages/privat/immobilien).
export type PrivatArtInfo = {
  id: PrivatArt
  label: string
  einzahl: string
  mehrzahl: string
  vorlagenKey: 'vorlagenBeratung' | 'vorlagenErben' | 'vorlagenBetriebsuebergabe' | 'vorlagenBetriebsformen' | 'vorlagenAkademie' | 'vorlagenFinanzierungen' | 'vorlagenImmobilien'
}

export const PRIVAT_ARTEN: PrivatArtInfo[] = [
  { id: 'beratung', label: 'Unternehmensberatung', einzahl: 'Kunde', mehrzahl: 'Kunden', vorlagenKey: 'vorlagenBeratung' },
  { id: 'erben', label: 'Erben', einzahl: 'Mandant', mehrzahl: 'Mandanten', vorlagenKey: 'vorlagenErben' },
  { id: 'betriebsuebergabe', label: 'Betriebsübergabe', einzahl: 'Mandant', mehrzahl: 'Mandanten', vorlagenKey: 'vorlagenBetriebsuebergabe' },
  { id: 'betriebsformen', label: 'Betriebsformen', einzahl: 'Mandant', mehrzahl: 'Mandanten', vorlagenKey: 'vorlagenBetriebsformen' },
  { id: 'akademie', label: 'Akademie', einzahl: 'Teilnehmer', mehrzahl: 'Teilnehmer', vorlagenKey: 'vorlagenAkademie' },
  { id: 'finanzierungen', label: 'Finanzierungen', einzahl: 'Mandant', mehrzahl: 'Mandanten', vorlagenKey: 'vorlagenFinanzierungen' },
  { id: 'immobilienkunden', label: 'Immobilien', einzahl: 'Kunde', mehrzahl: 'Kunden', vorlagenKey: 'vorlagenImmobilien' },
]

export const privatArtInfo = (art: string | undefined): PrivatArtInfo | undefined => PRIVAT_ARTEN.find((a) => a.id === art)

/** Pfad der Akte eines privaten Kontakts (mit Art in den Unterbereich, sonst die allgemeine Privat-Akte). */
export function privatAktePfad(id: string, art?: PrivatArt): string {
  if (art === 'immobilienkunden') return `/privat/immobilien/kunden/${id}`
  if (art) return `/privat/art/${art}/${id}`
  return `/privat/kontakte/${id}`
}
