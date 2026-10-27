// Liest über das CRM versendete E-Mails direkt aus der Supabase-Tabelle public.gesendete_emails
// (befüllt von der Edge Function supabase/functions/email-gateway nach erfolgreichem SMTP-Versand,
// siehe dort). Gleicher read-only Supabase-Client/Projekt wie emailInboxDb.ts.

import { createClient } from '@supabase/supabase-js'
import type { GesendeteEmail, KundeBereich } from '../types'

const URL = import.meta.env.VITE_SUPABASE_EMAIL_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_EMAIL_ANON_KEY as string | undefined

export const isSentEmailsDbConfigured = Boolean(URL && ANON_KEY)
const client = isSentEmailsDbConfigured ? createClient(URL!, ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) : null

type Row = {
  id: string
  an: string
  an_name: string | null
  betreff: string | null
  text: string | null
  gesendet_am: string
  kunde_bereich: string | null
  kunde_id: string | null
  kunde_name: string | null
}

function toMail(row: Row): GesendeteEmail {
  return {
    id: row.id,
    an: row.an,
    anName: row.an_name ?? row.an,
    betreff: row.betreff ?? '(ohne Betreff)',
    text: row.text ?? '',
    gesendetAm: row.gesendet_am,
    kundeBereich: (row.kunde_bereich as KundeBereich | null) ?? undefined,
    kundeId: row.kunde_id ?? undefined,
    kundeName: row.kunde_name ?? undefined,
  }
}

function sanitizeSearchTerm(query: string): string {
  return query.replace(/[,()%]/g, ' ').trim()
}

export async function fetchSentEmails(limit = 20): Promise<GesendeteEmail[]> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const { data, error } = await client
    .from('gesendete_emails')
    .select('id, an, an_name, betreff, text, gesendet_am, kunde_bereich, kunde_id, kunde_name')
    .order('gesendet_am', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toMail)
}

// Durchsucht Empfänger, Betreff und Text server-seitig, siehe searchStoredEmails in emailInboxDb.ts.
export async function searchSentEmails(query: string, limit = 50): Promise<GesendeteEmail[]> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const term = sanitizeSearchTerm(query)
  if (!term) return fetchSentEmails(limit)
  const { data, error } = await client
    .from('gesendete_emails')
    .select('id, an, an_name, betreff, text, gesendet_am, kunde_bereich, kunde_id, kunde_name')
    .or(`betreff.ilike.%${term}%,an.ilike.%${term}%,an_name.ilike.%${term}%,text.ilike.%${term}%`)
    .order('gesendet_am', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toMail)
}
