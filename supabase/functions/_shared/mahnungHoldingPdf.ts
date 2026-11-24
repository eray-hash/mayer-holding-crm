// Zahlungserinnerung / 1. Mahnung / 2. Mahnung als PDF auf dem echten Briefbogen der Holding (24.11.2026, Server/pdf-lib)
// — für die Telegram-Werkzeuge mahnung_erstellen und followup_durchspielen. Hintergrund wie die Rechnung
// (rechnungHoldingPdf.ts): holdingBriefbogenPdf() als eingebettete Seite, Text im Satzspiegel HOLDING_RAENDER.
//
// Aufbau wie erzeugeMahnungPdf im CRM (src/lib/rechnungPdf.ts): Anschrift, Ort und Datum, Stufe als Überschrift,
// „zu Rechnung Nr. … vom …“, Anrede, Text, Aufstellung (Rechnungsbetrag, bereits gezahlt, frühere Gebühren, Gebühr,
// zu zahlender Betrag), „Zahlbar bis spätestens …“, Zahlungsaufforderung mit Bankverbindung (Kontoinhaber nach Vorgabe
// der Geschäftsführung: HOLDING_ANGABEN.kontoinhaber), Schlusstext, Gruß.
//
// `vorschau: true` (followup_durchspielen): diagonales Wasserzeichen „VORSCHAU – nicht versendet“ und ein roter
// Kopfvermerk auf jeder Seite. Solche Dateien gehen nur als Datei in den Telegram-Chat, nie in die Akte.
// Jede gesetzte Zeichenkette kann in `protokoll` mitgeschrieben werden (Test: nichts ragt in Team-Spalte oder Fußzeile).

import { degrees, PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { HOLDING_ANGABEN, HOLDING_RAENDER } from './holdingBriefbogen.ts'
import { holdingBriefbogenPdf } from './holdingBriefbogenPdf.ts'
import type { MahnStufe } from './mahnVorschlagKern.ts'
import { deDatum, euro, euroText, mahnBetraege, mahnstufeName, type MahnRechnungDaten } from './mahnungKern.ts'

export type MahnungPdfDaten = {
  rechnung: MahnRechnungDaten
  stufe: MahnStufe
  /** Datum des Schreibens. */
  datum: string
  neueFrist: string
  gebuehr: number
  empfaenger: string[]
  anrede?: string
  text: string
  schluss: string
  absender: string
  vorschau?: boolean
}

export type Platzierung = { seite: number; x1: number; x2: number; y: number; text: string }

const MM = 72 / 25.4
const SEITE_B = 210
const SEITE_H = 297
const L = HOLDING_RAENDER.links
const R = SEITE_B - HOLDING_RAENDER.rechts // 148 mm, auf allen Seiten gleich
const UNTEN = SEITE_H - HOLDING_RAENDER.unten // 267 mm
const BETRAG_X = R - 0.5
const LABEL_X = R - 27

const SCHWARZ = rgb(0.1, 0.1, 0.1)
const GRAU = rgb(0.38, 0.38, 0.38)
const ROT = rgb(0.78, 0.1, 0.1)
// Wie rechnungHoldingPdf.ts: € zeichnet die macOS-Vorschau breiter, als pdf-lib rechnet.
const EURO_BREITE = 0.744

type Stil = { groesse: number; fett?: boolean; farbe?: ReturnType<typeof rgb> }

function filterFuer(font: PDFFont): (s: string) => string {
  const erlaubt = new Set(font.getCharacterSet())
  const ersatz: Record<string, string> = { '→': '->', '←': '<-', '−': '-', '‐': '-', '‑': '-', ' ': ' ', ' ': ' ', '\t': ' ' }
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

  breite(t: string, s: Stil): number {
    const text = this.filter(t)
    const euros = text.split('€').length - 1
    return (this.font(s).widthOfTextAtSize(text.replaceAll('€', ''), s.groesse) + euros * EURO_BREITE * s.groesse) / MM
  }

  text(t: string, xMm: number, s: Stil, ausrichtung: 'links' | 'rechts' = 'links', yMm = this.y) {
    const text = this.filter(t)
    if (!text) return
    const w = this.breite(text, s)
    const x1 = ausrichtung === 'rechts' ? xMm - w : xMm
    const f = this.font(s)
    let cx = x1 * MM
    for (const stueck of text.split(/(€)/)) {
      if (!stueck) continue
      this.seite.drawText(stueck, { x: cx, y: (SEITE_H - yMm) * MM, size: s.groesse, font: f, color: s.farbe ?? SCHWARZ })
      cx += stueck === '€' ? EURO_BREITE * s.groesse : f.widthOfTextAtSize(stueck, s.groesse)
    }
    this.protokoll?.push({ seite: this.nr, x1, x2: x1 + w, y: yMm, text })
  }

  umbrechen(t: string, s: Stil, breiteMm: number): string[] {
    const zeilen: string[] = []
    // Erst an den Zeilenumbrüchen teilen, dann filtern (der Filter kennt „\n“ nicht und würde die Zeilen verkleben).
    for (const roh of t.split('\n')) {
      const absatz = this.filter(roh)
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

  linie(x1: number, x2: number, yMm: number, farbe = GRAU, dicke = 0.6) {
    this.seite.drawLine({ start: { x: x1 * MM, y: (SEITE_H - yMm) * MM }, end: { x: x2 * MM, y: (SEITE_H - yMm) * MM }, thickness: dicke, color: farbe })
  }
}

/** Erzeugt Zahlungserinnerung oder Mahnung auf dem Holding-Briefbogen. */
export async function erzeugeHoldingMahnungPdf(d: MahnungPdfDaten, o: { protokoll?: Platzierung[] } = {}): Promise<{ bytes: Uint8Array; seiten: number; summe: number }> {
  const doc = await PDFDocument.create()
  const normal = await doc.embedFont(StandardFonts.Helvetica)
  const fett = await doc.embedFont(StandardFonts.HelveticaBold)
  const [erste, folge] = await doc.embedPdf(await holdingBriefbogenPdf(), [0, 1])
  const b = new Satz(doc, normal, fett, { erste, folge }, o.protokoll)
  const r = d.rechnung
  const name = mahnstufeName(d.stufe)
  const betraege = mahnBetraege(r, d.gebuehr)
  const text: Stil = { groesse: 10 }

  // Anschriftfeld
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

  b.text(name, L, { groesse: 16, fett: true })
  b.y += 6
  b.text(`zu Rechnung Nr. ${r.nummer} vom ${deDatum(r.datum)}`, L, { groesse: 9.5, farbe: GRAU })
  b.y += 10

  b.absatz(d.anrede?.trim() || 'Sehr geehrte Damen und Herren,', text)
  b.y += 2
  if (d.text.trim()) {
    b.absatz(d.text.trim(), text)
    b.y += 5
  }

  // Aufstellung
  b.platz(36)
  const zeile = (label: string, wert: string, stil: Stil = { groesse: 9.8 }) => {
    b.text(label, LABEL_X, stil, 'rechts')
    b.text(wert, BETRAG_X, stil, 'rechts')
    b.y += 5.3
  }
  zeile(`Rechnungsbetrag (Rechnung ${r.nummer})`, euro(betraege.brutto))
  if (betraege.gezahlt > 0) zeile('abzüglich bereits gezahlt', `– ${euro(betraege.gezahlt)}`)
  if (betraege.fruehere > 0) zeile('Mahngebühren aus früheren Schreiben', euro(betraege.fruehere))
  if (betraege.gebuehr > 0) zeile('Mahngebühr', euro(betraege.gebuehr))
  b.y += 0.6
  b.linie(LABEL_X - 50, R, b.y - 4)
  zeile('Zu zahlender Betrag', euro(betraege.summe), { groesse: 10.5, fett: true })
  b.y += 3
  b.platz(8)
  b.text(`Zahlbar bis spätestens ${deDatum(d.neueFrist)}`, L, { groesse: 10.5, fett: true })
  b.y += 9

  b.absatz(`Bitte überweisen Sie den Betrag von ${euroText(betraege.summe)} unter Angabe der Rechnungsnummer ${r.nummer} auf folgendes Konto:`, text)
  b.y += 1.5
  const bank: Stil = { groesse: 9.5 }
  for (const [label, wert] of [
    ['Kontoinhaber', HOLDING_ANGABEN.kontoinhaber],
    ['IBAN', HOLDING_ANGABEN.iban],
    ['Bank', HOLDING_ANGABEN.bank],
    ['Verwendungszweck', r.nummer],
  ] as const) {
    b.platz(4.8)
    b.text(label, L, { ...bank, farbe: GRAU })
    b.text(wert, L + 40, { ...bank, fett: label === 'IBAN' || label === 'Verwendungszweck' })
    b.y += 4.6
  }
  if (d.schluss.trim()) {
    b.y += 3
    b.absatz(d.schluss.trim(), text)
  }
  b.y += 4
  b.platz(24)
  b.absatz('Mit freundlichen Grüßen', text)
  b.y += 10
  b.absatz(d.absender.trim() || HOLDING_ANGABEN.geschaeftsfuehrer, text)
  b.absatz(HOLDING_ANGABEN.firma, { groesse: 9.5, farbe: GRAU })

  const n = b.seiten.length
  b.seiten.forEach((seite, i) => {
    b.seite = seite
    b.nr = i + 1
    if (n > 1) {
      const stil = { groesse: 7.5, farbe: GRAU }
      if (i === 0) b.text(`Seite 1 von ${n}`, R, stil, 'rechts', UNTEN + 2.5)
      else b.text(`${name} zu Rechnung ${r.nummer} · Seite ${i + 1} von ${n}`, SEITE_B - HOLDING_RAENDER.rechtsFolge, stil, 'rechts', 48.5)
    }
    if (d.vorschau) {
      // Kopfvermerk zwischen Logo und Absenderzeile, dazu das Wasserzeichen quer über die Seite.
      b.text('VORSCHAU – nicht versendet (Durchspielen des Ablaufs, Datum angenommen)', L, { groesse: 8.5, fett: true, farbe: ROT }, 'links', 42.5)
      const wz = 'VORSCHAU – nicht versendet'
      const groesse = 46
      const w = fett.widthOfTextAtSize(wz, groesse)
      // Mitte der Seite; um 45° gedreht beginnt der Text links unten.
      const cx = (SEITE_B / 2) * MM
      const cy = (SEITE_H / 2) * MM
      const k = Math.SQRT1_2
      seite.drawText(wz, { x: cx - (w / 2) * k + (groesse / 3) * k, y: cy - (w / 2) * k - (groesse / 3) * k, size: groesse, font: fett, color: ROT, opacity: 0.13, rotate: degrees(45) })
    }
  })

  doc.setTitle(`${name} zu Rechnung ${r.nummer}${d.vorschau ? ' (Vorschau)' : ''}`)
  doc.setAuthor(HOLDING_ANGABEN.firma)
  doc.setCreator('Mayer Holding CRM')
  return { bytes: await doc.save(), seiten: n, summe: betraege.summe }
}

export const MAHNUNG_SATZSPIEGEL = { links: L, rechts: R, unten: UNTEN }
