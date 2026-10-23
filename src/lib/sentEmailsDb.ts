// Liest über das CRM versendete E-Mails direkt aus der Supabase-Tabelle public.gesendete_emails
// (befüllt von der Edge Function supabase/functions/email-gateway nach erfolgreichem SMTP-Versand,
// siehe dort). Gleicher read-only Supabase-Client/Projekt wie emailInboxDb.ts.

import { createClient } from '@supabase/supabase-js'
import type { GesendeteEmail, KundeBereich } from '../types'

const URL = import.meta.env.VITE_SUPABASE_EMAIL_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_EMAIL_ANON_KEY as string | undefined

export const isSentEmailsDbConfigured = Boolean(URL && ANON_KEY)
const client = isSentEmailsDbConfigured ? createClient(URL!, ANON_KEY!) : null

export async function fetchSentEmails(limit = 20): Promise<GesendeteEmail[]> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const { data, error } = await client
    .from('gesendete_emails')
    .select('id, an, an_name, betreff, text, gesendet_am, kunde_bereich, kunde_id, kunde_name')
    .order('gesendet_am', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id,
    an: row.an,
    anName: row.an_name ?? row.an,
    betreff: row.betreff ?? '(ohne Betreff)',
    text: row.text ?? '',
    gesendetAm: row.gesendet_am,
    kundeBereich: (row.kunde_bereich as KundeBereich | null) ?? undefined,
    kundeId: row.kunde_id ?? undefined,
    kundeName: row.kunde_name ?? undefined,
  }))
}
