// Der echte Briefbogen der Andreas Mayer Holding / Ulmer Wirtschaftskanzlei für Browser-PDFs (jsPDF).
// Inhalt und Maße kommen aus supabase/functions/_shared/holdingBriefbogen.ts (eine Quelle für Server und
// Browser) — hier steht nur der „Maler“ für jsPDF und Hilfen für die Generatoren in src/lib/*Pdf.ts.
//
// So benutzt man ihn (Dokument in mm):
//  - Text nur im Satzspiegel setzen: holdingSatzspiegel(doc) — Seite 1 rechts nur bis 148 mm (dort beginnt
//    die Team-Spalte), Folgeseiten bis 188 mm; oben ab 53 bzw. 54 mm, unten bis 267 mm (darunter die Fußzeile).
//  - Am Ende holdingAlleSeiten(doc, 'Rechnung RE-…') aufrufen: zeichnet auf Seite 1 den Briefbogen mit
//    Team-Spalte, auf allen weiteren Seiten den Folge-Briefbogen (Logo, Absenderzeile, Fußzeile) und
//    rechts oben „Rechnung RE-… · Seite 2 von 3“.
import type { jsPDF } from 'jspdf'
import type { Briefkopf } from '../data/briefkopf'
import {
  HOLDING_ABSENDERZEILE,
  HOLDING_ANGABEN,
  HOLDING_FUSS,
  HOLDING_LOGO_JPG_BASE64,
  HOLDING_RAENDER,
  HOLDING_TEAM,
  type Maler,
  type Schrift,
  zeichneHoldingBriefbogen,
} from '../../supabase/functions/_shared/holdingBriefbogen.ts'

export { HOLDING_ANGABEN, HOLDING_RAENDER }

const SCHRIFTEN: Record<Schrift, [string, 'normal' | 'bold']> = {
  serif: ['times', 'normal'],
  serifFett: ['times', 'bold'],
  sans: ['helvetica', 'normal'],
}
const AUSRICHTUNG = { links: 'left', mitte: 'center', rechts: 'right' } as const

/** Millimeter in die Einheit des Dokuments (bei unit 'mm' genau 1). */
function mmFaktor(doc: jsPDF): number {
  return 72 / 25.4 / doc.internal.scaleFactor
}

/** Maler für die aktuelle Seite eines jsPDF-Dokuments (beliebige Einheit). */
export function jspdfMaler(doc: jsPDF): Maler {
  const f = mmFaktor(doc)
  const setze = (schrift: Schrift, groesse: number) => {
    const [familie, stil] = SCHRIFTEN[schrift]
    doc.setFont(familie, stil)
    doc.setFontSize(groesse)
  }
  return {
    text(text, xMm, yMm, o) {
      setze(o.schrift, o.groesse)
      doc.setTextColor(0)
      doc.text(text, xMm * f, yMm * f, { align: AUSRICHTUNG[o.ausrichtung ?? 'links'], baseline: 'alphabetic' })
    },
    breite(text, groesse, schrift) {
      setze(schrift, groesse)
      // getTextWidth liefert Dokument-Einheiten; mal scaleFactor ergibt Punkt.
      return doc.getTextWidth(text) * doc.internal.scaleFactor
    },
    logo(xMm, yMm, bMm, hMm) {
      // Gleicher Alias auf allen Seiten: das Bild steckt nur einmal in der Datei.
      doc.addImage(HOLDING_LOGO_JPG_BASE64, 'JPEG', xMm * f, yMm * f, bMm * f, hMm * f, 'holding-logo', 'FAST')
    },
  }
}

/** Schrift, Größe und Farbe merken und nach dem Zeichnen des Briefbogens zurücksetzen. */
function mitGesichertemZustand(doc: jsPDF, zeichnen: () => void) {
  const schrift = doc.getFont()
  const groesse = doc.getFontSize()
  const farbe = doc.getTextColor()
  zeichnen()
  doc.setFont(schrift.fontName, schrift.fontStyle)
  doc.setFontSize(groesse)
  doc.setTextColor(farbe)
}

/** Zeichnet den Holding-Briefbogen auf die aktuelle Seite ('erste' mit Team-Spalte, 'folge' ohne). */
export function holdingSeite(doc: jsPDF, art: 'erste' | 'folge'): void {
  mitGesichertemZustand(doc, () => zeichneHoldingBriefbogen(jspdfMaler(doc), art))
}

/** Grundlinie der Kennzeile oben rechts auf Folgeseiten (auf Höhe der Absenderzeile). */
const KENNZEILE_Y = 48.5

/**
 * Zeichnet den Briefbogen auf ALLE Seiten (Seite 1 'erste', sonst 'folge') — am Ende aufrufen, wenn der
 * Inhalt fertig gesetzt ist; automatische Seitenumbrüche sind damit abgedeckt. Bei mehreren Seiten steht
 * auf den Folgeseiten rechts oben „<kennung> · Seite n von m“ (auf Seite 1 ist rechts die Team-Spalte).
 */
export function holdingAlleSeiten(doc: jsPDF, kennung = ''): void {
  const seiten = doc.getNumberOfPages()
  const f = mmFaktor(doc)
  const breiteMm = doc.internal.pageSize.getWidth() / f
  for (let i = 1; i <= seiten; i++) {
    doc.setPage(i)
    holdingSeite(doc, i === 1 ? 'erste' : 'folge')
    if (i > 1) {
      mitGesichertemZustand(doc, () => {
        const text = [kennung.trim(), `Seite ${i} von ${seiten}`].filter(Boolean).join(' · ')
        jspdfMaler(doc).text(text, breiteMm - HOLDING_RAENDER.rechtsFolge, KENNZEILE_Y, { groesse: 7.5, schrift: 'serif', ausrichtung: 'rechts' })
      })
    }
  }
  doc.setPage(seiten)
}

export type HoldingSatzspiegel = { links: number; rechtsErste: number; rechtsFolge: number; obenErste: number; obenFolge: number; unten: number }

/** Satzspiegel in mm (vom Blattrand): wo Inhalt stehen darf, ohne Team-Spalte, Logo oder Fußzeile zu berühren. */
export function holdingSatzspiegel(doc: jsPDF): HoldingSatzspiegel {
  const f = mmFaktor(doc)
  const breite = doc.internal.pageSize.getWidth() / f
  const hoehe = doc.internal.pageSize.getHeight() / f
  return {
    links: HOLDING_RAENDER.links,
    /** Rechte Textgrenze auf Seite 1 (148 mm bei A4). */
    rechtsErste: breite - HOLDING_RAENDER.rechts,
    /** Rechte Textgrenze auf Folgeseiten (188 mm bei A4). */
    rechtsFolge: breite - HOLDING_RAENDER.rechtsFolge,
    obenErste: HOLDING_RAENDER.obenErste,
    obenFolge: HOLDING_RAENDER.obenFolge,
    /** Tiefste Grundlinie für Inhalt (267 mm bei A4). */
    unten: hoehe - HOLDING_RAENDER.unten,
  }
}

/**
 * Die Angaben des Holding-Briefbogens im Format des alten Briefkopfs (data/briefkopf.ts) — für die
 * Vorlagen-Stile in vorlagePdf.ts, die ihr gescanntes Original nachbilden (Rahmen-Leiste, Kooperation …)
 * und dafür Team, Absenderzeile und Fußzeile brauchen. So kommen auch dort alle Angaben aus einer Quelle.
 */
export const HOLDING_BRIEFKOPF: Briefkopf = {
  name: 'Andreas Mayer Holding',
  unterzeilen: [HOLDING_ABSENDERZEILE.replace(/\s{2,}/, ' · ')],
  seitenleiste: [{ titel: 'Ulmer Wirtschaftskanzlei', zeilen: [] }, ...HOLDING_TEAM.map((p) => ({ titel: p.name, zeilen: p.zeilen }))],
  // Je Spalte der Fußzeile eine Zeile, Einträge mit „ · “ getrennt (vorlagePdf.ts teilt sie wieder in drei Spalten).
  fusszeilen: [0, 1, 2].map((s) => HOLDING_FUSS.map((z) => z[s]).filter(Boolean).join(' · ')),
}
