// Morgen-Übersicht und Wochenbericht per Telegram — ohne offenes Browserfenster, ohne Klick und ohne KI.
//
// - Morgen-Übersicht: an Werktagen (Montag bis Freitag) beim ersten Minutentakt ab 8 Uhr Berliner Zeit,
//   spätestens bis 11 Uhr. Ein verpasster Morgen wird übersprungen, nicht mittags nachgeholt. Jeder
//   aktive Mitarbeiter mit Telegram bekommt eine kurze Nachricht mit dem, was IHN heute betrifft:
//   Termine, fällige Wiedervorlagen (Kontakte und Objekte, bei denen er verantwortlich ist), eigene
//   fällige Aufgaben, neue Treffer der letzten 24 Stunden; Geschäftsführung und Admins zusätzlich die
//   offenen Fragen an die Geschäftsführung. Dazu die Zahl der Dateien in „Ungeklärte Eingänge“.
//   Steht nichts an, geht keine Nachricht raus. Freigeschaltete mit Microsoft-Konto bekommen zusätzlich einen
//   Hotmail-Teil (hotmailBriefing.ts: Dringendes, neue Rechnungen, wichtige Mails, markierte — ohne Beträge).
//   Benutzt jemand den privaten Assistenten (eigener Bot, _shared/telegramPrivat.ts), kommt der Hotmail-Teil
//   stattdessen als eigene kurze „Privat-Übersicht“ über diesen Bot; die Mayer-Nachricht bleibt sonst gleich.
//   Klappt das Senden dort nicht, geht sie verloren statt über den Mayer-Bot (Privates bleibt privat, 23.11.2026).
// - Umsatzziel (seit 24.11.2026, umsatzZiel.ts): Geschäftsführung und Admins bekommen in der Morgen-Übersicht einen
//   Abschnitt „Umsatzziel <Monat>: Ist von Soll“ — nur mit eingeschaltetem Schalter (Vorgabe aus). Mit Schalter an
//   geht die Morgen-Übersicht an sie also an jedem Werktag hinaus, auch wenn sonst nichts ansteht.
// - Wochenbericht: freitags ab 16 Uhr (bis 19 Uhr), nur Geschäftsführung und Admins. Nur Zahlen.
//   Nicht an Empfänger des Wochenrückblicks (wochenrueckblick.ts, Einstellung berichtAn): die bekommen nur den
//   Rückblick (seit 22.11.2026 — vorher kamen freitags drei Berichte).
// - Abschalten kann jeder für sich (`kalender_einstellungen.morgen_uebersicht` / `.wochenbericht`;
//   keine Zeile oder kein Wert = an).
// - Höchstens einmal je Person und Tag: Eine Buchhaltungszeile in `abteilung_eintraege`
//   (id `tagesmeldung_stand`) hält je E-Mail den Tag der letzten Nachricht fest. Wer senden will, stellt
//   diese Zeile VOR dem Senden mit einer bedingten Änderung weiter (wie gesuchTreffer.ts). Laufen zwei
//   Aufrufe gleichzeitig, gewinnt nur einer; der andere sendet nichts.
// - Bereichsrechte wie überall auf dem Server (darfBereichServer in index.ts, darf_bereich in der
//   Datenbank): Wiedervorlagen, Aufgaben und Treffer aus Bereichen, die jemand nicht sehen darf, fehlen.
//   Private Objekte (objekte.privat_besitzer) und private Treffer (art „privat_treffer“) nur an ihren
//   Besitzer; Zahlen für alle (Wochenbericht) ohne private Objekte.
// - Eigene To-do-Liste und Microsoft To Do (Runde 6, 23.11.2026) — „Privat bleibt privat“ wie todoAufraeumenHinweis.ts:
//   Aufgaben aus Microsoft To Do (todos.ms_id) stehen nie in der Nachricht über den Mayer-Bot. Nutzt die Person den
//   privaten Assistenten, gilt ihre ganze eigene Liste als privat: sie kommt nur in die Privat-Übersicht über den
//   privaten Bot (dort auch Microsoft-Aufgaben). Microsoft-Aufgaben älter als 90 Tage und solche aus ausgeblendeten
//   Listen (ms_konten.stand.todoListen, z. B. „Flagged Emails“) fehlen ganz. Reihenfolge: heute Fälliges, dann die
//   neuesten Überfälligen zuerst (vorher kamen Fristen aus 2020 zuerst).
// - Nie Mailtexte oder Inhalte von Dokumenten — nur Titel und Namen.
// - Wirft nie: Fehler stehen im Protokoll, der nächste Takt versucht es erneut.

import { hotmailAbschnitte } from './hotmailBriefing.ts'
import { privatBotAktiv, sendePrivat } from '../_shared/telegramPrivat.ts'
import { privatMorgenplanAktiv } from './privatTagesplan.ts'
import { darfObjekt, istPrivatesObjekt, nurMayerObjekte, normalisiereAdresse } from '../_shared/privatZugriff.ts'
import { wochenrueckblickAdressen } from './wochenrueckblickEmpfaenger.ts'
import { ausgeblendeteListen } from './todoAbgleich.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'
import { spartenFuerBereiche, umsatzZielAbschnitt } from './umsatzZiel.ts'
import { istPrivaterTermin } from '../_shared/privatGrenze.ts'

// Der Dienst-Zugang zur Datenbank — wie in gesuchTreffer.ts.
// deno-lint-ignore no-explicit-any
type Db = any

export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>

/** Senden über den privaten Bot (Standard: _shared/telegramPrivat.ts). */
const sendeUeberPrivatBot: SendeFunktion = async (chatId, text) => !!(await sendePrivat(chatId, text))
export type TagesErgebnis = { morgen: number; woche: number }

const TABELLE = 'abteilung_eintraege'
const STAND_ID = 'tagesmeldung_stand'
const AKTE_UNGEKLAERT = 'k_eingang_ungeklaert'
const AKTEN_FUER_ALLE = new Set(['k_eingang_ungeklaert', 'k_intern_holding'])

/** Zeitfenster in Berliner Stunden: [ab, bis). */
const MORGEN_AB = 8
const MORGEN_BIS = 11
const WOCHE_AB = 16
const WOCHE_BIS = 19
const HOECHSTENS_ZEILEN = 25

const BEREICH_NAMEN: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  immobilienkunden: 'Immobilien',
}
const WOCHENTAG_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

// ---------------------------------------------------------------------------------------------
// Zeit in Berlin
// ---------------------------------------------------------------------------------------------

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export type BerlinZeit = { datum: string; stunde: number; minute: number; /** 0 = Sonntag … 6 = Samstag */ wochentag: number }

function zwei(n: number): string {
  return String(n).padStart(2, '0')
}

export function berlinZeit(jetzt: Date): BerlinZeit {
  const teile: Record<string, string> = {}
  for (const t of BERLIN.formatToParts(jetzt)) teile[t.type] = t.value
  const y = Number(teile.year)
  const m = Number(teile.month)
  const d = Number(teile.day)
  return {
    datum: `${y}-${zwei(m)}-${zwei(d)}`,
    stunde: Number(teile.hour) % 24,
    minute: Number(teile.minute),
    wochentag: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
  }
}

/** yyyy-mm-dd plus n Tage (reine Kalenderrechnung). */
export function plusTage(datum: string, n: number): string {
  const [y, m, d] = datum.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${zwei(t.getUTCMonth() + 1)}-${zwei(t.getUTCDate())}`
}

/** Der Zeitpunkt, an dem in Berlin der Tag `datum` beginnt (0:00 Uhr Ortszeit). */
export function berlinTagesbeginn(datum: string): Date {
  const [y, m, d] = datum.split('-').map(Number)
  const alsUtc = Date.UTC(y, m - 1, d)
  let t = alsUtc
  // Zweimal: Der Versatz (eine oder zwei Stunden) hängt vom Zeitpunkt selbst ab.
  for (let i = 0; i < 2; i++) {
    const b = berlinZeit(new Date(t))
    const [by, bm, bd] = b.datum.split('-').map(Number)
    const versatz = Date.UTC(by, bm - 1, bd, b.stunde, b.minute) - Math.floor(t / 60000) * 60000
    t = alsUtc - versatz
  }
  return new Date(t)
}

/** Berliner Kalendertag eines Zeitstempels oder Datums; leer, wenn nichts zu erkennen ist. */
export function alsDatum(wert: unknown): string {
  if (typeof wert !== 'string') return ''
  const s = wert.trim()
  const zeit = /^(\d{4})-(\d{2})-(\d{2})T\d/.exec(s)
  if (zeit && /(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? '' : berlinZeit(d).datum
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const deutsch = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s)
  if (deutsch) return `${deutsch[3].length === 2 ? `20${deutsch[3]}` : deutsch[3]}-${deutsch[2].padStart(2, '0')}-${deutsch[1].padStart(2, '0')}`
  return ''
}

/** „2026-11-18“ → „18.11.“ */
function tagMonat(datum: string): string {
  const [, m, d] = datum.split('-')
  return `${d}.${m}.`
}

const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Morgen-Übersicht fällig? Werktag und 8:00 bis 10:59 Uhr Berliner Zeit. */
export function imMorgenfenster(jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  return b.wochentag >= 1 && b.wochentag <= 5 && b.stunde >= MORGEN_AB && b.stunde < MORGEN_BIS
}

/** Wochenbericht fällig? Freitag 16:00 bis 18:59 Uhr Berliner Zeit. */
export function imWochenfenster(jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  return b.wochentag === 5 && b.stunde >= WOCHE_AB && b.stunde < WOCHE_BIS
}

// ---------------------------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------------------------

function text(wert: unknown): string {
  return typeof wert === 'string' ? wert : wert == null ? '' : String(wert)
}

function alsObjekt(wert: unknown): Record<string, unknown> | null {
  return wert && typeof wert === 'object' && !Array.isArray(wert) ? (wert as Record<string, unknown>) : null
}

function kurz(wert: string, laenge = 60): string {
  const sauber = wert.replace(/\s+/g, ' ').trim()
  return sauber.length <= laenge ? sauber : `${sauber.slice(0, laenge - 1).trimEnd()}…`
}

function euro(betrag: number): string {
  return `${betrag.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

function woerter(t: string): string[] {
  return t.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)
}

/** Steht in „verantwortlich“/„zuständig“ diese Person? Dieselbe Regel wie gehoertMir in
 *  src/pages/immobilien/Tagesablauf.tsx: voller Name, nur Vor- oder Nachname, abgekürzter zweiter Teil
 *  und Aufzählungen. Ein anderer voller Name mit gleichem Nachnamen zählt nicht. */
export function gehoertZu(angabe: string | null | undefined, name: string): boolean {
  const schluessel = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  const meinName = schluessel(name)
  const t = schluessel(angabe ?? '')
  if (!t || !meinName) return false
  if (t.includes(meinName)) return true
  const teile = woerter(meinName).filter((w) => w.length >= 3)
  if (teile.length === 0) return false
  return t.split(/[,;/&+]|\s+und\s+/).some((eintrag) => {
    const w = woerter(eintrag)
    return w.some((x) => teile.includes(x)) && w.every((x) => teile.includes(x) || (x.length === 1 && teile.some((p) => p.startsWith(x))))
  })
}

// ---------------------------------------------------------------------------------------------
// Personen und Rechte
// ---------------------------------------------------------------------------------------------

export type Person = {
  email: string
  name: string
  chat: number | string | null
  /** Geschäftsführung oder Admin: sieht alles, bekommt Fragen an die GF und den Wochenbericht. */
  gf: boolean
  bereiche: string[]
}

/** Dieselbe Regel wie darfBereichServer in index.ts (und darf_bereich in der Datenbank). Private
 *  Kontakte prüft der Aufrufer selbst: die sieht nur, wem sie gehören. */
export function darfBereich(p: Person, bereich: string | null | undefined): boolean {
  if (!bereich || bereich === 'intern') return true
  if (p.gf) return true
  const kennung = bereich === 'immobilienkunden' ? 'immobilien' : bereich
  return p.bereiche.includes(kennung)
}

function darfKunde(p: Person, k: { id: string; bereich?: string | null; verantwortlich_email?: string | null }): boolean {
  if (AKTEN_FUER_ALLE.has(k.id)) return true
  if (k.bereich === 'privat') return text(k.verantwortlich_email).trim().toLowerCase() === p.email
  return darfBereich(p, k.bereich)
}

async function ladeTeam(admin: Db): Promise<Person[]> {
  const { data, error } = await admin.from('mitarbeiter').select('name, email, rolle, ist_admin, aktiv, bereiche, telegram_chat_id').eq('aktiv', true)
  if (error) throw new Error(`mitarbeiter: ${error.message}`)
  const team: Person[] = []
  // deno-lint-ignore no-explicit-any
  for (const m of (data ?? []) as any[]) {
    const email = text(m.email).trim().toLowerCase()
    if (!email || m.aktiv !== true) continue
    team.push({
      email,
      name: text(m.name).trim(),
      chat: m.telegram_chat_id == null || m.telegram_chat_id === '' ? null : m.telegram_chat_id,
      gf: m.rolle === 'geschaeftsfuehrung' || m.ist_admin === true,
      bereiche: Array.isArray(m.bereiche) ? m.bereiche.map(text) : [],
    })
  }
  return team
}

type Einstellung = { morgen: boolean; woche: boolean }

async function ladeEinstellungen(admin: Db): Promise<Map<string, Einstellung>> {
  const { data, error } = await admin.from('kalender_einstellungen').select('email, morgen_uebersicht, wochenbericht')
  // Lieber gar nicht senden als an jemanden, der abgeschaltet hat: Der Fehler bricht den Lauf ab.
  if (error) throw new Error(`kalender_einstellungen: ${error.message}`)
  const m = new Map<string, Einstellung>()
  // deno-lint-ignore no-explicit-any
  for (const z of (data ?? []) as any[]) {
    m.set(text(z.email).trim().toLowerCase(), { morgen: z.morgen_uebersicht !== false, woche: z.wochenbericht !== false })
  }
  return m
}

// ---------------------------------------------------------------------------------------------
// Daten
// ---------------------------------------------------------------------------------------------

/** Liest eine Tabelle vollständig, seitenweise (wie in gesuchTreffer.ts). */
// deno-lint-ignore no-explicit-any
async function ladeAlle(admin: Db, tabelle: string, spalten: string, art?: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const alle: any[] = []
  for (;;) {
    let abfrage = admin.from(tabelle).select(spalten)
    if (art) abfrage = abfrage.eq('art', art)
    const { data, error } = await abfrage.order('id').range(alle.length, alle.length + 999)
    if (error) throw new Error(`${tabelle}: ${error.message}`)
    const seite = Array.isArray(data) ? data : []
    if (seite.length === 0) return alle
    alle.push(...seite)
  }
}

type FollowUp = { date?: unknown; done?: unknown }
type KundeZeile = {
  id: string
  bereich?: string | null
  firma?: string | null
  ansprechpartner?: string | null
  verantwortlich?: string | null
  verantwortlich_email?: string | null
  follow_up?: FollowUp | null
  activities?: unknown
}
type ObjektZeile = { id: string; bezeichnung?: string | null; adresse?: string | null; verantwortlich?: string | null; follow_up?: FollowUp | null; activities?: unknown; privat_besitzer?: string | null }
type TerminZeile = { id: string; titel?: string | null; beginn: string; ende: string; ganztags?: boolean | null; ort?: string | null; kunde_name?: string | null; besitzer_email?: string | null; teilnehmer?: unknown; kunde_id?: string | null; kunde_bereich?: string | null; ms_id?: string | null }
type TodoZeile = { id: string; besitzer_email?: string | null; bereich?: string | null; aufgabe?: string | null; kunde_projekt?: string | null; zustaendig?: string | null; erledigt_am?: string | null; erledigen_bis?: string | null; geplante_wiedervorlage?: string | null; ms_id?: string | null; ms_liste_id?: string | null }
type EintragZeile = { id: string; daten?: unknown }
type RechnungZeile = { id: string; datum?: string | null; zahlungsziel?: string | null; status?: string | null; mahnstufe?: string | null; betrag_brutto?: number | string | null }
type LeadZeile = { id: string; status?: string | null; erstellt_am?: string | null }

export type Daten = {
  kunden: KundeZeile[]
  objekte: ObjektZeile[]
  termine: TerminZeile[]
  todos: TodoZeile[]
  treffer: EintragZeile[]
  /** Treffer privater Gesuche (art „privat_treffer“, daten.besitzer) — nur für ihren Besitzer. Fehlt = keine. */
  privatTreffer?: EintragZeile[]
  fragen: EintragZeile[]
  ungeklaert: number
  /** Zeitpunkt des stillen Erststands der Treffer — was dort festgehalten wurde, ist nicht „neu“. */
  trefferErststand: string | null
  /** Je Login (klein) die ausgeblendeten Listen aus Microsoft To Do (ms_konten.stand.todoListen). Fehlt = keine. */
  ausgeblendeteListen?: Map<string, Set<string>>
  /** Offene, heute fällige oder überfällige Einträge der Tabelle wiedervorlagen (Runde 6). Fehlt = keine. */
  wiedervorlagen?: WvZeile[]
}

/** `rechnung`: aus einer Regel mit Auslöser „ereignis:rechnung“ (z. B. „Geldeingang prüfen“). */
type WvZeile = { id: string; kunde_id: string; bereich?: string | null; titel?: string | null; faellig?: string | null; verantwortlich?: string | null; regel?: string | null; rechnung?: boolean }

export type WochenDaten = {
  kunden: KundeZeile[]
  objekte: ObjektZeile[]
  treffer: EintragZeile[]
  fragen: EintragZeile[]
  rechnungen: RechnungZeile[]
  /** null = Tabelle nicht lesbar (dann fehlt die Zeile im Bericht). */
  leads: LeadZeile[] | null
  trefferErststand: string | null
}

async function ladeUngeklaert(admin: Db): Promise<number> {
  const { data, error } = await admin.from('kunden').select('dokumente').eq('id', AKTE_UNGEKLAERT).maybeSingle()
  if (error) throw new Error(`Ungeklärte Eingänge: ${error.message}`)
  return Array.isArray(data?.dokumente) ? data.dokumente.length : 0
}

/** Offene Wiedervorlagen (Tabelle wiedervorlagen) bis heute. Wirft nie (dann keine) — die Übersicht soll nie daran scheitern. */
async function ladeWiedervorlagen(admin: Db, heute: string): Promise<WvZeile[]> {
  try {
    const { data, error } = await alleZeilen(() => admin.from('wiedervorlagen').select('id, kunde_id, bereich, titel, faellig, verantwortlich, regel').is('erledigt_am', null).lte('faellig', heute))
    if (error) return []
    // Rechnungs-Wiedervorlagen erkennen (für die Vertretung durch die Geschäftsführung, siehe morgenAbschnitte).
    const rechnungsRegeln = new Set<string>()
    try {
      const { data: regeln } = await admin.from('wiedervorlage_regeln').select('id').eq('ausloeser', 'ereignis:rechnung')
      for (const r of (regeln ?? []) as { id: string }[]) rechnungsRegeln.add(r.id)
    } catch {
      // ohne Regeln keine Vertretung — die übrigen Wiedervorlagen kommen trotzdem
    }
    return ((data ?? []) as WvZeile[]).map((w) => ({ ...w, rechnung: !!w.regel && rechnungsRegeln.has(w.regel) }))
  } catch {
    return []
  }
}

/** Ausgeblendete To-Do-Listen je Login (ms_konten.stand.todoListen mit aus=true). Wirft nie (dann keine). */
async function ladeAusgeblendeteListen(admin: Db): Promise<Map<string, Set<string>>> {
  const m = new Map<string, Set<string>>()
  try {
    const { data, error } = await admin.from('ms_konten').select('login_email, stand')
    if (error) return m
    for (const z of (data ?? []) as { login_email?: string | null; stand?: unknown }[]) {
      const ids = ausgeblendeteListen(z.stand)
      if (ids.size) m.set(text(z.login_email).toLowerCase(), ids)
    }
  } catch {
    // ohne Microsoft-Konten gibt es nichts auszublenden
  }
  return m
}

async function ladeErststand(admin: Db): Promise<string | null> {
  const { data } = await admin.from(TABELLE).select('daten').eq('id', 'treffer_stand').maybeSingle()
  const wert = alsObjekt(data?.daten)?.erststandAm
  return typeof wert === 'string' ? wert : null
}

export async function ladeDaten(admin: Db, heute: string): Promise<Daten> {
  const von = berlinTagesbeginn(heute).toISOString()
  const bis = berlinTagesbeginn(plusTage(heute, 1)).toISOString()
  const termineAbfrage = async (): Promise<TerminZeile[]> => {
    const { data, error } = await admin.from('termine').select('id, titel, beginn, ende, ganztags, ort, kunde_name, besitzer_email, teilnehmer, kunde_id, kunde_bereich, ms_id').lt('beginn', bis).gt('ende', von)
    if (error) throw new Error(`termine: ${error.message}`)
    return (data ?? []) as TerminZeile[]
  }
  const [kunden, objekte, termine, todos, treffer, privatTreffer, fragen, ungeklaert, trefferErststand, ausgeblendet, wiedervorlagen] = await Promise.all([
    ladeAlle(admin, 'kunden', 'id, bereich, firma, ansprechpartner, verantwortlich, verantwortlich_email, follow_up'),
    ladeAlle(admin, 'objekte', 'id, bezeichnung, adresse, verantwortlich, follow_up, privat_besitzer'),
    termineAbfrage(),
    ladeAlle(admin, 'todos', 'id, besitzer_email, bereich, aufgabe, kunde_projekt, zustaendig, erledigt_am, erledigen_bis, geplante_wiedervorlage, ms_id, ms_liste_id'),
    ladeAlle(admin, TABELLE, 'id, daten', 'treffer'),
    ladeAlle(admin, TABELLE, 'id, daten', 'privat_treffer'),
    ladeAlle(admin, TABELLE, 'id, daten', 'frage'),
    ladeUngeklaert(admin),
    ladeErststand(admin),
    ladeAusgeblendeteListen(admin),
    ladeWiedervorlagen(admin, heute),
  ])
  return { kunden, objekte, termine, todos, treffer, privatTreffer, fragen, ungeklaert, trefferErststand, ausgeblendeteListen: ausgeblendet, wiedervorlagen }
}

export async function ladeWochenDaten(admin: Db): Promise<WochenDaten> {
  const leads = async (): Promise<LeadZeile[] | null> => {
    try {
      return await ladeAlle(admin, 'vorgeschlagene_leads', 'id, status, erstellt_am')
    } catch (err) {
      console.error('Wochenbericht: Interessenten nicht lesbar:', err instanceof Error ? err.message : err)
      return null
    }
  }
  const [kunden, objekte, treffer, fragen, rechnungen, leadZeilen, trefferErststand] = await Promise.all([
    ladeAlle(admin, 'kunden', 'id, bereich, activities'),
    ladeAlle(admin, 'objekte', 'id, activities, privat_besitzer'),
    ladeAlle(admin, TABELLE, 'id, daten', 'treffer'),
    ladeAlle(admin, TABELLE, 'id, daten', 'frage'),
    ladeAlle(admin, 'rechnungen', 'id, datum, zahlungsziel, status, mahnstufe, betrag_brutto'),
    leads(),
    ladeErststand(admin),
  ])
  return { kunden, objekte, treffer, fragen, rechnungen, leads: leadZeilen, trefferErststand }
}

// ---------------------------------------------------------------------------------------------
// Morgen-Übersicht
// ---------------------------------------------------------------------------------------------

/** Ein Abschnitt der Morgen-Übersicht; ohne Zeilen ist er eine einzelne Zeile (z. B. „Ungeklärte Eingänge: …“). */
type Abschnitt = { titel: string; zeilen: string[] }

function kundenName(k: KundeZeile): string {
  return text(k.firma).trim() || text(k.ansprechpartner).trim() || 'Kontakt ohne Namen'
}

function objektName(o: ObjektZeile): string {
  return text(o.bezeichnung).trim() || text(o.adresse).trim() || 'Objekt ohne Bezeichnung'
}

function faelligText(tag: string, heute: string): string {
  return tag < heute ? `überfällig seit ${tagMonat(tag)}` : 'heute'
}

function terminZeile(t: TerminZeile, von: Date, bis: Date): string {
  const beginn = new Date(t.beginn)
  const ende = new Date(t.ende)
  let wann: string
  if (t.ganztags) wann = 'ganztägig'
  else if (beginn < von && ende > bis) wann = 'den ganzen Tag'
  else if (beginn < von) wann = `bis ${UHR.format(ende)}`
  else if (ende > bis) wann = `ab ${UHR.format(beginn)}`
  else wann = `${UHR.format(beginn)}–${UHR.format(ende)}`
  const zusatz = [text(t.ort).trim(), text(t.kunde_name).trim()].filter(Boolean).map((s) => kurz(s, 40))
  return `• ${wann} ${kurz(text(t.titel) || 'Termin')}${zusatz.length ? ` (${zusatz.join(', ')})` : ''}`
}

export type MorgenOptionen = {
  /** false = die eigene Liste gehört in die Privat-Übersicht (Person nutzt den privaten Assistenten). */
  eigeneListe?: boolean
}

/** Microsoft-Aufgaben mit älterer Frist bzw. Wiedervorlage fehlen in der Morgen-Übersicht. */
export const MS_HOECHSTENS_TAGE = 90

/**
 * Fällige Aufgaben einer Person als Zeilen, heute Fälliges zuerst, dann die neuesten Überfälligen.
 * - 'mayer': Bereichslisten (wo die Person zuständig ist) und die eigene Liste OHNE Microsoft To Do.
 * - 'nur_bereiche': nur Bereichslisten (eigene Liste geht über den privaten Assistenten).
 * - 'privat': nur die eigene Liste MIT Microsoft To Do (ohne ausgeblendete Listen und ohne Microsoft-Aufgaben über 90 Tage).
 */
export function aufgabenZeilen(p: Person, d: Daten, heute: string, art: 'mayer' | 'nur_bereiche' | 'privat'): string[] {
  const grenze = plusTage(heute, -MS_HOECHSTENS_TAGE)
  const ausgeblendet = d.ausgeblendeteListen?.get(p.email) ?? new Set<string>()
  const aufgaben: { tag: string; zeile: string }[] = []
  for (const t of d.todos) {
    if (text(t.erledigt_am).trim()) continue
    const zustaendig = text(t.zustaendig).trim()
    const microsoft = !!text(t.ms_id)
    // Eigene Liste: gehört dem Besitzer, außer jemand anderes ist ausdrücklich zuständig.
    // Bereichs-Liste: zählt nur, wo die Person als zuständig eingetragen ist (sonst bekäme jeder alles).
    let meine: boolean
    if (t.bereich) meine = art !== 'privat' && darfBereich(p, t.bereich) && gehoertZu(zustaendig, p.name)
    else {
      const eigene = text(t.besitzer_email).trim().toLowerCase() === p.email && (!zustaendig || gehoertZu(zustaendig, p.name))
      // Privat bleibt privat: Microsoft To Do nie über den Mayer-Bot; mit privatem Assistenten die ganze eigene Liste nicht.
      meine = eigene && (art === 'privat' || (art === 'mayer' && !microsoft))
    }
    if (!meine) continue
    if (microsoft && ausgeblendet.has(text(t.ms_liste_id))) continue
    const aufgabe = text(t.aufgabe).trim()
    if (!aufgabe) continue
    const frist = alsDatum(t.erledigen_bis)
    const wiedervorlage = alsDatum(t.geplante_wiedervorlage)
    let tag = ''
    let wann = ''
    if (frist && frist <= heute) {
      tag = frist
      wann = frist < heute ? `überfällig seit ${tagMonat(frist)}` : 'fällig heute'
    } else if (wiedervorlage && wiedervorlage <= heute) {
      tag = wiedervorlage
      wann = wiedervorlage < heute ? `Wiedervorlage seit ${tagMonat(wiedervorlage)}` : 'Wiedervorlage heute'
    } else continue
    if (microsoft && tag < grenze) continue
    const projekt = text(t.kunde_projekt).trim()
    aufgaben.push({ tag, zeile: `• ${kurz(aufgabe)}${projekt ? ` (${kurz(projekt, 40)})` : ''} – ${wann}` })
  }
  // Heute Fälliges zuerst, dann die neuesten Überfälligen (die ältesten sind meist erledigt oder vergessen).
  aufgaben.sort((a, b) => Number(b.tag === heute) - Number(a.tag === heute) || b.tag.localeCompare(a.tag))
  return aufgaben.map((x) => x.zeile)
}

/** Was heute für diese Person ansteht, als Abschnitte (leere Abschnitte fehlen). Rechnet nur. */
export function morgenAbschnitte(p: Person, d: Daten, jetzt: Date, optionen: MorgenOptionen = {}): Abschnitt[] {
  const heute = berlinZeit(jetzt).datum
  const von = berlinTagesbeginn(heute)
  const bis = berlinTagesbeginn(plusTage(heute, 1))
  const abschnitte: Abschnitt[] = []

  // ---- Termine heute: eigene und gemeinsam gebuchte ----
  const termine = d.termine
    .filter((t) => {
      const teilnehmer = Array.isArray(t.teilnehmer) ? t.teilnehmer.map((x) => text(x).toLowerCase()) : []
      if (text(t.besitzer_email).toLowerCase() !== p.email && !teilnehmer.includes(p.email)) return false
      // Privat bleibt privat (24.11.2026: ein privater Outlook-Termin stand in der Mayer-Morgennachricht): ein eigener
      // Termin ohne Kollegen und ohne Mayer-Akte fehlt hier, wenn er aus Microsoft kommt oder die Person den privaten
      // Assistenten nutzt — dann steht er in ihrem privaten Morgenplan.
      // Regel zentral in _shared/privatGrenze.ts.
      if (istPrivaterTermin(t, { besitzerPrivatAssistent: optionen.eigeneListe === false })) return false
      return new Date(t.beginn) < bis && new Date(t.ende) > von
    })
    .sort((a, b) => Number(!a.ganztags) - Number(!b.ganztags) || a.beginn.localeCompare(b.beginn))
  if (termine.length) abschnitte.push({ titel: 'Termine heute', zeilen: termine.map((t) => terminZeile(t, von, bis)) })

  // ---- Fällige Wiedervorlagen bei Kontakten und Objekten, für die die Person verantwortlich ist ----
  const wv: { tag: string; zeile: string }[] = []
  /** `eigenes`: die Person ist ohnehin zuständig (Besitzer eines privaten Objekts). */
  const pruefeWv = (f: FollowUp | null | undefined, verantwortlich: string | null | undefined, name: string, eigenes = false) => {
    if (!f || f.done === true) return
    const tag = alsDatum(f.date)
    if (!tag || tag > heute || (!eigenes && !gehoertZu(verantwortlich, p.name))) return
    wv.push({ tag, zeile: `• ${kurz(name)} – ${faelligText(tag, heute)}` })
  }
  for (const k of d.kunden) {
    if (!darfKunde(p, k)) continue
    pruefeWv(k.follow_up, k.verantwortlich, kundenName(k))
  }
  // Mayer-Objekte nach Immobilien-Recht und Verantwortlichem; private Objekte nur beim Besitzer (er ist dort immer verantwortlich).
  const darfImmobilien = darfBereich(p, 'immobilien')
  for (const o of d.objekte) {
    if (!darfObjekt(o, p.email, darfImmobilien)) continue
    pruefeWv(o.follow_up, o.verantwortlich, `Objekt ${objektName(o)}`, istPrivatesObjekt(o))
  }
  // Runde 6: auch die Wiedervorlagen aus dem Reiter „Wiedervorlagen“ (Tabelle wiedervorlagen, z. B. „Neuanfrage prüfen“) —
  // vorher fehlten sie in der Übersicht, das Team arbeitet aber fast nur per Telegram. Nur wo die Person zuständig ist.
  {
    const kundenNachId = new Map(d.kunden.map((k) => [k.id, k]))
    for (const w of d.wiedervorlagen ?? []) {
      const tag = alsDatum(w.faellig)
      // Rechnungs-Wiedervorlagen („Geldeingang prüfen“) in Akten ohne Verantwortlichen gehen an die Geschäftsführung
      // (wie die Mahnvorschläge) — sonst bekäme sie niemand (24.11.2026: Follow-up jeder Rechnung in Telegram).
      const zustaendig = gehoertZu(w.verantwortlich, p.name) || (w.rechnung === true && !text(w.verantwortlich).trim() && p.gf)
      if (!tag || tag > heute || !zustaendig || !darfBereich(p, w.bereich) || w.bereich === 'privat') continue
      const k = kundenNachId.get(w.kunde_id)
      wv.push({ tag, zeile: `• ${kurz(text(w.titel) || 'Wiedervorlage', 60)}: ${kurz(k ? kundenName(k) : 'Akte', 40)} – ${faelligText(tag, heute)}` })
    }
  }
  wv.sort((a, b) => a.tag.localeCompare(b.tag))
  if (wv.length) abschnitte.push({ titel: 'Wiedervorlagen', zeilen: wv.map((x) => x.zeile) })

  // ---- Offene Aufgaben, fällig heute oder überfällig (eigene Liste ohne Microsoft To Do; mit privatem Assistenten gar nicht) ----
  const aufgaben = aufgabenZeilen(p, d, heute, optionen.eigeneListe === false ? 'nur_bereiche' : 'mayer')
  if (aufgaben.length) abschnitte.push({ titel: 'Aufgaben', zeilen: aufgaben })

  // ---- Neue Treffer der letzten 24 Stunden: gemeldet an die Person oder sie ist verantwortlich ----
  // Mayer-Treffer nur mit Immobilien-Recht und nie mit einem privaten Objekt; private Treffer nur an ihren Besitzer.
  {
    const seit = jetzt.getTime() - 24 * 3600 * 1000
    const erststand = d.trefferErststand ? Date.parse(d.trefferErststand) : NaN
    const kunden = new Map(d.kunden.map((k) => [k.id, k]))
    const objekte = new Map(d.objekte.map((o) => [o.id, o]))
    const treffer: { zeit: number; zeile: string }[] = []
    const zeilen = [
      ...(darfBereich(p, 'immobilien') ? d.treffer.map((z) => ({ z, privat: false })) : []),
      ...(d.privatTreffer ?? []).map((z) => ({ z, privat: true })),
    ]
    for (const { z, privat } of zeilen) {
      const t = alsObjekt(z.daten)
      if (!t) continue
      if (privat && normalisiereAdresse(t.besitzer) !== p.email) continue
      const zeit = Date.parse(text(t.entdecktAm))
      if (!Number.isFinite(zeit) || zeit < seit || zeit > jetzt.getTime()) continue
      if (Number.isFinite(erststand) && zeit <= erststand) continue
      const kunde = kunden.get(text(t.kundeId))
      const objekt = objekte.get(text(t.objektId))
      if (kunde && !darfKunde(p, kunde)) continue
      if (objekt && (privat ? !darfObjekt(objekt, p.email, false) : istPrivatesObjekt(objekt))) continue
      if (!privat) {
        const gemeldet = Array.isArray(t.gemeldetAn) && t.gemeldetAn.some((n) => text(n).trim().toLowerCase() === p.name.toLowerCase())
        if (!gemeldet && !gehoertZu(kunde?.verantwortlich, p.name) && !gehoertZu(objekt?.verantwortlich, p.name)) continue
      }
      const objektText = objekt ? objektName(objekt) : 'Objekt'
      const kundeText = kunde ? kundenName(kunde) : 'einem Kontakt'
      treffer.push({ zeit, zeile: `• ${kurz(objektText, 45)} passt zum Gesuch von ${kurz(kundeText, 40)}${t.art === 'pruefen' ? ' (noch zu prüfen)' : ''}${privat ? ' (privat)' : ''}` })
    }
    treffer.sort((a, b) => b.zeit - a.zeit)
    if (treffer.length) abschnitte.push({ titel: 'Neue Treffer zu Gesuchen', zeilen: treffer.map((x) => x.zeile) })
  }

  // ---- Nur Geschäftsführung und Admins: unbeantwortete Fragen an die Geschäftsführung ----
  if (p.gf) {
    const offen = d.fragen
      .map((z) => alsObjekt(z.daten))
      .filter((f): f is Record<string, unknown> => !!f && !text(f.antwort).trim())
      .sort((a, b) => text(a.erstelltAm).localeCompare(text(b.erstelltAm)))
    if (offen.length) {
      // Fragen an die Geschäftsführung betreffen Mayer-Objekte: private Objekte nicht beim Namen nennen.
      const objekte = new Map(nurMayerObjekte(d.objekte).map((o) => [o.id, o]))
      abschnitte.push({
        titel: `Offene Fragen an die Geschäftsführung: ${offen.length}`,
        zeilen: offen.map((f) => {
          const objekt = objekte.get(text(f.objektId))
          const bezug = text(f.bezug).trim() || (objekt ? objektName(objekt) : '') || 'ohne Bezug'
          const von = text(f.gestelltVon).trim()
          const tag = alsDatum(f.erstelltAm)
          return `• ${kurz(bezug, 45)}${von ? ` (von ${kurz(von, 30)}${tag ? `, seit ${tagMonat(tag)}` : ''})` : tag ? ` (seit ${tagMonat(tag)})` : ''}`
        }),
      })
    }
  }

  // ---- Ungeklärte Eingänge: für alle da ----
  if (d.ungeklaert > 0) {
    abschnitte.push({ titel: `Ungeklärte Eingänge: ${d.ungeklaert === 1 ? '1 Datei wartet' : `${d.ungeklaert} Dateien warten`} auf Zuordnung`, zeilen: [] })
  }
  return abschnitte
}

function vorname(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

/** Die fertige Nachricht — null, wenn nichts ansteht. Höchstens 25 Zeilen: Lange Listen werden gekürzt. */
export function morgenText(p: Person, d: Daten, jetzt: Date, zusatz: Abschnitt[] = [], optionen: MorgenOptionen = {}): string | null {
  const abschnitte = [...morgenAbschnitte(p, d, jetzt, optionen), ...zusatz]
  if (abschnitte.length === 0) return null
  const b = berlinZeit(jetzt)
  const gruss = vorname(p.name) ? `Guten Morgen ${vorname(p.name)}, das steht heute an (${WOCHENTAG_LANG[b.wochentag]}, ${tagMonat(b.datum)}):` : `Guten Morgen, das steht heute an (${WOCHENTAG_LANG[b.wochentag]}, ${tagMonat(b.datum)}):`
  const baue = (hoechstens: number): string[] => {
    const zeilen = [gruss]
    for (const a of abschnitte) {
      zeilen.push('')
      zeilen.push(a.titel)
      const liste = a.zeilen.slice(0, hoechstens)
      zeilen.push(...liste)
      const rest = a.zeilen.length - liste.length
      if (rest > 0) zeilen.push(rest === 1 ? '… und 1 weiterer Eintrag' : `… und ${rest} weitere`)
    }
    return zeilen
  }
  let zeilen = baue(6)
  for (let n = 5; n >= 1 && zeilen.length > HOECHSTENS_ZEILEN; n--) zeilen = baue(n)
  return zeilen.join('\n')
}

/** Der Hotmail-Teil als eigene Nachricht für den privaten Assistenten — null, wenn nichts ansteht. */
export function privatUebersichtText(p: Person, abschnitte: Abschnitt[], jetzt: Date): string | null {
  if (abschnitte.length === 0) return null
  const b = berlinZeit(jetzt)
  const zeilen = [`${vorname(p.name) ? `Guten Morgen ${vorname(p.name)}, d` : 'D'}eine Privat-Übersicht (${WOCHENTAG_LANG[b.wochentag]}, ${tagMonat(b.datum)}):`]
  for (const a of abschnitte) {
    zeilen.push('', a.titel, ...a.zeilen.slice(0, 6))
    const rest = a.zeilen.length - 6
    if (rest > 0) zeilen.push(rest === 1 ? '… und 1 weiterer Eintrag' : `… und ${rest} weitere`)
  }
  return zeilen.join('\n')
}

/** Morgen-Nachrichten einer Person: Mayer-Teil und, wenn sie den privaten Assistenten benutzt, getrennt der private Teil
 *  (eigene Aufgaben samt Microsoft To Do und Hotmail). Privat bleibt privat: die eigene Liste dann nicht im Mayer-Teil. */
export async function morgenNachrichten(admin: Db, p: Person, daten: Daten, jetzt: Date, privatAktiv?: (email: string) => Promise<boolean>): Promise<{ mayer: string | null; privat: string | null }> {
  const hotmail = await hotmailAbschnitte(admin, p.email, jetzt)
  // Umsatzziel (umsatzZiel.ts, 24.11.2026): nur Geschäftsführung/Admins und nur mit eingeschaltetem Schalter
  // (umsatz_ziel_einstellung.meldung_aktiv, Vorgabe aus) — als Abschnitt hier statt als eigene Nachricht. Wirft nie.
  // Seit 24.11.2026 abends: jeder für seine Abteilung (Geschäftsführung alle Sparten, sonst die eigenen).
  const eigeneSparten = spartenFuerBereiche(p.bereiche)
  const ziel = p.gf ? await umsatzZielAbschnitt(admin, jetzt) : eigeneSparten.length ? await umsatzZielAbschnitt(admin, jetzt, { sparten: eigeneSparten }) : null
  const zielTeil = ziel ? [ziel] : []
  const privat = p.chat != null && (await (privatAktiv ?? ((e: string) => privatBotAktiv(admin, e)))(p.email).catch(() => false))
  if (privat) {
    // Hat die Person den neuen privaten Morgenplan (privatTagesplan.ts, jeden Tag inkl. Wochenende), bringt der die
    // eigene Liste und den Hotmail-Teil — hier dann keine zweite Privat-Übersicht.
    if (await privatMorgenplanAktiv(admin, p.email).catch(() => false)) return { mayer: morgenText(p, daten, jetzt, zielTeil, { eigeneListe: false }), privat: null }
    const eigene = aufgabenZeilen(p, daten, berlinZeit(jetzt).datum, 'privat')
    const teile = [...(eigene.length ? [{ titel: 'Eigene Aufgaben', zeilen: eigene }] : []), ...hotmail]
    return { mayer: morgenText(p, daten, jetzt, zielTeil, { eigeneListe: false }), privat: privatUebersichtText(p, teile, jetzt) }
  }
  return { mayer: morgenText(p, daten, jetzt, [...zielTeil, ...hotmail]), privat: null }
}

// ---------------------------------------------------------------------------------------------
// Wochenbericht
// ---------------------------------------------------------------------------------------------

/** Ältester Eintrag im Verlauf — Kunden und Objekte haben kein eigenes Anlagedatum (wie in
 *  src/pages/auswertungen/quellen.ts „Angelegt am“). */
function erstesDatum(activities: unknown): string {
  let erstes = ''
  for (const a of Array.isArray(activities) ? activities : []) {
    const tag = alsDatum(alsObjekt(a)?.date)
    if (tag && (!erstes || tag < erstes)) erstes = tag
  }
  return erstes
}

export type BezahltStand = { seit: string; ids: string[]; vorher?: { seit: string; ids: string[] } }

function istUnbezahlt(r: RechnungZeile): boolean {
  return r.status === 'Versendet' || r.status === 'Überfällig'
}

/** Wie istUeberfaellig in src/lib/rechnungen.ts. */
function istUeberfaellig(r: RechnungZeile, heute: string): boolean {
  if (!istUnbezahlt(r)) return false
  const ziel = alsDatum(r.zahlungsziel)
  return r.status === 'Überfällig' || !!r.mahnstufe || (!!ziel && ziel < heute)
}

function betrag(r: RechnungZeile): number {
  const n = Number(r.betrag_brutto)
  return Number.isFinite(n) ? n : 0
}

/** Bezahlte Rechnungen haben kein Zahldatum. Gezählt wird deshalb gegen einen festgehaltenen Stand:
 *  welche Rechnungen beim letzten Bericht (oder am ersten Morgen) schon bezahlt waren. */
function vergleichsStand(stand: BezahltStand | undefined, heute: string): { seit: string; ids: string[] } | null {
  if (!stand) return null
  // Ein zweiter Bericht am selben Freitag (z. B. jemand schaltet ihn erst um 17 Uhr ein) vergleicht
  // mit demselben Stand wie der erste.
  if (stand.seit === heute && stand.vorher) return stand.vorher
  if (stand.seit === heute) return null
  return { seit: stand.seit, ids: stand.ids }
}

export function wochenText(d: WochenDaten, jetzt: Date, bezahlt: BezahltStand | undefined): string {
  const b = berlinZeit(jetzt)
  const heute = b.datum
  const montag = plusTage(heute, -((b.wochentag + 6) % 7))
  const inWoche = (tag: string) => !!tag && tag >= montag && tag <= heute
  const zeilen: string[] = [`Wochenbericht vom ${tagMonat(montag)} bis ${tagMonat(heute)}`]

  // Neue Akten je Bereich (ohne Privat und ohne die beiden Sammelakten)
  const jeBereich = new Map<string, number>()
  for (const k of d.kunden) {
    if (k.bereich === 'privat' || AKTEN_FUER_ALLE.has(k.id)) continue
    if (!inWoche(erstesDatum(k.activities))) continue
    const name = BEREICH_NAMEN[text(k.bereich)] ?? (text(k.bereich) || 'ohne Bereich')
    jeBereich.set(name, (jeBereich.get(name) ?? 0) + 1)
  }
  const neueAkten = [...jeBereich.values()].reduce((s, n) => s + n, 0)
  const aufteilung = [...jeBereich.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([n, z]) => `${n} ${z}`)
  zeilen.push(`Neue Akten: ${neueAkten}${aufteilung.length ? ` (${aufteilung.join(', ')})` : ''}`)

  // Rechnungen
  const geschrieben = d.rechnungen.filter((r) => r.status !== 'Entwurf' && inWoche(alsDatum(r.datum)))
  zeilen.push(`Rechnungen geschrieben: ${geschrieben.length}${geschrieben.length ? `, zusammen ${euro(geschrieben.reduce((s, r) => s + betrag(r), 0))}` : ''}`)
  const vergleich = vergleichsStand(bezahlt, heute)
  if (vergleich) {
    const vorher = new Set(vergleich.ids)
    const neuBezahlt = d.rechnungen.filter((r) => r.status === 'Bezahlt' && !vorher.has(r.id))
    zeilen.push(`Rechnungen bezahlt seit ${tagMonat(vergleich.seit)}: ${neuBezahlt.length}${neuBezahlt.length ? `, zusammen ${euro(neuBezahlt.reduce((s, r) => s + betrag(r), 0))}` : ''}`)
  }
  const offen = d.rechnungen.filter(istUnbezahlt)
  const ueberfaellig = offen.filter((r) => istUeberfaellig(r, heute))
  zeilen.push(
    `Offene Rechnungen: ${offen.length}${offen.length ? `, zusammen ${euro(offen.reduce((s, r) => s + betrag(r), 0))}` : ''}` +
      (ueberfaellig.length ? `; davon überfällig ${ueberfaellig.length} mit ${euro(ueberfaellig.reduce((s, r) => s + betrag(r), 0))}` : ''),
  )

  // Objekte, Treffer, Fragen, Interessenten
  zeilen.push(`Neue Objekte: ${nurMayerObjekte(d.objekte).filter((o) => inWoche(erstesDatum(o.activities))).length}`)
  const erststand = d.trefferErststand ? Date.parse(d.trefferErststand) : NaN
  const neueTreffer = d.treffer.filter((z) => {
    const zeit = Date.parse(text(alsObjekt(z.daten)?.entdecktAm))
    if (!Number.isFinite(zeit) || (Number.isFinite(erststand) && zeit <= erststand)) return false
    return inWoche(berlinZeit(new Date(zeit)).datum)
  })
  zeilen.push(`Neue Treffer zu Gesuchen: ${neueTreffer.length}`)
  zeilen.push(`Offene Fragen an die Geschäftsführung: ${d.fragen.filter((z) => !text(alsObjekt(z.daten)?.antwort).trim()).length}`)
  if (d.leads) {
    // „nicht_relevant“ sind von der Prüfung aussortierte Absender, keine Interessenten.
    zeilen.push(`Neue Interessenten aus E-Mails: ${d.leads.filter((l) => l.status !== 'nicht_relevant' && inWoche(alsDatum(l.erstellt_am))).length}`)
  }
  return zeilen.join('\n')
}

// ---------------------------------------------------------------------------------------------
// Buchhaltungszeile
// ---------------------------------------------------------------------------------------------

type Stand = {
  version?: string
  /** E-Mail → Tag (yyyy-mm-dd) der letzten Morgen-Übersicht. */
  morgen?: Record<string, string>
  /** E-Mail → Tag des letzten Wochenberichts. */
  woche?: Record<string, string>
  bezahlt?: BezahltStand
}

async function ladeStand(admin: Db, jetztIso: string): Promise<Stand> {
  const { data, error } = await admin.from(TABELLE).select('daten').eq('id', STAND_ID).maybeSingle()
  if (error) throw new Error(`Stand nicht lesbar: ${error.message}`)
  if (data) return (alsObjekt(data.daten) ?? {}) as Stand
  const neu: Stand = { version: crypto.randomUUID(), morgen: {}, woche: {} }
  const { error: anlegeFehler } = await admin.from(TABELLE).insert({ id: STAND_ID, art: STAND_ID, daten: neu, updated_at: jetztIso })
  if (anlegeFehler && anlegeFehler.code !== '23505') throw new Error(`Stand nicht anlegbar: ${anlegeFehler.message}`)
  if (!anlegeFehler) return neu
  // Ein anderer Lauf hat die Zeile gerade angelegt: dessen Stand lesen.
  const { data: wieder, error: lesefehler } = await admin.from(TABELLE).select('daten').eq('id', STAND_ID).maybeSingle()
  if (lesefehler || !wieder) throw new Error(`Stand nicht lesbar: ${lesefehler?.message ?? 'fehlt'}`)
  return (alsObjekt(wieder.daten) ?? {}) as Stand
}

/** Stellt die Buchhaltungszeile weiter — nur, wenn sie seit dem Lesen niemand verändert hat. */
async function beanspruche(admin: Db, alt: Stand, neu: Stand, jetztIso: string): Promise<boolean> {
  let abfrage = admin.from(TABELLE).update({ daten: { ...neu, version: crypto.randomUUID() }, updated_at: jetztIso }).eq('id', STAND_ID)
  abfrage = alt.version ? abfrage.eq('daten->>version', alt.version) : abfrage.is('daten->>version', null)
  const { data, error } = await abfrage.select('id')
  if (error) throw new Error(`Stand nicht schreibbar: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

async function bezahlteIds(admin: Db): Promise<string[]> {
  const zeilen = await ladeAlle(admin, 'rechnungen', 'id, status')
  return zeilen.filter((r) => r.status === 'Bezahlt').map((r) => text(r.id))
}

// ---------------------------------------------------------------------------------------------
// Der Lauf
// ---------------------------------------------------------------------------------------------

/** Vom Minutentakt (Aktion `termin_erinnerungen`) gerufen. Außerhalb der Zeitfenster kehrt sie ohne
 *  Datenbankzugriff zurück. Gibt zurück, wie viele Nachrichten zugestellt wurden. Wirft nie. */
export async function sendeTagesmeldungen(admin: Db, sende: SendeFunktion, jetzt: Date = new Date(), sendePrivatBot: SendeFunktion = sendeUeberPrivatBot): Promise<TagesErgebnis> {
  const ergebnis: TagesErgebnis = { morgen: 0, woche: 0 }
  if (imMorgenfenster(jetzt)) {
    try {
      ergebnis.morgen = await lauf(admin, sende, jetzt, 'morgen', sendePrivatBot)
    } catch (err) {
      console.error('Morgen-Übersicht fehlgeschlagen:', err instanceof Error ? err.message : err)
    }
  }
  if (imWochenfenster(jetzt)) {
    try {
      ergebnis.woche = await lauf(admin, sende, jetzt, 'woche')
    } catch (err) {
      console.error('Wochenbericht fehlgeschlagen:', err instanceof Error ? err.message : err)
    }
  }
  return ergebnis
}

async function lauf(admin: Db, sende: SendeFunktion, jetzt: Date, art: 'morgen' | 'woche', sendePrivatBot: SendeFunktion = sendeUeberPrivatBot): Promise<number> {
  const jetztIso = jetzt.toISOString()
  const heute = berlinZeit(jetzt).datum
  const stand = await ladeStand(admin, jetztIso)
  const schon = stand[art] ?? {}

  // ---- Wer ist heute noch dran? ----
  const [team, einstellungen] = await Promise.all([ladeTeam(admin), ladeEinstellungen(admin)])
  let offen = team.filter((p) => {
    if (p.chat == null || schon[p.email] === heute) return false
    const e = einstellungen.get(p.email)
    if (art === 'woche') return p.gf && e?.woche !== false
    return e?.morgen !== false
  })
  // Wer den Wochenrückblick bekommt (wochenrueckblick.ts), bekommt diesen Wochenbericht nicht zusätzlich.
  // Erst hier gelesen, also nur solange noch jemand offen ist; ist die Einstellung nicht lesbar, bricht der Lauf ab
  // und der nächste Takt versucht es erneut (lieber später als doppelt).
  if (art === 'woche' && offen.length > 0) {
    const rueckblick = await wochenrueckblickAdressen(admin)
    offen = offen.filter((p) => !rueckblick.has(p.email))
  }
  if (offen.length === 0) return 0

  // ---- Alles lesen, bevor die Zeile weitergestellt wird: Schlägt ein Abruf fehl, versucht es der
  //      nächste Takt erneut, und niemand ist schon als „erledigt“ vermerkt. ----
  const daten = art === 'morgen' ? await ladeDaten(admin, heute) : null
  const wochenDaten = art === 'woche' ? await ladeWochenDaten(admin) : null
  const nachrichten = new Map<string, string | null>()
  const privatNachrichten = new Map<string, string>()
  // Bereich Privat: Hotmail-Teil für Freigeschaltete mit verbundenem Microsoft-Konto (hotmailBriefing.ts, wirft nie) —
  // bei Nutzern des privaten Assistenten als eigene Nachricht über diesen.
  for (const p of offen) {
    if (!daten) {
      nachrichten.set(p.email, wochenText(wochenDaten!, jetzt, stand.bezahlt))
      continue
    }
    const n = await morgenNachrichten(admin, p, daten, jetzt)
    nachrichten.set(p.email, n.mayer)
    if (n.privat) privatNachrichten.set(p.email, n.privat)
  }

  // Vergleichsstand für „bezahlt seit“: beim Wochenbericht neu festhalten (für die nächste Woche),
  // am Morgen nur, wenn es noch gar keinen gibt.
  let bezahlt = stand.bezahlt
  if (art === 'woche' && wochenDaten) {
    const ids = wochenDaten.rechnungen.filter((r) => r.status === 'Bezahlt').map((r) => text(r.id))
    if (stand.bezahlt?.seit !== heute) bezahlt = { seit: heute, ids, vorher: stand.bezahlt ? { seit: stand.bezahlt.seit, ids: stand.bezahlt.ids } : undefined }
  } else if (!stand.bezahlt) {
    bezahlt = { seit: heute, ids: await bezahlteIds(admin) }
  }

  // ---- Den Tag für diese Personen beanspruchen. Wer verliert, sendet nichts. ----
  const vermerkt = { ...schon }
  for (const p of offen) vermerkt[p.email] = heute
  const neu: Stand = { ...stand, [art]: vermerkt, ...(bezahlt ? { bezahlt } : {}) }
  if (!(await beanspruche(admin, stand, neu, jetztIso))) return 0

  // ---- Senden ----
  let zugestellt = 0
  for (const p of offen) {
    const nachricht = nachrichten.get(p.email)
    const privat = privatNachrichten.get(p.email)
    if (p.chat == null) continue
    if (nachricht) {
      try {
        if ((await sende(p.chat, nachricht)) === true) zugestellt++
        else console.error(`${art === 'morgen' ? 'Morgen-Übersicht' : 'Wochenbericht'} nicht zugestellt an`, p.email)
      } catch (err) {
        console.error(`${art === 'morgen' ? 'Morgen-Übersicht' : 'Wochenbericht'} nicht zustellbar:`, err instanceof Error ? err.message : err)
      }
    }
    if (privat) {
      try {
        // Nur über den privaten Bot — nie ersatzweise über den Mayer-Bot (Erays Regel vom 21.11.2026: Privates bleibt privat).
        if ((await sendePrivatBot(p.chat, privat)) === true) zugestellt++
        else console.error('Privat-Übersicht nicht zugestellt an', p.email)
      } catch (err) {
        console.error('Privat-Übersicht nicht zustellbar:', err instanceof Error ? err.message : err)
      }
    }
  }
  return zugestellt
}

// ---------------------------------------------------------------------------------------------
// Probelauf für eine Person (nur mit dem Dienst-Schlüssel, siehe index.ts)
// ---------------------------------------------------------------------------------------------

export type TestEingabe = { email?: unknown; art?: unknown; senden?: unknown; jetzt?: unknown }
export type TestErgebnis =
  | { ok: true; email: string; art: 'morgen' | 'woche'; text: string | null; gesendet: boolean; hinweis?: string; privatText?: string | null; privatGesendet?: boolean }
  | { ok: false; status: number; fehler: string }

/** Baut die Nachricht für eine Person sofort — ohne Zeitfenster, Wochentag, Einstellungen und ohne
 *  die Buchhaltungszeile zu lesen oder zu schreiben (außer dem Vergleichsstand „bezahlt seit“, der nur
 *  gelesen wird). Sendet nur mit `senden: true`. */
export async function tagesmeldungTest(admin: Db, sende: SendeFunktion, eingabe: TestEingabe, sendePrivatBot: SendeFunktion = sendeUeberPrivatBot): Promise<TestErgebnis> {
  const email = text(eingabe.email).trim().toLowerCase()
  const art = eingabe.art === 'woche' ? 'woche' : eingabe.art === 'morgen' || eingabe.art == null ? 'morgen' : null
  if (!email) return { ok: false, status: 400, fehler: 'email fehlt.' }
  if (!art) return { ok: false, status: 400, fehler: 'art muss "morgen" oder "woche" sein.' }
  let jetzt = new Date()
  if (eingabe.jetzt != null) {
    jetzt = new Date(text(eingabe.jetzt))
    if (Number.isNaN(jetzt.getTime())) return { ok: false, status: 400, fehler: 'jetzt ist kein gültiger Zeitpunkt.' }
  }
  try {
    const p = (await ladeTeam(admin)).find((m) => m.email === email)
    if (!p) return { ok: false, status: 404, fehler: 'Kein aktiver Mitarbeiter mit dieser E-Mail.' }
    let nachricht: string | null
    let privatText: string | null = null
    let hinweis: string | undefined
    if (art === 'morgen') {
      const n = await morgenNachrichten(admin, p, await ladeDaten(admin, berlinZeit(jetzt).datum), jetzt)
      nachricht = n.mayer
      privatText = n.privat
      if (!nachricht && !privatText) hinweis = 'Heute steht nichts an — im echten Lauf ginge keine Nachricht raus.'
    } else {
      const { data } = await admin.from(TABELLE).select('daten').eq('id', STAND_ID).maybeSingle()
      nachricht = wochenText(await ladeWochenDaten(admin), jetzt, (alsObjekt(data?.daten) as Stand | null)?.bezahlt)
      if (!p.gf) hinweis = 'Diese Person ist weder Geschäftsführung noch Admin — im echten Lauf bekäme sie keinen Wochenbericht.'
      else if ((await wochenrueckblickAdressen(admin)).has(p.email)) hinweis = 'Diese Person bekommt den Wochenrückblick — im echten Lauf bekäme sie diesen Wochenbericht nicht.'
    }
    let gesendet = false
    let privatGesendet = false
    if (eingabe.senden === true && (nachricht || privatText)) {
      if (p.chat == null) hinweis = 'Nicht gesendet: Diese Person hat Telegram nicht verbunden.'
      else {
        if (nachricht) gesendet = (await sende(p.chat, nachricht)) === true
        if (privatText) privatGesendet = (await sendePrivatBot(p.chat, privatText)) === true
      }
    }
    return { ok: true, email, art, text: nachricht, gesendet, ...(privatText ? { privatText, privatGesendet } : {}), ...(hinweis ? { hinweis } : {}) }
  } catch (err) {
    return { ok: false, status: 500, fehler: err instanceof Error ? err.message : String(err) }
  }
}

/** Der Dienst-Schlüssel des Projekts in alter (JWT) oder neuer Schreibweise (sb_secret_…) — wie
 *  istDienstSchluessel in postfach.ts. */
export function istDienstSchluessel(token: string): boolean {
  if (token.length < 30) return false
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return true
  try {
    const sammle = (wert: unknown): string[] =>
      typeof wert === 'string' ? [wert] : wert && typeof wert === 'object' ? Object.values(wert as Record<string, unknown>).flatMap(sammle) : []
    return sammle(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')).includes(token)
  } catch {
    return false
  }
}
