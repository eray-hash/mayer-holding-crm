// Rechnungen und Mahnschreiben als PDF auf dem echten Briefbogen der Andreas Mayer Holding / Ulmer
// Wirtschaftskanzlei (Logo, Absenderzeile, Team-Spalte auf Seite 1, dreispaltige Fußzeile mit Bank,
// Steuernummer und Amtsgericht — holdingBriefbogenJspdf.ts; seit 24.11.2026 statt eines nachgebauten Kopfs).
// Pflichtangaben einer Rechnung (§ 14 UStG): Anschrift beider Seiten, Steuernummer (Fußzeile), Datum,
// fortlaufende Nummer, Leistung, Leistungszeitpunkt, Entgelt netto, Steuersatz und -betrag, Bruttobetrag.
import jsPDF from 'jspdf'
import { MAHNSTUFEN } from '../data/constants'
import { HOLDING_RAENDER, holdingAlleSeiten, holdingSatzspiegel } from './holdingBriefbogenJspdf'
import { bezahlteSumme, mahngebuehren, positionenFuerAnzeige, rundeCent, summeAusPositionen, ustSatzVon } from './rechnungen'
import type { MahnstufeId, Rechnung, RechnungMahnung } from '../types'

export const euroPdf = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
/** Beträge im Fließtext: jsPDF verschluckt mit der eingebauten Schrift das Leerzeichen nach „€“ — dort „EUR“. */
const euroText = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`
const zahl = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
export const deDatum = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('.') : iso ?? '')
const L = HOLDING_RAENDER.links
const heuteIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })

/** Nur Zeichen, die die eingebaute Helvetica kennt (wie vorlagePdf.ts). */
function sicher(text: string): string {
  return text
    .replace(/[→➜➤]/g, '->')
    .replace(/[✓✔]/g, 'x')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[^\u0000-ÿ€–—‘’‚“”„•…]/g, '?')
}

export const mahnstufeName = (s: MahnstufeId) => MAHNSTUFEN.find((m) => m.id === s)?.label ?? s

// ---------------------------------------------------------------------------------------------
// Satz auf dem Holding-Briefbogen: Inhalt im Satzspiegel, Absätze mit Seitenumbruch; Briefbogen und
// Seitenzahlen kommen am Ende auf alle Seiten (fertig).

class Briefbogen {
  doc = new jsPDF({ unit: 'mm', format: 'a4' })
  satz = holdingSatzspiegel(this.doc)
  seite = 1
  y = this.satz.obenErste

  /** Rechte Textgrenze: auf Seite 1 links der Team-Spalte. */
  rechts() {
    return this.seite === 1 ? this.satz.rechtsErste : this.satz.rechtsFolge
  }

  schrift(stil: 'normal' | 'bold', groesse: number, grau = 25) {
    this.doc.setFont('helvetica', stil)
    this.doc.setFontSize(groesse)
    this.doc.setTextColor(grau)
  }

  /** Neue Seite, wenn h Millimeter nicht mehr passen. */
  platz(h: number): boolean {
    if (this.y + h > this.satz.unten) {
      this.doc.addPage()
      this.seite++
      // 2 mm Luft mehr: der graue Tabellenkopf reicht über die Grundlinie hinaus bis an die Absenderzeile.
      this.y = this.satz.obenFolge + 2
      return true
    }
    return false
  }

  absatz(text: string, groesse = 10, stil: 'normal' | 'bold' = 'normal', grau = 25) {
    this.schrift(stil, groesse, grau)
    for (const roh of text.split('\n')) {
      const zeilen = roh.trim() ? (this.doc.splitTextToSize(sicher(roh), this.rechts() - L) as string[]) : ['']
      for (const z of zeilen) {
        this.platz(5)
        this.doc.text(z, L, this.y)
        this.y += groesse * 0.5
      }
    }
  }

  /** Empfänger links, darunter rechts Ort und Datum. */
  empfaengerUndDatum(empfaenger: string[], datum: string) {
    this.schrift('normal', 10)
    for (const z of empfaenger.map((x) => x.trim()).filter(Boolean)) {
      this.doc.text(sicher(z), L, this.y)
      this.y += 5
    }
    this.y += 6
    this.schrift('normal', 10, 70)
    this.doc.text(`Ulm, ${deDatum(datum)}`, this.rechts(), this.y, { align: 'right' })
    this.y += 9
  }

  /** Angaben wie "Rechnungsnummer: …" als zwei Spalten. */
  angaben(zeilen: [string, string][]) {
    for (const [label, wert] of zeilen) {
      this.platz(5)
      this.schrift('normal', 9.5, 90)
      this.doc.text(sicher(label), L, this.y)
      this.schrift('bold', 9.5, 35)
      const w = this.doc.splitTextToSize(sicher(wert), this.rechts() - L - 42) as string[]
      this.doc.text(w, L + 42, this.y)
      this.y += 4.8 * Math.max(1, w.length)
    }
  }

  /** Betragszeile rechtsbündig (Bezeichnung | Betrag). */
  summe(label: string, wert: string, fett = false, grau = 25) {
    const rechts = this.rechts()
    this.schrift(fett ? 'bold' : 'normal', fett ? 10.5 : 9.8, grau)
    this.doc.text(sicher(label), rechts - 30, this.y, { align: 'right' })
    this.doc.text(sicher(wert), rechts - 1, this.y, { align: 'right' })
    this.y += fett ? 7 : 5.3
  }

  linieUeberSumme() {
    const rechts = this.rechts()
    this.doc.setDrawColor(150)
    this.doc.line(rechts - 30 - 52, this.y - 3.4, rechts, this.y - 3.4)
  }

  gruss(absender: string) {
    // Gruß, Platz für die Unterschrift, Name. Wird es knapp über der Fußzeile, etwas weniger Platz zum
    // Unterschreiben, statt den Gruß allein auf eine neue Seite zu stellen.
    // Die Grundlinie des Namens darf bis satz.unten reichen (darunter ist noch Luft bis zur Fußzeile).
    const luft = this.y + 17 <= this.satz.unten ? 12 : 8
    this.platz(5 + luft)
    this.schrift('normal', 10)
    this.doc.text('Mit freundlichen Grüßen', L, this.y)
    this.y += 5 + luft
    this.doc.text(sicher(absender), L, this.y)
    this.y += 5
  }

  fertig(kennung: string): Blob {
    holdingAlleSeiten(this.doc, sicher(kennung))
    return this.doc.output('blob')
  }
}

// ---------------------------------------------------------------------------------------------
// Rechnung

export type RechnungPdfAngaben = {
  /** Empfänger: Name/Firma und Anschrift, eine Zeile je Eintrag. */
  empfaenger: string[]
  /** Name unter dem Gruß. */
  absender: string
  anrede?: string
}

export function rechnungPdfDateiname(r: Pick<Rechnung, 'nummer' | 'datum'>): string {
  return `Rechnung ${r.nummer.replace(/[\\/:*?"<>|]/g, '-').trim()} (${deDatum(r.datum)}).pdf`
}

export function erzeugeRechnungPdf(r: Rechnung, a: RechnungPdfAngaben): Blob {
  const b = new Briefbogen()
  const { doc } = b
  const positionen = positionenFuerAnzeige(r)
  const ust = ustSatzVon(r)
  // Ältere Rechnungen ohne Positionen: Beträge genau wie gespeichert (können von Hand eingetragen sein).
  const s = r.positionen?.length ? summeAusPositionen(r.positionen, ust) : { netto: r.betragNetto, ust: rundeCent(r.betragBrutto - r.betragNetto), brutto: r.betragBrutto }

  b.empfaengerUndDatum(a.empfaenger, r.datum)
  b.schrift('bold', 17, 25)
  doc.text('Rechnung', L, b.y)
  b.y += 8
  b.angaben([
    ['Rechnungsnummer', r.nummer],
    ['Rechnungsdatum', deDatum(r.datum)],
    [r.leistungszeitraum?.trim() ? 'Leistungszeitraum' : 'Leistungsdatum', r.leistungszeitraum?.trim() || 'entspricht dem Rechnungsdatum'],
    ...(r.ohneZahlungsfrist ? [] : [['Zahlbar bis', deDatum(r.zahlungsziel)] as [string, string]]),
  ])
  b.y += 5
  b.absatz(a.anrede?.trim() || 'Sehr geehrte Damen und Herren,')
  b.y += 2
  b.absatz('für unsere Leistungen erlauben wir uns, Ihnen Folgendes in Rechnung zu stellen:')
  b.y += 5

  // Tabelle
  const sp = () => {
    const r2 = b.rechts()
    return { nr: L, bez: L + 9, summe: r2, preis: r2 - 26, menge: r2 - 56 }
  }
  const tabKopf = () => {
    const c = sp()
    doc.setFillColor(242, 242, 242)
    doc.rect(L, b.y - 4.5, c.summe - L, 7, 'F')
    b.schrift('bold', 8.8, 40)
    doc.text('Pos.', c.nr + 1, b.y)
    doc.text('Leistung', c.bez, b.y)
    doc.text('Menge', c.menge, b.y, { align: 'right' })
    doc.text('Einzelpreis', c.preis, b.y, { align: 'right' })
    doc.text('Betrag', c.summe - 1, b.y, { align: 'right' })
    b.y += 7
  }
  b.platz(20)
  tabKopf()
  positionen.forEach((p, i) => {
    let c = sp()
    b.schrift('normal', 9.3)
    let zeilen = doc.splitTextToSize(sicher(p.bezeichnung || 'Leistung'), c.menge - 20 - c.bez) as string[]
    let hoehe = zeilen.length * 4.4 + 2.6
    if (b.platz(hoehe)) {
      tabKopf()
      c = sp()
      b.schrift('normal', 9.3)
      zeilen = doc.splitTextToSize(sicher(p.bezeichnung || 'Leistung'), c.menge - 20 - c.bez) as string[]
      // Auf der Folgeseite ist die Spalte breiter: weniger Zeilen, also auch weniger Höhe.
      hoehe = zeilen.length * 4.4 + 2.6
    }
    const einheit = p.einheit === 'Stunde' ? 'Std.' : p.einheit === 'Tag' ? (p.menge === 1 ? 'Tag' : 'Tage') : p.einheit
    doc.text(String(i + 1), c.nr + 1, b.y)
    doc.text(zeilen, c.bez, b.y)
    doc.text(`${zahl(p.menge)} ${einheit}`, c.menge, b.y, { align: 'right' })
    doc.text(euroPdf(p.einzelpreis), c.preis, b.y, { align: 'right' })
    doc.text(euroPdf(rundeCent(p.menge * p.einzelpreis)), c.summe - 1, b.y, { align: 'right' })
    b.y += hoehe
    doc.setDrawColor(225)
    doc.line(L, b.y - 3, c.summe, b.y - 3)
  })

  // Summen
  b.platz(34)
  b.y += 3
  b.summe('Summe netto', euroPdf(s.netto))
  b.summe(ust ? `zzgl. ${zahl(ust)} % Umsatzsteuer` : 'Umsatzsteuer 0 %', euroPdf(s.ust))
  b.linieUeberSumme()
  b.summe('Rechnungsbetrag', euroPdf(s.brutto), true)
  const gezahlt = bezahlteSumme(r)
  if (gezahlt > 0 && r.status !== 'Bezahlt') {
    b.summe('abzüglich bereits gezahlt', `– ${euroPdf(gezahlt)}`, false, 70)
    b.summe('Noch zu zahlen', euroPdf(Math.max(0, rundeCent(s.brutto - gezahlt))), true)
  }
  b.y += 4

  if (r.status === 'Bezahlt') {
    b.absatz(`Der Rechnungsbetrag wurde bereits beglichen${r.bezahltAm ? ` (Zahlungseingang am ${deDatum(r.bezahltAm)})` : ''}. Vielen Dank.`)
  } else {
    const offen = Math.max(0, rundeCent(s.brutto - gezahlt))
    b.absatz(`Bitte überweisen Sie den Betrag von ${euroText(offen)}${r.ohneZahlungsfrist ? '' : ` ohne Abzug bis zum ${deDatum(r.zahlungsziel)}`} unter Angabe der Rechnungsnummer ${r.nummer} auf das unten genannte Konto.`)
  }
  if (r.hinweis?.trim()) {
    b.y += 3
    b.absatz(r.hinweis.trim(), 9.5, 'normal', 60)
  }
  b.y += 4
  b.absatz('Vielen Dank für Ihren Auftrag und die gute Zusammenarbeit.')
  b.y += 4
  b.gruss(a.absender)
  return b.fertig(`Rechnung ${r.nummer}`)
}

// ---------------------------------------------------------------------------------------------
// Zahlungserinnerung und Mahnungen

export type MahnungPdfAngaben = {
  empfaenger: string[]
  absender: string
  stufe: MahnstufeId
  datum: string
  gebuehr: number
  neueFrist: string
  anrede: string
  /** Text vor der Aufstellung. */
  text: string
  /** Text nach der Aufstellung. */
  schluss: string
}

export function mahnungPdfDateiname(r: Pick<Rechnung, 'nummer'>, stufe: MahnstufeId, datum: string): string {
  return `${mahnstufeName(stufe)} zu Rechnung ${r.nummer.replace(/[\\/:*?"<>|]/g, '-').trim()} (${deDatum(datum)}).pdf`
}

/** Beträge eines Mahnschreibens: offener Rechnungsbetrag, frühere Gebühren, neue Gebühr, Summe. */
export function mahnBetraege(r: Rechnung, gebuehr: number) {
  const gezahlt = bezahlteSumme(r)
  const fruehere = mahngebuehren(r)
  const offen = Math.max(0, rundeCent(r.betragBrutto - gezahlt))
  return { brutto: r.betragBrutto, gezahlt, fruehere, gebuehr: rundeCent(gebuehr || 0), summe: rundeCent(offen + fruehere + (gebuehr || 0)) }
}

/** Vorschlag für Frist, Gebühr und Texte je Stufe (höflich, sachlich). */
export function mahnVorlage(r: Rechnung, stufe: MahnstufeId, datum = heuteIso()): { tage: number; gebuehr: number; text: string; schluss: string } {
  const frueher = (r.mahnungen ?? []).filter((m) => m.stufe !== 'inkasso')
  const bezug = `unsere Rechnung Nr. ${r.nummer} vom ${deDatum(r.datum)}`
  const liste = (ms: RechnungMahnung[]) => ms.map((m) => `${mahnstufeName(m.stufe)} vom ${deDatum(m.datum)}`).join(', ')
  void datum
  if (stufe === 'erinnerung') {
    return {
      tage: 7,
      gebuehr: 0,
      text: `sicherlich ist es Ihrer Aufmerksamkeit entgangen, dass ${bezug} noch nicht vollständig beglichen ist.${r.ohneZahlungsfrist ? '' : ` Die Zahlung war am ${deDatum(r.zahlungsziel)} fällig.`}\nWir bitten Sie freundlich, den unten aufgeführten Betrag bis zum genannten Datum zu überweisen.`,
      schluss: 'Sollten Sie die Zahlung in den letzten Tagen bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos. Bei Fragen zur Rechnung sind wir gerne für Sie da.',
    }
  }
  if (stufe === 'mahnung1') {
    return {
      tage: 10,
      gebuehr: 5,
      text: `leider konnten wir zu unserer Rechnung Nr. ${r.nummer} vom ${deDatum(r.datum)} bis heute keinen vollständigen Zahlungseingang feststellen${frueher.length ? ` – auch nicht nach unserer ${liste(frueher)}` : ''}.\nWir bitten Sie, den unten aufgeführten Betrag bis spätestens zum genannten Datum zu überweisen.`,
      schluss: 'Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos. Falls es Gründe für die Verzögerung gibt, sprechen Sie uns gerne an – gemeinsam finden wir eine Lösung.',
    }
  }
  if (stufe === 'mahnung2') {
    return {
      tage: 10,
      gebuehr: 5,
      text: `trotz unserer bisherigen Schreiben${frueher.length ? ` (${liste(frueher)})` : ''} ist ${bezug} weiterhin nicht vollständig bezahlt.\nWir fordern Sie hiermit letztmalig auf, den unten aufgeführten Gesamtbetrag bis spätestens zum genannten Datum zu überweisen.`,
      schluss: 'Sollte der Betrag bis zu diesem Datum nicht bei uns eingegangen sein, werden wir die Forderung ohne weitere Ankündigung an ein Inkassobüro übergeben oder das gerichtliche Mahnverfahren einleiten. Die dadurch entstehenden Kosten gehen zu Ihren Lasten.',
    }
  }
  return { tage: 0, gebuehr: 0, text: '', schluss: '' }
}

export function erzeugeMahnungPdf(r: Rechnung, a: MahnungPdfAngaben): Blob {
  const b = new Briefbogen()
  const { doc } = b
  const betraege = mahnBetraege(r, a.gebuehr)

  b.empfaengerUndDatum(a.empfaenger, a.datum)
  b.schrift('bold', 16, 25)
  doc.text(sicher(mahnstufeName(a.stufe)), L, b.y)
  b.y += 6
  b.schrift('normal', 9.5, 90)
  doc.text(sicher(`zu Rechnung Nr. ${r.nummer} vom ${deDatum(r.datum)}`), L, b.y)
  b.y += 9

  if (a.anrede.trim()) {
    b.absatz(a.anrede)
    b.y += 2
  }
  if (a.text.trim()) {
    b.absatz(a.text)
    b.y += 5
  }

  b.platz(40)
  b.summe(`Rechnungsbetrag (Rechnung ${r.nummer})`, euroPdf(betraege.brutto))
  if (betraege.gezahlt > 0) b.summe('abzüglich bereits gezahlt', `– ${euroPdf(betraege.gezahlt)}`)
  if (betraege.fruehere > 0) b.summe('Mahngebühren aus früheren Schreiben', euroPdf(betraege.fruehere))
  if (betraege.gebuehr > 0) b.summe('Mahngebühr', euroPdf(betraege.gebuehr))
  b.linieUeberSumme()
  b.summe('Zu zahlender Betrag', euroPdf(betraege.summe), true)
  b.y += 2
  b.schrift('bold', 10.5, 25)
  b.platz(8)
  doc.text(sicher(`Zahlbar bis spätestens ${deDatum(a.neueFrist)}`), L, b.y)
  b.y += 9

  b.absatz(`Bitte überweisen Sie den Betrag unter Angabe der Rechnungsnummer ${r.nummer} auf das unten genannte Konto.`)
  if (a.schluss.trim()) {
    b.y += 3
    b.absatz(a.schluss)
  }
  b.y += 4
  b.gruss(a.absender)
  return b.fertig(`${mahnstufeName(a.stufe)} zu Rechnung ${r.nummer}`)
}
