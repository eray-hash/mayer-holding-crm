// Schnellsuche nach Kundenakten und Objektakten für die Zuordnung einer Aufnahme. Gelesen wird mit dem
// eigenen Login — der Zeilenschutz der Datenbank liefert nur Akten aus erlaubten Bereichen (und private nur
// dem Besitzer). Die Sammelakten („Ungeklärte Eingänge“, interne Akte) werden nicht angeboten.

import { supabase } from '../lib/supabaseClient'
import { SAMMELAKTEN } from '../../supabase/functions/_shared/terminBriefingKern.ts'

export type AkteTreffer =
  | { art: 'kunde'; id: string; bereich: string; name: string; zusatz: string }
  | { art: 'objekt'; id: string; name: string; zusatz: string }

export const BEREICH_NAMEN: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilienkunden: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  buecher: 'Bücher & Verlag',
  privat: 'Privat',
}

/** Suchwort für PostgREST-Filter entschärfen (Komma, Klammern, Prozent trennen sonst den Filter). */
export function suchMuster(eingabe: string): string {
  const s = eingabe.replace(/[%,()*\\"']/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? `%${s}%` : ''
}

export async function sucheAkten(eingabe: string): Promise<AkteTreffer[]> {
  if (!supabase) return []
  const muster = suchMuster(eingabe)
  if (muster.length < 4) return []
  const [kunden, objekte] = await Promise.all([
    supabase
      .from('kunden')
      .select('id, bereich, firma, ansprechpartner, email')
      .or(`firma.ilike.${muster},ansprechpartner.ilike.${muster},email.ilike.${muster}`)
      .limit(15),
    supabase.from('objekte').select('id, bezeichnung, adresse').or(`bezeichnung.ilike.${muster},adresse.ilike.${muster}`).limit(8),
  ])
  const treffer: AkteTreffer[] = []
  for (const k of (kunden.data ?? []) as { id: string; bereich: string; firma: string | null; ansprechpartner: string | null; email: string | null }[]) {
    if (SAMMELAKTEN.includes(k.id)) continue
    const name = [k.ansprechpartner, k.firma].filter(Boolean).join(' · ') || k.email || k.id
    treffer.push({ art: 'kunde', id: k.id, bereich: k.bereich, name, zusatz: BEREICH_NAMEN[k.bereich] ?? k.bereich })
  }
  for (const o of (objekte.data ?? []) as { id: string; bezeichnung: string | null; adresse: string | null }[]) {
    treffer.push({ art: 'objekt', id: o.id, name: o.bezeichnung || o.adresse || o.id, zusatz: `Objekt${o.adresse ? ` · ${o.adresse}` : ''}` })
  }
  return treffer
}
