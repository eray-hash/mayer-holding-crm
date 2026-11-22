// PDF „Stand Ihres Projekts“ (Statusbericht an den Kunden, 22.11.2026) auf dem Briefbogen wie Rechnung
// und Kostenvoranschlag (data/briefkopf.ts: Name, Unterzeilen, Seitenleiste auf Seite 1, Fußzeilen).
// Eigene kleine Fassung des Briefbogens, weil der in rechnungPdf.ts nicht ausgeführt wird.
import jsPDF from 'jspdf'
import { BRIEFKOPF, type Briefkopf } from '../data/briefkopf'
import { AMPEL_NAME, deDatum, type KundenAmpel } from '../../supabase/functions/_shared/kundenberichtKern.ts'

const L = 22
const OBEN = 18
const UNTEN = 26

/** Nur Zeichen, die die eingebaute Helvetica kennt (wie vorlagePdf.ts). */
function sicher(text: string): string {
  return text
    .replace(/[→➜➤]/g, '->')
    .replace(/[✓✔]/g, 'x')
    .replace(/[  ]/g, ' ')
    .replace(/[^\u0000-ÿ€–—‘’‚“”„•…]/g, '?')
}

const FARBE: Record<KundenAmpel, [number, number, number]> = {
  gruen: [16, 150, 72],
  gelb: [234, 179, 8],
  rot: [220, 38, 38],
}

export type KundenberichtPdfAngaben = {
  briefkopf?: Briefkopf
  empfaenger: string[]
  datum: string
  seit: string
  anrede: string
  einleitung: string
  ampel: KundenAmpel
  ampelText: string
  stand: string
  erledigt: string[]
  naechste: string[]
  vonIhnen: string[]
  /** Hochlade-Link (nur wenn etwas fehlt). */
  link?: string
  schluss: string
  gruss: string
}

export function erzeugeKundenberichtPdf(a: KundenberichtPdfAngaben): Blob {
  const kopf = a.briefkopf ?? BRIEFKOPF
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const sb = doc.internal.pageSize.getWidth()
  const sh = doc.internal.pageSize.getHeight()
  const R = sb - 16
  const leiste = kopf.seitenleiste.length > 0 ? 42 : 0
  let seite = 1
  let y = OBEN
  const rechts = () => (seite === 1 && leiste ? R - leiste - 6 : R)
  const schrift = (stil: 'normal' | 'bold', groesse: number, grau = 25) => {
    doc.setFont('helvetica', stil)
    doc.setFontSize(groesse)
    doc.setTextColor(grau)
  }
  const platz = (h: number) => {
    if (y + h > sh - UNTEN) {
      doc.addPage()
      seite++
      y = OBEN + 4
    }
  }

  // Kopf und Seitenleiste
  schrift('bold', 13)
  doc.text(sicher(kopf.name), L, OBEN)
  schrift('normal', 8.5, 90)
  let ky = OBEN + 5
  for (const z of kopf.unterzeilen) {
    doc.text(sicher(z), L, ky)
    ky += 3.8
  }
  doc.setDrawColor(190)
  doc.setLineWidth(0.3)
  doc.line(L, ky + 1, R, ky + 1)
  y = ky + 10
  if (leiste) {
    const lx = R - leiste
    let ly = y
    doc.setDrawColor(215)
    doc.line(lx - 4, ly - 3, lx - 4, sh - UNTEN - 6)
    for (const e of kopf.seitenleiste) {
      if (e.titel) {
        schrift('bold', 7.5, 60)
        doc.text(sicher(e.titel), lx, ly)
        ly += 3.6
      }
      schrift('normal', 6.6, 105)
      for (const z of e.zeilen) {
        for (const t of doc.splitTextToSize(sicher(z), leiste) as string[]) {
          doc.text(t, lx, ly)
          ly += 2.9
        }
      }
      ly += 2.4
    }
  }

  const absatz = (text: string, groesse = 10, stil: 'normal' | 'bold' = 'normal', grau = 25, einzug = 0) => {
    schrift(stil, groesse, grau)
    for (const roh of text.split('\n')) {
      const zeilen = roh.trim() ? (doc.splitTextToSize(sicher(roh), rechts() - L - einzug) as string[]) : ['']
      for (const z of zeilen) {
        platz(5)
        doc.text(z, L + einzug, y)
        y += groesse * 0.5
      }
    }
  }
  const abschnitt = (titel: string, zeilen: string[]) => {
    if (zeilen.length === 0) return
    platz(14)
    y += 3
    absatz(titel, 11, 'bold', 30)
    y += 1
    for (const z of zeilen) {
      schrift('normal', 10)
      platz(5)
      doc.text('•', L + 1, y)
      absatz(z, 10, 'normal', 25, 5)
      y += 0.8
    }
  }

  // Empfänger, Ort und Datum
  schrift('normal', 10)
  for (const z of a.empfaenger.map((x) => x.trim()).filter(Boolean)) {
    doc.text(sicher(z), L, y)
    y += 5
  }
  y += 6
  schrift('normal', 10, 70)
  doc.text(`Ulm, ${deDatum(a.datum)}`, rechts(), y, { align: 'right' })
  y += 9

  schrift('bold', 16)
  doc.text('Stand Ihres Projekts', L, y)
  y += 6
  schrift('normal', 9.5, 90)
  doc.text(sicher(a.seit === a.datum ? `Stand ${deDatum(a.datum)}` : `Zeitraum ${deDatum(a.seit)} bis ${deDatum(a.datum)}`), L, y)
  y += 9

  if (a.anrede.trim()) {
    absatz(a.anrede)
    y += 2
  }
  if (a.einleitung.trim()) {
    absatz(a.einleitung)
    y += 4
  }

  // Ampel
  platz(14)
  const [r, g, b] = FARBE[a.ampel]
  doc.setFillColor(r, g, b)
  doc.circle(L + 2.5, y - 1.3, 2.5, 'F')
  schrift('bold', 10.5, 30)
  doc.text(sicher(`Ampel: ${AMPEL_NAME[a.ampel]}`), L + 8, y)
  schrift('normal', 10, 50)
  const ampelZeilen = doc.splitTextToSize(sicher(a.ampelText), rechts() - L - 40) as string[]
  doc.text(ampelZeilen, L + 36, y)
  y += 5 * Math.max(1, ampelZeilen.length)
  if (a.stand.trim()) absatz(a.stand, 10, 'normal', 50)
  y += 2

  abschnitt('Was seitdem passiert ist', a.erledigt.length ? a.erledigt : ['In diesem Zeitraum gab es keine neuen Schritte, die Sie betreffen.'])
  abschnitt('Die nächsten Schritte', a.naechste)
  abschnitt('Was wir noch von Ihnen brauchen', a.vonIhnen)
  if (a.vonIhnen.length && a.link) {
    y += 1
    absatz('Sie können die Unterlagen über diesen Link hochladen, ohne Anmeldung und auch mit dem Handy:', 9.5, 'normal', 50)
    schrift('normal', 8.5, 25)
    doc.setTextColor(30, 64, 175)
    for (const z of doc.splitTextToSize(a.link, rechts() - L) as string[]) {
      platz(5)
      doc.textWithLink(z, L, y, { url: a.link })
      y += 4.2
    }
    absatz('Der Link ist 60 Tage gültig. Bitte geben Sie ihn nicht weiter.', 8.5, 'normal', 90)
  }

  if (a.schluss.trim()) {
    y += 5
    absatz(a.schluss)
  }
  platz(24)
  y += 5
  absatz('Mit freundlichen Grüßen')
  y += 10
  absatz(a.gruss.trim() || 'Ihr Team der Mayer Holding')

  const seiten = doc.getNumberOfPages()
  for (let i = 1; i <= seiten; i++) {
    doc.setPage(i)
    schrift('normal', 7.2, 120)
    doc.setDrawColor(210)
    doc.line(L, sh - 19, R, sh - 19)
    let fy = sh - 15
    for (const z of kopf.fusszeilen) {
      doc.text(sicher(z), L, fy)
      fy += 3
    }
    doc.text(sicher(`Stand Ihres Projekts · ${deDatum(a.datum)} · Seite ${i} von ${seiten}`), R, sh - 11.5, { align: 'right' })
  }
  return doc.output('blob')
}
