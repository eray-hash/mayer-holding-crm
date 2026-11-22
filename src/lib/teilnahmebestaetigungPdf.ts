// Teilnahmebestätigung für einen Seminar-Teilnehmer als PDF (22.11.2026). Briefkopf wie bei den anderen
// Schreiben (data/briefkopf.ts, ohne Seitenleiste), darunter Name, Seminar, Termin, Dauer, Referent und Inhalte.
import jsPDF from 'jspdf'
import { BRIEFKOPF, type Briefkopf } from '../data/briefkopf'

/** Nur Zeichen, die die eingebaute Helvetica kennt (wie vorlagePdf.ts). */
function sicher(text: string): string {
  return text.replace(/[  ]/g, ' ').replace(/[^\u0000-ÿ€–—‘’‚“”„•…]/g, '?')
}

export type TeilnahmeAngaben = {
  name: string
  firma?: string
  seminar: string
  /** Lesbarer Termin, z. B. "Do., 03.12.2026, 09:00 bis 17:00 Uhr". */
  termin: string
  ort?: string
  dauer?: string
  referent?: string
  inhalte?: string
  /** Ort und Datum unter dem Text, Vorgabe "Ulm, <heute>". */
  ausgestellt?: string
  unterzeichner?: string
}

export function teilnahmeDateiname(a: Pick<TeilnahmeAngaben, 'name' | 'seminar'>): string {
  const s = (t: string) => t.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 50)
  return `Teilnahmebestätigung ${s(a.seminar)} ${s(a.name)}.pdf`
}

export function erzeugeTeilnahmePdf(a: TeilnahmeAngaben, kopf: Briefkopf = BRIEFKOPF): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const sb = doc.internal.pageSize.getWidth()
  const sh = doc.internal.pageSize.getHeight()
  const L = 22
  const R = sb - 22
  const breite = R - L
  const schrift = (stil: 'normal' | 'bold', groesse: number, grau = 25) => {
    doc.setFont('helvetica', stil)
    doc.setFontSize(groesse)
    doc.setTextColor(grau)
  }

  // Briefkopf
  schrift('bold', 13)
  doc.text(sicher(kopf.name), L, 20)
  schrift('normal', 8.5, 90)
  let y = 25
  for (const z of kopf.unterzeilen) {
    doc.text(sicher(z), L, y)
    y += 3.8
  }
  doc.setDrawColor(190)
  doc.setLineWidth(0.3)
  doc.line(L, y + 1, R, y + 1)

  // Titel
  y += 28
  schrift('bold', 22, 30)
  doc.text('Teilnahmebestätigung', sb / 2, y, { align: 'center' })
  y += 18
  schrift('normal', 11, 50)
  doc.text('Hiermit bestätigen wir, dass', sb / 2, y, { align: 'center' })
  y += 12
  schrift('bold', 16, 25)
  doc.text(sicher(a.name), sb / 2, y, { align: 'center' })
  if (a.firma && a.firma.trim() && a.firma.trim() !== a.name.trim()) {
    y += 7
    schrift('normal', 11, 70)
    doc.text(sicher(a.firma), sb / 2, y, { align: 'center' })
  }
  y += 12
  schrift('normal', 11, 50)
  doc.text('erfolgreich am Seminar', sb / 2, y, { align: 'center' })
  y += 11
  schrift('bold', 15, 25)
  for (const z of doc.splitTextToSize(sicher(`„${a.seminar}“`), breite) as string[]) {
    doc.text(z, sb / 2, y, { align: 'center' })
    y += 7
  }
  y += 3
  schrift('normal', 11, 50)
  doc.text('teilgenommen hat.', sb / 2, y, { align: 'center' })

  // Angaben
  y += 16
  const angaben: [string, string | undefined][] = [
    ['Termin', a.termin],
    ['Ort', a.ort],
    ['Dauer', a.dauer],
    ['Referent', a.referent],
  ]
  for (const [titel, wert] of angaben) {
    if (!wert || !wert.trim()) continue
    schrift('bold', 10, 60)
    doc.text(`${titel}:`, L + 10, y)
    schrift('normal', 10, 30)
    const zeilen = doc.splitTextToSize(sicher(wert), breite - 45) as string[]
    doc.text(zeilen, L + 45, y)
    y += 5.5 * zeilen.length + 1
  }
  if (a.inhalte && a.inhalte.trim()) {
    y += 4
    schrift('bold', 10, 60)
    doc.text('Inhalte:', L + 10, y)
    y += 5.5
    schrift('normal', 10, 30)
    for (const z of doc.splitTextToSize(sicher(a.inhalte.trim()), breite - 20) as string[]) {
      if (y > sh - 70) break
      doc.text(z, L + 10, y)
      y += 5
    }
  }

  // Unterschrift
  const uy = sh - 55
  schrift('normal', 10, 30)
  doc.text(sicher(a.ausgestellt ?? `Ulm, ${new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}`), L, uy)
  doc.setDrawColor(120)
  doc.line(R - 70, uy, R, uy)
  schrift('normal', 9, 70)
  doc.text(sicher(a.unterzeichner ?? 'Akademie der Andreas Mayer Holding'), R - 70, uy + 5)

  // Fußzeilen
  schrift('normal', 7.5, 120)
  let fy = sh - 18
  for (const z of kopf.fusszeilen) {
    doc.text(sicher(z), sb / 2, fy, { align: 'center' })
    fy += 3.5
  }
  return doc.output('blob')
}
