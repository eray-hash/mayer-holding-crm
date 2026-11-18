// Import und Export der To-do-Liste als Tabelle (Excel oder CSV).
//
// Der Import erkennt die Spalten an ihren Überschriften, nicht an ihrer Position:
// - die Überschrift darf in einer späteren Zeile stehen und über mehrere Zeilen verteilt sein
//   (z.B. "geplante" / "Zeit" / "min" untereinander),
// - kleine Schreibabweichungen, Zeilenumbrüche und Umlaut-Schreibweisen (ä/ae) werden toleriert,
// - Excel-Datums- und Zeitwerte werden umgerechnet,
// - jede Spalte ohne passendes Feld wird als "nicht übernommen" gemeldet, nie stillschweigend verworfen.
// Das gilt für die Excel-Vorlage der Immobilienabteilung ebenso wie für die eigene Export-Datei des CRM.
// Wird keine Überschrift erkannt, greift unverändert die ältere Zuordnung nach fester Spaltenreihenfolge.
//
// Die Datei enthält keine React-Teile, damit sie sich auch außerhalb des Browsers prüfen lässt.

import { read, utils, SSF } from 'xlsx'
import type { CellObject, WorkBook, WorkSheet } from 'xlsx'
import type { ToDoEintrag } from '../types'

export type ToDoImportWert = Omit<ToDoEintrag, 'id' | 'besitzerEmail' | 'bereich' | 'reihenfolge' | 'erstelltAm'>

// ---------------------------------------------------------------------------------------------
// Zeitaufwandskosten und Export
// ---------------------------------------------------------------------------------------------

/** Zeitaufwandskosten in Euro: Ist-Zeit (Minuten) / 60 × Stundensatz. Nur wenn beides eingetragen ist. */
export function zeitaufwandskosten(t: Pick<ToDoEintrag, 'istZeit' | 'stundensatz'>): number | undefined {
  if (t.istZeit === undefined || t.istZeit === null || t.stundensatz === undefined || t.stundensatz === null) return undefined
  return (t.istZeit / 60) * t.stundensatz
}

// Kommazahl in deutscher Schreibweise, damit Excel sie in der CSV als Zahl liest.
function csvZahl(n: number | undefined): string | undefined {
  return n === undefined || n === null ? undefined : n.toFixed(2).replace('.', ',')
}

function csvZeile(werte: (string | number | undefined)[]): string {
  return werte.map((w) => `"${(w ?? '').toString().replace(/"/g, '""')}"`).join(';')
}

/** Inhalt der Export-Datei (CSV mit Semikolon, UTF-8 mit BOM), genau wie bisher. */
export function toDoCsvText(liste: ToDoEintrag[]): string {
  const header = csvZeile(['Start', 'Prio', 'Unter', 'Kunde/Projekt', 'Aufgabe', 'Abt.', 'aktueller Stand', 'welche Fragen', 'nächste Schritte', 'zuständig', 'geplante Zeit', 'Ist-Zeit', 'Umsatz', 'Wiedervorlage', 'Erledigt am', 'Warten auf', 'Erhalten am', 'Erledigen bis', 'Stundensatz (€)', 'Zeitaufwandskosten (€)'])
  const zeilen = liste.map((t) =>
    csvZeile([t.startDatum, t.prio, t.unterPrio, t.kundeProjekt, t.aufgabe, t.abteilung, t.aktuellerStand, t.welcheFragen, t.naechsteSchritte, t.zustaendig, t.geplanteZeit, t.istZeit, t.umsatzWert, t.geplanteWiedervorlage, t.erledigtAm, t.wartenAuf, t.erhaltenAm, t.erledigenBis, csvZahl(t.stundensatz), csvZahl(zeitaufwandskosten(t))]),
  )
  return '﻿' + [header, ...zeilen].join('\r\n')
}

// ---------------------------------------------------------------------------------------------
// Ältere Zuordnung nach fester Spaltenreihenfolge (unverändert übernommen)
// ---------------------------------------------------------------------------------------------

type ExcelSpalten = [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]

function zuExcelZeile(rows: unknown[][]): ExcelSpalten[] {
  return rows as ExcelSpalten[]
}

function textWert(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'number') return String(v)
  const s = String(v).trim()
  return s || undefined
}

function zahlWert(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

const zwei = (n: number) => String(n).padStart(2, '0')

// Excel-Datum → lokales yyyy-mm-dd. Datumszellen kommen (cellDates) als Date, von Hand getippte als
// Text ("17.11.2026", "17.11.26", "2026-11-17"). Bewusst über die lokalen Datumsteile, nie toISOString().
// Die halbe Minute Zugabe fängt die Sekunden-Abweichung ab, mit der die Bibliothek Mitternacht teils
// knapp vor dem Tageswechsel liefert. Nicht lesbare Werte werden weggelassen statt falsch übernommen.
function datumWert(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return undefined
    const d = new Date(v.getTime() + 30_000)
    return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`
  }
  const s = String(v).trim()
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${zwei(Number(iso[2]))}-${zwei(Number(iso[3]))}`
  const deutsch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  if (deutsch) {
    const jahr = deutsch[3].length === 2 ? 2000 + Number(deutsch[3]) : Number(deutsch[3])
    return `${jahr}-${zwei(Number(deutsch[2]))}-${zwei(Number(deutsch[1]))}`
  }
  return undefined
}

// Die vier Zusatzfelder haben in der bisherigen Excel-Vorlage keine feste Spalte. Sie werden deshalb
// an der Überschrift erkannt (in den Kopfzeilen über den Daten), z.B. "warten auf", "Aufgabe erhalten
// am", "Aufgabe zu erledigen bis". Die feste Spaltenzuordnung der übrigen Felder bleibt unberührt.
type ZusatzFeld = 'wartenAuf' | 'erhaltenAm' | 'erledigenBis' | 'stundensatz'
const ZUSATZ_KOPF: [string, ZusatzFeld][] = [
  ['warten auf', 'wartenAuf'],
  ['erhalten am', 'erhaltenAm'],
  ['erledigen bis', 'erledigenBis'],
  ['stundensatz', 'stundensatz'],
]

function findeZusatzSpalten(kopfzeilen: unknown[][]): Partial<Record<ZusatzFeld, number>> {
  const spalten: Partial<Record<ZusatzFeld, number>> = {}
  for (const zeile of kopfzeilen) {
    zeile.forEach((zelle, i) => {
      if (typeof zelle !== 'string') return
      const kopf = zelle.toLowerCase().replace(/\s+/g, ' ').trim()
      for (const [stichwort, feld] of ZUSATZ_KOPF) {
        if (spalten[feld] === undefined && kopf.includes(stichwort)) spalten[feld] = i
      }
    })
  }
  return spalten
}

/** Ältere Zuordnung: feste Spaltenreihenfolge, vier Kopfzeilen, Blatt "to Do" (sonst das erste Blatt). */
export function parseFesteSpalten(workbookBuffer: ArrayBuffer, sheetName: string): ToDoImportWert[] {
  const wb = read(workbookBuffer, { type: 'array', cellDates: true })
  const sheet = wb.Sheets[sheetName] ?? wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const rows = zuExcelZeile(utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }))
  const out: ToDoImportWert[] = []
  const zusatz = findeZusatzSpalten(rows.slice(0, 4))
  const zusatzZelle = (row: unknown[], feld: ZusatzFeld) => (zusatz[feld] === undefined ? undefined : row[zusatz[feld]])
  for (const row of rows.slice(4)) {
    const aufgabe = textWert(row[4])
    if (!aufgabe) continue
    out.push({
      startDatum: textWert(row[0]),
      prio: textWert(row[1]),
      unterPrio: zahlWert(row[2]),
      kundeProjekt: textWert(row[3]),
      aufgabe,
      abteilung: textWert(row[5]),
      aktuellerStand: textWert(row[6]),
      welcheFragen: textWert(row[7]),
      naechsteSchritte: textWert(row[8]),
      zustaendig: textWert(row[9]),
      geplanteZeit: textWert(row[10]),
      istZeit: zahlWert(row[11]),
      umsatzWert: zahlWert(row[12]),
      geplanteWiedervorlage: textWert(row[13]),
      erledigtAm: textWert(row[15]),
      wartenAuf: textWert(zusatzZelle(row, 'wartenAuf')),
      erhaltenAm: datumWert(zusatzZelle(row, 'erhaltenAm')),
      erledigenBis: datumWert(zusatzZelle(row, 'erledigenBis')),
      stundensatz: zahlWert(zusatzZelle(row, 'stundensatz')),
    })
  }
  return out
}

const FESTE_SPALTEN_BESCHRIFTUNG: [string, string][] = [
  ['Spalte A', 'Start'], ['Spalte B', 'Prio'], ['Spalte C', 'Unter-Prio'], ['Spalte D', 'Kunde/Projekt'], ['Spalte E', 'Aufgabe'],
  ['Spalte F', 'Abteilung'], ['Spalte G', 'Aktueller Stand'], ['Spalte H', 'Welche Fragen'], ['Spalte I', 'Nächste Schritte'],
  ['Spalte J', 'Zuständig'], ['Spalte K', 'Geplante Zeit'], ['Spalte L', 'Ist-Zeit'], ['Spalte M', 'Umsatz'],
  ['Spalte N', 'Wiedervorlage'], ['Spalte P', 'Erledigt am'],
]

// ---------------------------------------------------------------------------------------------
// Erkennung über die Überschriften
// ---------------------------------------------------------------------------------------------

type Ziel =
  | 'startDatum' | 'prio' | 'unterPrio' | 'kundeProjekt' | 'aufgabe' | 'abteilung' | 'aktuellerStand' | 'welcheFragen'
  | 'naechsteSchritte' | 'zustaendig' | 'geplanteZeit' | 'istZeit' | 'umsatzWert' | 'geplanteWiedervorlage' | 'erledigtAm'
  | 'wartenAuf' | 'erhaltenAm' | 'erledigenBis' | 'stundensatz'
  // Kein eigenes Feld: Häkchen-Spalte "erledigt" (Datum oder Zeichen) als Ersatz für "Erledigt am",
  // und die berechnete Kosten-Spalte des eigenen Exports.
  | 'erledigtZeichen' | 'zeitaufwandskosten'

export const FELD_NAME: Record<Ziel, string> = {
  startDatum: 'Start',
  prio: 'Prio',
  unterPrio: 'Unter-Prio',
  kundeProjekt: 'Kunde/Projekt',
  aufgabe: 'Aufgabe',
  abteilung: 'Abteilung',
  aktuellerStand: 'Aktueller Stand',
  welcheFragen: 'Welche Fragen',
  naechsteSchritte: 'Nächste Schritte',
  zustaendig: 'Zuständig',
  geplanteZeit: 'Geplante Zeit',
  istZeit: 'Ist-Zeit (Minuten)',
  umsatzWert: 'Umsatz',
  geplanteWiedervorlage: 'Wiedervorlage',
  erledigtAm: 'Erledigt am',
  wartenAuf: 'Warten auf',
  erhaltenAm: 'Erhalten am',
  erledigenBis: 'Erledigen bis',
  stundensatz: 'Stundensatz',
  erledigtZeichen: 'Erledigt am (wenn dort leer)',
  zeitaufwandskosten: 'Zeitaufwandskosten',
}

// Überschriften je Feld, bereits vereinfacht geschrieben (klein, ä→ae usw., Satzzeichen als Leerzeichen).
const STICHWORTE: [Ziel, string[]][] = [
  ['startDatum', ['start', 'startdatum', 'start datum', 'datum', 'tag', 'beginn']],
  ['prio', ['prio', 'pri', 'prioritaet']],
  ['unterPrio', ['unter', 'unterprio', 'unter prio', 'unterprioritaet']],
  ['kundeProjekt', ['kunde projekt', 'kunde', 'projekt', 'firma', 'kunde firma']],
  ['aufgabe', ['aufgabe', 'aufgaben']],
  ['abteilung', ['abt', 'abteilung']],
  ['aktuellerStand', ['aktueller stand', 'stand']],
  ['welcheFragen', ['welche fragen', 'fragen', 'offene fragen', 'welche fragen infos']],
  ['naechsteSchritte', ['naechste schritte', 'naechster schritt', 'naechstes', 'was ist als naechstes zu tun', 'was ist als naechster schritt', 'zu machen', 'zu tun']],
  ['zustaendig', ['zustaendig', 'zustaendigkeit', 'verantwortlich']],
  ['geplanteZeit', ['geplante zeit', 'geplante', 'soll zeit', 'soll', 'zeit geplant']],
  ['istZeit', ['ist zeit', 'istzeit', 'ist', 'zeit ist']],
  ['umsatzWert', ['umsatz', 'umsatz wert', 'wert', 'auftragswert', 'auftrags wert', 'euro wert']],
  ['geplanteWiedervorlage', ['wiedervorlage', 'geplante wiedervorlage', 'geplant am', 'wv']],
  ['erledigtAm', ['erledigt am']],
  ['erledigtZeichen', ['erledigt', 'erl']],
  ['wartenAuf', ['warten auf', 'wartet auf']],
  ['erhaltenAm', ['erhalten am', 'aufgabe erhalten am', 'bekommen am', 'bekom am', 'eingang am']],
  ['erledigenBis', ['erledigen bis', 'zu erledigen bis', 'aufgabe zu erledigen bis', 'faellig', 'faellig am', 'frist']],
  ['stundensatz', ['stundensatz']],
  ['zeitaufwandskosten', ['zeitaufwandskosten', 'zeitkosten', 'kosten']],
]

// Wörter, die in mehrzeiligen Überschriften als Fortsetzung vorkommen ("Zeit", "min", "am", "Euro" …).
const FORTSETZUNGS_WORTE = new Set(['zeit', 'min', 'minuten', 'am', 'bis', 'euro', 'eur', 'std', 'stunden', 'h', 'wert', 'in', 'auf'])

/** Vereinfacht eine Überschrift: klein, Umlaute als ae/oe/ue, ß als ss, alles andere als Leerzeichen. */
export function vereinfache(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/€/g, ' euro ')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function abstand(a: string, b: string): number {
  if (a === b) return 0
  const v = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let vorher = v[0]
    v[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = v[j]
      v[j] = Math.min(v[j] + 1, v[j - 1] + 1, vorher + (a[i - 1] === b[j - 1] ? 0 : 1))
      vorher = tmp
    }
  }
  return v[b.length]
}

// 3 = gleiches Wort, 2 = fast gleich (Tippfehler, fehlendes Umlaut-e), 0 = verschieden.
function wortPunkte(a: string, b: string): number {
  if (a === b) return 3
  const kurz = Math.min(a.length, b.length)
  const erlaubt = kurz <= 4 ? 0 : kurz <= 8 ? 1 : 2
  return erlaubt > 0 && abstand(a, b) <= erlaubt ? 2 : 0
}

// Passt ein Stichwort (alle seine Wörter, zusammenhängend) in den Überschriftsteil? Punkte je Wort,
// plus 1, wenn das Stichwort den Teil vollständig abdeckt.
function stichwortPunkte(teil: string[], stichwort: string[]): number {
  let best = 0
  for (let start = 0; start + stichwort.length <= teil.length; start++) {
    let summe = 0
    for (let k = 0; k < stichwort.length; k++) {
      const p = wortPunkte(teil[start + k], stichwort[k])
      if (!p) {
        summe = 0
        break
      }
      summe += p
    }
    if (summe && stichwort.length === teil.length) summe += 1
    best = Math.max(best, summe)
  }
  return best
}

type Treffer = { feld: Ziel; punkte: number; teilIndex: number }

/** Bestes Feld je Überschriftsteil; über alle Teile zählt der stärkste Treffer, bei Gleichstand der frühere Teil. */
function besteTreffer(teile: string[]): Treffer[] {
  const best = new Map<Ziel, Treffer>()
  teile.forEach((teil, teilIndex) => {
    const woerter = vereinfache(teil).split(' ').filter(Boolean)
    if (!woerter.length) return
    for (const [feld, liste] of STICHWORTE) {
      for (const sw of liste) {
        const punkte = stichwortPunkte(woerter, sw.split(' '))
        if (punkte < 3) continue
        const alt = best.get(feld)
        if (!alt || punkte > alt.punkte) best.set(feld, { feld, punkte, teilIndex })
      }
    }
  })
  return [...best.values()].sort((a, b) => b.punkte - a.punkte || a.teilIndex - b.teilIndex)
}

function spaltenBuchstabe(c: number): string {
  return utils.encode_col(c)
}

type Zelle = CellObject | undefined

function istLeer(z: Zelle): boolean {
  if (!z || z.v === undefined || z.v === null) return true
  return typeof z.v === 'string' && z.v.trim() === ''
}

function zellText(z: Zelle): string | undefined {
  if (istLeer(z)) return undefined
  return String(z!.v).replace(/\s+/g, ' ').trim()
}

// Zahlenformat einer Zelle: Datum, Uhrzeit/Dauer oder nichts davon.
function formatArt(z: Zelle): 'datum' | 'zeit' | undefined {
  const fmt = typeof z?.z === 'string' ? z.z : ''
  if (!fmt || !SSF.is_date(fmt)) return undefined
  const ohneZusatz = fmt.replace(/\[[^\]]*\]/g, (t) => (/^\[h+\]$/i.test(t) ? 'h' : '')).replace(/"[^"]*"/g, '')
  return /[dy]/i.test(ohneZusatz) ? 'datum' : 'zeit'
}

type Kontext = { date1904: boolean; heute: string }

function serienzahlZuIso(n: number, ctx: Kontext): string | undefined {
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return undefined
  const d = SSF.parse_date_code(n, { date1904: ctx.date1904 })
  if (!d || !d.y) return undefined
  return `${d.y}-${zwei(d.m)}-${zwei(d.d)}`
}

function isoZuDeutsch(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

// Datum aus Text: "17.11.2026", "17.11.26", "17/11/2026", "2026-11-17", ohne Jahr "17.11." (Jahr des Imports).
function datumAusText(s: string, ctx: Kontext): string | undefined {
  const t = s.trim()
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return gueltig(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const mitJahr = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/)
  if (mitJahr) {
    const jahr = mitJahr[3].length === 2 ? 2000 + Number(mitJahr[3]) : Number(mitJahr[3])
    return gueltig(jahr, Number(mitJahr[2]), Number(mitJahr[1]))
  }
  const ohneJahr = t.match(/^(\d{1,2})[./](\d{1,2})\.?$/)
  if (ohneJahr) return gueltig(Number(ctx.heute.slice(0, 4)), Number(ohneJahr[2]), Number(ohneJahr[1]))
  return undefined
}

function gueltig(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined
  const probe = new Date(y, m - 1, d)
  if (probe.getMonth() !== m - 1) return undefined
  return `${y}-${zwei(m)}-${zwei(d)}`
}

function datumAusZelle(z: Zelle, ctx: Kontext): string | undefined {
  if (istLeer(z)) return undefined
  const v = z!.v
  if (v instanceof Date) return datumWert(v)
  if (typeof v === 'number') {
    // Ohne Datumsformat nur plausible Serienzahlen (ca. 1955 bis 2119) als Datum lesen.
    if (formatArt(z) === 'datum' || (v > 20000 && v < 80000)) return serienzahlZuIso(v, ctx)
    return undefined
  }
  return datumAusText(String(v), ctx)
}

/** Zahl aus deutscher oder englischer Schreibweise: "1.234,50 €", "85,00", "1500.5". */
export function zahlAusText(s: string): number | undefined {
  let t = s.replace(/€|eur(o)?/gi, '').replace(/[\s ]/g, '')
  if (!t) return undefined
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.')
  else if (t.includes(',')) t = t.replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined
  return Number(t)
}

function zahlAusZelle(z: Zelle): number | undefined {
  if (istLeer(z)) return undefined
  const v = z!.v
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return undefined
  return zahlAusText(String(v))
}

type Einheit = 'min' | 'std' | undefined

function einheitAusKopf(kopf: string): Einheit {
  const w = vereinfache(kopf).split(' ')
  if (w.includes('min') || w.includes('minuten')) return 'min'
  if (w.includes('std') || w.includes('stunden') || w.includes('h')) return 'std'
  return undefined
}

// Dauer in Minuten: Excel-Zeitwert (Bruchteil eines Tages), "1:30", "90 min", "1,5 Std.", oder eine Zahl
// in der Einheit der Überschrift (ohne Angabe: Minuten, wie im CRM).
function minutenAusZelle(z: Zelle, einheit: Einheit): number | undefined {
  if (istLeer(z)) return undefined
  const v = z!.v
  if (typeof v === 'number') {
    if (formatArt(z) === 'zeit') return Math.round(v * 1440)
    return einheit === 'std' ? Math.round(v * 60) : v
  }
  const s = String(v).trim().toLowerCase()
  const uhr = s.match(/^(\d{1,3}):(\d{2})(?::\d{2})?\s*(h|std\.?|stunden)?$/)
  if (uhr) return Number(uhr[1]) * 60 + Number(uhr[2])
  const mitEinheit = s.match(/^([\d.,]+)\s*(min\.?|minuten|h|std\.?|stunden)$/)
  if (mitEinheit) {
    const n = zahlAusText(mitEinheit[1])
    if (n === undefined) return undefined
    return mitEinheit[2].startsWith('min') ? n : Math.round(n * 60)
  }
  const n = zahlAusText(s)
  if (n === undefined) return undefined
  return einheit === 'std' ? Math.round(n * 60) : n
}

// Text aus einer Zelle; Zahlen mit Datumsformat werden als TT.MM.JJJJ geschrieben.
function textAusZelle(z: Zelle, ctx: Kontext): string | undefined {
  if (istLeer(z)) return undefined
  const v = z!.v
  if (v instanceof Date) {
    const iso = datumWert(v)
    return iso ? isoZuDeutsch(iso) : undefined
  }
  if (typeof v === 'number') {
    if (formatArt(z) === 'datum') {
      const iso = serienzahlZuIso(v, ctx)
      if (iso) return isoZuDeutsch(iso)
    }
    return String(v)
  }
  if (typeof v === 'boolean') return v ? 'ja' : 'nein'
  const s = String(v).trim()
  return s || undefined
}

const ERLEDIGT_ZEICHEN = new Set(['x', 'ja', 'j', 'ok', 'erledigt', 'erl', '1', 'wahr', '✓', '✔', '√'])

export type SpaltenZuordnung = { spalte: string; feld: string }
export type NichtUebernommen = { spalte: string; grund: string }

export type BlattErgebnis = {
  blatt: string
  /** 1-basiert, zur Anzeige: Überschrift steht in Zeile kopfVon bis kopfBis. */
  kopfVon: number
  kopfBis: number
  eintraege: ToDoImportWert[]
  zugeordnet: SpaltenZuordnung[]
  nichtUebernommen: NichtUebernommen[]
  hinweise: string[]
}

export type ToDoImportVorschau = {
  art: 'ueberschriften' | 'feste-spalten'
  blaetter: BlattErgebnis[]
}

type BlattDaten = { zelle: (r: number, c: number) => Zelle; maxR: number; maxC: number; filterKopf?: number }

function blattDaten(ws: WorkSheet): BlattDaten {
  let maxR = -1
  let maxC = -1
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue
    const z = ws[key] as CellObject
    if (istLeer(z)) continue
    const { r, c } = utils.decode_cell(key)
    if (r > maxR) maxR = r
    if (c > maxC) maxC = c
  }
  const af = (ws['!autofilter'] as { ref?: string } | undefined)?.ref
  const filterKopf = af ? utils.decode_range(af).s.r : undefined
  return { zelle: (r, c) => ws[utils.encode_cell({ r, c })] as Zelle, maxR, maxC, filterKopf }
}

// Anzahl verschiedener Felder, die eine Zeile als Überschrift erkennen lässt. Eine Datenzeile mit
// zufällig passenden Wörtern ("Kunde", "Stand") zählt nicht: mindestens die Hälfte der gefüllten
// Zellen muss eine erkannte Überschrift sein.
function kopfTrefferInZeile(d: BlattDaten, r: number): number {
  const felder = new Set<Ziel>()
  let gefuellt = 0
  let erkannt = 0
  for (let c = 0; c <= d.maxC; c++) {
    const t = d.zelle(r, c)
    if (istLeer(t)) continue
    gefuellt++
    if (t!.t !== 's') continue
    const text = zellText(t)
    if (!text || text.length > 60) continue
    const best = besteTreffer([text])[0]
    if (best) {
      felder.add(best.feld)
      erkannt++
    }
  }
  return erkannt * 2 >= gefuellt ? felder.size : 0
}

// Gehört die Zeile noch zur (mehrzeiligen) Überschrift? Nur kurze Texte, die überwiegend selbst
// Überschriften oder typische Fortsetzungen ("Zeit", "min", "am") sind.
function istKopfFortsetzung(d: BlattDaten, r: number): boolean {
  let gefuellt = 0
  let passend = 0
  for (let c = 0; c <= d.maxC; c++) {
    const z = d.zelle(r, c)
    if (istLeer(z)) continue
    if (z!.t !== 's') return false
    const text = zellText(z)!
    if (text.length > 40) return false
    gefuellt++
    const woerter = vereinfache(text).split(' ').filter(Boolean)
    if (besteTreffer([text]).length || (woerter.length > 0 && woerter.every((w) => FORTSETZUNGS_WORTE.has(w)))) passend++
  }
  return gefuellt > 0 && passend / gefuellt >= 0.6
}

function eindeutigeTeile(teile: string[]): string[] {
  const gesehen = new Set<string>()
  return teile.filter((t) => {
    const k = vereinfache(t)
    if (!k || gesehen.has(k)) return false
    gesehen.add(k)
    return true
  })
}

function leseBlattUeberUeberschriften(name: string, ws: WorkSheet, ctx: Kontext): BlattErgebnis | undefined {
  const d = blattDaten(ws)
  if (d.maxR < 0) return undefined

  // 1. Überschriftszeile: die Zeile (unter den ersten 30) mit den meisten erkannten Feldern.
  let anker = -1
  let ankerTreffer = 1
  for (let r = 0; r <= Math.min(d.maxR, 29); r++) {
    const n = kopfTrefferInZeile(d, r)
    if (n > ankerTreffer) {
      anker = r
      ankerTreffer = n
    }
  }
  if (anker < 0) return undefined

  // 2. Mehrzeilige Überschrift: folgende Zeilen gehören dazu, solange sie wie Überschrift aussehen
  //    oder die Filterzeile (Auswahlpfeile in Excel) noch darunter liegt.
  let kopfBis = anker
  for (let r = anker + 1; r <= Math.min(anker + 4, d.maxR); r++) {
    const bisFilter = d.filterKopf !== undefined && d.filterKopf >= r && d.filterKopf <= anker + 4
    if (bisFilter || istKopfFortsetzung(d, r)) kopfBis = r
    else break
  }

  // 3. Spalten zuordnen.
  type Spalte = { c: number; anzeige: string; einheit: Einheit; treffer: Treffer[] }
  const spalten: Spalte[] = []
  for (let c = 0; c <= d.maxC; c++) {
    const teile: string[] = []
    for (let r = anker; r <= kopfBis; r++) {
      const t = zellText(d.zelle(r, c))
      if (t) teile.push(t)
    }
    if (!teile.length) continue
    const eindeutig = eindeutigeTeile(teile)
    const gesamt = eindeutig.join(' ')
    const treffer = besteTreffer([...eindeutig, gesamt])
    spalten.push({ c, anzeige: gesamt, einheit: einheitAusKopf(gesamt), treffer })
  }
  // Zuerst die stärksten Treffer; ist ein Feld schon vergeben, geht es zum nächstbesten Feld der Spalte.
  const vergeben = new Map<Ziel, Spalte>()
  const feldVon = new Map<number, Ziel>()
  const nichtUebernommen: NichtUebernommen[] = []
  const reihenfolge = [...spalten].sort((a, b) => (b.treffer[0]?.punkte ?? 0) - (a.treffer[0]?.punkte ?? 0) || a.c - b.c)
  for (const s of reihenfolge) {
    const frei = s.treffer.find((t) => !vergeben.has(t.feld))
    if (frei) {
      vergeben.set(frei.feld, s)
      feldVon.set(s.c, frei.feld)
    }
  }
  if (!vergeben.has('aufgabe')) return undefined

  const zugeordnet: SpaltenZuordnung[] = []
  for (const s of spalten) {
    const feld = feldVon.get(s.c)
    if (feld === 'zeitaufwandskosten') {
      nichtUebernommen.push({ spalte: s.anzeige, grund: 'wird aus Ist-Zeit und Stundensatz neu berechnet' })
    } else if (feld) {
      zugeordnet.push({ spalte: s.anzeige, feld: FELD_NAME[feld] })
    } else if (s.treffer.length) {
      const doppelt = vergeben.get(s.treffer[0].feld)
      nichtUebernommen.push({ spalte: s.anzeige, grund: `doppelt, „${FELD_NAME[s.treffer[0].feld]}“ kommt schon aus „${doppelt?.anzeige ?? ''}“` })
    } else {
      nichtUebernommen.push({ spalte: s.anzeige, grund: 'kein passendes Feld in der Liste' })
    }
  }

  // Text über der Tabelle (Titel, "Bearbeiter: …") wird gemeldet, nicht übernommen.
  const darueber: string[] = []
  for (let r = 0; r < anker; r++) {
    for (let c = 0; c <= d.maxC; c++) {
      const t = textAusZelle(d.zelle(r, c), ctx)
      if (t) darueber.push(t)
    }
  }
  if (darueber.length) {
    const text = darueber.map((t) => `„${t.length > 40 ? t.slice(0, 40) + '…' : t}“`).join(', ')
    nichtUebernommen.push({ spalte: anker === 1 ? 'Angaben über der Tabelle (Zeile 1)' : `Angaben über der Tabelle (Zeile 1–${anker})`, grund: text })
  }

  // 4. Datenzeilen lesen.
  const spalteVon = new Map<Ziel, Spalte>()
  for (const [feld, s] of vergeben) spalteVon.set(feld, s)
  const zelleVon = (r: number, feld: Ziel): Zelle => {
    const s = spalteVon.get(feld)
    return s ? d.zelle(r, s.c) : undefined
  }
  const kopfSpalten = new Set(spalten.map((s) => s.c))
  const ohneUeberschriftMitDaten = new Set<number>()
  const nichtLesbar = new Map<Ziel, number>()
  const unlesbar = (feld: Ziel) => nichtLesbar.set(feld, (nichtLesbar.get(feld) ?? 0) + 1)
  let ohneAufgabe = 0
  let nurAngekreuzt = 0
  const eintraege: ToDoImportWert[] = []

  const datum = (r: number, feld: Ziel) => {
    const z = zelleVon(r, feld)
    const iso = datumAusZelle(z, ctx)
    if (!iso && !istLeer(z)) unlesbar(feld)
    return iso
  }
  const zahl = (r: number, feld: Ziel) => {
    const z = zelleVon(r, feld)
    const n = zahlAusZelle(z)
    if (n === undefined && !istLeer(z)) unlesbar(feld)
    return n
  }
  const text = (r: number, feld: Ziel) => textAusZelle(zelleVon(r, feld), ctx)

  for (let r = kopfBis + 1; r <= d.maxR; r++) {
    let leer = true
    for (let c = 0; c <= d.maxC; c++) {
      if (istLeer(d.zelle(r, c))) continue
      leer = false
      if (!kopfSpalten.has(c)) ohneUeberschriftMitDaten.add(c)
    }
    if (leer) continue
    const aufgabe = text(r, 'aufgabe')
    // Eine wiederholte Überschrift ("Aufgabe") ist keine Aufgabe.
    if (!aufgabe || ['aufgabe', 'aufgaben'].includes(vereinfache(aufgabe))) {
      ohneAufgabe++
      continue
    }

    // In der Vorlage hat die Prio-Spalte ein Datumsformat; eine getippte Zahl bleibt trotzdem die Zahl.
    const pz = zelleVon(r, 'prio')
    let prio = typeof pz?.v === 'number' ? String(pz.v) : text(r, 'prio')
    let unterPrio = zahl(r, 'unterPrio')
    // "A1", "A 1", "A-1" in einer Prio-Spalte: Buchstabe ist die Prio, Ziffer die Unter-Prio.
    const geteilt = prio?.match(/^([A-Za-z])\s*[-./]?\s*(\d{1,2})$/)
    if (geteilt && unterPrio === undefined) {
      prio = geteilt[1].toUpperCase()
      unterPrio = Number(geteilt[2])
    }

    let geplanteZeit: string | undefined
    const gz = zelleVon(r, 'geplanteZeit')
    if (!istLeer(gz)) {
      const einheit = spalteVon.get('geplanteZeit')?.einheit
      if (typeof gz!.v === 'number') {
        if (formatArt(gz) === 'zeit') geplanteZeit = `${Math.round(gz!.v * 1440)} min`
        else geplanteZeit = einheit === 'min' ? `${gz!.v} min` : einheit === 'std' ? `${gz!.v} Std.` : String(gz!.v)
      } else geplanteZeit = textAusZelle(gz, ctx)
    }

    const iz = zelleVon(r, 'istZeit')
    const istZeit = minutenAusZelle(iz, spalteVon.get('istZeit')?.einheit)
    if (istZeit === undefined && !istLeer(iz)) unlesbar('istZeit')

    let erledigtAm = datum(r, 'erledigtAm')
    const zeichen = zelleVon(r, 'erledigtZeichen')
    if (!erledigtAm && !istLeer(zeichen)) {
      const alsDatum = datumAusZelle(zeichen, ctx)
      if (alsDatum) erledigtAm = alsDatum
      else if (zeichen!.v === true || ERLEDIGT_ZEICHEN.has(vereinfache(String(zeichen!.v)) || String(zeichen!.v).trim())) {
        erledigtAm = ctx.heute
        nurAngekreuzt++
      } else unlesbar('erledigtZeichen')
    }

    eintraege.push({
      startDatum: text(r, 'startDatum'),
      prio,
      unterPrio,
      kundeProjekt: text(r, 'kundeProjekt'),
      aufgabe,
      abteilung: text(r, 'abteilung'),
      aktuellerStand: text(r, 'aktuellerStand'),
      welcheFragen: text(r, 'welcheFragen'),
      naechsteSchritte: text(r, 'naechsteSchritte'),
      zustaendig: text(r, 'zustaendig'),
      geplanteZeit,
      istZeit,
      umsatzWert: zahl(r, 'umsatzWert'),
      geplanteWiedervorlage: datum(r, 'geplanteWiedervorlage'),
      erledigtAm,
      wartenAuf: text(r, 'wartenAuf'),
      erhaltenAm: datum(r, 'erhaltenAm'),
      erledigenBis: datum(r, 'erledigenBis'),
      stundensatz: zahl(r, 'stundensatz'),
    })
  }

  for (const c of ohneUeberschriftMitDaten) {
    nichtUebernommen.push({ spalte: `Spalte ${spaltenBuchstabe(c)} (ohne Überschrift)`, grund: 'enthält Werte, aber keine Überschrift' })
  }

  const hinweise: string[] = []
  if (ohneAufgabe) hinweise.push(`${ohneAufgabe} ${ohneAufgabe === 1 ? 'Zeile hat' : 'Zeilen haben'} Einträge, aber keine Aufgabe – ${ohneAufgabe === 1 ? 'sie wird' : 'sie werden'} übersprungen.`)
  for (const [feld, n] of nichtLesbar) {
    const s = spalteVon.get(feld)
    const art = ['istZeit'].includes(feld) ? 'als Dauer' : ['umsatzWert', 'stundensatz', 'unterPrio'].includes(feld) ? 'als Zahl' : 'als Datum'
    hinweise.push(`${n} ${n === 1 ? 'Wert' : 'Werte'} in „${s?.anzeige ?? FELD_NAME[feld]}“ nicht ${art} lesbar – leer gelassen.`)
  }
  if (nurAngekreuzt) {
    const s = spalteVon.get('erledigtZeichen')
    hinweise.push(`${nurAngekreuzt} ${nurAngekreuzt === 1 ? 'Aufgabe ist' : 'Aufgaben sind'} in „${s?.anzeige ?? 'erledigt'}“ nur angekreuzt, ohne Datum – ${nurAngekreuzt === 1 ? 'sie wird' : 'sie werden'} mit dem heutigen Datum als erledigt übernommen.`)
  }
  if (vereinfache(name).includes('erledigt')) {
    const offen = eintraege.filter((e) => !e.erledigtAm).length
    if (offen) hinweise.push(`${offen} ${offen === 1 ? 'Aufgabe' : 'Aufgaben'} auf diesem Blatt ${offen === 1 ? 'hat' : 'haben'} kein Erledigt-Datum und ${offen === 1 ? 'kommt' : 'kommen'} als offene Aufgabe in die Liste.`)
  }

  return { blatt: name, kopfVon: anker + 1, kopfBis: kopfBis + 1, eintraege, zugeordnet, nichtUebernommen, hinweise }
}

function istCsv(dateiname: string, buffer: ArrayBuffer): boolean {
  if (/\.(csv|txt)$/i.test(dateiname)) return true
  const kopf = new Uint8Array(buffer.slice(0, 4))
  // xlsx (ZIP) beginnt mit "PK", alte xls mit D0 CF 11 E0.
  return !(kopf[0] === 0x50 && kopf[1] === 0x4b) && !(kopf[0] === 0xd0 && kopf[1] === 0xcf)
}

function leseArbeitsmappe(buffer: ArrayBuffer, dateiname: string): WorkBook {
  if (istCsv(dateiname, buffer)) {
    // Eigener Export: UTF-8 mit BOM. Von Excel neu gespeicherte CSV-Dateien sind oft Windows-1252.
    let text = new TextDecoder('utf-8').decode(buffer)
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer)
    text = text.replace(/^﻿/, '')
    // raw: alle Werte bleiben Text, Zahlen und Daten werden hier selbst (deutsch) gelesen.
    return read(text, { type: 'string', raw: true })
  }
  return read(buffer, { type: 'array', cellNF: true, cellDates: false })
}

/**
 * Liest eine Excel- oder CSV-Datei und liefert je Tabellenblatt die erkannten Aufgaben samt Spalten-
 * zuordnung für die Vorschau. Übernommen wird erst, wenn der Nutzer in der Vorschau bestätigt.
 * `heute` (yyyy-mm-dd) wird für angekreuzte Erledigt-Spalten ohne Datum und für Daten ohne Jahr benutzt.
 */
export function analysiereToDoDatei(buffer: ArrayBuffer, dateiname: string, heute: string): ToDoImportVorschau {
  const wb = leseArbeitsmappe(buffer, dateiname)
  const ctx: Kontext = { date1904: !!wb.Workbook?.WBProps?.date1904, heute }
  const csv = istCsv(dateiname, buffer)
  const blaetter: BlattErgebnis[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    // Eine CSV-Datei hat kein benanntes Blatt; angezeigt wird der Dateiname.
    const erg = leseBlattUeberUeberschriften(csv ? dateiname : name, ws, ctx)
    if (erg) blaetter.push(erg)
  }
  if (blaetter.length) return { art: 'ueberschriften', blaetter }

  // Keine Überschrift erkannt: bisherige feste Spaltenreihenfolge (nur Excel-Dateien).
  if (csv) return { art: 'ueberschriften', blaetter: [] }
  const eintraege = parseFesteSpalten(buffer, 'to Do')
  const blatt = wb.Sheets['to Do'] ? 'to Do' : wb.SheetNames[0] ?? ''
  // Spalten mit Werten, die die feste Reihenfolge nicht liest, werden gemeldet.
  const nichtUebernommen: NichtUebernommen[] = []
  const ws = wb.Sheets[blatt]
  if (ws) {
    const zeilen = utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null })
    const zusatz = new Set(Object.values(findeZusatzSpalten(zeilen.slice(0, 4))))
    const gelesen = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15])
    const uebrig = new Set<number>()
    for (const zeile of zeilen.slice(4)) {
      if (!textWert(zeile[4])) continue
      zeile.forEach((v, i) => {
        if (!gelesen.has(i) && !zusatz.has(i) && textWert(v) !== undefined) uebrig.add(i)
      })
    }
    for (const i of [...uebrig].sort((a, b) => a - b)) nichtUebernommen.push({ spalte: `Spalte ${spaltenBuchstabe(i)}`, grund: 'enthält Werte, gehört aber zu keinem Feld' })
  }
  return {
    art: 'feste-spalten',
    blaetter: [
      {
        blatt,
        kopfVon: 1,
        kopfBis: 4,
        eintraege,
        zugeordnet: FESTE_SPALTEN_BESCHRIFTUNG.map(([spalte, feld]) => ({ spalte, feld })),
        nichtUebernommen,
        hinweise: ['Keine Überschriften erkannt – Spalten nach der festen Reihenfolge der älteren Vorlage zugeordnet, die ersten vier Zeilen gelten als Überschrift.'],
      },
    ],
  }
}
