import jsPDF from 'jspdf'

// Erzeugt ein einfaches, aber vollständiges PDF aus einem öffentlich ausgefüllten Formular (Titel,
// Kontext-Absatz, ausgefüllte Felder, rechtlicher Erläuterungstext, Signatur) — wird gebraucht,
// damit eine automatisiert an eine Behörde verschickte Vollmacht nicht nur die isolierte
// Unterschrift enthält (die für sich allein nutzlos/nicht nachvollziehbar ist), sondern das
// komplette, lesbare Dokument samt Signatur in einer Datei.
export type DokumentFeld = { label: string; value: string }

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
  const marginLeft = 20
  const pageWidth = doc.internal.pageSize.getWidth()
  const textWidth = pageWidth - marginLeft * 2
  let y = 20

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text('Andreas Mayer Holding · Schwabstrasse 3, 89075 Ulm', marginLeft, y)
  y += 10

  doc.setTextColor(20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(params.titel, marginLeft, y)
  y += 10

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  if (params.absatzVorFeldern) {
    const lines = doc.splitTextToSize(params.absatzVorFeldern, textWidth)
    doc.text(lines, marginLeft, y)
    y += lines.length * 5 + 6
  }

  if (params.felder?.length) {
    for (const f of params.felder) {
      doc.setFont('helvetica', 'bold')
      doc.text(`${f.label}:`, marginLeft, y)
      doc.setFont('helvetica', 'normal')
      doc.text(f.value || '–', marginLeft + 55, y)
      y += 6
    }
    y += 6
  }

  if (params.erlaeuterung) {
    doc.setFontSize(9)
    doc.setTextColor(60)
    const lines = doc.splitTextToSize(params.erlaeuterung, textWidth)
    doc.text(lines, marginLeft, y)
    y += lines.length * 4.2 + 14
    doc.setTextColor(20)
    doc.setFontSize(10)
  }

  doc.text(`Ort, Datum: ${params.ort}, ${params.datum}`, marginLeft, y)
  y += 6
  doc.text('Unterschrift:', marginLeft, y)
  try {
    doc.addImage(params.signaturDataUrl, 'PNG', marginLeft + 30, y - 6, 60, 17)
  } catch {
    // Signatur in einem unerwarteten Format -> Dokument trotzdem ohne Bild ausliefern, statt den
    // gesamten Versand scheitern zu lassen.
  }
  y += 14
  doc.setDrawColor(170)
  doc.line(marginLeft + 30, y, marginLeft + 100, y)

  const dataUrl = doc.output('datauristring') as string
  return { base64: dataUrl.split(',')[1] ?? '', dataUrl }
}
