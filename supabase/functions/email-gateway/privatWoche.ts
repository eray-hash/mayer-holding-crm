// Privates Kurz-Briefing vor Terminen und Sonntags-Wochenrückblick über den privaten Telegram-Bot (24.11.2026) —
// vom Minutentakt (Aktion termin_erinnerungen) gerufen, ohne KI und ohne offenes Browserfenster. Nur für Personen mit
// aktivem privatem Bot (_shared/telegramPrivat.ts, privatBotAktiv). Vorbild und Bausteine: privatTagesplan.ts.
//
// (1) Kurz-Briefing vor Terminen (sendePrivatTerminBriefings): für eigene PRIVATE Termine (ohne Teilnehmer im CRM, ohne
//     Mayer-Akte, nicht ganztags, nicht abgesagt) mit Beginn in 25–40 Minuten — aber nur, wenn eine Person erkennbar ist:
//     ein Outlook-Teilnehmer außer ihm selbst und außer Kollegen, sonst der Titel („mit Herrn/Frau X“, „mit X Y“,
//     „Termin X“, „Rückruf Frau X“; erkennePerson). Ohne erkennbare Person KEIN Briefing. Inhalt höchstens ~10 Zeilen:
//     Termin (Zeit, Ort, Person), aus person_ueberblick (telegram-gateway/personUeberblick.ts, liest Hotmail über das
//     email-gateway) verdichtet: letzte Mails (Datum + Betreff, höchstens 3), offene To-dos und Notizen mit der Person,
//     sonst ein Hinweis „nichts gefunden“. Am Ende „(‚Briefing aus‘ schaltet das ab.)“. Einmal je Termin.
// (2) Sonntags-Wochenrückblick (sendePrivatWochenrueckblicke): sonntags beim ersten Takt ab 18:00 bis 21:00 Berliner Zeit:
//     diese Woche erledigt (Anzahl, höchstens 5 Beispiele), noch offen/überfällig (Anzahl + wichtigste 3), nächste Woche:
//     private Termine (höchstens 6, nach Tag) und fällige To-dos/Wiedervorlagen (höchstens 5), dann Zusatzteile anderer
//     Bausteine (gleiche Form wie in privatTagesplan.ts, PlanZusatz). Steht nichts drin: keine Nachricht. Einmal je Woche.
// (3) setzeWochenEinstellung: Rückweg für ein Werkzeug „Briefing aus/an“ bzw. „Wochenrückblick aus/an“.
//
// - Privat bleibt privat: nur über den privaten Bot, nie ersatzweise über den Mayer-Bot; keine Mayer-Akten (das
//   Mayer-Termin-Briefing ist _shared/terminBriefingKern.ts). Keine Beträge.
// - Einstellung je Person in privat_einstellungen.briefing: terminBriefing / wochenrueckblick (false = aus; fehlt = an).
// - Sperrzeile in tagesplan_meldungen (dort ist art auf 'morgen'/'abend' begrenzt): Briefing art 'morgen', Kennung
//   `privatbriefing|<termin_id>`; Wochenrückblick art 'abend', Kennung `privatwoche|<adresse>|<sonntag>`. Erst lesen,
//   dann sperren, dann senden: wer die Sperre nicht anlegen kann (schon da, Tabelle fehlt), sendet nicht; klappt das
//   Senden nicht, wird es nicht wiederholt.
// - Wirft nie: Fehler stehen im Ergebnis.

import { alleZeilen } from '../_shared/alleZeilen.ts'
import { istAbgesagterTitel } from '../_shared/terminBriefingKern.ts'
import { privatBotAktiv, privatBotToken, sendePrivat } from '../_shared/telegramPrivat.ts'
import { fuehrePersonWerkzeugAus, normalisiere } from '../telegram-gateway/personUeberblick.ts'
import {
  aufgabenZeile,
  type FaelligeAufgabe,
  faelligkeit,
  istEigenes,
  istPrivaterTermin,
  type PlanKontext,
  type PlanSenden,
  type PlanTermin,
  type PlanTodo,
  type PlanZusatz,
  sortiereFaellige,
} from './privatTagesplan.ts'
import { berlinTagesbeginn, berlinZeit, plusTage } from './tagesmeldung.ts'
import { ausgeblendeteListen } from './todoAbgleich.ts'

// deno-lint-ignore no-explicit-any
type Db = any

/** Briefing: Termine mit Beginn in so vielen Minuten (einschließlich). */
export const BRIEFING_AB_MIN = 25
export const BRIEFING_BIS_MIN = 40
/** Höchstens so viele Briefings je Takt (jedes liest Hotmail). */
export const BRIEFINGS_JE_TAKT = 5
export const BRIEFING_MAILS = 3
export const BRIEFING_TODOS = 2
export const BRIEFING_NOTIZEN = 1
/** Wochenrückblick sonntags 18:00 bis 21:00 Berliner Zeit. */
export const WOCHE_AB = 18 * 60
export const WOCHE_BIS = 21 * 60
export const WOCHE_ERLEDIGT = 5
export const WOCHE_OFFEN = 3
export const WOCHE_TERMINE = 6
export const WOCHE_FAELLIG = 5
export const HOECHSTENS_ZUSATZ_ZEILEN = 6
export const BRIEFING_AUS_SATZ = '(‚Briefing aus‘ schaltet das ab.)'
export const WOCHE_AUS_SATZ = '(‚Wochenrückblick aus‘ schaltet das ab.)'

const TABELLE = 'tagesplan_meldungen'
const TAG_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const BRIEFING_TERMIN_SPALTEN = 'id, titel, ort, beschreibung, beginn, ende, ganztags, teilnehmer, kunde_id, kunde_bereich, besitzer_email, ms_teilnehmer'
const WOCHE_TERMIN_SPALTEN = 'id, titel, beginn, ende, ganztags, ort, teilnehmer, kunde_id, kunde_bereich, besitzer_email'
const TODO_SPALTEN = 'id, aufgabe, prio, erledigen_bis, geplante_wiedervorlage, erledigt_am, kunde_projekt, aktueller_stand, besitzer_email, bereich, ms_id, ms_liste_id, erstellt_am'

const standardSenden: PlanSenden = async (chatId, text, extra) => !!(await sendePrivat(chatId, text, extra ?? {}))

/** Schlägt eine Person nach (Text wie person_ueberblick). In Tests einsetzbar. */
export type PersonNachschlagen = (admin: Db, email: string, suche: string) => Promise<string>

/** Vorgabe: person_ueberblick mit nur='alles' — liest Hotmail über das email-gateway mit dem Login der Person. */
export const standardNachschlagen: PersonNachschlagen = (admin, email, suche) =>
  fuehrePersonWerkzeugAus('person_ueberblick', { name: suche, nur: 'alles' }, { supabase: admin, mitarbeiter: { email }, protokolliere: () => {} })

export type WochenOptionen = {
  /** Wer nutzt den privaten Bot? Vorgabe privatBotAktiv. */
  privatAktiv?: (email: string) => Promise<boolean>
  /** Personen-Übersicht für das Briefing (Vorgabe standardNachschlagen). */
  nachschlagen?: PersonNachschlagen
  /** Zusatzteile für den Wochenrückblick (z. B. Fristen, Vertrags-Fristen) in dieser Reihenfolge. */
  zusatz?: PlanZusatz[]
}

export type BriefingErgebnis = { gesendet: number; fehler: string[] }
export type WochenErgebnis = { gesendet: number; leer: number; fehler: string[] }

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

/** „2026-11-18“ → „18.11.“ */
function tagMonat(datum: string): string {
  const [, m, d] = datum.split('-')
  return `${d}.${m}.`
}

function vorname(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

function fehlerText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---------------------------------------------------------------------------------------------
// Einstellung
// ---------------------------------------------------------------------------------------------

/** Einstellung aus privat_einstellungen.briefing: fehlend = an, nur false schaltet aus. */
export function wochenEinstellung(briefing: unknown): { terminBriefing: boolean; wochenrueckblick: boolean } {
  const b = briefing && typeof briefing === 'object' && !Array.isArray(briefing) ? (briefing as Record<string, unknown>) : {}
  return { terminBriefing: b.terminBriefing !== false, wochenrueckblick: b.wochenrueckblick !== false }
}

async function ladeBriefing(admin: Db, email: string): Promise<unknown> {
  const { data, error } = await admin.from('privat_einstellungen').select('briefing').eq('login_email', email).maybeSingle()
  if (error) throw new Error(`privat_einstellungen: ${error.message}`)
  return data?.briefing ?? null
}

/**
 * Schaltet Kurz-Briefing vor Terminen und/oder Wochenrückblick einer Person an oder aus (für das Werkzeug
 * „Briefing aus/an“). Andere Schlüssel in briefing (privatBot, morgenplan …) bleiben. null = gespeichert, sonst Fehlertext.
 */
export async function setzeWochenEinstellung(admin: Db, email: string, wert: { terminBriefing?: boolean; wochenrueckblick?: boolean }): Promise<string | null> {
  const ich = text(email).trim().toLowerCase()
  if (!ich) return 'Keine Adresse.'
  if (typeof wert?.terminBriefing !== 'boolean' && typeof wert?.wochenrueckblick !== 'boolean') return 'Nichts zu ändern.'
  try {
    const { data, error } = await admin.from('privat_einstellungen').select('briefing').eq('login_email', ich).maybeSingle()
    if (error) return error.message
    const alt = data?.briefing && typeof data.briefing === 'object' && !Array.isArray(data.briefing) ? data.briefing : {}
    const neu = {
      ...alt,
      ...(typeof wert.terminBriefing === 'boolean' ? { terminBriefing: wert.terminBriefing } : {}),
      ...(typeof wert.wochenrueckblick === 'boolean' ? { wochenrueckblick: wert.wochenrueckblick } : {}),
    }
    const { error: f } = await admin.from('privat_einstellungen').upsert({ login_email: ich, briefing: neu, geaendert_am: new Date().toISOString() })
    return f ? f.message : null
  } catch (e) {
    return fehlerText(e)
  }
}

// ---------------------------------------------------------------------------------------------
// (1) Kurz-Briefing vor Terminen — Personenerkennung
// ---------------------------------------------------------------------------------------------

export type BriefingTermin = PlanTermin & {
  beschreibung?: string | null
  ms_teilnehmer?: { name?: string | null; email?: string | null }[] | null
}

/** Erkannte Person: `suche` geht an person_ueberblick (Adresse oder Name), `anzeige` steht im Text. */
export type ErkanntePerson = { suche: string; anzeige: string; weitere: number }

/** Wörter, die in Titeln wie „Termin X“ / „mit X“ keine Person sind (normalisiert). */
const KEINE_PERSON = new Set([
  'arzt', 'zahnarzt', 'hausarzt', 'tierarzt', 'augenarzt', 'kinderarzt', 'frauenarzt', 'hautarzt', 'orthopaede', 'friseur', 'frisoer',
  'werkstatt', 'bank', 'sparkasse', 'volksbank', 'notar', 'notariat', 'anwalt', 'anwaeltin', 'steuerberater', 'steuerberaterin', 'berater',
  'makler', 'amt', 'finanzamt', 'buergeramt', 'bauamt', 'landratsamt', 'behoerde', 'gericht', 'polizei', 'post', 'apotheke', 'physio',
  'kita', 'schule', 'kindergarten', 'elternabend', 'tuev', 'training', 'sport', 'fitness', 'essen', 'mittagessen', 'abendessen', 'fruehstueck',
  'besichtigung', 'telefonat', 'anruf', 'rueckruf', 'call', 'meeting', 'besprechung', 'team', 'familie', 'freunden', 'freund', 'freundin',
  'freunde', 'kollegen', 'kollege', 'kunde', 'kunden', 'kundin', 'mama', 'papa', 'mutter', 'vater', 'eltern', 'kinder', 'kindern', 'oma', 'opa',
  'geburtstag', 'urlaub', 'hochzeit', 'flug', 'zug', 'reise', 'versicherung', 'labor', 'impfung', 'massage', 'yoga', 'allen', 'ihm', 'ihr',
  'ihnen', 'uns', 'euch', 'dem', 'der', 'den', 'die', 'das', 'einem', 'einer', 'eine', 'ein', 'bitte', 'online', 'zoom', 'teams', 'video',
  'telefon', 'handy', 'termin', 'treffen', 'gespraech', 'abholung', 'lieferung', 'reparatur', 'inspektion', 'reifenwechsel', 'vermieter',
  'mieter', 'hausverwaltung', 'verwaltung', 'gmbh', 'ag', 'kg', 'ug', 'herr', 'herrn', 'frau', 'dr', 'prof', 'privat', 'kirche', 'moschee',
  'kontrolle', 'vorsorge', 'nachsorge', 'sprechstunde', 'kaffee', 'mittag', 'abend', 'haus', 'wohnung', 'auto', 'angebot', 'unterlagen',
  'kauf', 'verkauf', 'wegen', 'zum', 'zur', 'und', 'im', 'in', 'am', 'beim',
])
/** Endungen typischer Sachwörter (Kaufvertrag, Besprechung, Hausarzt …) — kein Name. */
const SACHWORT_ENDUNG = /(ung|heit|keit|schaft|tion|vertrag|termin|gespraech|amt|arzt|aerztin|praxis|werkstatt|essen|treffen|ium|ment|bank|kasse|versicherung|verwaltung)$/

/** Ist das Wort als (Teil eines) Personennamens denkbar? Großgeschrieben, kein Sachwort. */
export function istNamenswort(wort: string): boolean {
  if (!/^\p{Lu}[\p{L}'’-]+$/u.test(wort)) return false
  const n = normalisiere(wort)
  return n.length >= 2 && !KEINE_PERSON.has(n) && !SACHWORT_ENDUNG.test(n)
}

/** Ein Wort bzw. zwei Wörter, die wie ein Name aussehen, ab Anfang der Zeichenkette (ohne Dr./Prof.). */
function nameAb(rest: string): string | null {
  const woerter = rest.replace(/^\s*[:\-–]?\s*/, '').replace(/^((?:Dr|Prof)\.?\s+)+/u, '').split(/[\s,;:()/]+/)
  const erstes = (woerter[0] ?? '').replace(/[.!?]+$/, '')
  if (!istNamenswort(erstes)) return null
  const zweites = (woerter[1] ?? '').replace(/[.!?]+$/, '')
  return istNamenswort(zweites) ? `${erstes} ${zweites}` : erstes
}

/** Gehört der Name zu einem Kollegen oder zu ihm selbst? (alle Wortteile kommen im Namen eines Teammitglieds vor) */
function istTeamName(name: string, teamNamen: string[]): boolean {
  const teile = normalisiere(name).split(' ').filter(Boolean)
  return teamNamen.some((t) => {
    const tn = normalisiere(t).split(' ').filter(Boolean)
    return teile.length > 0 && teile.every((x) => tn.includes(x))
  })
}

/**
 * Person im Titel: „… mit Herrn/Frau [Dr.] X [Y]“, „… Herr/Frau X“, „… mit X [Y]“, „Termin/Treffen/Gespräch/Telefonat/
 * Anruf/Rückruf/Besprechung [bei|mit] X“. Sachwörter (Zahnarzt, Bank, Familie …) zählen nicht. null = keine Person.
 */
export function personAusTitel(titel: string, teamNamen: string[] = []): { suche: string; anzeige: string } | null {
  const t = text(titel).replace(/\s+/g, ' ').trim()
  if (!t) return null
  const gefunden: { suche: string; anzeige: string }[] = []
  // 1. Mit Anrede (überall im Titel).
  for (const m of t.matchAll(/(?:^|[\s(,;:])(Herrn?|Frau|Hr\.|Fr\.|Dr\.|Prof\.)\s+(.+)/gu)) {
    const name = nameAb(m[2])
    const anrede = /^(Herrn?|Hr\.)$/.test(m[1]) ? 'Herr' : /^(Frau|Fr\.)$/.test(m[1]) ? 'Frau' : m[1]
    if (name) gefunden.push({ suche: name, anzeige: `${anrede} ${name}` })
  }
  // 2. „mit X“ ohne Anrede.
  for (const m of t.matchAll(/(?:^|\s)mit\s+(.+)/giu)) {
    if (/^(Herrn?|Frau|Hr\.|Fr\.|Dr\.|Prof\.)\s/u.test(m[1])) continue
    const name = nameAb(m[1])
    if (name) gefunden.push({ suche: name, anzeige: name })
  }
  // 3. „Termin X“ am Anfang.
  const anfang = /^(?:Termin|Treffen|Gespräch|Telefonat|Anruf|Rückruf|Besprechung|Call|Meeting)\b\s*:?\s*(?:(?:bei|mit|von)\s+)?(.+)$/iu.exec(t)
  if (anfang && !/^(Herrn?|Frau|Hr\.|Fr\.|Dr\.|Prof\.)\s/u.test(anfang[1])) {
    const name = nameAb(anfang[1])
    if (name) gefunden.push({ suche: name, anzeige: name })
  }
  return gefunden.find((g) => !istTeamName(g.suche, teamNamen)) ?? null
}

/**
 * Person eines privaten Termins: zuerst Outlook-Teilnehmer außer ihm selbst (eigene Adressen) und außer Kollegen
 * (Team-Adressen) — gesucht wird dann über die Adresse —, sonst der Titel. null = keine Person erkennbar.
 */
export function erkennePerson(t: BriefingTermin, eigene: Set<string>, teamAdressen: Set<string> = new Set(), teamNamen: string[] = []): ErkanntePerson | null {
  const fremde = (Array.isArray(t.ms_teilnehmer) ? t.ms_teilnehmer : [])
    .map((m) => ({ name: text(m?.name).trim(), email: text(m?.email).trim().toLowerCase() }))
    .filter((m) => (m.email || m.name) && !eigene.has(m.email) && !teamAdressen.has(m.email))
    .filter((m) => m.email || !istTeamName(m.name, teamNamen))
  const mitAdresse = fremde.filter((m) => m.email.includes('@'))
  if (mitAdresse.length) {
    const erster = mitAdresse[0]
    const mitName = !!erster.name && erster.name.toLowerCase() !== erster.email
    // Name UND Adresse: die Adresse legt die Person fest, der Name findet To-dos und Notizen, in denen er vorkommt.
    return { suche: mitName ? `${erster.name} ${erster.email}` : erster.email, anzeige: kurz(mitName ? erster.name : erster.email, 40), weitere: fremde.length - 1 }
  }
  const ausTitel = personAusTitel(text(t.titel), teamNamen)
  if (ausTitel) return { ...ausTitel, weitere: 0 }
  // Outlook-Teilnehmer nur mit Namen (ohne Adresse).
  const nurName = fremde.find((m) => m.name.split(/\s+/).some(istNamenswort))
  return nurName ? { suche: nurName.name, anzeige: kurz(nurName.name, 40), weitere: fremde.length - 1 } : null
}

// ---------------------------------------------------------------------------------------------
// (1) Kurz-Briefing — person_ueberblick verdichten
// ---------------------------------------------------------------------------------------------

export type Verdichtet = {
  mails: { datum: string; richtung: string; betreff: string }[]
  /** Zahl der Mails mit ihr/ihm laut Übersicht (0 = keine). */
  mailAnzahl: number
  todos: string[]
  notizen: { datum: string; text: string }[]
  mehrdeutig: boolean
  fehler: boolean
}

const RICHTUNG_KURZ: Record<string, string> = { gesendet: 'von dir', empfangen: 'an dich', 'von Dritten (er/sie in An/Kopie)': 'in Kopie' }

/** Liest den Text von person_ueberblick zurück: Zeitleiste, offene To-dos, Notizen. Rechnet nur. */
export function verdichteUeberblick(roh: string): Verdichtet {
  const v: Verdichtet = { mails: [], mailAnzahl: 0, todos: [], notizen: [], mehrdeutig: false, fehler: false }
  const t = text(roh)
  if (/^\s*Mehrdeutig:/.test(t)) return { ...v, mehrdeutig: true }
  if (/^\s*Fehler:/.test(t) || !t.trim()) return { ...v, fehler: true }
  const anzahl = /^Mails mit ihr\/ihm: (\d+)/m.exec(t)
  v.mailAnzahl = anzahl ? Number(anzahl[1]) : 0

  let abschnitt = ''
  let jahr = ''
  for (const zeile of t.split('\n')) {
    if (!zeile.trim()) {
      abschnitt = ''
      continue
    }
    if (/^(Zeitleiste der Mails|Gesendete Mails an sie\/ihn|Empfangene Mails von ihr\/ihm) \(/.test(zeile)) {
      abschnitt = 'mails'
      continue
    }
    if (/^To-dos \(\d+\):$/.test(zeile)) {
      abschnitt = 'todos'
      continue
    }
    if (/^Notizen \(\d+\):$/.test(zeile)) {
      abschnitt = 'notizen'
      continue
    }
    if (/^[^-].*\(\d+\):$/.test(zeile) && abschnitt !== 'mails') {
      abschnitt = ''
      continue
    }
    if (abschnitt === 'mails') {
      const j = /^(\d{4}|\?) \(\d+\):$/.exec(zeile)
      if (j) {
        jahr = j[1]
        continue
      }
      const m = /^- (\d{2}\.\d{2}\.) (.+?) \| (.+)$/.exec(zeile)
      if (!m) continue
      const richtung = m[2].trim()
      if (richtung === 'nur erwähnt') continue
      const teile = m[3].split(' | ')
      while (teile.length > 1 && /^(Anhang$|mail_id=|CRM-Postfach)/.test(teile[teile.length - 1])) teile.pop()
      v.mails.push({ datum: `${m[1]}${/^\d{4}$/.test(jahr) ? jahr : ''}`, richtung: RICHTUNG_KURZ[richtung] ?? '', betreff: teile.join(' | ').trim() })
    } else if (abschnitt === 'todos') {
      const m = /^- \[offen\] (.+?)(?: todo_id=\S+)?$/.exec(zeile)
      if (m) v.todos.push(m[1].trim())
    } else if (abschnitt === 'notizen') {
      const m = /^- (\d{2}\.\d{2}\.\d{4}) (.+)$/.exec(zeile)
      if (m) v.notizen.push({ datum: m[1], text: m[2].replace(/ \[Akte [^\]]*\]$/, '').trim() })
    }
  }
  return v
}

/** „18.11.2026“ → „18.11.“ im laufenden Jahr. */
function datumImJahr(datum: string, jahr: string): string {
  return datum.endsWith(`.${jahr}`) ? datum.slice(0, -4) : datum
}

/** Das Kurz-Briefing als Text (höchstens ~10 Zeilen). `ueberblick` null = Nachschlagen fehlgeschlagen. Rechnet nur. */
export function briefingText(t: BriefingTermin, person: ErkanntePerson, ueberblick: string | null, jetzt: Date): string {
  const beginn = new Date(text(t.beginn))
  const minuten = Math.max(0, Math.round((beginn.getTime() - jetzt.getTime()) / 60000))
  const ende = text(t.ende) ? new Date(text(t.ende)) : null
  const zeit = `${UHR.format(beginn)}${ende && !Number.isNaN(ende.getTime()) && ende > beginn ? `–${UHR.format(ende)}` : ''}`
  const ort = text(t.ort).trim()
  const jahr = berlinZeit(jetzt).datum.slice(0, 4)
  const zeilen = [
    `In ${minuten} Min.: ${zeit} ${kurz(text(t.titel) || '(ohne Titel)', 50)}${ort ? ` (${kurz(ort, 30)})` : ''}`,
    `Mit: ${person.anzeige}${person.weitere > 0 ? ` (und ${person.weitere} weitere)` : ''}`,
  ]
  const v = ueberblick == null ? null : verdichteUeberblick(ueberblick)
  if (!v || v.fehler) zeilen.push('Mails und Notizen konnten gerade nicht gelesen werden.')
  else if (v.mehrdeutig) zeilen.push(`Der Name passt zu mehreren Personen — frag mich nach „${person.suche}“, dann suche ich gezielt.`)
  else {
    const todos = v.todos.slice(0, BRIEFING_TODOS)
    const notizen = v.notizen.slice(0, BRIEFING_NOTIZEN)
    if (v.mails.length) {
      zeilen.push(`Letzte Mails${v.mailAnzahl > BRIEFING_MAILS ? ` (von ${v.mailAnzahl})` : ''}:`)
      for (const m of v.mails.slice(0, BRIEFING_MAILS)) zeilen.push(`• ${datumImJahr(m.datum, jahr)}${m.richtung ? ` ${m.richtung}` : ''}: ${kurz(m.betreff, 60)}`)
    }
    if (todos.length || notizen.length) {
      zeilen.push('Offen mit ihr/ihm:')
      for (const x of todos) zeilen.push(`• ${kurz(x, 70)}`)
      for (const n of notizen) zeilen.push(`• Notiz ${datumImJahr(n.datum, jahr)}: ${kurz(n.text, 70)}`)
    }
    if (!v.mails.length && !todos.length && !notizen.length) zeilen.push('Keine Mails, offenen To-dos oder Notizen mit ihr/ihm gefunden.')
  }
  zeilen.push(BRIEFING_AUS_SATZ)
  return zeilen.join('\n')
}

// ---------------------------------------------------------------------------------------------
// (1) Kurz-Briefing — der Lauf
// ---------------------------------------------------------------------------------------------

export function briefingKennung(terminId: string): string {
  return `privatbriefing|${terminId}`
}

type Person = { name: string; email: string; chat: number | string }

async function ladeTeam(admin: Db): Promise<{ personen: Person[]; adressen: Set<string>; namen: string[] }> {
  const { data, error } = await admin.from('mitarbeiter').select('name, email, telegram_chat_id, aktiv').eq('aktiv', true)
  if (error) throw new Error(`mitarbeiter: ${error.message}`)
  const alle = ((data ?? []) as { name?: string | null; email?: string | null; telegram_chat_id?: number | string | null }[])
    .map((m) => ({ name: text(m.name).trim(), email: text(m.email).trim().toLowerCase(), chat: m.telegram_chat_id }))
  return {
    personen: alle.filter((m) => m.email && m.chat != null && m.chat !== '') as Person[],
    adressen: new Set(alle.map((m) => m.email).filter(Boolean)),
    namen: alle.map((m) => m.name).filter(Boolean),
  }
}

/** Eigene Adressen der Person: Login und Hotmail-Adresse (ms_konten.ms_adresse). Lesefehler → nur Login. */
async function eigeneAdressen(admin: Db, email: string): Promise<Set<string>> {
  const eigene = new Set([email])
  try {
    const { data } = await admin.from('ms_konten').select('ms_adresse').eq('login_email', email).maybeSingle()
    const ms = text(data?.ms_adresse).trim().toLowerCase()
    if (ms) eigene.add(ms)
  } catch { /* nur Login */ }
  return eigene
}

/**
 * Vom Minutentakt gerufen: Kurz-Briefing für private Termine mit Beginn in 25–40 Minuten. Ohne Schlüssel des privaten
 * Bots (und ohne eingesetztes privatAktiv) ohne Datenbankzugriff. Wirft nie.
 */
export async function sendePrivatTerminBriefings(admin: Db, jetzt: Date = new Date(), senden: PlanSenden = standardSenden, optionen: WochenOptionen = {}): Promise<BriefingErgebnis> {
  const ergebnis: BriefingErgebnis = { gesendet: 0, fehler: [] }
  try {
    if (!optionen.privatAktiv && !privatBotToken()) return ergebnis
    const team = await ladeTeam(admin)
    const aktiv = optionen.privatAktiv ?? ((e: string) => privatBotAktiv(admin, e))
    const personen: Person[] = []
    for (const p of team.personen) if (await aktiv(p.email)) personen.push(p)
    if (!personen.length) return ergebnis

    const von = new Date(jetzt.getTime() + BRIEFING_AB_MIN * 60000)
    const bis = new Date(jetzt.getTime() + BRIEFING_BIS_MIN * 60000)
    const { data: roh, error } = await alleZeilen<BriefingTermin>(() =>
      admin.from('termine').select(BRIEFING_TERMIN_SPALTEN).in('besitzer_email', personen.map((p) => p.email)).gte('beginn', new Date(von.getTime() - 60000).toISOString()).lte('beginn', new Date(bis.getTime() + 60000).toISOString())
    )
    if (error) {
      ergebnis.fehler.push(`termine: ${error.message}`)
      return ergebnis
    }
    // Kandidaten: privat, nicht ganztags, nicht abgesagt, Beginn wirklich im Fenster.
    const kandidaten = roh.filter((t) => {
      const b = new Date(text(t.beginn)).getTime()
      if (Number.isNaN(b) || b < von.getTime() || b > bis.getTime() || t.ganztags === true) return false
      if (istAbgesagterTitel(text(t.titel))) return false
      const p = personen.find((x) => x.email === text(t.besitzer_email).trim().toLowerCase())
      return !!p && istPrivaterTermin(t, p.email)
    })
    if (!kandidaten.length) return ergebnis

    const { data: schon, error: sperrFehler } = await admin.from(TABELLE).select('id').in('id', kandidaten.map((t) => briefingKennung(t.id)))
    if (sperrFehler) {
      ergebnis.fehler.push(`${TABELLE} nicht lesbar: ${sperrFehler.message}`)
      return ergebnis
    }
    const erledigt = new Set(((schon ?? []) as { id: string }[]).map((x) => x.id))
    const nachschlagen = optionen.nachschlagen ?? standardNachschlagen
    const einstellungen = new Map<string, boolean>()
    const adressen = new Map<string, Set<string>>()
    let versucht = 0

    for (const t of kandidaten.sort((a, b) => text(a.beginn).localeCompare(text(b.beginn)))) {
      const id = briefingKennung(t.id)
      if (erledigt.has(id) || versucht >= BRIEFINGS_JE_TAKT) continue
      const p = personen.find((x) => x.email === text(t.besitzer_email).trim().toLowerCase())!
      try {
        if (!einstellungen.has(p.email)) einstellungen.set(p.email, wochenEinstellung(await ladeBriefing(admin, p.email)).terminBriefing)
        if (!einstellungen.get(p.email)) continue
        if (!adressen.has(p.email)) adressen.set(p.email, await eigeneAdressen(admin, p.email))
        const person = erkennePerson(t, adressen.get(p.email)!, team.adressen, team.namen)
        if (!person) continue
        versucht += 1

        // Erst lesen (ein Fehler beim Nachschlagen steht im Text), dann sperren, dann senden.
        let ueberblick: string | null = null
        try {
          ueberblick = await nachschlagen(admin, p.email, person.suche)
        } catch (err) {
          ergebnis.fehler.push(`${p.email}: Nachschlagen fehlgeschlagen: ${fehlerText(err)}`)
        }
        const nachricht = briefingText(t, person, ueberblick, jetzt)

        const { error: sperre } = await admin.from(TABELLE).insert({ id, email: p.email, art: 'morgen', datum: berlinZeit(jetzt).datum })
        if (sperre) {
          if (sperre.code !== '23505') ergebnis.fehler.push(`${p.email}: Briefing nicht vermerkt (${sperre.message}) — nicht gesendet.`)
          continue
        }
        // Privat bleibt privat: nur über den privaten Bot.
        const ok = (await senden(p.chat, nachricht)) === true
        await admin.from(TABELLE).update({ zugestellt: ok }).eq('id', id)
        if (ok) ergebnis.gesendet += 1
        else ergebnis.fehler.push(`${p.email}: Briefing nicht zugestellt.`)
      } catch (err) {
        ergebnis.fehler.push(`${p.email}: ${fehlerText(err)}`)
      }
    }
  } catch (err) {
    ergebnis.fehler.push(fehlerText(err))
  }
  return ergebnis
}

// ---------------------------------------------------------------------------------------------
// (2) Sonntags-Wochenrückblick
// ---------------------------------------------------------------------------------------------

/** Ist gerade das Fenster des Wochenrückblicks (sonntags 18:00–21:00 Berliner Zeit)? Liefert den Sonntag oder null. */
export function wochenFenster(jetzt: Date): { datum: string } | null {
  const b = berlinZeit(jetzt)
  const min = b.stunde * 60 + b.minute
  return b.wochentag === 0 && min >= WOCHE_AB && min < WOCHE_BIS ? { datum: b.datum } : null
}

export function wochenKennung(email: string, sonntag: string): string {
  return `privatwoche|${email}|${sonntag}`
}

export type WochenDaten = {
  /** Diese Woche (Mo–So) erledigte eigene To-dos. */
  erledigt: PlanTodo[]
  /** Offene eigene To-dos mit Frist oder Wiedervorlage bis Sonntag nächster Woche. */
  faellig: PlanTodo[]
  /** Termine von Montag nächster Woche bis Sonntag nächster Woche. */
  termine: PlanTermin[]
  ausgeblendet: Set<string>
}

/** Liest die Woche der Person. Wirft bei einem Lesefehler (dann versucht es der nächste Takt). */
export async function ladeWochenDaten(admin: Db, email: string, sonntag: string): Promise<WochenDaten> {
  const montag = plusTage(sonntag, -6)
  const bisTag = plusTage(sonntag, 7)
  const pruefe = <T>(r: { data: T[]; error: { message: string } | null }, was: string): T[] => {
    if (r.error) throw new Error(`${was}: ${r.error.message}`)
    return r.data
  }
  const [erledigt, faellig, termine, konto] = await Promise.all([
    alleZeilen<PlanTodo>(() => admin.from('todos').select(TODO_SPALTEN).is('bereich', null).eq('besitzer_email', email).gte('erledigt_am', montag).lte('erledigt_am', sonntag)),
    alleZeilen<PlanTodo>(() =>
      admin.from('todos').select(TODO_SPALTEN).is('bereich', null).is('erledigt_am', null).eq('besitzer_email', email).or(`erledigen_bis.lte.${bisTag},geplante_wiedervorlage.lte.${bisTag}`)
    ),
    alleZeilen<PlanTermin>(() =>
      admin.from('termine').select(WOCHE_TERMIN_SPALTEN).eq('besitzer_email', email).gte('beginn', berlinTagesbeginn(plusTage(sonntag, 1)).toISOString()).lt('beginn', berlinTagesbeginn(plusTage(sonntag, 8)).toISOString())
    ),
    admin.from('ms_konten').select('stand').eq('login_email', email).maybeSingle().then((r: { data: { stand?: unknown } | null }) => r, () => ({ data: null })),
  ])
  return {
    erledigt: pruefe(erledigt, 'Erledigte To-dos'),
    faellig: pruefe(faellig, 'To-dos'),
    termine: pruefe(termine, 'Termine'),
    ausgeblendet: ausgeblendeteListen(konto?.data?.stand),
  }
}

function zusatzBlock(zeilen: string[]): string[] {
  const z = (zeilen ?? []).map((x) => text(x).trimEnd()).filter((x) => x.trim())
  if (z.length <= HOECHSTENS_ZUSATZ_ZEILEN) return z
  return [...z.slice(0, HOECHSTENS_ZUSATZ_ZEILEN - 1), '…']
}

/** Der Wochenrückblick als Text — null, wenn nichts drinsteht. Rechnet nur. */
export function wochenrueckblickText(name: string, d: WochenDaten, email: string, sonntag: string, zusatz: string[][] = []): string | null {
  const montag = plusTage(sonntag, -6)
  const naechsterSonntag = plusTage(sonntag, 7)
  const eigene = d.faellig.filter((t) => istEigenes(t, email))
  const erledigt = d.erledigt
    .filter((t) => istEigenes(t, email) && text(t.erledigt_am).trim() && text(t.aufgabe).trim())
    .sort((a, b) => text(b.erledigt_am).localeCompare(text(a.erledigt_am)) || text(a.aufgabe).localeCompare(text(b.aufgabe), 'de'))
  const offen = sortiereFaellige(eigene.map((t) => faelligkeit(t, sonntag, sonntag, d.ausgeblendet)).filter((f): f is FaelligeAufgabe => !!f))
  const offenIds = new Set(offen.map((f) => f.todo.id))
  // Nach Tag, am selben Tag nach Prio (sortiereFaellige, dann stabil nach Tag).
  const kommend = sortiereFaellige(
    eigene
      .filter((t) => !offenIds.has(t.id))
      .map((t) => faelligkeit(t, naechsterSonntag, sonntag, d.ausgeblendet))
      .filter((f): f is FaelligeAufgabe => !!f && f.tag > sonntag),
  ).sort((a, b) => a.tag.localeCompare(b.tag))
  const termine = d.termine
    .filter((t) => istPrivaterTermin(t, email) && !istAbgesagterTitel(text(t.titel)) && !Number.isNaN(new Date(text(t.beginn)).getTime()))
    .sort((a, b) => text(a.beginn).localeCompare(text(b.beginn)))
  const bloecke = zusatz.map(zusatzBlock).filter((b) => b.length)
  if (!erledigt.length && !offen.length && !kommend.length && !termine.length && !bloecke.length) return null

  const vn = vorname(name)
  const zeilen = [`Guten Abend${vn ? ` ${vn}` : ''}, dein Wochenrückblick (${tagMonat(montag)}–${tagMonat(sonntag)}):`, '']
  if (erledigt.length) {
    zeilen.push(`✓ Diese Woche erledigt: ${erledigt.length}`)
    zeilen.push(...erledigt.slice(0, WOCHE_ERLEDIGT).map((t) => `• ${kurz(text(t.aufgabe), 60)}`))
    if (erledigt.length > WOCHE_ERLEDIGT) zeilen.push(`… und ${erledigt.length - WOCHE_ERLEDIGT} weitere`)
  } else zeilen.push('Diese Woche erledigt: noch nichts abgehakt.')

  if (offen.length) {
    const ueber = offen.filter((f) => f.ueberfaellig).length
    zeilen.push('', `Noch offen${ueber ? ` (davon ${ueber} überfällig)` : ''}: ${offen.length}`)
    zeilen.push(...offen.slice(0, WOCHE_OFFEN).map((f) => `• ${aufgabenZeile(f, sonntag)}`))
    if (offen.length > WOCHE_OFFEN) zeilen.push(`… und ${offen.length - WOCHE_OFFEN} weitere`)
  }

  if (termine.length || kommend.length) {
    zeilen.push('', `Nächste Woche (${tagMonat(plusTage(sonntag, 1))}–${tagMonat(naechsterSonntag)}):`)
    if (termine.length) {
      zeilen.push('Termine:')
      const nachTag = new Map<string, string[]>()
      for (const t of termine.slice(0, WOCHE_TERMINE)) {
        const b = berlinZeit(new Date(text(t.beginn)))
        const tag = `${TAG_KURZ[b.wochentag]} ${tagMonat(b.datum)}`
        const ort = text(t.ort).trim()
        const eintrag = `${t.ganztags === true ? 'ganztags' : UHR.format(new Date(text(t.beginn)))} ${kurz(text(t.titel) || '(ohne Titel)', 40)}${ort ? ` (${kurz(ort, 25)})` : ''}`
        nachTag.set(tag, [...(nachTag.get(tag) ?? []), eintrag])
      }
      for (const [tag, eintraege] of nachTag) zeilen.push(`• ${tag}: ${eintraege.join('; ')}`)
      if (termine.length > WOCHE_TERMINE) zeilen.push(`… und ${termine.length - WOCHE_TERMINE} weitere Termine`)
    }
    if (kommend.length) {
      zeilen.push('Fällig:')
      zeilen.push(...kommend.slice(0, WOCHE_FAELLIG).map((f) => `• ${aufgabenZeile(f, sonntag)}`))
      if (kommend.length > WOCHE_FAELLIG) zeilen.push(`… und ${kommend.length - WOCHE_FAELLIG} weitere`)
    }
  }
  for (const b of bloecke) zeilen.push('', ...b)
  zeilen.push('', WOCHE_AUS_SATZ)
  return zeilen.join('\n')
}

/**
 * Vom Minutentakt gerufen: sonntags 18:00–21:00 der Wochenrückblick, einmal je Person und Woche. Außerhalb des Fensters
 * ohne Datenbankzugriff. Wirft nie.
 */
export async function sendePrivatWochenrueckblicke(admin: Db, jetzt: Date = new Date(), senden: PlanSenden = standardSenden, optionen: WochenOptionen = {}): Promise<WochenErgebnis> {
  const ergebnis: WochenErgebnis = { gesendet: 0, leer: 0, fehler: [] }
  try {
    const f = wochenFenster(jetzt)
    if (!f) return ergebnis
    const team = await ladeTeam(admin)
    if (!team.personen.length) return ergebnis
    const { data: schon, error: sperrFehler } = await admin.from(TABELLE).select('id').in('id', team.personen.map((p) => wochenKennung(p.email, f.datum)))
    if (sperrFehler) {
      ergebnis.fehler.push(`${TABELLE} nicht lesbar: ${sperrFehler.message}`)
      return ergebnis
    }
    const erledigt = new Set(((schon ?? []) as { id: string }[]).map((x) => x.id))
    const aktiv = optionen.privatAktiv ?? ((e: string) => privatBotAktiv(admin, e))

    for (const p of team.personen) {
      const id = wochenKennung(p.email, f.datum)
      if (erledigt.has(id)) continue
      try {
        if (!(await aktiv(p.email))) continue
        if (!wochenEinstellung(await ladeBriefing(admin, p.email)).wochenrueckblick) continue

        // Erst alles lesen (Fehler → nächster Takt), dann sperren, dann senden.
        const daten = await ladeWochenDaten(admin, p.email, f.datum)
        const kontext: PlanKontext = { art: 'abend', datum: f.datum, jetzt }
        const zusatz: string[][] = []
        for (const z of optionen.zusatz ?? []) {
          try {
            zusatz.push(await z(admin, p.email, kontext))
          } catch (err) {
            ergebnis.fehler.push(`${p.email}: Zusatzteil fehlgeschlagen: ${fehlerText(err)}`)
          }
        }
        const nachricht = wochenrueckblickText(p.name, daten, p.email, f.datum, zusatz)

        const { error: sperre } = await admin.from(TABELLE).insert({ id, email: p.email, art: 'abend', datum: f.datum })
        if (sperre) {
          if (sperre.code !== '23505') ergebnis.fehler.push(`${p.email}: Wochenrückblick nicht vermerkt (${sperre.message}) — nicht gesendet.`)
          continue
        }
        if (!nachricht) {
          ergebnis.leer += 1
          continue
        }
        // Privat bleibt privat: nur über den privaten Bot.
        const ok = (await senden(p.chat, nachricht)) === true
        await admin.from(TABELLE).update({ zugestellt: ok }).eq('id', id)
        if (ok) ergebnis.gesendet += 1
        else ergebnis.fehler.push(`${p.email}: Wochenrückblick nicht zugestellt.`)
      } catch (err) {
        ergebnis.fehler.push(`${p.email}: ${fehlerText(err)}`)
      }
    }
  } catch (err) {
    ergebnis.fehler.push(fehlerText(err))
  }
  return ergebnis
}
