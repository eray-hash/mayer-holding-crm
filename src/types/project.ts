import type { Prioritaet } from './index'

// Projekte sind bereichsübergreifend gedacht — jeder aktuelle und künftige Bereich kann
// eigene Projekte haben, auch bevor er als vollständiger CRM-Bereich existiert.
export type ProjektBereich =
  | 'beratung'
  | 'immobilien'
  | 'erben'
  | 'betriebsuebergabe'
  | 'betriebsformen'
  | 'akademie'
  | 'finanzierungen'
  | 'intern'

export type ProjektKind = 'kunde' | 'eigen'
export type ProjektStatus = 'geplant' | 'in_arbeit' | 'pausiert' | 'abgeschlossen'
export type AufgabenStatus = 'offen' | 'in_arbeit' | 'rueckfrage' | 'erledigt'

export const AUFGABEN_STATUS_ORDER: AufgabenStatus[] = ['offen', 'in_arbeit', 'rueckfrage', 'erledigt']

export const AUFGABEN_STATUS_LABEL: Record<AufgabenStatus, string> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  rueckfrage: 'Rückfrage',
  erledigt: 'Erledigt',
}

export type Aufgabe = {
  id: string
  titel: string
  status: AufgabenStatus
  prioritaet: Prioritaet
  unterPrio: number | null
  startDatum: string | null
  kunde: string | null
  abteilung: string | null
  zustaendig: string | null
  naechsterSchritt: string | null
  fragen: string | null
  benoetigteInfos: string | null
  geplanteZeitStunden: number | null
  istZeitStunden: number | null
  umsatzEuro: number | null
  wiedervorlage: string | null
  erledigtAm: string | null
  protokoll: string | null
  taskvorschlaege: string | null
  fuerClaude: boolean
}

export type Meilenstein = {
  id: string
  titel: string
  eta: string | null
  sortOrder: number
  aufgaben: Aufgabe[]
}

export type Projekt = {
  id: string
  bereich: ProjektBereich
  name: string
  kind: ProjektKind
  status: ProjektStatus
  prioritaet: Prioritaet
  verantwortlich: string
  aktuelleAufgabe: string | null
  verknuepftKundeId?: string
  verknuepftObjektId?: string
  meilensteine: Meilenstein[]
}

export const PROJEKT_STATUS_LABEL: Record<ProjektStatus, string> = {
  geplant: 'Geplant',
  in_arbeit: 'In Arbeit',
  pausiert: 'Pausiert',
  abgeschlossen: 'Abgeschlossen',
}

export const PROJEKT_BEREICH_LABEL: Record<ProjektBereich, string> = {
  beratung: 'Unternehmensberatung',
  immobilien: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  intern: 'Intern',
}
