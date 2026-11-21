// Automatische Nachrichten der Immobilien-Abteilung (21.11.2026) — Browser-Seite.
// Vorgemerkt werden Nachrichten von der Datenbank (Auslöser an_besichtigungen / an_freigaben), verschickt
// vom Server (email-gateway/autoNachrichten.ts). Hier: Regeln anzeigen und schalten (nur Geschäftsführung
// und Superuser, Regel in der Datenbank), Warteschlange anzeigen, abbrechen, sofort senden.
import { supabase } from './supabaseClient'
import { callAuthenticated } from './emailGateway'

export type AutoNachrichtStatus = 'geplant' | 'ohne_adresse' | 'gesendet' | 'abgebrochen' | 'fehler'

export type AutoRegel = {
  id: string
  titel: string
  beschreibung: string
  vorlageId: string
  aktiv: boolean
  /** null = fester Zeitpunkt (Erinnerung am Vortag um 9 Uhr). */
  wartezeitMinuten: number | null
  anWen: 'interessent' | 'eigentuemer'
  geaendertVon?: string
  geaendertAm?: string
}

export type AutoNachricht = {
  id: string
  regel: string
  objektId?: string
  kundeId?: string
  besichtigungId?: string
  freigabeId?: string
  an?: string
  anName?: string
  betreff?: string
  text?: string
  status: AutoNachrichtStatus
  sendenAb: string
  gesendetAm?: string
  grund?: string
  abgebrochenVon?: string
  erstelltAm: string
}

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function regelAusZeile(z: any): AutoRegel {
  return {
    id: z.id,
    titel: z.titel,
    beschreibung: z.beschreibung ?? '',
    vorlageId: z.vorlage_id,
    aktiv: !!z.aktiv,
    wartezeitMinuten: z.wartezeit_minuten ?? null,
    anWen: z.an_wen ?? 'interessent',
    geaendertVon: z.geaendert_von ?? undefined,
    geaendertAm: z.geaendert_am ?? undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ausZeile(z: any): AutoNachricht {
  return {
    id: z.id,
    regel: z.regel,
    objektId: z.objekt_id ?? undefined,
    kundeId: z.kunde_id ?? undefined,
    besichtigungId: z.besichtigung_id ?? undefined,
    freigabeId: z.freigabe_id ?? undefined,
    an: z.an ?? undefined,
    anName: z.an_name ?? undefined,
    betreff: z.betreff ?? undefined,
    text: z.text ?? undefined,
    status: z.status,
    sendenAb: z.senden_ab,
    gesendetAm: z.gesendet_am ?? undefined,
    grund: z.grund ?? undefined,
    abgebrochenVon: z.abgebrochen_von ?? undefined,
    erstelltAm: z.erstellt_am,
  }
}

export async function ladeAutoRegeln(): Promise<AutoRegel[]> {
  const { data, error } = await client().from('auto_nachricht_regeln').select('*').eq('bereich', 'immobilien').order('reihenfolge')
  if (error) throw new Error(error.message)
  return (data ?? []).map(regelAusZeile)
}

/** Nur Geschäftsführung und Superuser dürfen das (Regel in der Datenbank). */
export async function setzeAutoRegel(id: string, e: { aktiv?: boolean; wartezeitMinuten?: number }, von: string): Promise<void> {
  const felder: Record<string, unknown> = { geaendert_von: von, geaendert_am: new Date().toISOString() }
  if (e.aktiv !== undefined) felder.aktiv = e.aktiv
  if (e.wartezeitMinuten !== undefined) felder.wartezeit_minuten = e.wartezeitMinuten
  const { data, error } = await client().from('auto_nachricht_regeln').update(felder).eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Diese Einstellung darf nur die Geschäftsführung ändern.')
}

/** Warteschlange: geplante zuerst (nach Zeitpunkt), dann die letzten gesendeten, abgebrochenen und fehlerhaften. */
export async function ladeAutoNachrichten(filter: { objektId?: string; grenze?: number } = {}): Promise<AutoNachricht[]> {
  let q = client().from('auto_nachrichten').select('*').order('senden_ab', { ascending: false }).limit(filter.grenze ?? 300)
  if (filter.objektId) q = q.eq('objekt_id', filter.objektId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map(ausZeile)
}

export async function brichAutoNachrichtAb(id: string, von: string): Promise<void> {
  const { data, error } = await client()
    .from('auto_nachrichten')
    .update({ status: 'abgebrochen', abgebrochen_von: von, grund: `Nicht gesendet auf Wunsch von ${von}` })
    .eq('id', id)
    .in('status', ['geplant', 'ohne_adresse'])
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Diese Nachricht ist schon unterwegs oder erledigt.')
}

/** Schickt eine vorgemerkte Nachricht sofort (Server prüft das Recht auf Immobilien und den Anlass). */
export async function sendeAutoNachrichtJetzt(id: string): Promise<{ gesendet: number; meldungen: string[] }> {
  const r = await callAuthenticated({ action: 'auto_nachricht_jetzt', id })
  return { gesendet: Number(r?.gesendet ?? 0), meldungen: Array.isArray(r?.meldungen) ? r.meldungen : [] }
}

const uhr = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })

export function wartezeitText(r: Pick<AutoRegel, 'id' | 'wartezeitMinuten'>): string {
  if (r.wartezeitMinuten === null) return 'am Vortag um 9 Uhr'
  const m = r.wartezeitMinuten
  if (m === 0) return 'sofort'
  if (m < 60) return `nach ${m} Minuten`
  if (m === 1440) return 'nach 1 Tag'
  return `nach ${m / 60} Std.`
}

export const WARTEZEIT_WAHL = [0, 5, 10, 15, 30, 60, 120, 240, 1440]

/** Kurzer Text für Listen. */
export function autoStatusText(n: AutoNachricht): string {
  switch (n.status) {
    case 'geplant': return `geht am ${uhr(n.sendenAb)} raus`
    case 'gesendet': return `gesendet am ${uhr(n.gesendetAm ?? n.sendenAb)}`
    case 'ohne_adresse': return 'wartet auf eine E-Mail-Adresse'
    case 'abgebrochen': return n.grund ? `nicht gesendet (${n.grund})` : 'nicht gesendet'
    case 'fehler': return `Fehler: ${n.grund ?? 'unbekannt'}`
  }
}

export const AUTO_STATUS_FARBE: Record<AutoNachrichtStatus, string> = {
  geplant: 'bg-sky-100 text-sky-700',
  gesendet: 'bg-emerald-100 text-emerald-700',
  ohne_adresse: 'bg-amber-100 text-amber-700',
  abgebrochen: 'bg-slate-100 text-slate-600',
  fehler: 'bg-rose-100 text-rose-700',
}

export const AUTO_STATUS_LABEL: Record<AutoNachrichtStatus, string> = {
  geplant: 'Geplant',
  gesendet: 'Gesendet',
  ohne_adresse: 'Ohne Adresse',
  abgebrochen: 'Nicht gesendet',
  fehler: 'Fehler',
}

/** Die Platzhalter, die in den Vorlagen der automatischen Nachrichten funktionieren. */
export const AUTO_PLATZHALTER: { name: string; bedeutung: string }[] = [
  { name: 'Name', bedeutung: 'Name des Interessenten' },
  { name: 'Objekt', bedeutung: 'Bezeichnung des Objekts' },
  { name: 'Adresse', bedeutung: 'Adresse des Objekts (Treffpunkt)' },
  { name: 'Termin', bedeutung: 'Datum und Uhrzeit der Besichtigung' },
  { name: 'Datum', bedeutung: 'z. B. „Mittwoch, 25.11.2026“' },
  { name: 'Uhrzeit', bedeutung: 'z. B. „14:00 Uhr“' },
  { name: 'Makler', bedeutung: 'wer die Besichtigung macht, sonst der Verantwortliche des Objekts' },
  { name: 'Makler-Telefon', bedeutung: 'Telefon dieses Mitarbeiters (aus „Mein Profil“)' },
  { name: 'Makler-E-Mail', bedeutung: 'E-Mail dieses Mitarbeiters' },
  { name: 'Portal-Link', bedeutung: 'persönlicher Link zum Interessenten-Portal, falls einer besteht' },
  { name: 'Angebot', bedeutung: 'Kaufpreisangebot, z. B. „349.500 €“' },
  { name: 'Provision', bedeutung: 'vereinbarte Provision' },
  { name: 'Provisionsvereinbarung', bedeutung: 'genauer Wortlaut, dem der Interessent zugestimmt hat' },
  { name: 'Widerrufsbelehrung', bedeutung: 'genauer Wortlaut der Widerrufsbelehrung' },
  { name: 'Zugestimmt-am', bedeutung: 'Zeitpunkt der Zustimmung im Portal' },
]
