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

export const MITARBEITER = ['Thomas Berger', 'Julia Hartmann', 'Markus Lehmann', 'Sandra Peters']

export const CURRENT_USER = 'Eray (Demo)'
