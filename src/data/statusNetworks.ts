import type { StatusNode } from '../types'

// ==========================================================================
// STATUSNETZ — UNTERNEHMENSBERATUNG
// ==========================================================================

export const BERATUNG_STATUS: Record<string, StatusNode> = {
  lead: {
    id: 'lead',
    label: 'Lead / Neuanfrage',
    color: 'bg-slate-100 text-slate-700',
    isTerminal: false,
    isMainPath: true,
    next: ['erstkontakt', 'nicht_qualifiziert', 'verloren'],
  },
  erstkontakt: {
    id: 'erstkontakt',
    label: 'Erstkontakt hergestellt',
    color: 'bg-sky-100 text-sky-700',
    isTerminal: false,
    isMainPath: true,
    next: ['termin', 'wiedervorlage', 'nicht_qualifiziert', 'verloren'],
  },
  termin: {
    id: 'termin',
    label: 'Erstgespräch terminiert',
    color: 'bg-sky-100 text-sky-700',
    isTerminal: false,
    isMainPath: true,
    next: ['durchgefuehrt', 'wiedervorlage', 'verloren'],
  },
  durchgefuehrt: {
    id: 'durchgefuehrt',
    label: 'Erstgespräch durchgeführt',
    color: 'bg-cyan-100 text-cyan-700',
    isTerminal: false,
    isMainPath: true,
    next: ['konzept', 'wiedervorlage', 'verloren'],
  },
  konzept: {
    id: 'konzept',
    label: 'Konzeptvorstellung',
    color: 'bg-indigo-100 text-indigo-700',
    isTerminal: false,
    isMainPath: true,
    next: ['angebot', 'wiedervorlage', 'verloren'],
  },
  angebot: {
    id: 'angebot',
    label: 'Angebot / Beratungsvertrag versendet',
    color: 'bg-indigo-100 text-indigo-700',
    isTerminal: false,
    isMainPath: true,
    next: ['unterschrieben', 'wiedervorlage', 'verloren'],
  },
  unterschrieben: {
    id: 'unterschrieben',
    label: 'Beratungsvertrag unterschrieben',
    color: 'bg-violet-100 text-violet-700',
    isTerminal: false,
    isMainPath: true,
    next: ['aktives_mandat'],
  },
  aktives_mandat: {
    id: 'aktives_mandat',
    label: 'Aktives Mandat / laufende Beratung',
    color: 'bg-amber-100 text-amber-700',
    isTerminal: false,
    isMainPath: true,
    next: ['rechnung_gestellt', 'wiedervorlage'],
  },
  rechnung_gestellt: {
    id: 'rechnung_gestellt',
    label: 'Leistung erbracht / Rechnung gestellt',
    color: 'bg-amber-100 text-amber-700',
    isTerminal: false,
    isMainPath: true,
    next: ['abgeschlossen'],
  },
  abgeschlossen: {
    id: 'abgeschlossen',
    label: 'Abgeschlossen',
    color: 'bg-emerald-100 text-emerald-700',
    isTerminal: true,
    isMainPath: true,
    next: [],
  },
  wiedervorlage: {
    id: 'wiedervorlage',
    label: 'Wiedervorlage / On Hold',
    color: 'bg-orange-100 text-orange-700',
    isTerminal: false,
    isMainPath: false,
    next: ['erstkontakt', 'termin', 'durchgefuehrt', 'konzept', 'angebot', 'aktives_mandat', 'verloren'],
  },
  verloren: {
    id: 'verloren',
    label: 'Verloren / Kein Interesse',
    color: 'bg-rose-100 text-rose-700',
    isTerminal: true,
    isMainPath: false,
    next: [],
  },
  nicht_qualifiziert: {
    id: 'nicht_qualifiziert',
    label: 'Nicht qualifiziert',
    color: 'bg-slate-200 text-slate-600',
    isTerminal: true,
    isMainPath: false,
    next: [],
  },
}

// Hauptpfad-Reihenfolge für "Weiter →" (automatische nächste Station)
export const BERATUNG_HAUPTPFAD = [
  'lead',
  'erstkontakt',
  'termin',
  'durchgefuehrt',
  'konzept',
  'angebot',
  'unterschrieben',
  'aktives_mandat',
  'rechnung_gestellt',
  'abgeschlossen',
]

// ==========================================================================
// STATUSNETZ — IMMOBILIEN
// ==========================================================================

export const IMMOBILIEN_STATUS: Record<string, StatusNode> = {
  akquise: {
    id: 'akquise',
    label: 'Akquise',
    color: 'bg-slate-100 text-slate-700',
    isTerminal: false,
    isMainPath: true,
    next: ['vorbereitung', 'on_hold', 'abgebrochen'],
  },
  vorbereitung: {
    id: 'vorbereitung',
    label: 'Objektaufnahme / Vorbereitung',
    color: 'bg-sky-100 text-sky-700',
    isTerminal: false,
    isMainPath: true,
    next: ['vermarktung', 'on_hold', 'abgebrochen'],
  },
  vermarktung: {
    id: 'vermarktung',
    label: 'Aktiv in Vermarktung',
    color: 'bg-cyan-100 text-cyan-700',
    isTerminal: false,
    isMainPath: true,
    next: ['reserviert', 'on_hold', 'abgebrochen'],
  },
  reserviert: {
    id: 'reserviert',
    label: 'Reserviert',
    color: 'bg-indigo-100 text-indigo-700',
    isTerminal: false,
    isMainPath: true,
    next: ['notartermin', 'vermarktung', 'abgebrochen'],
  },
  notartermin: {
    id: 'notartermin',
    label: 'Notartermin',
    color: 'bg-violet-100 text-violet-700',
    isTerminal: false,
    isMainPath: true,
    next: ['verkauft', 'abgebrochen'],
  },
  verkauft: {
    id: 'verkauft',
    label: 'Verkauft',
    color: 'bg-emerald-100 text-emerald-700',
    isTerminal: false,
    isMainPath: true,
    next: ['archiv'],
  },
  archiv: {
    id: 'archiv',
    label: 'Archiv',
    color: 'bg-slate-200 text-slate-600',
    isTerminal: true,
    isMainPath: true,
    next: [],
  },
  on_hold: {
    id: 'on_hold',
    label: 'On Hold / Zurückgestellt',
    color: 'bg-orange-100 text-orange-700',
    isTerminal: false,
    isMainPath: false,
    next: ['akquise', 'vorbereitung', 'vermarktung', 'reserviert'],
  },
  abgebrochen: {
    id: 'abgebrochen',
    label: 'Nicht zustande gekommen / Abgebrochen',
    color: 'bg-rose-100 text-rose-700',
    isTerminal: false,
    isMainPath: false,
    next: ['archiv'],
  },
}

export const IMMOBILIEN_HAUPTPFAD = [
  'akquise',
  'vorbereitung',
  'vermarktung',
  'reserviert',
  'notartermin',
  'verkauft',
  'archiv',
]

export function getStatusMap(bereich: 'beratung' | 'immobilien'): Record<string, StatusNode> {
  return bereich === 'beratung' ? BERATUNG_STATUS : IMMOBILIEN_STATUS
}

export function getHauptpfad(bereich: 'beratung' | 'immobilien'): string[] {
  return bereich === 'beratung' ? BERATUNG_HAUPTPFAD : IMMOBILIEN_HAUPTPFAD
}

// Ermittelt den nächsten Hauptpfad-Knoten für den "Weiter →"-Button
export function getNextMainStep(bereich: 'beratung' | 'immobilien', currentId: string): string | null {
  const pfad = getHauptpfad(bereich)
  const map = getStatusMap(bereich)
  const idx = pfad.indexOf(currentId)
  if (idx !== -1 && idx < pfad.length - 1) {
    const nextId = pfad[idx + 1]
    if (map[currentId]?.next.includes(nextId)) return nextId
  }
  // Fallback: falls aktueller Status nicht im Hauptpfad ist (z.B. Wiedervorlage/On Hold),
  // nimm den ersten erlaubten Folgeknoten, der selbst im Hauptpfad liegt.
  const node = map[currentId]
  if (!node) return null
  const mainPathNext = node.next.find((n) => pfad.includes(n))
  return mainPathNext ?? node.next[0] ?? null
}
