// Lesezugriffe für den Kalender. Eigene und gemeinsam gebuchte Termine kommen vollständig aus der
// Tabelle `termine` (der Zeilenschutz liefert nur die, an denen man beteiligt ist). Von allen anderen
// Terminen der Kollegen liefert `kalender_belegt` nur den Zeitraum — nie Titel oder Inhalt.
// Geschrieben wird nur über den Server (siehe speichereTerminRemote in emailGateway.ts).
import { supabase } from './supabaseClient'

export type Termin = {
  id: string
  titel: string
  beschreibung: string
  ort: string
  beginn: string
  ende: string
  ganztags: boolean
  besitzerEmail: string
  teilnehmer: string[]
  kundeId?: string
  kundeBereich?: string
  kundeName?: string
}

export type Belegt = { person: string; beginn: string; ende: string; ganztags: boolean }
export type Kollege = { name: string; email: string }
export type KalenderEinstellungen = { erinnerungen: number[]; sichtbar: boolean }

export const ERINNERUNGS_WAHL: { minuten: number; label: string }[] = [
  { minuten: 1440, label: '1 Tag vorher' },
  { minuten: 60, label: '1 Stunde vorher' },
  { minuten: 30, label: '30 Minuten vorher' },
  { minuten: 15, label: '15 Minuten vorher' },
]

function client() {
  if (!supabase) throw new Error('Der Kalender braucht die Verbindung zur Datenbank.')
  return supabase
}

export async function ladeTermine(von: Date, bis: Date): Promise<Termin[]> {
  const { data, error } = await client().from('termine').select('*').lt('beginn', bis.toISOString()).gt('ende', von.toISOString()).order('beginn')
  if (error) throw new Error(error.message)
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((t: any) => ({
    id: t.id,
    titel: t.titel,
    beschreibung: t.beschreibung ?? '',
    ort: t.ort ?? '',
    beginn: t.beginn,
    ende: t.ende,
    ganztags: !!t.ganztags,
    besitzerEmail: String(t.besitzer_email).toLowerCase(),
    teilnehmer: t.teilnehmer ?? [],
    kundeId: t.kunde_id ?? undefined,
    kundeBereich: t.kunde_bereich ?? undefined,
    kundeName: t.kunde_name ?? undefined,
  }))
}

export async function ladeBelegt(von: Date, bis: Date): Promise<Belegt[]> {
  const { data, error } = await client().rpc('kalender_belegt', { von: von.toISOString(), bis: bis.toISOString() })
  if (error) throw new Error(error.message)
  return (data ?? []) as Belegt[]
}

export async function ladeKollegen(): Promise<Kollege[]> {
  const { data, error } = await client().from('mitarbeiter').select('name, email').eq('aktiv', true).order('name')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Kollege[]).map((k) => ({ name: k.name, email: k.email.toLowerCase() }))
}

export async function ladeEinstellungen(email: string): Promise<KalenderEinstellungen> {
  const { data } = await client().from('kalender_einstellungen').select('erinnerungen, sichtbar').eq('email', email.toLowerCase()).maybeSingle()
  return { erinnerungen: data?.erinnerungen ?? [60], sichtbar: data?.sichtbar ?? true }
}

export async function speichereEinstellungen(email: string, e: KalenderEinstellungen): Promise<void> {
  const { error } = await client()
    .from('kalender_einstellungen')
    .upsert({ email: email.toLowerCase(), erinnerungen: e.erinnerungen, sichtbar: e.sichtbar, geaendert_am: new Date().toISOString() })
  if (error) throw new Error(error.message)
}

export async function telegramVerbunden(email: string): Promise<boolean> {
  const { data } = await client().from('mitarbeiter').select('telegram_chat_id').eq('email', email).maybeSingle()
  return !!data?.telegram_chat_id
}
