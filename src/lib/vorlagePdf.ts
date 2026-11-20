import jsPDF from 'jspdf'
import { hatKopfzeile, zerlegeVorlage, type InlineTeil, type VorlagenBlock } from './vorlagenFuellen'
import { BRIEFKOPF, type Briefkopf } from '../data/briefkopf'
import { MAYER_LOGO_PNG, MAYER_LOGO_VERHAELTNIS } from '../data/mayerLogo'

// Erzeugt aus einer ausgefüllten Vorlage ein A4-PDF mit Briefkopf. Nutzt dieselbe Zerlegung wie die
// Vorschau am Bildschirm (zerlegeVorlage), damit Druck und Vorschau nicht auseinanderlaufen.
//
// Schrift: die in jsPDF eingebaute Helvetica. Sie kennt nur westeuropäische Zeichen — Kästchen
// werden deshalb gezeichnet statt als Schriftzeichen gesetzt, und alles andere Unbekannte wird in
// `sicher` auf ein lesbares Ersatzzeichen abgebildet, statt als Fragezeichen-Salat zu erscheinen.

const ZEILE = 5
const KASTEN = 3.1

// ---- Kopfstile: jede Vorlage sieht aus wie ihr gescanntes Original (Scans vom 21.09.2026, SKM_C3350i…) ----
// Maße in mm, abgenommen von den Scans bzw. dem Word-Briefbogen „AMayer Holding Ulmer Wirtschaftskanzlei 01.09.2026“.
export type Kopfstil =
  | 'brief' // Brief: Logo, Rücksendezeile, Leiste „Ulmer Wirtschaftskanzlei“, Fußzeile mit Balken (10100-1, 10110-6)
  | 'fragebogen' // Logo + Rücksendezeile auf jeder Seite, Leiste im Rahmen auf Seite 1, Fußzeile (10080)
  | 'vertrag' // Logo auf jeder Seite, unten links „1 von 4“ (10040)
  | 'kopffelder' // kleines Logo oben links, daneben Bereich/Datum/Kunde/Telefon auf jeder Seite (10090)
  | 'protokoll' // kleines Logo oben links, Titel und erste Zeilen daneben (10100-7)
  | 'kooperation' // Logo, „in Kooperation“, rechts „Andreas Mayer Holding“, Fußzeile (10100-2/3)
  | 'schlicht' // ohne Briefkopf (10100-4/5)
  | 'schlichtSerif' // ohne Briefkopf, Serifenschrift (10100-6)
  | 'erben' // Logo + Rücksendezeile, unten „Vertrauliche Mandantenunterlage“, blaue Überschriften (10110)
  | 'memo' // ohne Logo, blauer Serifentitel (10120)
  | 'feedback' // Logo blass oben rechts (10121)

type Stil = {
  schrift: 'helvetica' | 'times'
  logo?: { x: number; y: number; breite: number; seiten: 'alle' | 'erste'; blass?: boolean }
  rueck?: { y: number; seiten: 'alle' | 'erste' }
  leiste?: 'frei' | 'rahmen'
  fuss: 'mayer' | 'mayerBalken' | 'vertraulich' | 'seitenzahlLinks' | 'keiner'
  kooperation?: boolean
  start1: number // Textbeginn Seite 1
  startN: number // Textbeginn Folgeseiten
  links: number
  rechts: number // rechter Rand (ohne Leiste)
  unten: number
  titelMitte?: boolean
  titelFarbe?: [number, number, number]
  ueberFarbe?: [number, number, number]
  kopfFuellung?: [number, number, number] // Tabellenkopf
  nebenLogo?: number // Text neben dem Logo beginnt bei x (solange er auf Logohöhe liegt)
  titel?: { groesse: number; fett: boolean } // Abweichende Titelschrift
  untertitelSchwarz?: boolean // erste Überschrift direkt nach dem Titel: schwarz, 12,5 pt (Erben-Fragebogen)
  handZeile?: number // Luft über Zeilen zum Ausfüllen von Hand
  kopfFelderNachVorn?: boolean // „Bereich: … / Kunde: …“ vor den Titel ziehen und auf jeder Seite neben dem Logo wiederholen
  /** Zeilenabstand des Fließtexts in mm (Standard ZEILE) — enger, wo die Vorlage auf wenige Seiten passen muss. */
  zeile?: number
  mitteBisParagraf?: boolean // Parteienblock (vor „§ 1“) mittig, wie die Vereinbarung im Scan
}

const LOGO_STANDARD = { x: 16.5, y: 9.4, breite: 24 }
const BLAU: [number, number, number] = [46, 116, 181]
const STILE: Record<Kopfstil, Stil> = {
  brief: { schrift: 'times', logo: { ...LOGO_STANDARD, seiten: 'alle' }, rueck: { y: 41.2, seiten: 'erste' }, leiste: 'frei', fuss: 'mayerBalken', start1: 49, startN: 45, links: 21, rechts: 61, unten: 40 },
  fragebogen: { schrift: 'helvetica', logo: { ...LOGO_STANDARD, seiten: 'alle' }, rueck: { y: 38.5, seiten: 'alle' }, leiste: 'rahmen', fuss: 'mayer', start1: 47, startN: 47, links: 21, rechts: 18, unten: 30, titel: { groesse: 10.5, fett: false }, handZeile: 4.2 },
  // Etwas enger als der Scan (Logo höher, Zeilen 4,5 mm), damit die Vereinbarung auf zwei Seiten passt (Erays Wunsch, 20.11.2026).
  vertrag: { schrift: 'times', logo: { x: 17, y: 18, breite: 22, seiten: 'alle' }, fuss: 'seitenzahlLinks', start1: 58, startN: 50, links: 21, rechts: 20, unten: 20, titel: { groesse: 16, fett: true }, zeile: 4.5 },
  kopffelder: { schrift: 'helvetica', logo: { x: 15, y: 9, breite: 15, seiten: 'alle' }, fuss: 'keiner', start1: 13, startN: 13, links: 21, rechts: 18, unten: 18, nebenLogo: 34, kopfFelderNachVorn: true, titel: { groesse: 12.5, fett: true } },
  protokoll: { schrift: 'helvetica', logo: { x: 12, y: 8, breite: 15, seiten: 'erste' }, fuss: 'keiner', start1: 13, startN: 18, links: 14, rechts: 14, unten: 18, nebenLogo: 33, titel: { groesse: 12.5, fett: false } },
  kooperation: { schrift: 'helvetica', logo: { x: 18, y: 25, breite: 20, seiten: 'alle' }, kooperation: true, fuss: 'mayer', start1: 72, startN: 58, links: 25, rechts: 22, unten: 30, titelMitte: true, titel: { groesse: 13, fett: true }, handZeile: 3.5 },
  schlicht: { schrift: 'helvetica', fuss: 'keiner', start1: 30, startN: 20, links: 25, rechts: 22, unten: 18, titelMitte: true, titel: { groesse: 11, fett: true }, mitteBisParagraf: true },
  schlichtSerif: { schrift: 'times', fuss: 'keiner', start1: 52, startN: 25, links: 25, rechts: 22, unten: 22, titel: { groesse: 11, fett: false }, handZeile: 3.5 },
  erben: { schrift: 'helvetica', logo: { x: 18, y: 12, breite: 22, seiten: 'alle' }, rueck: { y: 43.5, seiten: 'alle' }, fuss: 'vertraulich', start1: 52, startN: 50, links: 21, rechts: 18, unten: 20, titelMitte: true, titel: { groesse: 17, fett: true }, untertitelSchwarz: true, ueberFarbe: BLAU, kopfFuellung: [200, 200, 200] },
  memo: { schrift: 'times', fuss: 'keiner', start1: 26, startN: 20, links: 23, rechts: 20, unten: 18, titel: { groesse: 15, fett: true }, titelFarbe: [79, 129, 189], ueberFarbe: [79, 129, 189] },
  feedback: { schrift: 'helvetica', logo: { x: 177, y: 9, breite: 15, seiten: 'erste', blass: true }, fuss: 'keiner', start1: 24, startN: 18, links: 22, rechts: 20, unten: 18, kopfFuellung: [244, 204, 204] },
}

/** Kopfstil einer Vorlage nach ihrem Namen — wie das gescannte Original aussieht. */
export function kopfstilFuer(name: string): Kopfstil {
  const n = name.toLowerCase()
  if (/anschreiben|rechnung/.test(n)) return 'brief'
  if (/mandantenfragebogen.*(unternehmen|privat)/.test(n)) return 'fragebogen'
  if (/mandantenfragebogen|nachfolgeplanung/.test(n)) return 'erben'
  if (/beratungsvereinbarung/.test(n)) return 'vertrag'
  if (/vollmacht.*(finanzamt|bank)/.test(n)) return 'kooperation'
  if (/allgemeine vollmacht/.test(n)) return 'schlichtSerif'
  if (/geheimhaltung|quellenschutz|\bnda\b/.test(n)) return 'schlicht'
  if (/mandantenmemo/.test(n)) return 'memo'
  if (/feedbackbogen/.test(n)) return 'feedback'
  if (/gesprächsprotokoll|gespraechsprotokoll/.test(n)) return 'protokoll'
  if (/beratungsfragen|steuerberater|unterlagen|checkliste/.test(n)) return 'kopffelder'
  return 'fragebogen'
}

function sicher(text: string): string {
  return text
    .replace(/[→➜➤]/g, '->')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[✓✔]/g, 'x')
    .replace(/ /g, ' ')
    .replace(/[^\u0000-ÿ€–—‘’‚“”„•…]/g, '?')
}

type Wort = { text: string; breite: number; kasten?: 'leer' | 'an'; linie?: boolean; feld?: boolean; nachLeer: boolean; fett?: boolean }

export function erzeugeVorlagePdf(params: {
  text: string
  werte: Record<string, string>
  angekreuzt: ReadonlySet<number>
  briefkopf?: Briefkopf
  /** Kopfstil; ohne Angabe 'fragebogen'. Passend zur Vorlage: kopfstilFuer(vorlage.name). */
  kopfstil?: Kopfstil
}): jsPDF {
  const kopf = params.briefkopf ?? BRIEFKOPF
  const st = STILE[params.kopfstil ?? 'fragebogen']
  const FAM = st.schrift
  const LINKS = st.links
  const UNTEN = st.unten
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const seitenBreite = doc.internal.pageSize.getWidth()
  const seitenHoehe = doc.internal.pageSize.getHeight()
  const leiste = st.leiste && kopf.seitenleiste.length > 0 ? st.leiste : undefined
  // Leiste „frei“ (Brief) liegt rechts im Rand (st.rechts = 61); „rahmen“ (Fragebogen) verkleinert Seite 1.
  const breiteSeite1 = leiste === 'rahmen' ? 152 - LINKS - 5 : seitenBreite - LINKS - st.rechts
  const breiteFolge = seitenBreite - LINKS - (st.fuss === 'mayerBalken' ? st.rechts : Math.min(st.rechts, 22))
  let seite = 1
  let y = st.start1
  const logoUnten = st.logo ? st.logo.y + st.logo.breite / MAYER_LOGO_VERHAELTNIS + 1.5 : 0
  let kopfWiederholung = false
  const nebenLogo = () => !!st.nebenLogo && (seite === 1 || kopfWiederholung) && y < logoUnten
  const xStart = () => (nebenLogo() ? st.nebenLogo! : LINKS)
  const textBreite = () => (seite === 1 ? breiteSeite1 : breiteFolge) - (xStart() - LINKS)

  const schrift = (stil: 'normal' | 'bold', groesse: number, grau = 20) => {
    doc.setFont(FAM, stil)
    doc.setFontSize(groesse)
    doc.setTextColor(grau)
  }
  let farbe: [number, number, number] | null = null
  const setzeFarbe = () => {
    if (farbe) doc.setTextColor(farbe[0], farbe[1], farbe[2])
  }

  /** Zeilen der Fußzeile in drei Spalten, wie im Original (links / Mitte / rechts). */
  function fussSpalten(): string[][] {
    const teile = kopf.fusszeilen.map((z) => z.split('·').map((t) => t.trim()).filter(Boolean))
    const rechts = (teile[2] ?? []).flatMap((t) => (t.startsWith('GF:') && t.includes(', ') ? [t.slice(0, t.indexOf(', ')), t.slice(t.indexOf(', ') + 2)] : [t]))
    return [teile[0] ?? [], teile[1] ?? [], rechts]
  }

  function logoZeichnen(s: number) {
    const l = st.logo
    if (!l || (l.seiten === 'erste' && s > 1)) return
    const hoehe = l.breite / MAYER_LOGO_VERHAELTNIS
    if (l.blass) {
      const g = new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 0.35 })
      ;(doc as unknown as { setGState: (g: unknown) => void }).setGState(g)
    }
    doc.addImage(MAYER_LOGO_PNG, 'PNG', l.x, l.y, l.breite, hoehe)
    if (l.blass) {
      const g = new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 1 })
      ;(doc as unknown as { setGState: (g: unknown) => void }).setGState(g)
    }
  }

  function kopfZeichnen(s: number) {
    logoZeichnen(s)
    if (st.rueck && (st.rueck.seiten === 'alle' || s === 1)) {
      const t = sicher(kopf.unterzeilen[0]?.replace(/\s*·\s*/g, ' ') ?? '')
      doc.setFont('times', 'normal')
      doc.setFontSize(st.schrift === 'times' ? 8.2 : 7.5)
      doc.setTextColor(0)
      doc.text(t, LINKS, st.rueck.y)
      doc.setDrawColor(0)
      doc.setLineWidth(0.15)
      doc.line(LINKS, st.rueck.y + 0.7, LINKS + doc.getTextWidth(t), st.rueck.y + 0.7)
    }
    if (st.kooperation) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(60)
      doc.text('in Kooperation', 43, 42)
      doc.setFont('times', 'bold')
      doc.setFontSize(24)
      doc.setTextColor(236, 168, 120)
      doc.text(sicher(kopf.name === 'Mayer Consulting' ? 'Andreas Mayer Holding' : kopf.name), seitenBreite - 17, 33, { align: 'right' })
      doc.setFont('times', 'normal')
      doc.setFontSize(7.5)
      const [l1, , r1] = fussSpalten()
      const zeilen = [l1[1], l1[2], r1[0], r1[1]].filter(Boolean) as string[]
      zeilen.forEach((z, i) => doc.text(sicher(z), seitenBreite - 17, 37.5 + i * 3.2, { align: 'right' }))
    }
    if (s === 1 && leiste) {
      const lx = leiste === 'rahmen' ? 156 : 158.2
      let ly = leiste === 'rahmen' ? 22 : 21
      if (leiste === 'rahmen') {
        doc.setDrawColor(60)
        doc.setLineWidth(0.3)
        doc.rect(152, 13, 43, 172)
      }
      for (const eintrag of kopf.seitenleiste) {
        if (!eintrag.zeilen.length) {
          doc.setFont('times', 'bold')
          doc.setFontSize(leiste === 'rahmen' ? 10.5 : 14.5)
          doc.setTextColor(0)
          for (const teil of eintrag.titel.split(' ')) {
            doc.text(sicher(teil), lx, ly)
            ly += leiste === 'rahmen' ? 4.4 : 5.6
          }
          ly += leiste === 'rahmen' ? 5 : 8.5
          continue
        }
        doc.setFont('times', 'bold')
        doc.setFontSize(leiste === 'rahmen' ? 6.8 : 8.6)
        doc.setTextColor(0)
        doc.text(sicher(eintrag.titel), lx, ly)
        ly += leiste === 'rahmen' ? 2.6 : 3.05
        doc.setFont('times', 'normal')
        doc.setFontSize(leiste === 'rahmen' ? 6.3 : 8.3)
        for (const z of eintrag.zeilen) {
          for (const teil of doc.splitTextToSize(sicher(z), leiste === 'rahmen' ? 36 : 47) as string[]) {
            doc.text(teil, lx, ly)
            ly += leiste === 'rahmen' ? 2.5 : 3.05
          }
        }
        ly += leiste === 'rahmen' ? 4.2 : 5.5
      }
    }
  }

  function neueSeite() {
    doc.addPage()
    seite++
    y = st.kopfFelderNachVorn ? Math.max(st.startN, logoUnten + 2) : st.startN
  }
  // Im Messlauf (hoeheVon) wird nur gerechnet: nichts gezeichnet, kein Seitenwechsel.
  let messen = false
  const platz = (hoehe: number) => {
    if (!messen && y + hoehe > seitenHoehe - UNTEN) neueSeite()
  }

  // Aktueller Grundstil des Absatzes; fette Textteile weichen davon ab und müssen in ihrer eigenen
  // Schrift gemessen werden, sonst stimmen Umbruch und Abstände nicht.
  let grundStil: 'normal' | 'bold' = 'normal'
  let grundGroesse = 9.5
  let inTabelle = false

  function worte(teile: InlineTeil[]): Wort[] {
    const liste: Wort[] = []
    for (const t of teile) {
      schrift(grundStil, grundGroesse)
      if (t.art === 'kaestchen') {
        liste.push({ text: '', breite: KASTEN + 1, kasten: params.angekreuzt.has(t.nr) ? 'an' : 'leer', nachLeer: false })
        continue
      }
      if (t.art === 'feld') {
        const wert = params.werte[t.name]?.trim()
        // Ob nach dem Feld ein Abstand folgt, bestimmt der Text dahinter (z. B. kein Abstand vor einem Punkt).
        if (!wert) {
          liste.push({ text: '', breite: inTabelle ? 14 : 42, linie: true, feld: true, nachLeer: false })
          continue
        }
        const fett = t.fett || grundStil === 'bold'
        schrift(fett ? 'bold' : 'normal', grundGroesse)
        const stuecke = sicher(wert).split(/\s+/)
        stuecke.forEach((w, i) => liste.push({ text: w, breite: doc.getTextWidth(w), nachLeer: i < stuecke.length - 1, fett }))
        continue
      }
      const fett = t.fett || grundStil === 'bold'
      schrift(fett ? 'bold' : 'normal', grundGroesse)
      // Lange Unterstrich-Linien (Unterschriftsfelder) als gezeichnete Linie, damit sie umbrechen können.
      for (const s of sicher(t.text).split(/(\s+)/)) {
        if (!s) continue
        if (/^\s+$/.test(s)) {
          if (liste.length) liste[liste.length - 1].nachLeer = true
          continue
        }
        if (/^_{4,}$/.test(s)) liste.push({ text: '', breite: Math.min(70, s.length * 1.9), linie: true, nachLeer: false })
        else liste.push({ text: s, breite: doc.getTextWidth(s), nachLeer: false, fett })
      }
    }
    schrift(grundStil, grundGroesse)
    return liste
  }

  /** Bricht Worte auf die Breite um; liefert Zeilen. */
  function umbrechen(liste: Wort[], breite: number): Wort[][] {
    const leer = doc.getTextWidth(' ')
    const zeilen: Wort[][] = [[]]
    let x = 0
    for (const w of liste) {
      const akt = zeilen[zeilen.length - 1]
      const abstand = akt.length && akt[akt.length - 1].nachLeer ? leer : 0
      // Ein leeres Feld rutscht nicht in die nächste Zeile, solange noch ein brauchbares Stück Linie passt.
      const rest = breite - x - abstand
      if (w.feld && akt.length && x + abstand + w.breite > breite && rest >= 18) {
        akt.push({ ...w, breite: rest })
        x = breite
        continue
      }
      if (akt.length && x + abstand + w.breite > breite) {
        zeilen.push([w])
        x = w.breite
      } else {
        x += abstand + w.breite
        akt.push(w)
      }
    }
    return zeilen
  }

  function zeichneZeile(zeile: Wort[], x0: number, yy: number) {
    if (messen) return
    const leer = doc.getTextWidth(' ')
    let x = x0
    zeile.forEach((w, i) => {
      if (i > 0 && zeile[i - 1].nachLeer) x += leer
      if (w.kasten) {
        doc.setDrawColor(60)
        doc.setLineWidth(0.25)
        doc.rect(x, yy - KASTEN + 0.4, KASTEN, KASTEN)
        if (w.kasten === 'an') {
          doc.line(x + 0.5, yy - KASTEN + 0.9, x + KASTEN - 0.5, yy - 0.1)
          doc.line(x + KASTEN - 0.5, yy - KASTEN + 0.9, x + 0.5, yy - 0.1)
        }
      } else if (w.linie) {
        doc.setDrawColor(120)
        doc.setLineWidth(0.2)
        doc.line(x, yy + 0.6, x + w.breite, yy + 0.6)
      } else {
        doc.setFont(FAM, w.fett ? 'bold' : 'normal')
        setzeFarbe()
        doc.text(w.text, x, yy)
      }
      x += w.breite
    })
  }

  function absatz(teile: InlineTeil[], stil: 'normal' | 'bold', groesse: number, zeilenhoehe: number, einzug = 0) {
    grundStil = stil
    grundGroesse = groesse
    schrift(stil, groesse)
    const x0 = xStart() + Math.min(einzug, 12) * 1.6
    const breite = textBreite() - (x0 - xStart())
    const leer = doc.getTextWidth(' ')
    for (let z of umbrechen(worte(teile), breite)) {
      // Endet die Zeile mit einem leeren Feld hinter einer Bezeichnung (z. B. "Anschrift: ____"), reicht
      // die Linie bis zum Rand und die Zeile bekommt etwas Luft darüber — Platz zum Ausfüllen von Hand.
      const letztes = z[z.length - 1]
      // In den Formular-Stilen (mit handZeile) gilt das auch für eine Zeile, die nur aus einer Schreiblinie
      // besteht — wie im Scan der Allgemeinen Vollmacht („wohnhaft“ und darunter eine Linie über die ganze Breite).
      const nurLinie = !!st.handZeile && z.length === 1 && !!letztes?.linie
      const vonHand = !inTabelle && ((!!letztes?.feld && z.length > 1 && /:$/.test(z[z.length - 2].text)) || nurLinie)
      if (vonHand) {
        const x = z.slice(0, -1).reduce((summe, w) => summe + w.breite + (w.nachLeer ? leer : 0), 0)
        z = [...z.slice(0, -1), { ...letztes, breite: Math.max(letztes.breite, breite - x) }]
      }
      const vorlauf = vonHand ? (st.handZeile ?? 2.6) : 0
      platz(vorlauf + zeilenhoehe)
      y += vorlauf
      schrift(stil, groesse)
      const zeilenBreite = () => z.reduce((summe, w, i) => summe + w.breite + (i > 0 && z[i - 1].nachLeer ? leer : 0), 0)
      if (titelMitte) zeichneZeile(z, xStart() + (breite - zeilenBreite()) / 2, y)
      else if (rechtsBuendig) zeichneZeile(z, xStart() + breite - zeilenBreite(), y)
      else zeichneZeile(z, x0, y)
      y += zeilenhoehe
    }
  }

  function tabelle(zeilen: InlineTeil[][][]) {
    const spalten = Math.max(...zeilen.map((z) => z.length))
    inTabelle = true
    grundStil = 'normal'
    grundGroesse = 8.5
    schrift('normal', 8.5)
    // Spaltenbreiten nach längstem Inhalt, aber keine Spalte schmaler als 14 % der Tabelle.
    const laenge = Array.from({ length: spalten }, (_, s) =>
      Math.max(6, ...zeilen.map((z) => worte(z[s] ?? []).reduce((sum, w) => sum + w.breite + 1, 0))),
    )
    const begrenzt = laenge.map((l) => Math.min(l, 70))
    const summe = begrenzt.reduce((a, b) => a + b, 0)
    const zeichne = (zeile: InlineTeil[][], istKopf: boolean) => {
      const gesamt = textBreite()
      const breiten = begrenzt.map((l) => Math.max(gesamt * 0.14, (l / summe) * gesamt))
      const faktor = gesamt / breiten.reduce((a, b) => a + b, 0)
      const b = breiten.map((x) => x * faktor)
      grundStil = istKopf ? 'bold' : 'normal'
      schrift(grundStil, 8.5)
      const zellen = Array.from({ length: spalten }, (_, s) => umbrechen(worte(zeile[s] ?? []), b[s] - 3))
      const hoehe = Math.max(1, ...zellen.map((z) => z.length)) * 4.2 + 2.6
      platz(hoehe)
      let x = xStart()
      zellen.forEach((zelle, s) => {
        doc.setDrawColor(170)
        doc.setLineWidth(0.2)
        if (messen) {
          // nur messen
        } else if (istKopf) {
          const f = st.kopfFuellung ?? [242, 242, 242]
          doc.setFillColor(f[0], f[1], f[2])
          doc.rect(x, y - 3.6, b[s], hoehe, 'FD')
        } else {
          doc.rect(x, y - 3.6, b[s], hoehe)
        }
        schrift(istKopf ? 'bold' : 'normal', 8.5)
        zelle.forEach((zl, i) => zeichneZeile(zl, x + 1.5, y + i * 4.2))
        x += b[s]
      })
      y += hoehe
    }
    const mitKopf = hatKopfzeile(zeilen)
    zeilen.forEach((z, i) => zeichne(z, i === 0 && mitKopf))
    inTabelle = false
    y += 2.5
  }

  /**
   * Spalten ohne Rahmen (Auszeichnung `a || b`), gleich breit nebeneinander — gedacht für die
   * Unterschriften beider Vertragsseiten. Eine Zeile mit Unterstrich-Linie bekommt Platz zum
   * Unterschreiben darüber; Linien am Zeilenende (auch leere Felder) reichen bis zum Spaltenrand.
   */
  function spalten(zeilen: InlineTeil[][][]) {
    const anzahl = Math.max(...zeilen.map((z) => z.length))
    const luecke = 10
    const b = (textBreite() - luecke * (anzahl - 1)) / anzahl
    const mitKopf = hatKopfzeile(zeilen)
    zeilen.forEach((zeile, zi) => {
      const istKopf = zi === 0 && mitKopf
      grundStil = istKopf ? 'bold' : 'normal'
      grundGroesse = 9.5
      schrift(grundStil, grundGroesse)
      const leer = doc.getTextWidth(' ')
      const zellen = Array.from({ length: anzahl }, (_, s) =>
        umbrechen(worte(zeile[s] ?? []), b).map((zl, i, alle) => {
          const letztes = zl[zl.length - 1]
          if (i < alle.length - 1 || !letztes?.linie) return zl
          // Anfang der Linie = Breite aller Worte davor samt Abständen.
          const x = zl.slice(0, -1).reduce((summe, w) => summe + w.breite + (w.nachLeer ? leer : 0), 0)
          return [...zl.slice(0, -1), { ...letztes, breite: Math.max(letztes.breite, b - x - 2) }]
        }),
      )
      const unterschrift = zeile.some((zelle) => zelle.some((t) => t.art === 'text' && /_{4,}/.test(t.text)))
      const vorlauf = unterschrift ? 9 : 0
      const zeilenZahl = Math.max(1, ...zellen.map((z) => z.length))
      platz(vorlauf + zeilenZahl * ZEILE)
      y += vorlauf
      zellen.forEach((zelle, s) => {
        schrift(grundStil, grundGroesse)
        zelle.forEach((zl, i) => zeichneZeile(zl, LINKS + s * (b + luecke), y + i * ZEILE))
      })
      y += zeilenZahl * ZEILE + (istKopf ? 0.4 : 0.8)
    })
    grundStil = 'normal'
    y += 1.5
  }

  let leerFolge = 0
  let titelMitte = false
  let rechtsBuendig = false
  let ersteUeberschrift = true
  let paragrafErreicht = false
  function setze(block: VorlagenBlock) {
    if (block.art !== 'ueberschrift' && block.art !== 'leer' && block.art !== 'titel') ersteUeberschrift = false
    if (block.art === 'leer') {
      if (leerFolge++ < 1) y += (st.zeile ?? ZEILE) * 0.7
      return
    }
    leerFolge = 0
    if (block.art === 'titel') {
      platz(12)
      farbe = st.titelFarbe ?? null
      titelMitte = !!st.titelMitte
      const t = st.titel ?? { groesse: 14.5, fett: true }
      absatz(block.teile, t.fett ? 'bold' : 'normal', t.groesse, t.groesse * 0.47)
      titelMitte = false
      farbe = null
      y += 2
    } else if (block.art === 'ueberschrift') {
      platz(12)
      y += 1.5
      const untertitel = !!st.titelMitte && ersteUeberschrift
      farbe = untertitel && st.untertitelSchwarz ? null : (st.ueberFarbe ?? null)
      titelMitte = untertitel
      ersteUeberschrift = false
      const gross = untertitel && st.untertitelSchwarz ? 12.5 : st.titel && !st.titel.fett ? 10 : 10.5
      absatz(block.teile, st.titel && !st.titel.fett && !untertitel ? 'normal' : 'bold', gross, gross * 0.52)
      if (/^§\s*1\b/.test(block.teile.map((x) => (x.art === 'text' ? x.text : '')).join('').trim())) paragrafErreicht = true
      titelMitte = false
      farbe = null
      y += 0.8
    } else if (block.art === 'zeile') {
      const roh = block.teile.map((x) => (x.art === 'text' ? x.text : '')).join('').trim()
      if (/^§\s*1\b/.test(roh)) paragrafErreicht = true
      titelMitte = !!st.mitteBisParagraf && !paragrafErreicht && !/^wird\b/i.test(roh)
      // Brief: Datumszeile „Ulm, den …“ rechtsbündig wie im Original (10100-1, 10110-6)
      rechtsBuendig = st.fuss === 'mayerBalken' && /^[A-ZÄÖÜ][\wäöüß.-]*,\s+den\b/.test(roh)
      absatz(block.teile, 'normal', st.schrift === 'times' ? 10.5 : 9.5, st.zeile ?? ZEILE, block.einzug)
      titelMitte = false
      rechtsBuendig = false
    } else if (block.rahmenlos) {
      spalten(block.zeilen)
    } else {
      tabelle(block.zeilen)
    }
  }

  /** Höhe, die Blöcke ab der aktuellen Stelle brauchen würden — ohne zu zeichnen. */
  function hoeheVon(liste: VorlagenBlock[]): number {
    const [y0, folge0, erste0, paragraf0] = [y, leerFolge, ersteUeberschrift, paragrafErreicht]
    messen = true
    y = 0
    liste.forEach(setze)
    const hoehe = y
    messen = false
    y = y0
    leerFolge = folge0
    ersteUeberschrift = erste0
    paragrafErreicht = paragraf0
    return hoehe
  }

  const alleBloecke = zerlegeVorlage(params.text)
  // Scans 10090/10100-7: „Bereich: … Datum: …“ und „Kunde: … Telefon: …“ stehen oben neben dem Logo, auf jeder Seite.
  const istKopfFeld = (b: VorlagenBlock) =>
    b.art === 'zeile' && /^(bereich|kunde|ort)\b/i.test(b.teile.map((x) => (x.art === 'text' ? x.text : '')).join('').trim())
  const kopfFelder: VorlagenBlock[] = st.kopfFelderNachVorn ? alleBloecke.slice(0, 6).filter(istKopfFeld) : []
  const bloecke = kopfFelder.length ? [...kopfFelder, { art: 'leer' } as VorlagenBlock, ...alleBloecke.filter((b) => !kopfFelder.includes(b))] : alleBloecke
  bloecke.forEach((block, i) => {
    if (block.art === 'ueberschrift') {
      let ende = i + 1
      while (ende < bloecke.length && bloecke[ende].art !== 'ueberschrift' && bloecke[ende].art !== 'titel') ende++
      const abschnitt = bloecke.slice(i, ende)
      const frei = seitenHoehe - UNTEN - y
      // Der Unterschriftenteil (Spalten ohne Rahmen) bleibt mit seiner Überschrift auf einer Seite;
      // sonst steht eine Überschrift nie allein am Seitenende, sondern mit mindestens zwei Zeilen Text.
      const zusammen = abschnitt.some((b) => b.art === 'tabelle' && b.rahmenlos)
      const noetig = zusammen ? hoeheVon(abschnitt) : hoeheVon([block]) + 2 * ZEILE
      if (noetig > frei && noetig < seitenHoehe - UNTEN - st.startN - 10) neueSeite()
    }
    setze(block)
  })

  const seiten = doc.getNumberOfPages()
  for (let s = 1; s <= seiten; s++) {
    doc.setPage(s)
    kopfZeichnen(s)
    if (s > 1 && kopfFelder.length) {
      const [seiteVorher, yVorher] = [seite, y]
      seite = s
      y = st.startN
      kopfWiederholung = true
      kopfFelder.forEach(setze)
      kopfWiederholung = false
      seite = seiteVorher
      y = yVorher
    }
    if (st.fuss === 'mayer' || st.fuss === 'mayerBalken') {
      if (st.fuss === 'mayerBalken') {
        doc.setFillColor(247, 141, 75)
        doc.rect(159.6, 262.9, 46.2, 3.6, 'F')
      }
      const [l, m, r] = fussSpalten()
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.8)
      doc.setTextColor(0)
      const fy = [273.6, 276.9, 280.1, 283.4]
      l.forEach((t, i) => doc.text(sicher(t), 21.5, fy[i] ?? fy[3] + (i - 3) * 3.3))
      m.forEach((t, i) => doc.text(sicher(t), 101.6, fy[i] ?? fy[3] + (i - 3) * 3.3, { align: 'center' }))
      r.forEach((t, i) => doc.text(sicher(t), 181.7, fy[i] ?? fy[3] + (i - 3) * 3.3, { align: 'right' }))
    } else if (st.fuss === 'vertraulich') {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(30)
      doc.text('Vertrauliche Mandantenunterlage', seitenBreite / 2, seitenHoehe - 9, { align: 'center' })
    } else if (st.fuss === 'seitenzahlLinks') {
      doc.setFont(FAM, 'normal')
      doc.setFontSize(9)
      doc.setTextColor(30)
      doc.text(`${s} von ${seiten}`, LINKS, seitenHoehe - 10)
    }
  }
  return doc
}
