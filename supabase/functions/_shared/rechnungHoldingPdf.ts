// Rechnung als PDF auf dem echten Briefbogen der Holding (24.11.2026, Server/pdf-lib) — für das Telegram-Werkzeug
// rechnung_erstellen. Hintergrund: holdingBriefbogenPdf() (Seite 1 mit Team-Spalte, Folgeseite ohne), als Seite
// eingebettet; der Text steht im Satzspiegel HOLDING_RAENDER (rechts bis 148 mm, die Team-Spalte beginnt bei 153,9 mm;
// unten bis 267 mm, darunter die Fußzeile mit Bank, Steuernummer, Amtsgericht und Geschäftsführer).
//
// Inhalt wie die Rechnung im CRM (src/lib/rechnungPdf.ts, § 14 UStG): Empfänger im Anschriftfeld, Ort und Datum,
// Rechnungsnummer, Rechnungsdatum, Leistungsdatum/-zeitraum, Zahlungsziel, Positionen, netto, Umsatzsteuer, brutto,
// Zahlungsaufforderung mit Bankverbindung, Hinweis, Gruß mit dem Namen des Mitarbeiters.
//
// Jede gesetzte Zeichenkette kann in `protokoll` mitgeschrieben werden (Seite, x von/bis, y in mm) — so prüft der Test,
// dass nichts in die Team-Spalte oder die Fußzeile ragt.

import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { HOLDING_ANGABEN, HOLDING_RAENDER } from './holdingBriefbogen.ts'
import { holdingBriefbogenPdf } from './holdingBriefbogenPdf.ts'
import { deDatum, einheitAnzeige, leistungBeschriftung, rundeCent, summeAusPositionen, zahl } from './rechnungAusstellenKern.ts'

export type RechnungPdfDaten = {
  nummer: string
  datum: string
  zahlungsziel: string
  /** Text; leer = „entspricht dem Rechnungsdatum“. */
  leistungszeitraum?: string
  /** Firma, Ansprechpartner, Straße, PLZ Ort — eine Zeile je Angabe. */
  empfaenger: string[]
  positionen: { bezeichnung: string; menge: number; einheit: string; einzelpreis: number }[]
  ustSatz: number
  anrede?: string
  /** Eigener Text vor der Aufstellung; leer = Standardsatz. */
  anschreiben?: string
  /** Zusatz auf der Rechnung (z. B. Grund für 0 % Umsatzsteuer). */
  hinweis?: string
  /** Name unter dem Gruß. */
  absender: string
}

export type Platzierung = { seite: number; x1: number; x2: number; y: number; text: string }

const MM = 72 / 25.4
const SEITE_B = 210
const SEITE_H = 297
const L = HOLDING_RAENDER.links // 21,5 mm
const R = SEITE_B - HOLDING_RAENDER.rechts // 148 mm (auf allen Seiten gleich, damit die Tabelle nicht springt)
const UNTEN = SEITE_H - HOLDING_RAENDER.unten // 267 mm

// Spalten der Tabelle (mm): rechte Kanten der Zahlen.
const SP = { nr: L, bez: L + 10, menge: R - 49, preis: R - 25, betrag: R - 0.5 }
const BEZ_BREITE = SP.menge - 16 - SP.bez

const SCHWARZ = rgb(0.1, 0.1, 0.1)
const GRAU = rgb(0.38, 0.38, 0.38)
const LINIE = rgb(0.8, 0.8, 0.8)
const KOPF_GRUND = rgb(0.94, 0.94, 0.94)

// € zeichnet die macOS-Vorschau breiter als pdf-lib rechnet (System-Helvetica 744/1000 statt 556/1000) — wie in
// telegram-gateway/dokumentErstellen.ts wird jedes € einzeln gesetzt und mit der größeren Breite weitergerückt.
const EURO_BREITE = 0.744

/** Im Fließtext „EUR“ statt „€“ (sonst steht in manchen Anzeigen eine Lücke hinter dem Zeichen, wie im CRM). */
const euroText = (n: number) => `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} EUR`

export const euroPdf = (n: number) => `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`

/** Nur Zeichen, die die eingebaute Schrift kennt; Pfeile/Striche ersetzt, Unbekanntes weg bzw. „?“. */
function filterFuer(font: PDFFont): (s: string) => string {
  const erlaubt = new Set(font.getCharacterSet())
  const ersatz: Record<string, string> = { '→': '->', '←': '<-', '−': '-', '‐': '-', '‑': '-', '\u00a0': ' ', '\u202f': ' ', '\t': ' ' }
  return (s) => {
    let aus = ''
    for (const z of s) {
      const cp = z.codePointAt(0)!
      if (erlaubt.has(cp)) aus += z
      else if (z in ersatz) aus += ersatz[z]
      else {
        const basis = z.normalize('NFD').replace(/[̀-ͯ]/g, '')
        if (basis && [...basis].every((b) => erlaubt.has(b.codePointAt(0)!))) aus += basis
        else if (/\p{L}|\p{N}/u.test(z)) aus += '?'
      }
    }
    return aus
  }
}

type Stil = { groesse: number; fett?: boolean; farbe?: ReturnType<typeof rgb> }

class Satz {
  seite!: PDFPage
  nr = 0
  y = 0
  seiten: PDFPage[] = []
  private filter: (s: string) => string

  constructor(
    private doc: PDFDocument,
    private normal: PDFFont,
    private fett: PDFFont,
    private hintergrund: { erste: Parameters<PDFPage['drawPage']>[0]; folge: Parameters<PDFPage['drawPage']>[0] },
    private protokoll?: Platzierung[],
  ) {
    this.filter = filterFuer(normal)
    this.neueSeite()
  }

  neueSeite() {
    this.seite = this.doc.addPage([595.28, 841.89])
    this.nr++
    this.seiten.push(this.seite)
    this.seite.drawPage(this.nr === 1 ? this.hintergrund.erste : this.hintergrund.folge, { x: 0, y: 0, width: 595.28, height: 841.89 })
    this.y = this.nr === 1 ? HOLDING_RAENDER.obenErste : HOLDING_RAENDER.obenFolge + 4
  }

  /** Neue Seite, wenn h mm nicht mehr passen. true = umgebrochen. */
  platz(h: number): boolean {
    if (this.y + h > UNTEN) {
      this.neueSeite()
      return true
    }
    return false
  }

  font(s: Stil) {
    return s.fett ? this.fett : this.normal
  }

  sauber(t: string): string {
    return this.filter(t)
  }

  /** Breite in mm (mit der größeren €-Breite). */
  breite(t: string, s: Stil): number {
    const f = this.font(s)
    const text = this.sauber(t)
    const euros = text.split('€').length - 1
    const pt = f.widthOfTextAtSize(text.replaceAll('€', ''), s.groesse) + euros * EURO_BREITE * s.groesse
    return pt / MM
  }

  text(t: string, xMm: number, s: Stil, ausrichtung: 'links' | 'rechts' = 'links', yMm = this.y) {
    const text = this.sauber(t)
    if (!text) return
    const w = this.breite(text, s)
    const x1 = ausrichtung === 'rechts' ? xMm - w : xMm
    const f = this.font(s)
    let cx = x1 * MM
    const yPt = (SEITE_H - yMm) * MM
    for (const stueck of text.split(/(€)/)) {
      if (!stueck) continue
      this.seite.drawText(stueck, { x: cx, y: yPt, size: s.groesse, font: f, color: s.farbe ?? SCHWARZ })
      cx += stueck === '€' ? EURO_BREITE * s.groesse : f.widthOfTextAtSize(stueck, s.groesse)
    }
    this.protokoll?.push({ seite: this.nr, x1, x2: x1 + w, y: yMm, text })
  }

  /** Text in Zeilen bis breiteMm umbrechen (zu lange Wörter hart teilen). */
  umbrechen(t: string, s: Stil, breiteMm: number): string[] {
    const zeilen: string[] = []
    for (const absatz of this.sauber(t).split('\n')) {
      if (!absatz.trim()) {
        zeilen.push('')
        continue
      }
      let akt = ''
      for (const wort of absatz.split(/\s+/).filter(Boolean)) {
        const probe = akt ? `${akt} ${wort}` : wort
        if (this.breite(probe, s) <= breiteMm) {
          akt = probe
          continue
        }
        if (akt) zeilen.push(akt)
        akt = wort
        while (this.breite(akt, s) > breiteMm && akt.length > 1) {
          let n = akt.length - 1
          while (n > 1 && this.breite(akt.slice(0, n), s) > breiteMm) n--
          zeilen.push(akt.slice(0, n))
          akt = akt.slice(n)
        }
      }
      if (akt) zeilen.push(akt)
    }
    return zeilen
  }

  absatz(t: string, s: Stil, zeilenhoehe = s.groesse * 0.46) {
    for (const z of this.umbrechen(t, s, R - L)) {
      this.platz(zeilenhoehe)
      if (z) this.text(z, L, s)
      this.y += zeilenhoehe
    }
  }

  linie(x1: number, x2: number, yMm: number, farbe = LINIE, dicke = 0.5) {
    this.seite.drawLine({ start: { x: x1 * MM, y: (SEITE_H - yMm) * MM }, end: { x: x2 * MM, y: (SEITE_H - yMm) * MM }, thickness: dicke, color: farbe })
  }

  flaeche(x1: number, yOben: number, x2: number, hoehe: number, farbe = KOPF_GRUND) {
    this.seite.drawRectangle({ x: x1 * MM, y: (SEITE_H - yOben - hoehe) * MM, width: (x2 - x1) * MM, height: hoehe * MM, color: farbe })
  }
}

export function standardAnschreiben(): string {
  return 'für unsere Leistungen erlauben wir uns, Ihnen Folgendes in Rechnung zu stellen:'
}

/** Erzeugt die Rechnung auf dem Holding-Briefbogen. */
export async function erzeugeHoldingRechnungPdf(d: RechnungPdfDaten, o: { protokoll?: Platzierung[] } = {}): Promise<{ bytes: Uint8Array; seiten: number; summen: { netto: number; ust: number; brutto: number } }> {
  const doc = await PDFDocument.create()
  const normal = await doc.embedFont(StandardFonts.Helvetica)
  const fett = await doc.embedFont(StandardFonts.HelveticaBold)
  const [erste, folge] = await doc.embedPdf(await holdingBriefbogenPdf(), [0, 1])
  const b = new Satz(doc, normal, fett, { erste, folge }, o.protokoll)
  const s = summeAusPositionen(d.positionen, d.ustSatz)

  // Anschriftfeld (unter der Absenderzeile des Briefbogens)
  const anschrift: Stil = { groesse: 10 }
  for (const z of d.empfaenger.slice(0, 8)) {
    for (const teil of b.umbrechen(z, anschrift, R - L)) {
      b.text(teil, L, anschrift)
      b.y += 4.6
    }
  }
  b.y = Math.max(b.y + 6, HOLDING_RAENDER.obenErste + 32)
  b.text(`${HOLDING_ANGABEN.ort}, ${deDatum(d.datum)}`, R, { groesse: 10, farbe: GRAU }, 'rechts')
  b.y += 11

  b.text('Rechnung', L, { groesse: 16, fett: true })
  b.y += 8
  const leistung = (d.leistungszeitraum ?? '').trim()
  const angaben: [string, string][] = [
    ['Rechnungsnummer', d.nummer],
    ['Rechnungsdatum', deDatum(d.datum)],
    [leistungBeschriftung(leistung), leistung || 'entspricht dem Rechnungsdatum'],
    ['Zahlbar bis', deDatum(d.zahlungsziel)],
  ]
  for (const [label, wert] of angaben) {
    const zeilen = b.umbrechen(wert, { groesse: 9.5, fett: true }, R - L - 40)
    b.text(label, L, { groesse: 9.5, farbe: GRAU })
    zeilen.forEach((z, i) => b.text(z, L + 40, { groesse: 9.5, fett: true }, 'links', b.y + i * 4.4))
    b.y += 4.8 * Math.max(1, zeilen.length)
  }
  b.y += 6

  const text: Stil = { groesse: 10 }
  b.absatz(d.anrede?.trim() || 'Sehr geehrte Damen und Herren,', text)
  b.y += 2
  b.absatz(d.anschreiben?.trim() || standardAnschreiben(), text)
  b.y += 4

  // Tabelle
  const kopf: Stil = { groesse: 8.8, fett: true, farbe: rgb(0.2, 0.2, 0.2) }
  const zeile: Stil = { groesse: 9.3 }
  const tabKopf = () => {
    b.flaeche(L, b.y - 4.6, R, 6.8)
    b.text('Pos.', SP.nr + 0.8, kopf)
    b.text('Leistung', SP.bez, kopf)
    b.text('Menge', SP.menge, kopf, 'rechts')
    b.text('Einzelpreis', SP.preis, kopf, 'rechts')
    b.text('Betrag', SP.betrag, kopf, 'rechts')
    b.y += 7
  }
  b.platz(22)
  tabKopf()
  d.positionen.forEach((p, i) => {
    const bez = b.umbrechen(p.bezeichnung || 'Leistung', zeile, BEZ_BREITE)
    const hoehe = bez.length * 4.3 + 2.4
    if (b.platz(hoehe)) tabKopf()
    b.text(String(i + 1), SP.nr + 1, zeile)
    bez.forEach((z, j) => b.text(z, SP.bez, zeile, 'links', b.y + j * 4.3))
    b.text(`${zahl(p.menge)} ${einheitAnzeige(p.einheit, p.menge)}`, SP.menge, zeile, 'rechts')
    b.text(euroPdf(p.einzelpreis), SP.preis, zeile, 'rechts')
    b.text(euroPdf(rundeCent(p.menge * p.einzelpreis)), SP.betrag, zeile, 'rechts')
    b.y += hoehe
    b.linie(L, R, b.y - 3.1)
  })

  // Summen
  b.platz(26)
  b.y += 3
  const summe = (label: string, wert: string, stil: Stil) => {
    b.text(label, SP.preis, stil, 'rechts')
    b.text(wert, SP.betrag, stil, 'rechts')
  }
  summe('Summe netto', euroPdf(s.netto), { groesse: 9.8 })
  b.y += 5.2
  summe(d.ustSatz ? `zzgl. ${zahl(d.ustSatz)} % Umsatzsteuer` : 'Umsatzsteuer 0 %', euroPdf(s.ust), { groesse: 9.8 })
  b.y += 5.6
  b.linie(SP.preis - 45, R, b.y - 3.6, GRAU, 0.6)
  summe('Rechnungsbetrag', euroPdf(s.brutto), { groesse: 10.5, fett: true })
  b.y += 10

  b.absatz(`Bitte überweisen Sie den Betrag von ${euroText(s.brutto)} ohne Abzug bis zum ${deDatum(d.zahlungsziel)} unter Angabe der Rechnungsnummer ${d.nummer} auf folgendes Konto:`, text)
  b.y += 1.5
  const bank: Stil = { groesse: 9.5 }
  for (const [label, wert] of [
    ['Kontoinhaber', HOLDING_ANGABEN.firma],
    ['IBAN', HOLDING_ANGABEN.iban],
    ['Bank', HOLDING_ANGABEN.bank],
    ['Verwendungszweck', d.nummer],
  ] as const) {
    b.platz(4.8)
    b.text(label, L, { ...bank, farbe: GRAU })
    b.text(wert, L + 40, { ...bank, fett: label === 'IBAN' || label === 'Verwendungszweck' })
    b.y += 4.6
  }
  if (d.hinweis?.trim()) {
    b.y += 3
    b.absatz(d.hinweis.trim(), { groesse: 9.5, farbe: GRAU })
  }
  b.y += 4
  b.absatz('Vielen Dank für Ihren Auftrag und die gute Zusammenarbeit.', text)
  b.y += 4
  b.platz(24)
  b.absatz('Mit freundlichen Grüßen', text)
  b.y += 10
  b.absatz(d.absender.trim() || HOLDING_ANGABEN.geschaeftsfuehrer, text)
  b.absatz(HOLDING_ANGABEN.firma, { groesse: 9.5, farbe: GRAU })

  // Seitenzahlen auf Folgeseiten (rechts neben der Absenderzeile des Briefbogens) und unten auf Seite 1, wenn es mehr gibt.
  const n = b.seiten.length
  if (n > 1) {
    b.seiten.forEach((seite, i) => {
      b.seite = seite
      b.nr = i + 1
      const stil = { groesse: 7.5, farbe: GRAU }
      if (i === 0) b.text(`Seite 1 von ${n}`, R, stil, 'rechts', UNTEN + 2.5)
      else b.text(`Rechnung ${d.nummer} · Seite ${i + 1} von ${n}`, SEITE_B - HOLDING_RAENDER.rechtsFolge, stil, 'rechts', 48.5)
    })
  }

  doc.setTitle(`Rechnung ${d.nummer}`)
  doc.setAuthor(HOLDING_ANGABEN.firma)
  doc.setCreator('Mayer Holding CRM')
  return { bytes: await doc.save(), seiten: n, summen: s }
}

export const RECHNUNG_SATZSPIEGEL = { links: L, rechts: R, unten: UNTEN }
