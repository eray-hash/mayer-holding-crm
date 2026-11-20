import { callAuthenticated } from './emailGateway'

// Vorgemerkte Aktionen (Senden, Löschen, Einladungen), die erst nach Bestätigung ausgeführt werden.
// Server: supabase/functions/email-gateway/vormerkungen.ts.

export type Vormerkung = {
  id: string
  art: string
  beschreibung: string
  vorschau: string
  quelle: string
  status: 'offen' | 'laeuft' | 'ausgefuehrt' | 'verworfen' | 'fehler'
  ergebnis: string | null
  erstellt_am: string
  erledigt_am: string | null
}

export type VormerkErgebnis = { id: string; beschreibung: string; ok: boolean; meldung: string }

export async function ladeVormerkungen(): Promise<Vormerkung[]> {
  return (await callAuthenticated({ action: 'vormerkungen_liste' })).vormerkungen ?? []
}

export async function bestaetigeVormerkungen(ids: string[]): Promise<VormerkErgebnis[]> {
  return (await callAuthenticated({ action: 'vormerkung_bestaetigen', ids })).ergebnisse ?? []
}

export async function verwerfeVormerkungen(ids: string[]): Promise<number> {
  return (await callAuthenticated({ action: 'vormerkung_verwerfen', ids })).verworfen ?? 0
}

export type SendeArt = 'mail_senden' | 'mail_antworten' | 'mail_weiterleiten'

/** Sofort senden aus dem CRM-Fenster (der Klick mit Rückfrage ist die Bestätigung). */
export async function sendeUeberOutlook(art: SendeArt, parameter: Record<string, unknown>): Promise<string> {
  return (await callAuthenticated({ action: 'outlook_senden', art, parameter })).meldung ?? 'Gesendet.'
}
