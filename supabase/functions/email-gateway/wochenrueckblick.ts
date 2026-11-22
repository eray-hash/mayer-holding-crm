// Wochenrückblick für die Geschäftsführung per Telegram (Runde 3, 22.11.2026).
//
// Was: Einmal je Woche (Vorgabe freitags ab 16 Uhr Berliner Zeit) eine kompakte Nachricht nur aus Zahlen und
// Tatsachen der letzten sieben Tage — neue Akten und Anfragen, Stufenwechsel, Abschlüsse und Absagen,
// Kostenvoranschläge, Rechnungen und Zahlungen, Unterschriften, Interessenten-Portal, Anfragenmanager, neue
// Objekte, überfällige Wiedervorlagen je Person, Kundentermine der nächsten sieben Tage und höchstens drei
// „Achtung“-Punkte. Jeder Block nur, wenn er etwas enthält. Wahlweise zwei Sätze Zusammenfassung (Haiku 5.5),
// gebaut NUR aus dem fertigen Zahlentext — das Modell sieht keine Akten.
//
// Keine Kundennamen: Akten erscheinen nur mit Bereich, Stand und Verantwortlichem; Rechnungen mit Nummer;
// Objekte mit ihrer Bezeichnung (Objekte sind keine Kunden). Private Kontakte, private Objekte und private
// To-do-Listen zählen nirgends mit (wie in superuser.ts und tagesmeldung.ts).
//
// Empfänger: Einstellungszeile `abteilung_eintraege` id `wochenrueckblick_einstellung`
//   daten = { an, berichtAn: [E-Mails], wochentag (0 = Sonntag … 6 = Samstag), stunde, zusammenfassung }
// Nur aktive Mitarbeiter mit Geschäftsführung- oder Admin-Recht UND verbundenem Telegram; wer nicht in
// `berichtAn` steht, bekommt nichts. Fehlt die Zeile oder ist die Liste leer, geht NICHTS raus (anders als
// wunschAnalyse.ts, das dann an alle Admins schickt) — niemand soll ungefragt Nachrichten bekommen.
//
// Einmal je Kalenderwoche (ISO-Woche): Buchhaltungszeile id `wochenrueckblick_stand`
//   daten = { woche: '2026-W47', zustand: 'laeuft' | 'gesendet' | 'fehler', versuche, am, empfaenger }
// Beansprucht wird VOR dem Bauen mit einer bedingten Änderung auf `updated_at` (laufen zwei Takte gleichzeitig,
// gewinnt nur einer). Schlägt das Bauen fehl, darf es nach 10 Minuten höchstens dreimal erneut versucht werden.
// Ein verpasster Tag wird nicht nachgeholt (das Fenster gilt nur am eingestellten Wochentag ab der Stunde).
//
// Beide Zeilen liest und schreibt nur der Server (Dienstschlüssel); angemeldete Nutzer sperrt eine
// einschränkende Regel aus (SQL neben dieser Datei). Die Einstellungskarte im Superuser-Bereich geht über die
// Aktion `wochenrueckblick_einstellung`, die Vorschau über `wochenrueckblick_test` (beide nur Geschäftsführung).
//
// Zeitraum: Tage mit Datum (Verlauf, Rechnungsdatum …) = heute und die sechs Tage davor; Zeitstempel = die
// letzten 7 × 24 Stunden bis jetzt.
//
// Doppelte Berichte (22.11.2026): Wer den Rückblick bekommt, bekommt den Wochenbericht aus tagesmeldung.ts und
// den Superuser-Wochenbericht aus superuser.ts nicht mehr. Superuser unter den Empfängern finden ihren Teil
// (Nutzung je Person, Antwortzeit, offene Wünsche, KI-Kosten) als „Zusatz für Superuser“ unten im Rückblick — in
// derselben Nachricht, wenn sie zusammen unter die Telegram-Grenze passen, sonst gleich danach. Die Zusammenfassung
// des Modells sieht den Zusatz nie. Einstellung und Empfänger: wochenrueckblickEmpfaenger.ts.
//
// Wirft nie im Minutentakt: Fehler stehen im Protokoll.

import { alsDatum, berlinTagesbeginn, berlinZeit, plusTage } from './tagesmeldung.ts'
import type { Aufrufer } from './postfach.ts'
import { ordneAufgabenZu, personenNamen, OBJEKT_ABGESCHLOSSEN, type RohAufgabe } from '../_shared/aufgabenKern.ts'
import { nurMayerObjekte } from '../_shared/privatZugriff.ts'
import { findeBezug, istAbgesagterTitel, istPrivaterBezug, kandidatenLader, SAMMELAKTEN, standName, TERMIN_SPALTEN, type BriefingTermin } from '../_shared/terminBriefingKern.ts'
import { kiAufruf } from '../_shared/kiVerbrauch.ts'
import { EINSTELLUNG_ID, empfaengerAus, ladeEinstellung, moeglicheEmpfaenger, normalisiereEinstellung, type Einstellung } from './wochenrueckblickEmpfaenger.ts'
import { istSuperuserAdressen, superuserAnhang } from './superuser.ts'
import { alleZeilen, schluesselVon } from '../_shared/alleZeilen.ts'

// Einstellung und Empfänger stehen in wochenrueckblickEmpfaenger.ts (dort lesen sie auch tagesmeldung.ts und superuser.ts).
export { EINSTELLUNG_ID, empfaengerAus, ladeEinstellung, moeglicheEmpfaenger, normalisiereEinstellung, VORGABE, wochenrueckblickAdressen } from './wochenrueckblickEmpfaenger.ts'
export type { Einstellung, Empfaenger } from './wochenrueckblickEmpfaenger.ts'

// deno-lint-ignore no-explicit-any
type Db = any
export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>
/** Ein Modellaufruf: Aufgabe hinein, Text heraus (in Tests ersetzt). */
export type KiText = (prompt: string) => Promise<string>

const TABELLE = 'abteilung_eintraege'
export const STAND_ID = 'wochenrueckblick_stand'
const MODELL = 'claude-haiku-5-5'
const HOECHSTENS_ZEICHEN = 3900 // Telegram nimmt höchstens 4096 Zeichen je Nachricht
const NEUER_VERSUCH_NACH_MS = 10 * 60_000
const HOECHSTENS_VERSUCHE = 3
const EINSTELLUNG_CACHE_MS = 10 * 60_000


const BEREICH_NAME: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilienkunden: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  buecher: 'Bücher & Verlag',
}
const OBJEKTE = 'Objekte'

/** Stände, in denen ein Fall „heiß“ ist: Angebot/Konzept liegt beim Kunden, Abschluss steht bevor. */
const HEISSE_STAENDE: Record<string, string[]> = {
  beratung: ['konzept', 'angebot'],
  immobilienkunden: ['angebot', 'verhandlung'],
  erben: ['konzept_erstellt', 'beratungsgespraech'],
  betriebsuebergabe: ['nachfolgekonzept', 'verhandlung'],
  betriebsformen: ['konzept_erstellt', 'beratungsgespraech'],
  akademie: ['anmeldung_eingegangen'],
  finanzierungen: ['beratungsgespraech', 'zeichnung_eingegangen'],
}
const HEISSE_OBJEKT_STAENDE = ['reserviert', 'notarauftrag_vorbereitet', 'vertragsentwurf_erhalten', 'pruefung_verkaeufer', 'pruefung_kaeufer', 'aenderungswuensche', 'notartermin']

/** Abschluss je Bereich: der Stand, mit dem ein Auftrag als gewonnen gilt (Bezeichnungen wie im Verlauf). */
const GEWONNEN: Record<string, RegExp> = {
  beratung: /beratungsvertrag unterschrieben/i,
  immobilienkunden: /^abgeschlossen/i,
  erben: /^abgeschlossen/i,
  betriebsuebergabe: /^abgeschlossen/i,
  betriebsformen: /^abgeschlossen/i,
  akademie: /anmeldung eingegangen/i,
  finanzierungen: /zeichnungsschein eingegangen/i,
  [OBJEKTE]: /^beurkundet/i,
}
const VERLOREN = /verloren|kein interesse|abgebrochen|nicht zustande|nicht qualifiziert|nicht passend|nicht weiter verfolgt/i

// ---------------------------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------------------------

function alsObjekt(w: unknown): Record<string, unknown> | null {
  return w && typeof w === 'object' && !Array.isArray(w) ? (w as Record<string, unknown>) : null
}

function text(w: unknown): string {
  return typeof w === 'string' ? w : w == null ? '' : String(w)
}

function zahl(w: unknown): number {
  const n = Number(w)
  return Number.isFinite(n) ? n : 0
}

export function euro(n: number): string {
  return `${Math.round(n).toLocaleString('de-DE')} €`
}

function tagMonat(datum: string): string {
  const [, m, d] = datum.split('-')
  return `${d}.${m}.`
}

function adresse(w: unknown): string {
  return text(w).trim().toLowerCase()
}

/** ISO-Kalenderwoche eines Tages (yyyy-mm-dd) als „2026-W47“. */
export function isoWoche(datum: string): string {
  const [y, m, d] = datum.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  const wt = (t.getUTCDay() + 6) % 7 // 0 = Montag
  t.setUTCDate(t.getUTCDate() - wt + 3) // Donnerstag derselben Woche bestimmt das Jahr
  const jahr = t.getUTCFullYear()
  const nr = 1 + Math.floor((t.getTime() - Date.UTC(jahr, 0, 1)) / 86400000 / 7)
  return `${jahr}-W${String(nr).padStart(2, '0')}`
}

/** Liest einen Statuswechsel aus einem Verlaufseintrag. Formen:
 *  „Status: A → B am 2026-11-13 durch X“ (CRM), „Per Telegram geändert — …; Status: B“ (Akte per Assistent),
 *  „Per Telegram geändert — Status: A → B.“ (Objekt per Assistent). */
export function leseStatuswechsel(eintrag: string): { von: string | null; nach: string } | null {
  const m = /(?:^|[\s—;(])Status:\s*(?:(.+?)\s*→\s*)?(.+?)(?=\s+am\s+\d{4}-\d{2}-\d{2}|;|\.\s|\.$|$)/.exec(eintrag)
  if (!m) return null
  const nach = m[2].trim()
  if (!nach || nach.length > 80) return null
  return { von: m[1]?.trim() || null, nach }
}

/** Ordnet einen Statuswechsel ein (Bereich = kunden.bereich oder „Objekte“). */
export function artDesWechsels(bereich: string, w: { von: string | null; nach: string }): 'gewonnen' | 'verloren' | null {
  if (VERLOREN.test(w.nach)) return w.von && VERLOREN.test(w.von) ? null : 'verloren'
  const re = GEWONNEN[bereich]
  if (re && re.test(w.nach) && !(w.von && re.test(w.von))) return 'gewonnen'
  return null
}

// deno-lint-ignore no-explicit-any
async function ladeAlle(admin: Db, tabelle: string, spalten: string, filter?: (q: any) => any): Promise<any[]> {
  // Seitenweise mit eindeutiger Sortierung (ohne Sortierung können sich Seiten überschneiden oder Zeilen fehlen).
  const { data, error } = await alleZeilen(() => {
    const q = admin.from(tabelle).select(spalten)
    return filter ? filter(q) : q
  }, { ordnung: schluesselVon(tabelle), hoechstens: 20000 })
  if (error) throw new Error(`${tabelle} nicht lesbar: ${error.message}`)
  return data
}

// ---------------------------------------------------------------------------------------------
// Einstellung
// ---------------------------------------------------------------------------------------------

// Der Minutentakt liest die Einstellung höchstens alle zehn Minuten (je Datenbank-Zugang, also je Worker).
const cache = new WeakMap<object, { bis: number; e: Einstellung }>()
async function einstellungImTakt(admin: Db, jetzt: Date): Promise<Einstellung> {
  const c = cache.get(admin)
  if (c && c.bis > jetzt.getTime()) return c.e
  const e = await ladeEinstellung(admin)
  cache.set(admin, { bis: jetzt.getTime() + EINSTELLUNG_CACHE_MS, e })
  return e
}

// ---------------------------------------------------------------------------------------------
// Daten
// ---------------------------------------------------------------------------------------------

type Kunde = { id: string; bereich: string; status?: string | null; activities?: unknown; follow_up?: unknown; verantwortlich?: string | null }
type Objekt = { id: string; bezeichnung?: string | null; status?: string | null; activities?: unknown; follow_up?: unknown; verantwortlich?: string | null; privat_besitzer?: string | null }

export type RueckblickDaten = {
  team: { name: string; email: string }[]
  kunden: Kunde[]
  objekte: Objekt[]
  kvs: { id: string; kunde_id?: string | null; bereich?: string | null; privat_besitzer?: string | null; betrag?: unknown; status?: string | null; erstellt_am?: string | null; geaendert_am?: string | null }[]
  rechnungen: { id: string; nummer?: string | null; kunde_id?: string | null; datum?: string | null; betrag_brutto?: unknown; status?: string | null; zahlungsziel?: string | null; mahnstufe?: string | null; zahlungen?: unknown; mahnungen?: unknown; versendet_am?: string | null; bezahlt_am?: string | null }[]
  leads: { status?: string | null; erstellt_am?: string | null }[]
  unterschriften: { bereich?: string | null; unterschrieben_am?: string | null; abgelehnt_am?: string | null }[]
  freigaben: { objekt_id?: string | null; status?: string | null; zustimmung?: unknown }[]
  besichtigungen: { objekt_id?: string | null; erstellt_am?: string | null; freigabe_id?: string | null; beginn?: string | null; status?: string | null }[]
  anfragen: { status?: string | null; erstellt_am?: string | null }[]
  todos: { id: string; aufgabe?: string | null; zustaendig?: string | null; erledigen_bis?: string | null; geplante_wiedervorlage?: string | null; bereich?: string | null }[]
  /** Kundentermine der nächsten sieben Tage (schon zugeordnet). */
  termineNaechste: { anzahl: number; besichtigungen: number }
  /** Akten-Ids mit einem Termin ab jetzt (zählt als nächster Schritt). */
  kundenMitTermin: string[]
}

/** Lädt alles, was der Rückblick braucht — nur lesend. */
export async function ladeRueckblickDaten(admin: Db, jetzt: Date): Promise<RueckblickDaten> {
  const heute = berlinZeit(jetzt).datum
  const vonIso = new Date(jetzt.getTime() - 7 * 86400000).toISOString()
  const morgen = berlinTagesbeginn(plusTage(heute, 1)).toISOString()
  const inSieben = berlinTagesbeginn(plusTage(heute, 8)).toISOString()

  const { data: teamRoh, error: teamFehler } = await admin.from('mitarbeiter').select('name, email, aktiv').eq('aktiv', true)
  if (teamFehler) throw new Error(`Mitarbeiter nicht lesbar: ${teamFehler.message}`)
  const echte = new Set(personenNamen(((teamRoh ?? []) as { name: string }[]).map((m) => text(m.name))))
  const team = ((teamRoh ?? []) as { name: string; email: string }[]).filter((m) => echte.has(text(m.name).trim())).map((m) => ({ name: text(m.name).trim(), email: adresse(m.email) }))

  const [kundenRoh, objekteRoh, kvsRoh, rechnungen, leads, unterschriften, freigaben, besichtigungen, anfragen, todos, termineAb] = await Promise.all([
    ladeAlle(admin, 'kunden', 'id, bereich, status, activities, follow_up, verantwortlich'),
    ladeAlle(admin, 'objekte', 'id, bezeichnung, status, activities, follow_up, verantwortlich, privat_besitzer'),
    ladeAlle(admin, 'kostenvoranschlaege', 'id, kunde_id, bereich, privat_besitzer, betrag, status, erstellt_am, geaendert_am'),
    ladeAlle(admin, 'rechnungen', 'id, nummer, kunde_id, datum, betrag_brutto, status, zahlungsziel, mahnstufe, zahlungen, mahnungen, versendet_am, bezahlt_am'),
    ladeAlle(admin, 'vorgeschlagene_leads', 'status, erstellt_am', (q) => q.gte('erstellt_am', vonIso)),
    ladeAlle(admin, 'unterschrift_anfragen', 'bereich, unterschrieben_am, abgelehnt_am', (q) => q.or(`unterschrieben_am.gte.${vonIso},abgelehnt_am.gte.${vonIso}`)),
    ladeAlle(admin, 'objekt_freigaben', 'objekt_id, status, zustimmung', (q) => q.eq('status', 'zugestimmt')),
    ladeAlle(admin, 'besichtigungen', 'objekt_id, erstellt_am, freigabe_id, beginn, status', (q) => q.gte('erstellt_am', vonIso)),
    ladeAlle(admin, 'objekt_anfragen', 'status, erstellt_am', (q) => q.gte('erstellt_am', vonIso)),
    ladeAlle(admin, 'todos', 'id, aufgabe, zustaendig, erledigen_bis, geplante_wiedervorlage, bereich', (q) => q.is('erledigt_am', null)),
    ladeAlle(admin, 'termine', TERMIN_SPALTEN, (q) => q.gte('beginn', jetzt.toISOString()).lt('beginn', inSieben)),
  ])

  const kunden = (kundenRoh as Kunde[]).filter((k) => k.bereich !== 'privat' && !SAMMELAKTEN.includes(k.id) && !String(k.id).startsWith('k_intern') && !String(k.id).startsWith('k_eingang'))
  // Private Kontakte gehören nur ihrem Besitzer: auch ihre Kostenvoranschläge und Rechnungen zählen nicht mit.
  const privat = new Set((kundenRoh as Kunde[]).filter((k) => k.bereich === 'privat').map((k) => k.id))
  const kvs = (kvsRoh as RueckblickDaten['kvs']).filter((k) => !k.privat_besitzer && k.bereich !== 'privat' && !(k.kunde_id && privat.has(k.kunde_id)))
  const rechnungenMayer = (rechnungen as RueckblickDaten['rechnungen']).filter((r) => !(r.kunde_id && privat.has(r.kunde_id)))
  const objekte = nurMayerObjekte(objekteRoh as Objekt[])
  const kundenIds = new Set(kunden.map((k) => k.id))
  const objektIds = new Set(objekte.map((o) => o.id))

  // Kundentermine der nächsten sieben Tage (ab morgen): Termin mit Akte oder Objekt (wie beim Termin-Briefing),
  // ohne private Bezüge und abgesagte Termine; derselbe Termin bei mehreren Kollegen zählt einmal.
  const lader = kandidatenLader(admin)
  const teamAdressen = new Set(team.map((m) => m.email))
  const gesehen = new Set<string>()
  let anzahl = 0
  let besichtigungenNaechste = 0
  const kundenMitTermin = new Set<string>()
  for (const t of termineAb as BriefingTermin[]) {
    if (istAbgesagterTitel(text(t.titel))) continue
    if (t.kunde_id && kundenIds.has(t.kunde_id)) kundenMitTermin.add(t.kunde_id)
    if (t.beginn < morgen) continue
    const schluessel = `${text(t.titel).trim().toLowerCase()}|${t.beginn}`
    if (gesehen.has(schluessel)) continue
    const bezug = await findeBezug(admin, t, { team: teamAdressen, teamNamen: team.map((m) => m.name), lader }).catch(() => null)
    if (!bezug || istPrivaterBezug(bezug)) continue
    if (bezug.art === 'kunde' && !kundenIds.has(bezug.id)) continue
    if (bezug.art === 'objekt' && !objektIds.has(bezug.id)) continue
    if (bezug.art === 'kunde') kundenMitTermin.add(bezug.id)
    gesehen.add(schluessel)
    anzahl++
    if (bezug.art === 'objekt' && bezug.wie === 'besichtigung') besichtigungenNaechste++
  }

  return {
    team,
    kunden,
    objekte,
    kvs,
    rechnungen: rechnungenMayer,
    leads,
    unterschriften,
    freigaben,
    besichtigungen,
    anfragen,
    todos,
    termineNaechste: { anzahl, besichtigungen: besichtigungenNaechste },
    kundenMitTermin: [...kundenMitTermin],
  }
}

// ---------------------------------------------------------------------------------------------
// Rechnen (rein, ohne Datenbank)
// ---------------------------------------------------------------------------------------------

function erstesDatum(activities: unknown): string {
  let erstes = ''
  for (const a of Array.isArray(activities) ? activities : []) {
    const tag = alsDatum(alsObjekt(a)?.date)
    if (tag && (!erstes || tag < erstes)) erstes = tag
  }
  return erstes
}

function offeneWiedervorlage(fu: unknown): boolean {
  const f = alsObjekt(fu)
  return !!f && f.done !== true && !!alsDatum(f.date)
}

function zahlungenVon(r: RueckblickDaten['rechnungen'][number]): { datum: string; betrag: number }[] {
  return (Array.isArray(r.zahlungen) ? r.zahlungen : []).map((z) => ({ datum: alsDatum(alsObjekt(z)?.datum), betrag: zahl(alsObjekt(z)?.betrag) }))
}

/** Gültige Frist: neue Frist aus dem letzten Mahnschreiben, sonst das Zahlungsziel (wie src/lib/rechnungen.ts). */
function frist(r: RueckblickDaten['rechnungen'][number]): string {
  const mahnungen = Array.isArray(r.mahnungen) ? r.mahnungen : []
  for (let i = mahnungen.length - 1; i >= 0; i--) {
    const f = alsDatum(alsObjekt(mahnungen[i])?.neueFrist)
    if (f) return f
  }
  return alsDatum(r.zahlungsziel)
}

function tageZwischen(von: string, bis: string): number {
  return Math.round((Date.parse(`${bis}T12:00:00Z`) - Date.parse(`${von}T12:00:00Z`)) / 86400000)
}

function aufteilung(m: Map<string, number>): string {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).map(([n, z]) => `${n} ${z}`).join(', ')
}

function zaehle(m: Map<string, number>, k: string, n = 1) {
  m.set(k, (m.get(k) ?? 0) + n)
}

type Achtung = { gruppe: number; gewicht: number; text: string }

export type Rueckblick = { titel: string; bloecke: { titel: string; zeilen: string[] }[]; achtung: string[]; leer: boolean }

/** Baut die Abschnitte des Rückblicks aus den Daten. Rechnet nur. */
export function baueRueckblick(d: RueckblickDaten, jetzt: Date): Rueckblick {
  const heute = berlinZeit(jetzt).datum
  const vonTag = plusTage(heute, -6)
  const vonMs = jetzt.getTime() - 7 * 86400000
  const inTagen = (tag: string) => !!tag && tag >= vonTag && tag <= heute
  const inZeit = (iso: unknown) => {
    const t = Date.parse(text(iso))
    return Number.isFinite(t) && t >= vonMs && t <= jetzt.getTime()
  }
  const namen = d.team.map((m) => m.name)
  const bereichVon = new Map(d.kunden.map((k) => [k.id, k.bereich]))
  const objektVon = new Map(d.objekte.map((o) => [o.id, o]))
  const bloecke: Rueckblick['bloecke'] = []
  const block = (titel: string, zeilen: string[]) => {
    if (zeilen.length) bloecke.push({ titel, zeilen })
  }

  // ---- Neu ----
  const neu: string[] = []
  const neueAkten = new Map<string, number>()
  for (const k of d.kunden) if (inTagen(erstesDatum(k.activities))) zaehle(neueAkten, BEREICH_NAME[k.bereich] ?? k.bereich)
  const neuSumme = [...neueAkten.values()].reduce((s, n) => s + n, 0)
  if (neuSumme) neu.push(`Neue Akten: ${neuSumme} (${aufteilung(neueAkten)})`)
  const leadsEcht = d.leads.filter((l) => l.status !== 'nicht_relevant' && inZeit(l.erstellt_am))
  if (leadsEcht.length) {
    const uebernommen = leadsEcht.filter((l) => l.status === 'uebernommen').length
    neu.push(`Anfragen aus E-Mails erkannt: ${leadsEcht.length}${uebernommen ? `, davon ${uebernommen} als Akte übernommen` : ''}`)
  }
  const neueObjekte = d.objekte.filter((o) => inTagen(erstesDatum(o.activities)))
  if (neueObjekte.length) neu.push(`Neue Objekte: ${neueObjekte.length}`)
  block('Neu', neu)

  // ---- Bewegung: Stufenwechsel, Abschlüsse, Absagen ----
  const wechsel = new Map<string, number>()
  let wechselSumme = 0
  const gewonnen = new Map<string, { bereich: string; stand: string }>()
  const verloren = new Map<string, { bereich: string; stand: string }>()
  const quellen: { schluessel: string; bereich: string; activities: unknown }[] = [
    ...d.kunden.map((k) => ({ schluessel: `k:${k.id}`, bereich: k.bereich, activities: k.activities })),
    ...d.objekte.map((o) => ({ schluessel: `o:${o.id}`, bereich: OBJEKTE, activities: o.activities })),
  ]
  for (const q of quellen) {
    for (const a of Array.isArray(q.activities) ? q.activities : []) {
      const e = alsObjekt(a)
      if (!e || !inTagen(alsDatum(e.date))) continue
      const w = leseStatuswechsel(text(e.text))
      if (!w) continue
      wechselSumme++
      zaehle(wechsel, q.bereich === OBJEKTE ? OBJEKTE : BEREICH_NAME[q.bereich] ?? q.bereich)
      const art = artDesWechsels(q.bereich, w)
      const name = q.bereich === OBJEKTE ? 'Objekt' : BEREICH_NAME[q.bereich] ?? q.bereich
      if (art === 'gewonnen') gewonnen.set(q.schluessel, { bereich: name, stand: w.nach })
      if (art === 'verloren') verloren.set(q.schluessel, { bereich: name, stand: w.nach })
    }
  }
  const bewegung: string[] = []
  if (wechselSumme) bewegung.push(`Stufenwechsel: ${wechselSumme} (${aufteilung(wechsel)})`)
  const zusammen = (m: Map<string, { bereich: string; stand: string }>) => {
    const z = new Map<string, number>()
    for (const v of m.values()) zaehle(z, `${v.bereich} „${v.stand}“`)
    return [...z.entries()].map(([k, n]) => (n > 1 ? `${n}× ${k}` : k)).join(', ')
  }
  if (gewonnen.size) bewegung.push(`Gewonnen: ${gewonnen.size} — ${zusammen(gewonnen)}`)
  if (verloren.size) bewegung.push(`Verloren/abgesagt: ${verloren.size} — ${zusammen(verloren)}`)
  block('Bewegung', bewegung)

  // ---- Kostenvoranschläge ----
  const kvsMayer = d.kvs
  const kvNeu = kvsMayer.filter((k) => inZeit(k.erstellt_am))
  // „Angenommen“ hat kein eigenes Datum: gezählt wird, was jetzt angenommen ist und in der Woche geändert wurde.
  const kvAngenommen = kvsMayer.filter((k) => k.status === 'angenommen' && inZeit(k.geaendert_am))
  const kvAbgelehnt = kvsMayer.filter((k) => k.status === 'abgelehnt' && inZeit(k.geaendert_am))
  const kvZeilen: string[] = []
  const summe = (l: { betrag?: unknown }[]) => euro(l.reduce((s, k) => s + zahl(k.betrag), 0))
  if (kvNeu.length) kvZeilen.push(`Neu erstellt: ${kvNeu.length} über ${summe(kvNeu)}`)
  if (kvAngenommen.length) kvZeilen.push(`Angenommen: ${kvAngenommen.length} über ${summe(kvAngenommen)}`)
  if (kvAbgelehnt.length) kvZeilen.push(`Abgelehnt: ${kvAbgelehnt.length} über ${summe(kvAbgelehnt)}`)
  block('Kostenvoranschläge', kvZeilen)

  // ---- Rechnungen und Zahlungen ----
  const rechnungen = d.rechnungen
  const versendet = rechnungen.filter((r) => r.status !== 'Entwurf' && (r.versendet_am ? inTagen(alsDatum(r.versendet_am)) : inTagen(alsDatum(r.datum))))
  let zahlungenAnzahl = 0
  let zahlungenSumme = 0
  for (const r of rechnungen) {
    const z = zahlungenVon(r)
    if (z.length) {
      for (const p of z) if (inTagen(p.datum)) (zahlungenAnzahl++, (zahlungenSumme += p.betrag))
    } else if (r.status === 'Bezahlt' && inTagen(alsDatum(r.bezahlt_am))) {
      zahlungenAnzahl++
      zahlungenSumme += zahl(r.betrag_brutto)
    }
  }
  const offenBetrag = (r: RueckblickDaten['rechnungen'][number]) => Math.max(0, zahl(r.betrag_brutto) - zahlungenVon(r).reduce((s, p) => s + p.betrag, 0))
  const ueberfaellig = rechnungen.filter((r) => {
    if (r.status !== 'Versendet' && r.status !== 'Überfällig') return false
    const f = frist(r)
    return (r.status === 'Überfällig' || !!r.mahnstufe || (!!f && f < heute)) && offenBetrag(r) > 0
  })
  const rZeilen: string[] = []
  if (versendet.length) rZeilen.push(`Versendet: ${versendet.length} über ${euro(versendet.reduce((s, r) => s + zahl(r.betrag_brutto), 0))}`)
  if (zahlungenAnzahl) rZeilen.push(`Zahlungen eingegangen: ${zahlungenAnzahl} über ${euro(zahlungenSumme)}`)
  if (ueberfaellig.length) rZeilen.push(`Überfällig offen: ${ueberfaellig.length} über ${euro(ueberfaellig.reduce((s, r) => s + offenBetrag(r), 0))}`)
  block('Rechnungen', rZeilen)

  // ---- Unterschriften und Interessenten-Portal ----
  const portal: string[] = []
  const unterschriften = d.unterschriften.filter((u) => u.bereich !== 'privat')
  const unterschrieben = unterschriften.filter((u) => inZeit(u.unterschrieben_am)).length
  const abgelehnt = unterschriften.filter((u) => inZeit(u.abgelehnt_am)).length
  if (unterschrieben || abgelehnt) portal.push(`Online-Unterschriften eingegangen: ${unterschrieben}${abgelehnt ? ` (${abgelehnt} abgelehnt)` : ''}`)
  const zustimmungen = d.freigaben.filter((f) => f.objekt_id && objektVon.has(f.objekt_id) && inZeit(alsObjekt(f.zustimmung)?.am)).length
  if (zustimmungen) portal.push(`Zustimmungen im Interessenten-Portal: ${zustimmungen}`)
  const gebucht = d.besichtigungen.filter((b) => b.objekt_id && objektVon.has(b.objekt_id) && inZeit(b.erstellt_am))
  if (gebucht.length) {
    const ueberPortal = gebucht.filter((b) => !!b.freigabe_id).length
    portal.push(`Besichtigungen eingetragen: ${gebucht.length}${ueberPortal ? `, davon ${ueberPortal} im Portal gebucht` : ''}`)
  }
  block('Unterschriften und Portal', portal)

  // ---- Anfragenmanager ----
  const anfragen = d.anfragen.filter((a) => a.status !== 'vor_start' && inZeit(a.erstellt_am))
  if (anfragen.length) {
    const z = (s: string) => anfragen.filter((a) => a.status === s).length
    const teile = [
      z('angelegt') && `${z('angelegt')} ${z('angelegt') === 1 ? 'neuer Interessent' : 'neue Interessenten'} mit Portal-Zugang`,
      z('vorhanden') && `${z('vorhanden')} schon bekannt`,
      z('unklar') && `${z('unklar')} unklar`,
      z('keine_anfrage') && `${z('keine_anfrage')} keine Anfrage`,
      z('fehler') && `${z('fehler')} mit Fehler`,
    ].filter(Boolean)
    block('Anfragenmanager', [`${anfragen.length} ${anfragen.length === 1 ? 'Mail' : 'Mails'} geprüft${teile.length ? `: ${teile.join(', ')}` : ''}`])
  }

  // ---- Überfällige Wiedervorlagen je Person (dieselbe Zuordnung wie „Aufgaben nach Mitarbeiter“) ----
  const roh: RohAufgabe[] = []
  for (const k of d.kunden) {
    const fu = alsObjekt(k.follow_up)
    if (!offeneWiedervorlage(fu)) continue
    roh.push({ id: `fu:${k.id}`, art: 'followup', titel: text(fu!.note) || 'Wiedervorlage', zustaendig: k.verantwortlich, datum: text(fu!.date) })
  }
  for (const o of d.objekte) {
    const fu = alsObjekt(o.follow_up)
    if (!offeneWiedervorlage(fu) || OBJEKT_ABGESCHLOSSEN.includes(text(o.status))) continue
    roh.push({ id: `fu:${o.id}`, art: 'followup', titel: text(fu!.note) || 'Wiedervorlage', zustaendig: o.verantwortlich, datum: text(fu!.date) })
  }
  // Nur Bereichslisten — eigene (private) To-do-Listen gehören ihrem Besitzer.
  for (const t of d.todos) {
    if (!t.bereich) continue
    roh.push({ id: `todo:${t.id}`, art: 'todo', titel: text(t.aufgabe), zustaendig: t.zustaendig, datum: t.erledigen_bis || t.geplante_wiedervorlage })
  }
  const ueberfaelligJe = new Map<string, { wv: number; todo: number }>()
  for (const a of ordneAufgabenZu(roh, namen, heute)) {
    if (a.lage !== 'ueberfaellig' || !namen.includes(a.person)) continue
    const z = ueberfaelligJe.get(a.person) ?? { wv: 0, todo: 0 }
    if (a.art === 'todo') z.todo++
    else z.wv++
    ueberfaelligJe.set(a.person, z)
  }
  const offenText = (z: { wv: number; todo: number }) => [z.wv && `${z.wv} Wiedervorlage${z.wv === 1 ? '' : 'n'}`, z.todo && `${z.todo} Aufgabe${z.todo === 1 ? '' : 'n'}`].filter(Boolean).join(', ')
  const wvZeilen = [...ueberfaelligJe.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de')).map(([p, z]) => `${p}: ${offenText(z)}`)
  block('Überfällig je Person', wvZeilen)

  // ---- Nächste sieben Tage ----
  if (d.termineNaechste.anzahl) {
    block('Nächste 7 Tage', [`Kundentermine: ${d.termineNaechste.anzahl}${d.termineNaechste.besichtigungen ? `, davon ${d.termineNaechste.besichtigungen} Besichtigungen` : ''}`])
  }

  // ---- Achtung: höchstens drei, möglichst aus verschiedenen Gruppen ----
  const kandidaten: Achtung[] = []
  for (const r of ueberfaellig) {
    const f = frist(r)
    const tage = f ? tageZwischen(f, heute) : 0
    const bereich = r.kunde_id ? BEREICH_NAME[bereichVon.get(r.kunde_id) ?? ''] : ''
    kandidaten.push({ gruppe: 0, gewicht: offenBetrag(r), text: `Rechnung ${text(r.nummer) || 'ohne Nummer'}${bereich ? ` (${bereich})` : ''} über ${euro(offenBetrag(r))} ${tage > 0 ? `seit ${tage} Tag${tage === 1 ? '' : 'en'} überfällig` : 'überfällig'}` })
  }
  const mitTermin = new Set(d.kundenMitTermin)
  const offeneKv = new Map<string, number>()
  for (const k of kvsMayer) if (k.status === 'offen' && k.kunde_id) zaehle(offeneKv, k.kunde_id, zahl(k.betrag))
  for (const k of d.kunden) {
    const heiss = (HEISSE_STAENDE[k.bereich] ?? []).includes(text(k.status))
    const kv = offeneKv.get(k.id) ?? 0
    if (!heiss && !kv) continue
    if (offeneWiedervorlage(k.follow_up) || mitTermin.has(k.id)) continue
    const wer = text(k.verantwortlich).trim()
    const was = `${BEREICH_NAME[k.bereich] ?? k.bereich}, Stand „${standName(k.bereich, k.status)}“${wer ? `, ${wer}` : ''}`
    kandidaten.push(
      kv
        ? { gruppe: 1, gewicht: kv, text: `Offener Kostenvoranschlag über ${euro(kv)} (${was}) ohne Wiedervorlage oder Termin` }
        : { gruppe: 3, gewicht: 0, text: `Akte kurz vor Abschluss (${was}) ohne Wiedervorlage oder Termin` },
    )
  }
  for (const o of d.objekte) {
    if (!HEISSE_OBJEKT_STAENDE.includes(text(o.status)) || offeneWiedervorlage(o.follow_up)) continue
    const wer = text(o.verantwortlich).trim()
    kandidaten.push({ gruppe: 2, gewicht: 0, text: `Objekt „${text(o.bezeichnung) || 'ohne Bezeichnung'}“ im Stand „${standName('immobilien', o.status)}“${wer ? ` (${wer})` : ''} ohne Wiedervorlage` })
  }
  for (const [p, z] of ueberfaelligJe) if (z.wv + z.todo >= 5) kandidaten.push({ gruppe: 4, gewicht: z.wv + z.todo, text: `${p} hat ${offenText(z)} überfällig` })
  const achtung = waehleAchtung(kandidaten)

  const titel = `Wochenrückblick ${tagMonat(vonTag)}–${tagMonat(heute)}`
  return { titel, bloecke, achtung, leer: bloecke.length === 0 && achtung.length === 0 }
}

/** Höchstens drei Punkte: erst der wichtigste jeder Gruppe (in Gruppenreihenfolge), dann auffüllen. Gleichartige
 *  weitere Punkte der Gruppe „Akte kurz vor Abschluss“ werden als „+ n weitere“ zusammengefasst. */
export function waehleAchtung(kandidaten: Achtung[], hoechstens = 3): string[] {
  const gruppen = new Map<number, Achtung[]>()
  for (const k of kandidaten) gruppen.set(k.gruppe, [...(gruppen.get(k.gruppe) ?? []), k])
  for (const l of gruppen.values()) l.sort((a, b) => b.gewicht - a.gewicht)
  const reihenfolge = [...gruppen.keys()].sort((a, b) => a - b)
  const gewaehlt: Achtung[] = []
  for (let runde = 0; gewaehlt.length < hoechstens; runde++) {
    let neu = false
    for (const g of reihenfolge) {
      const k = gruppen.get(g)![runde]
      if (k && gewaehlt.length < hoechstens) {
        gewaehlt.push(k)
        neu = true
      }
    }
    if (!neu) break
  }
  gewaehlt.sort((a, b) => a.gruppe - b.gruppe || b.gewicht - a.gewicht)
  return gewaehlt.map((k) => {
    const rest = (gruppen.get(k.gruppe)?.length ?? 0) - gewaehlt.filter((x) => x.gruppe === k.gruppe).length
    const letzter = gewaehlt.filter((x) => x.gruppe === k.gruppe).at(-1) === k
    return rest > 0 && letzter ? `${k.text} (+ ${rest} weitere)` : k.text
  })
}

/** Der Nachrichtentext (ohne Zusammenfassung). */
export function rueckblickText(r: Rueckblick): string {
  const zeilen = [r.titel]
  if (r.leer) {
    zeilen.push('', 'Eine ruhige Woche: keine neuen Akten, Abschlüsse, Rechnungen oder offenen Warnpunkte.')
    return zeilen.join('\n')
  }
  for (const b of r.bloecke) {
    zeilen.push('', `${b.titel}:`)
    for (const z of b.zeilen) zeilen.push(`• ${z}`)
  }
  if (r.achtung.length) {
    zeilen.push('', 'Achtung:')
    r.achtung.forEach((a, i) => zeilen.push(`${i + 1}. ${a}`))
  }
  return zeilen.join('\n')
}

// ---------------------------------------------------------------------------------------------
// Zusammenfassung (wahlweise, Haiku 5.5, nur aus dem Zahlentext)
// ---------------------------------------------------------------------------------------------

async function haikuText(prompt: string): Promise<string> {
  const schluessel = Deno.env.get('ANTHROPIC_API_KEY')
  if (!schluessel) throw new Error('ANTHROPIC_API_KEY ist nicht gesetzt.')
  const res = await kiAufruf('email-gateway', 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: { 'x-api-key': schluessel, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    // Haiku 5.5 denkt von sich aus nach, und das zählt gegen max_tokens — deshalb reichlich Platz.
    body: JSON.stringify({ model: MODELL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error(`Anthropic-API-Fehler (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const data = await res.json()
  // deno-lint-ignore no-explicit-any
  return (data.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
}

/** Zwei Sätze aus dem Zahlentext. Verworfen, wenn das Modell eine Zahl nennt, die nicht im Text steht. */
export async function zusammenfassung(zahlentext: string, ki: KiText = haikuText): Promise<string | null> {
  const prompt =
    'Du bekommst den Wochenrückblick eines Beratungs- und Immobilienunternehmens für die Geschäftsführung.\n' +
    'Schreibe genau zwei kurze Sätze auf Deutsch, die das Wichtigste der Woche zusammenfassen.\n' +
    'Regeln: nur Tatsachen aus dem Text, keine neuen Zahlen, keine Bewertung von Personen, keine Ratschläge, ' +
    'keine englischen Wörter, kein Markdown, keine Anrede. Antworte nur mit den zwei Sätzen.\n\n' +
    `<rueckblick>\n${zahlentext}\n</rueckblick>`
  try {
    const roh = (await ki(prompt)).replace(/\s+/g, ' ').replace(/[*_#`]/g, '').trim()
    if (!roh || roh.length > 450) return null
    const erlaubt = new Set(zahlentext.match(/\d+(?:[.,]\d+)*/g) ?? [])
    for (const z of roh.match(/\d+(?:[.,]\d+)*/g) ?? []) if (!erlaubt.has(z)) return null
    return roh
  } catch (err) {
    console.error('Wochenrückblick: Zusammenfassung fehlgeschlagen:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Fertige Nachricht: Zahlentext, wahlweise mit Zusammenfassung oben. Höchstens 3.900 Zeichen. */
export async function baueNachricht(admin: Db, jetzt: Date, o: { mitZusammenfassung: boolean; ki?: KiText }): Promise<{ text: string; zusammenfassung: string | null }> {
  const r = baueRueckblick(await ladeRueckblickDaten(admin, jetzt), jetzt)
  const zahlentext = rueckblickText(r)
  const kurz = o.mitZusammenfassung && !r.leer ? await zusammenfassung(zahlentext, o.ki) : null
  let voll = kurz ? zahlentext.replace(r.titel, `${r.titel}\n\n${kurz}`) : zahlentext
  if (voll.length > HOECHSTENS_ZEICHEN) voll = `${voll.slice(0, HOECHSTENS_ZEICHEN - 1)}…`
  return { text: voll, zusammenfassung: kurz }
}

// ---------------------------------------------------------------------------------------------
// Minutentakt
// ---------------------------------------------------------------------------------------------

type Stand = { woche?: string; zustand?: 'laeuft' | 'gesendet' | 'fehler'; versuche?: number; am?: string; empfaenger?: string[]; fehler?: string }

/** Beansprucht die Woche. Gibt die Nummer des Versuchs zurück (0 = dieser Lauf darf nicht senden). */
async function beanspruche(admin: Db, woche: string, jetzt: Date): Promise<number> {
  const jetztIso = jetzt.toISOString()
  const { data: zeile, error } = await admin.from(TABELLE).select('daten, updated_at').eq('id', STAND_ID).maybeSingle()
  if (error) throw new Error(`Stand nicht lesbar: ${error.message}`)
  if (!zeile) {
    const { error: e } = await admin.from(TABELLE).insert({ id: STAND_ID, art: STAND_ID, daten: { woche, zustand: 'laeuft', versuche: 1, am: jetztIso }, updated_at: jetztIso })
    return e ? 0 : 1
  }
  const s = (alsObjekt(zeile.daten) ?? {}) as Stand
  let versuche = 1
  if (s.woche === woche) {
    if (s.zustand === 'gesendet') return 0
    if ((s.versuche ?? 0) >= HOECHSTENS_VERSUCHE) return 0
    const seit = Date.parse(text(s.am))
    if (Number.isFinite(seit) && jetzt.getTime() - seit < NEUER_VERSUCH_NACH_MS) return 0
    versuche = (s.versuche ?? 0) + 1
  }
  let q = admin.from(TABELLE).update({ daten: { woche, zustand: 'laeuft', versuche, am: jetztIso }, updated_at: jetztIso }).eq('id', STAND_ID)
  q = zeile.updated_at == null ? q.is('updated_at', null) : q.eq('updated_at', zeile.updated_at)
  const { data: beansprucht } = await q.select('id')
  return Array.isArray(beansprucht) && beansprucht.length > 0 ? versuche : 0
}

async function vermerke(admin: Db, stand: Stand, jetzt: Date): Promise<void> {
  await admin.from(TABELLE).update({ daten: stand, updated_at: jetzt.toISOString() }).eq('id', STAND_ID)
}

/** Ist jetzt das Fenster der Einstellung? (eingestellter Wochentag, ab der Stunde, bis Mitternacht) */
export function imFenster(e: Einstellung, jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  return e.an && b.wochentag === e.wochentag && b.stunde >= e.stunde
}

export type LaufErgebnis = { gesendet: number; grund?: string }

/** Baut den Superuser-Zusatz (in Tests ersetzt). */
export type AnhangBauer = (admin: Db, jetzt: Date) => Promise<string>

/** Zusatz je Empfänger-Adresse — nur für Superuser, einmal gebaut. Schlägt das fehl, geht der Rückblick ohne raus. */
async function superuserAnhaenge(admin: Db, empfaenger: { email: string }[], jetzt: Date, bauer: AnhangBauer): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  try {
    const superuser = await istSuperuserAdressen(admin)
    const betroffen = empfaenger.filter((e) => superuser.has(e.email))
    if (betroffen.length === 0) return m
    const anhang = (await bauer(admin, jetzt)).trim()
    if (anhang) for (const e of betroffen) m.set(e.email, anhang)
  } catch (err) {
    console.error('Wochenrückblick: Superuser-Zusatz fehlgeschlagen:', err instanceof Error ? err.message : err)
  }
  return m
}

/** Rückblick und Zusatz in einer Nachricht, wenn beides zusammen unter die Telegram-Grenze passt, sonst in zwei. */
export function mitAnhang(nachricht: string, anhang: string | null): string[] {
  if (!anhang) return [nachricht]
  const zusammen = `${nachricht}\n\n—\n\n${anhang}`
  if (zusammen.length <= HOECHSTENS_ZEICHEN) return [zusammen]
  return [nachricht, anhang.length > HOECHSTENS_ZEICHEN ? `${anhang.slice(0, HOECHSTENS_ZEICHEN - 1)}…` : anhang]
}

/** Vom Minutentakt gerufen. Außerhalb des Fensters liest sie höchstens alle zehn Minuten die Einstellung. Wirft nie. */
export async function pruefeWochenrueckblick(admin: Db, sende: SendeFunktion, o: { ki?: KiText; anhang?: AnhangBauer } = {}, jetzt = new Date()): Promise<LaufErgebnis> {
  try {
    const e = await einstellungImTakt(admin, jetzt)
    if (!imFenster(e, jetzt)) return { gesendet: 0, grund: 'ausserhalb' }
    const empfaenger = await empfaengerAus(admin, e)
    if (empfaenger.length === 0) return { gesendet: 0, grund: 'keine Empfänger' }
    const woche = isoWoche(berlinZeit(jetzt).datum)
    const versuche = await beanspruche(admin, woche, jetzt)
    if (!versuche) return { gesendet: 0, grund: 'schon beansprucht' }
    let nachricht: string
    try {
      nachricht = (await baueNachricht(admin, jetzt, { mitZusammenfassung: e.zusammenfassung, ki: o.ki })).text
    } catch (err) {
      const fehler = err instanceof Error ? err.message : String(err)
      await vermerke(admin, { woche, zustand: 'fehler', versuche, am: jetzt.toISOString(), fehler: fehler.slice(0, 300) }, jetzt)
      throw err
    }
    // Superuser unter den Empfängern bekommen den Superuser-Teil als Zusatz (statt eines eigenen Wochenberichts).
    const anhaenge = await superuserAnhaenge(admin, empfaenger, jetzt, o.anhang ?? superuserAnhang)
    let gesendet = 0
    const an: string[] = []
    for (const m of empfaenger) {
      try {
        if (m.chat == null) continue
        const teile = mitAnhang(nachricht, anhaenge.get(m.email) ?? null)
        if ((await sende(m.chat, teile[0])) !== true) continue
        gesendet++
        an.push(m.name)
        for (const weiterer of teile.slice(1)) await sende(m.chat, weiterer)
      } catch (err) {
        console.error('Wochenrückblick nicht zustellbar:', err instanceof Error ? err.message : err)
      }
    }
    await vermerke(admin, { woche, zustand: 'gesendet', versuche, am: jetzt.toISOString(), empfaenger: an }, jetzt)
    return { gesendet }
  } catch (err) {
    console.error('Wochenrückblick fehlgeschlagen:', err instanceof Error ? err.message : err)
    return { gesendet: 0, grund: 'fehler' }
  }
}

// ---------------------------------------------------------------------------------------------
// Aktionen (nur Geschäftsführung): Vorschau/Probe und Einstellung
// ---------------------------------------------------------------------------------------------

export type AktionErgebnis = { status: number; daten: unknown }

/** `wochenrueckblick_test`: gibt den Text zurück, ohne zu senden; mit `senden: true` nur an den Aufrufer selbst.
 *  `ohneZusammenfassung: true` spart den Modellaufruf. Fasst Buchhaltung und Empfängerliste nicht an. */
export async function wochenrueckblickTest(admin: Db, aufrufer: Aufrufer | null, body: Record<string, unknown>, sende: SendeFunktion, o: { ki?: KiText; jetzt?: Date; anhang?: AnhangBauer } = {}): Promise<AktionErgebnis> {
  if (!aufrufer) return { status: 401, daten: { error: 'Bitte neu anmelden.' } }
  if (!aufrufer.istGf) return { status: 403, daten: { error: 'Nur für die Geschäftsführung.' } }
  try {
    const e = await ladeEinstellung(admin)
    const jetzt = o.jetzt ?? new Date()
    const n = await baueNachricht(admin, jetzt, { mitZusammenfassung: e.zusammenfassung && body.ohneZusammenfassung !== true, ki: o.ki })
    // Superuser sehen (und bekommen) den Rückblick mit ihrem Zusatz, wie im echten Lauf.
    const ichAdresse = aufrufer.email.trim().toLowerCase()
    const anhang = (await superuserAnhaenge(admin, [{ email: ichAdresse }], jetzt, o.anhang ?? superuserAnhang)).get(ichAdresse) ?? null
    const teile = mitAnhang(n.text, anhang)
    let gesendet = false
    let hinweis: string | undefined
    if (body.senden === true) {
      const { data: ich } = await admin.from('mitarbeiter').select('telegram_chat_id').ilike('email', aufrufer.email.replace(/[\\%_]/g, (z) => `\\${z}`)).maybeSingle()
      if (!ich?.telegram_chat_id) hinweis = 'Nicht gesendet: Du hast Telegram nicht verbunden.'
      else {
        gesendet = (await sende(ich.telegram_chat_id, teile[0])) === true
        if (gesendet) for (const weiterer of teile.slice(1)) await sende(ich.telegram_chat_id, weiterer)
      }
    }
    const empfaenger = (await empfaengerAus(admin, e)).map((m) => m.name)
    return { status: 200, daten: { ok: true, text: n.text, zusammenfassung: n.zusammenfassung, ...(anhang ? { superuserZusatz: anhang } : {}), empfaenger, gesendet, ...(hinweis ? { hinweis } : {}) } }
  } catch (err) {
    return { status: 500, daten: { error: err instanceof Error ? err.message : String(err) } }
  }
}

/** `wochenrueckblick_einstellung`: liest die Einstellung (mit möglichen Empfängern und letztem Lauf); mit
 *  `speichern: { an?, berichtAn?, wochentag?, stunde?, zusammenfassung? }` ändert sie nur die genannten Felder. */
export async function wochenrueckblickEinstellung(admin: Db, aufrufer: Aufrufer | null, body: Record<string, unknown>): Promise<AktionErgebnis> {
  if (!aufrufer) return { status: 401, daten: { error: 'Bitte neu anmelden.' } }
  if (!aufrufer.istGf) return { status: 403, daten: { error: 'Nur für die Geschäftsführung.' } }
  try {
    const moeglich = await moeglicheEmpfaenger(admin)
    let e = await ladeEinstellung(admin)
    const neu = alsObjekt(body.speichern)
    if (neu) {
      const aenderung: Partial<Einstellung> = {}
      if (typeof neu.an === 'boolean') aenderung.an = neu.an
      if (typeof neu.zusammenfassung === 'boolean') aenderung.zusammenfassung = neu.zusammenfassung
      if (neu.wochentag !== undefined) {
        const w = Number(neu.wochentag)
        if (!Number.isInteger(w) || w < 0 || w > 6) return { status: 400, daten: { error: 'Wochentag muss 0 (Sonntag) bis 6 (Samstag) sein.' } }
        aenderung.wochentag = w
      }
      if (neu.stunde !== undefined) {
        const s = Number(neu.stunde)
        if (!Number.isInteger(s) || s < 6 || s > 22) return { status: 400, daten: { error: 'Uhrzeit muss zwischen 6 und 22 Uhr liegen.' } }
        aenderung.stunde = s
      }
      if (neu.berichtAn !== undefined) {
        if (!Array.isArray(neu.berichtAn)) return { status: 400, daten: { error: 'Empfänger fehlen.' } }
        const erlaubt = new Set(moeglich.map((m) => m.email))
        const liste = [...new Set(neu.berichtAn.map(adresse))]
        const fremd = liste.filter((a) => !erlaubt.has(a))
        if (fremd.length) return { status: 400, daten: { error: `Nur Geschäftsführung und Admins können Empfänger sein (nicht: ${fremd.join(', ')}).` } }
        aenderung.berichtAn = liste
      }
      e = normalisiereEinstellung({ ...e, ...aenderung, geaendertVon: aufrufer.name || aufrufer.email, geaendertAm: new Date().toISOString() })
      const { error } = await admin.from(TABELLE).upsert({ id: EINSTELLUNG_ID, art: EINSTELLUNG_ID, daten: e, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      if (error) return { status: 500, daten: { error: `Nicht gespeichert: ${error.message}` } }
      cache.delete(admin)
    }
    const { data: stand } = await admin.from(TABELLE).select('daten').eq('id', STAND_ID).maybeSingle()
    return { status: 200, daten: { ok: true, einstellung: e, moeglicheEmpfaenger: moeglich.map(({ name, email, erlaubt }) => ({ name, email, telegram: erlaubt })), letzterLauf: stand?.daten ?? null } }
  } catch (err) {
    return { status: 500, daten: { error: err instanceof Error ? err.message : String(err) } }
  }
}
