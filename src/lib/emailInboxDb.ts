// Liest eingegangene E-Mails direkt aus der Supabase-Tabelle public.eingegangene_emails
// (befüllt von der Edge Function supabase/functions/inbound-email via Webhook-Push, siehe dort).
// Bewusst ein eigenständiger, read-only Supabase-Client für das "mayer-holding-crm"-Projekt —
// unabhängig vom (noch ungenutzten) Fundament-Command-Center-Client in supabaseClient.ts.

import { createClient } from '@supabase/supabase-js'
import type { EingegangeneMail } from './emailGateway'

const URL = import.meta.env.VITE_SUPABASE_EMAIL_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_EMAIL_ANON_KEY as string | undefined

export const isEmailInboxDbConfigured = Boolean(URL && ANON_KEY)
const client = isEmailInboxDbConfigured ? createClient(URL!, ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) : null

type Row = {
  message_id: string | null
  id: string
  von: string
  von_name: string | null
  betreff: string | null
  mail_datum: string
  ausschnitt: string | null
  anhaenge: { filename: string; size: number; contentType: string; url: string }[] | null
}

function toMail(row: Row): EingegangeneMail {
  return {
    messageId: row.message_id ?? row.id,
    von: row.von,
    vonName: row.von_name ?? row.von,
    betreff: row.betreff ?? '(ohne Betreff)',
    datum: row.mail_datum,
    ausschnitt: row.ausschnitt ?? '',
    anhaenge: row.anhaenge ?? undefined,
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
    .select('id, message_id, von, von_name, betreff, mail_datum, ausschnitt, anhaenge')
    .or(NUR_RELEVANTE_MAILS)
    .order('mail_datum', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toMail)
}

// Durchsucht Absender, Betreff und Textausschnitt server-seitig (nicht nur die bereits lokal
// geladenen Mails) — damit auch ältere, noch nicht nachgeladene E-Mails über die Suche auffindbar sind.
export async function searchStoredEmails(query: string, limit = 50): Promise<EingegangeneMail[]> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const term = sanitizeSearchTerm(query)
  if (!term) return fetchStoredEmails(limit)
  const { data, error } = await client
    .from('eingegangene_emails')
    .select('id, message_id, von, von_name, betreff, mail_datum, ausschnitt, anhaenge')
    .or(`betreff.ilike.%${term}%,von.ilike.%${term}%,von_name.ilike.%${term}%,ausschnitt.ilike.%${term}%`)
    .or(NUR_RELEVANTE_MAILS)
    .order('mail_datum', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toMail)
}
