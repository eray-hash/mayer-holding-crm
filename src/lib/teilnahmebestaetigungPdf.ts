// Teilnahmebestätigung für einen Seminar-Teilnehmer als PDF (22.11.2026). Auf dem echten Briefbogen der
// Andreas Mayer Holding / Ulmer Wirtschaftskanzlei (holdingBriefbogenJspdf.ts, seit 24.11.2026), darin
// Name, Seminar, Termin, Dauer, Referent und Inhalte — mittig im Satzspiegel links der Team-Spalte. Eine Seite.
import jsPDF from 'jspdf'
import { holdingAlleSeiten, holdingSatzspiegel } from './holdingBriefbogenJspdf'

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

export function erzeugeTeilnahmePdf(a: TeilnahmeAngaben): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const satz = holdingSatzspiegel(doc)
  const L = satz.links
  const R = satz.rechtsErste
  const breite = R - L
  const mitte = (L + R) / 2
  const schrift = (stil: 'normal' | 'bold', groesse: number, grau = 25) => {
    doc.setFont('helvetica', stil)
    doc.setFontSize(groesse)
    doc.setTextColor(grau)
  }
  let y = satz.obenErste
  // Grundlinie der Unterschriftszeile, knapp über der Fußzeile des Briefbogens.
  const uy = satz.unten - 12

  // Titel
  y += 22
  schrift('bold', 22, 30)
  doc.text('Teilnahmebestätigung', mitte, y, { align: 'center' })
  y += 18
  schrift('normal', 11, 50)
  doc.text('Hiermit bestätigen wir, dass', mitte, y, { align: 'center' })
  y += 12
  schrift('bold', 16, 25)
  doc.text(sicher(a.name), mitte, y, { align: 'center' })
  if (a.firma && a.firma.trim() && a.firma.trim() !== a.name.trim()) {
    y += 7
    schrift('normal', 11, 70)
    doc.text(sicher(a.firma), mitte, y, { align: 'center' })
  }
  y += 12
  schrift('normal', 11, 50)
  doc.text('erfolgreich am Seminar', mitte, y, { align: 'center' })
  y += 11
  schrift('bold', 15, 25)
  for (const z of doc.splitTextToSize(sicher(`„${a.seminar}“`), breite) as string[]) {
    doc.text(z, mitte, y, { align: 'center' })
    y += 7
  }
  y += 3
  schrift('normal', 11, 50)
  doc.text('teilgenommen hat.', mitte, y, { align: 'center' })

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
      if (y > uy - 14) break
      doc.text(z, L + 10, y)
      y += 5
    }
  }

  // Unterschrift
  schrift('normal', 10, 30)
  doc.text(sicher(a.ausgestellt ?? `Ulm, ${new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}`), L, uy)
  doc.setDrawColor(120)
  doc.line(R - 70, uy, R, uy)
  schrift('normal', 9, 70)
  doc.text(sicher(a.unterzeichner ?? 'Akademie der Andreas Mayer Holding'), R - 70, uy + 5)

  holdingAlleSeiten(doc)
  return doc.output('blob')
}
