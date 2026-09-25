import type { AppData } from '../context/AppContext'
import type { Kunde, KundeBereich } from '../types'

// Zentrale Zuordnung: welcher Bereich führt welche Kunden-/Mandanten-Liste im AppState.
// Basis für die bereichsübergreifende Objekt-Kunde-Zuweisung (ein Objekt kann jedem Kunden aus
// jedem dieser Bereiche vorgeschlagen werden, nicht nur Beratung).
export const KUNDEN_BEREICHE: { id: KundeBereich; label: string; get: (state: AppData) => Kunde[] }[] = [
  { id: 'beratung', label: 'Unternehmensberatung', get: (s) => s.kunden },
  { id: 'erben', label: 'Erben', get: (s) => s.erbenMandanten },
  { id: 'betriebsuebergabe', label: 'Betriebsübergabe', get: (s) => s.betriebsuebergabeMandanten },
  { id: 'betriebsformen', label: 'Betriebsformen', get: (s) => s.betriebsformenMandanten },
  { id: 'akademie', label: 'Akademie', get: (s) => s.akademieTeilnehmer },
  { id: 'finanzierungen', label: 'Finanzierungen', get: (s) => s.finanzierungenMandanten },
]

export function kundeBereichLabel(bereich: KundeBereich): string {
  return KUNDEN_BEREICHE.find((b) => b.id === bereich)?.label ?? bereich
}
