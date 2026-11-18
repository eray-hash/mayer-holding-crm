import type { AppData } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { OBJEKT_ABGESCHLOSSEN, type RohAufgabe } from '../../supabase/functions/_shared/aufgabenKern.ts'
import { followUpDetailPfad } from './followUpPriorities'

// Sammelt für die Seite „Aufgaben nach Mitarbeiter“ alle offenen Aufgaben aus dem geladenen Stand.
// Der Stand enthält nur, was der Mitarbeiter sehen darf (Zeilenschutz in der Datenbank): Bereiche
// ohne Freigabe, fremde eigene To-do-Listen ohne Freigabe und fremde private Kontakte fehlen also
// schon hier. Dieselben Quellen liest der Assistent in telegram-gateway (aufgaben_uebersicht).

const BEREICH_NAME: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilien: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
}

export function sammleAufgaben(state: AppData, nameZuEmail: Map<string, string>): RohAufgabe[] {
  const out: RohAufgabe[] = []

  for (const t of state.todos) {
    if (t.erledigtAm) continue
    const datum = t.erledigenBis || t.geplanteWiedervorlage
    out.push({
      id: `todo:${t.id}`,
      art: 'todo',
      titel: t.aufgabe || '(ohne Titel)',
      bezug: t.kundeProjekt || undefined,
      bereich: t.bereich ? BEREICH_NAME[t.bereich] ?? t.bereich : 'Eigene Liste',
      zustaendig: t.zustaendig,
      ersatzPerson: t.bereich ? undefined : nameZuEmail.get(t.besitzerEmail.toLowerCase()),
      datum,
      datumArt: t.erledigenBis ? 'erledigen bis' : t.geplanteWiedervorlage ? 'Wiedervorlage' : undefined,
      privat: !t.bereich,
      pfad: t.bereich ? `/${t.bereich}/todo` : '/privat/todo',
    })
  }

  for (const b of KUNDEN_BEREICHE) {
    for (const k of b.get(state)) {
      const fu = k.followUp
      if (!fu || fu.done || !(fu.note?.trim() || fu.date)) continue
      out.push({
        id: `fu:${b.id}:${k.id}`,
        art: 'followup',
        titel: fu.note?.trim() || 'Follow-up',
        bezug: [k.firma, k.ansprechpartner && k.ansprechpartner !== k.firma ? k.ansprechpartner : ''].filter(Boolean).join(' · '),
        bereich: b.label,
        zustaendig: k.verantwortlich,
        datum: fu.date,
        datumArt: 'Follow-up',
        privat: b.id === 'privat',
        pfad: followUpDetailPfad({ bereich: b.id, id: k.id } as Parameters<typeof followUpDetailPfad>[0]),
      })
    }
  }

  for (const o of state.objekte) {
    const fu = o.followUp
    if (!fu || fu.done || !(fu.note?.trim() || fu.date) || OBJEKT_ABGESCHLOSSEN.includes(o.status)) continue
    out.push({
      id: `fu:objekt:${o.id}`,
      art: 'followup',
      titel: fu.note?.trim() || 'Follow-up',
      bezug: o.bezeichnung,
      bereich: 'Immobilien',
      zustaendig: o.verantwortlich,
      datum: fu.date,
      datumArt: 'Follow-up',
      pfad: `/immobilien/objekte/${o.id}`,
    })
  }

  for (const p of state.projekte) {
    for (const m of p.meilensteine) {
      for (const a of m.aufgaben) {
        if (a.status === 'erledigt') continue
        out.push({
          id: `projekt:${p.id}:${a.id}`,
          art: 'projekt',
          titel: a.titel || '(ohne Titel)',
          bezug: p.name,
          bereich: BEREICH_NAME[p.bereich] ?? 'Intern',
          zustaendig: a.zustaendig,
          ersatzPerson: p.verantwortlich,
          datum: a.wiedervorlage,
          datumArt: 'Wiedervorlage',
          pfad: BEREICH_NAME[p.bereich] ? `/${p.bereich}/projekte` : '/heute',
        })
      }
    }
  }
  return out
}
