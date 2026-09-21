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

// ==========================================================================
// STATUSNETZ — ERBEN
// ==========================================================================

export const ERBEN_STATUS: Record<string, StatusNode> = {
  erstkontakt: {
    id: 'erstkontakt',
    label: 'Erstkontakt',
    color: 'bg-slate-100 text-slate-700',
    isTerminal: false,
    isMainPath: true,
    next: ['bedarfsanalyse', 'wiedervorlage', 'verloren'],
  },
  bedarfsanalyse: {
    id: 'bedarfsanalyse',
    label: 'Bedarfsanalyse / Erstgespräch',
    color: 'bg-sky-100 text-sky-700',
    isTerminal: false,
    isMainPath: true,
    next: ['unterlagen_angefordert', 'wiedervorlage', 'verloren'],
  },
  unterlagen_angefordert: {
    id: 'unterlagen_angefordert',
    label: 'Unterlagen/Mandantenfragebogen angefordert',
    color: 'bg-cyan-100 text-cyan-700',
    isTerminal: false,
    isMainPath: true,
    next: ['konzept_erstellt', 'wiedervorlage', 'verloren'],
  },
  konzept_erstellt: {
    id: 'konzept_erstellt',
    label: 'Mandantenmemo/Konzept erstellt',
    color: 'bg-indigo-100 text-indigo-700',
    isTerminal: false,
    isMainPath: true,
    next: ['beratungsgespraech', 'wiedervorlage', 'verloren'],
  },
  beratungsgespraech: {
    id: 'beratungsgespraech',
    label: 'Beratungsgespräch geführt',
    color: 'bg-violet-100 text-violet-700',
    isTerminal: false,
    isMainPath: true,
    next: ['umsetzung', 'wiedervorlage', 'verloren'],
  },
  umsetzung: {
    id: 'umsetzung',
    label: 'Umsetzung (Testament/Vollmacht/Stiftung)',
    color: 'bg-amber-100 text-amber-700',
    isTerminal: false,
    isMainPath: true,
    next: ['abgeschlossen', 'wiedervorlage'],
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
    next: ['erstkontakt', 'bedarfsanalyse', 'unterlagen_angefordert', 'konzept_erstellt', 'beratungsgespraech', 'umsetzung', 'verloren'],
  },
  verloren: {
    id: 'verloren',
    label: 'Verloren / Kein Interesse',
    color: 'bg-rose-100 text-rose-700',
    isTerminal: true,
    isMainPath: false,
    next: [],
  },
}

export const ERBEN_HAUPTPFAD = [
  'erstkontakt',
  'bedarfsanalyse',
  'unterlagen_angefordert',
  'konzept_erstellt',
  'beratungsgespraech',
  'umsetzung',
  'abgeschlossen',
]

// ==========================================================================
// STATUSNETZ — BETRIEBSÜBERGABE
// ==========================================================================

export const BETRIEBSUEBERGABE_STATUS: Record<string, StatusNode> = {
  erstkontakt: {
    id: 'erstkontakt',
    label: 'Erstkontakt',
    color: 'bg-slate-100 text-slate-700',
    isTerminal: false,
    isMainPath: true,
    next: ['bedarfsanalyse', 'wiedervorlage', 'verloren'],
  },
  bedarfsanalyse: {
    id: 'bedarfsanalyse',
    label: 'Bedarfsanalyse / Erstgespräch',
    color: 'bg-sky-100 text-sky-700',
    isTerminal: false,
    isMainPath: true,
    next: ['unternehmensbewertung', 'wiedervorlage', 'verloren'],
  },
  unternehmensbewertung: {
    id: 'unternehmensbewertung',
    label: 'Unternehmensbewertung / Analyse',
    color: 'bg-cyan-100 text-cyan-700',
    isTerminal: false,
    isMainPath: true,
    next: ['nachfolgekonzept', 'wiedervorlage', 'verloren'],
  },
  nachfolgekonzept: {
    id: 'nachfolgekonzept',
    label: 'Nachfolgekonzept erstellt',
    color: 'bg-indigo-100 text-indigo-700',
    isTerminal: false,
    isMainPath: true,
    next: ['nachfolgersuche', 'wiedervorlage', 'verloren'],
  },
  nachfolgersuche: {
    id: 'nachfolgersuche',
    label: 'Nachfolger-/Käufersuche',
    color: 'bg-violet-100 text-violet-700',
    isTerminal: false,
    isMainPath: true,
    next: ['verhandlung', 'wiedervorlage', 'verloren'],
  },
  verhandlung: {
    id: 'verhandlung',
    label: 'Verhandlung / Vertragsentwurf',
    color: 'bg-fuchsia-100 text-fuchsia-700',
    isTerminal: false,
    isMainPath: true,
    next: ['notartermin', 'wiedervorlage', 'verloren'],
  },
  notartermin: {
    id: 'notartermin',
    label: 'Notartermin / Übergabe vollzogen',
    color: 'bg-amber-100 text-amber-700',
    isTerminal: false,
    isMainPath: true,
    next: ['abgeschlossen', 'wiedervorlage'],
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
    next: [
      'erstkontakt',
      'bedarfsanalyse',
      'unternehmensbewertung',
      'nachfolgekonzept',
      'nachfolgersuche',
      'verhandlung',
      'notartermin',
      'verloren',
    ],
  },
  verloren: {
    id: 'verloren',
    label: 'Verloren / Kein Interesse',
    color: 'bg-rose-100 text-rose-700',
    isTerminal: true,
    isMainPath: false,
    next: [],
  },
}

export const BETRIEBSUEBERGABE_HAUPTPFAD = [
  'erstkontakt',
  'bedarfsanalyse',
  'unternehmensbewertung',
  'nachfolgekonzept',
  'nachfolgersuche',
  'verhandlung',
  'notartermin',
  'abgeschlossen',
]

type StatusBereich = 'beratung' | 'immobilien' | 'erben' | 'betriebsuebergabe'

export function getStatusMap(bereich: StatusBereich): Record<string, StatusNode> {
  if (bereich === 'beratung') return BERATUNG_STATUS
  if (bereich === 'immobilien') return IMMOBILIEN_STATUS
  if (bereich === 'erben') return ERBEN_STATUS
  return BETRIEBSUEBERGABE_STATUS
}

export function getHauptpfad(bereich: StatusBereich): string[] {
  if (bereich === 'beratung') return BERATUNG_HAUPTPFAD
  if (bereich === 'immobilien') return IMMOBILIEN_HAUPTPFAD
  if (bereich === 'erben') return ERBEN_HAUPTPFAD
  return BETRIEBSUEBERGABE_HAUPTPFAD
}

// Ermittelt den nächsten Hauptpfad-Knoten für den "Weiter →"-Button
export function getNextMainStep(bereich: StatusBereich, currentId: string): string | null {
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
