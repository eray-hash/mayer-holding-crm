import jsPDF from 'jspdf'

// Fertiges Exposé eines Objekts als PDF (A4, 2–4 Seiten): Deckblatt mit Titel, Ort, Titelbild, Preis
// und den wichtigsten Eckdaten; danach die Beschreibung, bis zu sechs weitere Bilder, der Ansprechpartner
// und ein kurzer Hinweis. Rein aus den übergebenen Angaben — welche Angaben ein Exposé überhaupt
// bekommen darf (nie Eigentümer, interne Notizen, Kurzprüfung, Bewertung, Abrechnung), entscheidet
// exposeDaten.ts. Bilder kommen schon verkleinert und als JPEG/PNG an (siehe exposeBilder.ts), damit
// diese Datei auch ohne Browser läuft (Prüfung mit Ersatzdaten).
//
// Schrift: die eingebaute Helvetica, sie kennt westeuropäische Zeichen (ä, ö, ü, ß, €, „ “ –).
// Alles andere wird in `sicher` auf ein lesbares Ersatzzeichen abgebildet.

export type ExposeBild = {
  /** data:image/jpeg;base64,… oder data:image/png;base64,… */
  dataUrl: string
  breite: number
  hoehe: number
}

export type ExposeInhalt = {
  titel: string
  /** Nur der Ort („Ulm“) — oder die volle Adresse, wenn der Mitarbeiter sie ausdrücklich zeigen will. */
  ortZeile: string
  objektart: string
  preisText: string
  fakten: { label: string; wert: string }[]
  beschreibung: string
  titelbild?: ExposeBild
  bilder: ExposeBild[]
  logo?: ExposeBild
  firma: string
  kontakt: { name: string; telefon?: string; email?: string }
  /** Optional: Vermittler (z. B. von einer Visitenkarte) — eigener Kasten neben „Ihr Ansprechpartner“. */
  vermittler?: { name: string; firma?: string; telefon?: string; email?: string }
  vertraulich?: boolean
  /** Bereits formatiert, z. B. „18.11.2026“. */
  stand: string
}

export const EXPOSE_HINWEIS =
  'Alle Angaben beruhen auf Auskünften des Eigentümers oder Dritter und sind ohne Gewähr. Dieses Exposé ist unverbindlich, ersetzt keine eigene Prüfung und ist nur für den Empfänger bestimmt.'

const L = 18
const R = 18
const OBEN = 16
const UNTEN = 20
const TEXT = [30, 41, 59] as const
const GRAU = [100, 116, 139] as const
const HELL = [241, 245, 249] as const
const LINIE = [203, 213, 225] as const
const AKZENT = [37, 72, 120] as const

export function sicher(text: string): string {
  return text
    .replace(/[    ]/g, ' ')
    .replace(/[→➜➤]/g, '->')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[✓✔]/g, 'x')
    .replace(/[‐‑]/g, '-')
    .replace(/­/g, '')
    .replace(/[^\u0000-ÿ€–—‘’‚“”„•…]/g, '?')
}

function bildFormat(dataUrl: string): 'JPEG' | 'PNG' {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG'
}

/** JPEG wird unverändert übernommen; PNG (Logo) sonst unkomprimiert eingebettet — deshalb dort packen. */
function packung(dataUrl: string): 'NONE' | 'FAST' {
  return bildFormat(dataUrl) === 'PNG' ? 'FAST' : 'NONE'
}

/** Text in Absätze, Zwischenüberschriften und Aufzählungen zerlegen (KI-Texte enthalten oft „**“ und „#“). */
function absaetze(text: string): { art: 'absatz' | 'ueberschrift' | 'punkt'; text: string }[] {
  const teile: { art: 'absatz' | 'ueberschrift' | 'punkt'; text: string }[] = []
  let laufend: string[] = []
  const schliesse = () => {
    if (laufend.length) teile.push({ art: 'absatz', text: laufend.join(' ') })
    laufend = []
  }
  for (const roh of text.replace(/\r/g, '').split('\n')) {
    const zeile = roh.replace(/\*\*|__/g, '').trim()
    if (!zeile) {
      schliesse()
      continue
    }
    // „## Lage“ oder eine ganz fett gesetzte Zeile („**Ausstattung:**“) gilt als Zwischenüberschrift.
    const ueberschrift = zeile.match(/^#{1,6}\s*(.+)$/) ?? (/^\s*(\*\*|__)[^*_]+(\*\*|__)\s*:?\s*$/.test(roh) ? [zeile, zeile] : null)
    if (ueberschrift) {
      schliesse()
      teile.push({ art: 'ueberschrift', text: ueberschrift[1].trim() })
      continue
    }
    const punkt = zeile.match(/^(?:[-*•–]|\d+[.)])\s+(.+)$/)
    if (punkt) {
      schliesse()
      teile.push({ art: 'punkt', text: punkt[1].trim() })
      continue
    }
    laufend.push(zeile)
  }
  schliesse()
  return teile
}

export function erzeugeExposePdf(inhalt: ExposeInhalt): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const B = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const breite = B - L - R
  let y = OBEN

  const farbe = (f: readonly [number, number, number]) => doc.setTextColor(f[0], f[1], f[2])
  const schrift = (stil: 'normal' | 'bold', groesse: number, f: readonly [number, number, number] = TEXT) => {
    doc.setFont('helvetica', stil)
    doc.setFontSize(groesse)
    farbe(f)
  }
  const zeilen = (text: string, w: number) => doc.splitTextToSize(sicher(text), w) as string[]
  const neueSeite = () => {
    doc.addPage()
    y = OBEN + 4
  }
  const platz = (mm: number) => {
    if (y + mm > H - UNTEN) neueSeite()
  }

  /** Bild in ein Feld einpassen (Seitenverhältnis bleibt), mittig. */
  function bildIn(bild: ExposeBild, x: number, by: number, w: number, h: number, alias: string) {
    const v = bild.breite / bild.hoehe
    let bw = w
    let bh = w / v
    if (bh > h) {
      bh = h
      bw = h * v
    }
    doc.addImage(bild.dataUrl, bildFormat(bild.dataUrl), x + (w - bw) / 2, by + (h - bh) / 2, bw, bh, alias, packung(bild.dataUrl))
  }

  function abschnitt(titel: string) {
    platz(16)
    schrift('bold', 13, AKZENT)
    doc.text(sicher(titel), L, y)
    y += 2.5
    doc.setDrawColor(AKZENT[0], AKZENT[1], AKZENT[2])
    doc.setLineWidth(0.5)
    doc.line(L, y, L + 18, y)
    y += 7
  }

  // ── Deckblatt ────────────────────────────────────────────────────────────────────────────────
  if (inhalt.logo) {
    const maxW = 55
    const maxH = 15
    const v = inhalt.logo.breite / inhalt.logo.hoehe
    const w = Math.min(maxW, maxH * v)
    doc.addImage(inhalt.logo.dataUrl, bildFormat(inhalt.logo.dataUrl), L, y - 4, w, w / v, 'logo', packung(inhalt.logo.dataUrl))
  } else {
    schrift('bold', 12)
    doc.text(sicher(inhalt.firma), L, y + 3)
  }
  schrift('bold', 9, GRAU)
  doc.text('EXPOSÉ', B - R, y + 1, { align: 'right', charSpace: 0.8 })
  schrift('normal', 8.5, GRAU)
  doc.text(sicher(`Stand ${inhalt.stand}`), B - R, y + 5.5, { align: 'right' })
  y += 15
  doc.setDrawColor(LINIE[0], LINIE[1], LINIE[2])
  doc.setLineWidth(0.3)
  doc.line(L, y, B - R, y)
  y += 11

  schrift('bold', 22)
  for (const z of zeilen(inhalt.titel || inhalt.objektart, breite).slice(0, 3)) {
    doc.text(z, L, y)
    y += 9
  }
  schrift('normal', 12, GRAU)
  const unterzeile = [inhalt.objektart, inhalt.ortZeile].filter((t) => t.trim()).join(' · ')
  if (unterzeile) {
    for (const z of zeilen(unterzeile, breite)) {
      doc.text(z, L, y)
      y += 5.5
    }
  }
  if (inhalt.vertraulich) {
    y += 1
    schrift('bold', 9, [146, 64, 14])
    for (const z of zeilen('Vertrauliches Angebot – wird nicht öffentlich angeboten. Bitte nicht weitergeben.', breite)) {
      doc.text(z, L, y)
      y += 4.5
    }
  }
  y += 4

  if (inhalt.titelbild) {
    const bildH = Math.min(breite / 1.5, H - UNTEN - y - 60)
    doc.setFillColor(HELL[0], HELL[1], HELL[2])
    doc.rect(L, y, breite, bildH, 'F')
    bildIn(inhalt.titelbild, L, y, breite, bildH, 'titelbild')
    y += bildH + 6
  }

  // Preis als ruhiges, helles Band.
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(LINIE[0], LINIE[1], LINIE[2])
  doc.setLineWidth(0.3)
  doc.rect(L, y, breite, 15, 'FD')
  schrift('normal', 9, GRAU)
  doc.text('Kaufpreis', L + 5, y + 6)
  schrift('bold', 15)
  doc.text(sicher(inhalt.preisText), L + 5, y + 12)
  y += 22

  if (inhalt.fakten.length > 0) {
    abschnitt('Das Wichtigste auf einen Blick')
    const spalte = (breite - 4) / 2
    const zeileH = 8.5
    for (let i = 0; i < inhalt.fakten.length; i += 2) {
      platz(zeileH)
      const reihe = inhalt.fakten.slice(i, i + 2)
      reihe.forEach((f, j) => {
        const x = L + j * (spalte + 4)
        if ((i / 2) % 2 === 0) {
          doc.setFillColor(HELL[0], HELL[1], HELL[2])
          doc.rect(x, y - 5.6, spalte, zeileH, 'F')
        }
        schrift('normal', 9.5, GRAU)
        doc.text(sicher(f.label), x + 3, y)
        schrift('bold', 10)
        const wert = zeilen(f.wert, spalte * 0.55)[0] ?? ''
        doc.text(wert, x + spalte - 3, y, { align: 'right' })
      })
      y += zeileH
    }
  }

  // ── Beschreibung ─────────────────────────────────────────────────────────────────────────────
  const teile = absaetze(inhalt.beschreibung)
  if (teile.length > 0) {
    neueSeite()
    abschnitt('Objektbeschreibung')
    const zeileH = 5.2
    let vorher: string = ''
    for (const t of teile) {
      if (vorher === 'punkt' && t.art !== 'punkt') y += 2.2
      vorher = t.art
      if (t.art === 'ueberschrift') {
        platz(14)
        y += 2
        schrift('bold', 11)
        for (const z of zeilen(t.text, breite)) {
          doc.text(z, L, y)
          y += 5.5
        }
        y += 1
        continue
      }
      schrift('normal', 10.5)
      if (t.art === 'punkt') {
        const z = zeilen(t.text, breite - 6)
        z.forEach((zeile, i) => {
          platz(zeileH)
          if (i === 0) doc.text('•', L + 1, y)
          doc.text(zeile, L + 6, y)
          y += zeileH
        })
        y += 0.8
        continue
      }
      for (const zeile of zeilen(t.text, breite)) {
        platz(zeileH)
        doc.text(zeile, L, y)
        y += zeileH
      }
      y += 3
    }
  }

  // ── Bilder ───────────────────────────────────────────────────────────────────────────────────
  const bilder = inhalt.bilder.slice(0, 6)
  if (bilder.length > 0) {
    const zelleW = (breite - 5) / 2
    const zelleH = zelleW * 0.75
    // Lieber auf einer frischen Seite beginnen, als eine einzelne Bildreihe unten anzuhängen.
    if (teile.length === 0 || y + 16 + zelleH * Math.min(2, Math.ceil(bilder.length / 2)) > H - UNTEN) neueSeite()
    else y += 4
    abschnitt('Bilder')
    for (let i = 0; i < bilder.length; i += 2) {
      platz(zelleH + 5)
      bilder.slice(i, i + 2).forEach((bild, j) => {
        const x = L + j * (zelleW + 5)
        doc.setFillColor(HELL[0], HELL[1], HELL[2])
        doc.rect(x, y, zelleW, zelleH, 'F')
        bildIn(bild, x, y, zelleW, zelleH, `bild${i + j}`)
      })
      y += zelleH + 5
    }
  }

  // ── Ansprechpartner (und Vermittler) und Hinweis ─────────────────────────────────────────────
  const vermittler = inhalt.vermittler && (inhalt.vermittler.name.trim() || inhalt.vermittler.firma?.trim()) ? inhalt.vermittler : undefined
  const kaesten = [
    {
      titel: 'Ihr Ansprechpartner',
      name: inhalt.kontakt.name || inhalt.firma,
      zeilen: [
        inhalt.kontakt.telefon?.trim() ? `Telefon: ${inhalt.kontakt.telefon.trim()}` : '',
        inhalt.kontakt.email?.trim() ? `E-Mail: ${inhalt.kontakt.email.trim()}` : '',
        inhalt.firma,
      ].filter(Boolean),
    },
    ...(vermittler
      ? [
          {
            titel: 'Vermittler',
            name: vermittler.name.trim() || vermittler.firma?.trim() || '',
            zeilen: [
              vermittler.telefon?.trim() ? `Telefon: ${vermittler.telefon.trim()}` : '',
              vermittler.email?.trim() ? `E-Mail: ${vermittler.email.trim()}` : '',
              vermittler.name.trim() && vermittler.firma?.trim() ? vermittler.firma.trim() : '',
            ].filter(Boolean),
          },
        ]
      : []),
  ]
  const hinweisZeilen = (() => {
    schrift('normal', 8)
    return zeilen(EXPOSE_HINWEIS, breite)
  })()
  const kastenW = kaesten.length === 2 ? (breite - 5) / 2 : breite
  const kastenH = 14 + Math.max(...kaesten.map((k) => k.zeilen.length)) * 5
  platz(kastenH + 10 + hinweisZeilen.length * 3.6)
  y += 4
  kaesten.forEach((k, i) => {
    const x = L + i * (kastenW + 5)
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(LINIE[0], LINIE[1], LINIE[2])
    doc.setLineWidth(0.3)
    doc.rect(x, y, kastenW, kastenH, 'FD')
    doc.setFillColor(AKZENT[0], AKZENT[1], AKZENT[2])
    doc.rect(x, y, 1.2, kastenH, 'F')
    schrift('normal', 9, GRAU)
    doc.text(k.titel, x + 6, y + 6)
    schrift('bold', 11.5)
    doc.text(zeilen(k.name, kastenW - 9)[0] ?? '', x + 6, y + 11.5)
    schrift('normal', 9.5)
    k.zeilen.forEach((z, j) => doc.text(zeilen(z, kastenW - 9)[0] ?? '', x + 6, y + 17 + j * 5))
  })
  y += kastenH + 7
  schrift('normal', 8, GRAU)
  for (const z of hinweisZeilen) {
    doc.text(z, L, y)
    y += 3.6
  }

  // ── Fußzeile auf jeder Seite ─────────────────────────────────────────────────────────────────
  const seiten = doc.getNumberOfPages()
  for (let s = 1; s <= seiten; s++) {
    doc.setPage(s)
    doc.setDrawColor(LINIE[0], LINIE[1], LINIE[2])
    doc.setLineWidth(0.3)
    doc.line(L, H - 13, B - R, H - 13)
    schrift('normal', 8, GRAU)
    const links = zeilen(`${inhalt.firma} · Exposé ${inhalt.titel}`, breite - 30)[0] ?? ''
    doc.text(links, L, H - 8.5)
    doc.text(`Seite ${s} von ${seiten}`, B - R, H - 8.5, { align: 'right' })
  }

  doc.setProperties({ title: sicher(`Exposé – ${inhalt.titel}`), subject: 'Exposé', creator: sicher(inhalt.firma) })
  return doc
}

/** PDF als Base64 (ohne „data:“-Vorspann) — für den Mailanhang. */
export function pdfAlsBase64(doc: jsPDF): string {
  const bytes = new Uint8Array(doc.output('arraybuffer'))
  let binaer = ''
  const STUECK = 0x8000
  for (let i = 0; i < bytes.length; i += STUECK) binaer += String.fromCharCode(...bytes.subarray(i, i + STUECK))
  return btoa(binaer)
}
