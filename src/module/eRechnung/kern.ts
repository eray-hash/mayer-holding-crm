// Modul E-Rechnung: Lesen und Erzeugen laufen im Browser und auf dem Server mit demselben Code
// (supabase/functions/_shared/eRechnung/ — dort die Einzelheiten und Tests). Hier nur weitergereicht.
export { leseERechnung, eRechnungKurz, istERechnungXml } from '../../../supabase/functions/_shared/eRechnung/lesen.ts'
export type { ERechnungDaten, ERechnungPartei, ERechnungPosition } from '../../../supabase/functions/_shared/eRechnung/lesen.ts'
export { eRechnungsXmlAusDatei } from '../../../supabase/functions/_shared/eRechnung/pdfXml.ts'
export { erzeugeXRechnung, pruefeXRechnung, verkaeuferAusBriefkopf, kaeuferAusAnschrift, summen } from '../../../supabase/functions/_shared/eRechnung/erzeugen.ts'
export type { XRechnungEingabe, XRechnungVerkaeufer } from '../../../supabase/functions/_shared/eRechnung/erzeugen.ts'

/** Kennung der Zeile in crm_module. */
export const MODUL_E_RECHNUNG = 'e_rechnung'
