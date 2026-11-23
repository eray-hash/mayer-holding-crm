// XML aus einer ZUGFeRD-/Factur-X-PDF holen (Modul „E-Rechnung“, 23.11.2026). Eine solche PDF trägt die
// maschinenlesbare Rechnung als eingebettete Datei (factur-x.xml, zugferd-invoice.xml, xrechnung.xml …).
// Ohne PDF-Bibliothek, damit es gleich im Browser und auf dem Server läuft: Eingebettete Dateien sind
// eigene Datenströme mit „/Type /EmbeddedFile“ im Kopf (sie liegen nie in Objekt-Strömen), entpackt wird
// mit DecompressionStream (FlateDecode).
import { istERechnungXml } from './lesen.ts'

const latin1 = (b: Uint8Array, von: number, bis: number) => {
  let s = ''
  for (let i = von; i < bis; i += 0x8000) s += String.fromCharCode(...b.subarray(i, Math.min(bis, i + 0x8000)))
  return s
}

async function entpacke(daten: Uint8Array): Promise<Uint8Array> {
  const strom = new Blob([daten as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(strom).arrayBuffer())
}

/** Liefert den XML-Text der eingebetteten E-Rechnung oder null (keine ZUGFeRD-PDF). */
export async function xmlAusPdf(pdf: Uint8Array): Promise<string | null> {
  const s = latin1(pdf, 0, pdf.length)
  const muster = /\/Type\s*\/EmbeddedFile\b/g
  let m: RegExpExecArray | null
  while ((m = muster.exec(s))) {
    // Kopf des Stroms: von „<<“ vor dem Treffer bis „stream“ danach.
    const kopfStart = s.lastIndexOf('obj', m.index)
    const streamPos = s.indexOf('stream', m.index)
    if (kopfStart < 0 || streamPos < 0) continue
    const kopf = s.slice(kopfStart, streamPos)
    let start = streamPos + 6
    if (s[start] === '\r') start++
    if (s[start] === '\n') start++
    const laengeDirekt = kopf.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)
    let ende = laengeDirekt ? start + Number(laengeDirekt[1]) : s.indexOf('endstream', start)
    if (ende <= start || ende > s.length) ende = s.indexOf('endstream', start)
    if (ende < 0) continue
    let daten = pdf.subarray(start, ende)
    try {
      if (/\/FlateDecode/.test(kopf)) daten = await entpacke(daten)
      else if (/\/Filter/.test(kopf)) continue // andere Packverfahren kommen bei E-Rechnungen praktisch nicht vor
    } catch {
      continue
    }
    const xml = new TextDecoder('utf-8').decode(daten)
    if (istERechnungXml(xml)) return xml
  }
  return null
}

/** Aus einer beliebigen hochgeladenen Datei (XML oder PDF) den E-Rechnungs-Text holen, sonst null. */
export async function eRechnungsXmlAusDatei(bytes: Uint8Array, dateiname = ''): Promise<string | null> {
  const anfang = latin1(bytes, 0, Math.min(bytes.length, 8))
  if (anfang.startsWith('%PDF')) return await xmlAusPdf(bytes)
  if (/\.xml$/i.test(dateiname) || anfang.trimStart().startsWith('<') || anfang.startsWith('﻿') || bytes[0] === 0xef) {
    const xml = new TextDecoder('utf-8').decode(bytes)
    return istERechnungXml(xml) ? xml : null
  }
  return null
}
