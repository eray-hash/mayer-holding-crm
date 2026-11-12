import type { AppData } from '../context/AppContext'
import type { Kunde, KundeBereich } from '../types'

// Zentrale Zuordnung: welcher Bereich führt welche Kunden-/Mandanten-Liste im AppState.
// Basis für die bereichsübergreifende Objekt-Kunde-Zuweisung (ein Objekt kann jedem Kunden aus
// jedem dieser Bereiche vorgeschlagen werden, nicht nur Beratung) sowie für generische,
// bereichsübergreifende Kunden-Aktionen (siehe UPDATE_KUNDE_IN_BEREICH/ADD_KUNDE_IN_BEREICH/
// MOVE_KUNDE_BEREICH in AppContext.tsx) — `set` ist das symmetrische Pendant zu `get`.
export const KUNDEN_BEREICHE: {
  id: KundeBereich
  label: string
  get: (state: AppData) => Kunde[]
  set: (state: AppData, liste: Kunde[]) => AppData
}[] = [
  { id: 'beratung', label: 'Unternehmensberatung', get: (s) => s.kunden, set: (s, liste) => ({ ...s, kunden: liste }) },
  { id: 'erben', label: 'Erben', get: (s) => s.erbenMandanten, set: (s, liste) => ({ ...s, erbenMandanten: liste }) },
  {
    id: 'betriebsuebergabe',
    label: 'Betriebsübergabe',
    get: (s) => s.betriebsuebergabeMandanten,
    set: (s, liste) => ({ ...s, betriebsuebergabeMandanten: liste }),
  },
  {
    id: 'betriebsformen',
    label: 'Betriebsformen',
    get: (s) => s.betriebsformenMandanten,
    set: (s, liste) => ({ ...s, betriebsformenMandanten: liste }),
  },
  { id: 'akademie', label: 'Akademie', get: (s) => s.akademieTeilnehmer, set: (s, liste) => ({ ...s, akademieTeilnehmer: liste }) },
  {
    id: 'finanzierungen',
    label: 'Finanzierungen',
    get: (s) => s.finanzierungenMandanten,
    set: (s, liste) => ({ ...s, finanzierungenMandanten: liste }),
  },
  { id: 'privat', label: 'Privat', get: (s) => s.privatKunden, set: (s, liste) => ({ ...s, privatKunden: liste }) },
  {
    id: 'immobilienkunden',
    label: 'Immobilien',
    get: (s) => s.immobilienKunden,
    set: (s, liste) => ({ ...s, immobilienKunden: liste }),
  },
]

export function kundeBereichLabel(bereich: KundeBereich): string {
  return KUNDEN_BEREICHE.find((b) => b.id === bereich)?.label ?? bereich
}

// Zentrale Bereich+id → Detailseiten-URL-Zuordnung, von mehreren Stellen genutzt (globale Suche,
// Stammdaten-Warnungen), damit die Routen-Struktur nur an einer Stelle gepflegt werden muss.
export function kundeDetailPfad(bereich: KundeBereich, id: string): string {
  switch (bereich) {
    case 'beratung': return `/beratung/kunden/${id}`
    case 'erben': return `/erben/mandanten/${id}`
    case 'betriebsuebergabe': return `/betriebsuebergabe/mandanten/${id}`
    case 'betriebsformen': return `/betriebsformen/mandanten/${id}`
    case 'akademie': return `/akademie/teilnehmer/${id}`
    case 'finanzierungen': return `/finanzierungen/mandanten/${id}`
    case 'privat': return `/privat/kontakte/${id}`
    case 'immobilienkunden': return `/immobilien/kunden/${id}`
  }
}
