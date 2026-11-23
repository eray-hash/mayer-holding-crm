// Assistent-Werkzeuge „Verträge und Abos im Blick“ (23.11.2026, Wunsch von Hasan): eigene Verträge und Abos
// (Strom, Versicherung, Software, Telefon, Miete …) mit Beitrag, Laufzeit und Kündigungsfrist in der Tabelle
// privat_vertraege (SQL: supabase/migrations_entwurf/privatVertraege.sql). Nur im privaten Assistenten.
//
// - vertrag_anlegen / vertrag_aendern / vertraege_zeigen / vertrag_loeschen (löschen nur mit bestaetigt=true,
//   sonst Vorschau).
// - naechsteKuendigung(): reine Rechnung „bis wann muss die Kündigung beim Anbieter sein“ — Laufzeitende minus
//   Frist; verlängert sich der Vertrag von selbst, rollt das Laufzeitende um verlaengerung_monate (Vorgabe 12)
//   weiter, bis der Termin nicht mehr in der Vergangenheit liegt. Endet das Laufzeitende auf dem letzten Tag
//   eines Monats, bleibt es beim Weiterrollen und beim Abziehen von Monaten der letzte Tag (31.12. − 3 Monate
//   = 30.09.; 28.02.2027 + 12 Monate = 29.02.2028). Weitergerollt wird immer vom ursprünglichen Laufzeitende aus,
//   damit nach einem Schaltjahr nichts verrutscht.
// - Gespeichertes naechste_kuendigung ist nur ein Merkwert (für Sortieren im CRM); angezeigt und im Morgenplan
//   wird immer frisch aus den Angaben gerechnet, weil ein Termin mit der Zeit vorbeirollt.
// - vertragsFristZeilen(): fertige Zeilen für die Morgen-Übersicht des privaten Assistenten.
//
// Der Assistent arbeitet mit dem Dienst-Schlüssel (volle Datenbankrechte). Die Zeilenregel der Datenbank
// (nur der Besitzer) steht deshalb in JEDER Abfrage und jedem Schreiben: .eq('besitzer_email', ich).

import { alleZeilen } from '../_shared/alleZeilen.ts'
import { deDatum, pruefeDatum } from './wiedervorlageWerkzeuge.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type VertragKontext = {
  supabase: Supa
  mitarbeiter: { email?: string | null; name?: string }
  protokolliere: (text: string) => void
  /** Heutiges Datum JJJJ-MM-TT (Berlin). */
  heute: string
  /** false = Aufruf aus dem Mayer-Bot → abgelehnt (Privat bleibt privat). index.ts: imPrivatBot(). */
  privat?: boolean
}

export const VERTRAG_ARTEN = ['Strom', 'Gas', 'Versicherung', 'Software', 'Telefon', 'Internet', 'Miete', 'Leasing', 'Mitgliedschaft', 'Zeitschrift', 'Sonstiges'] as const
export const RHYTHMEN = ['monatlich', 'vierteljährlich', 'halbjährlich', 'jährlich', 'einmalig'] as const
type Rhythmus = (typeof RHYTHMEN)[number]

/** Höchstens so viele Verträge in einer Antwort von vertraege_zeigen; darüber ausdrücklicher Hinweis. */
export const HOECHSTENS_ZEIGEN = 40
/** Morgenplan: Verträge, deren Kündigungstermin in so vielen Tagen oder früher liegt. */
export const MORGEN_TAGE = 45
/** Morgenplan: höchstens so viele Zeilen, dann „und N weitere“. */
export const MORGEN_HOECHSTENS = 3
/** Verträge, die sich kürzer als so viele Monate verlängern (monatlich kündbar), sind immer bald kündbar — nicht im Morgenplan. */
export const MORGEN_MIN_VERLAENGERUNG = 3

const SPALTEN =
  'id, besitzer_email, anbieter, art, bezeichnung, beitrag, beitrag_rhythmus, vertragsbeginn, laufzeit_ende, kuendigungsfrist_tage, kuendigungsfrist_monate, verlaengert_sich, verlaengerung_monate, naechste_kuendigung, notiz, quelle, erstellt_am, geaendert_am'

export type VertragZeile = {
  id: string
  besitzer_email: string
  anbieter: string
  art: string | null
  bezeichnung: string | null
  beitrag: number | string | null
  beitrag_rhythmus: string | null
  vertragsbeginn: string | null
  laufzeit_ende: string | null
  kuendigungsfrist_tage: number | null
  kuendigungsfrist_monate: number | null
  verlaengert_sich: boolean | null
  verlaengerung_monate: number | null
  naechste_kuendigung: string | null
  notiz: string | null
  quelle: string | null
  erstellt_am?: string | null
  geaendert_am?: string | null
}

// ---------------------------------------------------------------------------------------------
// Datumsrechnung (rein, ohne Datenbank)

function teile(iso: string): [number, number, number] {
  const [j, m, t] = iso.slice(0, 10).split('-').map(Number)
  return [j, m, t]
}

function tageImMonat(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate()
}

function iso(jahr: number, monat: number, tag: number): string {
  return `${String(jahr).padStart(4, '0')}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
}

/** Monate addieren (auch negativ). Fällt der Tag weg (31. → Februar), wird es der letzte Tag; ein Monatsletzter bleibt Monatsletzter. */
export function plusMonate(datum: string, monate: number): string {
  const [j, m, t] = teile(datum)
  const gesamt = j * 12 + (m - 1) + monate
  const nj = Math.floor(gesamt / 12)
  const nm = gesamt - nj * 12 + 1
  const letzter = tageImMonat(nj, nm)
  const warLetzter = t === tageImMonat(j, m)
  return iso(nj, nm, warLetzter ? letzter : Math.min(t, letzter))
}

export function plusTage(datum: string, tage: number): string {
  const d = new Date(`${datum.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + tage)
  return d.toISOString().slice(0, 10)
}

/** Tage von `von` bis `bis` (beide JJJJ-MM-TT); negativ, wenn `bis` davor liegt. */
export function tageBis(von: string, bis: string): number {
  return Math.round((Date.parse(`${bis.slice(0, 10)}T12:00:00Z`) - Date.parse(`${von.slice(0, 10)}T12:00:00Z`)) / 86_400_000)
}

/** Letzter Tag des Monats von `datum`. */
export function monatsende(datum: string): string {
  const [j, m] = teile(datum)
  return iso(j, m, tageImMonat(j, m))
}

export type KuendigungsAngaben = {
  laufzeit_ende?: string | null
  kuendigungsfrist_tage?: number | null
  kuendigungsfrist_monate?: number | null
  /** null/undefined = wie true (die meisten Verträge verlängern sich von selbst). */
  verlaengert_sich?: boolean | null
  /** Um wie viele Monate sich der Vertrag verlängert (Vorgabe 12). */
  verlaengerung_monate?: number | null
}

export type Kuendigung =
  /** Kündigung muss bis `kuendigen_bis` beim Anbieter sein; dann endet er zum `laufzeit_ende`. `verlaengert` = wie oft schon weitergerollt. */
  | { art: 'kuendbar'; kuendigen_bis: string; laufzeit_ende: string; verlaengert: number }
  /** Verlängert sich nicht (z. B. schon gekündigt) und läuft noch bis `laufzeit_ende` — Kündigen nicht nötig. */
  | { art: 'endet_von_selbst'; laufzeit_ende: string }
  /** Verlängert sich nicht und ist schon vorbei. */
  | { art: 'beendet'; laufzeit_ende: string }
  /** Es fehlen Angaben für die Rechnung. */
  | { art: 'unvollstaendig'; fehlt: ('laufzeit_ende' | 'kuendigungsfrist')[] }

function ganzzahl(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

/**
 * Nächste Kündigungsmöglichkeit ab `heute` (JJJJ-MM-TT). Frist in Monaten hat Vorrang vor Tagen.
 * Am Tag `kuendigen_bis` selbst ist die Kündigung noch rechtzeitig.
 */
export function naechsteKuendigung(a: KuendigungsAngaben, heute: string): Kuendigung {
  const ende = a.laufzeit_ende ? pruefeDatum(String(a.laufzeit_ende).slice(0, 10)) : undefined
  const monate = ganzzahl(a.kuendigungsfrist_monate)
  const tage = ganzzahl(a.kuendigungsfrist_tage)
  const hatFrist = (monate !== null && monate > 0) || tage !== null
  const verlaengert = a.verlaengert_sich !== false
  const fehlt: ('laufzeit_ende' | 'kuendigungsfrist')[] = []
  if (!ende) fehlt.push('laufzeit_ende')
  if (verlaengert && !hatFrist) fehlt.push('kuendigungsfrist')
  if (fehlt.length) return { art: 'unvollstaendig', fehlt }
  const e0 = ende!
  if (!verlaengert) return e0 >= heute ? { art: 'endet_von_selbst', laufzeit_ende: e0 } : { art: 'beendet', laufzeit_ende: e0 }

  const schritt = Math.max(1, ganzzahl(a.verlaengerung_monate) || 12)
  const bis = (e: string) => (monate !== null && monate > 0 ? plusMonate(e, -monate) : plusTage(e, -(tage ?? 0)))
  // Grobe Vorausrechnung, damit sehr alte Laufzeitenden nicht in vielen kleinen Schritten laufen.
  let n = 0
  const rueckstand = tageBis(bis(e0), heute)
  if (rueckstand > 0) n = Math.max(0, Math.floor(rueckstand / (schritt * 31)) - 1)
  for (let i = 0; i < 2400; i++) {
    const e = plusMonate(e0, n * schritt)
    const k = bis(e)
    if (k >= heute) return { art: 'kuendbar', kuendigen_bis: k, laufzeit_ende: e, verlaengert: n }
    n++
  }
  return { art: 'unvollstaendig', fehlt: ['laufzeit_ende'] }
}

/** Merkwert für die Spalte naechste_kuendigung. */
export function merkwertKuendigung(a: KuendigungsAngaben, heute: string): string | null {
  const k = naechsteKuendigung(a, heute)
  return k.art === 'kuendbar' ? k.kuendigen_bis : null
}

// ---------------------------------------------------------------------------------------------
// Eingaben

/** Art aus freiem Text („Stromvertrag“, „Handy“, „KFZ-Versicherung“) — sonst undefined. */
export function artVon(angabe: unknown): (typeof VERTRAG_ARTEN)[number] | undefined {
  const t = String(angabe ?? '').trim().toLowerCase()
  if (!t) return undefined
  const genau = VERTRAG_ARTEN.find((a) => a.toLowerCase() === t)
  if (genau) return genau
  const regeln: [RegExp, (typeof VERTRAG_ARTEN)[number]][] = [
    [/strom|oekostrom|ökostrom/, 'Strom'],
    [/\bgas|erdgas/, 'Gas'],
    [/versicher|police|haftpflicht|kasko|kfz-?vers/, 'Versicherung'],
    [/software|programm|app\b|lizenz|cloud|speicherplatz/, 'Software'],
    [/telefon|handy|mobilfunk|festnetz/, 'Telefon'],
    [/internet|dsl|glasfaser|kabel/, 'Internet'],
    [/miete|mietvertrag|stellplatz|garage/, 'Miete'],
    [/leasing/, 'Leasing'],
    [/mitglied|verein|fitness|studio/, 'Mitgliedschaft'],
    [/zeitschrift|zeitung|magazin/, 'Zeitschrift'],
    [/sonstig|andere/, 'Sonstiges'],
  ]
  return regeln.find(([r]) => r.test(t))?.[1]
}

export function rhythmusVon(angabe: unknown): Rhythmus | undefined {
  const t = String(angabe ?? '').trim().toLowerCase()
  if (!t) return undefined
  if (/^(monatlich|im monat|pro monat|monat)/.test(t)) return 'monatlich'
  if (/viertel|quartal/.test(t)) return 'vierteljährlich'
  if (/halbj|halbes jahr/.test(t)) return 'halbjährlich'
  if (/jaehrl|jährl|im jahr|pro jahr|^jahr/.test(t)) return 'jährlich'
  if (/einmal/.test(t)) return 'einmalig'
  return undefined
}

function betragVon(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined
  // „12,99“, „1.200,50 €“, „30 Euro“
  let t = String(v).replace(/[€\s]|euro/gi, '')
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined
}

const geld = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** Beitrag auf einen Monat umgerechnet (einmalig: 0). */
export function proMonat(beitrag: unknown, rhythmus: unknown): number {
  const b = Number(beitrag)
  if (!Number.isFinite(b) || beitrag === null || beitrag === '') return 0
  switch (rhythmusVon(rhythmus) ?? 'monatlich') {
    case 'monatlich':
      return b
    case 'vierteljährlich':
      return b / 3
    case 'halbjährlich':
      return b / 6
    case 'jährlich':
      return b / 12
    default:
      return 0
  }
}

const kurz = (s: unknown, n = 60) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** „Strom (EnBW)“, „Software (Agenda, Buchhaltung)“; bei Sonstiges der Anbieter mit Bezeichnung. */
export function vertragName(v: Pick<VertragZeile, 'art' | 'anbieter' | 'bezeichnung'>): string {
  const anbieter = kurz(v.anbieter, 40)
  const bez = kurz(v.bezeichnung, 40)
  const art = v.art && v.art !== 'Sonstiges' ? v.art : ''
  if (art) return `${art} (${[anbieter, bez].filter(Boolean).join(', ')})`
  return bez ? `${anbieter} (${bez})` : anbieter || 'Vertrag'
}

const tagText = (n: number) => (n === 0 ? 'heute letzter Tag' : n === 1 ? 'noch 1 Tag' : `noch ${n} Tage`)

function fristText(v: Pick<VertragZeile, 'kuendigungsfrist_tage' | 'kuendigungsfrist_monate'>): string {
  const m = ganzzahl(v.kuendigungsfrist_monate)
  if (m) return m === 1 ? '1 Monat' : `${m} Monate`
  const t = ganzzahl(v.kuendigungsfrist_tage)
  if (t === null) return ''
  return t === 0 ? 'ohne Frist' : t === 1 ? '1 Tag' : `${t} Tage`
}

const FEHLT_NAME = { laufzeit_ende: 'Laufzeitende', kuendigungsfrist: 'Kündigungsfrist' } as const

function angabenVon(v: Partial<VertragZeile>): KuendigungsAngaben {
  return {
    laufzeit_ende: v.laufzeit_ende ?? null,
    kuendigungsfrist_tage: v.kuendigungsfrist_tage ?? null,
    kuendigungsfrist_monate: v.kuendigungsfrist_monate ?? null,
    verlaengert_sich: v.verlaengert_sich ?? null,
    verlaengerung_monate: v.verlaengerung_monate ?? null,
  }
}

/** Kündigungsteil einer Zeile, z. B. „kündbar bis 30.09.2027 (noch 311 Tage) zum 31.12.2027, Frist 3 Monate, verlängert sich sonst um 12 Monate“. */
export function kuendigungsText(v: Partial<VertragZeile>, heute: string): string {
  const k = naechsteKuendigung(angabenVon(v), heute)
  const frist = fristText(v as VertragZeile)
  switch (k.art) {
    case 'kuendbar': {
      const schritt = Math.max(1, ganzzahl(v.verlaengerung_monate) || 12)
      const weiter = schritt === 1 ? 'monatlich kündbar' : `verlängert sich sonst um ${schritt} Monate`
      return `kündbar bis ${deDatum(k.kuendigen_bis)} (${tagText(tageBis(heute, k.kuendigen_bis))}) zum ${deDatum(k.laufzeit_ende)}${frist ? `, Frist ${frist}` : ''}, ${weiter}`
    }
    case 'endet_von_selbst':
      return `endet am ${deDatum(k.laufzeit_ende)} von selbst (verlängert sich nicht)`
    case 'beendet':
      return `beendet seit ${deDatum(k.laufzeit_ende)}`
    case 'unvollstaendig':
      return `Kündigungstermin unbekannt — es fehlt: ${k.fehlt.map((f) => FEHLT_NAME[f]).join(', ')}`
  }
}

function beitragText(v: Partial<VertragZeile>): string {
  const b = v.beitrag === null || v.beitrag === undefined || v.beitrag === '' ? null : Number(v.beitrag)
  if (b === null || !Number.isFinite(b)) return ''
  return `${geld(b)} ${v.beitrag_rhythmus || 'monatlich'}`
}

function zeileText(v: VertragZeile, heute: string): string {
  const teile = [beitragText(v), kuendigungsText(v, heute)].filter(Boolean)
  return `- ${vertragName(v)}: ${teile.join(' · ')}${v.notiz ? ` · Notiz: ${kurz(v.notiz, 80)}` : ''} (vertrag_id=${v.id})`
}

/** Reihenfolge: zuerst kündbare nach Termin, dann die von selbst endenden, dann unvollständige, zuletzt beendete. */
export function sortiereVertraege<T extends Partial<VertragZeile>>(liste: T[], heute: string): T[] {
  const rang = (v: T): [number, string] => {
    const k = naechsteKuendigung(angabenVon(v), heute)
    if (k.art === 'kuendbar') return [0, k.kuendigen_bis]
    if (k.art === 'endet_von_selbst') return [1, k.laufzeit_ende]
    if (k.art === 'unvollstaendig') return [2, String(v.anbieter ?? '').toLowerCase()]
    return [3, k.laufzeit_ende]
  }
  return [...liste].map((v) => ({ v, r: rang(v) })).sort((a, b) => a.r[0] - b.r[0] || (a.r[1] < b.r[1] ? -1 : a.r[1] > b.r[1] ? 1 : 0)).map((x) => x.v)
}

// ---------------------------------------------------------------------------------------------
// Werkzeugdefinitionen

const FELDER = {
  anbieter: { type: 'string', description: 'Firma, bei der der Vertrag besteht (z. B. EnBW, Allianz, Telekom, Agenda).' },
  art: { type: 'string', enum: [...VERTRAG_ARTEN], description: 'Art des Vertrags. Handy/Festnetz = Telefon, DSL/Glasfaser = Internet, Programme und Lizenzen = Software.' },
  bezeichnung: { type: 'string', description: 'Kurze Bezeichnung, z. B. Tarifname, „KFZ-Versicherung Golf“, „Buchhaltungsprogramm“.' },
  beitrag: { type: 'number', description: 'Preis je Zahlung in Euro (nur, was er sagt oder was in der Mail/im Dokument steht).' },
  beitrag_rhythmus: { type: 'string', enum: [...RHYTHMEN], description: 'Wie oft der Beitrag fällig ist (Vorgabe monatlich).' },
  vertragsbeginn: { type: 'string', description: 'Beginn als JJJJ-MM-TT.' },
  laufzeit_ende: { type: 'string', description: 'Ende der aktuellen (Mindest-)Laufzeit als JJJJ-MM-TT. Ein länger zurückliegendes Ende ist in Ordnung: verlängert er sich, rechnet das Werkzeug selbst weiter.' },
  laufzeit_monate: { type: 'integer', minimum: 1, maximum: 120, description: 'Statt laufzeit_ende: Mindestlaufzeit in Monaten ab vertragsbeginn (z. B. 24). Das Werkzeug rechnet das Laufzeitende aus.' },
  kuendigungsfrist_monate: { type: 'integer', minimum: 0, maximum: 24, description: 'Kündigungsfrist in Monaten („3 Monate zum Laufzeitende“). Hat Vorrang vor Tagen.' },
  kuendigungsfrist_tage: { type: 'integer', minimum: 0, maximum: 730, description: 'Kündigungsfrist in Tagen oder Wochen×7 („6 Wochen“ = 42, „14 Tage“ = 14).' },
  verlaengert_sich: { type: 'boolean', description: 'Verlängert er sich ohne Kündigung von selbst? Vorgabe true. Hat er schon gekündigt: false (dann endet er zum Laufzeitende).' },
  verlaengerung_monate: { type: 'integer', minimum: 1, maximum: 60, description: 'Um wie viele Monate er sich jeweils verlängert (Vorgabe 12). Monatlich kündbare Abos: 1.' },
  monatlich_kuendbar: { type: 'boolean', description: 'true = keine feste Laufzeit, jederzeit zum Monatsende kündbar (viele Software-Abos, neue Handyverträge nach der Mindestlaufzeit). Setzt verlaengerung_monate=1 und als Laufzeitende das Ende dieses Monats, wenn keins genannt ist.' },
  notiz: { type: 'string', description: 'Freier Vermerk (Kundennummer, Ansprechpartner, „Preis zu hoch, Angebot einholen“ …).' },
  quelle: { type: 'string', description: 'Woher die Angaben stammen, z. B. Kennung der Hotmail-Mail oder „diktiert“.' },
} as const

export const VERTRAG_WERKZEUGE = [
  {
    name: 'vertrag_anlegen',
    description:
      'Nimmt einen eigenen Vertrag oder ein Abo des Mitarbeiters in seine Vertragsübersicht auf (nur er sieht sie). Nimm es VON SELBST, wenn er beiläufig etwas zu einem Vertrag sagt: „mein Stromvertrag läuft bis 31.12.“, „das Abo bei X kostet 30 € im Monat“, „die Allianz will 480 im Jahr“, oder wenn eine Mail/ein Dokument eine Vertragsbestätigung, Preiserhöhung oder Rechnung eines laufenden Vertrags ist und er sie dir zeigt. Vorher mit vertraege_zeigen (suche=Anbieter) prüfen, ob es ihn schon gibt — dann vertrag_aendern. Nur genannte oder belegte Angaben eintragen, nie raten. Meldet das Ergebnis „Es fehlt noch“, frag ihn in EINEM kurzen Satz danach (bis wann läuft er, welche Kündigungsfrist, verlängert er sich von selbst?). Diktiert er nur eine Aufgabe zu einem Vertrag („Agenda: Mail wegen Abo-Preis“), bleibt das ein To-do (todo_anlegen); frag dann kurz, ob du den Vertrag auch in die Übersicht aufnehmen sollst, falls er dort fehlt.',
    input_schema: {
      type: 'object',
      properties: { ...FELDER, trotzdem_neu: { type: 'boolean', description: 'true nur, wenn er ausdrücklich einen zweiten Vertrag beim selben Anbieter mit derselben Art will.' } },
      required: ['anbieter'],
    },
  },
  {
    name: 'vertrag_aendern',
    description:
      'Ändert einen Vertrag aus seiner Vertragsübersicht (vertrag_id aus vertraege_zeigen). Nur die genannten Felder; leerer Text löscht ein Feld. Für Nachträge wie „läuft bis 30.06.2027“, „Frist ist 3 Monate“, „kostet jetzt 89 €“. Hat er gekündigt: verlaengert_sich=false und notiz_ergaenzen „gekündigt am …“. Ergänzungen zur Notiz über notiz_ergaenzen, nicht durch Überschreiben.',
    input_schema: {
      type: 'object',
      properties: {
        vertrag_id: { type: 'string' },
        ...FELDER,
        notiz_ergaenzen: { type: 'string', description: 'Wird mit heutigem Datum an die Notiz angehängt.' },
      },
      required: ['vertrag_id'],
    },
  },
  {
    name: 'vertraege_zeigen',
    description:
      'Zeigt seine Verträge und Abos, sortiert nach der nächsten Kündigungsmöglichkeit (was zuerst gekündigt werden müsste, steht oben), mit Beitrag, „kündbar bis“, fehlenden Angaben und vertrag_id, dazu die Summe im Monat. Für „welche Verträge habe ich?“, „was kann ich bald kündigen?“ (bald_tage), „was zahle ich für Versicherungen?“ (art). Die Liste ist vollständig oder sagt ausdrücklich, dass es weitere gibt — nenne ihm dann die Zahl und grenze ein.',
    input_schema: {
      type: 'object',
      properties: {
        art: { type: 'string', enum: [...VERTRAG_ARTEN], description: 'Nur diese Art.' },
        suche: { type: 'string', description: 'Teil von Anbieter, Bezeichnung oder Notiz.' },
        bald_tage: { type: 'integer', minimum: 1, maximum: 730, description: 'Nur Verträge, deren Kündigungstermin in so vielen Tagen oder früher liegt.' },
      },
    },
  },
  {
    name: 'vertrag_loeschen',
    description:
      'Löscht einen Vertrag endgültig aus seiner Übersicht. Ohne bestaetigt nur Vorschau (was gelöscht würde). Erst wenn er in seiner nächsten Nachricht ausdrücklich Ja sagt, bestaetigt=true. Hat er nur gekündigt, nicht löschen, sondern vertrag_aendern (verlaengert_sich=false).',
    input_schema: {
      type: 'object',
      properties: {
        vertrag_id: { type: 'string' },
        bestaetigt: { type: 'boolean', description: 'true NUR nach seinem ausdrücklichen Ja auf die Vorschau.' },
      },
      required: ['vertrag_id'],
    },
  },
]

export function istVertragWerkzeug(name: string): boolean {
  return VERTRAG_WERKZEUGE.some((w) => w.name === name)
}

/** Absatz für den Hinweistext des privaten Assistenten (index.ts) — Anfang „- Verträge und Abos:“ für werkzeugGruppen.ts ABSATZ_GRUPPE. */
export const VERTRAG_HINWEIS =
  '- Verträge und Abos: Er führt eine Übersicht seiner eigenen Verträge und Abos (Strom, Versicherung, Software, Telefon, Miete …) mit Beitrag, Laufzeit und Kündigungsfrist. Erwähnt er einen Vertrag mit Laufzeit, Preis oder Frist („mein Stromvertrag läuft bis …“, „Abo bei X kostet …“), prüf mit vertraege_zeigen (suche), ob er schon drin ist, und leg ihn sonst mit vertrag_anlegen an bzw. ergänze ihn mit vertrag_aendern — ohne erst zu fragen; danach frag kurz nach dem, was für den Kündigungstermin fehlt. Fragen nach Verträgen, Kosten oder „was kann ich kündigen“ beantwortest du mit vertraege_zeigen. Gekündigt heißt verlaengert_sich=false, nicht löschen. Löschen nur nach Vorschau und seinem ausdrücklichen Ja. Der Kündigungstermin ist der Tag, an dem die Kündigung spätestens beim Anbieter sein muss; empfiehl, etwas Puffer zu lassen. Rechtliche Beratung gibst du nicht.'

// ---------------------------------------------------------------------------------------------
// Ausführung

function ichVon(ctx: VertragKontext): string {
  return String(ctx.mitarbeiter?.email ?? '').trim().toLowerCase()
}

// deno-lint-ignore no-explicit-any
type Eingabe = Record<string, any>

type Felder = { [K in Exclude<keyof VertragZeile, 'id' | 'besitzer_email' | 'erstellt_am'>]?: VertragZeile[K] | null }

/** Eingaben prüfen und in Spaltenwerte übersetzen. Nur übergebene Felder kommen zurück; leerer Text = null. */
export function felderAus(input: Eingabe, heute: string): { felder: Felder; fehler: string[] } {
  const f: Felder = {}
  const fehler: string[] = []
  const text = (k: 'anbieter' | 'bezeichnung' | 'notiz' | 'quelle', max: number) => {
    if (!(k in input) || input[k] === undefined) return
    const t = String(input[k] ?? '').trim().slice(0, max)
    f[k] = t || null
  }
  text('anbieter', 120)
  text('bezeichnung', 160)
  text('notiz', 2000)
  text('quelle', 300)
  if ('art' in input && input.art !== undefined) {
    if (input.art === '' || input.art === null) f.art = null
    else f.art = artVon(input.art) ?? 'Sonstiges'
  }
  if ('beitrag' in input && input.beitrag !== undefined) {
    const b = betragVon(input.beitrag)
    if (b === undefined) fehler.push(`Beitrag „${input.beitrag}“ ist keine Zahl`)
    else if (b !== null && b < 0) fehler.push('Beitrag darf nicht negativ sein')
    else f.beitrag = b
  }
  if ('beitrag_rhythmus' in input && input.beitrag_rhythmus !== undefined) {
    if (input.beitrag_rhythmus === '' || input.beitrag_rhythmus === null) f.beitrag_rhythmus = null
    else {
      const r = rhythmusVon(input.beitrag_rhythmus)
      if (!r) fehler.push(`Zahlweise „${input.beitrag_rhythmus}“ unbekannt (monatlich, vierteljährlich, halbjährlich, jährlich, einmalig)`)
      else f.beitrag_rhythmus = r
    }
  }
  const datum = (k: 'vertragsbeginn' | 'laufzeit_ende', name: string) => {
    if (!(k in input) || input[k] === undefined) return
    if (input[k] === '' || input[k] === null) {
      f[k] = null
      return
    }
    const d = pruefeDatum(input[k])
    if (!d) fehler.push(`${name} „${input[k]}“ ist kein gültiges Datum (JJJJ-MM-TT)`)
    else f[k] = d
  }
  datum('vertragsbeginn', 'Vertragsbeginn')
  datum('laufzeit_ende', 'Laufzeitende')
  const zahl = (k: 'kuendigungsfrist_tage' | 'kuendigungsfrist_monate' | 'verlaengerung_monate', name: string, max: number) => {
    if (!(k in input) || input[k] === undefined) return
    if (input[k] === '' || input[k] === null) {
      f[k] = null
      return
    }
    const n = Number(input[k])
    if (!Number.isInteger(n) || n < 0 || n > max) fehler.push(`${name} „${input[k]}“ ist keine ganze Zahl von 0 bis ${max}`)
    else f[k] = n
  }
  zahl('kuendigungsfrist_tage', 'Kündigungsfrist in Tagen', 730)
  zahl('kuendigungsfrist_monate', 'Kündigungsfrist in Monaten', 24)
  zahl('verlaengerung_monate', 'Verlängerung in Monaten', 60)
  if (f.verlaengerung_monate === 0) fehler.push('Verlängerung in Monaten muss mindestens 1 sein')
  if ('verlaengert_sich' in input && input.verlaengert_sich !== undefined && input.verlaengert_sich !== null) f.verlaengert_sich = input.verlaengert_sich === true || input.verlaengert_sich === 'true'
  // Monate statt Tage: Tage leeren, damit nicht beide gelten (und umgekehrt).
  if (f.kuendigungsfrist_monate && !('kuendigungsfrist_tage' in f)) f.kuendigungsfrist_tage = null
  if (f.kuendigungsfrist_tage !== undefined && f.kuendigungsfrist_tage !== null && !('kuendigungsfrist_monate' in f)) f.kuendigungsfrist_monate = null
  // Laufzeit in Monaten ab Beginn → Laufzeitende (Tag vor dem Jahrestag).
  if (input.laufzeit_monate !== undefined && input.laufzeit_monate !== null && input.laufzeit_monate !== '' && !f.laufzeit_ende) {
    const n = Number(input.laufzeit_monate)
    const beginn = f.vertragsbeginn ?? (input.vertragsbeginn ? pruefeDatum(input.vertragsbeginn) : undefined)
    if (!Number.isInteger(n) || n < 1) fehler.push('laufzeit_monate muss eine ganze Zahl ab 1 sein')
    else if (!beginn) fehler.push('Für laufzeit_monate fehlt der Vertragsbeginn')
    else f.laufzeit_ende = plusTage(plusMonate(beginn, n), -1)
  }
  if (input.monatlich_kuendbar === true) {
    f.verlaengert_sich = true
    f.verlaengerung_monate = 1
    if (!f.laufzeit_ende) f.laufzeit_ende = monatsende(heute)
  }
  return { felder: f, fehler }
}

function fehltSatz(v: Partial<VertragZeile>, heute: string): string {
  const k = naechsteKuendigung(angabenVon(v), heute)
  const fehlt: string[] = k.art === 'unvollstaendig' ? k.fehlt.map((x) => FEHLT_NAME[x]) : []
  if (v.verlaengert_sich === null || v.verlaengert_sich === undefined) fehlt.push('ob er sich von selbst verlängert (angenommen: ja)')
  if (v.beitrag === null || v.beitrag === undefined) fehlt.push('Beitrag')
  return fehlt.length ? ` Es fehlt noch: ${fehlt.join(', ')} — frag ihn kurz danach.` : ''
}

async function ladeEigene(ctx: VertragKontext, ich: string): Promise<{ data: VertragZeile[]; error: { message: string } | null }> {
  return await alleZeilen<VertragZeile>(() => ctx.supabase.from('privat_vertraege').select(SPALTEN).eq('besitzer_email', ich))
}

async function ladeEinen(ctx: VertragKontext, ich: string, id: string): Promise<{ v: VertragZeile | null; fehler?: string }> {
  const { data, error } = await ctx.supabase.from('privat_vertraege').select(SPALTEN).eq('id', id).eq('besitzer_email', ich).maybeSingle()
  if (error) return { v: null, fehler: error.message }
  return { v: (data as VertragZeile) ?? null }
}

export async function fuehreVertragWerkzeugAus(name: string, input: Eingabe, ctx: VertragKontext): Promise<string> {
  if (ctx.privat === false) return 'Fehler: Verträge und Abos gibt es nur im privaten Assistenten.'
  const ich = ichVon(ctx)
  if (!ich) return 'Fehler: Keine Login-Adresse bekannt — Verträge lassen sich nicht zuordnen.'
  const heute = pruefeDatum(ctx.heute) ?? new Date().toISOString().slice(0, 10)
  input = input ?? {}

  if (name === 'vertrag_anlegen') {
    const { felder, fehler } = felderAus(input, heute)
    if (!felder.anbieter) fehler.unshift('Anbieter fehlt')
    if (fehler.length) return `Fehler: ${fehler.join('; ')}. Nichts angelegt.`
    // Doppelt? Gleicher Anbieter (ohne Groß-/Kleinschreibung) und gleiche Art.
    if (input.trotzdem_neu !== true) {
      const { data, error } = await ladeEigene(ctx, ich)
      if (error) return `Fehler: Verträge nicht lesbar: ${error.message}`
      const gleich = data.filter((v) => String(v.anbieter ?? '').trim().toLowerCase() === String(felder.anbieter).toLowerCase() && (!felder.art || !v.art || v.art === felder.art))
      if (gleich.length) {
        return `Nichts angelegt: Es gibt schon ${gleich.length === 1 ? 'einen Vertrag' : `${gleich.length} Verträge`} bei ${felder.anbieter}:\n${gleich.slice(0, 5).map((v) => zeileText(v, heute)).join('\n')}\nErgänze ihn mit vertrag_aendern. Nur wenn er ausdrücklich einen zweiten will: trotzdem_neu=true.`
      }
    }
    const jetzt = new Date().toISOString()
    const zeile: VertragZeile = {
      id: `vtr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      besitzer_email: ich,
      anbieter: felder.anbieter!,
      art: felder.art ?? artVon(felder.bezeichnung) ?? artVon(felder.anbieter) ?? 'Sonstiges',
      bezeichnung: felder.bezeichnung ?? null,
      beitrag: felder.beitrag ?? null,
      beitrag_rhythmus: felder.beitrag_rhythmus ?? (felder.beitrag != null ? 'monatlich' : null),
      vertragsbeginn: felder.vertragsbeginn ?? null,
      laufzeit_ende: felder.laufzeit_ende ?? null,
      kuendigungsfrist_tage: felder.kuendigungsfrist_tage ?? null,
      kuendigungsfrist_monate: felder.kuendigungsfrist_monate ?? null,
      verlaengert_sich: felder.verlaengert_sich ?? null,
      verlaengerung_monate: felder.verlaengerung_monate ?? null,
      naechste_kuendigung: null,
      notiz: felder.notiz ?? null,
      quelle: felder.quelle ?? null,
      erstellt_am: jetzt,
      geaendert_am: jetzt,
    }
    zeile.naechste_kuendigung = merkwertKuendigung(angabenVon(zeile), heute)
    const { error } = await ctx.supabase.from('privat_vertraege').insert(zeile)
    if (error) return `Fehler beim Anlegen: ${error.message}`
    ctx.protokolliere(`Vertrag angelegt: ${vertragName(zeile)} (vertrag_id=${zeile.id})`)
    return `Angelegt: ${zeileText(zeile, heute).slice(2)}.${fehltSatz(zeile, heute)}`
  }

  if (name === 'vertrag_aendern') {
    const id = String(input.vertrag_id ?? '').trim()
    if (!id) return 'Fehler: vertrag_id fehlt (aus vertraege_zeigen).'
    const { v, fehler: lesefehler } = await ladeEinen(ctx, ich, id)
    if (lesefehler) return `Fehler: Vertrag nicht lesbar: ${lesefehler}`
    if (!v) return `Fehler: Vertrag ${id} nicht gefunden (nur eigene Verträge). Hol die vertrag_id mit vertraege_zeigen.`
    const { felder, fehler } = felderAus(input, heute)
    if ('anbieter' in felder && !felder.anbieter) fehler.push('Anbieter darf nicht leer sein')
    if (fehler.length) return `Fehler: ${fehler.join('; ')}. Nichts geändert.`
    const ergaenzen = String(input.notiz_ergaenzen ?? '').trim()
    if (ergaenzen) {
      const basis = 'notiz' in felder ? felder.notiz : v.notiz
      felder.notiz = [basis, `${deDatum(heute)}: ${ergaenzen.slice(0, 1000)}`].filter(Boolean).join('\n')
    }
    if (Object.keys(felder).length === 0) return 'Nichts geändert: keine Felder genannt.'
    // Leerer Anbieter ist oben schon abgelehnt.
    const neu = { ...v, ...felder } as VertragZeile
    const aenderung = { ...felder, naechste_kuendigung: merkwertKuendigung(angabenVon(neu), heute), geaendert_am: new Date().toISOString() }
    const { error } = await ctx.supabase.from('privat_vertraege').update(aenderung).eq('id', id).eq('besitzer_email', ich)
    if (error) return `Fehler beim Ändern: ${error.message}`
    ctx.protokolliere(`Vertrag geändert: ${vertragName(neu)} (${Object.keys(felder).join(', ')}; vertrag_id=${id})`)
    return `Geändert: ${zeileText({ ...neu, ...aenderung } as VertragZeile, heute).slice(2)}.${fehltSatz(neu, heute)}`
  }

  if (name === 'vertraege_zeigen') {
    const { data, error } = await ladeEigene(ctx, ich)
    if (error) return `Fehler: Verträge nicht lesbar: ${error.message}`
    const art = input.art ? artVon(input.art) : undefined
    const suche = String(input.suche ?? '').trim().toLowerCase()
    const bald = Number.isInteger(Number(input.bald_tage)) && Number(input.bald_tage) > 0 ? Number(input.bald_tage) : null
    const passend = data.filter((v) => {
      if (art && v.art !== art) return false
      if (suche && ![v.anbieter, v.bezeichnung, v.notiz, v.art].some((x) => String(x ?? '').toLowerCase().includes(suche))) return false
      if (bald !== null) {
        const k = naechsteKuendigung(angabenVon(v), heute)
        if (k.art !== 'kuendbar' || tageBis(heute, k.kuendigen_bis) > bald) return false
      }
      return true
    })
    const filter = [art ? `Art ${art}` : '', suche ? `„${input.suche}“` : '', bald !== null ? `kündbar in den nächsten ${bald} Tagen` : ''].filter(Boolean).join(', ')
    if (data.length === 0) return 'Noch keine Verträge in der Übersicht. Erwähnt er einen, leg ihn mit vertrag_anlegen an.'
    if (passend.length === 0) return `Keine passenden Verträge (${filter}). Insgesamt stehen ${data.length} Verträge in der Übersicht.`
    const sortiert = sortiereVertraege(passend, heute)
    const gezeigt = sortiert.slice(0, HOECHSTENS_ZEIGEN)
    const summe = passend.reduce((s, v) => s + proMonat(v.beitrag, v.beitrag_rhythmus), 0)
    const ohneBeitrag = passend.filter((v) => v.beitrag === null || v.beitrag === undefined || v.beitrag === '').length
    const kopf = filter
      ? `${passend.length} von ${data.length} Verträgen passen (${filter})`
      : `Alle ${data.length} Verträge`
    const zeilen = [
      `${kopf}${gezeigt.length === passend.length ? ', vollständig' : `, davon die ersten ${gezeigt.length}`} — sortiert nach nächster Kündigungsmöglichkeit (Stand ${deDatum(heute)}):`,
      ...gezeigt.map((v) => zeileText(v, heute)),
    ]
    if (sortiert.length > gezeigt.length) zeilen.push(`ES GIBT WEITERE: ${sortiert.length - gezeigt.length} Verträge sind hier nicht aufgeführt — sag ihm das und grenze mit art, suche oder bald_tage ein.`)
    if (summe > 0) zeilen.push(`Zusammen rund ${geld(summe)} im Monat${ohneBeitrag ? ` (ohne ${ohneBeitrag} Vertr${ohneBeitrag === 1 ? 'ag' : 'äge'} ohne Beitrag; einmalige Zahlungen nicht mitgerechnet)` : ' (einmalige Zahlungen nicht mitgerechnet)'}.`)
    const unvollstaendig = passend.filter((v) => naechsteKuendigung(angabenVon(v), heute).art === 'unvollstaendig').length
    if (unvollstaendig) zeilen.push(`Bei ${unvollstaendig} Vertr${unvollstaendig === 1 ? 'ag' : 'ägen'} fehlt etwas für den Kündigungstermin — frag ihn bei Gelegenheit danach.`)
    return zeilen.join('\n')
  }

  if (name === 'vertrag_loeschen') {
    const id = String(input.vertrag_id ?? '').trim()
    if (!id) return 'Fehler: vertrag_id fehlt (aus vertraege_zeigen).'
    const { v, fehler } = await ladeEinen(ctx, ich, id)
    if (fehler) return `Fehler: Vertrag nicht lesbar: ${fehler}`
    if (!v) return `Fehler: Vertrag ${id} nicht gefunden (nur eigene Verträge).`
    if (input.bestaetigt !== true) {
      return `Noch nichts gelöscht. Würde endgültig löschen: ${zeileText(v, heute).slice(2)}\nFrag ihn, ob du wirklich löschen sollst (hat er nur gekündigt, besser verlaengert_sich=false). Erst nach seinem ausdrücklichen Ja: vertrag_loeschen mit bestaetigt=true.`
    }
    const { error } = await ctx.supabase.from('privat_vertraege').delete().eq('id', id).eq('besitzer_email', ich)
    if (error) return `Fehler beim Löschen: ${error.message}`
    ctx.protokolliere(`Vertrag gelöscht: ${vertragName(v)} (vertrag_id=${id})`)
    return `Gelöscht: ${vertragName(v)}.`
  }

  return `Fehler: Unbekanntes Werkzeug ${name}.`
}

// ---------------------------------------------------------------------------------------------
// Morgenplan

/**
 * Zeilen für die Morgen-Übersicht des privaten Assistenten: Verträge, deren nächste Kündigungsmöglichkeit in
 * höchstens MORGEN_TAGE Tagen liegt, nach Termin — höchstens MORGEN_HOECHSTENS, dann „… und N weitere“.
 * Monatlich kündbare (Verlängerung unter MORGEN_MIN_VERLAENGERUNG Monaten) bleiben draußen, sonst stünden sie jeden Tag da.
 * Wirft nie: bei einem Fehler (z. B. Tabelle noch nicht angelegt) leere Liste.
 * Einbau z. B. in email-gateway/tagesmeldung.ts morgenNachrichten: { titel: 'Verträge — bald kündbar', zeilen }.
 */
export async function vertragsFristZeilen(admin: Supa, email: string, heute: string): Promise<string[]> {
  const ich = String(email ?? '').trim().toLowerCase()
  if (!ich) return []
  try {
    const { data, error } = await alleZeilen<VertragZeile>(() => admin.from('privat_vertraege').select(SPALTEN).eq('besitzer_email', ich))
    if (error) {
      console.error('Verträge für den Morgenplan nicht lesbar', ich, error.message)
      return []
    }
    const bald: { v: VertragZeile; bis: string; tage: number }[] = []
    for (const v of data) {
      if (String(v.besitzer_email ?? '').toLowerCase() !== ich) continue
      if ((ganzzahl(v.verlaengerung_monate) || 12) < MORGEN_MIN_VERLAENGERUNG) continue
      const k = naechsteKuendigung(angabenVon(v), heute)
      if (k.art !== 'kuendbar') continue
      const tage = tageBis(heute, k.kuendigen_bis)
      if (tage >= 0 && tage <= MORGEN_TAGE) bald.push({ v, bis: k.kuendigen_bis, tage })
    }
    bald.sort((a, b) => (a.bis < b.bis ? -1 : a.bis > b.bis ? 1 : String(a.v.anbieter).localeCompare(String(b.v.anbieter), 'de')))
    const zeilen = bald.slice(0, MORGEN_HOECHSTENS).map(({ v, bis, tage }) => `• ${vertragName(v)}: kündbar bis ${deDatum(bis).slice(0, 6)} — ${tagText(tage)}`)
    const rest = bald.length - MORGEN_HOECHSTENS
    if (rest > 0) zeilen.push(`… und ${rest} weitere`)
    return zeilen
  } catch (e) {
    console.error('Verträge für den Morgenplan fehlgeschlagen', ich, e instanceof Error ? e.message : e)
    return []
  }
}
