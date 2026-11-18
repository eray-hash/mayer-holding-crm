// Lesen und Schreiben der Tabelle kontoauszug_auswertungen. Bewusst nicht im gemeinsamen App-Zustand
// und nicht im Abgleich (crmSync): Die Auswertungen einer Akte werden erst geladen, wenn jemand den
// Abschnitt öffnet. Wer was sehen darf, regelt die Datenbank (Bereichsrechte des Mitarbeiters).

import { supabase } from './supabaseClient'
import type { KontoauszugAuswertung, KontoauszugDatei, KundeBereich } from '../types'
import type { Buchung } from './kontoauszugAuswertung'

const TABELLE = 'kontoauszug_auswertungen'

type Zeile = {
  id: string
  kunde_id: string
  bereich: string
  titel: string | null
  erstellt_am: string
  erstellt_von: string | null
  geaendert_am: string
  buchungen: unknown
  dateien: unknown
}

export type GespeicherteAuswertung = Omit<KontoauszugAuswertung, 'buchungen'> & { buchungen: Buchung[] }

function ausZeile(z: Zeile): GespeicherteAuswertung {
  return {
    id: z.id,
    kundeId: z.kunde_id,
    bereich: z.bereich as KundeBereich,
    titel: z.titel ?? '',
    erstelltAm: z.erstellt_am,
    erstelltVon: z.erstellt_von ?? undefined,
    geaendertAm: z.geaendert_am,
    buchungen: Array.isArray(z.buchungen) ? (z.buchungen as Buchung[]) : [],
    dateien: Array.isArray(z.dateien) ? (z.dateien as KontoauszugDatei[]) : [],
  }
}

function db() {
  if (!supabase) throw new Error('Die Datenbank ist nicht verbunden.')
  return supabase
}

export async function ladeKontoauszugAuswertungen(kundeId: string, bereich: KundeBereich): Promise<GespeicherteAuswertung[]> {
  const { data, error } = await db().from(TABELLE).select('*').eq('kunde_id', kundeId).eq('bereich', bereich).order('geaendert_am', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Zeile[]).map(ausZeile)
}

/** Legt an oder überschreibt (gleiche Kennung). Gibt den gespeicherten Stand zurück. */
export async function speichereKontoauszugAuswertung(a: GespeicherteAuswertung): Promise<GespeicherteAuswertung> {
  const zeile: Zeile = {
    id: a.id,
    kunde_id: a.kundeId,
    bereich: a.bereich,
    titel: a.titel,
    erstellt_am: a.erstelltAm,
    erstellt_von: a.erstelltVon ?? null,
    geaendert_am: a.geaendertAm,
    buchungen: a.buchungen,
    dateien: a.dateien,
  }
  const { data, error } = await db().from(TABELLE).upsert(zeile, { onConflict: 'id' }).select('*').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Nicht gespeichert: Es fehlt die Berechtigung für diesen Bereich.')
  return ausZeile(data as Zeile)
}

export async function benenneKontoauszugAuswertungUm(id: string, titel: string): Promise<string> {
  const geaendertAm = new Date().toISOString()
  const { data, error } = await db().from(TABELLE).update({ titel, geaendert_am: geaendertAm }).eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Nicht umbenannt: Die Auswertung gibt es nicht mehr, oder es fehlt die Berechtigung für diesen Bereich.')
  return geaendertAm
}

export async function loescheKontoauszugAuswertung(id: string): Promise<void> {
  const { data, error } = await db().from(TABELLE).delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Nicht gelöscht: Die Auswertung gibt es nicht mehr, oder es fehlt die Berechtigung für diesen Bereich.')
}
