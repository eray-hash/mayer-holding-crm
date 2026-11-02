// Magic-Link-Login für das Investoren-Portal (kein Passwort, kein Supabase Auth) — ein Investor
// meldet sich mit seiner hinterlegten E-Mail an, bekommt einen Einmal-Klicklink per Mail (über das
// bestehende info@amayer-holding.com-Postfach, siehe emailGateway.ts), und erhält beim Einlösen
// einen 30 Tage gültigen, zufälligen Session-Token. Ersetzt die bisherige, im Browser direkt
// änderbare investorId in localStorage (reiner Vertrauens-Bypass) durch echte, serverseitig
// geprüfte Tokens — die zugehörigen Postgres-Funktionen (SECURITY DEFINER) umgehen die
// RLS von fonds_investoren kontrolliert, um einem Investoren-Besucher ohne Mitarbeiter-Login genau
// seine eigenen Daten zurückzugeben, siehe Migration vom 2026-11-02.
import { supabase, isSupabaseConfigured } from './supabaseClient'
import type { FondsInvestor } from '../types'

export const isPortalAuthConfigured = isSupabaseConfigured

function rowToInvestor(row: any): FondsInvestor {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    telefon: row.telefon,
    seit: row.seit,
    zeichnungen: row.zeichnungen ?? [],
    ausschuettungen: row.ausschuettungen ?? [],
    dokumente: row.dokumente ?? [],
  }
}

export type MagicLinkAnfrage = { gefunden: boolean; token?: string; name?: string; email?: string }

// Gibt bewusst "gefunden" zurück statt die Mail selbst zu verschicken — der Aufrufer (PortalLogin)
// baut daraus den Klicklink und verschickt ihn über emailGateway.ts, damit der Mailversand an einer
// zentralen Stelle bleibt statt in einer Postgres-Funktion nachgebaut zu werden.
export async function requestMagicLink(email: string): Promise<MagicLinkAnfrage> {
  if (!supabase) throw new Error('Portal ist noch nicht konfiguriert.')
  const { data, error } = await supabase.rpc('portal_request_magic_link', { p_email: email })
  if (error) throw new Error(error.message)
  return data as MagicLinkAnfrage
}

export type MagicLinkEinloesung = { status: 'ok'; token: string; investor: FondsInvestor } | { status: 'ungueltig' }

export async function consumeMagicLink(token: string): Promise<MagicLinkEinloesung> {
  if (!supabase) throw new Error('Portal ist noch nicht konfiguriert.')
  const { data, error } = await supabase.rpc('portal_consume_magic_link', { p_token: token })
  if (error) throw new Error(error.message)
  if (data.status !== 'ok') return { status: 'ungueltig' }
  return { status: 'ok', token: data.token, investor: rowToInvestor(data.investor) }
}

export async function fetchMyInvestorData(sessionToken: string): Promise<FondsInvestor | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('portal_get_my_data', { p_token: sessionToken })
  if (error) throw new Error(error.message)
  return data ? rowToInvestor(data) : null
}

export async function portalLogout(sessionToken: string): Promise<void> {
  if (!supabase) return
  await supabase.rpc('portal_logout', { p_token: sessionToken })
}
