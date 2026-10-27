import type { AppData } from '../context/AppContext'
import type { KundeBereich, FollowUp } from '../types'
import { KUNDEN_BEREICHE, kundeBereichLabel } from '../data/kundenBereiche'
import { today } from './dates'

export type FollowUpKind = 'overdue' | 'today'

export type FollowUpEntry = {
  bereich: KundeBereich | 'immobilien'
  id: string
  name: string
  bereichLabel: string
  note: string
  date: string
  kind: FollowUpKind
}

// Sammelt alle fälligen/überfälligen Follow-ups über alle Kunden-Bereiche + Immobilien-Objekte
// hinweg — Pendant zu collectPriorityEntries (Kanban-Aufgaben) für die Follow-up-Seite des Heute-
// Screens, die bisher komplett fehlte (Follow-ups waren nur einzeln in der jeweiligen Akte sichtbar).
export function collectFollowUpPriorities(state: AppData): FollowUpEntry[] {
  const heute = today()
  const out: FollowUpEntry[] = []

  for (const b of KUNDEN_BEREICHE) {
    for (const k of b.get(state)) {
      if (k.followUp.done || k.followUp.date > heute) continue
      out.push({
        bereich: b.id,
        id: k.id,
        name: `${k.firma} (${k.ansprechpartner})`,
        bereichLabel: b.label,
        note: k.followUp.note,
        date: k.followUp.date,
        kind: k.followUp.date < heute ? 'overdue' : 'today',
      })
    }
  }

  for (const o of state.objekte) {
    if (o.followUp.done || o.followUp.date > heute) continue
    out.push({
      bereich: 'immobilien',
      id: o.id,
      name: o.bezeichnung,
      bereichLabel: 'Immobilien',
      note: o.followUp.note,
      date: o.followUp.date,
      kind: o.followUp.date < heute ? 'overdue' : 'today',
    })
  }

  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export function followUpDetailPfad(entry: FollowUpEntry): string {
  switch (entry.bereich) {
    case 'beratung':
      return `/beratung/kunden/${entry.id}`
    case 'immobilien':
      return `/immobilien/objekte/${entry.id}`
    case 'erben':
      return `/erben/mandanten/${entry.id}`
    case 'betriebsuebergabe':
      return `/betriebsuebergabe/mandanten/${entry.id}`
    case 'betriebsformen':
      return `/betriebsformen/mandanten/${entry.id}`
    case 'akademie':
      return `/akademie/teilnehmer/${entry.id}`
    case 'finanzierungen':
      return `/finanzierungen/mandanten/${entry.id}`
  }
}

export { kundeBereichLabel }
export type { FollowUp }
