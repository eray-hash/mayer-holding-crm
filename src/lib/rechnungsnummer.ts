// Rechnungsnummern nach Vorgabe der Geschäftsführung (24.11.2026) im CRM — dieselbe Regel wie der Assistent
// (supabase/functions/_shared/rechnungsnummerKern.ts): Initialen + fester Unterscheidungsbuchstabe je Kunde + laufende
// Nummer, z. B. LSA-001. Das Kürzel steht in kunden.rechnungs_kuerzel (eindeutig, einmal gesetzt unveränderlich, siehe
// supabase/sql/2026-11-24_rechnungsnummer.sql). Diese Datei lädt und speichert nur; gerechnet wird im gemeinsamen Kern.
import { alleZeilen } from './alleZeilen'
import { supabase } from './supabaseClient'
import { rechnungsnummerVorschlag } from '../../supabase/functions/_shared/rechnungsnummerKern.ts'
import type { Rechnung } from '../types'

export type KuerzelZeile = { kunde_id: string; kuerzel: string }
export type NummerVorschlag = { kuerzel: string; neu: boolean; nummer: string }

/** Alle vergebenen Kürzel; null, wenn sie sich nicht laden lassen (dann bleibt das Formular beim alten Vorschlag). */
export async function ladeRechnungsKuerzel(): Promise<KuerzelZeile[] | null> {
  if (!supabase) return null
  const db = supabase
  const { data, error } = await alleZeilen(() => db.from('kunden').select('id, rechnungs_kuerzel').not('rechnungs_kuerzel', 'is', null))
  if (error) return null
  return (data as { id: string; rechnungs_kuerzel: string | null }[])
    .filter((z) => String(z.rechnungs_kuerzel ?? '').trim())
    .map((z) => ({ kunde_id: z.id, kuerzel: String(z.rechnungs_kuerzel).trim().toUpperCase() }))
}

/** Vorschlag für eine neue Rechnung dieses Kunden. */
export function nummerVorschlagFuer(
  kunde: { id: string; firma?: string | null; ansprechpartner?: string | null },
  kuerzel: KuerzelZeile[],
  rechnungen: Pick<Rechnung, 'kundeId' | 'nummer'>[],
): NummerVorschlag {
  const eigenes = kuerzel.find((z) => z.kunde_id === kunde.id)?.kuerzel ?? null
  return rechnungsnummerVorschlag({
    kunde: { id: kunde.id, firma: kunde.firma, ansprechpartner: kunde.ansprechpartner, rechnungs_kuerzel: eigenes },
    kuerzel,
    rechnungen: rechnungen.map((r) => ({ kunde_id: r.kundeId, nummer: r.nummer })),
  })
}

/**
 * Neues Kürzel am Kunden speichern, bevor die erste Rechnung mit ihm angelegt wird.
 * 'ok' = gespeichert (oder hatte schon genau dieses), 'vergeben' = ein anderer Kunde oder ein anderes Kürzel war schneller
 * (neu rechnen), 'fehler' = nicht erreichbar.
 */
export async function kuerzelSpeichern(kundeId: string, kuerzel: string): Promise<'ok' | 'vergeben' | 'fehler'> {
  if (!supabase) return 'fehler'
  const { data, error } = await supabase.from('kunden').update({ rechnungs_kuerzel: kuerzel }).eq('id', kundeId).is('rechnungs_kuerzel', null).select('id')
  if (error) return error.code === '23505' ? 'vergeben' : 'fehler'
  if (data && data.length > 0) return 'ok'
  // Nichts geändert: Der Kunde hat inzwischen ein Kürzel (z. B. vom Assistenten) — gleich oder anders?
  const { data: z } = await supabase.from('kunden').select('rechnungs_kuerzel').eq('id', kundeId).maybeSingle()
  return String(z?.rechnungs_kuerzel ?? '').toUpperCase() === kuerzel.toUpperCase() ? 'ok' : 'vergeben'
}
