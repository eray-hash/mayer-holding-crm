import type { Vorlage } from '../types'

// Briefkopf für alle aus Vorlagen erzeugten Schreiben.
//
// Die vollständigen Angaben (Registernummer, Bankverbindung, Steuernummer, Namen und Titel der
// Seitenleiste) stehen NICHT hier im Programmcode, sondern in der Datenbank: als eine Zeile der
// Tabelle "vorlagen" mit der id "briefkopf" (bereich "beratung", kategorie "briefkopf"), deren Text
// die Angaben als JSON enthält. Grund: Dieses Repository ist öffentlich. Hier steht nur ein
// schlichter Ersatz für den Fall, dass die Zeile fehlt.
export type Briefkopf = {
  name: string
  unterzeilen: string[]
  // Rechte Spalte auf der ersten Seite: Personen mit ihren Bezeichnungen, wie auf dem Briefbogen.
  seitenleiste: { titel: string; zeilen: string[] }[]
  fusszeilen: string[]
}

export const BRIEFKOPF_ID = 'briefkopf'

export const BRIEFKOPF: Briefkopf = {
  name: 'Andreas Mayer Holding',
  unterzeilen: ['Schwabstrasse 3 · 89075 Ulm'],
  seitenleiste: [],
  fusszeilen: ['Andreas Mayer Holding · Schwabstrasse 3 · 89075 Ulm'],
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
