// Partner und Vermittler (22.11.2026): Datenzugriff für die Seite /partner und die Auswahl
// „Vermittelt durch“ in Akte und Objekt. Tabellen partner (Adressbuch, für alle aktiven Mitarbeiter)
// und partner_bezug (wer welche Akte/welches Objekt gebracht hat, mit Provision; sichtbar nur, wenn die
// Akte bzw. das Objekt selbst sichtbar ist — Regel in der Datenbank). Gemeinsamer Kern mit dem
// Assistenten: supabase/functions/_shared/partnerKern.ts.
import { supabase } from './supabaseClient'
import type { BezugRolle, Kandidat, PartnerArt, ProvisionStatus } from '../../supabase/functions/_shared/partnerKern.ts'

export type Partner = {
  id: string
  name: string
  firma: string
  art: PartnerArt
  email: string
  telefon: string
  adresse: string
  notiz: string
  provisionVereinbarung: string
  provisionSatz: number | null
  akteId: string | null
  aktiv: boolean
  erstelltVon: string
  erstelltAm: string
}

export type PartnerBezug = {
  id: string
  partnerId: string
  kundeId: string | null
  objektId: string | null
  rolle: BezugRolle
  provisionVereinbart: string
  provisionStatus: ProvisionStatus
  betrag: number | null
  notiz: string
  erstelltVon: string
  erstelltAm: string
}

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

function fehler(e: { message?: string; code?: string } | null, was: string): Error {
  const m = e?.message ?? ''
  if (e?.code === '23505' || /duplicate key/i.test(m)) return new Error('Diese Zuordnung gibt es schon.')
  if (/row-level security|permission denied/i.test(m)) return new Error('Dafür hast du keine Berechtigung.')
  if (/partner_name_oder_firma/.test(m)) return new Error('Bitte einen Namen oder eine Firma angeben.')
  return new Error(m ? `${was}: ${m}` : was)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function partnerAus(z: any): Partner {
  return {
    id: z.id,
    name: z.name ?? '',
    firma: z.firma ?? '',
    art: z.art,
    email: z.email ?? '',
    telefon: z.telefon ?? '',
    adresse: z.adresse ?? '',
    notiz: z.notiz ?? '',
    provisionVereinbarung: z.provision_vereinbarung ?? '',
    provisionSatz: z.provision_satz === null || z.provision_satz === undefined ? null : Number(z.provision_satz),
    akteId: z.akte_id ?? null,
    aktiv: z.aktiv !== false,
    erstelltVon: z.erstellt_von ?? '',
    erstelltAm: z.erstellt_am ?? '',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bezugAus(z: any): PartnerBezug {
  return {
    id: z.id,
    partnerId: z.partner_id,
    kundeId: z.kunde_id ?? null,
    objektId: z.objekt_id ?? null,
    rolle: z.rolle,
    provisionVereinbart: z.provision_vereinbart ?? '',
    provisionStatus: z.provision_status,
    betrag: z.betrag === null || z.betrag === undefined ? null : Number(z.betrag),
    notiz: z.notiz ?? '',
    erstelltVon: z.erstellt_von ?? '',
    erstelltAm: z.erstellt_am ?? '',
  }
}

/** Spaltennamen der Datenbank zu den Feldern hier. */
const PARTNER_SPALTE: Record<keyof Omit<Partner, 'id' | 'erstelltVon' | 'erstelltAm'>, string> = {
  name: 'name',
  firma: 'firma',
  art: 'art',
  email: 'email',
  telefon: 'telefon',
  adresse: 'adresse',
  notiz: 'notiz',
  provisionVereinbarung: 'provision_vereinbarung',
  provisionSatz: 'provision_satz',
  akteId: 'akte_id',
  aktiv: 'aktiv',
}
const BEZUG_SPALTE: Record<'rolle' | 'provisionVereinbart' | 'provisionStatus' | 'betrag' | 'notiz', string> = {
  rolle: 'rolle',
  provisionVereinbart: 'provision_vereinbart',
  provisionStatus: 'provision_status',
  betrag: 'betrag',
  notiz: 'notiz',
}

function leerZuNull(v: unknown): unknown {
  return typeof v === 'string' ? v.trim() || null : v
}

export async function ladePartner(): Promise<Partner[]> {
  const { data, error } = await client().from('partner').select('*').order('name', { ascending: true }).limit(5000)
  if (error) throw fehler(error, 'Partner ließen sich nicht laden')
  return (data ?? []).map(partnerAus)
}

/** Zuordnungen — alle sichtbaren oder nur die einer Akte, eines Objekts bzw. eines Partners. */
export async function ladeBezuege(f: { kundeId?: string; objektId?: string; partnerId?: string } = {}): Promise<PartnerBezug[]> {
  let q = client().from('partner_bezug').select('*')
  if (f.kundeId) q = q.eq('kunde_id', f.kundeId)
  if (f.objektId) q = q.eq('objekt_id', f.objektId)
  if (f.partnerId) q = q.eq('partner_id', f.partnerId)
  const { data, error } = await q.order('erstellt_am', { ascending: false }).limit(10000)
  if (error) throw fehler(error, 'Zuordnungen ließen sich nicht laden')
  return (data ?? []).map(bezugAus)
}

export type NeuerPartner = Partial<Omit<Partner, 'id' | 'erstelltVon' | 'erstelltAm'>> & { name?: string; firma?: string }

export async function legePartnerAn(p: NeuerPartner, von: string, quelle: 'hand' | 'import' = 'hand'): Promise<Partner> {
  const zeile: Record<string, unknown> = { quelle, erstellt_von: von, geaendert_von: von }
  for (const [feld, spalte] of Object.entries(PARTNER_SPALTE)) {
    const v = (p as Record<string, unknown>)[feld]
    if (v !== undefined) zeile[spalte] = feld === 'name' || feld === 'firma' ? String(v ?? '').trim() : leerZuNull(v)
  }
  const { data, error } = await client().from('partner').insert(zeile).select('*').single()
  if (error) throw fehler(error, 'Partner ließ sich nicht anlegen')
  return partnerAus(data)
}

/** Schreibt nur die geänderten Felder. */
export async function aenderePartner(alt: Partner, neu: Partner, von: string): Promise<Partner> {
  const patch: Record<string, unknown> = {}
  for (const [feld, spalte] of Object.entries(PARTNER_SPALTE)) {
    const a = (alt as Record<string, unknown>)[feld]
    const n = (neu as Record<string, unknown>)[feld]
    if (a !== n) patch[spalte] = feld === 'name' || feld === 'firma' ? String(n ?? '').trim() : leerZuNull(n)
  }
  if (!Object.keys(patch).length) return alt
  patch.geaendert_von = von
  const { data, error } = await client().from('partner').update(patch).eq('id', alt.id).select('*').single()
  if (error) throw fehler(error, 'Partner ließ sich nicht speichern')
  return partnerAus(data)
}

export async function loeschePartner(id: string): Promise<void> {
  const { error, count } = await client().from('partner').delete({ count: 'exact' }).eq('id', id)
  if (error) throw fehler(error, 'Partner ließ sich nicht löschen')
  if (count === 0) throw new Error('Löschen darf nur die Geschäftsführung. Setz den Partner stattdessen auf „nicht mehr aktiv“.')
}

export type NeuerBezug = {
  partnerId: string
  kundeId?: string | null
  objektId?: string | null
  rolle: BezugRolle
  provisionVereinbart?: string
  provisionStatus?: ProvisionStatus
  betrag?: number | null
  notiz?: string
}

export async function ordneZu(b: NeuerBezug, von: string, quelle: 'hand' | 'import' = 'hand'): Promise<PartnerBezug> {
  const status: ProvisionStatus = b.provisionStatus ?? (b.provisionVereinbart?.trim() || (b.betrag ?? 0) > 0 ? 'offen' : 'keine')
  const zeile = {
    partner_id: b.partnerId,
    kunde_id: b.kundeId || null,
    objekt_id: b.objektId || null,
    rolle: b.rolle,
    provision_vereinbart: b.provisionVereinbart?.trim() || null,
    provision_status: status,
    betrag: b.betrag ?? null,
    notiz: b.notiz?.trim() || null,
    quelle,
    erstellt_von: von,
    geaendert_von: von,
  }
  const { data, error } = await client().from('partner_bezug').insert(zeile).select('*').single()
  if (error) throw fehler(error, 'Zuordnung ließ sich nicht speichern')
  return bezugAus(data)
}

/** Schreibt nur die geänderten Felder einer Zuordnung. */
export async function aendereBezug(alt: PartnerBezug, neu: PartnerBezug, von: string): Promise<PartnerBezug> {
  const patch: Record<string, unknown> = {}
  for (const [feld, spalte] of Object.entries(BEZUG_SPALTE)) {
    const a = (alt as Record<string, unknown>)[feld]
    const n = (neu as Record<string, unknown>)[feld]
    if (a !== n) patch[spalte] = leerZuNull(n)
  }
  if (!Object.keys(patch).length) return alt
  patch.geaendert_von = von
  const { data, error } = await client().from('partner_bezug').update(patch).eq('id', alt.id).select('*').single()
  if (error) throw fehler(error, 'Zuordnung ließ sich nicht speichern')
  return bezugAus(data)
}

export async function loescheBezug(id: string): Promise<void> {
  const { error } = await client().from('partner_bezug').delete().eq('id', id)
  if (error) throw fehler(error, 'Zuordnung ließ sich nicht entfernen')
}

/** Übernimmt die angehakten Vorschläge: Partner anlegen (oder vorhandenen nehmen) und fehlende Zuordnungen. */
export async function uebernehmeKandidaten(liste: Kandidat[], von: string): Promise<{ partner: number; bezuege: number; fehler: string[] }> {
  let partner = 0
  let bezuege = 0
  const fehlerListe: string[] = []
  for (const k of liste) {
    try {
      let id = k.vorhanden?.id
      if (!id) {
        const p = await legePartnerAn(
          { name: k.name, firma: k.firma, art: k.art, email: k.email, telefon: k.telefon, akteId: k.akte_id ?? null, notiz: `Aus dem CRM übernommen: ${k.gruende.join('; ')}`.slice(0, 2000) },
          von,
          'import',
        )
        id = p.id
        partner++
      }
      for (const b of k.bezuege) {
        try {
          await ordneZu({ partnerId: id, kundeId: b.kunde_id, objektId: b.objekt_id, rolle: b.rolle }, von, 'import')
          bezuege++
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e)
          if (!/gibt es schon/.test(m)) fehlerListe.push(`${b.titel}: ${m}`)
        }
      }
    } catch (e) {
      fehlerListe.push(`${k.name || k.firma}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { partner, bezuege, fehler: fehlerListe }
}
