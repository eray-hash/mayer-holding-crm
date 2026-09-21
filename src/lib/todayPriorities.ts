import type { Aufgabe, Projekt } from '../types/project'
import { today } from './dates'

export type PriorityKind = 'overdue' | 'today' | 'hoch' | 'claude'

export type PriorityEntry = {
  aufgabe: Aufgabe
  projektId: string
  meilensteinId: string
  projektName: string
  kind: PriorityKind
}

export function collectPriorityEntries(projekte: Projekt[]): {
  prioritaeten: PriorityEntry[]
  demnaechst: PriorityEntry[]
} {
  const heute = today()
  const in7 = new Date()
  in7.setDate(in7.getDate() + 7)
  const in7Iso = in7.toISOString().slice(0, 10)

  const prioritaeten: PriorityEntry[] = []
  const demnaechst: PriorityEntry[] = []
  const seen = new Set<string>()

  for (const projekt of projekte) {
    for (const meilenstein of projekt.meilensteine) {
      for (const aufgabe of meilenstein.aufgaben) {
        if (aufgabe.status === 'erledigt') continue
        if (aufgabe.wiedervorlage && aufgabe.wiedervorlage <= heute) {
          prioritaeten.push({ aufgabe, projektId: projekt.id, meilensteinId: meilenstein.id, projektName: projekt.name, kind: 'overdue' })
          seen.add(aufgabe.id)
        } else if (aufgabe.wiedervorlage && aufgabe.wiedervorlage <= in7Iso) {
          demnaechst.push({ aufgabe, projektId: projekt.id, meilensteinId: meilenstein.id, projektName: projekt.name, kind: 'today' })
        }
      }
    }
  }

  for (const projekt of projekte) {
    for (const meilenstein of projekt.meilensteine) {
      for (const aufgabe of meilenstein.aufgaben) {
        if (aufgabe.status === 'erledigt' || seen.has(aufgabe.id)) continue
        if (aufgabe.prioritaet === 'Hoch') {
          prioritaeten.push({ aufgabe, projektId: projekt.id, meilensteinId: meilenstein.id, projektName: projekt.name, kind: 'hoch' })
          seen.add(aufgabe.id)
        } else if (aufgabe.fuerClaude) {
          prioritaeten.push({ aufgabe, projektId: projekt.id, meilensteinId: meilenstein.id, projektName: projekt.name, kind: 'claude' })
          seen.add(aufgabe.id)
        }
      }
    }
  }

  return { prioritaeten, demnaechst }
}
