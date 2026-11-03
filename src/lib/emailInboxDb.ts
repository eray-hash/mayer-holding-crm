// Liest eingegangene E-Mails direkt aus der Supabase-Tabelle public.eingegangene_emails
// (befüllt von der Edge Function supabase/functions/inbound-email via Webhook-Push, siehe dort).
// Nutzt seit 2026-11-03 den normalen, authentifizierten Mitarbeiter-Client aus supabaseClient.ts —
// vorher lief das über einen eigenständigen, sessionlosen anon-Client (Altlast aus der Zeit vor der
// Supabase-Projekt-Zusammenlegung 2026-09-21), wofür die RLS-Policy auf "jeder darf lesen" stehen
// musste. Das machte den gesamten E-Mail-Posteingang für jeden mit dem öffentlichen Publishable Key
// lesbar, ganz ohne Mitarbeiter-Login — ein echter Sicherheitsfund beim Audit 2026-11-02, erst jetzt
// behoben (RLS verlangt jetzt ist_aktiver_mitarbeiter()).
import { supabase, isSupabaseConfigured } from './supabaseClient'
import type { EingegangeneMail } from './emailGateway'
import type { KundeBereich } from '../types'

export const isEmailInboxDbConfigured = isSupabaseConfigured
const client = supabase

type Row = {
  message_id: string | null
  id: string
  von: string
  von_name: string | null
  betreff: string | null
  mail_datum: string
  ausschnitt: string | null
  anhaenge: { filename: string; size: number; contentType: string; url: string }[] | null
  zugewiesener_kunde_id: string | null
  zugewiesener_bereich: string | null
  zugewiesener_kunde_name: string | null
  ignoriert: boolean | null
}

const SELECT_SPALTEN =
  'id, message_id, von, von_name, betreff, mail_datum, ausschnitt, anhaenge, zugewiesener_kunde_id, zugewiesener_bereich, zugewiesener_kunde_name, ignoriert'

function toMail(row: Row): EingegangeneMail {
  return {
    messageId: row.message_id ?? row.id,
    von: row.von,
    vonName: row.von_name ?? row.von,
    betreff: row.betreff ?? '(ohne Betreff)',
    datum: row.mail_datum,
    ausschnitt: row.ausschnitt ?? '',
    anhaenge: row.anhaenge ?? undefined,
    zugewiesen:
      row.zugewiesener_kunde_id && row.zugewiesener_bereich && row.zugewiesener_kunde_name
        ? { bereich: row.zugewiesener_bereich as KundeBereich, kundeId: row.zugewiesener_kunde_id, kundeName: row.zugewiesener_kunde_name }
        : undefined,
    ignoriert: row.ignoriert ?? undefined,
  }
}

// Entfernt Zeichen, die die PostgREST-".or()"-Filtersyntax (kommagetrennte Bedingungen in
// Klammern) kaputt machen würden, bevor der Suchbegriff in ein ilike-Pattern eingesetzt wird.
function sanitizeSearchTerm(query: string): string {
  return query.replace(/[,()%]/g, ' ').trim()
}

// "nicht_relevant" (automatisch per KI beim Eingang klassifiziert, siehe inbound-email) wird
// ausgeblendet, aber bewusst nicht gelöscht — relevanz ist bei älteren, vor dieser Klassifizierung
// importierten Mails NULL und soll trotzdem sichtbar bleiben, daher explizit "oder NULL".
const NUR_RELEVANTE_MAILS = 'relevanz.is.null,relevanz.neq.nicht_relevant'

export async function fetchStoredEmails(limit = 20): Promise<EingegangeneMail[]> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const { data, error } = await client
    .from('eingegangene_emails')
    .select(SELECT_SPALTEN)
    .or(NUR_RELEVANTE_MAILS)
    .order('mail_datum', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toMail)
}

// Schreibt eine manuelle Zuordnung/Ignorieren-Markierung aus dem Postfach zurück in die DB — bis
// 2026-11-02 passierte das nur lokal im Browser des handelnden Mitarbeiters, ein Kollege auf einem
// anderen Gerät sah dieselbe E-Mail danach weiterhin als neu/unbearbeitet an.
export async function assignMail(messageId: string, bereich: KundeBereich, kundeId: string, kundeName: string): Promise<void> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const { error } = await client
    .from('eingegangene_emails')
    .update({ zugewiesener_bereich: bereich, zugewiesener_kunde_id: kundeId, zugewiesener_kunde_name: kundeName })
    .eq('message_id', messageId)
  if (error) throw new Error(error.message)
}

export async function ignoreMail(messageId: string): Promise<void> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const { error } = await client.from('eingegangene_emails').update({ ignoriert: true }).eq('message_id', messageId)
  if (error) throw new Error(error.message)
}

// Durchsucht Absender, Betreff und Textausschnitt server-seitig (nicht nur die bereits lokal
// geladenen Mails) — damit auch ältere, noch nicht nachgeladene E-Mails über die Suche auffindbar sind.
export async function searchStoredEmails(query: string, limit = 50): Promise<EingegangeneMail[]> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const term = sanitizeSearchTerm(query)
  if (!term) return fetchStoredEmails(limit)
  const { data, error } = await client
    .from('eingegangene_emails')
    .select(SELECT_SPALTEN)
    .or(`betreff.ilike.%${term}%,von.ilike.%${term}%,von_name.ilike.%${term}%,ausschnitt.ilike.%${term}%`)
    .or(NUR_RELEVANTE_MAILS)
    .order('mail_datum', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toMail)
}
