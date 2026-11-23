// Gescannte PDFs aus manchen Scannern hängen an JEDE Seite die Bilder ALLER Seiten (gemeinsames Verzeichnis der
// Bilder). Kopiert man eine Seite heraus, kommen alle Bilder mit: Seite 12 eines 37-MB-Scans war allein 37 MB groß
// (23.11.2026), sodass große PDFs auch in Teilen nicht lesbar waren. Hier bekommt jede Seite ein eigenes Verzeichnis
// mit nur den Bildern/Formularen, die ihr Seiteninhalt wirklich zeichnet („/Name Do“). Danach kopiert copyPages nur
// noch das Nötige. Seiten, deren Inhalt sich nicht entpacken lässt, bleiben unverändert.
import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFDocument } from 'npm:pdf-lib@1.17.1'

function inhaltText(doc: PDFDocument, inhalt: unknown): string | null {
  const teile: unknown[] = []
  const aufloesen = (x: unknown) => (x instanceof PDFRef ? doc.context.lookup(x) : x)
  const wurzel = aufloesen(inhalt)
  if (wurzel instanceof PDFArray) for (let i = 0; i < wurzel.size(); i++) teile.push(aufloesen(wurzel.get(i)))
  else teile.push(wurzel)
  let text = ''
  for (const t of teile) {
    if (!(t instanceof PDFStream)) return null
    const bytes = t instanceof PDFRawStream ? decodePDFRawStream(t).decode() : t.getContents()
    // latin1 genügt: gesucht werden nur Namen vor dem Operator „Do“.
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    text += '\n'
  }
  return text
}

function streamGroesse(doc: PDFDocument, x: unknown): number {
  const s = x instanceof PDFRef ? doc.context.lookup(x) : x
  return s instanceof PDFRawStream ? s.contents.length : s instanceof PDFStream ? s.getContentsSize() : 0
}

/**
 * Geschätzte Größe jeder Seite in Bytes (ihre Bilder/Formulare plus Seiteninhalt) — ohne Probespeichern, das auf
 * dem Server zu viel Rechenzeit kostete (Abbruch ohne Meldung, 23.11.2026). Nach entschlackeSeiten aufrufen.
 */
export function geschaetzteSeitenGroessen(doc: PDFDocument): number[] {
  return doc.getPages().map((seite) => {
    try {
      const knoten = seite.node
      let summe = 0
      const inhalt = knoten.get(PDFName.of('Contents'))
      const wurzel = inhalt instanceof PDFRef ? doc.context.lookup(inhalt) : inhalt
      if (wurzel instanceof PDFArray) for (let i = 0; i < wurzel.size(); i++) summe += streamGroesse(doc, wurzel.get(i))
      else summe += streamGroesse(doc, wurzel)
      const res = knoten.lookup(PDFName.of('Resources')) ?? knoten.getInheritableAttribute(PDFName.of('Resources'))
      const resDict = res instanceof PDFRef ? doc.context.lookup(res) : res
      const xo = resDict instanceof PDFDict ? resDict.lookup(PDFName.of('XObject')) : undefined
      if (xo instanceof PDFDict) for (const k of xo.keys()) summe += streamGroesse(doc, xo.get(k))
      return summe
    } catch {
      return 0
    }
  })
}

/** Verkleinert die Verzeichnisse der Bilder je Seite auf das Benutzte. Gibt die Zahl der geänderten Seiten zurück. */
export function entschlackeSeiten(doc: PDFDocument): number {
  let geaendert = 0
  for (const seite of doc.getPages()) {
    try {
      const knoten = seite.node
      const res = knoten.lookup(PDFName.of('Resources')) ?? knoten.getInheritableAttribute(PDFName.of('Resources'))
      const resDict = res instanceof PDFRef ? doc.context.lookup(res) : res
      if (!(resDict instanceof PDFDict)) continue
      const xo = resDict.lookup(PDFName.of('XObject'))
      if (!(xo instanceof PDFDict) || xo.keys().length <= 1) continue
      const text = inhaltText(doc, knoten.get(PDFName.of('Contents')))
      if (text === null) continue
      const benutzt = new Set<string>()
      for (const m of text.matchAll(/\/([^\s/\[\]()<>{}%]+)\s+Do\b/g)) benutzt.add(m[1])
      const behalten = xo.keys().filter((k) => benutzt.has(k.decodeText()))
      if (behalten.length === xo.keys().length) continue
      const neuesXo = doc.context.obj({}) as PDFDict
      for (const k of behalten) neuesXo.set(k, xo.get(k)!)
      const neueRes = resDict.clone(doc.context)
      neueRes.set(PDFName.of('XObject'), neuesXo)
      knoten.set(PDFName.of('Resources'), neueRes)
      geaendert++
    } catch {
      // ungewöhnlich aufgebaute Seite: unverändert lassen
    }
  }
  return geaendert
}
