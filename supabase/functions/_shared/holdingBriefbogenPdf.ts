// Server-Seite des Holding-Briefbogens (pdf-lib): Maler für eine PDF-Seite und ein fertiges Hintergrund-PDF
// (Seite 1 = erste Seite mit Team-Spalte, Seite 2 = Folgeseite), das wie ein eigener Briefbogen unter Text gelegt wird.
// Inhalt und Maße: holdingBriefbogen.ts.

import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { base64ZuBytes, HOLDING_LOGO_JPG_BASE64, HOLDING_RAENDER, type Maler, PT, type Schrift, zeichneHoldingBriefbogen } from './holdingBriefbogen.ts'

export type HoldingSchriften = Record<Schrift, PDFFont>

export async function holdingSchriften(doc: PDFDocument): Promise<HoldingSchriften> {
  return {
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifFett: await doc.embedFont(StandardFonts.TimesRomanBold),
    sans: await doc.embedFont(StandardFonts.Helvetica),
  }
}

const MM = 72 / 25.4

export function pdfMaler(seite: PDFPage, schriften: HoldingSchriften, logo: PDFImage): Maler {
  const hoehe = seite.getHeight()
  return {
    text(text, xMm, yMm, o) {
      const f = schriften[o.schrift]
      const w = f.widthOfTextAtSize(text, o.groesse)
      let x = xMm * MM
      if (o.ausrichtung === 'mitte') x -= w / 2
      if (o.ausrichtung === 'rechts') x -= w
      seite.drawText(text, { x, y: hoehe - yMm * MM, size: o.groesse, font: f, color: rgb(0, 0, 0) })
    },
    breite: (text, groesse, schrift) => schriften[schrift].widthOfTextAtSize(text, groesse),
    logo(xMm, yMm, bMm, hMm) {
      seite.drawImage(logo, { x: xMm * MM, y: hoehe - (yMm + hMm) * MM, width: bMm * MM, height: hMm * MM })
    },
  }
}

let zwischenspeicher: Uint8Array | null = null

/** Zweiseitiges PDF: Seite 1 erste Seite, Seite 2 Folgeseite — als Hintergrund für Briefe, Rechnungen, Merkblätter. */
export async function holdingBriefbogenPdf(): Promise<Uint8Array> {
  if (zwischenspeicher) return zwischenspeicher
  const doc = await PDFDocument.create()
  const schriften = await holdingSchriften(doc)
  const logo = await doc.embedJpg(base64ZuBytes(HOLDING_LOGO_JPG_BASE64))
  for (const art of ['erste', 'folge'] as const) {
    const seite = doc.addPage([595.28, 841.89])
    zeichneHoldingBriefbogen(pdfMaler(seite, schriften, logo), art)
  }
  doc.setTitle('Briefbogen Andreas Mayer Holding')
  zwischenspeicher = await doc.save()
  return zwischenspeicher
}

/** Ränder in mm im Format der eigenen Briefbögen (briefbogen.ts / dokumentErstellen.ts). */
export const HOLDING_HINTERGRUND_RAENDER = {
  links: HOLDING_RAENDER.links,
  rechts: HOLDING_RAENDER.rechts,
  unten: HOLDING_RAENDER.unten,
  anschriftOben: HOLDING_RAENDER.obenErste,
  folgeseiteOben: HOLDING_RAENDER.obenFolge,
}

export { PT }
