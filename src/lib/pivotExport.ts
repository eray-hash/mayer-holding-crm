// Excel-Datei zu einer Auswertung: Blatt „Auswertung" mit der Kreuztabelle wie angezeigt (samt Summen)
// und einer kurzen Kopfzeile (Quelle, Filter, Datum), Blatt „Daten" mit den gefilterten Datensätzen und
// Autofilter. Die freie Ausgabe der Bibliothek „xlsx" kann keine echte Excel-Pivottabelle anlegen — die
// lässt sich in Excel aus dem Blatt „Daten" über Einfügen → PivotTable bauen.

import { utils, write } from 'xlsx'
import type { CellObject, WorkBook, WorkSheet } from 'xlsx'
import { aggregatWert, alsIsoDatum, ergebnisInEuro, wahlBeschriftung, wertBeschriftung, zellenSchluessel } from './pivot'
import type { Datensatz, Einstellung, Feld, PivotErgebnis } from './pivot'

const EURO_FORMAT = '#,##0.00 "€";-#,##0.00 "€"'
const ZAHL_FORMAT = '#,##0.##'
const GANZ_FORMAT = '#,##0'
const DATUM_FORMAT = 'dd.mm.yyyy'

function serienzahl(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000
}

function zahlZelle(n: number | null, format: string): CellObject {
  if (n === null || !Number.isFinite(n)) return { t: 's', v: '' }
  return { t: 'n', v: n, z: format }
}

function textZelle(s: string): CellObject {
  return { t: 's', v: s }
}

function blattAus(zeilen: CellObject[][]): WorkSheet {
  const ws: WorkSheet = {}
  let maxC = 0
  zeilen.forEach((zeile, r) => {
    zeile.forEach((zelle, c) => {
      if (zelle.t === 's' && zelle.v === '') return
      ws[utils.encode_cell({ r, c })] = zelle
      if (c > maxC) maxC = c
    })
  })
  ws['!ref'] = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, zeilen.length - 1), c: maxC } })
  return ws
}

function spaltenBreiten(zeilen: CellObject[][], ab = 0): { wch: number }[] {
  const breiten: number[] = []
  zeilen.slice(ab).forEach((zeile) =>
    zeile.forEach((z, c) => {
      const len = z.t === 'n' ? 14 : String(z.v ?? '').length + 2
      breiten[c] = Math.min(50, Math.max(breiten[c] ?? 8, len))
    }),
  )
  return breiten.map((wch) => ({ wch }))
}

export type ExportAngaben = {
  quelle: string
  felder: Feld[]
  einstellung: Einstellung
  ergebnis: PivotErgebnis
  /** Beschreibung der Filter und des Zeitraums in Worten (leer = keine). */
  filterText: string
  /** Felder für das Blatt „Daten" in dieser Reihenfolge. */
  datenFelder: Feld[]
  erstellt: Date
}

export function baueAuswertungsMappe(a: ExportAngaben): WorkBook {
  const { felder, einstellung: e, ergebnis: erg } = a
  const euro = ergebnisInEuro(e, felder)
  const format = euro ? EURO_FORMAT : e.berechnung === 'anzahl' ? GANZ_FORMAT : ZAHL_FORMAT
  const wert = (agg: Parameters<typeof aggregatWert>[0]) => zahlZelle(aggregatWert(agg, e.berechnung), format)
  const zeilenFelder = e.zeilen.length ? e.zeilen.map((w) => wahlBeschriftung(w, felder)) : ['']
  const datum = a.erstellt.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  // ── Blatt „Auswertung" ──
  const kopf: CellObject[][] = [
    [textZelle(`Auswertung: ${a.quelle} – ${wertBeschriftung(e, felder)}`)],
    [textZelle(`Filter: ${a.filterText || 'keine'}`)],
    [textZelle(`Stand: ${datum} · ${erg.datensaetze.length.toLocaleString('de-DE')} ${erg.datensaetze.length === 1 ? 'Datensatz' : 'Datensätze'}`)],
    [],
  ]
  const tabelle: CellObject[][] = []
  const spaltenTitel = e.spalten.length ? wahlBeschriftung(e.spalten[0], felder) : ''
  if (e.spalten.length) tabelle.push([...zeilenFelder.map(() => textZelle('')), textZelle(spaltenTitel)])
  tabelle.push([
    ...zeilenFelder.map(textZelle),
    ...erg.spalten.map((s) => textZelle(s.teile.join(' / '))),
    textZelle(e.spalten.length ? 'Gesamt' : wertBeschriftung(e, felder)),
  ])
  for (const z of erg.zeilen) {
    tabelle.push([
      ...z.teile.map(textZelle),
      ...erg.spalten.map((s) => wert(erg.zellen.get(zellenSchluessel(z.schluessel, s.schluessel)))),
      wert(erg.zeilenSumme.get(z.schluessel)),
    ])
  }
  tabelle.push([
    textZelle('Gesamt'),
    ...zeilenFelder.slice(1).map(() => textZelle('')),
    ...erg.spalten.map((s) => wert(erg.spaltenSumme.get(s.schluessel))),
    wert(erg.datensaetze.length ? erg.gesamt : undefined),
  ])
  const auswertung = blattAus([...kopf, ...tabelle])
  auswertung['!cols'] = spaltenBreiten(tabelle)

  // ── Blatt „Daten" ──
  const daten: CellObject[][] = [a.datenFelder.map((f) => textZelle(f.label))]
  for (const d of erg.datensaetze) daten.push(a.datenFelder.map((f) => datenZelle(d, f)))
  const datenBlatt = blattAus(daten)
  datenBlatt['!cols'] = spaltenBreiten(daten.slice(0, 200))
  if (a.datenFelder.length) {
    datenBlatt['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, daten.length - 1), c: a.datenFelder.length - 1 } }) }
  }

  const wb = utils.book_new()
  utils.book_append_sheet(wb, auswertung, 'Auswertung')
  utils.book_append_sheet(wb, datenBlatt, 'Daten')
  return wb
}

function datenZelle(d: Datensatz, f: Feld): CellObject {
  const v = d[f.id]
  if (v === null || v === undefined || v === '') return textZelle('')
  if (f.typ === 'datum') {
    const iso = alsIsoDatum(v)
    return iso ? { t: 'n', v: serienzahl(iso), z: DATUM_FORMAT } : textZelle(String(v))
  }
  if (f.typ === 'zahl') return typeof v === 'number' && Number.isFinite(v) ? { t: 'n', v, z: f.euro ? EURO_FORMAT : ZAHL_FORMAT } : textZelle(String(v))
  if (f.typ === 'jaNein') return textZelle(v === true || String(v).toLowerCase() === 'ja' ? 'Ja' : 'Nein')
  return textZelle(String(v))
}

/** Die Mappe als Datei-Inhalt (xlsx). */
export function mappeAlsBytes(wb: WorkBook): Uint8Array {
  return new Uint8Array(write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer)
}

/** Startet im Browser das Herunterladen der Datei. */
export function ladeMappeHerunter(wb: WorkBook, dateiname: string): void {
  const bytes = mappeAlsBytes(wb)
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = dateiname
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
