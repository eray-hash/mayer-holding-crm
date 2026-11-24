// PDF „Stand Ihres Projekts“ (Statusbericht an den Kunden, 22.11.2026) auf dem echten Briefbogen der
// Andreas Mayer Holding / Ulmer Wirtschaftskanzlei (holdingBriefbogenJspdf.ts, seit 24.11.2026).
// Für private Akten gibt es keinen Kundenbericht (KundenberichtModal.tsx).
import jsPDF from 'jspdf'
import { AMPEL_NAME, deDatum, type KundenAmpel } from '../../supabase/functions/_shared/kundenberichtKern.ts'
import { HOLDING_RAENDER, holdingAlleSeiten, holdingSatzspiegel } from './holdingBriefbogenJspdf'

const L = HOLDING_RAENDER.links

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
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const satz = holdingSatzspiegel(doc)
  let seite = 1
  let y = satz.obenErste
  // Auf Seite 1 steht rechts die Team-Spalte des Briefbogens; der Text bleibt links davon.
  const rechts = () => (seite === 1 ? satz.rechtsErste : satz.rechtsFolge)
  const schrift = (stil: 'normal' | 'bold', groesse: number, grau = 25) => {
    doc.setFont('helvetica', stil)
    doc.setFontSize(groesse)
    doc.setTextColor(grau)
  }
  const platz = (h: number) => {
    if (y + h > satz.unten) {
      doc.addPage()
      seite++
      y = satz.obenFolge
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

  holdingAlleSeiten(doc, sicher(`Stand Ihres Projekts · ${deDatum(a.datum)}`))
  return doc.output('blob')
}
