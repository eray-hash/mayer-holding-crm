// Privater Tagesplan über den privaten Telegram-Bot (23.11.2026) — vom Minutentakt (Aktion termin_erinnerungen)
// gerufen, ohne KI und ohne offenes Browserfenster. Für Personen mit aktivem privatem Bot (_shared/telegramPrivat.ts,
// privatBotAktiv), z. B. Hasan, der abends und am Wochenende per Sprachnachricht arbeitet.
//
// - Morgenplan: JEDEN Tag (auch Samstag/Sonntag) beim ersten Takt ab 8:00 Berliner Zeit (bis 11:00; ein verpasster
//   Morgen wird nicht nachgeholt). Kurz: heutige private Termine (eigene, ohne Teilnehmer, ohne Mayer-Akte),
//   dann Überfälliges und heute Fälliges der eigenen Liste (höchstens 5 + „und N weitere“), dann Zusatzteile, die
//   andere Bausteine als fertige Zeilen liefern (Hotmail, Fristen, Vertrags-Fristen …; Parameter zusatzMorgen).
//   Am Wochenende anderer Ton („Dein Samstag“). Steht nichts an: keine Nachricht.
// - Abend-Rückblick: jeden Tag beim ersten Takt ab 21:30 (bis 23:30). „Heute erledigt: N“, „Noch offen“ (höchstens 5,
//   gleiche Reihenfolge wie morgens, je Aufgabe Knöpfe „✓ Erledigt“ und „→ Morgen“, callback pt:e:<id> / pt:m:<id>),
//   „Morgen steht an“ (Termine morgen + morgen Fälliges, höchstens 5) und — Wunsch Nr. 4 „diktierte To-dos schärfen“ —
//   höchstens 3 vage Aufgaben („Bei diesen fehlt noch etwas …“). Die Knöpfe führt fuehrePlanKnopfAus aus.
// - Eigene Liste = todos mit bereich NULL und besitzer_email = Person (samt Microsoft To Do). Wie die Privat-Übersicht in
//   tagesmeldung.ts: Microsoft-Aufgaben aus ausgeblendeten Listen (ms_konten.stand.todoListen) und mit Frist älter als
//   90 Tage fehlen; fällig ist eine Aufgabe über erledigen_bis oder geplante_wiedervorlage.
//   Reihenfolge: überfällig vor heute fällig, dann Prio A vor B vor C vor D (ohne Prio zuletzt), dann älteste Frist.
// - Privat bleibt privat: nur über den privaten Bot, nie ersatzweise über den Mayer-Bot. Keine Beträge.
// - Einstellung je Person in privat_einstellungen.briefing: morgenplan / abendrueckblick (false = aus; fehlt = an).
// - Höchstens einmal je Person, Art und Tag: Sperrzeile in tagesplan_meldungen (gleiche Tabelle wie
//   tagesplanMeldungen.ts, dort ist art auf 'morgen'/'abend' begrenzt) mit eigener Kennung
//   `privatplan|<art>|<adresse>|<datum>` — sie kommt Quirins `<art>|<adresse>|<datum>` nie in die Quere. Erst lesen,
//   dann sperren, dann senden: Klappt das Lesen nicht, versucht es der nächste Takt; wer die Sperre nicht anlegen kann
//   (schon da, Tabelle fehlt), sendet nicht. Klappt das Senden nicht, wird es nicht wiederholt.
// - Wirft nie: Fehler stehen im Ergebnis.

import { alleZeilen } from '../_shared/alleZeilen.ts'
import { privatBotAktiv, sendePrivat } from '../_shared/telegramPrivat.ts'
import { hotmailAbschnitte } from './hotmailBriefing.ts'
import { alsDatum, berlinTagesbeginn, berlinZeit, MS_HOECHSTENS_TAGE, plusTage } from './tagesmeldung.ts'
import { ausgeblendeteListen } from './todoAbgleich.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type PlanArt = 'morgen' | 'abend'

/** Senden über den privaten Bot: Text und z. B. reply_markup. true = zugestellt. */
export type PlanSenden = (chatId: number | string, text: string, extra?: Record<string, unknown>) => Promise<boolean>

export type PlanKontext = { art: PlanArt; datum: string; jetzt: Date }

/** Zusatzteil eines anderen Bausteins: fertige Zeilen (erste Zeile = Überschrift), leer = nichts. Darf werfen. */
export type PlanZusatz = (admin: Db, email: string, kontext: PlanKontext) => Promise<string[]>

export type PlanOptionen = {
  /** Wer nutzt den privaten Bot? Vorgabe privatBotAktiv (Schlüssel, Freischaltung MS_ERLAUBT, briefing.privatBot). */
  privatAktiv?: (email: string) => Promise<boolean>
  /** Zusatzteile für den Morgenplan (z. B. hotmailZeilen, Fristen, Vertrags-Fristen) in dieser Reihenfolge. */
  zusatzMorgen?: PlanZusatz[]
  /** Zusatzteile für den Abend-Rückblick. */
  zusatzAbend?: PlanZusatz[]
}

export type PlanErgebnis = {
  morgen: number
  abend: number
  /** Personen, bei denen nichts anstand (keine Nachricht). */
  leer: number
  fehler: string[]
  /** Vage Aufgaben, nach denen abends gefragt wurde — zum Ablegen im Gesprächsverlauf des privaten Assistenten. */
  rueckfragen: { email: string; todoIds: string[] }[]
}

export const MORGEN_AB = 8 * 60
export const MORGEN_BIS = 11 * 60
export const ABEND_AB = 21 * 60 + 30
export const ABEND_BIS = 23 * 60 + 30
/** Höchstens so viele Aufgaben bzw. Einträge je Liste. */
export const HOECHSTENS_AUFGABEN = 5
export const HOECHSTENS_TERMINE = 4
export const HOECHSTENS_VAGE = 3
/** Höchstens so viele Zeilen je Zusatzteil (samt Überschrift). */
export const HOECHSTENS_ZUSATZ_ZEILEN = 6
/** Präfix der Knöpfe (callback_data) im privaten Bot. */
export const KNOPF_PRAEFIX = 'pt:'

const TABELLE = 'tagesplan_meldungen'
const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const TODO_SPALTEN = 'id, aufgabe, prio, erledigen_bis, geplante_wiedervorlage, erledigt_am, kunde_projekt, aktueller_stand, besitzer_email, bereich, ms_id, ms_liste_id, erstellt_am'
const TERMIN_SPALTEN = 'id, titel, beginn, ende, ganztags, ort, teilnehmer, kunde_id, kunde_bereich, besitzer_email'

const standardSenden: PlanSenden = async (chatId, text, extra) => !!(await sendePrivat(chatId, text, extra ?? {}))

// ---------------------------------------------------------------------------------------------
// Zeitfenster und Einstellung
// ---------------------------------------------------------------------------------------------

/** Welche Meldung ist gerade dran? Jeden Tag (auch am Wochenende); sonst null. */
export function planFenster(jetzt: Date): { art: PlanArt; datum: string; wochentag: number } | null {
  const b = berlinZeit(jetzt)
  const min = b.stunde * 60 + b.minute
  if (min >= MORGEN_AB && min < MORGEN_BIS) return { art: 'morgen', datum: b.datum, wochentag: b.wochentag }
  if (min >= ABEND_AB && min < ABEND_BIS) return { art: 'abend', datum: b.datum, wochentag: b.wochentag }
  return null
}

/** Einstellung aus privat_einstellungen.briefing: fehlend = an, nur false schaltet aus. */
export function planEinstellung(briefing: unknown): { morgenplan: boolean; abendrueckblick: boolean } {
  const b = briefing && typeof briefing === 'object' && !Array.isArray(briefing) ? (briefing as Record<string, unknown>) : {}
  return { morgenplan: b.morgenplan !== false, abendrueckblick: b.abendrueckblick !== false }
}

async function ladeBriefing(admin: Db, email: string): Promise<unknown> {
  const { data, error } = await admin.from('privat_einstellungen').select('briefing').eq('login_email', email).maybeSingle()
  if (error) throw new Error(`privat_einstellungen: ${error.message}`)
  return data?.briefing ?? null
}

/**
 * Für die Zusammenführung mit tagesmeldung.ts: Bekommt diese Person morgens den privaten Morgenplan?
 * (privater Bot aktiv und briefing.morgenplan nicht ausgeschaltet). Dann lässt tagesmeldung.ts die Privat-Übersicht weg.
 * Wirft nie (im Zweifel false — dann bleibt alles wie bisher).
 */
export async function privatMorgenplanAktiv(admin: Db, email: string, privatAktiv?: (email: string) => Promise<boolean>): Promise<boolean> {
  const ich = String(email ?? '').trim().toLowerCase()
  if (!ich) return false
  try {
    if (!(await (privatAktiv ?? ((e: string) => privatBotAktiv(admin, e)))(ich))) return false
    return planEinstellung(await ladeBriefing(admin, ich)).morgenplan
  } catch {
    return false
  }
}

/** Schaltet Morgenplan/Abend-Rückblick einer Person an oder aus (für ein späteres Werkzeug „Morgenplan aus“). */
export async function setzePlanEinstellung(admin: Db, email: string, wert: { morgenplan?: boolean; abendrueckblick?: boolean }): Promise<string | null> {
  const ich = String(email ?? '').trim().toLowerCase()
  if (!ich) return 'Keine Adresse.'
  try {
    const { data, error } = await admin.from('privat_einstellungen').select('briefing').eq('login_email', ich).maybeSingle()
    if (error) return error.message
    const alt = data?.briefing && typeof data.briefing === 'object' ? data.briefing : {}
    const neu = { ...alt, ...(wert.morgenplan === undefined ? {} : { morgenplan: wert.morgenplan }), ...(wert.abendrueckblick === undefined ? {} : { abendrueckblick: wert.abendrueckblick }) }
    const { error: f } = await admin.from('privat_einstellungen').upsert({ login_email: ich, briefing: neu, geaendert_am: new Date().toISOString() })
    return f ? f.message : null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// ---------------------------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------------------------

function text(wert: unknown): string {
  return typeof wert === 'string' ? wert : wert == null ? '' : String(wert)
}

function kurz(wert: string, laenge = 60): string {
  const sauber = wert.replace(/\s+/g, ' ').trim()
  return sauber.length <= laenge ? sauber : `${sauber.slice(0, laenge - 1).trimEnd()}…`
}

/** „2026-11-18“ → „18.11.“ (im laufenden Jahr) bzw. „18.11.2025“. */
function datumKurz(datum: string, heute: string): string {
  const [y, m, d] = datum.split('-')
  return y === heute.slice(0, 4) ? `${d}.${m}.` : `${d}.${m}.${y}`
}

function vorname(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

const PRIO_RANG: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 }

function prioRang(prio: unknown): number {
  return PRIO_RANG[text(prio).trim().toUpperCase().slice(0, 1)] ?? 9
}

// ---------------------------------------------------------------------------------------------
// Aufgaben
// ---------------------------------------------------------------------------------------------

export type PlanTodo = {
  id: string
  aufgabe?: string | null
  prio?: string | null
  erledigen_bis?: string | null
  geplante_wiedervorlage?: string | null
  erledigt_am?: string | null
  kunde_projekt?: string | null
  aktueller_stand?: string | null
  besitzer_email?: string | null
  bereich?: string | null
  ms_id?: string | null
  ms_liste_id?: string | null
  erstellt_am?: string | null
}

export type FaelligeAufgabe = { todo: PlanTodo; tag: string; ueberfaellig: boolean; wiedervorlage: boolean }

/** Gehört das To-do zur eigenen Liste dieser Person (nicht zu einer Bereichsliste)? */
export function istEigenes(t: PlanTodo, email: string): boolean {
  return !text(t.bereich).trim() && text(t.besitzer_email).trim().toLowerCase() === email.trim().toLowerCase()
}

/**
 * Wann ist das offene To-do fällig, bezogen auf `stichtag` (heute oder morgen)? Frist zuerst, sonst Wiedervorlage.
 * null = nicht bis zum Stichtag fällig, erledigt, leer, ausgeblendet oder zu alte Microsoft-Aufgabe.
 */
export function faelligkeit(t: PlanTodo, stichtag: string, heute: string, ausgeblendet: Set<string> = new Set()): FaelligeAufgabe | null {
  if (text(t.erledigt_am).trim() || !text(t.aufgabe).trim()) return null
  const microsoft = !!text(t.ms_id)
  if (microsoft && ausgeblendet.has(text(t.ms_liste_id))) return null
  const frist = alsDatum(t.erledigen_bis)
  const wv = alsDatum(t.geplante_wiedervorlage)
  let tag = ''
  let wiedervorlage = false
  if (frist && frist <= stichtag) tag = frist
  else if (wv && wv <= stichtag) {
    tag = wv
    wiedervorlage = true
  } else return null
  if (microsoft && tag < plusTage(heute, -MS_HOECHSTENS_TAGE)) return null
  return { todo: t, tag, ueberfaellig: tag < heute, wiedervorlage }
}

/** Überfällig vor heute fällig, dann Prio A vor B vor C vor D (ohne Prio zuletzt), dann älteste Frist. */
export function sortiereFaellige(liste: FaelligeAufgabe[]): FaelligeAufgabe[] {
  return [...liste].sort(
    (a, b) =>
      Number(b.ueberfaellig) - Number(a.ueberfaellig) ||
      prioRang(a.todo.prio) - prioRang(b.todo.prio) ||
      a.tag.localeCompare(b.tag) ||
      text(a.todo.aufgabe).localeCompare(text(b.todo.aufgabe), 'de') ||
      a.todo.id.localeCompare(b.todo.id),
  )
}

/** Eine Aufgabe als Zeile (ohne Aufzählungszeichen). */
export function aufgabenZeile(f: FaelligeAufgabe, heute: string): string {
  const t = f.todo
  const projekt = text(t.kunde_projekt).trim()
  const was = f.wiedervorlage ? 'Wiedervorlage' : 'fällig'
  const wann = f.tag < heute
    ? `${f.wiedervorlage ? 'Wiedervorlage' : 'überfällig'} seit ${datumKurz(f.tag, heute)}`
    : f.tag === heute
    ? `${was} heute`
    : f.tag === plusTage(heute, 1)
    ? `${was} morgen`
    : `${was} ${datumKurz(f.tag, heute)}`
  const prio = text(t.prio).trim().toUpperCase().slice(0, 1)
  return `${kurz(text(t.aufgabe), 60)}${projekt ? ` (${kurz(projekt, 30)})` : ''} – ${wann}${prio ? ` · Prio ${prio}` : ''}`
}

const VAGE_MUSTER = /\bunklar\b|\bdetails?\b|\?|\birgendwas\b|\birgendwie\b|\bwas war\b|\.\.\.|…|\bxxx\b/i

/**
 * Ist der Aufgabentext zu vage, um ihn ohne Rückfrage zu erledigen? Enthält „unklar“, „Details“, „?“, „…“ o. ä.
 * oder besteht nur aus 1–2 Wörtern — Letzteres nur, wenn auch Kunde/Projekt und aktueller Stand leer sind.
 */
export function istVage(t: Pick<PlanTodo, 'aufgabe' | 'kunde_projekt' | 'aktueller_stand'>): boolean {
  const a = text(t.aufgabe).trim()
  if (!a) return false
  if (VAGE_MUSTER.test(a)) return true
  const woerter = a.split(/\s+/).filter((w) => /\p{L}/u.test(w))
  return woerter.length <= 2 && !text(t.kunde_projekt).trim() && !text(t.aktueller_stand).trim()
}

// ---------------------------------------------------------------------------------------------
// Termine
// ---------------------------------------------------------------------------------------------

export type PlanTermin = {
  id: string
  titel?: string | null
  beginn?: string | null
  ende?: string | null
  ganztags?: boolean | null
  ort?: string | null
  teilnehmer?: string[] | null
  kunde_id?: string | null
  kunde_bereich?: string | null
  besitzer_email?: string | null
}

/** Privater Termin der Person: ihr eigener, ohne Teilnehmer, ohne Mayer-Akte (keine Akte oder Akte im Bereich Privat). */
export function istPrivaterTermin(t: PlanTermin, email: string): boolean {
  if (text(t.besitzer_email).trim().toLowerCase() !== email.trim().toLowerCase()) return false
  if (Array.isArray(t.teilnehmer) && t.teilnehmer.some((x) => text(x).trim())) return false
  return !text(t.kunde_id).trim() || text(t.kunde_bereich).trim() === 'privat'
}

/** Termine, die den Berliner Tag `datum` berühren, nach Beginn (ganztägige zuerst). */
export function termineAm(termine: PlanTermin[], email: string, datum: string): PlanTermin[] {
  const von = berlinTagesbeginn(datum).getTime()
  const bis = berlinTagesbeginn(plusTage(datum, 1)).getTime()
  return termine
    .filter((t) => {
      if (!istPrivaterTermin(t, email)) return false
      const b = new Date(text(t.beginn)).getTime()
      if (Number.isNaN(b)) return false
      const e = new Date(text(t.ende) || text(t.beginn)).getTime()
      return b < bis && (e > von || (e === b && b >= von))
    })
    .sort((a, b) => Number(b.ganztags === true) - Number(a.ganztags === true) || text(a.beginn).localeCompare(text(b.beginn)))
}

function terminZeile(t: PlanTermin): string {
  const wann = t.ganztags === true ? 'ganztags' : UHR.format(new Date(text(t.beginn)))
  const ort = text(t.ort).trim()
  return `${wann} ${kurz(text(t.titel) || '(ohne Titel)', 50)}${ort ? ` (${kurz(ort, 30)})` : ''}`
}

// ---------------------------------------------------------------------------------------------
// Daten einer Person
// ---------------------------------------------------------------------------------------------

export type PlanDaten = {
  /** Offene eigene To-dos mit Frist oder Wiedervorlage bis morgen. */
  faellig: PlanTodo[]
  /** Offene eigene To-dos, in den letzten Tagen angelegt (z. B. diktiert) — für die Rückfrage bei vagen Texten. */
  neu: PlanTodo[]
  /** Heute erledigte eigene To-dos (Zahl). */
  heuteErledigt: number
  /** Termine von heute 0 Uhr bis übermorgen 0 Uhr (alle Besitzer; gefiltert wird beim Bauen). */
  termine: PlanTermin[]
  /** Ausgeblendete Microsoft-Listen der Person. */
  ausgeblendet: Set<string>
}

/** Liest, was die Person heute/morgen betrifft. Wirft bei einem Lesefehler (dann versucht es der nächste Takt). */
export async function ladePlanDaten(admin: Db, email: string, heute: string): Promise<PlanDaten> {
  const morgen = plusTage(heute, 1)
  const von = berlinTagesbeginn(heute).toISOString()
  const bis = berlinTagesbeginn(plusTage(heute, 2)).toISOString()
  const pruefe = <T>(r: { data: T[]; error: { message: string } | null }, was: string): T[] => {
    if (r.error) throw new Error(`${was}: ${r.error.message}`)
    return r.data
  }
  const [faellig, neu, erledigt, termine, konto] = await Promise.all([
    alleZeilen<PlanTodo>(() =>
      admin.from('todos').select(TODO_SPALTEN).is('bereich', null).is('erledigt_am', null).eq('besitzer_email', email).or(`erledigen_bis.lte.${morgen},geplante_wiedervorlage.lte.${morgen}`)
    ),
    alleZeilen<PlanTodo>(() => admin.from('todos').select(TODO_SPALTEN).is('bereich', null).is('erledigt_am', null).eq('besitzer_email', email).gte('erstellt_am', plusTage(heute, -2)), { hoechstens: 200 }),
    alleZeilen<{ id: string }>(() => admin.from('todos').select('id').is('bereich', null).eq('besitzer_email', email).eq('erledigt_am', heute)),
    alleZeilen<PlanTermin>(() => admin.from('termine').select(TERMIN_SPALTEN).eq('besitzer_email', email).lt('beginn', bis).gte('ende', von)),
    admin.from('ms_konten').select('stand').eq('login_email', email).maybeSingle().then((r: { data: { stand?: unknown } | null }) => r, () => ({ data: null })),
  ])
  return {
    faellig: pruefe(faellig, 'To-dos'),
    neu: pruefe(neu, 'Neue To-dos'),
    heuteErledigt: pruefe(erledigt, 'Erledigte To-dos').length,
    termine: pruefe(termine, 'Termine'),
    ausgeblendet: ausgeblendeteListen(konto?.data?.stand),
  }
}

// ---------------------------------------------------------------------------------------------
// Nachrichten
// ---------------------------------------------------------------------------------------------

export type PlanNachricht = { text: string; knoepfe: { text: string; callback_data: string }[][]; vage: string[] }

function zusatzBlock(zeilen: string[]): string[] {
  const z = zeilen.map((x) => text(x).trimEnd()).filter((x) => x.trim())
  if (z.length <= HOECHSTENS_ZUSATZ_ZEILEN) return z
  return [...z.slice(0, HOECHSTENS_ZUSATZ_ZEILEN - 1), '…']
}

/** Der Morgenplan als Text — null, wenn nichts ansteht. Rechnet nur. */
export function morgenplanText(name: string, d: PlanDaten, email: string, heute: string, wochentag: number, zusatz: string[][] = []): string | null {
  const termine = termineAm(d.termine, email, heute)
  const faellig = sortiereFaellige(d.faellig.filter((t) => istEigenes(t, email)).map((t) => faelligkeit(t, heute, heute, d.ausgeblendet)).filter((f): f is FaelligeAufgabe => !!f))
  const bloecke = zusatz.map(zusatzBlock).filter((b) => b.length)
  if (!termine.length && !faellig.length && !bloecke.length) return null

  const wochenende = wochentag === 0 || wochentag === 6
  const vn = vorname(name)
  const zeilen = [
    wochenende
      ? `Guten Morgen${vn ? ` ${vn}` : ''}, dein ${WOCHENTAG[wochentag]} (${datumKurz(heute, heute)}) — nur das Wichtigste fürs Wochenende:`
      : `Guten Morgen${vn ? ` ${vn}` : ''}, dein privater Plan für ${WOCHENTAG[wochentag]} (${datumKurz(heute, heute)}):`,
  ]
  if (termine.length) {
    zeilen.push('', wochenende ? 'Termine:' : 'Termine heute:')
    zeilen.push(...termine.slice(0, HOECHSTENS_TERMINE).map((t) => `• ${terminZeile(t)}`))
    if (termine.length > HOECHSTENS_TERMINE) zeilen.push(`… und ${termine.length - HOECHSTENS_TERMINE} weitere`)
  }
  if (faellig.length) {
    const ueber = faellig.filter((f) => f.ueberfaellig).length
    zeilen.push('', ueber ? `Fällig (${ueber} überfällig, ${faellig.length - ueber} heute):` : `Heute fällig (${faellig.length}):`)
    zeilen.push(...faellig.slice(0, HOECHSTENS_AUFGABEN).map((f) => `• ${aufgabenZeile(f, heute)}`))
    if (faellig.length > HOECHSTENS_AUFGABEN) zeilen.push(`… und ${faellig.length - HOECHSTENS_AUFGABEN} weitere`)
  }
  for (const b of bloecke) zeilen.push('', ...b)
  return zeilen.join('\n')
}

/** Der Abend-Rückblick mit Knöpfen — null, wenn nichts zu sagen ist. Rechnet nur. */
export function abendrueckblickNachricht(name: string, d: PlanDaten, email: string, heute: string, wochentag: number, zusatz: string[][] = []): PlanNachricht | null {
  const morgen = plusTage(heute, 1)
  const eigene = d.faellig.filter((t) => istEigenes(t, email))
  const offen = sortiereFaellige(eigene.map((t) => faelligkeit(t, heute, heute, d.ausgeblendet)).filter((f): f is FaelligeAufgabe => !!f))
  const offenIds = new Set(offen.map((f) => f.todo.id))
  const morgenTodos = sortiereFaellige(
    eigene.filter((t) => !offenIds.has(t.id)).map((t) => faelligkeit(t, morgen, heute, d.ausgeblendet)).filter((f): f is FaelligeAufgabe => !!f && f.tag === morgen),
  )
  const morgenTermine = termineAm(d.termine, email, morgen)
  const bloecke = zusatz.map(zusatzBlock).filter((b) => b.length)

  // Vage Aufgaben: zuerst frisch angelegte (diktierte), dann die gezeigten offenen, dann morgen fällige.
  const gesehen = new Set<string>()
  const vage: PlanTodo[] = []
  const kandidaten = [
    ...[...d.neu].filter((t) => istEigenes(t, email) && !text(t.erledigt_am).trim()).sort((a, b) => text(b.erstellt_am).localeCompare(text(a.erstellt_am))),
    ...offen.map((f) => f.todo),
    ...morgenTodos.map((f) => f.todo),
  ]
  for (const t of kandidaten) {
    if (vage.length >= HOECHSTENS_VAGE || gesehen.has(t.id)) continue
    gesehen.add(t.id)
    if (istVage(t)) vage.push(t)
  }

  if (!d.heuteErledigt && !offen.length && !morgenTodos.length && !morgenTermine.length && !vage.length && !bloecke.length) return null

  const vn = vorname(name)
  const zeilen = [`Guten Abend${vn ? ` ${vn}` : ''}, dein Rückblick auf ${WOCHENTAG[wochentag]} (${datumKurz(heute, heute)}):`, '']
  zeilen.push(d.heuteErledigt ? `✓ Heute erledigt: ${d.heuteErledigt}` : 'Heute erledigt: noch nichts abgehakt.')

  const knoepfe: PlanNachricht['knoepfe'] = []
  if (offen.length) {
    zeilen.push('', `Noch offen für heute oder überfällig (${offen.length}):`)
    offen.slice(0, HOECHSTENS_AUFGABEN).forEach((f, i) => {
      zeilen.push(`${i + 1}. ${aufgabenZeile(f, heute)}`)
      const e = `${KNOPF_PRAEFIX}e:${f.todo.id}`
      const m = `${KNOPF_PRAEFIX}m:${f.todo.id}`
      // Telegram erlaubt höchstens 64 Bytes je Knopf — sonst ohne Knopf (kommt bei den heutigen Kennungen nicht vor).
      if (new TextEncoder().encode(e).length <= 64) knoepfe.push([{ text: `✓ Erledigt (${i + 1})`, callback_data: e }, { text: `→ Morgen (${i + 1})`, callback_data: m }])
    })
    if (offen.length > HOECHSTENS_AUFGABEN) zeilen.push(`… und ${offen.length - HOECHSTENS_AUFGABEN} weitere`)
  } else if (d.heuteErledigt) zeilen.push('Für heute ist nichts mehr offen.')

  const morgenZeilen = [...morgenTermine.map(terminZeile), ...morgenTodos.map((f) => aufgabenZeile(f, heute))]
  if (morgenZeilen.length) {
    zeilen.push('', 'Morgen steht an:')
    zeilen.push(...morgenZeilen.slice(0, HOECHSTENS_AUFGABEN).map((z) => `• ${z}`))
    if (morgenZeilen.length > HOECHSTENS_AUFGABEN) zeilen.push(`… und ${morgenZeilen.length - HOECHSTENS_AUFGABEN} weitere`)
  }
  if (vage.length) {
    zeilen.push('', `Bei diesen fehlt noch etwas: ${vage.map((t) => `„${kurz(text(t.aufgabe), 50)}“`).join(', ')} — sag mir kurz, was gemeint ist.`)
  }
  for (const b of bloecke) zeilen.push('', ...b)
  return { text: zeilen.join('\n'), knoepfe, vage: vage.map((t) => t.id) }
}

// ---------------------------------------------------------------------------------------------
// Zusatzteil Hotmail (für die Zusammenführung mit tagesmeldung.ts)
// ---------------------------------------------------------------------------------------------

/**
 * Hotmail-Teil (hotmailBriefing.ts) kurz als Zusatzteil für den Morgenplan: je Abschnitt die Überschrift und
 * höchstens zwei Mails, insgesamt höchstens 6 Zeilen. Ohne Microsoft-Konto/Freischaltung leer. Wirft nie.
 */
export const hotmailZeilen: PlanZusatz = async (admin, email, kontext) => {
  try {
    const abschnitte = await hotmailAbschnitte(admin, email, kontext.jetzt)
    const zeilen: string[] = []
    for (const a of abschnitte) {
      zeilen.push(a.titel, ...a.zeilen.slice(0, 2))
      if (a.zeilen.length > 2) zeilen.push(`… und ${a.zeilen.length - 2} weitere`)
    }
    return zeilen.slice(0, HOECHSTENS_ZUSATZ_ZEILEN)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------------------------
// Der Lauf
// ---------------------------------------------------------------------------------------------

export function sperrKennung(art: PlanArt, email: string, datum: string): string {
  return `privatplan|${art}|${email}|${datum}`
}

/**
 * Vom Minutentakt gerufen. Außerhalb der Zeitfenster ohne Datenbankzugriff. Wirft nie.
 * `senden` geht über den privaten Bot (Vorgabe sendePrivat); in Tests einsetzbar.
 */
export async function sendePrivatTagesplaene(admin: Db, jetzt: Date = new Date(), senden: PlanSenden = standardSenden, optionen: PlanOptionen = {}): Promise<PlanErgebnis> {
  const ergebnis: PlanErgebnis = { morgen: 0, abend: 0, leer: 0, fehler: [], rueckfragen: [] }
  try {
    const f = planFenster(jetzt)
    if (!f) return ergebnis
    const { data: team, error } = await admin.from('mitarbeiter').select('name, email, telegram_chat_id, aktiv').eq('aktiv', true)
    if (error) {
      ergebnis.fehler.push(`mitarbeiter: ${error.message}`)
      return ergebnis
    }
    const personen = ((team ?? []) as { name?: string | null; email?: string | null; telegram_chat_id?: number | string | null; aktiv?: boolean }[])
      .map((m) => ({ name: text(m.name).trim(), email: text(m.email).trim().toLowerCase(), chat: m.telegram_chat_id }))
      .filter((m) => m.email && m.chat != null && m.chat !== '')
    if (!personen.length) return ergebnis

    // Wer schon dran war, wird nicht noch einmal gelesen.
    const { data: schon, error: sperrFehler } = await admin.from(TABELLE).select('id').in('id', personen.map((p) => sperrKennung(f.art, p.email, f.datum)))
    if (sperrFehler) {
      ergebnis.fehler.push(`${TABELLE} nicht lesbar: ${sperrFehler.message}`)
      return ergebnis
    }
    const erledigt = new Set(((schon ?? []) as { id: string }[]).map((x) => x.id))
    const aktiv = optionen.privatAktiv ?? ((e: string) => privatBotAktiv(admin, e))

    for (const p of personen) {
      const id = sperrKennung(f.art, p.email, f.datum)
      if (erledigt.has(id)) continue
      try {
        if (!(await aktiv(p.email))) continue
        const einstellung = planEinstellung(await ladeBriefing(admin, p.email))
        if (f.art === 'morgen' ? !einstellung.morgenplan : !einstellung.abendrueckblick) continue

        // Erst alles lesen (Fehler → nächster Takt), dann sperren, dann senden.
        const daten = await ladePlanDaten(admin, p.email, f.datum)
        const kontext: PlanKontext = { art: f.art, datum: f.datum, jetzt }
        const zusatz: string[][] = []
        for (const z of (f.art === 'morgen' ? optionen.zusatzMorgen : optionen.zusatzAbend) ?? []) {
          try {
            zusatz.push(await z(admin, p.email, kontext))
          } catch (err) {
            ergebnis.fehler.push(`${p.email}: Zusatzteil fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        const nachricht: PlanNachricht | null = f.art === 'morgen'
          ? (() => {
            const t = morgenplanText(p.name, daten, p.email, f.datum, f.wochentag, zusatz)
            return t ? { text: t, knoepfe: [], vage: [] } : null
          })()
          : abendrueckblickNachricht(p.name, daten, p.email, f.datum, f.wochentag, zusatz)

        const { error: sperre } = await admin.from(TABELLE).insert({ id, email: p.email, art: f.art, datum: f.datum })
        if (sperre) {
          if (sperre.code !== '23505') ergebnis.fehler.push(`${p.email}: Meldung nicht vermerkt (${sperre.message}) — nicht gesendet.`)
          continue
        }
        if (!nachricht) {
          ergebnis.leer += 1
          continue
        }
        const extra = nachricht.knoepfe.length ? { reply_markup: { inline_keyboard: nachricht.knoepfe } } : undefined
        // Privat bleibt privat: nur über den privaten Bot, kein Ersatzweg über den Mayer-Bot.
        const ok = (await senden(p.chat!, nachricht.text, extra)) === true
        await admin.from(TABELLE).update({ zugestellt: ok }).eq('id', id)
        if (ok) {
          ergebnis[f.art] += 1
          if (nachricht.vage.length) ergebnis.rueckfragen.push({ email: p.email, todoIds: nachricht.vage })
        } else ergebnis.fehler.push(`${p.email}: ${f.art === 'morgen' ? 'Morgenplan' : 'Abend-Rückblick'} nicht zugestellt.`)
      } catch (err) {
        ergebnis.fehler.push(`${p.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    ergebnis.fehler.push(err instanceof Error ? err.message : String(err))
  }
  return ergebnis
}

// ---------------------------------------------------------------------------------------------
// Knöpfe „✓ Erledigt“ / „→ Morgen“
// ---------------------------------------------------------------------------------------------

/** Ist das ein Knopf dieses Bausteins (callback_data „pt:e:<id>“ oder „pt:m:<id>“)? */
export function istPlanKnopf(daten: unknown): boolean {
  return /^pt:[em]:[A-Za-z0-9_-]{1,59}$/.test(text(daten))
}

/**
 * Führt einen Knopf aus dem Abend-Rückblick aus — nur für To-dos der EIGENEN Liste dieser Person, die noch offen sind.
 * Erledigt: erledigt_am = heute. Morgen: erledigen_bis = morgen (eine fällige Wiedervorlage rückt mit auf morgen).
 * Liefert einen kurzen Text für die Antwort auf den Knopf (answerCallbackQuery). Wirft nie.
 */
export async function fuehrePlanKnopfAus(admin: Db, email: string, daten: unknown, jetzt: Date = new Date()): Promise<{ ok: boolean; text: string }> {
  const m = /^pt:([em]):([A-Za-z0-9_-]{1,59})$/.exec(text(daten))
  const ich = text(email).trim().toLowerCase()
  if (!m || !ich) return { ok: false, text: 'Unbekannter Knopf.' }
  const [, art, todoId] = m
  try {
    const { data: t, error } = await admin.from('todos').select('id, aufgabe, besitzer_email, bereich, erledigt_am, erledigen_bis, geplante_wiedervorlage').eq('id', todoId).maybeSingle()
    if (error) return { ok: false, text: 'Das hat gerade nicht geklappt. Bitte später noch einmal.' }
    if (!t || !istEigenes(t as PlanTodo, ich)) return { ok: false, text: 'Diese Aufgabe gibt es in deiner eigenen Liste nicht.' }
    const name = `„${kurz(text(t.aufgabe), 60)}“`
    if (text(t.erledigt_am).trim()) return { ok: false, text: `${name} ist schon erledigt.` }
    const heute = berlinZeit(jetzt).datum
    const morgen = plusTage(heute, 1)
    let aenderung: Record<string, string>
    if (art === 'e') aenderung = { erledigt_am: heute }
    else {
      aenderung = { erledigen_bis: morgen }
      const wv = alsDatum(t.geplante_wiedervorlage)
      if (wv && wv <= heute) aenderung.geplante_wiedervorlage = morgen
    }
    // Nur ändern, wenn es inzwischen nicht anderswo erledigt wurde.
    const { data: geaendert, error: f } = await admin.from('todos').update(aenderung).eq('id', todoId).eq('besitzer_email', t.besitzer_email).is('erledigt_am', null).select('id')
    if (f) return { ok: false, text: 'Das hat gerade nicht geklappt. Bitte später noch einmal.' }
    if (!(geaendert ?? []).length) return { ok: false, text: `${name} ist schon erledigt.` }
    return art === 'e' ? { ok: true, text: `Erledigt: ${name}` } : { ok: true, text: `Auf morgen verschoben: ${name}` }
  } catch {
    return { ok: false, text: 'Das hat gerade nicht geklappt. Bitte später noch einmal.' }
  }
}
