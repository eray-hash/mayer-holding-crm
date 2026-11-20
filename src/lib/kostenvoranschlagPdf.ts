// PDF eines im CRM berechneten Kostenvoranschlags oder eines daraus erzeugten Angebots (20.11.2026).
// Briefkopf wie bei allen Schreiben aus Vorlagen (data/briefkopf.ts: Zeile "briefkopf" der Tabelle
// vorlagen — Name, Unterzeilen, Seitenleiste auf Seite 1, Fußzeilen). Bei privaten Akten ein schlichter
// Kopf mit dem Namen des Besitzers. Der Auf-/Abschlag ist in den Einzelpreisen eingerechnet und wird
// nicht ausgewiesen.
import jsPDF from 'jspdf'
import { BRIEFKOPF, type Briefkopf } from '../data/briefkopf'
import { berechneKv, preisMitAufschlag, type Kostenvoranschlag } from './kostenvoranschlaege'

const L = 22
const OBEN = 18
const UNTEN = 26

const euro = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const zahl = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
export const deDatum = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('.') : '')
const heuteIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })

/** Nur Zeichen, die die eingebaute Helvetica kennt (wie vorlagePdf.ts). */
function sicher(text: string): string {
  return text
    .replace(/[→➜➤]/g, '->')
    .replace(/[✓✔]/g, 'x')
    .replace(/[  ]/g, ' ')
    .replace(/[^\u0000-ÿ€–—‘’‚“”„•…]/g, '?')
}

export type KvArt = 'kostenvoranschlag' | 'angebot'

export function kvNummer(kv: Pick<Kostenvoranschlag, 'id' | 'datum'>, art: KvArt = 'kostenvoranschlag'): string {
  const jahr = (kv.datum || heuteIso()).slice(0, 4)
  return `${art === 'angebot' ? 'AN' : 'KV'}-${jahr}-${kv.id.replace(/^kv_/, '').slice(0, 6).toUpperCase()}`
}

export function kvPdfDateiname(kv: Pick<Kostenvoranschlag, 'id' | 'datum' | 'name'>, art: KvArt = 'kostenvoranschlag', datum = heuteIso()): string {
  const name = kv.name.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60)
  return `${art === 'angebot' ? 'Angebot' : 'Kostenvoranschlag'} ${kvNummer(kv, art)} ${name} (${deDatum(datum)}).pdf`
}

export type AngebotAngaben = {
  /** Empfänger-Anschrift, eine Zeile je Eintrag. */
  empfaenger: string[]
  betreff: string
  anrede: string
  /** Text vor der Aufstellung. */
  einleitung: string
  /** Text nach der Aufstellung. */
  schluss: string
  /** Gültig bis (JJJJ-MM-TT). */
  gueltigBis: string
  /** Name unter dem Gruß. */
  absender: string
  /** Datum des Angebots (JJJJ-MM-TT), Vorgabe heute. */
  datum?: string
}

export function erzeugeKvPdf(
  kv: Kostenvoranschlag,
  a: { briefkopf?: Briefkopf; art?: KvArt; angebot?: AngebotAngaben; empfaengerZusatz?: string },
): Blob {
  const art = a.art ?? 'kostenvoranschlag'
  const kopf = a.briefkopf ?? BRIEFKOPF
  const positionen = kv.positionen ?? []
  const auf = kv.aufschlagProzent ?? 0
  const ust = kv.ustSatz ?? 19
  const r = berechneKv(positionen, auf, ust)
  const datum = (art === 'angebot' ? a.angebot?.datum : kv.datum) || heuteIso()

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const sb = doc.internal.pageSize.getWidth()
  const sh = doc.internal.pageSize.getHeight()
  const R = sb - 16
  const leiste = kopf.seitenleiste.length > 0 ? 42 : 0
  let seite = 1
  let y = OBEN
  // Auf Seite 1 steht rechts die Seitenleiste; der Text bleibt links davon.
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
    if (leiste && seite === 1) {
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

  function neueSeite() {
    doc.addPage()
    seite++
    y = OBEN + 4
  }
  const platz = (h: number) => {
    if (y + h > sh - UNTEN) {
      neueSeite()
      return true
    }
    return false
  }

  function absatz(text: string, groesse = 10, stil: 'normal' | 'bold' = 'normal', grau = 25) {
    schrift(stil, groesse, grau)
    for (const roh of text.split('\n')) {
      const zeilen = roh.trim() ? (doc.splitTextToSize(sicher(roh), rechts() - L) as string[]) : ['']
      for (const z of zeilen) {
        platz(5)
        doc.text(z, L, y)
        y += groesse * 0.5
      }
    }
  }

  kopfZeichnen()

  // Empfänger (Angebot) bzw. "Für" (Kostenvoranschlag)
  if (art === 'angebot' && a.angebot) {
    schrift('normal', 10)
    for (const z of a.angebot.empfaenger.filter((x) => x.trim())) {
      doc.text(sicher(z), L, y)
      y += 5
    }
    y += 6
    schrift('normal', 10, 70)
    doc.text(`Ulm, ${deDatum(datum)}`, rechts(), y, { align: 'right' })
    y += 8
  }

  schrift('bold', art === 'angebot' ? 14 : 17, 25)
  doc.text(art === 'angebot' ? sicher(a.angebot?.betreff || 'Angebot') : 'Kostenvoranschlag', L, y)
  y += 6
  schrift('normal', 9.5, 90)
  const meta = [`Nr. ${kvNummer(kv, art)}`, art === 'angebot' ? '' : `Datum: ${deDatum(datum)}`, art === 'angebot' && a.angebot?.gueltigBis ? `gültig bis ${deDatum(a.angebot.gueltigBis)}` : '']
  doc.text(meta.filter(Boolean).join('   ·   '), L, y)
  y += 9

  if (art === 'kostenvoranschlag') {
    schrift('normal', 10)
    doc.text('Für:', L, y)
    schrift('bold', 10)
    doc.text(sicher(kv.name), L + 10, y)
    y += 5
    if (a.empfaengerZusatz) absatz(a.empfaengerZusatz)
    if (kv.beschreibung) {
      y += 1
      absatz(`Betreff: ${kv.beschreibung}`)
    }
    y += 4
  } else if (a.angebot) {
    if (a.angebot.anrede.trim()) {
      absatz(a.angebot.anrede)
      y += 3
    }
    if (a.angebot.einleitung.trim()) {
      absatz(a.angebot.einleitung)
      y += 4
    }
  }

  // Tabelle
  const sp = () => {
    const r2 = rechts()
    return { nr: L, bez: L + 9, summe: r2, preis: r2 - 26, menge: r2 - 56 }
  }
  const tabKopf = () => {
    const s = sp()
    doc.setFillColor(242, 242, 242)
    doc.rect(L, y - 4.5, s.summe - L, 7, 'F')
    schrift('bold', 8.8, 40)
    doc.text('Pos.', s.nr + 1, y)
    doc.text('Leistung', s.bez, y)
    doc.text('Menge', s.menge, y, { align: 'right' })
    doc.text('Einzelpreis', s.preis, y, { align: 'right' })
    doc.text('Betrag', s.summe - 1, y, { align: 'right' })
    y += 7
  }
  platz(20)
  tabKopf()
  positionen.forEach((p, i) => {
    let s = sp()
    schrift('normal', 9.3)
    let zeilen = doc.splitTextToSize(sicher(p.bezeichnung), s.menge - 16 - s.bez) as string[]
    const hoehe = zeilen.length * 4.4 + 2.6
    if (platz(hoehe)) {
      tabKopf()
      s = sp()
      schrift('normal', 9.3)
      zeilen = doc.splitTextToSize(sicher(p.bezeichnung), s.menge - 16 - s.bez) as string[]
    }
    const preis = preisMitAufschlag(p.einzelpreis, auf)
    const einheit = p.einheit === 'Stunde' ? 'Std.' : p.einheit === 'Tag' ? (p.menge === 1 ? 'Tag' : 'Tage') : p.einheit
    doc.text(String(i + 1), s.nr + 1, y)
    doc.text(zeilen, s.bez, y)
    doc.text(`${zahl(p.menge)} ${einheit}`, s.menge, y, { align: 'right' })
    doc.text(euro(preis), s.preis, y, { align: 'right' })
    doc.text(euro(rundeAnzeige(p.menge * preis)), s.summe - 1, y, { align: 'right' })
    y += hoehe
    doc.setDrawColor(225)
    doc.line(L, y - 3, s.summe, y - 3)
  })

  // Summen
  platz(24)
  y += 3
  const s = sp()
  const summe = (label: string, wert: string, fett = false) => {
    schrift(fett ? 'bold' : 'normal', fett ? 10.5 : 9.8)
    doc.text(label, s.preis, y, { align: 'right' })
    doc.text(wert, s.summe - 1, y, { align: 'right' })
    y += fett ? 7 : 5.3
  }
  summe('Summe netto', euro(r.netto))
  summe(ust ? `zzgl. ${zahl(ust)} % Umsatzsteuer` : 'ohne Umsatzsteuer', ust ? euro(r.ust) : '–')
  doc.setDrawColor(150)
  doc.line(s.preis - 38, y - 3.4, s.summe, y - 3.4)
  summe('Gesamtbetrag', euro(r.brutto), true)
  y += 4

  if (art === 'angebot' && a.angebot) {
    if (a.angebot.schluss.trim()) {
      absatz(a.angebot.schluss)
      y += 4
    }
    platz(22)
    absatz('Mit freundlichen Grüßen')
    y += 12
    absatz(a.angebot.absender)
  } else {
    absatz(
      'Dieser Kostenvoranschlag ist unverbindlich und gilt 30 Tage ab Datum. Abgerechnet wird nach tatsächlichem Aufwand; zeichnet sich eine wesentliche Überschreitung ab, melden wir uns vorher.',
      9,
      'normal',
      90,
    )
  }

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
    doc.text(`${art === 'angebot' ? 'Angebot' : 'Kostenvoranschlag'} ${kvNummer(kv, art)} · Seite ${i} von ${seiten}`, R, sh - 11.5, { align: 'right' })
  }
  return doc.output('blob')
}

function rundeAnzeige(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
