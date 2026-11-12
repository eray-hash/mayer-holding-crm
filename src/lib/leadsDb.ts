// Liest/aktualisiert Lead-Vorschläge aus public.vorgeschlagene_leads (befüllt von
// scripts/extract-leads.mjs bzw. der classify_new_leads-Action, beide mit Service-Role-Key, also
// unabhängig von dieser RLS). Nutzt seit 2026-11-03 den authentifizierten Mitarbeiter-Client, siehe
// emailInboxDb.ts für den Hintergrund (vorher über öffentlichen Publishable Key ohne Login lesbar
// UND beschreibbar).
import { supabase, isSupabaseConfigured } from './supabaseClient'
import type { VorgeschlagenerLead, KundeBereich } from '../types'

export const isLeadsDbConfigured = isSupabaseConfigured
const client = supabase

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
    // Der Klassifizierer sagt "immobilien"; der Kundenbereich dazu heißt im CRM "immobilienkunden".
    bereichVorschlag: row.bereich_vorschlag === 'immobilien' ? 'immobilienkunden' : ((row.bereich_vorschlag as KundeBereich | 'unklar' | null) ?? 'unklar'),
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
