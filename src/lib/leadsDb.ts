// Liest/aktualisiert Lead-Vorschläge aus public.vorgeschlagene_leads (befüllt von
// scripts/extract-leads.mjs, später auch von öffentlichen Fragenkatalog-Formularen). Gleicher
// read/update-Client wie emailInboxDb.ts/sentEmailsDb.ts — "update" ist hier absichtlich per
// RLS-Policy für den Publishable Key erlaubt (nur das status-Feld wird geändert), damit das CRM
// Leads direkt als "übernommen"/"verworfen" markieren kann, ohne über die Edge Function zu gehen.

import { createClient } from '@supabase/supabase-js'
import type { VorgeschlagenerLead, KundeBereich } from '../types'

const URL = import.meta.env.VITE_SUPABASE_EMAIL_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_EMAIL_ANON_KEY as string | undefined

export const isLeadsDbConfigured = Boolean(URL && ANON_KEY)
const client = isLeadsDbConfigured ? createClient(URL!, ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) : null

type Row = {
  id: string
  email: string
  name: string | null
  firma: string | null
  telefon: string | null
  bereich_vorschlag: string | null
  notiz: string | null
  status: string
  erstellt_am: string
}

function toLead(row: Row): VorgeschlagenerLead {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? undefined,
    firma: row.firma ?? undefined,
    telefon: row.telefon ?? undefined,
    bereichVorschlag: (row.bereich_vorschlag as KundeBereich | 'unklar' | null) ?? 'unklar',
    notiz: row.notiz ?? '',
    status: (row.status as VorgeschlagenerLead['status']) ?? 'offen',
    erstelltAm: row.erstellt_am,
  }
}

export async function fetchOffeneLeads(): Promise<VorgeschlagenerLead[]> {
  if (!client) throw new Error('Lead-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const { data, error } = await client
    .from('vorgeschlagene_leads')
    .select('id, email, name, firma, telefon, bereich_vorschlag, notiz, status, erstellt_am')
    .eq('status', 'offen')
    .order('erstellt_am', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toLead)
}

export async function setLeadStatus(id: string, status: 'uebernommen' | 'verworfen'): Promise<void> {
  if (!client) throw new Error('Lead-Datenbank ist noch nicht konfiguriert (VITE_SUPABASE_EMAIL_URL fehlt).')
  const { error } = await client.from('vorgeschlagene_leads').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
}
