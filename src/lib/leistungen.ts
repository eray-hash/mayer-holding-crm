import { supabase } from './supabaseClient'

export type Leistung = {
  id: string
  sortierung: number
  bezeichnung: string
  preis_stunde_von: number | null
  preis_stunde_bis: number | null
  preis_tag_von: number | null
  preis_tag_bis: number | null
  hinweis: string | null
  stand: string
}

export async function holeLeistungen(): Promise<Leistung[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('leistungen_preisliste').select('*').order('sortierung', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as Leistung[]
}
