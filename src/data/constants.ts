import type { MahnstufeId, ObjektGruppe, ObjektTyp, Prioritaet } from '../types'

export const MAHNSTUFEN: { id: MahnstufeId; label: string }[] = [
  { id: 'erinnerung', label: 'Zahlungserinnerung' },
  { id: 'mahnung1', label: '1. Mahnung' },
  { id: 'mahnung2', label: '2. Mahnung' },
  { id: 'inkasso', label: 'Inkasso' },
]

export function nextMahnstufe(current: MahnstufeId | undefined): MahnstufeId | null {
  const order: MahnstufeId[] = ['erinnerung', 'mahnung1', 'mahnung2', 'inkasso']
  if (!current) return order[0]
  const idx = order.indexOf(current)
  if (idx === -1 || idx === order.length - 1) return null
  return order[idx + 1]
}

export function mahnstufeLabel(id: MahnstufeId | undefined): string {
  if (!id) return '–'
  return MAHNSTUFEN.find((m) => m.id === id)?.label ?? '–'
}

export const OBJEKT_GRUPPEN: { id: ObjektGruppe; label: string; parent?: string }[] = [
  { id: 'aktuell', label: 'Aktuelle Bearbeitungen' },
  { id: 'ausland', label: 'Auslandsobjekte' },
  { id: 'verkauf-intern', label: 'Verkaufsobjekte – Intern', parent: 'Verkaufsobjekte' },
  { id: 'verkauf-extern', label: 'Verkaufsobjekte – Extern', parent: 'Verkaufsobjekte' },
  { id: 'projektierung', label: 'Projektierungen / Neubau' },
]

export function gruppeLabel(id: ObjektGruppe): string {
  return OBJEKT_GRUPPEN.find((g) => g.id === id)?.label ?? id
}

export const OBJEKT_TYPEN: ObjektTyp[] = ['Wohnung', 'Haus', 'Grundstück', 'Gewerbe', 'Neubauprojekt']

export const PRIORITAETEN: Prioritaet[] = ['Hoch', 'Mittel', 'Niedrig']

export const PRIORITAET_ORDER: Record<Prioritaet, number> = { Hoch: 0, Mittel: 1, Niedrig: 2 }

export const PRIORITAET_COLOR: Record<Prioritaet, string> = {
  Hoch: 'bg-rose-100 text-rose-700',
  Mittel: 'bg-amber-100 text-amber-700',
  Niedrig: 'bg-slate-100 text-slate-600',
}

export const VORLAGEN_KATEGORIEN: { id: 'vollmacht' | 'schreiben' | 'vertraege'; label: string }[] = [
  { id: 'vollmacht', label: 'Vollmacht' },
  { id: 'schreiben', label: 'Schreiben' },
  { id: 'vertraege', label: 'Verträge' },
]

// "Verantwortlich"-Dropdown in allen Kunden-/Mandanten-/Objekt-/Projekt-Listen. Lebender Binding
// (kein const) — jetzt, wo es ein echtes Mitarbeiter-/Berechtigungssystem gibt, ersetzt
// AppContext.tsx diese anfänglichen Platzhalter-Namen beim Laden durch die echte, aktive
// Mitarbeiter-Liste aus Supabase (siehe hydrateFromSupabase in crmSync.ts). Im Demo-Modus (ohne
// Supabase) bleiben die Platzhalter bestehen, da es dort keine echten Mitarbeiter-Accounts gibt.
export let MITARBEITER = ['Andreas Mayer', 'Thomas Berger', 'Julia Hartmann', 'Markus Lehmann', 'Sandra Peters']

export function setMitarbeiterListe(namen: string[]) {
  if (namen.length > 0) MITARBEITER = namen
}

// Die echten Lukrativitäts-Einstufungen aus dem separaten ImmoRadar-Tool (eigenständiges
// Scan-/Scoring-Projekt, läuft unter eray-hash.github.io/immobilien-radar).
export const LUKRATIVITAET_OPTIONS = ['sehr interessant', 'interessant', 'neutral', 'eher unattraktiv', 'unattraktiv', 'zu wenig Daten'] as const

export const LUKRATIVITAET_COLOR: Record<string, string> = {
  'sehr interessant': 'bg-emerald-100 text-emerald-700',
  interessant: 'bg-sky-100 text-sky-700',
  neutral: 'bg-slate-100 text-slate-600',
  'eher unattraktiv': 'bg-amber-100 text-amber-700',
  unattraktiv: 'bg-rose-100 text-rose-700',
  'zu wenig Daten': 'bg-slate-100 text-slate-400',
}

// Name, der als Akteur in Aktivitäts-Logs/Signaturen erscheint ("durch ${CURRENT_USER}"). Lebender
// Binding (kein const) — AuthContext.tsx ruft setCurrentUser() mit dem Namen des echten
// eingeloggten Mitarbeiters auf, sobald der verfügbar ist, statt dass hier für immer der
// ursprüngliche Demo-Platzhalter stehen bleibt (der sonst JEDE Aktivität im echten, geteilten CRM
// fälschlich "Eray (Demo)" zuschreiben würde, egal wer wirklich eingeloggt ist).
export let CURRENT_USER = 'Eray (Demo)'

export function setCurrentUser(name: string) {
  CURRENT_USER = name
}
