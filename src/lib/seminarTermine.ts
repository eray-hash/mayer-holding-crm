// Seminartermine und Anmeldungen der Akademie (22.11.2026): Tabellen seminar_termine und seminar_anmeldungen.
// Zugriff wie der Bereich Akademie (darf_bereich('akademie') in der Datenbank). Die öffentliche Anmeldeseite
// /formular/seminar/:token läuft über email-gateway (seminarAnmeldung.ts). Automatische Mails an Teilnehmer
// merkt die Datenbank selbst vor (Regeln akademie_seminar_*, anfangs aus), verschickt vom Server.
import { supabase } from './supabaseClient'
import { call } from './emailGateway'
import { shareableUrl } from '../components/FormularLink'

export type TerminStatus = 'geplant' | 'abgesagt' | 'durchgefuehrt'
export type AnmeldeStatus = 'angemeldet' | 'bestaetigt' | 'warteliste' | 'storniert' | 'teilgenommen'

export type SeminarTermin = {
  id: string
  seminarId: string
  anmeldeToken: string
  beginn: string
  ende?: string
  ort?: string
  onlineLink?: string
  plaetze?: number
  preis?: number
  referent?: string
  verantwortlich?: string
  status: TerminStatus
  anmeldeschluss?: string
  oeffentlich: boolean
  notiz?: string
  erstelltVon?: string
  geaendertAm?: string
  geaendertVon?: string
}

export type SeminarAnmeldung = {
  id: string
  terminId: string
  kundeId?: string
  name: string
  firma?: string
  email?: string
  telefon?: string
  status: AnmeldeStatus
  zustimmung?: { am: string; teilnahmebedingungen: boolean | null; datenschutz: boolean }
  quelle: 'formular' | 'hand'
  rechnungId?: string
  notiz?: string
  erstelltAm: string
  erstelltVon?: string
}

export const TERMIN_STATUS: { id: TerminStatus; label: string; farbe: string }[] = [
  { id: 'geplant', label: 'Geplant', farbe: 'bg-sky-50 text-sky-700' },
  { id: 'durchgefuehrt', label: 'Durchgeführt', farbe: 'bg-emerald-50 text-emerald-700' },
  { id: 'abgesagt', label: 'Abgesagt', farbe: 'bg-rose-50 text-rose-700' },
]

export const ANMELDE_STATUS: { id: AnmeldeStatus; label: string; farbe: string }[] = [
  { id: 'angemeldet', label: 'Angemeldet', farbe: 'bg-sky-50 text-sky-700' },
  { id: 'bestaetigt', label: 'Bestätigt', farbe: 'bg-cyan-50 text-cyan-700' },
  { id: 'warteliste', label: 'Warteliste', farbe: 'bg-amber-50 text-amber-700' },
  { id: 'teilgenommen', label: 'Teilgenommen', farbe: 'bg-emerald-50 text-emerald-700' },
  { id: 'storniert', label: 'Storniert', farbe: 'bg-slate-100 text-slate-500' },
]

/** Diese Stände belegen einen Platz. */
export const BELEGT: AnmeldeStatus[] = ['angemeldet', 'bestaetigt', 'teilgenommen']

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

function fehler(e: { message?: string; code?: string } | null): Error {
  const m = e?.message ?? ''
  if (/row-level security|permission denied/i.test(m)) return new Error('Für die Akademie hast du keine Berechtigung.')
  if (e?.code === '23505' || /seminar_anmeldungen_email_einmal/.test(m)) return new Error('Diese E-Mail-Adresse ist für diesen Termin schon angemeldet.')
  if (/seminar_termine_seminar_id_fkey/.test(m)) return new Error('Zu diesem Seminar gibt es noch Termine. Bitte zuerst die Termine löschen.')
  return new Error(m ? `Das hat nicht geklappt: ${m}` : 'Das hat nicht geklappt.')
}

const leer = <T,>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function terminAus(z: any): SeminarTermin {
  return {
    id: z.id,
    seminarId: z.seminar_id,
    anmeldeToken: z.anmelde_token,
    beginn: z.beginn,
    ende: leer(z.ende),
    ort: leer(z.ort),
    onlineLink: leer(z.online_link),
    plaetze: z.plaetze === null || z.plaetze === undefined ? undefined : Number(z.plaetze),
    preis: z.preis === null || z.preis === undefined ? undefined : Number(z.preis),
    referent: leer(z.referent),
    verantwortlich: leer(z.verantwortlich),
    status: z.status,
    anmeldeschluss: leer(z.anmeldeschluss),
    oeffentlich: !!z.oeffentlich,
    notiz: leer(z.notiz),
    erstelltVon: leer(z.erstellt_von),
    geaendertAm: leer(z.geaendert_am),
    geaendertVon: leer(z.geaendert_von),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function anmeldungAus(z: any): SeminarAnmeldung {
  return {
    id: z.id,
    terminId: z.termin_id,
    kundeId: leer(z.kunde_id),
    name: z.name,
    firma: leer(z.firma),
    email: leer(z.email),
    telefon: leer(z.telefon),
    status: z.status,
    zustimmung: z.zustimmung ? { am: z.zustimmung.am, teilnahmebedingungen: z.zustimmung.teilnahmebedingungen ?? null, datenschutz: !!z.zustimmung.datenschutz } : undefined,
    quelle: z.quelle,
    rechnungId: leer(z.rechnung_id),
    notiz: leer(z.notiz),
    erstelltAm: z.erstellt_am,
    erstelltVon: leer(z.erstellt_von),
  }
}

// ---------- Termine ----------

export async function ladeTermine(filter: { seminarId?: string } = {}): Promise<SeminarTermin[]> {
  let q = client().from('seminar_termine').select('*').order('beginn', { ascending: true })
  if (filter.seminarId) q = q.eq('seminar_id', filter.seminarId)
  const { data, error } = await q
  if (error) throw fehler(error)
  return (data ?? []).map(terminAus)
}

export async function ladeTermin(id: string): Promise<SeminarTermin | null> {
  const { data, error } = await client().from('seminar_termine').select('*').eq('id', id).maybeSingle()
  if (error) throw fehler(error)
  return data ? terminAus(data) : null
}

export type TerminEingabe = Partial<Pick<SeminarTermin, 'beginn' | 'ende' | 'ort' | 'onlineLink' | 'plaetze' | 'preis' | 'referent' | 'verantwortlich' | 'status' | 'anmeldeschluss' | 'oeffentlich' | 'notiz'>>

function terminZeile(e: TerminEingabe): Record<string, unknown> {
  const z: Record<string, unknown> = {}
  const t = (v?: string) => (v ?? '').trim() || null
  if (e.beginn !== undefined) z.beginn = e.beginn
  if (e.ende !== undefined) z.ende = e.ende || null
  if (e.ort !== undefined) z.ort = t(e.ort)
  if (e.onlineLink !== undefined) z.online_link = t(e.onlineLink)
  if ('plaetze' in e) z.plaetze = e.plaetze ?? null
  if ('preis' in e) z.preis = e.preis ?? null
  if (e.referent !== undefined) z.referent = t(e.referent)
  if (e.verantwortlich !== undefined) z.verantwortlich = t(e.verantwortlich)
  if (e.status !== undefined) z.status = e.status
  if ('anmeldeschluss' in e) z.anmeldeschluss = e.anmeldeschluss || null
  if (e.oeffentlich !== undefined) z.oeffentlich = e.oeffentlich
  if (e.notiz !== undefined) z.notiz = t(e.notiz)
  return z
}

export async function legeTerminAn(seminarId: string, e: TerminEingabe & { beginn: string }, von: string): Promise<SeminarTermin> {
  const { data, error } = await client()
    .from('seminar_termine')
    .insert({ ...terminZeile(e), seminar_id: seminarId, erstellt_von: von, geaendert_von: von })
    .select('*')
    .single()
  if (error) throw fehler(error)
  return terminAus(data)
}

export async function aendereTermin(id: string, e: TerminEingabe, von: string): Promise<void> {
  const { error } = await client().from('seminar_termine').update({ ...terminZeile(e), geaendert_am: new Date().toISOString(), geaendert_von: von }).eq('id', id)
  if (error) throw fehler(error)
}

export async function loescheTermin(id: string): Promise<void> {
  const { error } = await client().from('seminar_termine').delete().eq('id', id)
  if (error) throw fehler(error)
}

/** Neuer Anmeldelink — der alte funktioniert danach nicht mehr. */
export async function erneuereAnmeldeLink(id: string, von: string): Promise<void> {
  const { error } = await client().from('seminar_termine').update({ anmelde_token: crypto.randomUUID(), geaendert_am: new Date().toISOString(), geaendert_von: von }).eq('id', id)
  if (error) throw fehler(error)
}

export const anmeldeLink = (token: string) => shareableUrl(`/formular/seminar/${token}`)

// ---------- Anmeldungen ----------

export async function ladeAnmeldungen(filter: { terminId?: string; terminIds?: string[]; kundeId?: string }): Promise<SeminarAnmeldung[]> {
  let q = client().from('seminar_anmeldungen').select('*').order('erstellt_am', { ascending: true })
  if (filter.terminId) q = q.eq('termin_id', filter.terminId)
  if (filter.terminIds) {
    if (filter.terminIds.length === 0) return []
    q = q.in('termin_id', filter.terminIds)
  }
  if (filter.kundeId) q = q.eq('kunde_id', filter.kundeId)
  const { data, error } = await q
  if (error) throw fehler(error)
  return (data ?? []).map(anmeldungAus)
}

export async function legeAnmeldungAn(
  e: { terminId: string; kundeId?: string; name: string; firma?: string; email?: string; telefon?: string; status: AnmeldeStatus; notiz?: string },
  von: string,
): Promise<SeminarAnmeldung> {
  const t = (v?: string) => (v ?? '').trim() || null
  const { data, error } = await client()
    .from('seminar_anmeldungen')
    .insert({
      termin_id: e.terminId,
      kunde_id: e.kundeId ?? null,
      name: e.name.trim(),
      firma: t(e.firma),
      email: t(e.email)?.toLowerCase() ?? null,
      telefon: t(e.telefon),
      status: e.status,
      notiz: t(e.notiz),
      quelle: 'hand',
      erstellt_von: von,
      geaendert_von: von,
    })
    .select('*')
    .single()
  if (error) throw fehler(error)
  return anmeldungAus(data)
}

export async function aendereAnmeldung(id: string, e: Partial<Pick<SeminarAnmeldung, 'status' | 'notiz' | 'email' | 'telefon' | 'firma' | 'name'>>, von: string): Promise<void> {
  const z: Record<string, unknown> = { geaendert_am: new Date().toISOString(), geaendert_von: von }
  if (e.status !== undefined) z.status = e.status
  if (e.notiz !== undefined) z.notiz = e.notiz.trim() || null
  if (e.email !== undefined) z.email = e.email.trim().toLowerCase() || null
  if (e.telefon !== undefined) z.telefon = e.telefon.trim() || null
  if (e.firma !== undefined) z.firma = e.firma.trim() || null
  if (e.name !== undefined) z.name = e.name.trim()
  const { error } = await client().from('seminar_anmeldungen').update(z).eq('id', id)
  if (error) throw fehler(error)
}

export async function loescheAnmeldung(id: string): Promise<void> {
  const { error } = await client().from('seminar_anmeldungen').delete().eq('id', id)
  if (error) throw fehler(error)
}

/** Wartet, bis eine gerade im CRM angelegte Akte in der Datenbank steht (das CRM schreibt im Hintergrund).
 *  Nötig, weil die Anmeldung auf die Akte verweist. true = da. */
export async function warteAufAkte(kundeId: string, versuche = 15): Promise<boolean> {
  for (let i = 0; i < versuche; i++) {
    const { data } = await client().from('kunden').select('id').eq('id', kundeId).maybeSingle()
    if (data) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

export function belegung(liste: SeminarAnmeldung[], plaetze?: number) {
  const belegt = liste.filter((a) => BELEGT.includes(a.status)).length
  const warteliste = liste.filter((a) => a.status === 'warteliste').length
  return { belegt, warteliste, frei: plaetze === undefined ? undefined : Math.max(0, plaetze - belegt), voll: plaetze !== undefined && belegt >= plaetze }
}

// ---------- Anzeige ----------

const DATUM = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })

/** "Do., 03.12.2026, 09:00 bis 17:00 Uhr" */
export function terminZeit(beginn: string, ende?: string): string {
  const b = new Date(beginn)
  if (!ende) return `${DATUM.format(b)}, ${UHR.format(b)} Uhr`
  const e = new Date(ende)
  return DATUM.format(e) === DATUM.format(b) ? `${DATUM.format(b)}, ${UHR.format(b)} bis ${UHR.format(e)} Uhr` : `${DATUM.format(b)}, ${UHR.format(b)} Uhr bis ${DATUM.format(e)}, ${UHR.format(e)} Uhr`
}

/** ISO → Wert für <input type="datetime-local"> in deutscher Zeit. */
export function alsEingabeZeit(iso?: string): string {
  if (!iso) return ''
  const t = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  )
  return `${t.year}-${t.month}-${t.day}T${t.hour}:${t.minute}`
}

/** Wert aus <input type="datetime-local"> (deutsche Zeit) → ISO. Der Browser kennt die Zeitzone des Geräts;
 *  die Mitarbeiter sitzen in Deutschland, deshalb genügt new Date(). */
export function ausEingabeZeit(wert: string): string | undefined {
  if (!wert) return undefined
  const d = new Date(wert)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

// ---------- CSV ----------

export function teilnehmerCsv(liste: SeminarAnmeldung[]): string {
  const zelle = (v: unknown) => {
    const s = String(v ?? '')
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const kopf = ['Name', 'Firma', 'E-Mail', 'Telefon', 'Stand', 'Eingetragen über', 'Eingetragen am', 'Notiz']
  const zeilen = liste.map((a) => [
    a.name,
    a.firma,
    a.email,
    a.telefon,
    ANMELDE_STATUS.find((s) => s.id === a.status)?.label ?? a.status,
    a.quelle === 'formular' ? 'Formular' : 'von Hand',
    new Date(a.erstelltAm).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
    a.notiz,
  ])
  // Semikolon und BOM: so öffnet Excel die Datei in Deutschland richtig.
  return '﻿' + [kopf, ...zeilen].map((z) => z.map(zelle).join(';')).join('\r\n')
}

// ---------- Automatische Nachrichten der Akademie ----------

export type AkademieRegel = { id: string; titel: string; beschreibung: string; aktiv: boolean; wartezeitMinuten: number | null }
export type AkademieNachricht = { id: string; regel: string; anmeldungId?: string; an?: string; anName?: string; betreff?: string; text?: string; status: string; sendenAb: string; gesendetAm?: string; grund?: string }

export async function ladeAkademieRegeln(): Promise<AkademieRegel[]> {
  const { data, error } = await client().from('auto_nachricht_regeln').select('*').eq('bereich', 'akademie').order('reihenfolge')
  if (error) throw fehler(error)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((z: any) => ({ id: z.id, titel: z.titel, beschreibung: z.beschreibung ?? '', aktiv: !!z.aktiv, wartezeitMinuten: z.wartezeit_minuten ?? null }))
}

export async function ladeTerminNachrichten(terminId: string): Promise<AkademieNachricht[]> {
  const { data, error } = await client().from('auto_nachrichten').select('*').eq('bereich', 'akademie').eq('termin_id', terminId).order('senden_ab', { ascending: false }).limit(300)
  if (error) throw fehler(error)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((z: any) => ({
    id: z.id,
    regel: z.regel,
    anmeldungId: leer(z.anmeldung_id),
    an: leer(z.an),
    anName: leer(z.an_name),
    betreff: leer(z.betreff),
    text: leer(z.text),
    status: z.status,
    sendenAb: z.senden_ab,
    gesendetAm: leer(z.gesendet_am),
    grund: leer(z.grund),
  }))
}

export function regelZeitText(r: Pick<AkademieRegel, 'id' | 'wartezeitMinuten'>): string {
  if (r.id === 'akademie_seminar_erinnerung') return 'zwei Tage vor Beginn'
  const m = r.wartezeitMinuten ?? 0
  return m === 0 ? 'sofort' : m < 60 ? `nach ${m} Minuten` : `nach ${m / 60} Std.`
}

// ---------- öffentliche Seite ----------

export type TerminSeite =
  | { stufe: 'ungueltig'; grund: string }
  | {
      stufe: 'offen'
      seminar: { titel: string; beschreibung: string; dauer: string; bereich: string }
      termin: { beginn: string; ende: string | null; ort: string; online: boolean; referent: string; preis: number | null; anmeldeschluss: string | null }
      freiePlaetze: number | null
      texte: { teilnahmebedingungen: string; datenschutz: string }
    }

export type AnmeldeErgebnis =
  | { stufe: 'ungueltig'; grund: string }
  | { stufe: 'fehler'; grund: string }
  | { stufe: 'angemeldet' | 'warteliste'; name: string; seminar: string; beginn: string; schonAngemeldet?: boolean }

export async function holeTerminSeite(token: string): Promise<TerminSeite> {
  return (await call({ action: 'public_seminar_termin', token })) as TerminSeite
}

export async function meldeAn(
  token: string,
  e: { name: string; firma: string; email: string; telefon: string; teilnahmebedingungen: boolean; datenschutz: boolean; webseite: string },
): Promise<AnmeldeErgebnis> {
  return (await call({ action: 'public_seminar_anmelden', token, ...e })) as AnmeldeErgebnis
}
