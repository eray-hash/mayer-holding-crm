// Kostenvoranschläge (Wunsch von Eray, 20.11.2026): eigene Tabelle `kostenvoranschlaege`, für alle
// Bereiche und den Bereich Privat. Ein Eintrag kann einer Kundenakte zugeordnet sein (kunde_id) oder
// noch ohne Akte dastehen (z. B. von einem Notizzettel übernommen).
//
// Sichtbarkeit regelt die Datenbank (einschränkende Regeln):
// - bereich gesetzt  → nur wer diesen Bereich sehen darf (darf_bereich), "privat" darf jeder …
// - privat_besitzer gesetzt → … aber nur der Besitzer selbst. Private Einträge sieht sonst niemand.
// Wird ein Eintrag einer Akte zugeordnet, übernimmt er deren Bereich und bei privaten Akten deren
// Besitzer (siehe zuordnungFuer). Ohne Akte: bereich und privat_besitzer leer → alle Mitarbeiter.
import { supabase } from './supabaseClient'
import type { Kunde, KundeBereich } from '../types'

export type KvStatus = 'offen' | 'angenommen' | 'abgelehnt' | 'bezahlt'

export const KV_STATUS: { id: KvStatus; label: string }[] = [
  { id: 'offen', label: 'Offen' },
  { id: 'angenommen', label: 'Angenommen' },
  { id: 'abgelehnt', label: 'Abgelehnt' },
  { id: 'bezahlt', label: 'Bezahlt' },
]

/**
 * Eine Position eines selbst erstellten Kostenvoranschlags (20.11.2026). Preise netto wie in der
 * Preisliste (leistungen_preisliste, Seite Unternehmensberatung → Leistungen); leistungId, wenn die
 * Position aus der Preisliste stammt.
 */
export type KvPosition = {
  id: string
  bezeichnung: string
  menge: number
  einheit: string
  /** Netto-Einzelpreis vor Auf-/Abschlag. */
  einzelpreis: number
  leistungId?: string
}

export const KV_EINHEITEN = ['Stunde', 'Tag', 'Pauschal', 'Stück'] as const

export type KvRechnung = {
  /** Summe der Positionen netto vor Auf-/Abschlag. */
  grundsumme: number
  /** Auf-/Abschlag in Euro (negativ = Nachlass). */
  aufschlag: number
  netto: number
  ust: number
  brutto: number
}

export function rundeCent(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Einzelpreis nach Auf-/Abschlag (so steht er auf dem Kostenvoranschlag für den Kunden). */
export function preisMitAufschlag(einzelpreis: number, aufschlagProzent: number): number {
  return rundeCent(einzelpreis * (1 + (aufschlagProzent || 0) / 100))
}

/**
 * Rechnet einen Kostenvoranschlag aus. Der Auf-/Abschlag steckt in den Einzelpreisen (der Kunde sieht
 * nur die angepassten Preise); netto ist die Summe der angepassten Positionen, darauf die Umsatzsteuer.
 */
export function berechneKv(positionen: KvPosition[], aufschlagProzent: number, ustSatz: number): KvRechnung {
  const grundsumme = rundeCent(positionen.reduce((s, p) => s + p.menge * p.einzelpreis, 0))
  const netto = rundeCent(positionen.reduce((s, p) => s + rundeCent(p.menge * preisMitAufschlag(p.einzelpreis, aufschlagProzent)), 0))
  const ust = rundeCent(netto * (ustSatz || 0) / 100)
  return { grundsumme, aufschlag: rundeCent(netto - grundsumme), netto, ust, brutto: rundeCent(netto + ust) }
}

/** Verweis auf eine Datei, die in einer Kundenakte unter Dokumente liegt. */
export type KvDokument = { kundeId: string; dokumentId: string; name: string }

export type Kostenvoranschlag = {
  id: string
  kundeId?: string
  bereich?: string
  privatBesitzer?: string
  /** Für wen bzw. von wem (Name so wie notiert). */
  name: string
  /** Worum es geht, z. B. "Küche, Bad" oder "Fenster". */
  beschreibung: string
  /** Betrag in Euro; leer, wenn noch keiner bekannt ist. */
  betrag?: number
  status: KvStatus
  /** JJJJ-MM-TT */
  datum?: string
  notiz: string
  dokument?: KvDokument
  /** Nur bei im CRM berechneten Kostenvoranschlägen; betrag ist dann der Bruttobetrag. */
  positionen?: KvPosition[]
  aufschlagProzent?: number
  ustSatz?: number
  quelle: string
  erstelltVon: string
  erstelltAm: string
  geaendertAm: string
}

function client() {
  if (!supabase) throw new Error('Kostenvoranschläge brauchen die Verbindung zur Datenbank.')
  return supabase
}

/** Datenbank-Meldungen auf Deutsch (sonst erschienen sie roh und englisch in der Oberfläche). */
function fehler(e: { message?: string; code?: string } | null): Error {
  const m = String(e?.message ?? '')
  if (e?.code === 'PGRST116' || /coerce the result to a single JSON object/i.test(m)) return new Error('Den Eintrag gibt es nicht mehr oder er ist für dich nicht mehr sichtbar. Bitte die Seite neu laden.')
  if (/failed to fetch|network|load failed/i.test(m)) return new Error('Keine Verbindung zum Server. Bitte Internetverbindung prüfen und noch einmal versuchen.')
  if (/row-level security|permission denied|violates check constraint/i.test(m)) return new Error('Dafür fehlt dir die Berechtigung.')
  return new Error(`Speichern bzw. Laden hat nicht geklappt (${m || 'unbekannter Fehler'}).`)
}

/** Sammelakten (Ungeklärte Eingänge, Intern) geben keinen Bereich vor — wie im Assistenten. */
const SAMMELAKTEN = ['k_eingang_ungeklaert', 'k_intern_holding']

// deno-lint-ignore no-explicit-any
function ausZeile(z: any): Kostenvoranschlag {
  return {
    id: z.id,
    kundeId: z.kunde_id ?? undefined,
    bereich: z.bereich ?? undefined,
    privatBesitzer: z.privat_besitzer ?? undefined,
    name: z.name ?? '',
    beschreibung: z.beschreibung ?? '',
    betrag: z.betrag === null || z.betrag === undefined ? undefined : Number(z.betrag),
    status: (KV_STATUS.some((s) => s.id === z.status) ? z.status : 'offen') as KvStatus,
    datum: z.datum ?? undefined,
    notiz: z.notiz ?? '',
    dokument: z.dokument && typeof z.dokument === 'object' && z.dokument.kundeId ? z.dokument : undefined,
    positionen: Array.isArray(z.positionen) && z.positionen.length ? z.positionen : undefined,
    aufschlagProzent: z.aufschlag_prozent === null || z.aufschlag_prozent === undefined ? undefined : Number(z.aufschlag_prozent),
    ustSatz: z.ust_satz === null || z.ust_satz === undefined ? undefined : Number(z.ust_satz),
    quelle: z.quelle ?? '',
    erstelltVon: z.erstellt_von ?? '',
    erstelltAm: z.erstellt_am ?? '',
    geaendertAm: z.geaendert_am ?? '',
  }
}

/** Alle Kostenvoranschläge, die der angemeldete Mitarbeiter sehen darf (neueste zuerst). */
export async function ladeKostenvoranschlaege(): Promise<Kostenvoranschlag[]> {
  const { data, error } = await client().from('kostenvoranschlaege').select('*').order('datum', { ascending: false, nullsFirst: false }).order('erstellt_am', { ascending: false })
  if (error) throw fehler(error)
  return (data ?? []).map(ausZeile)
}

/** Nur die einer Akte. */
export async function ladeKostenvoranschlaegeFuerKunde(kundeId: string): Promise<Kostenvoranschlag[]> {
  const { data, error } = await client().from('kostenvoranschlaege').select('*').eq('kunde_id', kundeId).order('datum', { ascending: false, nullsFirst: false }).order('erstellt_am', { ascending: false })
  if (error) throw fehler(error)
  return (data ?? []).map(ausZeile)
}

/** bereich und privat_besitzer, die zu einer Akte passen (oder leer ohne Akte). */
export function zuordnungFuer(kunde?: Pick<Kunde, 'id' | 'verantwortlichEmail'> & { bereich?: KundeBereich | string }): { kunde_id: string | null; bereich: string | null; privat_besitzer: string | null } {
  if (!kunde) return { kunde_id: null, bereich: null, privat_besitzer: null }
  if (SAMMELAKTEN.includes(kunde.id)) return { kunde_id: kunde.id, bereich: null, privat_besitzer: null }
  const bereich = kunde.bereich ? String(kunde.bereich) : null
  return {
    kunde_id: kunde.id,
    bereich,
    privat_besitzer: bereich === 'privat' ? (kunde.verantwortlichEmail ?? '').toLowerCase() || null : null,
  }
}

export type KvEingabe = {
  name: string
  beschreibung?: string
  betrag?: number | null
  status?: KvStatus
  datum?: string | null
  notiz?: string
  dokument?: KvDokument | null
  /** null = keine Positionen (Betrag von Hand). */
  positionen?: KvPosition[] | null
  aufschlagProzent?: number | null
  ustSatz?: number | null
}

function eingabeZeile(e: Partial<KvEingabe>) {
  // deno-lint-ignore no-explicit-any
  const z: Record<string, any> = {}
  if (e.name !== undefined) z.name = e.name.trim()
  if (e.beschreibung !== undefined) z.beschreibung = e.beschreibung.trim() || null
  if (e.betrag !== undefined) z.betrag = e.betrag === null || Number.isNaN(e.betrag) ? null : e.betrag
  if (e.status !== undefined) z.status = e.status
  if (e.datum !== undefined) z.datum = e.datum || null
  if (e.notiz !== undefined) z.notiz = e.notiz.trim() || null
  if (e.dokument !== undefined) z.dokument = e.dokument
  if (e.positionen !== undefined) z.positionen = e.positionen && e.positionen.length ? e.positionen : null
  if (e.aufschlagProzent !== undefined) z.aufschlag_prozent = e.aufschlagProzent
  if (e.ustSatz !== undefined) z.ust_satz = e.ustSatz
  return z
}

export async function legeKostenvoranschlagAn(
  e: KvEingabe,
  zuordnung: ReturnType<typeof zuordnungFuer>,
  erstelltVon: string,
): Promise<Kostenvoranschlag> {
  if (!e.name.trim()) throw new Error('Bitte einen Namen angeben.')
  const id = `kv_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  const { data, error } = await client()
    .from('kostenvoranschlaege')
    .insert({ id, ...eingabeZeile({ status: 'offen', ...e }), ...zuordnung, quelle: 'Im CRM erfasst', erstellt_von: erstelltVon })
    .select('*')
    .single()
  if (error) throw fehler(error)
  return ausZeile(data)
}

/** Ändert nur die angegebenen Felder; mit `zuordnung` wird der Eintrag einer (anderen) Akte zugeordnet. */
export async function aendereKostenvoranschlag(id: string, e: Partial<KvEingabe>, zuordnung?: ReturnType<typeof zuordnungFuer>): Promise<Kostenvoranschlag> {
  const { data, error } = await client()
    .from('kostenvoranschlaege')
    .update({ ...eingabeZeile(e), ...(zuordnung ?? {}), geaendert_am: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw fehler(error)
  return ausZeile(data)
}

export async function loescheKostenvoranschlag(id: string): Promise<void> {
  const { error } = await client().from('kostenvoranschlaege').delete().eq('id', id)
  if (error) throw fehler(error)
}

export function kvSumme(liste: Kostenvoranschlag[]): number {
  return liste.reduce((s, k) => s + (k.betrag ?? 0), 0)
}

/** Gesamtsumme ohne abgelehnte Einträge, dazu wie viele (nicht abgelehnte) keinen Betrag haben. */
export function kvGesamt(liste: Kostenvoranschlag[]): { summe: number; ohneBetrag: number } {
  const zaehlen = liste.filter((k) => k.status !== 'abgelehnt')
  return { summe: kvSumme(zaehlen), ohneBetrag: zaehlen.filter((k) => k.betrag === undefined || k.betrag === null).length }
}
