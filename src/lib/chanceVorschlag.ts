// Vorschläge für Chance, erwarteten Umsatz und Monat (22.11.2026) im CRM: laden, neu berechnen lassen
// (email-gateway Aktion chance_vorschlaege) und übernehmen. Die Regeln selbst stehen in
// supabase/functions/_shared/chanceKern.ts (gleich für Server, Assistent und CRM).
//
// Übernehmen schreibt kunden.auftrag_chance über den normalen Weg (dispatch → crmSync, nur geänderte
// Felder) — wie das Speichern der Checkliste. Ein Verlaufseintrag entsteht dabei bewusst nicht: Er würde
// „letzter Kontakt“ und damit die Ampel verfälschen.
import type { Kunde } from '../types'
import { call } from './emailGateway'
import { supabase } from './supabaseClient'
import { alleZeilen } from './alleZeilen'
import {
  chanceAusVorschlag, leseGespeicherteChance, leseVorschlag, type ChanceVorschlag, type GespeicherteChance,
} from '../../supabase/functions/_shared/chanceKern.ts'

export type { ChanceVorschlag, GespeicherteChance }
export { leseGespeicherteChance, leseVorschlag }

/** Alle gespeicherten Vorschläge der sichtbaren Akten (Zeilenregeln der Datenbank), je Akte. */
export async function ladeChanceVorschlaege(kundeId?: string): Promise<Map<string, ChanceVorschlag>> {
  const m = new Map<string, ChanceVorschlag>()
  if (!supabase) return m
  const db = supabase
  // Seitenweise (die Datenbank liefert höchstens 1000 Zeilen je Abfrage; ein limit(5000) hilft nicht).
  const { data, error } = await alleZeilen(() => {
    const q = db.from('kunden').select('id, chance_vorschlag')
    return (kundeId ? q.eq('id', kundeId) : q).not('chance_vorschlag', 'is', null)
  })
  if (error) throw new Error(`Vorschläge ließen sich nicht laden: ${error.message}`)
  for (const z of (data ?? []) as { id: string; chance_vorschlag: unknown }[]) {
    const v = leseVorschlag(z.chance_vorschlag)
    if (v) m.set(z.id, v)
  }
  return m
}

export type BerechnungsErgebnis = { text: string; berechnet: number; vorschlaege: Map<string, ChanceVorschlag> }

/** Lässt den Server die Vorschläge (neu) berechnen — ohne kundeIds für alle sichtbaren Akten. */
export async function berechneChanceVorschlaege(opt: { kundeIds?: string[]; mitKi?: boolean } = {}): Promise<BerechnungsErgebnis> {
  const data = await call({ action: 'chance_vorschlaege', kundeIds: opt.kundeIds, mitKi: opt.mitKi !== false })
  const vorschlaege = new Map<string, ChanceVorschlag>()
  for (const [id, roh] of Object.entries((data?.vorschlaege ?? {}) as Record<string, unknown>)) {
    const v = leseVorschlag(roh)
    if (v) vorschlaege.set(id, v)
  }
  return { text: String(data?.text ?? ''), berechnet: Number(data?.berechnet) || 0, vorschlaege }
}

/** Gespeicherte Chance einer Akte samt Umsatz/Monat (die Typen im CRM kennen umsatzNetto/monat evtl. noch nicht). */
export function chanceVon(k: Pick<Kunde, 'auftragChance'>): GespeicherteChance | undefined {
  return leseGespeicherteChance(k.auftragChance)
}

/**
 * Soll der Vorschlag bei der Akte noch angezeigt werden? Ja, solange die Chance nicht bestätigt ist, oder
 * wenn sie bestätigt ist, aber noch kein Umsatz da ist und der Vorschlag einen hat (und kein
 * Kostenvoranschlag mit Betrag zählt).
 */
export function vorschlagOffen(k: Pick<Kunde, 'auftragChance'>, v: ChanceVorschlag | undefined, kvUmsatz: number): boolean {
  if (!v) return false
  const c = chanceVon(k)
  if (!c?.bestaetigt) return true
  return !c.umsatzNetto && !!v.umsatzNetto && kvUmsatz <= 0
}

/** Patch für die Akte beim Übernehmen eines Vorschlags. */
export function uebernahmePatch(k: Pick<Kunde, 'auftragChance'>, v: ChanceVorschlag, nutzerName: string): Partial<Kunde> {
  const neu = chanceAusVorschlag(v, chanceVon(k), { name: nutzerName, am: new Date().toISOString() })
  return { auftragChance: neu as Kunde['auftragChance'] }
}

/** Erwarteter Umsatz netto einer Akte: Kostenvoranschläge mit Betrag gehen vor, sonst die bestätigte Schätzung. */
export function erwarteterUmsatz(k: Pick<Kunde, 'auftragChance'>, kvUmsatz: number): { netto: number; geschaetzt: boolean } {
  if (kvUmsatz > 0) return { netto: kvUmsatz, geschaetzt: false }
  const c = chanceVon(k)
  return c?.umsatzNetto ? { netto: c.umsatzNetto, geschaetzt: true } : { netto: 0, geschaetzt: false }
}

/** Umsatz/Monat aus den Feldern für auftrag_chance: Zahl > 0 und JJJJ-MM, sonst weglassen. */
export function umsatzFelder(umsatz: string, monat: string): { umsatzNetto?: number; monat?: string } {
  const n = Number(String(umsatz).replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return {}
  return { umsatzNetto: Math.round(n * 100) / 100, ...(/^\d{4}-(0[1-9]|1[0-2])$/.test(monat) ? { monat } : {}) }
}
