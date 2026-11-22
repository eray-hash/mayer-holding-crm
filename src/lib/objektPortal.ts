// Interessenten-Portal für Objekte (21.11.2026): Freigaben je Interessent (Tabelle objekt_freigaben),
// welche Unterlagen Interessenten sehen dürfen (objekte.interessenten_dokumente) und die Aufrufe der
// öffentlichen Seite /formular/objekt/:token (email-gateway, objektPortal.ts).
import { supabase } from './supabaseClient'
import { call } from './emailGateway'
import { shareableUrl } from '../components/FormularLink'
import { ladeBelegt, ladeTermine } from './kalenderDb'
import { belegtVon, type BelegtBlock, type FremdZeile, type TerminZeile } from '../../supabase/functions/_shared/besichtigungZeiten.ts'

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
      besichtigung: PortalBesichtigung
      hinweis?: string
    }

export type PortalBesichtigung = {
  zeiten: { id: string; beginn: string; ende: string; treffpunkt: string; makler: string; freiePlaetze: number }[]
  meine: { id: string; beginn: string; ende: string; treffpunkt: string; makler: string } | null
  rueckrufAm: string | null
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

/** Besichtigung im Portal: Termin buchen, absagen oder um Rückruf bitten. */
export async function portalBesichtigen(
  token: string,
  e: { art: 'buchen'; zeitId: string; telefon?: string } | { art: 'absagen'; besichtigungId: string } | { art: 'rueckruf'; telefon?: string; nachricht?: string },
): Promise<PortalSeite> {
  return (await call({ action: 'public_objekt_portal_besichtigung', token, ...e })) as PortalSeite
}

// ---------- Besichtigungszeiten für Interessenten (Objektakte) ----------

export type BesichtigungsZeit = {
  id: string
  objektId: string
  beginn: string
  ende: string
  plaetze: number
  makler: string
  treffpunkt: string
  status: 'offen' | 'abgesagt'
  erstelltVon: string
  /** Gebuchte (geplante) Besichtigungen zu dieser Zeit. */
  gebucht: { id: string; interessent: string }[]
}

/** Freigegebene Zeiten eines Objekts mit den Buchungen dazu, nach Beginn sortiert. */
export async function ladeBesichtigungsZeiten(objektId: string): Promise<BesichtigungsZeit[]> {
  const [zeiten, buchungen] = await Promise.all([
    client().from('besichtigung_zeiten').select('*').eq('objekt_id', objektId).order('beginn'),
    client().from('besichtigungen').select('id, interessent, besichtigung_zeit_id').eq('objekt_id', objektId).eq('status', 'geplant').not('besichtigung_zeit_id', 'is', null),
  ])
  if (zeiten.error) throw fehler(zeiten.error)
  const je = new Map<string, { id: string; interessent: string }[]>()
  for (const b of (buchungen.data ?? []) as { id: string; interessent: string; besichtigung_zeit_id: string }[]) {
    je.set(b.besichtigung_zeit_id, [...(je.get(b.besichtigung_zeit_id) ?? []), { id: b.id, interessent: b.interessent }])
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (zeiten.data ?? []).map((z: any) => ({
    id: z.id,
    objektId: z.objekt_id,
    beginn: z.beginn,
    ende: z.ende,
    plaetze: Number(z.plaetze ?? 1),
    makler: z.makler ?? '',
    treffpunkt: z.treffpunkt ?? '',
    status: z.status,
    erstelltVon: z.erstellt_von ?? '',
    gebucht: je.get(z.id) ?? [],
  }))
}

export async function legeBesichtigungsZeitenAn(
  objektId: string,
  zeiten: { beginn: string; ende: string }[],
  e: { makler: string; treffpunkt: string; plaetze: number; von: string },
): Promise<void> {
  if (zeiten.length === 0) return
  const { error } = await client()
    .from('besichtigung_zeiten')
    .insert(zeiten.map((z) => ({ objekt_id: objektId, beginn: z.beginn, ende: z.ende, plaetze: e.plaetze, makler: e.makler.trim(), treffpunkt: e.treffpunkt.trim(), erstellt_von: e.von })))
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('Mindestens eine dieser Zeiten ist schon freigegeben. Bitte die Liste neu laden.')
    throw fehler(error)
  }
}

export async function sageBesichtigungsZeitAb(id: string): Promise<void> {
  const { error } = await client().from('besichtigung_zeiten').update({ status: 'abgesagt' }).eq('id', id)
  if (error) throw fehler(error)
}

export async function loescheBesichtigungsZeit(id: string): Promise<void> {
  const { error } = await client().from('besichtigung_zeiten').delete().eq('id', id)
  if (error) throw fehler(error)
}

/** Belegte Zeiten eines Mitarbeiters: eigene und sichtbare CRM-Termine sowie sein eigener Kalender.
 *  `unvollstaendig`, wenn eine der Quellen nicht lesbar war. */
export async function ladeMaklerBelegt(email: string, von: string, bis: string): Promise<{ belegt: BelegtBlock[]; unvollstaendig: boolean }> {
  const a = new Date(von)
  const b = new Date(bis)
  let unvollstaendig = false
  const termine: TerminZeile[] = []
  const fremd: FremdZeile[] = []
  const [eigene, sichtbar, eigenerKalender] = await Promise.allSettled([
    ladeTermine(a, b),
    ladeBelegt(a, b),
    client().rpc('kalender_fremd_belegt', { von, bis }),
  ])
  if (eigene.status === 'fulfilled') for (const t of eigene.value) termine.push({ id: t.id, beginn: t.beginn, ende: t.ende, ganztags: t.ganztags, besitzer_email: t.besitzerEmail, teilnehmer: t.teilnehmer })
  else unvollstaendig = true
  if (sichtbar.status === 'fulfilled') for (const t of sichtbar.value) termine.push({ beginn: t.beginn, ende: t.ende, ganztags: t.ganztags, besitzer_email: t.person })
  else unvollstaendig = true
  if (eigenerKalender.status === 'fulfilled' && !eigenerKalender.value.error) {
    for (const x of (eigenerKalender.value.data ?? []) as { person: string; beginn: string; ende: string; ganztags: boolean; sperrt: boolean }[]) {
      fremd.push({ email: x.person, belegt: [{ b: x.beginn, e: x.ende, g: x.ganztags, a: x.sperrt }] })
    }
  } else unvollstaendig = true
  return { belegt: belegtVon(email, termine, fremd), unvollstaendig }
}
