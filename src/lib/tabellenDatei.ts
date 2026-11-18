// Eigene Tabelle (Excel oder CSV) für die Auswertungen einlesen — nur im Browser, die Datei verlässt
// das Gerät nicht. Je Tabellenblatt: die erste Zeile, die wie eine Überschrift aussieht, liefert die
// Spaltennamen; jede Spalte wird als Zahl, Datum oder Text erkannt. Zahlen in deutscher Schreibweise
// („1.234,56", „-12,50 €", „1.234,56-") werden gelesen, ebenso Daten wie „17.11.2026".

import { read, utils, SSF } from 'xlsx'
import type { CellObject, WorkBook, WorkSheet } from 'xlsx'
import { zahlAusText } from './todoExcelImport'
import type { Datensatz, Feld, FeldTyp } from './pivot'

export type GeleseneTabelle = {
  blatt: string
  /** 1-basiert, zur Anzeige. */
  kopfZeile: number
  felder: Feld[]
  daten: Datensatz[]
}

type Zelle = CellObject | undefined

const zwei = (n: number) => String(n).padStart(2, '0')

function istLeer(z: Zelle): boolean {
  if (!z || z.v === undefined || z.v === null) return true
  return typeof z.v === 'string' && z.v.trim() === ''
}

function istDatumsFormat(z: Zelle): boolean {
  const fmt = typeof z?.z === 'string' ? z.z : ''
  if (!fmt || !SSF.is_date(fmt)) return false
  // Reine Uhrzeit- oder Dauerformate ("hh:mm", "[h]:mm") sind kein Datum.
  const ohneZusatz = fmt.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '')
  return /[dy]/i.test(ohneZusatz)
}

function gueltig(y: number, m: number, d: number): string | undefined {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return undefined
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCMonth() !== m - 1) return undefined
  return `${y}-${zwei(m)}-${zwei(d)}`
}

/** "17.11.2026", "17.11.26", "17/11/2026", "2026-11-17", jeweils auch mit Uhrzeit dahinter. */
export function datumAusText(s: string): string | undefined {
  const t = s.trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(t)
  if (iso) return gueltig(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const de = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*Uhr)?)?$/.exec(t)
  if (de) {
    const jahr = de[3].length === 2 ? 2000 + Number(de[3]) : Number(de[3])
    return gueltig(jahr, Number(de[2]), Number(de[1]))
  }
  return undefined
}

/** Zahl aus Text: deutsche oder englische Schreibweise, mit €, % oder nachgestelltem Minus. */
export function zahlAusZellText(s: string): number | undefined {
  let t = s.trim().replace(/%$/, '').trim()
  let negativ = false
  if (/^[\d.,\s €]+-$/.test(t)) {
    negativ = true
    t = t.slice(0, -1)
  }
  if (/^\(.*\)$/.test(t)) {
    negativ = true
    t = t.slice(1, -1)
  }
  if (!/\d/.test(t) || /[a-df-z]/i.test(t.replace(/eur(o)?/gi, ''))) return undefined
  // Englische Schreibweise mit beiden Zeichen ("1,234.56"): Kommas trennen Tausender.
  if (t.includes(',') && t.includes('.') && t.lastIndexOf('.') > t.lastIndexOf(',')) t = t.replace(/,/g, '')
  const n = zahlAusText(t.replace(/^\+/, ''))
  if (n === undefined) return undefined
  return negativ ? -n : n
}

function serienzahlZuIso(n: number, date1904: boolean): string | undefined {
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return undefined
  const d = SSF.parse_date_code(n, { date1904 })
  if (!d || !d.y) return undefined
  return gueltig(d.y, d.m, d.d)
}

type Gelesen = { art: 'datum'; iso: string } | { art: 'zahl'; n: number; euro: boolean } | { art: 'text'; text: string }

function lies(z: Zelle, date1904: boolean): Gelesen | undefined {
  if (istLeer(z)) return undefined
  const v = z!.v
  if (v instanceof Date) {
    const iso = gueltig(v.getFullYear(), v.getMonth() + 1, v.getDate())
    return iso ? { art: 'datum', iso } : undefined
  }
  if (typeof v === 'number') {
    if (istDatumsFormat(z)) {
      const iso = serienzahlZuIso(v, date1904)
      if (iso) return { art: 'datum', iso }
    }
    const fmt = typeof z!.z === 'string' ? z!.z : ''
    return { art: 'zahl', n: v, euro: /€|EUR/.test(fmt) }
  }
  if (typeof v === 'boolean') return { art: 'text', text: v ? 'ja' : 'nein' }
  const text = String(v).replace(/\s+/g, ' ').trim()
  const iso = datumAusText(text)
  if (iso) return { art: 'datum', iso }
  const n = zahlAusZellText(text)
  if (n !== undefined) return { art: 'zahl', n, euro: /€|\beur(o)?\b/i.test(text) }
  return { art: 'text', text }
}

/** Text einer Zelle für Textspalten (Datum als TT.MM.JJJJ, Zahl wie in der Datei). */
function alsText(g: Gelesen): string {
  if (g.art === 'text') return g.text
  if (g.art === 'datum') return `${g.iso.slice(8, 10)}.${g.iso.slice(5, 7)}.${g.iso.slice(0, 4)}`
  return g.n.toLocaleString('de-DE', { maximumFractionDigits: 10 })
}

const EURO_KOPF = /€|\beur(o)?\b|betrag|preis|umsatz|kosten|summe|honorar|miete|netto|brutto|saldo|zahlung|provision|gehalt|lohn/i

function istCsv(dateiname: string, buffer: ArrayBuffer): boolean {
  if (/\.(csv|txt)$/i.test(dateiname)) return true
  const kopf = new Uint8Array(buffer.slice(0, 4))
  // xlsx (ZIP) beginnt mit "PK", alte xls mit D0 CF 11 E0.
  return !(kopf[0] === 0x50 && kopf[1] === 0x4b) && !(kopf[0] === 0xd0 && kopf[1] === 0xcf)
}

function leseArbeitsmappe(buffer: ArrayBuffer, dateiname: string): WorkBook {
  if (istCsv(dateiname, buffer)) {
    // Von Excel gespeicherte CSV-Dateien sind oft Windows-1252 statt UTF-8.
    let text = new TextDecoder('utf-8').decode(buffer)
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer)
    text = text.replace(/^﻿/, '')
    // raw: alle Werte bleiben Text; Zahlen und Daten werden hier selbst (deutsch) gelesen.
    return read(text, { type: 'string', raw: true })
  }
  return read(buffer, { type: 'array', cellNF: true, cellDates: false })
}

function leseBlatt(name: string, ws: WorkSheet, date1904: boolean): GeleseneTabelle | undefined {
  const ref = ws['!ref']
  if (!ref) return undefined
  const bereich = utils.decode_range(ref)
  const zelle = (r: number, c: number) => ws[utils.encode_cell({ r, c })] as Zelle

  // Zahl gefüllter Zellen je Zeile (für die Suche nach der Überschrift nur die ersten 30 Zeilen).
  const suchBis = Math.min(bereich.e.r, bereich.s.r + 29)
  let meisteGefuellt = 0
  const gefuellt: number[] = []
  for (let r = bereich.s.r; r <= suchBis; r++) {
    let n = 0
    for (let c = bereich.s.c; c <= bereich.e.c; c++) if (!istLeer(zelle(r, c))) n++
    gefuellt[r] = n
    if (n > meisteGefuellt) meisteGefuellt = n
  }
  if (meisteGefuellt === 0) return undefined

  // Überschrift: erste Zeile, die gut gefüllt ist und überwiegend aus Text besteht (keine Zahlen/Daten).
  let kopf = -1
  for (let r = bereich.s.r; r <= suchBis; r++) {
    const n = gefuellt[r]
    if (n === 0 || n < Math.max(1, Math.ceil(meisteGefuellt * 0.5))) continue
    let text = 0
    for (let c = bereich.s.c; c <= bereich.e.c; c++) {
      const g = lies(zelle(r, c), date1904)
      if (g?.art === 'text') text++
    }
    if (text / n >= 0.6) {
      kopf = r
      break
    }
  }
  if (kopf === -1) kopf = gefuellt.findIndex((n) => n > 0)

  // Spalten: alle mit Überschrift oder mit Werten darunter.
  const spalten: { c: number; name: string }[] = []
  const vergeben = new Set<string>()
  for (let c = bereich.s.c; c <= bereich.e.c; c++) {
    const k = zelle(kopf, c)
    let name = istLeer(k) ? '' : String(k!.w ?? k!.v).replace(/\s+/g, ' ').trim()
    if (!name) {
      let hatWerte = false
      for (let r = kopf + 1; r <= bereich.e.r && !hatWerte; r++) hatWerte = !istLeer(zelle(r, c))
      if (!hatWerte) continue
      name = `Spalte ${utils.encode_col(c)}`
    }
    let eindeutig = name
    for (let i = 2; vergeben.has(eindeutig.toLowerCase()); i++) eindeutig = `${name} (${i})`
    vergeben.add(eindeutig.toLowerCase())
    spalten.push({ c, name: eindeutig })
  }

  // Werte lesen; ganz leere Zeilen auslassen.
  const roh: (Gelesen | undefined)[][] = []
  for (let r = kopf + 1; r <= bereich.e.r; r++) {
    const zeile = spalten.map((s) => lies(zelle(r, s.c), date1904))
    if (zeile.some((g) => g !== undefined)) roh.push(zeile)
  }

  const felder: Feld[] = []
  spalten.forEach((s, i) => {
    let n = 0
    let datum = 0
    let zahl = 0
    let euro = 0
    for (const zeile of roh) {
      const g = zeile[i]
      if (!g) continue
      n++
      if (g.art === 'datum') datum++
      else if (g.art === 'zahl') {
        zahl++
        if (g.euro) euro++
      }
    }
    // 90 % der gefüllten Zellen entscheiden; einzelne Ausreißer (z. B. „k. A.") bleiben dann leer.
    const typ: FeldTyp = n > 0 && datum >= n * 0.9 ? 'datum' : n > 0 && zahl >= n * 0.9 ? 'zahl' : 'text'
    felder.push({ id: `s${i}`, label: s.name, typ, ...(typ === 'zahl' && (EURO_KOPF.test(s.name) || euro >= zahl * 0.5) ? { euro: true } : {}) })
  })

  const daten: Datensatz[] = roh.map((zeile) => {
    const d: Datensatz = {}
    felder.forEach((f, i) => {
      const g = zeile[i]
      if (!g) d[f.id] = null
      else if (f.typ === 'datum') d[f.id] = g.art === 'datum' ? g.iso : null
      else if (f.typ === 'zahl') d[f.id] = g.art === 'zahl' ? g.n : null
      else d[f.id] = alsText(g)
    })
    return d
  })

  return { blatt: name, kopfZeile: kopf + 1, felder, daten }
}

/** Liest alle Tabellenblätter mit Inhalt. Bei einer CSV-Datei gibt es genau eines (benannt nach der Datei). */
export function leseTabellenDatei(buffer: ArrayBuffer, dateiname: string): GeleseneTabelle[] {
  const wb = leseArbeitsmappe(buffer, dateiname)
  const date1904 = !!wb.Workbook?.WBProps?.date1904
  const csv = istCsv(dateiname, buffer)
  const aus: GeleseneTabelle[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const t = leseBlatt(csv ? dateiname : name, ws, date1904)
    if (t && t.felder.length) aus.push(t)
  }
  return aus
}
