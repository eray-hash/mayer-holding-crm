// Automatische Willkommensnachricht (Projekt-Checkliste Stufe 4, 20.11.2026) — Browser-Seite.
// Vorgemerkt werden Nachrichten von der Datenbank (Auslöser wk_kunden), verschickt vom Server
// (email-gateway/willkommen.ts). Hier: anzeigen, abbrechen, sofort senden, Schalter und Wartezeit.
import { supabase } from './supabaseClient'
import { call } from './emailGateway'
import { alleZeilen } from './alleZeilen'

export type WillkommenStatus = 'geplant' | 'ohne_adresse' | 'gesendet' | 'abgebrochen' | 'fehler'

export type WillkommenNachricht = {
  id: string
  kundeId: string
  an?: string
  status: WillkommenStatus
  sendenAb: string
  gesendetAm?: string
  grund?: string
  abgebrochenVon?: string
  ausloeser?: string
}

export type WillkommenEinstellung = { aktiv: boolean; verzoegerungMinuten: number; geaendertVon?: string; geaendertAm?: string }

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ausZeile(z: any): WillkommenNachricht {
  return {
    id: z.id,
    kundeId: z.kunde_id,
    an: z.an ?? undefined,
    status: z.status,
    sendenAb: z.senden_ab,
    gesendetAm: z.gesendet_am ?? undefined,
    grund: z.grund ?? undefined,
    abgebrochenVon: z.abgebrochen_von ?? undefined,
    ausloeser: z.ausloeser ?? undefined,
  }
}

export async function ladeWillkommen(kundeId: string): Promise<WillkommenNachricht | null> {
  const { data, error } = await client().from('willkommen_nachrichten').select('*').eq('kunde_id', kundeId).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? ausZeile(data) : null
}

export async function ladeAlleWillkommen(): Promise<Map<string, WillkommenNachricht>> {
  // Seitenweise: eine Zeile je neuer Akte — die Datenbank liefert höchstens 1000 Zeilen je Abfrage.
  const { data, error } = await alleZeilen(() => client().from('willkommen_nachrichten').select('*'))
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((z) => [z.kunde_id as string, ausZeile(z)]))
}

export async function brichWillkommenAb(id: string, von: string): Promise<void> {
  const { error } = await client().from('willkommen_nachrichten').update({ status: 'abgebrochen', abgebrochen_von: von, grund: `Abgebrochen von ${von}` }).eq('id', id).in('status', ['geplant', 'ohne_adresse'])
  if (error) throw new Error(error.message)
}

/** Schickt die vorgemerkte Nachricht dieser Akte sofort (Server prüft das Recht auf die Akte). */
export async function sendeWillkommenJetzt(kundeId: string): Promise<{ gesendet: number; meldungen: string[] }> {
  const r = await call({ action: 'willkommen_jetzt', kundeId })
  return { gesendet: Number(r?.gesendet ?? 0), meldungen: Array.isArray(r?.meldungen) ? r.meldungen : [] }
}

export async function ladeWillkommenEinstellung(): Promise<WillkommenEinstellung> {
  const { data, error } = await client().from('willkommen_einstellung').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  return { aktiv: !!data?.aktiv, verzoegerungMinuten: data?.verzoegerung_minuten ?? 60, geaendertVon: data?.geaendert_von ?? undefined, geaendertAm: data?.geaendert_am ?? undefined }
}

/** Nur Geschäftsführung und Superuser dürfen das (Regel in der Datenbank). */
export async function setzeWillkommenEinstellung(e: { aktiv?: boolean; verzoegerungMinuten?: number }, von: string): Promise<void> {
  const felder: Record<string, unknown> = { geaendert_von: von, geaendert_am: new Date().toISOString() }
  if (e.aktiv !== undefined) felder.aktiv = e.aktiv
  if (e.verzoegerungMinuten !== undefined) felder.verzoegerung_minuten = e.verzoegerungMinuten
  const { data, error } = await client().from('willkommen_einstellung').update(felder).eq('id', 1).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Diese Einstellung darf nur die Geschäftsführung ändern.')
}

const uhr = (iso: string) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Kurzer Text für Listen und die Akte. */
export function willkommenText(w: WillkommenNachricht): string {
  switch (w.status) {
    case 'geplant': return `geht am ${uhr(w.sendenAb)} raus`
    case 'gesendet': return `gesendet am ${uhr(w.gesendetAm ?? w.sendenAb)}`
    case 'ohne_adresse': return 'wartet auf eine E-Mail-Adresse'
    case 'abgebrochen': return w.abgebrochenVon ? `abgebrochen von ${w.abgebrochenVon}` : `nicht gesendet${w.grund ? ` (${w.grund})` : ''}`
    case 'fehler': return `Fehler: ${w.grund ?? 'unbekannt'}`
  }
}
