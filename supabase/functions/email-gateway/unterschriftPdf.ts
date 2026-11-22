// Das unterschriebene PDF (Online-Unterschrift, 22.11.2026): der endgültige Text in der Aufmachung der
// Vorlage (Schrift, Logo, Ränder ungefähr wie src/lib/vorlagePdf.ts), am Ende der Block mit der Unterschrift
// und dem Nachweis (Zeitpunkt, getippter Name, IP-Adresse, Gerät, Vorgang, Prüfsumme des Texts).
// pdf-lib mit Standardschriften (nichts wird eingebettet außer Logo und Unterschrift).
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { type Block, type Lauf, zeitDe, zerlegeText } from '../_shared/unterschriftKern.ts'
import { MAYER_LOGO_BASE64, MAYER_LOGO_VERHAELTNIS } from './unterschriftLogo.ts'

const MM = 72 / 25.4
const A4 = { breite: 595.28, hoehe: 841.89 }
const TEXT = rgb(0.1, 0.1, 0.1)
const GRAU = rgb(0.42, 0.42, 0.42)
const LINIE = rgb(0.7, 0.7, 0.7)

type Stil = {
  serif: boolean
  logo?: { x: number; y: number; breite: number; seiten: 'alle' | 'erste' }
  titelMitte?: boolean
  titelGroesse: number
  links: number
  rechts: number
  start1: number
  startN: number
  unten: number
}

const LOGO = { x: 16.5, y: 9.4, breite: 24 }
const STILE: Record<string, Stil> = {
  brief: { serif: true, logo: { ...LOGO, seiten: 'alle' }, titelGroesse: 13, links: 21, rechts: 25, start1: 45, startN: 42, unten: 22 },
  fragebogen: { serif: false, logo: { ...LOGO, seiten: 'alle' }, titelGroesse: 13, links: 21, rechts: 18, start1: 44, startN: 44, unten: 22 },
  vertrag: { serif: true, logo: { x: 17, y: 18, breite: 22, seiten: 'alle' }, titelGroesse: 16, links: 21, rechts: 20, start1: 50, startN: 46, unten: 22 },
  kopffelder: { serif: false, logo: { x: 15, y: 9, breite: 15, seiten: 'alle' }, titelGroesse: 12.5, links: 21, rechts: 18, start1: 30, startN: 30, unten: 20 },
  protokoll: { serif: false, logo: { x: 12, y: 8, breite: 15, seiten: 'erste' }, titelGroesse: 12.5, links: 16, rechts: 14, start1: 30, startN: 18, unten: 20 },
  kooperation: { serif: false, logo: { x: 18, y: 25, breite: 20, seiten: 'alle' }, titelMitte: true, titelGroesse: 13, links: 25, rechts: 22, start1: 52, startN: 52, unten: 24 },
  schlicht: { serif: false, titelMitte: true, titelGroesse: 12, links: 25, rechts: 22, start1: 28, startN: 20, unten: 20 },
  schlichtSerif: { serif: true, titelGroesse: 14, links: 25, rechts: 22, start1: 32, startN: 25, unten: 22 },
  erben: { serif: false, logo: { x: 18, y: 12, breite: 22, seiten: 'alle' }, titelMitte: true, titelGroesse: 16, links: 21, rechts: 18, start1: 46, startN: 46, unten: 22 },
  memo: { serif: true, titelGroesse: 15, links: 23, rechts: 20, start1: 26, startN: 20, unten: 20 },
  feedback: { serif: false, logo: { x: 177, y: 9, breite: 15, seiten: 'erste' }, titelGroesse: 13, links: 22, rechts: 20, start1: 24, startN: 18, unten: 20 },
}

export function stilFuer(kopfstil: string | null | undefined): Stil {
  return STILE[String(kopfstil ?? '')] ?? STILE.fragebogen
}

export type UnterschriftPdfEingabe = {
  titel: string
  /** Endgültiger Text (mit Auszeichnung, ohne offene Felder). */
  text: string
  kopfstil?: string | null
  unterschriftPng: Uint8Array
  name: string
  am: Date
  ip: string
  geraet: string
  vorgang: string
  pruefsumme: string
  /** An wen der Link geschickt wurde (für den Nachweis), sonst leer. */
  linkAn?: string | null
  linkVom?: string | null
}

type Schriften = { normal: PDFFont; fett: PDFFont }
type Teil = { text: string; font: PDFFont }
type Zeile = { teile: Teil[]; breite: number }

// Was die Standardschrift (WinAnsi) nicht kennt, wird ersetzt statt die Erstellung abzubrechen.
const ERSATZ: Record<string, string> = {
  ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '﻿': '', '\t': '    ',
  '‐': '-', '‑': '-', '−': '-', '→': '->', '←': '<-', '⇒': '=>', '≥': '>=', '≤': '<=',
  '☑': '[X]', '☒': '[X]', '☐': '[  ]', '●': '•', '▪': '•', '✓': 'x', '✔': 'x',
}

function filter(font: PDFFont): (s: string) => string {
  const erlaubt = new Set(font.getCharacterSet())
  return (s: string) => {
    let aus = ''
    for (const z of s) {
      const cp = z.codePointAt(0)!
      if (erlaubt.has(cp)) aus += z
      else if (z in ERSATZ) aus += ERSATZ[z]
      else {
        const basis = z.normalize('NFD').replace(/[̀-ͯ]/g, '')
        aus += basis && [...basis].every((b) => erlaubt.has(b.codePointAt(0)!)) ? basis : /\p{L}|\p{N}/u.test(z) ? '?' : ''
      }
    }
    return aus
  }
}

/** Bricht Läufe (normal/fett) in Zeilen der Breite `max` um; überlange Wörter werden zeichenweise getrennt. */
export function umbrechen(laeufe: Lauf[], f: Schriften, groesse: number, max: number): Zeile[] {
  type Wort = { teile: Teil[]; leerDavor: boolean }
  const woerter: Wort[] = []
  let leer = false
  for (const l of laeufe) {
    const font = l.fett ? f.fett : f.normal
    const sauber = filter(font)(l.text)
    for (const m of sauber.matchAll(/(\s+)|(\S+)/g)) {
      if (m[1]) {
        leer = true
        continue
      }
      if (leer || woerter.length === 0) woerter.push({ teile: [{ text: m[2], font }], leerDavor: leer && woerter.length > 0 })
      else woerter[woerter.length - 1].teile.push({ text: m[2], font })
      leer = false
    }
  }
  const zeilen: Zeile[] = []
  let akt: Zeile = { teile: [], breite: 0 }
  const b = (t: Teil) => t.font.widthOfTextAtSize(t.text, groesse)
  for (const w of woerter) {
    const wb = w.teile.reduce((s, t) => s + b(t), 0)
    const lb = akt.teile.length && w.leerDavor ? f.normal.widthOfTextAtSize(' ', groesse) : 0
    if (akt.breite + lb + wb <= max) {
      if (lb) akt.teile.push({ text: ' ', font: f.normal })
      akt.teile.push(...w.teile)
      akt.breite += lb + wb
      continue
    }
    if (akt.teile.length) zeilen.push(akt)
    akt = { teile: [], breite: 0 }
    if (wb <= max) {
      akt = { teile: [...w.teile], breite: wb }
      continue
    }
    for (const t of w.teile) {
      for (const z of t.text) {
        const zb = t.font.widthOfTextAtSize(z, groesse)
        if (akt.breite + zb > max && akt.teile.length) {
          zeilen.push(akt)
          akt = { teile: [], breite: 0 }
        }
        akt.teile.push({ text: z, font: t.font })
        akt.breite += zb
      }
    }
  }
  if (akt.teile.length) zeilen.push(akt)
  return zeilen
}

function base64ZuBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const aus = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) aus[i] = bin.charCodeAt(i)
  return aus
}

class Setzer {
  seiten: PDFPage[] = []
  seite!: PDFPage
  y = 0
  constructor(private doc: PDFDocument, readonly f: Schriften, readonly st: Stil, private logo: PDFImage | null) {}

  get links() {
    return this.st.links * MM
  }
  get breite() {
    return A4.breite - (this.st.links + this.st.rechts) * MM
  }
  get unten() {
    return this.st.unten * MM + 14
  }

  neueSeite() {
    this.seite = this.doc.addPage([A4.breite, A4.hoehe])
    this.seiten.push(this.seite)
    const erste = this.seiten.length === 1
    const l = this.st.logo
    if (this.logo && l && (l.seiten === 'alle' || erste)) {
      const w = l.breite * MM
      const h = w / MAYER_LOGO_VERHAELTNIS
      this.seite.drawImage(this.logo, { x: l.x * MM, y: A4.hoehe - l.y * MM - h, width: w, height: h })
    }
    this.y = A4.hoehe - (erste ? this.st.start1 : this.st.startN) * MM
  }

  platz(hoehe: number) {
    if (this.y - hoehe < this.unten) this.neueSeite()
  }

  zeichne(z: Zeile, x: number, groesse: number, farbe = TEXT) {
    let cx = x
    for (const t of z.teile) {
      if (t.text) this.seite.drawText(t.text, { x: cx, y: this.y, size: groesse, font: t.font, color: farbe })
      cx += t.font.widthOfTextAtSize(t.text, groesse)
    }
  }

  /** Umbrochener Absatz ab x mit Breite max; mitte = zentriert. */
  absatz(laeufe: Lauf[], groesse: number, abstand: number, x = this.links, max = this.breite, mitte = false, farbe = TEXT) {
    for (const z of umbrechen(laeufe, this.f, groesse, max)) {
      this.platz(abstand)
      this.y -= abstand
      this.zeichne(z, mitte ? x + (max - z.breite) / 2 : x, groesse, farbe)
    }
  }
}

/** Erzeugt das unterschriebene PDF. */
export async function erzeugeUnterschriftPdf(e: UnterschriftPdfEingabe): Promise<{ bytes: Uint8Array; seiten: number }> {
  const doc = await PDFDocument.create()
  const st = stilFuer(e.kopfstil)
  const f: Schriften = st.serif
    ? { normal: await doc.embedFont(StandardFonts.TimesRoman), fett: await doc.embedFont(StandardFonts.TimesRomanBold) }
    : { normal: await doc.embedFont(StandardFonts.Helvetica), fett: await doc.embedFont(StandardFonts.HelveticaBold) }
  const klein: Schriften = { normal: await doc.embedFont(StandardFonts.Helvetica), fett: await doc.embedFont(StandardFonts.HelveticaBold) }
  doc.setTitle(e.titel)
  doc.setAuthor('Andreas Mayer Holding')
  doc.setSubject(`Elektronisch unterschrieben von ${e.name}`)
  doc.setCreationDate(e.am)

  let logo: PDFImage | null = null
  try {
    logo = st.logo ? await doc.embedPng(base64ZuBytes(MAYER_LOGO_BASE64)) : null
  } catch {
    logo = null
  }
  const s = new Setzer(doc, f, st, logo)
  s.neueSeite()

  const G = st.serif ? 10.5 : 10
  const Z = G * 1.32
  const bloecke: Block[] = zerlegeText(e.text)
  let erste = true
  for (const b of bloecke) {
    if (b.art === 'leer') {
      if (!erste) s.y -= Z * 0.5
      continue
    }
    if (b.art === 'titel') {
      s.absatz(b.laeufe.map((l) => ({ ...l, fett: true })), st.titelGroesse, st.titelGroesse * 1.3, s.links, s.breite, !!st.titelMitte)
      s.y -= 6
    } else if (b.art === 'ueberschrift') {
      s.platz(Z * 3)
      s.y -= 5
      s.absatz(b.laeufe.map((l) => ({ ...l, fett: true })), G + 1, (G + 1) * 1.35)
      s.y -= 2
    } else if (b.art === 'zeile') {
      const einzug = Math.min(b.einzug, 12) * 1.6 * MM
      s.absatz(b.laeufe, G, Z, s.links + einzug, s.breite - einzug)
    } else {
      const spalten = Math.max(...b.zeilen.map((z) => z.length))
      const luecke = b.rahmenlos ? 10 : 0
      const sb = (s.breite - luecke * (spalten - 1)) / spalten
      const innen = b.rahmenlos ? 0 : 3
      const groesse = b.rahmenlos ? G : G - 1
      const zab = groesse * 1.32
      for (const zeile of b.zeilen) {
        const umbrochen = zeile.map((zelle) => umbrechen(zelle, f, groesse, sb - 2 * innen))
        const n = Math.max(1, ...umbrochen.map((u) => u.length))
        const hoehe = n * zab + 2 * innen + (b.rahmenlos ? 0 : 2)
        s.platz(hoehe)
        const oben = s.y
        umbrochen.forEach((u, i) => {
          const x = s.links + i * (sb + luecke)
          s.y = oben - innen
          for (const z of u) {
            s.y -= zab
            s.zeichne(z, x + innen, groesse)
          }
          if (!b.rahmenlos) s.seite.drawRectangle({ x, y: oben - hoehe, width: sb, height: hoehe, borderColor: LINIE, borderWidth: 0.5 })
        })
        s.y = oben - hoehe
      }
      s.y -= 2
    }
    erste = false
  }

  // ---------- Block mit der Unterschrift und dem Nachweis ----------
  const bild = await doc.embedPng(e.unterschriftPng)
  const bw = Math.min(200, s.breite / 2)
  const bh = Math.min(70, (bw * bild.height) / Math.max(1, bild.width))
  const bwEcht = (bh * bild.width) / Math.max(1, bild.height)
  s.platz(bh + 150)
  s.y -= 18
  s.seite.drawLine({ start: { x: s.links, y: s.y }, end: { x: s.links + s.breite, y: s.y }, thickness: 0.6, color: LINIE })
  s.y -= 16
  s.seite.drawText('Elektronische Unterschrift', { x: s.links, y: s.y, size: 11, font: klein.fett, color: TEXT })
  s.y -= 8 + bh
  s.seite.drawImage(bild, { x: s.links, y: s.y, width: bwEcht, height: bh })
  s.y -= 4
  s.seite.drawLine({ start: { x: s.links, y: s.y }, end: { x: s.links + bw, y: s.y }, thickness: 0.6, color: TEXT })
  s.absatz([{ text: e.name, fett: false }], 10, 13, s.links, bw)
  s.y -= 8
  const zeilen = [
    `Elektronisch unterschrieben am ${zeitDe(e.am)} von ${e.name} (IP ${e.ip || 'unbekannt'}).`,
    'Der Unterzeichner hat bestätigt, das Dokument gelesen zu haben, und seinen vollständigen Namen eingegeben.',
    e.linkAn ? `Zugang über einen persönlichen Link${e.linkVom ? ` vom ${zeitDe(e.linkVom).replace(/, .*$/, '')}` : ''}, versandt an ${e.linkAn}.` : 'Zugang über einen persönlichen Link.',
    `Gerät: ${e.geraet.slice(0, 220) || 'unbekannt'}`,
    `Vorgang: ${e.vorgang}`,
    `Prüfsumme des Texts (SHA-256): ${e.pruefsumme}`,
  ]
  for (const t of zeilen) {
    for (const z of umbrechen([{ text: t, fett: false }], klein, 8, s.breite)) {
      s.platz(10.5)
      s.y -= 10.5
      s.zeichne(z, s.links, 8, GRAU)
    }
  }

  // Fußzeile auf jeder Seite: Seitenzahl links, Hinweis rechts.
  const gesamt = s.seiten.length
  s.seiten.forEach((seite, i) => {
    const y = Math.max(14, st.unten * MM - 10)
    seite.drawText(`${i + 1} von ${gesamt}`, { x: st.links * MM, y, size: 8, font: klein.normal, color: GRAU })
    const hinweis = `Elektronisch unterschrieben · Vorgang ${e.vorgang.slice(0, 8)}`
    const w = klein.normal.widthOfTextAtSize(hinweis, 7.5)
    seite.drawText(hinweis, { x: A4.breite - st.rechts * MM - w, y, size: 7.5, font: klein.normal, color: GRAU })
  })

  return { bytes: await doc.save(), seiten: gesamt }
}
