// Statusbericht an den Kunden („Stand Ihres Projekts“, 22.11.2026) — Browser-Seite.
// Den Inhalt baut der gemeinsame Kern supabase/functions/_shared/kundenberichtKern.ts (dort steht auch,
// was in den Bericht darf und was nicht). Hier: Daten der Akte aus dem App-Zustand übergeben, Stand im
// Ablauf aus den Statusnetzen, Hochlade-Link für fehlende Unterlagen, Einstellung „wöchentlich erinnern“
// (Tabelle kundenbericht_einstellung) und der Schalter für alle (kundenbericht_schalter).
import { supabase } from './supabaseClient'
import { standVon } from './checkliste'
import {
  erstelleKundenbericht,
  ladeBerichtDaten,
  standardSeit,
  type BerichtAkte,
  type BerichtDaten,
  type BerichtStand,
  type Kundenbericht,
} from '../../supabase/functions/_shared/kundenberichtKern.ts'
import type { Kunde, KundeBereich, KundenUnterlagenAnforderung } from '../types'

export {
  AMPEL_KUNDENTEXT,
  AMPEL_NAME,
  berichtAlsText,
  deDatum,
  type KundenAmpel,
  type Kundenbericht,
} from '../../supabase/functions/_shared/kundenberichtKern.ts'

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

/** Heutiges Datum in Deutschland (JJJJ-MM-TT). */
export function heuteBerlin(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}

/** Die Akte aus dem App-Zustand in der Form, die der Kern erwartet. */
export function akteAusKunde(kunde: Kunde, bereich: KundeBereich): BerichtAkte {
  return {
    id: kunde.id,
    bereich,
    firma: kunde.firma,
    ansprechpartner: kunde.ansprechpartner,
    email: kunde.email,
    verantwortlich: kunde.verantwortlich,
    status: kunde.status,
    naechsteSchritte: kunde.naechsteSchritte ?? null,
    dienstleistungen: kunde.dienstleistungen ?? null,
    activities: kunde.activities ?? [],
    dokumente: kunde.dokumente ?? [],
    unterlagenAnforderungen: kunde.unterlagenAnforderungen ?? [],
    unterlagenCheckliste: kunde.unterlagenCheckliste ?? null,
    selbstauskunftAm: kunde.selbstauskunft?.eingereichtAm ?? null,
  }
}

export function standFuer(bereich: KundeBereich, status: string): BerichtStand {
  const s = standVon(bereich, status)
  return { label: s.label, schritt: s.schritt, schritte: s.schritte, abgeschlossen: s.abgeschlossen }
}

export type BerichtGeladen = { daten: BerichtDaten; seitVorschlag: string; bericht: Kundenbericht }

/** Lädt Wiedervorlagen, Mails, Termine, Kostenvoranschläge und Rechnungen der Akte und baut den Entwurf. */
export async function ladeKundenbericht(kunde: Kunde, bereich: KundeBereich, seit?: string): Promise<BerichtGeladen> {
  const akte = akteAusKunde(kunde, bereich)
  const daten = await ladeBerichtDaten(client(), kunde.id, { akte })
  if (!daten) throw new Error('Die Akte ließ sich nicht laden.')
  const heute = heuteBerlin()
  const seitVorschlag = standardSeit(akte, daten.letzterVersand, heute)
  const bericht = baueBericht(daten, kunde, bereich, seit || seitVorschlag)
  return { daten, seitVorschlag, bericht }
}

/** Baut den Entwurf neu (z. B. nach Ändern des Zeitraums) — ohne neu zu laden. */
export function baueBericht(daten: BerichtDaten, kunde: Kunde, bereich: KundeBereich, seit: string): Kundenbericht {
  return erstelleKundenbericht({ ...daten, akte: akteAusKunde(kunde, bereich), heute: heuteBerlin(), seit, stand: standFuer(bereich, kunde.status) })
}

// ---------- Hochlade-Link für fehlende Unterlagen ----------

/** 32 Zufallsbytes, base64url ohne Auffüllzeichen (wie in KundeUnterlagenAnfordern.tsx). */
export function neueKennung(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function hochladeLink(token: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/formular/unterlagen/${token}`
}

/**
 * Anforderung (Art „Erinnerung“, wie „An fehlende Unterlagen erinnern“) für den Link im Bericht.
 * Zeilen, die genau einer angeforderten Unterlage entsprechen, werden zu Punkten (der Kunde lädt sie
 * dort einzeln hoch); alle anderen Zeilen — außer Rückmeldungen zu Angeboten — stehen unter „Weitere“.
 */
export function anforderungFuerBericht(e: { token: string; an: string; anName: string; von: string; zeilen: string[]; fehlendePunkte: string[]; datum: string }): KundenUnterlagenAnforderung {
  const punkte = e.zeilen.filter((z) => e.fehlendePunkte.includes(z))
  const weitere = e.zeilen.filter((z) => !punkte.includes(z) && !/^Ihre Rückmeldung\b/.test(z))
  return {
    id: `kanf_${crypto.randomUUID().slice(0, 11)}`,
    datum: e.datum,
    an: e.an,
    ...(e.anName ? { anName: e.anName } : {}),
    von: e.von,
    punkte,
    ...(weitere.length ? { weitere: weitere.join('\n') } : {}),
    art: 'erinnerung',
    token: e.token,
  }
}

export function berichtDateiname(name: string, heute: string): string {
  const n = name.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60) || 'Kunde'
  return `Statusbericht ${n} (${heute.split('-').reverse().join('.')}).pdf`
}

// ---------- Wöchentlich erinnern (kundenbericht_einstellung) und Schalter für alle ----------

export type BerichtEinstellung = { aktiv: boolean; wochentag: number; letzterVersand?: string; letzterHinweis?: string; geaendertVon?: string }

/** 1 = Montag … 7 = Sonntag (wie in der Datenbank). */
export const WOCHENTAGE: { wert: number; name: string }[] = [
  { wert: 1, name: 'Montag' },
  { wert: 2, name: 'Dienstag' },
  { wert: 3, name: 'Mittwoch' },
  { wert: 4, name: 'Donnerstag' },
  { wert: 5, name: 'Freitag' },
]

export async function ladeBerichtEinstellung(kundeId: string): Promise<BerichtEinstellung | null> {
  const { data, error } = await client().from('kundenbericht_einstellung').select('*').eq('kunde_id', kundeId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    aktiv: !!data.aktiv,
    wochentag: Number(data.wochentag ?? 1),
    letzterVersand: data.letzter_versand ?? undefined,
    letzterHinweis: data.letzter_hinweis ?? undefined,
    geaendertVon: data.geaendert_von ?? undefined,
  }
}

export async function speichereBerichtEinstellung(e: { kundeId: string; bereich: KundeBereich; aktiv: boolean; wochentag: number }, von: string): Promise<void> {
  if (e.bereich === 'privat') throw new Error('Für private Kontakte gibt es keinen Statusbericht.')
  const { error } = await client()
    .from('kundenbericht_einstellung')
    .upsert({ kunde_id: e.kundeId, bereich: e.bereich, aktiv: e.aktiv, wochentag: e.wochentag, geaendert_von: von, geaendert_am: new Date().toISOString() }, { onConflict: 'kunde_id' })
  if (error) throw new Error(/row-level security|permission denied/i.test(error.message) ? 'Für diesen Bereich hast du keine Berechtigung.' : error.message)
}

/** Nach dem Senden bzw. Erstellen: Datum des letzten Berichts festhalten (Grundlage für den nächsten Zeitraum). */
export async function vermerkeBerichtVersand(kundeId: string, bereich: KundeBereich, datum: string, von: string): Promise<void> {
  if (bereich === 'privat') return
  const { data } = await client().from('kundenbericht_einstellung').select('kunde_id').eq('kunde_id', kundeId).maybeSingle()
  const { error } = data
    ? await client().from('kundenbericht_einstellung').update({ letzter_versand: datum }).eq('kunde_id', kundeId)
    : await client().from('kundenbericht_einstellung').insert({ kunde_id: kundeId, bereich, letzter_versand: datum, geaendert_von: von })
  if (error) throw new Error(error.message)
}

export async function ladeBerichtSchalter(): Promise<{ aktiv: boolean; geaendertVon?: string }> {
  const { data, error } = await client().from('kundenbericht_schalter').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  return { aktiv: !!data?.aktiv, geaendertVon: data?.geaendert_von ?? undefined }
}

/** Nur Geschäftsführung und Superuser dürfen das (Regel in der Datenbank). */
export async function setzeBerichtSchalter(aktiv: boolean, von: string): Promise<void> {
  const { data, error } = await client().from('kundenbericht_schalter').update({ aktiv, geaendert_von: von, geaendert_am: new Date().toISOString() }).eq('id', 1).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Diesen Schalter darf nur die Geschäftsführung ändern.')
}
