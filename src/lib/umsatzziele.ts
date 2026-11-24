// Umsatzziele (24.11.2026) — Browser-Seite der Server-Aktion `umsatzziel_stand` (email-gateway/umsatzZiel.ts).
// Gerechnet wird auf dem Server mit supabase/functions/_shared/umsatzZielKern.ts: Dort sieht er alle Rechnungen
// (im Browser sieht nicht jeder alle), und Seite, Karte „Unser Ziel“, Morgen-Übersicht und Assistent nennen
// dieselben Zahlen. Das Soll ändert die Geschäftsführung direkt in der Tabelle umsatz_ziele (Zeilenregel:
// nur Geschäftsführung/Admin und Superuser).
import { supabase } from './supabaseClient'
import { callAuthenticated } from './emailGateway'
import type { SollZeile, ZielUebersicht } from '../../supabase/functions/_shared/umsatzZielKern.ts'

export * from '../../supabase/functions/_shared/umsatzZielKern.ts'

export type UmsatzzielAntwort = {
  uebersicht: ZielUebersicht
  /** So stünde es in der Morgen-Übersicht (kurz). */
  meldung: string
  darfAendern: boolean
  tabellenDa: boolean
  soll: SollZeile[]
}

// Kurz zwischenspeichern: Die Karte „Unser Ziel“ steht in jeder Abteilung und soll nicht bei jedem Seitenwechsel neu rechnen.
const MERKEN_MS = 5 * 60 * 1000
const gemerkt = new Map<string, { bis: number; antwort: Promise<UmsatzzielAntwort> }>()

export function vergiss(): void {
  gemerkt.clear()
}

export function ladeUmsatzziel(optionen: { monat?: string; bereich?: string } = {}, frisch = false): Promise<UmsatzzielAntwort> {
  const schluessel = `${optionen.monat ?? ''}|${optionen.bereich ?? ''}`
  const alt = gemerkt.get(schluessel)
  if (!frisch && alt && alt.bis > Date.now()) return alt.antwort
  const antwort = callAuthenticated({ action: 'umsatzziel_stand', ...(optionen.monat ? { monat: optionen.monat } : {}), ...(optionen.bereich ? { bereich: optionen.bereich } : {}) }) as Promise<UmsatzzielAntwort>
  gemerkt.set(schluessel, { bis: Date.now() + MERKEN_MS, antwort })
  antwort.catch(() => gemerkt.delete(schluessel))
  return antwort
}

/** Soll einer Sparte für einen Monat speichern (nur Geschäftsführung/Superuser — prüft die Datenbank). */
export async function speichereSoll(monat: string, sparte: string, sollNetto: number, von: string): Promise<void> {
  if (!supabase) throw new Error('Datenbank ist nicht verbunden.')
  if (!(sollNetto >= 0) || !Number.isFinite(sollNetto)) throw new Error('Bitte einen Betrag ab 0 € eingeben.')
  const { error } = await supabase
    .from('umsatz_ziele')
    .upsert({ monat, sparte, soll_netto: Math.round(sollNetto * 100) / 100, geaendert_von: von, geaendert_am: new Date().toISOString() }, { onConflict: 'monat,sparte' })
  if (error) throw new Error(error.message.includes('row-level security') ? 'Das Soll dürfen nur Geschäftsführung und Superuser ändern.' : `Soll nicht gespeichert: ${error.message}`)
  vergiss()
}
