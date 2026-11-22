// „Ihr Kundenbereich“ (22.11.2026): persönlicher Link je Akte (Tabelle kunden_portal_zugaenge) und die Aufrufe
// der öffentlichen Seite /formular/kunde/:token (email-gateway, kundenPortal.ts). Was der Kunde dort sieht,
// regelt allein der Server; hier nur Anlegen, Beenden, Verlängern, Versand merken und die Einstellung je Mitarbeiter.
import { supabase } from './supabaseClient'
import { call } from './emailGateway'
import { shareableUrl } from '../components/FormularLink'
import { PORTAL_GUELTIG_TAGE, type KundenPortalSeite } from '../../supabase/functions/_shared/kundenPortalKern.ts'

export type { KundenPortalSeite }

export type KundenPortalZugang = {
  id: string
  token: string
  kundeId: string
  status: 'aktiv' | 'widerrufen'
  gueltigBis: string
  erstelltVon?: string
  erstelltAm: string
  widerrufenAm?: string
  widerrufenVon?: string
  versendetAm?: string
  versendetAn?: string
  zugriffe: number
  letzterZugriff?: string
  letzteNachrichtAm?: string
}

export { PORTAL_GUELTIG_TAGE }

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

function fehler(e: { message?: string } | null): Error {
  const m = e?.message ?? ''
  if (/row-level security|permission denied/i.test(m)) return new Error('Für diesen Bereich hast du keine Berechtigung.')
  if (/kunden_portal_zugaenge_ein_aktiver|duplicate key/i.test(m)) return new Error('Für diese Akte gibt es schon einen aktiven Link. Bitte neu laden.')
  if (/kunde_bereich_check|check constraint/i.test(m)) return new Error('Für private Akten gibt es keinen Kundenbereich.')
  if (/relation .* does not exist|kunden_portal_zugaenge/i.test(m)) return new Error('Der Kundenbereich ist in der Datenbank noch nicht eingerichtet.')
  return new Error(m ? `Das hat nicht geklappt: ${m}` : 'Das hat nicht geklappt.')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ausZeile(z: any): KundenPortalZugang {
  return {
    id: z.id,
    token: z.token,
    kundeId: z.kunde_id,
    status: z.status,
    gueltigBis: z.gueltig_bis,
    erstelltVon: z.erstellt_von ?? undefined,
    erstelltAm: z.erstellt_am,
    widerrufenAm: z.widerrufen_am ?? undefined,
    widerrufenVon: z.widerrufen_von ?? undefined,
    versendetAm: z.versendet_am ?? undefined,
    versendetAn: z.versendet_an ?? undefined,
    zugriffe: z.zugriffe ?? 0,
    letzterZugriff: z.letzter_zugriff ?? undefined,
    letzteNachrichtAm: z.letzte_nachricht_am ?? undefined,
  }
}

/** 32 Zufallsbytes, base64url (43 Zeichen) — der Link ist der einzige Schlüssel. */
function neuesToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const kundenPortalLink = (token: string) => shareableUrl(`/formular/kunde/${token}`)

/** Der aktive Link der Akte, sonst der zuletzt beendete (für den Hinweis „beendet am …“), sonst null. */
export async function ladeKundenPortalZugang(kundeId: string): Promise<KundenPortalZugang | null> {
  const { data, error } = await client().from('kunden_portal_zugaenge').select('*').eq('kunde_id', kundeId).order('erstellt_am', { ascending: false }).limit(5)
  if (error) throw fehler(error)
  const zeilen = (data ?? []).map(ausZeile)
  return zeilen.find((z) => z.status === 'aktiv') ?? zeilen[0] ?? null
}

/** Neuer Link: ein bisher aktiver wird zuerst beendet (höchstens ein aktiver je Akte). */
export async function erstelleKundenPortalZugang(kundeId: string, von: string): Promise<KundenPortalZugang> {
  const jetzt = new Date().toISOString()
  const { error: altFehler } = await client()
    .from('kunden_portal_zugaenge')
    .update({ status: 'widerrufen', widerrufen_am: jetzt, widerrufen_von: von })
    .eq('kunde_id', kundeId)
    .eq('status', 'aktiv')
  if (altFehler) throw fehler(altFehler)
  // kunde_bereich setzt der Auslöser in der Datenbank aus der Akte; der Wert hier ist nur Platzhalter für „not null“.
  const { data, error } = await client()
    .from('kunden_portal_zugaenge')
    .insert({ token: neuesToken(), kunde_id: kundeId, kunde_bereich: 'beratung', erstellt_von: von })
    .select('*')
    .single()
  if (error) throw fehler(error)
  return ausZeile(data)
}

export async function beendeKundenPortalZugang(id: string, von: string): Promise<void> {
  const { error } = await client().from('kunden_portal_zugaenge').update({ status: 'widerrufen', widerrufen_am: new Date().toISOString(), widerrufen_von: von }).eq('id', id).eq('status', 'aktiv')
  if (error) throw fehler(error)
}

/** Weitere 180 Tage ab heute. */
export async function verlaengereKundenPortalZugang(id: string): Promise<void> {
  const bis = new Date(Date.now() + PORTAL_GUELTIG_TAGE * 86400000).toISOString()
  const { error } = await client().from('kunden_portal_zugaenge').update({ gueltig_bis: bis }).eq('id', id).eq('status', 'aktiv')
  if (error) throw fehler(error)
}

export async function merkeKundenPortalVersand(id: string, an: string): Promise<void> {
  const { error } = await client().from('kunden_portal_zugaenge').update({ versendet_am: new Date().toISOString(), versendet_an: an }).eq('id', id)
  if (error) throw fehler(error)
}

/** Telegram-Notiz bei Nachrichten aus dem Kundenbereich (keine Zeile = an). */
export async function ladeNachrichtTelegram(email: string): Promise<boolean> {
  const { data, error } = await client().from('kundenportal_einstellungen').select('nachricht_telegram').eq('email', email.trim().toLowerCase()).maybeSingle()
  if (error) throw fehler(error)
  return data?.nachricht_telegram !== false
}

export async function setzeNachrichtTelegram(email: string, an: boolean): Promise<void> {
  const { error } = await client()
    .from('kundenportal_einstellungen')
    .upsert({ email: email.trim().toLowerCase(), nachricht_telegram: an, geaendert_am: new Date().toISOString() }, { onConflict: 'email' })
  if (error) throw fehler(error)
}

/** Vorschlag für die Mail mit dem Link (wird im Fenster noch bearbeitet; geht nur auf Knopfdruck raus). */
export function kundenPortalMailText(e: { anName: string; link: string; gueltigBis: string; wer: string }): { betreff: string; text: string } {
  const bis = new Date(e.gueltigBis).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return {
    betreff: 'Ihr persönlicher Kundenbereich',
    text: [
      e.anName ? `Guten Tag ${e.anName},` : 'Guten Tag,',
      'ab sofort finden Sie alles zu Ihrem Vorgang an einem Ort: den aktuellen Stand, Unterlagen, die wir noch von Ihnen brauchen (zum Hochladen, auch mit dem Handy), Dokumente zum Unterschreiben, Ihre Termine und Rechnungen. Dort können Sie uns auch direkt eine Nachricht schreiben.',
      `Ihr persönlicher Link:\n${e.link}`,
      `Der Link ist bis zum ${bis} gültig und nur für Sie bestimmt. Bitte geben Sie ihn nicht weiter.`,
      `Mit freundlichen Grüßen\n${e.wer}`,
    ].join('\n\n'),
  }
}

// ---------- öffentliche Seite ----------

export async function holeKundenPortal(token: string): Promise<KundenPortalSeite> {
  return (await call({ action: 'public_kundenportal_laden', token })) as KundenPortalSeite
}

export async function sendeKundenPortalNachricht(token: string, text: string): Promise<KundenPortalSeite> {
  return (await call({ action: 'public_kundenportal_nachricht', token, text })) as KundenPortalSeite
}

export async function holeKundenPortalDatei(token: string, art: 'dokument' | 'rechnung', id: string): Promise<string> {
  const r = await call({ action: 'public_kundenportal_dokument', token, art, id })
  if (!r?.url) throw new Error(r?.grund ?? r?.error ?? 'Das Dokument lässt sich gerade nicht öffnen.')
  return r.url as string
}
