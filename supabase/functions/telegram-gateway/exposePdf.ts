// Exposé eines Objekts als PDF auf dem Server (für den Assistenten, expose_erstellen in exposeWerkzeuge.ts).
// Gleicher Aufbau wie das Exposé aus dem CRM (src/lib/exposePdf.ts, dort mit jsPDF im Browser): Deckblatt
// mit Logo bzw. Firmenname, Titel, Objektart und Ort, Titelbild, Kaufpreis und den Eckdaten; danach
// Beschreibung, bis zu sechs weitere Bilder, Ansprechpartner (und auf Wunsch der Vermittler) und der
// Hinweis „ohne Gewähr“. Welche Angaben überhaupt hinein dürfen, entscheidet exposeWerkzeuge.ts.
//
// Bibliothek wie bei dokument_erstellen: pdf-lib mit der eingebauten Helvetica (nichts wird eingebettet).
// Bilder kommen als JPEG oder PNG an; pdf-lib übernimmt JPEG unverändert (kein Entpacken, kaum
// Rechenzeit). Zugeschnitten wird über einen Ausschnitt (clip), gedreht nach der Ausrichtungs-Angabe
// des Fotos — die Pixel bleiben unangetastet (siehe bildDrehung.ts, warum keine Pixel-Drehung).

import { clip, degrees, endPath, type PDFFont, type PDFImage, PDFDocument, type PDFPage, popGraphicsState, pushGraphicsState, rectangle, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { laeufe, type Lauf, zerlege } from './auszeichnung.ts'
import { istJpeg, jpegAusrichtung } from './bildDrehung.ts'
import { type Schriften, textBreite, umbrechen, zeichenFilter, zeichneText, type Zeile } from './dokumentErstellen.ts'

export type ExposeBildDaten = { bytes: Uint8Array }

export type ExposeKontakt = {
  /** Überschrift des Kastens, z. B. „Ihr Ansprechpartner“ oder „Vermittler“. */
  titel: string
  name: string
  firma?: string
  telefon?: string
  email?: string
}

export type ExposePdfInhalt = {
  titel: string
  /** Ort oder volle Adresse. */
  ortZeile: string
  objektart: string
  preisText: string
  fakten: { label: string; wert: string }[]
  beschreibung: string
  titelbild?: ExposeBildDaten
  bilder: ExposeBildDaten[]
  logo?: ExposeBildDaten
  firma: string
  kontakte: ExposeKontakt[]
  vertraulich?: boolean
  /** Bereits formatiert, z. B. „22.11.2026“. */
  stand: string
}

export const EXPOSE_HINWEIS =
  'Alle Angaben beruhen auf Auskünften des Eigentümers oder Dritter und sind ohne Gewähr. Dieses Exposé ist unverbindlich, ersetzt keine eigene Prüfung und ist nur für den Empfänger bestimmt.'

const MM = 72 / 25.4
const A4 = { breite: 595.28, hoehe: 841.89 }
const L = 18 * MM
const R = 18 * MM
const OBEN = 16 * MM
const UNTEN = 20 * MM
const farbe = (r: number, g: number, b: number) => rgb(r / 255, g / 255, b / 255)
const TEXT = farbe(30, 41, 59)
const GRAU = farbe(100, 116, 139)
const HELL = farbe(241, 245, 249)
const BAND = farbe(248, 250, 252)
const LINIE = farbe(203, 213, 225)
const AKZENT = farbe(37, 72, 120)
const WARNUNG = farbe(146, 64, 14)

type Bild = { bild: PDFImage; ausrichtung: number }

/** Bild einbetten; kaputte oder unbekannte Dateien → null (das Exposé entsteht dann ohne dieses Bild). */
async function betteEin(doc: PDFDocument, b: ExposeBildDaten | undefined): Promise<Bild | null> {
  if (!b?.bytes?.length) return null
  try {
    if (istJpeg(b.bytes)) return { bild: await doc.embedJpg(b.bytes), ausrichtung: jpegAusrichtung(b.bytes) ?? 1 }
    if (b.bytes[0] === 0x89 && b.bytes[1] === 0x50 && b.bytes[2] === 0x4e && b.bytes[3] === 0x47) return { bild: await doc.embedPng(b.bytes), ausrichtung: 1 }
  } catch {
    // unten: null
  }
  return null
}

/** Breite/Höhe, wie das Bild angezeigt wird (bei Ausrichtung 5–8 vertauscht). */
function anzeigeMasse(b: Bild): { w: number; h: number } {
  return b.ausrichtung >= 5 ? { w: b.bild.height, h: b.bild.width } : { w: b.bild.width, h: b.bild.height }
}

/**
 * Zeichnet ein Bild in ein Feld (x, y = linke untere Ecke in PDF-Punkten). fuellen = Feld ganz füllen und
 * Überstand abschneiden; sonst einpassen. Die Drehung folgt der Ausrichtungs-Angabe (3, 6, 8).
 */
function zeichneBild(seite: PDFPage, b: Bild, x: number, y: number, w: number, h: number, fuellen: boolean) {
  const m = anzeigeMasse(b)
  const s = fuellen ? Math.max(w / m.w, h / m.h) : Math.min(w / m.w, h / m.h)
  const dw = m.w * s
  const dh = m.h * s
  const bx = x + (w - dw) / 2
  const by = y + (h - dh) / 2
  // Ungedrehte Maße des Bildes in Punkten.
  const iw = b.bild.width * s
  const ih = b.bild.height * s
  seite.pushOperators(pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath())
  if (b.ausrichtung === 6) seite.drawImage(b.bild, { x: bx, y: by + dh, width: iw, height: ih, rotate: degrees(-90) })
  else if (b.ausrichtung === 8) seite.drawImage(b.bild, { x: bx + dw, y: by, width: iw, height: ih, rotate: degrees(90) })
  else if (b.ausrichtung === 3) seite.drawImage(b.bild, { x: bx + dw, y: by + dh, width: iw, height: ih, rotate: degrees(180) })
  else seite.drawImage(b.bild, { x: bx, y: by, width: iw, height: ih })
  seite.pushOperators(popGraphicsState())
}

export async function erstelleExposePdf(inhalt: ExposePdfInhalt): Promise<{ bytes: Uint8Array; seiten: number; bilderImPdf: number; nichtLesbar: number }> {
  const doc = await PDFDocument.create()
  const f: Schriften = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    fett: await doc.embedFont(StandardFonts.HelveticaBold),
    kursiv: await doc.embedFont(StandardFonts.HelveticaOblique),
    fettKursiv: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    symbol: await doc.embedFont(StandardFonts.ZapfDingbats),
  }
  const sauber = zeichenFilter(f.normal)
  const titel = sauber(inhalt.titel.trim() || inhalt.objektart)
  const firma = sauber(inhalt.firma)
  doc.setTitle(`Exposé – ${titel}`)
  doc.setSubject('Exposé')
  doc.setAuthor(firma)
  doc.setCreator(`${firma} – CRM`)
  doc.setProducer(`${firma} – CRM`)
  doc.setLanguage('de-DE')

  const breite = A4.breite - L - R
  const seiten: PDFPage[] = []
  let seite!: PDFPage
  // y = Abstand von der Oberkante (wie im CRM-Exposé); gezeichnet wird bei A4.hoehe - y.
  let y = OBEN
  const neueSeite = () => {
    seite = doc.addPage([A4.breite, A4.hoehe])
    seiten.push(seite)
    y = OBEN + 4 * MM
  }
  const platz = (h: number) => {
    if (y + h > A4.hoehe - UNTEN) neueSeite()
  }
  const zeilenVon = (text: string | Lauf[], groesse: number, w: number, fett = false): Zeile[] =>
    umbrechen(typeof text === 'string' ? [{ text: sauber(text), fett, kursiv: false }] : text, f, groesse, w)
  const zeichneZeile = (z: Zeile, x: number, grundlinie: number, groesse: number, c = TEXT) => {
    // Gleiche Schrift in einem Stück (wie Setzer.zeile in dokumentErstellen.ts): Dann setzt der Betrachter
    // die Wortabstände selbst, und Text lässt sich am Stück markieren und durchsuchen.
    const stuecke: { text: string; font: PDFFont }[] = []
    for (const t of z.teile) {
      const letzter = stuecke[stuecke.length - 1]
      if (letzter && letzter.font === t.font) letzter.text += t.text
      else stuecke.push({ ...t })
    }
    let cx = x
    for (const t of stuecke) cx = zeichneText(seite, t.text, cx, A4.hoehe - grundlinie, groesse, t.font, c)
  }
  const rechtsbuendig = (text: string, xRechts: number, grundlinie: number, groesse: number, font: PDFFont, c = TEXT) => {
    zeichneText(seite, text, xRechts - textBreite(font, text, groesse), A4.hoehe - grundlinie, groesse, font, c)
  }
  const rechteck = (x: number, oben: number, w: number, h: number, o: { fuellung?: ReturnType<typeof rgb>; rand?: ReturnType<typeof rgb> }) => {
    seite.drawRectangle({ x, y: A4.hoehe - oben - h, width: w, height: h, color: o.fuellung, borderColor: o.rand, borderWidth: o.rand ? 0.85 : 0 })
  }
  const linie = (x1: number, x2: number, hoehe: number, c = LINIE, dicke = 0.85) => seite.drawLine({ start: { x: x1, y: A4.hoehe - hoehe }, end: { x: x2, y: A4.hoehe - hoehe }, thickness: dicke, color: c })
  const abschnitt = (text: string) => {
    platz(16 * MM)
    zeichneZeile(zeilenVon(text, 13, breite, true)[0], L, y, 13, AKZENT)
    y += 2.5 * MM
    linie(L, L + 18 * MM, y, AKZENT, 1.4)
    y += 7 * MM
  }

  let nichtLesbar = 0
  const zaehle = (b: Bild | null, quelle?: ExposeBildDaten) => {
    if (!b && quelle?.bytes?.length) nichtLesbar++
    return b
  }

  neueSeite()
  y = OBEN

  // ── Deckblatt ────────────────────────────────────────────────────────────────────────────────
  const logo = await betteEin(doc, inhalt.logo)
  if (logo) {
    const m = anzeigeMasse(logo)
    const v = m.w / m.h
    const w = Math.min(55 * MM, 15 * MM * v)
    zeichneBild(seite, logo, L, A4.hoehe - (y - 4 * MM) - w / v, w, w / v, false)
  } else {
    zeichneZeile(zeilenVon(inhalt.firma, 12, breite * 0.6, true)[0], L, y + 3 * MM, 12)
  }
  rechtsbuendig('E X P O S É', A4.breite - R, y + 1 * MM, 9, f.fett, GRAU)
  rechtsbuendig(sauber(`Stand ${inhalt.stand}`), A4.breite - R, y + 5.5 * MM, 8.5, f.normal, GRAU)
  y += 15 * MM
  linie(L, A4.breite - R, y)
  y += 11 * MM

  for (const z of zeilenVon(titel, 22, breite, true).slice(0, 3)) {
    zeichneZeile(z, L, y, 22)
    y += 9 * MM
  }
  const unterzeile = [inhalt.objektart, inhalt.ortZeile].map((t) => t.trim()).filter(Boolean).join(' · ')
  for (const z of unterzeile ? zeilenVon(unterzeile, 12, breite) : []) {
    zeichneZeile(z, L, y, 12, GRAU)
    y += 5.5 * MM
  }
  if (inhalt.vertraulich) {
    y += 1 * MM
    for (const z of zeilenVon('Vertrauliches Angebot – wird nicht öffentlich angeboten. Bitte nicht weitergeben.', 9, breite, true)) {
      zeichneZeile(z, L, y, 9, WARNUNG)
      y += 4.5 * MM
    }
  }
  y += 4 * MM

  let bilderImPdf = 0
  const titelbild = zaehle(await betteEin(doc, inhalt.titelbild), inhalt.titelbild)
  if (titelbild) {
    const bildH = Math.min(breite / 1.5, A4.hoehe - UNTEN - y - 60 * MM)
    if (bildH > 30 * MM) {
      rechteck(L, y, breite, bildH, { fuellung: HELL })
      zeichneBild(seite, titelbild, L, A4.hoehe - y - bildH, breite, bildH, true)
      y += bildH + 6 * MM
      bilderImPdf++
    }
  }

  // Preis als ruhiges, helles Band.
  rechteck(L, y, breite, 15 * MM, { fuellung: BAND, rand: LINIE })
  zeichneText(seite, 'Kaufpreis', L + 5 * MM, A4.hoehe - (y + 6 * MM), 9, f.normal, GRAU)
  zeichneZeile(zeilenVon(inhalt.preisText, 15, breite - 10 * MM, true)[0], L + 5 * MM, y + 12 * MM, 15)
  y += 22 * MM

  if (inhalt.fakten.length > 0) {
    abschnitt('Das Wichtigste auf einen Blick')
    const spalte = (breite - 4 * MM) / 2
    const zeileH = 8.5 * MM
    for (let i = 0; i < inhalt.fakten.length; i += 2) {
      platz(zeileH)
      inhalt.fakten.slice(i, i + 2).forEach((fakt, j) => {
        const x = L + j * (spalte + 4 * MM)
        if ((i / 2) % 2 === 0) rechteck(x, y - 5.6 * MM, spalte, zeileH, { fuellung: HELL })
        const wert = zeilenVon(fakt.wert, 10, spalte * 0.55, true)[0]
        const wertBreite = wert?.breite ?? 0
        const label = zeilenVon(fakt.label, 9.5, spalte - wertBreite - 9 * MM)[0]
        if (label) zeichneZeile(label, x + 3 * MM, y, 9.5, GRAU)
        if (wert) zeichneZeile(wert, x + spalte - 3 * MM - wertBreite, y, 10)
      })
      y += zeileH
    }
  }

  // ── Beschreibung ─────────────────────────────────────────────────────────────────────────────
  const bloecke = zerlege(sauber(inhalt.beschreibung.replace(/\r\n?/g, '\n').trim())).filter((b) => b.art !== 'leer')
  if (bloecke.length > 0) {
    neueSeite()
    abschnitt('Objektbeschreibung')
    const zeileH = 5.2 * MM
    const absatz = (text: Lauf[], x: number, w: number) => {
      for (const z of umbrechen(text, f, 10.5, w)) {
        platz(zeileH)
        zeichneZeile(z, x, y, 10.5)
        y += zeileH
      }
    }
    for (let i = 0; i < bloecke.length; i++) {
      const b = bloecke[i]
      if (b.art === 'ueberschrift') {
        platz(14 * MM)
        y += 2 * MM
        for (const z of umbrechen(laeufe(b.text, { fett: true, kursiv: false }), f, 11, breite)) {
          zeichneZeile(z, L, y, 11)
          y += 5.5 * MM
        }
        y += 1 * MM
      } else if (b.art === 'absatz' || b.art === 'zitat') {
        for (const z of b.zeilen) absatz(laeufe(z, { fett: false, kursiv: b.art === 'zitat' }), L, breite)
        y += 3 * MM
      } else if (b.art === 'punkt') {
        const einzug = L + b.ebene * 5 * MM
        platz(zeileH)
        const markeY = y
        const markeSeite = seite
        b.zeilen.forEach((z) => absatz(laeufe(z), einzug + 6 * MM, A4.breite - R - einzug - 6 * MM))
        markeSeite.drawText(b.marke ?? '•', { x: einzug + 1 * MM, y: A4.hoehe - markeY, size: 10.5, font: f.normal, color: TEXT })
        y += bloecke[i + 1]?.art === 'punkt' ? 0.8 * MM : 3 * MM
      } else if (b.art === 'tabelle') {
        // Einfache Tabellen als Zeilen „a: b“ — im Exposé selten, aber lieber lesbar als verloren.
        for (const zeile of b.zeilen) absatz(laeufe(zeile.filter((z) => z.trim()).join(': ')), L, breite)
        y += 3 * MM
      } else if (b.art === 'linie') {
        platz(6 * MM)
        y += 2 * MM
        linie(L, A4.breite - R, y)
        y += 4 * MM
      }
    }
  }

  // ── Bilder ───────────────────────────────────────────────────────────────────────────────────
  const galerie: Bild[] = []
  for (const b of inhalt.bilder.slice(0, 6)) {
    const e = zaehle(await betteEin(doc, b), b)
    if (e) galerie.push(e)
  }
  if (galerie.length > 0) {
    const zelleW = (breite - 5 * MM) / 2
    const zelleH = zelleW * 0.75
    if (bloecke.length === 0 || y + 16 * MM + zelleH * Math.min(2, Math.ceil(galerie.length / 2)) > A4.hoehe - UNTEN) neueSeite()
    else y += 4 * MM
    abschnitt('Bilder')
    for (let i = 0; i < galerie.length; i += 2) {
      platz(zelleH + 5 * MM)
      galerie.slice(i, i + 2).forEach((bild, j) => {
        const x = L + j * (zelleW + 5 * MM)
        rechteck(x, y, zelleW, zelleH, { fuellung: HELL })
        zeichneBild(seite, bild, x, A4.hoehe - y - zelleH, zelleW, zelleH, true)
        bilderImPdf++
      })
      y += zelleH + 5 * MM
    }
  }

  // ── Ansprechpartner (und Vermittler) und Hinweis ─────────────────────────────────────────────
  const kaesten = inhalt.kontakte.filter((k) => k.name.trim() || k.firma?.trim()).slice(0, 2)
  const nebeneinander = kaesten.length === 2
  const kastenW = nebeneinander ? (breite - 5 * MM) / 2 : breite
  const kastenZeilen = kaesten.map((k) =>
    [
      k.telefon?.trim() ? `Telefon: ${k.telefon.trim()}` : '',
      k.email?.trim() ? `E-Mail: ${k.email.trim()}` : '',
      k.name.trim() && k.firma?.trim() ? k.firma.trim() : '',
    ].filter(Boolean),
  )
  const kastenH = 14 * MM + Math.max(0, ...kastenZeilen.map((z) => z.length)) * 5 * MM
  const hinweis = zeilenVon(EXPOSE_HINWEIS, 8, breite)
  platz((kaesten.length ? kastenH + 7 * MM : 0) + 4 * MM + hinweis.length * 3.6 * MM)
  y += 4 * MM
  kaesten.forEach((k, i) => {
    const x = L + i * (kastenW + 5 * MM)
    rechteck(x, y, kastenW, kastenH, { fuellung: BAND, rand: LINIE })
    rechteck(x, y, 1.2 * MM, kastenH, { fuellung: AKZENT })
    zeichneText(seite, sauber(k.titel), x + 6 * MM, A4.hoehe - (y + 6 * MM), 9, f.normal, GRAU)
    const name = zeilenVon(k.name.trim() || k.firma?.trim() || '', 11.5, kastenW - 9 * MM, true)[0]
    if (name) zeichneZeile(name, x + 6 * MM, y + 11.5 * MM, 11.5)
    kastenZeilen[i].forEach((z, j) => {
      const zeile = zeilenVon(z, 9.5, kastenW - 9 * MM)[0]
      if (zeile) zeichneZeile(zeile, x + 6 * MM, y + 17 * MM + j * 5 * MM, 9.5)
    })
  })
  if (kaesten.length) y += kastenH + 7 * MM
  for (const z of hinweis) {
    zeichneZeile(z, L, y, 8, GRAU)
    y += 3.6 * MM
  }

  // ── Fußzeile auf jeder Seite ─────────────────────────────────────────────────────────────────
  const gesamt = seiten.length
  seiten.forEach((p, i) => {
    seite = p
    linie(L, A4.breite - R, A4.hoehe - 13 * MM)
    const links = zeilenVon(`${inhalt.firma} · Exposé ${inhalt.titel}`, 8, breite - 30 * MM)[0]
    if (links) zeichneZeile(links, L, A4.hoehe - 8.5 * MM, 8, GRAU)
    rechtsbuendig(`Seite ${i + 1} von ${gesamt}`, A4.breite - R, A4.hoehe - 8.5 * MM, 8, f.normal, GRAU)
  })

  return { bytes: await doc.save(), seiten: gesamt, bilderImPdf, nichtLesbar }
}
