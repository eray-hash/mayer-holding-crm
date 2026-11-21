// PDF des Eigentümerberichts (21.11.2026): was im gewählten Zeitraum für die Vermarktung eines Objekts
// geschehen ist — Kennzahlen, Besichtigungen mit Rückmeldung, Kaufpreisangebote, Tätigkeiten und die
// Einschätzung des Maklers. Briefkopf wie bei Kostenvoranschlag und Angebot (data/briefkopf.ts).
// Was hineinkommt, stellt der Mitarbeiter in ObjektEigentuemerbericht.tsx zusammen; hier wird nur gesetzt.
import jsPDF from 'jspdf'
import { BRIEFKOPF, type Briefkopf } from '../data/briefkopf'

const L = 22
const OBEN = 18
const UNTEN = 26

export const deDatum = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('.') : '')
const euro = (n: number) => `${n.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €`

/** Nur Zeichen, die die eingebaute Helvetica kennt. */
function sicher(text: string): string {
  return text
    .replace(/[→➜➤]/g, '->')
    .replace(/[✓✔]/g, 'x')
    .replace(/[  ]/g, ' ')
    .replace(/[^\u0000-ÿ€–—‘’‚“”„•…]/g, '?')
}

export type BerichtBesichtigung = { datum: string; interessent: string; stand: string; interesse: string; rueckmeldung: string; angebot?: number }

export type EigentuemerberichtDaten = {
  briefkopf?: Briefkopf
  /** Empfänger, eine Zeile je Eintrag. */
  empfaenger: string[]
  /** Datum des Berichts (JJJJ-MM-TT). */
  datum: string
  objekt: { bezeichnung: string; adresse: string; typ: string; stand: string; preis?: number }
  von: string
  bis: string
  anrede: string
  einleitung: string
  kennzahlen: { label: string; wert: string }[]
  besichtigungen: BerichtBesichtigung[]
  angebote: { datum: string; interessent: string; betrag: number }[]
  taetigkeiten: { datum: string; text: string }[]
  einschaetzung: string
  absender: string
}

export function eigentuemerberichtDateiname(objektBezeichnung: string, bis: string): string {
  const name = objektBezeichnung.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60)
  return `Eigentümerbericht ${name} (${deDatum(bis)}).pdf`
}

export function erzeugeEigentuemerberichtPdf(d: EigentuemerberichtDaten): Blob {
  const kopf = d.briefkopf ?? BRIEFKOPF
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const sb = doc.internal.pageSize.getWidth()
  const sh = doc.internal.pageSize.getHeight()
  const R = sb - 16
  const leiste = kopf.seitenleiste.length > 0 ? 42 : 0
  let seite = 1
  let y = OBEN
  const rechts = () => (seite === 1 && leiste ? R - leiste - 6 : R)

  const schrift = (stil: 'normal' | 'bold', groesse: number, grau = 25) => {
    doc.setFont('helvetica', stil)
    doc.setFontSize(groesse)
    doc.setTextColor(grau)
  }

  function kopfZeichnen() {
    schrift('bold', 13, 25)
    doc.text(sicher(kopf.name), L, OBEN)
    schrift('normal', 8.5, 90)
    let ky = OBEN + 5
    for (const z of kopf.unterzeilen) {
      doc.text(sicher(z), L, ky)
      ky += 3.8
    }
    doc.setDrawColor(190)
    doc.setLineWidth(0.3)
    doc.line(L, ky + 1, R, ky + 1)
    y = ky + 10
    if (leiste) {
      const lx = R - leiste
      let ly = y
      doc.setDrawColor(215)
      doc.line(lx - 4, ly - 3, lx - 4, sh - UNTEN - 6)
      for (const e of kopf.seitenleiste) {
        if (e.titel) {
          schrift('bold', 7.5, 60)
          doc.text(sicher(e.titel), lx, ly)
          ly += 3.6
        }
        schrift('normal', 6.6, 105)
        for (const z of e.zeilen) {
          for (const t of doc.splitTextToSize(sicher(z), leiste) as string[]) {
            doc.text(t, lx, ly)
            ly += 2.9
          }
        }
        ly += 2.4
      }
    }
  }

  const platz = (h: number) => {
    if (y + h > sh - UNTEN) {
      doc.addPage()
      seite++
      y = OBEN + 4
      return true
    }
    return false
  }

  function absatz(text: string, groesse = 10, stil: 'normal' | 'bold' = 'normal', grau = 25, einzug = 0) {
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

  function ueberschrift(text: string) {
    platz(16)
    y += 4
    schrift('bold', 11.5, 25)
    doc.text(sicher(text), L, y)
    y += 2
    doc.setDrawColor(215)
    doc.line(L, y, rechts(), y)
    y += 5.5
  }

  kopfZeichnen()

  // Empfänger und Datum
  schrift('normal', 10)
  for (const z of d.empfaenger.filter((x) => x.trim())) {
    doc.text(sicher(z), L, y)
    y += 5
  }
  y += 4
  schrift('normal', 10, 70)
  doc.text(`Ulm, ${deDatum(d.datum)}`, rechts(), y, { align: 'right' })
  y += 9

  schrift('bold', 16, 25)
  doc.text('Bericht zur Vermarktung Ihrer Immobilie', L, y)
  y += 6.5
  absatz(`${d.objekt.bezeichnung}${d.objekt.adresse && d.objekt.adresse !== d.objekt.bezeichnung ? ` · ${d.objekt.adresse}` : ''}`, 10.5, 'bold', 50)
  absatz(`Zeitraum: ${deDatum(d.von)} bis ${deDatum(d.bis)}`, 9.5, 'normal', 90)
  y += 5

  if (d.anrede.trim()) {
    absatz(d.anrede)
    y += 3
  }
  if (d.einleitung.trim()) {
    absatz(d.einleitung)
    y += 2
  }

  // Auf einen Blick
  ueberschrift('Auf einen Blick')
  const zeilenBlick = [
    { label: 'Objekt', wert: [d.objekt.typ, d.objekt.preis ? `Angebotspreis ${euro(d.objekt.preis)}` : ''].filter(Boolean).join(' · ') },
    { label: 'Aktueller Stand', wert: d.objekt.stand },
    ...d.kennzahlen,
  ]
  for (const k of zeilenBlick) {
    if (!k.wert) continue
    schrift('normal', 9.8, 90)
    const wertZeilen = doc.splitTextToSize(sicher(k.wert), rechts() - L - 58) as string[]
    platz(wertZeilen.length * 4.8 + 1)
    doc.text(sicher(k.label), L, y)
    schrift('bold', 9.8, 25)
    doc.text(wertZeilen, L + 58, y)
    y += wertZeilen.length * 4.8 + 0.6
  }

  // Besichtigungen
  if (d.besichtigungen.length > 0) {
    ueberschrift('Besichtigungen')
    for (const b of d.besichtigungen) {
      platz(14)
      schrift('bold', 9.8, 25)
      const kopfzeile = [deDatum(b.datum), b.interessent, b.stand].filter(Boolean).join(' · ')
      doc.text(sicher(kopfzeile), L, y)
      y += 4.8
      const zusatz = [b.interesse, b.angebot ? `Kaufpreisangebot ${euro(b.angebot)}` : ''].filter(Boolean).join(' · ')
      if (zusatz) absatz(zusatz, 9.3, 'normal', 70, 4)
      if (b.rueckmeldung.trim()) absatz(`Rückmeldung: ${b.rueckmeldung}`, 9.3, 'normal', 40, 4)
      y += 2.2
    }
  }

  // Kaufpreisangebote
  if (d.angebote.length > 0) {
    ueberschrift('Kaufpreisangebote')
    for (const a of d.angebote) {
      platz(6)
      schrift('normal', 9.8, 25)
      doc.text(sicher(`${deDatum(a.datum)} · ${a.interessent}`), L, y)
      schrift('bold', 9.8, 25)
      doc.text(euro(a.betrag), rechts(), y, { align: 'right' })
      y += 5.2
    }
  }

  // Tätigkeiten
  if (d.taetigkeiten.length > 0) {
    ueberschrift('Unsere Tätigkeiten im Zeitraum')
    for (const t of d.taetigkeiten) {
      schrift('normal', 9.5, 25)
      const zeilen = doc.splitTextToSize(sicher(t.text), rechts() - L - 24) as string[]
      platz(zeilen.length * 4.6 + 1)
      schrift('normal', 9.5, 100)
      doc.text(t.datum ? deDatum(t.datum) : '', L, y)
      schrift('normal', 9.5, 25)
      doc.text(zeilen, L + 24, y)
      y += zeilen.length * 4.6 + 1.2
    }
  }

  // Einschätzung
  if (d.einschaetzung.trim()) {
    ueberschrift('Unsere Einschätzung und die nächsten Schritte')
    absatz(d.einschaetzung)
  }

  y += 6
  platz(24)
  absatz('Für Rückfragen sind wir jederzeit für Sie da.')
  y += 3
  absatz('Mit freundlichen Grüßen')
  y += 10
  absatz(d.absender)

  // Fußzeilen und Seitenzahlen
  const seiten = doc.getNumberOfPages()
  for (let i = 1; i <= seiten; i++) {
    doc.setPage(i)
    schrift('normal', 7.2, 120)
    doc.setDrawColor(210)
    doc.line(L, sh - 19, R, sh - 19)
    let fy = sh - 15
    for (const z of kopf.fusszeilen) {
      doc.text(sicher(z), L, fy)
      fy += 3
    }
    doc.text(`Eigentümerbericht · Seite ${i} von ${seiten}`, R, sh - 11.5, { align: 'right' })
  }
  return doc.output('blob')
}
