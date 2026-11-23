// Server-Einbindung des abschaltbaren Moduls „E-Rechnung“ (23.11.2026, siehe src/module/eRechnung/README.md).
// - eRechnungAktiv: Das Modul ist nur an, wenn in crm_module die Zeile id='e_rechnung' mit aktiv=true steht.
//   Fehlt sie oder schlägt die Abfrage fehl, gilt es als aus — dann läuft alles wie vor dem Modul.
// - eRechnungAusAnhaengen: sucht unter den Anhängen einer Mail eine E-Rechnung (.xml oder PDF mit eingebetteter
//   XML, ZUGFeRD/Factur-X) und liest sie. Fragt die Datenbank erst, wenn überhaupt ein passender Anhang da ist.
//   Wirft nie: Ist die Datei nicht ladbar oder nicht lesbar, gibt es null und der Aufrufer macht weiter wie bisher.
import { eigenerSpeicher } from '../speicherPfad.ts'
import { type ERechnungDaten, leseERechnung } from './lesen.ts'
import { eRechnungsXmlAusDatei } from './pdfXml.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const MODUL_ID = 'e_rechnung'

/** Ist das Modul E-Rechnung eingeschaltet? Im Zweifel (Zeile fehlt, Fehler): nein. */
export async function eRechnungAktiv(admin: Db): Promise<boolean> {
  try {
    const { data, error } = await admin.from('crm_module').select('aktiv').eq('id', MODUL_ID).maybeSingle()
    return !error && data?.aktiv === true
  } catch {
    return false
  }
}

export type MailAnhang = { filename?: string; size?: number; contentType?: string; url?: string }

export type GefundeneERechnung = { anhang: MailAnhang; xml: string; daten: ERechnungDaten }

/** Größte Datei, die auf eine E-Rechnung geprüft wird (größere PDFs sind Scans, keine ZUGFeRD-Rechnungen). */
const MAX_XML_BYTES = 5 * 1024 * 1024
const MAX_PDF_BYTES = 10 * 1024 * 1024
const MAX_KANDIDATEN = 3

const txt = (w: unknown) => (typeof w === 'string' ? w : '')

export function istXmlAnhang(a: MailAnhang): boolean {
  return /\.xml$/i.test(txt(a.filename)) || /[/+]xml\b/i.test(txt(a.contentType))
}

function istPdfAnhang(a: MailAnhang): boolean {
  return /pdf/i.test(txt(a.contentType)) || /\.pdf$/i.test(txt(a.filename))
}

/** Anhänge, die eine E-Rechnung sein könnten: zuerst XML-Dateien, dann PDFs; zu große fallen weg. */
export function eRechnungsKandidaten(anhaenge: MailAnhang[] | null | undefined): MailAnhang[] {
  const liste = (Array.isArray(anhaenge) ? anhaenge : []).filter((a) => a && txt(a.url).trim())
  const passt = (a: MailAnhang, max: number) => !(Number(a.size) > max)
  const xml = liste.filter((a) => istXmlAnhang(a) && passt(a, MAX_XML_BYTES))
  const pdf = liste.filter((a) => !istXmlAnhang(a) && istPdfAnhang(a) && passt(a, MAX_PDF_BYTES))
  return [...xml, ...pdf].slice(0, MAX_KANDIDATEN)
}

/** Datei aus dem eigenen Speicher laden (nur bekannte Eimer, siehe speicherPfad.ts). */
export async function ladeAusEigenemSpeicher(admin: Db, url: string): Promise<Uint8Array> {
  const ort = eigenerSpeicher(url)
  if (!ort) throw new Error('Datei nicht abrufbar (Verweis zeigt nicht auf den eigenen Speicher)')
  const { data, error } = await admin.storage.from(ort.eimer).download(ort.pfad)
  if (error || !data) throw new Error(`Datei nicht abrufbar (${error?.message ?? 'unbekannt'})`)
  return new Uint8Array(await data.arrayBuffer())
}

/**
 * Erste lesbare E-Rechnung unter den Anhängen — nur bei eingeschaltetem Modul, sonst null. `lade` holt die Bytes
 * eines Anhangs (Vorgabe: eigener Speicher). Wirft nie.
 */
export async function eRechnungAusAnhaengen(
  admin: Db,
  anhaenge: MailAnhang[] | null | undefined,
  lade: (url: string) => Promise<Uint8Array> = (url) => ladeAusEigenemSpeicher(admin, url),
): Promise<GefundeneERechnung | null> {
  const kandidaten = eRechnungsKandidaten(anhaenge)
  if (!kandidaten.length || !(await eRechnungAktiv(admin))) return null
  for (const anhang of kandidaten) {
    try {
      const bytes = await lade(txt(anhang.url))
      if (bytes.length > (istXmlAnhang(anhang) ? MAX_XML_BYTES : MAX_PDF_BYTES)) continue
      const xml = await eRechnungsXmlAusDatei(bytes, txt(anhang.filename))
      if (!xml) continue
      return { anhang, xml, daten: leseERechnung(xml) }
    } catch {
      // nicht ladbar oder keine lesbare E-Rechnung: nächster Anhang, sonst bisheriges Verhalten
    }
  }
  return null
}
