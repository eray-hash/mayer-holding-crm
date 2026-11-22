// Daten für Prüfbildschirm, Liste und Vorbereitung der Gesprächs-App. Server-Aktionen dieses Teils:
// gespraech_uebernehmen, gespraech_akte_setzen, gespraech_vorbereitung (supabase/functions/email-gateway/
// gespraechUebernehmen.ts). Gelesen wird sonst mit dem eigenen Login (Zeilenschutz der Datenbank).

import { callAuthenticated } from '../../lib/emailGateway'
import { supabase } from '../../lib/supabaseClient'
import { GESPRAECH_SPEICHER, type GespraechAufnahme, type GespraechUebernommen } from '../typen'

export type Auswahl = {
  protokoll: true
  naechsteSchritte: boolean
  wiedervorlagen: number[]
  todos: number[]
  termine: number[]
  stammdaten: number[]
  audioInAkte: boolean
  fotosInAkte: boolean
  mailEntwurf: boolean
}

export type Bearbeitet = {
  zusammenfassung?: string
  naechste_schritte?: { text: string; faellig?: string; wer?: string }[]
  wiedervorlagen?: { titel: string; faellig: string }[]
  todos?: { text: string; faellig?: string; zustaendig?: string; zustaendig_email?: string }[]
  termine?: { titel: string; datum: string; uhrzeit?: string; ort?: string; mit?: string; dauer_min?: number }[]
  stammdaten?: { feld: string; wert: string }[]
  mail_entwurf?: { betreff: string; text: string }
}

export type UebernahmeErgebnis = { ok: true; zeilen: string[]; hinweise: string[]; uebernommen: GespraechUebernommen }

export async function uebernehmen(id: string, auswahl: Auswahl, bearbeitet: Bearbeitet): Promise<UebernahmeErgebnis> {
  return (await callAuthenticated({ action: 'gespraech_uebernehmen', id, auswahl, bearbeitet })) as UebernahmeErgebnis
}

export type NeueAkte = { bereich: string; firma: string; ansprechpartner?: string; telefon?: string; email?: string }

/** Fehler mit den Zusatzdaten der Antwort (z. B. `doppelt` bei einer schon vorhandenen Akte). */
export class ServerFehler extends Error {
  daten: Record<string, unknown>
  constructor(meldung: string, daten: Record<string, unknown> = {}) {
    super(meldung)
    this.daten = daten
  }
}

/** Wie callAuthenticated, behält aber die Zusatzdaten einer Fehlerantwort. */
async function rufeMitDaten(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = import.meta.env.VITE_EMAIL_GATEWAY_URL as string | undefined
  const geheim = import.meta.env.VITE_EMAIL_GATEWAY_SECRET as string | undefined
  if (!url) throw new ServerFehler('Der Server ist nicht eingerichtet.')
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const token = data.session?.access_token
  if (!token) throw new ServerFehler('Nicht angemeldet.')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(geheim ? { 'x-crm-secret': geheim } : {}) },
    body: JSON.stringify(body),
  })
  const antwort = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new ServerFehler(String(antwort.error ?? `Fehler beim Abruf (${res.status})`), antwort)
  return antwort
}

export async function akteSetzen(id: string, ziel: { kundeId: string } | { neu: NeueAkte; trotzDoppelt?: boolean }): Promise<{ kundeId: string; kundeBereich: string; angelegt: boolean }> {
  const d = await rufeMitDaten({ action: 'gespraech_akte_setzen', id, ...ziel })
  return { kundeId: String(d.kundeId), kundeBereich: String(d.kundeBereich ?? ''), angelegt: d.angelegt === true }
}

export type BriefingAntwort = {
  ok: true
  termin: { id: string; titel: string; beginn: string; ende: string; ort?: string | null; ganztags?: boolean | null } | null
  bezug: { art: 'kunde' | 'objekt'; id: string; bereich?: string } | null
  hinweis?: string
  briefing?: {
    kopf: string
    stand: string
    verantwortlich: string
    sachverhalt: string
    naechsteSchritte: string
    eckdaten: string[]
    kontakte: { datum: string; text: string }[]
    offen: string[]
    fehlend: string[]
    fehlendSeit: string
    geld: string[]
    link: string
    fehler: string[]
  }
  gespraechspunkte?: string[]
  text?: string
  vorgabe?: { terminId: string | null; kundeId: string | null; kundeBereich: string | null; objektId: string | null; titel: string }
}

export async function vorbereitung(ziel: { terminId?: string; kundeId?: string; objektId?: string }): Promise<BriefingAntwort> {
  return (await callAuthenticated({ action: 'gespraech_vorbereitung', ...ziel })) as BriefingAntwort
}

export async function eigeneEmail(): Promise<string> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  return String(data.session?.user?.email ?? '').toLowerCase()
}

export type TeamMitglied = { name: string; email: string; rolle: string | null; ist_admin: boolean | null; bereiche: string[] | null }

export async function ladeTeam(): Promise<TeamMitglied[]> {
  if (!supabase) return []
  const { data } = await supabase.from('mitarbeiter').select('name, email, rolle, ist_admin, bereiche').eq('aktiv', true)
  return ((data ?? []) as TeamMitglied[]).filter((m) => m.name && m.email).map((m) => ({ ...m, email: String(m.email).toLowerCase() }))
}

export type AkteKurz = { id: string; bereich: string; firma: string | null; ansprechpartner: string | null; telefon: string | null; email: string | null; anschrift: string | null }

export async function ladeAkte(id: string): Promise<AkteKurz | null> {
  if (!supabase || !id) return null
  const { data } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, telefon, email, anschrift').eq('id', id).maybeSingle()
  return (data as AkteKurz | null) ?? null
}

export function akteAnzeige(a: { firma?: string | null; ansprechpartner?: string | null; id?: string } | null | undefined): string {
  if (!a) return ''
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  if (f && p && f !== p) return `${p} · ${f}`
  return p || f || String(a.id ?? '')
}

/** Kurz gültige Links zu Dateien der eigenen Aufnahme (Ton, Fotos). Fehlende Dateien fehlen im Ergebnis. */
export async function signierteLinks(pfade: string[], sekunden = 3600): Promise<Map<string, string>> {
  const aus = new Map<string, string>()
  if (!supabase || pfade.length === 0) return aus
  const { data } = await supabase.storage.from(GESPRAECH_SPEICHER).createSignedUrls(pfade, sekunden)
  for (const e of data ?? []) if (e.signedUrl && e.path) aus.set(e.path, e.signedUrl)
  return aus
}

export const LISTEN_SPALTEN = 'id, mitarbeiter_email, kunde_id, kunde_bereich, objekt_id, termin_id, titel, art, status, fehler, dauer_s, erstellt_am, uebernommen'

export type ListenZeile = Pick<GespraechAufnahme, 'id' | 'mitarbeiter_email' | 'kunde_id' | 'kunde_bereich' | 'objekt_id' | 'termin_id' | 'titel' | 'art' | 'status' | 'fehler' | 'dauer_s' | 'erstellt_am' | 'uebernommen'>

/** Eigene Aufnahmen, neueste zuerst, seitenweise. */
export async function ladeEigeneAufnahmen(email: string, seite: number, groesse = 50): Promise<ListenZeile[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('gespraech_aufnahmen')
    .select(LISTEN_SPALTEN)
    .eq('mitarbeiter_email', email)
    .order('erstellt_am', { ascending: false })
    .range(seite * groesse, seite * groesse + groesse - 1)
  if (error) throw new Error(error.message)
  return (data ?? []) as ListenZeile[]
}

/** Namen der Akten zu einer Liste von Kennungen (nur sichtbare). */
export async function aktenNamen(ids: string[]): Promise<Map<string, string>> {
  const aus = new Map<string, string>()
  const offen = [...new Set(ids.filter(Boolean))]
  if (!supabase || offen.length === 0) return aus
  for (let i = 0; i < offen.length; i += 100) {
    const { data } = await supabase.from('kunden').select('id, firma, ansprechpartner').in('id', offen.slice(i, i + 100))
    for (const k of (data ?? []) as { id: string; firma: string | null; ansprechpartner: string | null }[]) aus.set(k.id, akteAnzeige(k))
  }
  return aus
}

export async function loescheAufnahme(id: string): Promise<void> {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank eingerichtet.')
  const { error } = await supabase.from('gespraech_aufnahmen').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------- Anzeige ----------

export const STATUS_NAME: Record<string, string> = {
  aufnahme: 'Wird aufgenommen',
  hochladen: 'Wird hochgeladen',
  transkription: 'Wird abgeschrieben',
  analyse: 'Wird ausgewertet',
  fertig: 'Fertig',
  fehler: 'Fehler',
  verworfen: 'Verworfen',
}

export const STATUS_FARBE: Record<string, string> = {
  aufnahme: 'bg-sky-100 text-sky-800',
  hochladen: 'bg-sky-100 text-sky-800',
  transkription: 'bg-amber-100 text-amber-800',
  analyse: 'bg-amber-100 text-amber-800',
  fertig: 'bg-emerald-100 text-emerald-800',
  fehler: 'bg-rose-100 text-rose-800',
  verworfen: 'bg-slate-100 text-slate-500',
}

export const ART_NAME: Record<string, string> = { termin: 'Kundentermin', telefon: 'Telefonat', notiz: 'Notiz' }

export function zeit(sek: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(sek) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export function datumZeit(iso: string | null | undefined): string {
  const d = new Date(String(iso ?? ''))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** JJJJ-MM-TT oder leer (für Datumsfelder). */
export function alsDatum(wert: unknown): string {
  const s = String(wert ?? '').trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  return de ? `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}` : ''
}

export function alsUhrzeit(wert: unknown): string {
  const m = String(wert ?? '').trim().match(/^(\d{1,2})[:.](\d{2})/)
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}
