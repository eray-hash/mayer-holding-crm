// Online-Unterschrift (22.11.2026): Anfragen zum Unterschreiben (Tabelle unterschrift_anfragen), der Schalter für
// die Kopie an den Kunden (unterschrift_einstellung) und die Aufrufe der öffentlichen Seite
// /formular/unterschrift/:token (email-gateway, unterschrift.ts). Kern: supabase/functions/_shared/unterschriftKern.ts.
import { supabase } from './supabaseClient'
import { call } from './emailGateway'
import { shareableUrl } from '../components/FormularLink'
import { kundenFelderAus, type KundenFeld, type UnterschriftStatus } from '../../supabase/functions/_shared/unterschriftKern.ts'
import type { KundeBereich } from '../types'

export type UnterschriftAnfrage = {
  id: string
  token: string
  kundeId: string
  bereich: string
  vorlageId?: string
  titel: string
  email?: string
  anName?: string
  status: UnterschriftStatus
  gueltigBis: string
  zugriffe: number
  letzterZugriff?: string
  unterschriebenAm?: string
  nameGetippt?: string
  dokument?: string
  dokumentId?: string
  abgelehntAm?: string
  ablehnungGrund?: string
  felderKunde: KundenFeld[]
  erstelltVon?: string
  erstelltAm: string
  zurueckgezogenAm?: string
  zurueckgezogenVon?: string
}

export type UnterschriftNachweis = {
  unterschrift?: string
  nameGetippt?: string
  unterschriebenAm?: string
  ip?: string
  geraet?: string
  pruefsumme?: string
  kundenWerte?: Record<string, string>
  endgueltigerText?: string
}

const SPALTEN =
  'id, token, kunde_id, bereich, vorlage_id, titel, email, an_name, status, gueltig_bis, zugriffe, letzter_zugriff, unterschrieben_am, name_getippt, dokument, dokument_id, abgelehnt_am, ablehnung_grund, felder_kunde, erstellt_von, erstellt_am, zurueckgezogen_am, zurueckgezogen_von'

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

function fehler(e: { message?: string } | null): Error {
  const m = e?.message ?? ''
  if (/row-level security|permission denied/i.test(m)) return new Error('Für diese Akte hast du keine Berechtigung.')
  if (/relation .* does not exist|schema cache/i.test(m)) return new Error('Die Online-Unterschrift ist noch nicht eingerichtet (Datenbank-Änderung fehlt).')
  return new Error(m ? `Das hat nicht geklappt: ${m}` : 'Das hat nicht geklappt.')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ausZeile(z: any): UnterschriftAnfrage {
  return {
    id: z.id,
    token: z.token,
    kundeId: z.kunde_id,
    bereich: z.bereich,
    vorlageId: z.vorlage_id ?? undefined,
    titel: z.titel,
    email: z.email ?? undefined,
    anName: z.an_name ?? undefined,
    status: z.status,
    gueltigBis: z.gueltig_bis,
    zugriffe: z.zugriffe ?? 0,
    letzterZugriff: z.letzter_zugriff ?? undefined,
    unterschriebenAm: z.unterschrieben_am ?? undefined,
    nameGetippt: z.name_getippt ?? undefined,
    dokument: z.dokument ?? undefined,
    dokumentId: z.dokument_id ?? undefined,
    abgelehntAm: z.abgelehnt_am ?? undefined,
    ablehnungGrund: z.ablehnung_grund ?? undefined,
    felderKunde: kundenFelderAus(z.felder_kunde),
    erstelltVon: z.erstellt_von ?? undefined,
    erstelltAm: z.erstellt_am,
    zurueckgezogenAm: z.zurueckgezogen_am ?? undefined,
    zurueckgezogenVon: z.zurueckgezogen_von ?? undefined,
  }
}

export const unterschriftLink = (token: string) => shareableUrl(`/formular/unterschrift/${token}`)

/** Status, wie ihn der Kunde gerade erlebt: offen mit abgelaufener Frist gilt als abgelaufen. */
export function wirklicherStatus(a: Pick<UnterschriftAnfrage, 'status' | 'gueltigBis'>): UnterschriftStatus {
  return a.status === 'offen' && new Date(a.gueltigBis).getTime() < Date.now() ? 'abgelaufen' : a.status
}

export async function legeUnterschriftAnfrageAn(e: {
  token: string
  kundeId: string
  bereich: KundeBereich
  vorlageId?: string
  titel: string
  kopfstil: string
  text: string
  felder: KundenFeld[]
  email?: string
  anName?: string
  von: string
}): Promise<UnterschriftAnfrage> {
  const { data, error } = await client()
    .from('unterschrift_anfragen')
    .insert({
      token: e.token,
      kunde_id: e.kundeId,
      bereich: e.bereich,
      vorlage_id: e.vorlageId ?? null,
      titel: e.titel.trim().slice(0, 200),
      kopfstil: e.kopfstil,
      ausgefuellter_text: e.text,
      felder_kunde: e.felder,
      email: e.email?.trim() || null,
      an_name: e.anName?.trim() || null,
      erstellt_von: e.von,
    })
    .select(SPALTEN)
    .single()
  if (error) throw fehler(error)
  return ausZeile(data)
}

export async function ladeUnterschriftAnfragen(kundeId: string): Promise<UnterschriftAnfrage[]> {
  const { data, error } = await client().from('unterschrift_anfragen').select(SPALTEN).eq('kunde_id', kundeId).order('erstellt_am', { ascending: false })
  if (error) throw fehler(error)
  return (data ?? []).map(ausZeile)
}

export async function zieheUnterschriftZurueck(id: string, von: string): Promise<void> {
  const { data, error } = await client()
    .from('unterschrift_anfragen')
    .update({ status: 'zurueckgezogen', zurueckgezogen_am: new Date().toISOString(), zurueckgezogen_von: von })
    .eq('id', id)
    .eq('status', 'offen')
    .select('id')
  if (error) throw fehler(error)
  if (!data || data.length === 0) throw new Error('Die Anfrage ist nicht mehr offen (vielleicht wurde sie gerade unterschrieben). Bitte neu laden.')
}

export async function ladeUnterschriftNachweis(id: string): Promise<UnterschriftNachweis> {
  const { data, error } = await client()
    .from('unterschrift_anfragen')
    .select('unterschrift, name_getippt, unterschrieben_am, ip, geraet, pruefsumme, kunden_werte, endgueltiger_text')
    .eq('id', id)
    .maybeSingle()
  if (error) throw fehler(error)
  return {
    unterschrift: data?.unterschrift ?? undefined,
    nameGetippt: data?.name_getippt ?? undefined,
    unterschriebenAm: data?.unterschrieben_am ?? undefined,
    ip: data?.ip ?? undefined,
    geraet: data?.geraet ?? undefined,
    pruefsumme: data?.pruefsumme ?? undefined,
    kundenWerte: (data?.kunden_werte ?? undefined) as Record<string, string> | undefined,
    endgueltigerText: data?.endgueltiger_text ?? undefined,
  }
}

// ---------- Schalter: Kopie an den Kunden ----------

export async function ladeKopieSchalter(): Promise<{ aktiv: boolean; geaendertVon?: string }> {
  const { data, error } = await client().from('unterschrift_einstellung').select('kopie_an_kunde, geaendert_von').eq('id', 1).maybeSingle()
  if (error) throw fehler(error)
  return { aktiv: !!data?.kopie_an_kunde, geaendertVon: data?.geaendert_von ?? undefined }
}

/** Nur Geschäftsführung und Superuser dürfen das (Regel in der Datenbank). */
export async function setzeKopieSchalter(aktiv: boolean, von: string): Promise<void> {
  const { data, error } = await client()
    .from('unterschrift_einstellung')
    .update({ kopie_an_kunde: aktiv, geaendert_von: von, geaendert_am: new Date().toISOString() })
    .eq('id', 1)
    .select('id')
  if (error) throw fehler(error)
  if (!data || data.length === 0) throw new Error('Diesen Schalter darf nur die Geschäftsführung ändern.')
}

// ---------- öffentliche Seite ----------

export type UnterschriftSeite =
  | { stufe: 'ungueltig'; grund: string }
  | { stufe: 'offen'; titel: string; text: string; kopfstil: string; felder: KundenFeld[]; anrede: string; gueltigBis: string }
  | { stufe: 'unterschrieben'; titel: string; am: string; name: string; kopieUrl?: string }
  | { stufe: 'abgelehnt'; titel: string }

export async function holeUnterschriftSeite(token: string): Promise<UnterschriftSeite> {
  return (await call({ action: 'public_unterschrift_laden', token })) as UnterschriftSeite
}

export async function sendeUnterschrift(token: string, e: { gelesen: boolean; name: string; unterschrift: string; werte: Record<string, string> }): Promise<UnterschriftSeite> {
  return (await call({ action: 'public_unterschrift_absenden', token, ...e })) as UnterschriftSeite
}

export async function lehneUnterschriftAb(token: string, grund: string): Promise<UnterschriftSeite> {
  return (await call({ action: 'public_unterschrift_absenden', token, ablehnen: true, grund })) as UnterschriftSeite
}
