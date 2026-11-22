// Kontoauszug als CSV-Datei (Umsatz-Export der Bank) lesen — ohne KI, im Browser und auf dem Server
// (22.11.2026, für den Zahlungsabgleich, siehe zahlungsAbgleich.ts). Erkennt die üblichen deutschen
// Exporte (Sparkasse, Volksbank/Raiffeisen, DKB, ING, Commerzbank, Deutsche Bank, Postbank …) an den
// Spaltennamen: Trennzeichen ; , oder Tab, Vorspann-Zeilen vor der Kopfzeile, Betrag mit Vorzeichen,
// mit Soll/Haben-Kennzeichen oder in getrennten Soll- und Haben-Spalten.

import type { AbgleichBuchung } from './zahlungsAbgleich.ts'

export type CsvErgebnis = { buchungen: AbgleichBuchung[]; fehler?: string; iban?: string | null; von?: string | null; bis?: string | null }

/** Bytes als Text: UTF-8, sonst Windows-1252 (ältere Sparkassen-Exporte). */
export function dekodiereText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '')
  try {
    return new TextDecoder('windows-1252').decode(bytes)
  } catch {
    return utf8
  }
}

/** Zerlegt CSV-Text in Zeilen und Felder (Anführungszeichen, verdoppelte Anführungszeichen, Umbrüche im Feld). */
export function zerlegeCsv(text: string, trenner: string): string[][] {
  const zeilen: string[][] = []
  let feld = ''
  let zeile: string[] = []
  let inAnf = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inAnf) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          feld += '"'
          i++
        } else inAnf = false
      } else feld += c
      continue
    }
    if (c === '"') inAnf = true
    else if (c === trenner) {
      zeile.push(feld)
      feld = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      zeile.push(feld)
      zeilen.push(zeile)
      zeile = []
      feld = ''
    } else feld += c
  }
  if (feld !== '' || zeile.length) {
    zeile.push(feld)
    zeilen.push(zeile)
  }
  return zeilen.map((z) => z.map((f) => f.trim()))
}

function erkenneTrenner(text: string): string {
  const probe = text.split(/\r?\n/).slice(0, 40)
  let best = ';'
  let bestWert = -1
  for (const t of [';', '\t', ',']) {
    const anzahl = probe.map((z) => z.split(t).length - 1).filter((n) => n > 0)
    if (!anzahl.length) continue
    // Häufigste Anzahl × wie oft sie vorkommt
    const haeufig = new Map<number, number>()
    for (const n of anzahl) haeufig.set(n, (haeufig.get(n) ?? 0) + 1)
    const [n, wie] = [...haeufig.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
    const wert = wie * Math.min(n, 20)
    if (wert > bestWert) {
      bestWert = wert
      best = t
    }
  }
  return best
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\*in\b/g, '')
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim()
}

/** Betrag aus deutschem oder englischem Zahlformat: „1.234,56“, „-12,50“, „1.234,56-“, „99.90“, „+3.000,00“. */
export function zahlAusCsv(wert: string): number | null {
  let s = String(wert ?? '').replace(/\s|€|eur/gi, '')
  if (!s) return null
  let vz = 1
  if (/^-|-$/.test(s) || /^\(.*\)$/.test(s)) vz = -1
  s = s.replace(/^[+-]|[+-]$/g, '').replace(/^\(|\)$/g, '')
  if (!/^[\d.,']+$/.test(s)) return null
  s = s.replace(/'/g, '')
  const k = s.lastIndexOf(',')
  const p = s.lastIndexOf('.')
  if (k >= 0 && p >= 0) s = k > p ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (k >= 0) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? vz * (Math.round(n * 100) / 100) : null
}

/** Datum als JJJJ-MM-TT aus „31.12.2026“, „31.12.26“, „2026-12-31“ oder „31/12/2026“; sonst ''. */
export function datumAusCsv(wert: string): string {
  const s = String(wert ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/)
  if (m) {
    const jahr = m[3].length === 2 ? `20${m[3]}` : m[3]
    const monat = Number(m[2])
    const tag = Number(m[1])
    if (monat < 1 || monat > 12 || tag < 1 || tag > 31) return ''
    return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
  }
  return ''
}

type Spalten = {
  datum: number
  betrag: number
  soll: number
  haben: number
  kennzeichen: number
  zweck: number[]
  name: number
  /** Getrennte Spalten für Zahler und Empfänger (DKB, Postbank): je nach Vorzeichen die Gegenseite. */
  zahler: number
  empfaenger: number
  iban: number
}

function findeSpalten(kopf: string[]): Spalten | null {
  const k = kopf.map(norm)
  const finde = (pruefe: (h: string) => boolean) => k.findIndex(pruefe)
  const datum = [
    (h: string) => h === 'buchungstag' || h === 'buchungsdatum' || h === 'buchung',
    (h: string) => h === 'datum' || h.startsWith('buchungstag') || h.startsWith('buchungsdatum'),
    (h: string) => h.includes('valuta') || h.includes('wertstellung') || h === 'booking date' || h === 'date',
  ].map(finde).find((i) => i >= 0) ?? -1
  const betrag = [
    (h: string) => h === 'betrag' || h === 'betrag eur' || h === 'betrag euro' || h === 'umsatz' || h === 'umsatz eur' || h === 'amount',
    (h: string) => (h.startsWith('betrag') || h.startsWith('umsatz')) && !h.includes('waehrung') && !h.includes('ursprung'),
  ].map(finde).find((i) => i >= 0) ?? -1
  const soll = finde((h) => h === 'soll' || h === 'soll eur' || h === 'lastschrift' || h === 'ausgang' || h === 'debit')
  const haben = finde((h) => h === 'haben' || h === 'haben eur' || h === 'gutschrift' || h === 'eingang' || h === 'credit')
  const kennzeichen = finde((h) => h === 'soll/haben' || h === 's/h' || h === 'soll haben' || h === 'soll/haben kennzeichen')
  if (datum < 0 || (betrag < 0 && (soll < 0 || haben < 0))) return null
  const zweck: number[] = []
  k.forEach((h, i) => {
    if (h.startsWith('verwendungszweck') || h.startsWith('vwz') || h === 'vorgang/verwendungszweck' || h === 'beschreibung' || h === 'umsatztext' || h === 'text' || h === 'buchungsdetails') zweck.push(i)
  })
  k.forEach((h, i) => {
    if ((h.includes('kundenreferenz') || h.includes('end to end') || h.includes('end-to-end') || h === 'referenz') && !zweck.includes(i)) zweck.push(i)
  })
  const typ = finde((h) => h === 'buchungstext' || h === 'umsatzart' || h === 'vorgang' || h === 'transaktionstyp')
  if (typ >= 0 && !zweck.includes(typ)) zweck.push(typ)
  const keinKonto = (h: string) => !h.includes('iban') && !h.includes('bic') && !h.includes('kontonummer') && !h.includes('bank') && !h.includes('auftragskonto')
  const name = [
    (h: string) => keinKonto(h) && (h.includes('beguenstigter/zahlungspflichtiger') || h.includes('zahlungsbeteiligter') || h.includes('auftraggeber/') || h.includes('auftraggeber / ') || h.includes('/ auftraggeber') || h.includes('/auftraggeber')),
    (h: string) => keinKonto(h) && (h.includes('zahlungsempfaenger') || h.includes('beguenstigter') || h.includes('auftraggeber') || h.includes('gegenpartei') || h === 'empfaenger' || h === 'name'),
  ].map(finde).find((i) => i >= 0) ?? -1
  const zahler = finde((h) => keinKonto(h) && (h.startsWith('zahlungspflichtig') || h === 'auftraggeber'))
  const empfaenger = finde((h) => keinKonto(h) && (h.startsWith('zahlungsempfaenger') || h === 'empfaenger'))
  const iban = [
    (h: string) => (h.includes('iban') || h.includes('kontonummer')) && (h.includes('zahlungsbeteiligter') || h.includes('beguenstigter') || h.includes('gegen') || h.includes('empfaenger') || h.includes('auftraggeber')),
    (h: string) => (h === 'kontonummer/iban' || h === 'iban' || h === 'kontonummer') && !h.includes('auftragskonto'),
  ].map(finde).find((i) => i >= 0) ?? -1
  return { datum, betrag, soll, haben, kennzeichen, zweck, name, zahler, empfaenger, iban }
}

/** Liest einen Umsatz-Export. Unbekanntes Format → `fehler` mit einem Satz für den Nutzer. */
export function leseKontoCsv(text: string): CsvErgebnis {
  const roh = String(text ?? '').replace(/^﻿/, '')
  if (!roh.trim()) return { buchungen: [], fehler: 'Die Datei ist leer.' }
  const zeilen = zerlegeCsv(roh, erkenneTrenner(roh))
  let kopfIndex = -1
  let spalten: Spalten | null = null
  for (let i = 0; i < Math.min(zeilen.length, 40); i++) {
    const s = findeSpalten(zeilen[i])
    if (s) {
      kopfIndex = i
      spalten = s
      break
    }
  }
  if (!spalten) return { buchungen: [], fehler: 'In der CSV-Datei wurden keine Spalten für Datum und Betrag gefunden. Bitte den Umsatz-Export der Bank als CSV verwenden (oder den Auszug als PDF).' }
  // IBAN des eigenen Kontos steht bei manchen Banken im Vorspann („Kontonummer:;DE…“).
  let iban: string | null = null
  for (const z of zeilen.slice(0, kopfIndex)) {
    const treffer = z.join(' ').match(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/)
    if (treffer) {
      iban = treffer[0].replace(/\s/g, '')
      break
    }
  }
  const s = spalten
  const buchungen: AbgleichBuchung[] = []
  let ohneDatum = 0
  zeilen.slice(kopfIndex + 1).forEach((z, i) => {
    if (z.every((f) => !f)) return
    const datum = datumAusCsv(z[s.datum] ?? '')
    if (!datum) {
      ohneDatum++
      return
    }
    let betrag: number | null
    if (s.betrag >= 0) {
      betrag = zahlAusCsv(z[s.betrag] ?? '')
      if (betrag !== null && s.kennzeichen >= 0) {
        const kz = String(z[s.kennzeichen] ?? '').trim().toUpperCase()
        if (kz.startsWith('S') || kz === 'D' || kz === 'DEBIT') betrag = -Math.abs(betrag)
        else if (kz.startsWith('H') || kz === 'C' || kz === 'CREDIT') betrag = Math.abs(betrag)
      }
    } else {
      const so = zahlAusCsv(z[s.soll] ?? '') ?? 0
      const ha = zahlAusCsv(z[s.haben] ?? '') ?? 0
      betrag = Math.round((Math.abs(ha) - Math.abs(so)) * 100) / 100
    }
    if (betrag === null || betrag === 0) return
    const zweck = s.zweck.map((j) => z[j] ?? '').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    buchungen.push({
      id: `csv_${kopfIndex + 2 + i}`,
      datum,
      betrag,
      verwendungszweck: zweck.slice(0, 500),
      gegenName: (s.zahler >= 0 && s.empfaenger >= 0 && s.zahler !== s.empfaenger ? z[betrag > 0 ? s.zahler : s.empfaenger] : s.name >= 0 ? z[s.name] : '') || null,
      gegenIban: s.iban >= 0 ? (String(z[s.iban] ?? '').replace(/\s/g, '') || null) : null,
    })
  })
  if (!buchungen.length) return { buchungen, fehler: ohneDatum ? 'In der CSV-Datei wurden keine lesbaren Buchungen gefunden (Datum nicht erkannt).' : 'In der CSV-Datei stehen keine Buchungen.' }
  const daten = buchungen.map((b) => b.datum).sort()
  return { buchungen, iban, von: daten[0], bis: daten[daten.length - 1] }
}
