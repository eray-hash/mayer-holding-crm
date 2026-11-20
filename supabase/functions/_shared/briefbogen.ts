// Briefe auf dem eigenen Word-Briefbogen einer Person. Der Briefbogen liegt zweimal vor:
//  - als .docx mit Platzhalter-Absätzen [[EMPFAENGER]], [[DATUM]], [[BETREFF]], [[ANREDE]], [[TEXT]]
//    → fuelleDocx() setzt den Brief ein (Ergebnis bleibt in Word bearbeitbar);
//  - als aus Word exportiertes PDF → erzeugeBriefPdf() legt dessen Seiten als Hintergrund unter den Text
//    (Seite 1 für die erste Seite, Seite 2 – falls vorhanden – für Folgeseiten).
//
// fuelleDocx ist eine Übertragung des Python-Skripts, das unter Windows bereits im Einsatz ist
// (ersetze(doc, marke, zeilen)): Der Absatz mit [[MARKE]] wird für jede Zeile einmal kopiert, nur die
// erste Kopie bleibt fett, leere Zeilen werden zu leeren Absätzen. Zusätzlich:
//  - Absätze mit Attributen (<w:p w14:paraId=…>) werden erkannt;
//  - hat Word den Platzhalter auf mehrere Läufe verteilt ("[[" | "BETREFF" | "]]"), wird der Absatz zu
//    einem einzigen Lauf zusammengefasst (Format des ersten Laufs bleibt);
//  - Werte werden für XML maskiert, Zeilenumbrüche innerhalb eines Werts werden zu <w:br/>;
//  - Kopf- und Fußzeilen (word/header*.xml, word/footer*.xml) werden genauso behandelt;
//  - alle übrigen Dateien im Zip bleiben inhaltlich unverändert.

import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from 'npm:fflate@0.8.2'
import { PDFDocument, type PDFEmbeddedPage, type PDFFont, type PDFPage, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'

export type BriefDaten = {
  /** Anschrift, eine Zeile je Eintrag. */
  empfaenger: string[]
  /** Fertige Datumszeile; ohne Angabe "<ort>, den TT.MM.JJJJ" (deutsche Zeit). */
  datum?: string
  /** Ort für die Datumszeile, Vorgabe "Ulm". */
  ort?: string
  betreff: string
  anrede: string
  /** Absätze des Brieftexts; ein Zeilenumbruch innerhalb eines Absatzes bleibt erhalten. */
  absaetze: string[]
  /** Grußformel mit Unterschrift, z. B. ['Mit freundlichen Grüßen', '', 'Hasan Süslü'] – nur im PDF
   *  (in der .docx steht der Gruß fest in der Vorlage). */
  gruss?: string[]
}

export const PLATZHALTER = ['EMPFAENGER', 'DATUM', 'BETREFF', 'ANREDE', 'TEXT'] as const
export type Platzhalter = (typeof PLATZHALTER)[number]

/** "Ulm, den 20.11.2026" – Kalendertag in deutscher Zeit. */
export function briefDatum(ort?: string, jetzt: Date = new Date()): string {
  const tag = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(jetzt)
  return `${(ort ?? '').trim() || 'Ulm'}, den ${tag}`
}

// ───────────────────────────── Word (.docx) ─────────────────────────────

/** Innerster Absatz: <w:p> oder <w:p …> (nicht <w:pPr>, nicht selbstschließend) bis zum nächsten </w:p>,
 *  ohne dass dazwischen ein weiterer Absatz beginnt (wie das Python-Muster, aber mit Attributen). */
const ABSATZ = /<w:p(?:\s[^>]*?)?(?<!\/)>(?:(?!<w:p[\s>]).)*?<\/w:p>/gs
const TEXTSTUECK = /<w:t(?:\s[^>]*?)?(?:\/>|>(.*?)<\/w:t>)/gs
const LAUF = /<w:r(?:\s[^>]*?)?(?<!\/)>(.*?)<\/w:r>/s
const TEILE = /^word\/(?:document|header\d*|footer\d*)\.xml$/

function marke(name: Platzhalter): string {
  return `[[${name}]]`
}

/** Sichtbarer Text eines Absatzes (Inhalt aller <w:t>, noch XML-maskiert). */
function absatzText(p: string): string {
  let text = ''
  for (const m of p.matchAll(TEXTSTUECK)) text += m[1] ?? ''
  return text
}

/** XML-Maskierung; "[[" wird zusätzlich entschärft, damit ein Wert keinen späteren Platzhalter auslöst. */
function maskiere(wert: string): string {
  return wert
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\[\[/g, '[&#91;')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">')
}

/** Fasst einen Absatz, in dem Word einen Platzhalter auf mehrere Läufe verteilt hat, zu einem Lauf zusammen. */
function vereinheitliche(p: string): string {
  const text = absatzText(p)
  const betroffen = PLATZHALTER.some((n) => text.includes(marke(n)) && !p.includes(marke(n)))
  if (!betroffen) return p
  const kopf = p.match(/^<w:p(?:\s[^>]*?)?>/)![0]
  const pPr = p.match(/<w:pPr>.*?<\/w:pPr>|<w:pPr\/>/s)?.[0] ?? ''
  const rest = pPr ? p.slice(p.indexOf(pPr) + pPr.length) : p.slice(kopf.length)
  // Format des ersten Laufs mit Text übernehmen.
  let rPr = ''
  for (const m of rest.matchAll(new RegExp(LAUF.source, 'gs'))) {
    if (!/<w:t[\s>/]/.test(m[1])) continue
    rPr = m[1].match(/<w:rPr>.*?<\/w:rPr>/s)?.[0] ?? ''
    break
  }
  return `${kopf}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}

/** Ersetzt den (ersten) Absatz mit [[name]] durch je einen Absatz pro Zeile. */
function ersetze(xml: string, name: Platzhalter, zeilen: string[]): string {
  const m = marke(name)
  let treffer: RegExpMatchArray | undefined
  for (const a of xml.matchAll(ABSATZ)) {
    if (a[0].includes(m)) {
      treffer = a
      break
    }
  }
  if (!treffer) return xml
  const muster = treffer[0].replace(/<w:t>/g, '<w:t xml:space="preserve">')
  const neu: string[] = []
  zeilen.forEach((z, i) => {
    let p = muster.split(m).join(maskiere(z))
    if (i > 0) {
      p = p.replace(/<w:b(?:Cs)?(?:\s[^>]*?)?\/>/g, '') // nur die erste Zeile bleibt fett
      p = p.replace(/\s+w14:(?:paraId|textId)="[^"]*"/g, '') // Kennungen müssen eindeutig bleiben
    }
    if (!z) p = p.replace(/<w:r(?:\s[^>]*?)?(?<!\/)>.*?<\/w:r>/gs, '')
    neu.push(p)
  })
  const start = treffer.index!
  return xml.slice(0, start) + neu.join('') + xml.slice(start + treffer[0].length)
}

function leseZip(vorlage: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(vorlage)
  } catch {
    throw new Error('Die Briefbogen-Vorlage ist keine gültige Word-Datei (.docx).')
  }
}

/** Welche der fünf Platzhalter in der Vorlage stehen (Hauptteil, Kopf- und Fußzeilen) – für die Prüfung beim Hochladen. */
export function platzhalterIn(vorlage: Uint8Array): Platzhalter[] {
  const dateien = leseZip(vorlage)
  const gefunden = new Set<Platzhalter>()
  for (const [name, inhalt] of Object.entries(dateien)) {
    if (!TEILE.test(name)) continue
    const xml = strFromU8(inhalt)
    for (const a of xml.matchAll(ABSATZ)) {
      const text = absatzText(a[0])
      for (const n of PLATZHALTER) if (text.includes(marke(n))) gefunden.add(n)
    }
  }
  return PLATZHALTER.filter((n) => gefunden.has(n))
}

/** Setzt den Brief in die Word-Vorlage ein und liefert die fertige .docx. */
export function fuelleDocx(vorlage: Uint8Array, brief: BriefDaten): Uint8Array {
  const dateien = leseZip(vorlage)
  if (!dateien['word/document.xml']) throw new Error('Die Briefbogen-Vorlage enthält kein word/document.xml – ist es wirklich eine Word-Datei?')

  const werte: [Platzhalter, string[]][] = [
    ['EMPFAENGER', brief.empfaenger ?? []],
    ['DATUM', [brief.datum?.trim() || briefDatum(brief.ort)]],
    ['BETREFF', [brief.betreff ?? '']],
    ['ANREDE', [brief.anrede ?? '']],
    ['TEXT', brief.absaetze ?? []],
  ]

  const neu: Record<string, Uint8Array> = {}
  let textGefunden = false
  for (const [name, inhalt] of Object.entries(dateien)) {
    if (!TEILE.test(name)) {
      neu[name] = inhalt
      continue
    }
    const roh = strFromU8(inhalt)
    let xml = roh.replace(ABSATZ, vereinheitliche)
    if (xml.includes(marke('TEXT'))) textGefunden = true
    for (const [n, zeilen] of werte) xml = ersetze(xml, n, zeilen)
    neu[name] = xml === roh ? inhalt : strToU8(xml)
  }
  if (!textGefunden) throw new Error('In der Briefbogen-Vorlage fehlt der Platzhalter [[TEXT]] – dort wird der Brieftext eingesetzt.')

  // Bereits gepackte Bilder nicht noch einmal komprimieren.
  const zip: Zippable = {}
  for (const [name, inhalt] of Object.entries(neu)) zip[name] = /\.(png|jpe?g|gif)$/i.test(name) ? [inhalt, { level: 0 }] : inhalt
  return zipSync(zip, { level: 6 })
}

// ───────────────────────────── PDF ─────────────────────────────

/** Maße für den Brief in Millimetern (schrift in Punkt, zeilenhoehe als Faktor der Schriftgröße). */
export type Raender = {
  links: number
  rechts: number
  unten: number
  anschriftOben: number
  datumOben: number
  betreffOben: number
  folgeseiteOben: number
  schrift: number
  zeilenhoehe: number
}

/** DIN 5008 Form B; je Briefbogen überschreibbar. */
export const STANDARD_RAENDER: Raender = {
  links: 25,
  rechts: 20,
  unten: 25,
  anschriftOben: 50.7,
  datumOben: 98.5,
  betreffOben: 106,
  folgeseiteOben: 30,
  schrift: 11,
  zeilenhoehe: 1.35,
}

const MM = 72 / 25.4
const A4: [number, number] = [595.28, 841.89]
const ANSCHRIFT_SCHRIFT = 10
const ANSCHRIFT_ZEILE = 4.23 * MM // eine Zeile im Anschriftfeld nach DIN 5008
const OBERLAENGE = 0.8 // Abstand Zeilenoberkante → Grundlinie, Anteil der Schriftgröße

/** Liefert eine Funktion, die alles, was die Schrift (WinAnsi) nicht kennt, durch "?" ersetzt. */
function zeichenFilter(font: PDFFont): (text: string) => string {
  const merker = new Map<string, string>()
  return (text: string) => {
    let aus = ''
    const sauber = (text ?? '').normalize('NFC').replace(/[​-‍⁠︎️]/g, '').replace(/\t/g, '    ')
    for (const z of sauber) {
      let e = merker.get(z)
      if (e === undefined) {
        if (z < ' ') e = ''
        else {
          try {
            font.encodeText(z)
            e = z
          } catch {
            e = '?'
          }
        }
        merker.set(z, e)
      }
      aus += e
    }
    return aus
  }
}

/** Bricht Text auf die Breite um (an Leerzeichen; überlange Wörter werden zerteilt). Text muss bereits gefiltert sein. */
function umbrechen(text: string, font: PDFFont, groesse: number, breite: number): string[] {
  const breiteVon = (s: string) => font.widthOfTextAtSize(s, groesse)
  const zeilen: string[] = []
  for (const roh of text.split('\n')) {
    const woerter = roh.split(/ +/).filter((w, i, alle) => w !== '' || (i === 0 && alle.length === 1))
    let zeile = ''
    for (let wort of woerter) {
      const probe = zeile ? `${zeile} ${wort}` : wort
      if (breiteVon(probe) <= breite) {
        zeile = probe
        continue
      }
      if (zeile) zeilen.push(zeile)
      zeile = ''
      while (breiteVon(wort) > breite && wort.length > 1) {
        let n = wort.length - 1
        while (n > 1 && breiteVon(wort.slice(0, n)) > breite) n--
        zeilen.push(wort.slice(0, n))
        wort = wort.slice(n)
      }
      zeile = wort
    }
    zeilen.push(zeile)
  }
  return zeilen
}

/** Erzeugt den Brief als PDF, auf Wunsch mit dem Briefbogen-PDF als Hintergrund. */
export async function erzeugeBriefPdf(hintergrund: Uint8Array | null, brief: BriefDaten, raender?: Partial<Raender>): Promise<Uint8Array> {
  const r: Raender = { ...STANDARD_RAENDER }
  for (const [k, v] of Object.entries(raender ?? {})) if (typeof v === 'number' && Number.isFinite(v)) r[k as keyof Raender] = v

  const pdf = await PDFDocument.create()
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const fett = await pdf.embedFont(StandardFonts.HelveticaBold)
  const sicher = zeichenFilter(normal)
  const sicherFett = zeichenFilter(fett)
  const schwarz = rgb(0, 0, 0)

  let erste: PDFEmbeddedPage | null = null
  let folge: PDFEmbeddedPage | null = null
  if (hintergrund && hintergrund.length) {
    let quelle: PDFDocument
    try {
      quelle = await PDFDocument.load(hintergrund)
    } catch (e) {
      throw new Error(`Das Briefbogen-PDF lässt sich nicht lesen (${e instanceof Error ? e.message : String(e)}). Bitte aus Word erneut als PDF speichern, ohne Kennwortschutz.`)
    }
    const anzahl = quelle.getPageCount()
    if (anzahl === 0) throw new Error('Das Briefbogen-PDF hat keine Seiten.')
    const eingebettet = await pdf.embedPdf(quelle, anzahl > 1 ? [0, 1] : [0])
    erste = eingebettet[0]
    folge = eingebettet[1] ?? eingebettet[0]
  }

  const seiten: PDFPage[] = []
  const neueSeite = (hg: PDFEmbeddedPage | null): PDFPage => {
    const [b, h] = hg ? [hg.width, hg.height] : A4
    const s = pdf.addPage([b, h])
    if (hg) s.drawPage(hg, { x: 0, y: 0, width: b, height: h })
    seiten.push(s)
    return s
  }

  let seite = neueSeite(erste)
  const breite = () => seite.getWidth() - (r.links + r.rechts) * MM
  const rechterRand = () => seite.getWidth() - r.rechts * MM
  const zeile = r.schrift * r.zeilenhoehe

  // Anschriftfeld
  let y = r.anschriftOben * MM // Abstand von oben bis zur Oberkante der nächsten Zeile
  for (const z of brief.empfaenger ?? []) {
    const t = sicher(z.replace(/\s*\n\s*/g, ' '))
    if (t) seite.drawText(t, { x: r.links * MM, y: seite.getHeight() - y - ANSCHRIFT_SCHRIFT * OBERLAENGE, size: ANSCHRIFT_SCHRIFT, font: normal, color: schwarz })
    y += ANSCHRIFT_ZEILE
  }

  // Datum rechtsbündig
  const datum = sicher(brief.datum?.trim() || briefDatum(brief.ort))
  seite.drawText(datum, {
    x: rechterRand() - normal.widthOfTextAtSize(datum, r.schrift),
    y: seite.getHeight() - r.datumOben * MM - r.schrift * OBERLAENGE,
    size: r.schrift,
    font: normal,
    color: schwarz,
  })

  // Fließtext ab dem Betreff
  y = r.betreffOben * MM
  let seitenAnfang = false
  const unten = () => seite.getHeight() - r.unten * MM
  const umbruch = () => {
    seite = neueSeite(folge)
    y = r.folgeseiteOben * MM
    seitenAnfang = true
  }
  const schreibe = (text: string, font: PDFFont) => {
    if (y + zeile > unten()) umbruch()
    if (text) seite.drawText(text, { x: r.links * MM, y: seite.getHeight() - y - r.schrift * OBERLAENGE, size: r.schrift, font, color: schwarz })
    y += zeile
    seitenAnfang = false
  }
  const leer = () => {
    if (seitenAnfang) return // keine Leerzeile oben auf einer neuen Seite
    if (y + zeile > unten()) return umbruch()
    y += zeile
  }
  const absatz = (text: string, font: PDFFont, filter: (t: string) => string) => {
    for (const z of umbrechen(filter(text ?? ''), font, r.schrift, breite())) schreibe(z, font)
  }

  if (brief.betreff?.trim()) {
    absatz(brief.betreff.trim(), fett, sicherFett)
    leer()
  }
  if (brief.anrede?.trim()) {
    absatz(brief.anrede.trim(), normal, sicher)
    leer()
  }
  const absaetze = (brief.absaetze ?? []).map((a) => (a ?? '').replace(/\r\n?/g, '\n'))
  absaetze.forEach((a, i) => {
    if (i > 0) leer()
    absatz(a, normal, sicher)
  })

  // Grußformel und Unterschrift zusammenhalten
  const gruss = brief.gruss ?? []
  if (gruss.length) {
    leer()
    const zeilen = gruss.flatMap((g) => umbrechen(sicher(g ?? ''), normal, r.schrift, breite()))
    if (y + zeilen.length * zeile > unten() && zeilen.length * zeile <= unten() - r.folgeseiteOben * MM) umbruch()
    for (const z of zeilen) schreibe(z, normal)
  }

  // Seitenzahlen nur bei mehr als einer Seite, klein unten rechts knapp unter dem Textbereich
  if (seiten.length > 1) {
    seiten.forEach((s, i) => {
      const t = `Seite ${i + 1} von ${seiten.length}`
      s.drawText(t, {
        x: s.getWidth() - r.rechts * MM - normal.widthOfTextAtSize(t, 8),
        y: r.unten * MM - 4 * MM - 8 * OBERLAENGE,
        size: 8,
        font: normal,
        color: schwarz,
      })
    })
  }

  pdf.setTitle(brief.betreff?.trim() || 'Brief')
  pdf.setLanguage('de-DE')
  return await pdf.save()
}
