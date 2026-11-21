// Seminarkatalog der Akademie (Liste von Hasan Süslü, 21.11.2026): Tabelle `seminare`.
// Zugriff wie der Bereich Akademie (darf_bereich('akademie') in der Datenbank).
import { supabase } from './supabaseClient'
import type { SeminarStand } from '../types'

export type SeminarKatalogStand = 'in_planung' | 'buchbar' | 'ruht'

export type Seminar = {
  id: string
  bereich: string
  bereichSortierung: number
  titel: string
  beschreibung?: string
  dauer?: string
  preisNetto?: number
  dozent?: string
  stand: SeminarKatalogStand
  sortierung: number
  geaendertVon?: string
}

export const KATALOG_STAND: { id: SeminarKatalogStand; label: string; farbe: string }[] = [
  { id: 'in_planung', label: 'In Planung', farbe: 'bg-slate-100 text-slate-600' },
  { id: 'buchbar', label: 'Buchbar', farbe: 'bg-emerald-50 text-emerald-700' },
  { id: 'ruht', label: 'Ruht', farbe: 'bg-amber-50 text-amber-700' },
]

export const TEILNEHMER_STAND: { id: SeminarStand; label: string }[] = [
  { id: 'interessiert', label: 'Interessiert' },
  { id: 'angemeldet', label: 'Angemeldet' },
  { id: 'teilgenommen', label: 'Teilgenommen' },
]

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

function fehler(e: { message?: string } | null): Error {
  const m = e?.message ?? ''
  if (/row-level security|permission denied/i.test(m)) return new Error('Für die Akademie hast du keine Berechtigung.')
  return new Error(m ? `Seminar ließ sich nicht speichern: ${m}` : 'Seminar ließ sich nicht speichern.')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ausZeile(z: any): Seminar {
  return {
    id: z.id,
    bereich: z.bereich,
    bereichSortierung: z.bereich_sortierung ?? 99,
    titel: z.titel,
    beschreibung: z.beschreibung ?? undefined,
    dauer: z.dauer ?? undefined,
    preisNetto: z.preis_netto === null || z.preis_netto === undefined ? undefined : Number(z.preis_netto),
    dozent: z.dozent ?? undefined,
    stand: z.stand,
    sortierung: z.sortierung ?? 0,
    geaendertVon: z.geaendert_von ?? undefined,
  }
}

export async function ladeSeminare(): Promise<Seminar[]> {
  const { data, error } = await client().from('seminare').select('*').order('bereich_sortierung').order('sortierung')
  if (error) throw fehler(error)
  return (data ?? []).map(ausZeile)
}

type Aenderung = Partial<Pick<Seminar, 'bereich' | 'titel' | 'beschreibung' | 'dauer' | 'preisNetto' | 'dozent' | 'stand'>>

function zeile(e: Aenderung): Record<string, unknown> {
  const z: Record<string, unknown> = {}
  if (e.bereich !== undefined) z.bereich = e.bereich.trim()
  if (e.titel !== undefined) z.titel = e.titel.trim()
  if (e.beschreibung !== undefined) z.beschreibung = e.beschreibung.trim() || null
  if (e.dauer !== undefined) z.dauer = e.dauer.trim() || null
  if (e.preisNetto !== undefined) z.preis_netto = Number.isFinite(e.preisNetto) ? e.preisNetto : null
  if (e.dozent !== undefined) z.dozent = e.dozent.trim() || null
  if (e.stand !== undefined) z.stand = e.stand
  return z
}

export async function legeSeminarAn(e: Aenderung & { titel: string; bereich: string }, von: string, alle: Seminar[]): Promise<Seminar> {
  const imBereich = alle.filter((s) => s.bereich === e.bereich.trim())
  const bereichSortierung = imBereich[0]?.bereichSortierung ?? Math.max(-1, ...alle.map((s) => s.bereichSortierung)) + 1
  const sortierung = Math.max(0, ...alle.map((s) => s.sortierung)) + 1
  const { data, error } = await client()
    .from('seminare')
    .insert({ ...zeile(e), bereich_sortierung: bereichSortierung, sortierung, geaendert_von: von, quelle: `angelegt von ${von}` })
    .select('*')
    .single()
  if (error) throw fehler(error)
  return ausZeile(data)
}

export async function aendereSeminar(id: string, e: Aenderung, von: string): Promise<void> {
  const { error } = await client().from('seminare').update({ ...zeile(e), geaendert_am: new Date().toISOString(), geaendert_von: von }).eq('id', id)
  if (error) throw fehler(error)
}

export async function loescheSeminar(id: string): Promise<void> {
  const { error } = await client().from('seminare').delete().eq('id', id)
  if (error) throw fehler(error)
}

/** Seminare nach Bereich gruppiert, in Katalog-Reihenfolge. */
export function nachBereich(liste: Seminar[]): [string, Seminar[]][] {
  const m = new Map<string, Seminar[]>()
  for (const s of [...liste].sort((a, b) => a.bereichSortierung - b.bereichSortierung || a.sortierung - b.sortierung)) {
    m.set(s.bereich, [...(m.get(s.bereich) ?? []), s])
  }
  return [...m.entries()]
}
