// Erinnerungen (25.11.2026): eigene Sache, kein To-do. Tabelle `erinnerungen` (supabase/sql/2026-11-25_erinnerungen.sql).
// Angelegt im Telegram-Assistenten („erinnere mich/ihn um …“) oder hier im CRM (Karte „Meine Erinnerungen“ auf „Heute“,
// Seite /erinnerungen). Verschickt werden sie vom Server zur Uhrzeit per Telegram (email-gateway/erinnerungVersand.ts).
// Rechte in der Datenbank: lesen/ändern/löschen nur Empfänger oder Auftraggeber; anlegen nur als Auftraggeber.
import { supabase } from './supabaseClient'

export type Wiederholung = '' | 'taeglich' | 'woechentlich' | 'monatlich'

export const WIEDERHOLUNG_LABEL: Record<Wiederholung, string> = {
  '': 'einmalig',
  taeglich: 'täglich',
  woechentlich: 'wöchentlich',
  monatlich: 'monatlich',
}

export type Erinnerung = {
  id: string
  fuerEmail: string
  vonEmail?: string
  vonName?: string
  text: string
  /** ISO (UTC) */
  faelligUm: string
  kundeId?: string
  gesendetAm?: string
  erledigtAm?: string
  wiederholung: Wiederholung
  privat: boolean
}

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ausZeile(z: any): Erinnerung {
  return {
    id: z.id,
    fuerEmail: String(z.fuer_email ?? '').toLowerCase(),
    vonEmail: z.von_email ? String(z.von_email).toLowerCase() : undefined,
    vonName: z.von_name ?? undefined,
    text: z.text,
    faelligUm: z.faellig_um,
    kundeId: z.kunde_id ?? undefined,
    gesendetAm: z.gesendet_am ?? undefined,
    erledigtAm: z.erledigt_am ?? undefined,
    wiederholung: (['taeglich', 'woechentlich', 'monatlich'].includes(z.wiederholung) ? z.wiederholung : '') as Wiederholung,
    privat: z.privat === true,
  }
}

function fehler(e: { message?: string; code?: string } | null): Error {
  const m = e?.message ?? ''
  if (/row-level security|permission denied/i.test(m)) return new Error('Dafür hast du keine Berechtigung.')
  if (e?.code === '42P01' || e?.code === 'PGRST205' || /erinnerungen.*(does not exist|schema cache)|(does not exist|schema cache).*erinnerungen/i.test(m)) return new Error('Erinnerungen sind noch nicht eingerichtet.')
  return new Error(m ? `Das hat nicht geklappt: ${m}` : 'Das hat nicht geklappt.')
}

/** Offene Erinnerungen an mich oder von mir (noch nicht erledigt). Die Datenbank liefert nur, was ich sehen darf. */
export async function ladeErinnerungen(eigeneEmail: string): Promise<Erinnerung[]> {
  const ich = eigeneEmail.trim().toLowerCase()
  const { data, error } = await client()
    .from('erinnerungen')
    .select('id, fuer_email, von_email, von_name, text, faellig_um, kunde_id, gesendet_am, erledigt_am, wiederholung, privat')
    .is('erledigt_am', null)
    .or(`fuer_email.ilike.${ich},von_email.ilike.${ich}`)
    .order('faellig_um', { ascending: true })
    .limit(500)
  if (error) throw fehler(error)
  return (data ?? []).map(ausZeile)
}

export async function legeErinnerungAn(e: { fuerEmail: string; vonEmail: string; vonName: string; text: string; faelligUm: string; wiederholung: Wiederholung }): Promise<void> {
  const { error } = await client().from('erinnerungen').insert({
    fuer_email: e.fuerEmail.trim().toLowerCase(),
    von_email: e.vonEmail.trim().toLowerCase(),
    von_name: e.vonName,
    text: e.text.trim().slice(0, 500),
    faellig_um: e.faelligUm,
    wiederholung: e.wiederholung,
    privat: false,
    quelle: 'crm',
  })
  if (error) throw fehler(error)
}

/** Neuer Zeitpunkt; kommt dann (wieder) per Telegram. */
export async function verschiebeErinnerung(id: string, faelligUm: string): Promise<void> {
  const { error } = await client().from('erinnerungen').update({ faellig_um: faelligUm, gesendet_am: null, erledigt_am: null }).eq('id', id)
  if (error) throw fehler(error)
}

export async function erledigeErinnerung(id: string): Promise<void> {
  const { error } = await client().from('erinnerungen').update({ erledigt_am: new Date().toISOString() }).eq('id', id)
  if (error) throw fehler(error)
}

export async function loescheErinnerung(id: string): Promise<void> {
  const { error } = await client().from('erinnerungen').delete().eq('id', id)
  if (error) throw fehler(error)
}

const BERLIN = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** „Mi., 25.11., 12:00 Uhr“ */
export function zeitText(iso: string): string {
  return `${BERLIN.format(new Date(iso))} Uhr`
}

/** Wert für <input type="datetime-local"> (Ortszeit des Geräts) aus ISO. */
export function alsEingabe(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Vorschlag für eine neue Erinnerung: nächste volle Stunde + 1. */
export function vorschlagZeit(jetzt = new Date()): string {
  const d = new Date(jetzt)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 2)
  return d.toISOString()
}

/** Morgen 09:00 Ortszeit. */
export function morgenNeun(jetzt = new Date()): string {
  const d = new Date(jetzt)
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}
