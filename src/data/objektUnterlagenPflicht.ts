import type { DokumentOrdnerName, Objekt, ObjektTyp } from '../types'

// Welche Unterlagen-Kategorien für einen Objekttyp typischerweise vollständig vorliegen sollten
// (Quirin Lutzenberger, Immobilienfachwirt: "Für ein MFH brauchen wir 42 definierte Unterlagen" —
// als einfacher Realitäts-Check, keine abschließende/rechtssichere Liste). Bewusst eine simple,
// direkt editierbare Daten-Datei statt einer eigenen Verwaltungsoberfläche — wenn sich das in der
// Praxis häufig ändern soll, lohnt sich später eine echte Admin-UI dafür (analog Fragenkatalog).
export const OBJEKT_UNTERLAGEN_PFLICHT: Record<ObjektTyp, DokumentOrdnerName[]> = {
  Wohnung: ['Grundbuch', 'Energieausweis', 'Grundrisse', 'Teilungserklärung', 'Betriebskostenabrechnung', 'Wohnflächenberechnung'],
  Haus: ['Grundbuch', 'Energieausweis', 'Grundrisse', 'Flurkarte', 'Baulastenauskunft', 'Gebäudeversicherung'],
  Grundstück: ['Grundbuch', 'Flurkarte', 'Baulastenauskunft', 'Lageplan'],
  Gewerbe: ['Grundbuch', 'Energieausweis', 'Grundrisse', 'Mietverträge', 'Mieterliste', 'Betriebskostenabrechnung'],
  Neubauprojekt: ['Grundbuch', 'Pläne', 'Genehmigung', 'Leistungsverzeichnisse', 'Lageplan'],
}

export type UnterlagenCheck = {
  pflicht: DokumentOrdnerName[]
  vorhanden: DokumentOrdnerName[]
  fehlend: DokumentOrdnerName[]
  prozent: number
}

export function pruefeUnterlagenVollstaendigkeit(objekt: Objekt): UnterlagenCheck {
  const pflicht = OBJEKT_UNTERLAGEN_PFLICHT[objekt.typ] ?? []
  const vorhanden = pflicht.filter((ordner) => (objekt.dokumente[ordner]?.length ?? 0) > 0)
  const fehlend = pflicht.filter((ordner) => !vorhanden.includes(ordner))
  const prozent = pflicht.length === 0 ? 100 : Math.round((vorhanden.length / pflicht.length) * 100)
  return { pflicht, vorhanden, fehlend, prozent }
}
