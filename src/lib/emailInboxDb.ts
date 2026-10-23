// Liest eingegangene E-Mails direkt aus der Supabase-Tabelle public.eingegangene_emails
// (befüllt von der Edge Function supabase/functions/inbound-email via Webhook-Push, siehe dort).
// Bewusst ein eigenständiger, read-only Supabase-Client für das "mayer-holding-crm"-Projekt —
// unabhängig vom (noch ungenutzten) Fundament-Command-Center-Client in supabaseClient.ts.

import { createClient } from '@supabase/supabase-js'
import type { EingegangeneMail } from './emailGateway'

const URL = import.meta.env.VITE_SUPABASE_EMAIL_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_EMAIL_ANON_KEY as string | undefined

export const isEmailInboxDbConfigured = Boolean(URL && ANON_KEY)
const client = isEmailInboxDbConfigured ? createClient(URL!, ANON_KEY!) : null

export async function fetchStoredEmails(limit = 20): Promise<EingegangeneMail[]> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const { data, error } = await client
    .from('eingegangene_emails')
    .select('id, message_id, von, von_name, betreff, mail_datum, ausschnitt')
    .order('mail_datum', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    messageId: row.message_id ?? row.id,
    von: row.von,
    vonName: row.von_name ?? row.von,
    betreff: row.betreff ?? '(ohne Betreff)',
    datum: row.mail_datum,
    ausschnitt: row.ausschnitt ?? '',
  }))
}
