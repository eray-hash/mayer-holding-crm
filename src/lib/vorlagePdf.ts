import jsPDF from 'jspdf'
import { hatKopfzeile, zerlegeVorlage, type InlineTeil, type VorlagenBlock } from './vorlagenFuellen'
import { BRIEFKOPF, type Briefkopf } from '../data/briefkopf'

// Erzeugt aus einer ausgefüllten Vorlage ein A4-PDF mit Briefkopf. Nutzt dieselbe Zerlegung wie die
// Vorschau am Bildschirm (zerlegeVorlage), damit Druck und Vorschau nicht auseinanderlaufen.
//
// Schrift: die in jsPDF eingebaute Helvetica. Sie kennt nur westeuropäische Zeichen — Kästchen
// werden deshalb gezeichnet statt als Schriftzeichen gesetzt, und alles andere Unbekannte wird in
// `sicher` auf ein lesbares Ersatzzeichen abgebildet, statt als Fragezeichen-Salat zu erscheinen.

const LINKS = 22
const OBEN = 18
const UNTEN = 22
const ZEILE = 5
const KASTEN = 3.1

function sicher(text: string): string {
  return text
    .replace(/[→➜➤]/g, '->')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[✓✔]/g, 'x')
    .replace(/ /g, ' ')
    .replace(/[^\u0000-ÿ€–—‘’‚“”„•…]/g, '?')
}

type Wort = { text: string; breite: number; kasten?: 'leer' | 'an'; linie?: boolean; nachLeer: boolean; fett?: boolean }

export function erzeugeVorlagePdf(params: {
  text: string
  werte: Record<string, string>
  angekreuzt: ReadonlySet<number>
  briefkopf?: Briefkopf
}): jsPDF {
  const kopf = params.briefkopf ?? BRIEFKOPF
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const seitenBreite = doc.internal.pageSize.getWidth()
  const seitenHoehe = doc.internal.pageSize.getHeight()
  const leisteBreite = kopf.seitenleiste.length > 0 ? 42 : 0
  const breiteMitLeiste = seitenBreite - LINKS - 16 - leisteBreite - (leisteBreite ? 6 : 0)
  const breiteOhneLeiste = seitenBreite - LINKS - 18
  let seite = 1
  let y = OBEN
  const textBreite = () => (seite === 1 ? breiteMitLeiste : breiteOhneLeiste)

  const schrift = (stil: 'normal' | 'bold', groesse: number, grau = 20) => {
    doc.setFont('helvetica', stil)
    doc.setFontSize(groesse)
    doc.setTextColor(grau)
  }

  function kopfZeichnen() {
    schrift('bold', 13, 25)
    doc.text(sicher(kopf.name), LINKS, OBEN)
    schrift('normal', 8.5, 90)
    let ky = OBEN + 5
    for (const z of kopf.unterzeilen) {
      doc.text(sicher(z), LINKS, ky)
      ky += 3.8
    }
    doc.setDrawColor(190)
    doc.setLineWidth(0.3)
    doc.line(LINKS, ky + 1, seitenBreite - 16, ky + 1)
    y = ky + 10

    if (leisteBreite) {
      const lx = seitenBreite - 16 - leisteBreite
      let ly = y
      doc.setDrawColor(215)
      doc.line(lx - 4, ly - 3, lx - 4, seitenHoehe - UNTEN - 6)
      for (const eintrag of kopf.seitenleiste) {
        if (eintrag.titel) {
          schrift('bold', 7.5, 60)
          doc.text(sicher(eintrag.titel), lx, ly)
          ly += 3.6
        }
        schrift('normal', 6.6, 105)
        for (const z of eintrag.zeilen) {
          for (const teil of doc.splitTextToSize(sicher(z), leisteBreite) as string[]) {
            doc.text(teil, lx, ly)
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
    y = OBEN + 2
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
          liste.push({ text: '', breite: inTabelle ? 14 : 42, linie: true, nachLeer: false })
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
        doc.setFont('helvetica', w.fett ? 'bold' : 'normal')
        doc.text(w.text, x, yy)
      }
      x += w.breite
    })
  }

  function absatz(teile: InlineTeil[], stil: 'normal' | 'bold', groesse: number, zeilenhoehe: number, einzug = 0) {
    grundStil = stil
    grundGroesse = groesse
    schrift(stil, groesse)
    const x0 = LINKS + Math.min(einzug, 12) * 1.6
    for (const z of umbrechen(worte(teile), textBreite() - (x0 - LINKS))) {
      platz(zeilenhoehe)
      schrift(stil, groesse)
      zeichneZeile(z, x0, y)
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
      let x = LINKS
      zellen.forEach((zelle, s) => {
        doc.setDrawColor(170)
        doc.setLineWidth(0.2)
        if (messen) {
          // nur messen
        } else if (istKopf) {
          doc.setFillColor(242, 242, 242)
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
  function setze(block: VorlagenBlock) {
    if (block.art === 'leer') {
      if (leerFolge++ < 1) y += ZEILE * 0.7
      return
    }
    leerFolge = 0
    if (block.art === 'titel') {
      platz(12)
      absatz(block.teile, 'bold', 14.5, 6.8)
      y += 2
    } else if (block.art === 'ueberschrift') {
      platz(12)
      y += 1.5
      absatz(block.teile, 'bold', 10.5, 5.4)
      y += 0.8
    } else if (block.art === 'zeile') {
      absatz(block.teile, 'normal', 9.5, ZEILE, block.einzug)
    } else if (block.rahmenlos) {
      spalten(block.zeilen)
    } else {
      tabelle(block.zeilen)
    }
  }

  /** Höhe, die Blöcke ab der aktuellen Stelle brauchen würden — ohne zu zeichnen. */
  function hoeheVon(liste: VorlagenBlock[]): number {
    const [y0, folge0] = [y, leerFolge]
    messen = true
    y = 0
    liste.forEach(setze)
    const hoehe = y
    messen = false
    y = y0
    leerFolge = folge0
    return hoehe
  }

  kopfZeichnen()
  const bloecke = zerlegeVorlage(params.text)
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
      if (noetig > frei && noetig < seitenHoehe - UNTEN - OBEN - 10) neueSeite()
    }
    setze(block)
  })

  const seiten = doc.getNumberOfPages()
  for (let s = 1; s <= seiten; s++) {
    doc.setPage(s)
    doc.setDrawColor(200)
    doc.setLineWidth(0.2)
    doc.line(LINKS, seitenHoehe - 15, seitenBreite - 16, seitenHoehe - 15)
    schrift('normal', 6.8, 110)
    let fy = seitenHoehe - 11.5
    for (const z of kopf.fusszeilen) {
      doc.text(sicher(z), LINKS, fy)
      fy += 3
    }
    doc.text(`Seite ${s} von ${seiten}`, seitenBreite - 16, seitenHoehe - 11.5, { align: 'right' })
  }
  return doc
}
