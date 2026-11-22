// Interessenten-Portal für Objekte (21.11.2026): Freigaben je Interessent (Tabelle objekt_freigaben),
// welche Unterlagen Interessenten sehen dürfen (objekte.interessenten_dokumente) und die Aufrufe der
// öffentlichen Seite /formular/objekt/:token (email-gateway, objektPortal.ts).
import { supabase } from './supabaseClient'
import { call } from './emailGateway'
import { shareableUrl } from '../components/FormularLink'

export type ObjektFreigabe = {
  id: string
  token: string
  objektId: string
  kundeId?: string
  name: string
  email?: string
  telefon?: string
  provision: string
  status: 'eingeladen' | 'zugestimmt' | 'widerrufen'
  gueltigBis: string
  zustimmung?: { am: string; name: string }
  zugriffe: number
  letzterZugriff?: string
  erstelltVon?: string
  erstelltAm: string
  /** 'anfrage' = vom Anfragenmanager aus einer eingegangenen Anfrage angelegt (email-gateway/anfragenManager.ts). */
  quelle?: string
  anfrageEmailId?: string
}

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

function fehler(e: { message?: string } | null): Error {
  const m = e?.message ?? ''
  if (/row-level security|permission denied/i.test(m)) return new Error('Für die Immobilien-Abteilung hast du keine Berechtigung.')
  return new Error(m ? `Das hat nicht geklappt: ${m}` : 'Das hat nicht geklappt.')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ausZeile(z: any): ObjektFreigabe {
  return {
    id: z.id,
    token: z.token,
    objektId: z.objekt_id,
    kundeId: z.kunde_id ?? undefined,
    name: z.name,
    email: z.email ?? undefined,
    telefon: z.telefon ?? undefined,
    provision: z.provision,
    status: z.status,
    gueltigBis: z.gueltig_bis,
    zustimmung: z.zustimmung ? { am: z.zustimmung.am, name: z.zustimmung.name } : undefined,
    zugriffe: z.zugriffe ?? 0,
    letzterZugriff: z.letzter_zugriff ?? undefined,
    erstelltVon: z.erstellt_von ?? undefined,
    erstelltAm: z.erstellt_am,
    quelle: z.quelle ?? undefined,
    anfrageEmailId: z.anfrage_email_id ?? undefined,
  }
}

/** 32 Zufallsbytes, base64url (43 Zeichen) — der Link ist der einzige Schlüssel. */
function neuesToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const portalLink = (token: string) => shareableUrl(`/formular/objekt/${token}`)

export async function ladeFreigaben(objektId: string): Promise<ObjektFreigabe[]> {
  const { data, error } = await client().from('objekt_freigaben').select('*').eq('objekt_id', objektId).order('erstellt_am', { ascending: false })
  if (error) throw fehler(error)
  return (data ?? []).map(ausZeile)
}

export async function legeFreigabeAn(e: { objektId: string; name: string; email?: string; telefon?: string; provision: string; kundeId?: string; kundeBereich?: string; von: string }): Promise<ObjektFreigabe> {
  const { data, error } = await client()
    .from('objekt_freigaben')
    .insert({
      token: neuesToken(),
      objekt_id: e.objektId,
      kunde_id: e.kundeId ?? null,
      kunde_bereich: e.kundeBereich ?? null,
      name: e.name.trim(),
      email: e.email?.trim() || null,
      telefon: e.telefon?.trim() || null,
      provision: e.provision.trim(),
      erstellt_von: e.von,
    })
    .select('*')
    .single()
  if (error) throw fehler(error)
  return ausZeile(data)
}

export async function beendeFreigabe(id: string, von: string): Promise<void> {
  const { error } = await client().from('objekt_freigaben').update({ status: 'widerrufen', widerrufen_am: new Date().toISOString(), widerrufen_von: von }).eq('id', id)
  if (error) throw fehler(error)
}

export async function ladeInteressentenDokumente(objektId: string): Promise<string[]> {
  const { data, error } = await client().from('objekte').select('interessenten_dokumente').eq('id', objektId).maybeSingle()
  if (error) throw fehler(error)
  return Array.isArray(data?.interessenten_dokumente) ? (data!.interessenten_dokumente as string[]) : []
}

export async function setzeInteressentenDokumente(objektId: string, ids: string[]): Promise<void> {
  const { error } = await client().from('objekte').update({ interessenten_dokumente: ids }).eq('id', objektId)
  if (error) throw fehler(error)
}

/** Nummern des Inserats auf Portalen (Scout-ID, Online-ID, Anzeigennummer, eigene Objektnummer) — daran erkennt
 *  der Anfragenmanager auf dem Server Anfragen zu diesem Objekt. */
export async function ladeAnfrageKennungen(objektId: string): Promise<string[]> {
  const { data, error } = await client().from('objekte').select('anfrage_kennungen').eq('id', objektId).maybeSingle()
  if (error) throw fehler(error)
  return Array.isArray(data?.anfrage_kennungen) ? (data!.anfrage_kennungen as string[]) : []
}

export async function setzeAnfrageKennungen(objektId: string, kennungen: string[]): Promise<void> {
  const sauber = Array.from(new Set(kennungen.map((k) => k.trim()).filter((k) => k.length >= 3)))
  const { error } = await client().from('objekte').update({ anfrage_kennungen: sauber }).eq('id', objektId)
  if (error) throw fehler(error)
}

// ---------- öffentliche Seite ----------

export type PortalSeite =
  | { stufe: 'ungueltig'; grund: string }
  | { stufe: 'fehler'; grund: string }
  | { stufe: 'zustimmung'; name: string; objekt: { bezeichnung: string; ort: string; typ: string; kaufpreis: number | null }; texte: { agb: string; provision: string; widerruf: string } }
  | {
      stufe: 'frei'
      name: string
      zugestimmtAm: string
      objekt: { bezeichnung: string; adresse: string; typ: string; kaufpreis: number | null; beschreibung: string }
      dokumente: { id: string; name: string; typ: string; groesse: string }[]
    }

export async function holePortal(token: string): Promise<PortalSeite> {
  return (await call({ action: 'public_objekt_portal', token })) as PortalSeite
}

export async function stimmePortalZu(token: string, e: { name: string; agb: boolean; provision: boolean; sofortBeginn: boolean }): Promise<PortalSeite> {
  return (await call({ action: 'public_objekt_portal_zustimmen', token, ...e })) as PortalSeite
}

export async function holePortalDokument(token: string, dokumentId: string): Promise<string> {
  const r = await call({ action: 'public_objekt_portal_dokument', token, dokumentId })
  if (!r?.url) throw new Error(r?.fehler ?? 'Das Dokument lässt sich gerade nicht öffnen.')
  return r.url as string
}
