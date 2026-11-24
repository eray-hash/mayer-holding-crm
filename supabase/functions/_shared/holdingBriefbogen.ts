// Der echte Briefbogen der Andreas Mayer Holding / Ulmer Wirtschaftskanzlei — nachgebaut nach der Word-Vorlage
// „Briefbogen AMayer Holding Ulmer Wirtschaftskanzlei 01.09.2026“ (CRM-Vorlage v_ql_8c0d7da428d).
// Maße aus der Vorlage (word/header2.xml, footer2.xml, Textfeld der Team-Spalte in document.xml):
//  - Logo 26,1 mm im Quadrat, links oben (Kopfzeile, 12 mm Kopfabstand);
//  - Absenderzeile „Andreas Mayer Holding Schwabstraße 3, 89075 Ulm“ klein über dem Anschriftfeld;
//  - rechts die Team-Spalte „Ulmer Wirtschaftskanzlei“ (nur auf der ersten Seite, wie im Word-Dokument);
//  - Fußzeile dreispaltig (links / Mitte / rechtsbündig) mit Firma, Bank, Steuernummer, Amtsgericht, GF.
// Schriften: Word nutzt Linux Libertine/Calisto (Serifen) und Calibri; hier Times bzw. Helvetica als Ersatz.
//
// Eine Quelle für alle: Server-PDFs (pdf-lib) und Browser-PDFs (jsPDF) zeichnen über einen „Maler“ dieselben
// Elemente. Neue Dokumente setzen ihren Text in den Bereich HOLDING_RAENDER (mm), dann überlappt nichts.
// Ändert sich der Briefbogen (Team, Adresse, Bank), nur hier ändern.

import { HOLDING_LOGO_JPG_BASE64 } from './holdingLogo.ts'

export { HOLDING_LOGO_JPG_BASE64 }

export type Schrift = 'serif' | 'serifFett' | 'sans'

/** Zeichenfläche in Millimetern, Ursprung oben links; y ist die Grundlinie des Texts. */
export interface Maler {
  text(text: string, xMm: number, yMm: number, o: { groesse: number; schrift: Schrift; ausrichtung?: 'links' | 'mitte' | 'rechts' }): void
  /** Breite in Punkt (pt) bei gegebener Schriftgröße. */
  breite(text: string, groesse: number, schrift: Schrift): number
  logo(xMm: number, yMm: number, breiteMm: number, hoeheMm: number): void
}

export const PT = 25.4 / 72 // mm je Punkt

/** Satzspiegel für Text auf dem Briefbogen (mm vom Blattrand). Rechts frei für die Team-Spalte. */
export const HOLDING_RAENDER = {
  links: 21.5,
  /** Rechter Rand auf der ersten Seite (Team-Spalte beginnt bei 153,9 mm). */
  rechts: 62,
  /** Rechter Rand auf Folgeseiten (ohne Team-Spalte; Word lässt die Spalte dort ebenfalls weg). */
  rechtsFolge: 22,
  /** Erste Textzeile auf Seite 1 (unter der Absenderzeile, Anschriftfeld nach DIN 5008). */
  obenErste: 53,
  /** Erste Textzeile auf Folgeseiten (unter Logo und Absenderzeile). */
  obenFolge: 54,
  /** Unterer Rand: Fußzeile beginnt bei ca. 271 mm. */
  unten: 30,
} as const

export const HOLDING_FIRMA = 'Andreas Mayer Holding UG'
export const HOLDING_ABSENDERZEILE = 'Andreas Mayer Holding  Schwabstraße 3, 89075 Ulm'

/** Rechte Spalte „Ulmer Wirtschaftskanzlei“, wörtlich aus der Vorlage. Zeilen ohne Umbruch; zu lange werden umbrochen. */
export const HOLDING_TEAM: { name: string; zeilen: string[] }[] = [
  { name: 'Walter Meier', zeilen: ['Anwalt für Strafrecht,', 'Arbeitsrecht, Vertragsrecht', 'Mediator'] },
  { name: 'Thorsten Blaufeld', zeilen: ['Fachanwalt für Arbeitsrecht', 'Wirtschaftsmediator', 'Systemischer Business Coach'] },
  { name: 'Jens Sebastian', zeilen: ['Europäischer Patentanwalt', 'Fachanwalt für Lizenzrecht, Patentrecht', 'Wirtschaftsingenieur'] },
  {
    name: 'Andreas Mayer',
    zeilen: [
      'Unternehmensberater',
      'Dipl. Oec. Wirtsch.psychologie, Bachelor of Science,',
      'BP univ., CeBBT, KfW-Berater, Zertifizierter Coach, Bildungsträger nach AZAV, Wirtschaftsmediator',
    ],
  },
  {
    name: 'Hasan Süslü',
    zeilen: [
      'Unternehmensberater',
      'Fachwirt Marketing, IBBM Wirtschaftsmediator,',
      'Systemischer Executive Coach,',
      'Fachmann für Versicherung,',
      'Fachmann für Finanzierungs-',
      'Fachmann für Bausparfachmann',
    ],
  },
  { name: 'Prof. Dr. Hashim Cunpir', zeilen: ['Diplomat', 'Sicherheitsexperte', 'Universitätsdozent', 'Programmierungen'] },
  { name: 'Max Mayer', zeilen: ['Dipl. Ingenieur', 'Wirtschaftsmediator', 'Psychologischer Gesundheitscoach'] },
  { name: 'Gröber Markus', zeilen: ['Verkehrspädagoge', 'Kraftverkehrsmeister'] },
  { name: 'Quirin Lutzenberger', zeilen: ['Immobilienberater', 'Immobilienfachwirt IBBM'] },
]

/** Fußzeile: je Zeile [links, Mitte, rechts]. */
export const HOLDING_FUSS: [string, string, string][] = [
  ['Andreas Mayer Holding UG', 'KSK ES-NT', 'Tel.: 0176 209 671 39'],
  ['Schwabstraße 3', 'Iban: DE92 6115 0020 0007 0219 58', 'www.amayer-holding.com'],
  ['89075 Ulm', 'Steuernummer 71 504 682 835', 'GF: Andreas Mayer'],
  ['Amtsgericht Ulm, HRB 745056', '', 'Dipl. oec. Wi.psych., B. Sc.'],
]

/** Verkäuferangaben für Rechnungen (aus Fußzeile und Absenderzeile). */
export const HOLDING_ANGABEN = {
  firma: 'Andreas Mayer Holding UG',
  strasse: 'Schwabstraße 3',
  plz: '89075',
  ort: 'Ulm',
  telefon: '0176 209 671 39',
  web: 'www.amayer-holding.com',
  bank: 'KSK ES-NT',
  /** Kontoinhaber der Bankverbindung — Vorgabe der Geschäftsführung (24.11.2026): nur „Andreas Mayer“, nie die UG. */
  kontoinhaber: 'Andreas Mayer',
  iban: 'DE92 6115 0020 0007 0219 58',
  steuernummer: '71 504 682 835',
  register: 'Amtsgericht Ulm, HRB 745056',
  geschaeftsfuehrer: 'Andreas Mayer',
} as const

// Geometrie (mm)
const LOGO = { x: 16.5, y: 9.4, groesse: 26.1 }
const ABSENDER = { x: 21.5, y: 48.5, groesse: 7.5 }
const TEAM = { x: 159.0, y: 16.8, breite: 48.5, titel: 14, klein: 8, name: 8.5 }
const FUSS = { links: 21.5, mitte: 101.5, rechts: 181.5, erste: 274.0, abstand: 3.02, groesse: 7 }

function umbrechen(m: Maler, text: string, groesse: number, schrift: Schrift, breiteMm: number): string[] {
  const max = breiteMm / PT
  const woerter = text.split(/\s+/).filter(Boolean)
  const zeilen: string[] = []
  let akt = ''
  for (const w of woerter) {
    const probe = akt ? `${akt} ${w}` : w
    if (akt && m.breite(probe, groesse, schrift) > max) {
      zeilen.push(akt)
      akt = w
    } else akt = probe
  }
  if (akt) zeilen.push(akt)
  return zeilen
}

/** Zeichnet den Briefbogen auf die aktuelle Seite. Seite 1 mit Team-Spalte, Folgeseiten ohne. */
export function zeichneHoldingBriefbogen(m: Maler, seite: 'erste' | 'folge'): void {
  m.logo(LOGO.x, LOGO.y, LOGO.groesse, LOGO.groesse)
  m.text(HOLDING_ABSENDERZEILE, ABSENDER.x, ABSENDER.y, { groesse: ABSENDER.groesse, schrift: 'serif' })

  if (seite === 'erste') {
    let y = TEAM.y + TEAM.titel * PT
    m.text('Ulmer', TEAM.x, y, { groesse: TEAM.titel, schrift: 'serifFett' })
    y += TEAM.titel * 1.15 * PT
    m.text('Wirtschaftskanzlei', TEAM.x, y, { groesse: TEAM.titel, schrift: 'serifFett' })
    const zeile = TEAM.klein * 1.15 * PT
    y += zeile * 2.2
    for (const p of HOLDING_TEAM) {
      m.text(p.name, TEAM.x, y, { groesse: TEAM.name, schrift: 'serifFett' })
      y += zeile
      for (const z of p.zeilen) {
        for (const teil of umbrechen(m, z, TEAM.klein, 'serif', TEAM.breite)) {
          m.text(teil, TEAM.x, y, { groesse: TEAM.klein, schrift: 'serif' })
          y += zeile
        }
      }
      y += zeile * 1.6
    }
  }

  HOLDING_FUSS.forEach(([l, mi, r], i) => {
    const y = FUSS.erste + i * FUSS.abstand
    if (l) m.text(l, FUSS.links, y, { groesse: FUSS.groesse, schrift: 'sans' })
    if (mi) m.text(mi, FUSS.mitte, y, { groesse: FUSS.groesse, schrift: 'sans', ausrichtung: 'mitte' })
    if (r) m.text(r, FUSS.rechts, y, { groesse: FUSS.groesse, schrift: 'sans', ausrichtung: 'rechts' })
  })
}

export function base64ZuBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
