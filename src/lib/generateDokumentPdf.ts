import jsPDF from 'jspdf'
import { holdingAlleSeiten, holdingSatzspiegel } from './holdingBriefbogenJspdf'

// Erzeugt ein einfaches, aber vollständiges PDF aus einem öffentlich ausgefüllten Formular (Titel,
// Kontext-Absatz, ausgefüllte Felder, rechtlicher Erläuterungstext, Signatur) — wird gebraucht,
// damit eine automatisiert an eine Behörde verschickte Vollmacht nicht nur die isolierte
// Unterschrift enthält (die für sich allein nutzlos/nicht nachvollziehbar ist), sondern das
// komplette, lesbare Dokument samt Signatur in einer Datei.
// Seit 24.11.2026 auf dem echten Briefbogen der Andreas Mayer Holding / Ulmer Wirtschaftskanzlei
// (holdingBriefbogenJspdf.ts) und mit Seitenumbruch, falls der Wortlaut länger als eine Seite ist.
export type DokumentFeld = { label: string; value: string }

/** Nur Zeichen, die die eingebaute Helvetica kennt (wie vorlagePdf.ts). */
function sicher(text: string): string {
  return text
    .replace(/[→➜➤]/g, '->')
    .replace(/[✓✔]/g, 'x')
    .replace(/[  ]/g, ' ')
    .replace(/[^\u0000-ÿ€–—‘’‚“”„•…]/g, '?')
}

export function generateDokumentPdf(params: {
  titel: string
  absatzVorFeldern?: string
  felder?: DokumentFeld[]
  erlaeuterung?: string
  signaturDataUrl: string
  ort: string
  datum: string
}): { base64: string; dataUrl: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const satz = holdingSatzspiegel(doc)
  const L = satz.links
  let seite = 1
  let y = satz.obenErste
  // Auf Seite 1 steht rechts die Team-Spalte des Briefbogens; der Text bleibt links davon.
  const breite = () => (seite === 1 ? satz.rechtsErste : satz.rechtsFolge) - L
  const platz = (h: number) => {
    if (y + h > satz.unten) {
      doc.addPage()
      seite++
      y = satz.obenFolge
    }
  }
  const absatz = (text: string, groesse: number, zeile: number) => {
    doc.setFontSize(groesse)
    for (const roh of text.split('\n')) {
      const zeilen = roh.trim() ? (doc.splitTextToSize(sicher(roh), breite()) as string[]) : ['']
      for (const z of zeilen) {
        platz(zeile)
        doc.text(z, L, y)
        y += zeile
      }
    }
  }

  y += 4
  doc.setTextColor(20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  for (const z of doc.splitTextToSize(sicher(params.titel), breite()) as string[]) {
    doc.text(z, L, y)
    y += 7
  }
  y += 3

  doc.setFont('helvetica', 'normal')
  if (params.absatzVorFeldern) {
    absatz(params.absatzVorFeldern, 10, 5)
    y += 6
  }

  if (params.felder?.length) {
    doc.setFontSize(10)
    for (const f of params.felder) {
      const wert = doc.splitTextToSize(sicher(f.value || '–'), breite() - 50) as string[]
      platz(wert.length * 5 + 1)
      doc.setFont('helvetica', 'bold')
      doc.text(sicher(`${f.label}:`), L, y)
      doc.setFont('helvetica', 'normal')
      doc.text(wert, L + 50, y)
      y += wert.length * 5 + 1
    }
    y += 5
  }

  if (params.erlaeuterung) {
    doc.setTextColor(60)
    absatz(params.erlaeuterung, 9, 4.2)
    y += 10
    doc.setTextColor(20)
  }

  // Ort, Datum und Unterschrift bleiben zusammen.
  platz(28)
  doc.setFontSize(10)
  doc.text(sicher(`Ort, Datum: ${params.ort}, ${params.datum}`), L, y)
  y += 6
  doc.text('Unterschrift:', L, y)
  try {
    doc.addImage(params.signaturDataUrl, 'PNG', L + 30, y - 6, 60, 17)
  } catch {
    // Signatur in einem unerwarteten Format -> Dokument trotzdem ohne Bild ausliefern, statt den
    // gesamten Versand scheitern zu lassen.
  }
  y += 14
  doc.setDrawColor(170)
  doc.line(L + 30, y, L + 100, y)

  holdingAlleSeiten(doc, sicher(params.titel))
  const dataUrl = doc.output('datauristring') as string
  return { base64: dataUrl.split(',')[1] ?? '', dataUrl }
}
