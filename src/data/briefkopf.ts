import type { Vorlage } from '../types'
import { HOLDING_ANGABEN as H } from '../../supabase/functions/_shared/holdingBriefbogen.ts'

// Briefkopf-Angaben aus der Datenbank: eine Zeile der Tabelle "vorlagen" mit der id "briefkopf" (bereich
// "beratung", kategorie "briefkopf"), deren Text die Angaben als JSON enthält. Sie liefert heute vor allem die
// Verkäuferdaten der E-Rechnung (module/eRechnung). Das AUSSEHEN der PDFs (Rechnung, Angebot, Berichte,
// Vorlagen …) kommt seit 24.11.2026 nicht mehr von hier, sondern vom echten Holding-Briefbogen
// (supabase/functions/_shared/holdingBriefbogen.ts, src/lib/holdingBriefbogenJspdf.ts).
export type Briefkopf = {
  name: string
  unterzeilen: string[]
  // Rechte Spalte auf der ersten Seite: Personen mit ihren Bezeichnungen, wie auf dem Briefbogen.
  seitenleiste: { titel: string; zeilen: string[] }[]
  fusszeilen: string[]
  /** Privates Schreiben eines Mitarbeiters (private Akte): schlichter Kopf mit seinem Namen, NIE der Holding-Briefbogen. */
  privat?: boolean
}

export const BRIEFKOPF_ID = 'briefkopf'

/** Ersatz, falls die Zeile fehlt: dieselben Angaben wie die Fußzeile des Holding-Briefbogens (HOLDING_ANGABEN),
 *  im Format der Datenbank-Zeile — so findet auch die E-Rechnung Anschrift, IBAN und Steuernummer. */
export const BRIEFKOPF: Briefkopf = {
  name: 'Andreas Mayer Holding',
  unterzeilen: [`Andreas Mayer Holding · ${H.strasse}, ${H.plz} ${H.ort}`],
  seitenleiste: [],
  fusszeilen: [
    `${H.firma} · ${H.strasse} · ${H.plz} ${H.ort} · ${H.register}`,
    `${H.bank} · IBAN: ${H.iban} · Steuernummer ${H.steuernummer}`,
    `Tel.: ${H.telefon} · ${H.web} · GF: ${H.geschaeftsfuehrer}`,
  ],
}

const istTextliste = (x: unknown): x is string[] => Array.isArray(x) && x.every((e) => typeof e === 'string')

/** Liest den Briefkopf aus den geladenen Vorlagen; bei fehlender oder beschädigter Zeile der schlichte Ersatz. */
export function briefkopfAus(vorlagen: Vorlage[]): Briefkopf {
  const zeile = vorlagen.find((v) => v.id === BRIEFKOPF_ID)
  if (!zeile) return BRIEFKOPF
  try {
    const roh = JSON.parse(zeile.text) as Partial<Briefkopf>
    if (typeof roh.name !== 'string' || !istTextliste(roh.unterzeilen) || !istTextliste(roh.fusszeilen)) return BRIEFKOPF
    const leiste = Array.isArray(roh.seitenleiste)
      ? roh.seitenleiste.filter((e) => e && typeof e.titel === 'string' && istTextliste(e.zeilen))
      : []
    return { name: roh.name, unterzeilen: roh.unterzeilen, seitenleiste: leiste, fusszeilen: roh.fusszeilen }
  } catch {
    return BRIEFKOPF
  }
}
