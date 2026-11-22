// Eigener Kalender (Outlook, iPhone/iCloud, Google, IONOS …) als belegte Zeiten im CRM-Kalender.
// Der Link wird nur über den Server gespeichert und geprüft (email-gateway, fremdKalender.ts); die
// belegten Zeiten liest die Datenbankfunktion kalender_fremd_belegt — nur Zeiträume, nie Inhalte.
import { supabase } from '../../lib/supabaseClient'
import { callAuthenticated } from '../../lib/emailGateway'

export type FremdBelegt = { person: string; beginn: string; ende: string; ganztags: boolean; sperrt: boolean }

export type FremdStatus = {
  verbunden: boolean
  url?: string
  stand?: string | null
  anzahl?: number
  fehler?: string | null
}

/** Belegte Zeiten aus den eigenen Kalendern (eigene immer, Kollegen nur bei freigegebener Sichtbarkeit). */
export async function ladeFremdBelegt(von: Date, bis: Date): Promise<FremdBelegt[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('kalender_fremd_belegt', { von: von.toISOString(), bis: bis.toISOString() })
  // Fehlt die Funktion (noch nicht eingespielt) oder klappt es nicht: Kalender ohne diese Zeiten zeigen.
  if (error) return []
  return ((data ?? []) as FremdBelegt[]).map((b) => ({ ...b, person: String(b.person).toLowerCase(), ganztags: !!b.ganztags, sperrt: !!b.sperrt }))
}

export async function ladeFremdStatus(): Promise<FremdStatus> {
  return (await callAuthenticated({ action: 'kalender_fremd_laden' })) as FremdStatus
}

/** Speichert den Link (liest ihn vorher einmal; ein falscher Link wird nicht gespeichert). Leer = trennen. */
export async function speichereFremdLink(url: string): Promise<FremdStatus> {
  return (await callAuthenticated({ action: 'kalender_fremd_speichern', url })) as FremdStatus
}

export async function aktualisiereFremd(): Promise<FremdStatus> {
  return (await callAuthenticated({ action: 'kalender_fremd_aktualisieren' })) as FremdStatus
}
