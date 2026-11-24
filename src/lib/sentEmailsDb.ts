// Liest über das CRM versendete E-Mails direkt aus der Supabase-Tabelle public.gesendete_emails
// (befüllt von der Edge Function supabase/functions/email-gateway nach erfolgreichem SMTP-Versand,
// siehe dort). Nutzt seit 2026-11-03 den authentifizierten Mitarbeiter-Client, siehe emailInboxDb.ts
// für den Hintergrund (vorher über öffentlichen Publishable Key ohne Login lesbar).
import { supabase, isSupabaseConfigured } from './supabaseClient'
import type { GesendeteEmail, KundeBereich } from '../types'
import { alleZeilen } from './alleZeilen'

export const isSentEmailsDbConfigured = isSupabaseConfigured
const client = supabase

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
  von: string | null
  postfach_id: string | null
  postfach_bereich?: string | null
}

const SPALTEN = 'id, an, an_name, betreff, text, gesendet_am, kunde_bereich, kunde_id, kunde_name, von, postfach_id, postfach_bereich'

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
    von: row.von ?? undefined,
    postfachId: row.postfach_id ?? undefined,
    postfachBereich: row.postfach_bereich ?? undefined,
  }
}

function sanitizeSearchTerm(query: string): string {
  return query.replace(/[,()%]/g, ' ').trim()
}

export async function fetchSentEmails(limit = 20): Promise<GesendeteEmail[]> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const { data, error } = await client
    .from('gesendete_emails')
    .select(SPALTEN)
    .is('besitzer_email', null)
    .order('gesendet_am', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toMail)
}

// Postausgang-Verlauf für die Kommunikation-Ansicht einer Kundenakte.
export async function fetchSentEmailsForKunde(kundeId: string): Promise<GesendeteEmail[]> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const db = client
  // Seitenweise (die Datenbank liefert höchstens 1000 Zeilen je Abfrage).
  const { data, error } = await alleZeilen<Row>(() =>
    db.from('gesendete_emails').select(SPALTEN).eq('kunde_id', kundeId).is('besitzer_email', null).order('gesendet_am', { ascending: false }),
  )
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
    .select(SPALTEN)
    .is('besitzer_email', null)
    .or(`betreff.ilike.%${term}%,an.ilike.%${term}%,an_name.ilike.%${term}%,text.ilike.%${term}%`)
    .order('gesendet_am', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toMail)
}

// Aus dem privaten Postfach gesendete Mails (nur für den Absender sichtbar).
export async function fetchPrivateSentEmails(eigeneEmail: string, limit = 30, suche = ''): Promise<GesendeteEmail[]> {
  if (!client) throw new Error('E-Mail-Datenbank ist noch nicht konfiguriert.')
  const term = sanitizeSearchTerm(suche)
  let abfrage = client.from('gesendete_emails').select(SPALTEN).eq('besitzer_email', eigeneEmail.toLowerCase())
  if (term) abfrage = abfrage.or(`betreff.ilike.%${term}%,an.ilike.%${term}%,an_name.ilike.%${term}%,text.ilike.%${term}%`)
  const { data, error } = await abfrage.order('gesendet_am', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toMail)
}
