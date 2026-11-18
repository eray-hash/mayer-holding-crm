// Ungeklärte Eingänge einsortieren: Was der Assistent keiner Akte zuordnen konnte, liegt in der
// Sammelakte „Ungeklärte Eingänge". Der Server trägt die gewählten Dateien beim Kunden oder beim Objekt
// ein und aus der Sammelakte aus — siehe supabase/functions/email-gateway/eingang.ts.
import { supabase } from './supabaseClient'
import { AKTE_UNGEKLAERT } from '../data/sammelakten'
import type { ActivityEntry, Dokument, DokumentOrdnerName, KundeBereich } from '../types'

const FUNCTION_URL = import.meta.env.VITE_EMAIL_GATEWAY_URL as string | undefined
const SHARED_SECRET = import.meta.env.VITE_EMAIL_GATEWAY_SECRET as string | undefined

export type AblageZiel = { art: 'kunde'; id: string } | { art: 'objekt'; id: string; ordner: DokumentOrdnerName }

export type AblageErgebnis = {
  /** Namen der Dateien, die jetzt im Ziel liegen. */
  abgelegt: string[]
  /** Namen der Dateien, die im Ziel schon lagen — sie sind nur aus der Liste ausgetragen. */
  uebersprungen: string[]
  /** Ganze Sätze zu Dateien, die sich nicht ablegen ließen — sie liegen weiter in der Liste. */
  nichtAbgelegt: string[]
  /** Die Sammelakte nach dem Ablegen. */
  sammelDokumente: Dokument[]
  ziel:
    | { art: 'kunde'; id: string; bereich: KundeBereich; name: string; dokumente: Dokument[]; activities: ActivityEntry[]; letzteAktivitaet: string }
    | { art: 'objekt'; id: string; name: string; ordner: DokumentOrdnerName; dokumente: Partial<Record<DokumentOrdnerName, Dokument[]>>; activities: ActivityEntry[] }
}

export type EntnahmeErgebnis = { entfernt: string[]; sammelDokumente: Dokument[]; sammelActivities: ActivityEntry[] | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rufe(body: Record<string, unknown>, fehlschlag: string): Promise<any> {
  if (!FUNCTION_URL) throw new Error('Das Postfach ist noch nicht eingerichtet (VITE_EMAIL_GATEWAY_URL fehlt).')
  const { data: sessionData } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Du bist nicht angemeldet.')
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(SHARED_SECRET ? { 'x-crm-secret': SHARED_SECRET } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || typeof data?.error === 'string') throw new Error(data?.error ?? `${fehlschlag} (${res.status}).`)
  return data
}

const alsTexte = (wert: unknown): string[] => (Array.isArray(wert) ? wert.map(String) : [])

/** Legt Dateien aus den ungeklärten Eingängen bei einem Kunden oder in einem Ordner eines Objekts ab. */
export async function legeEingaengeAb(dokumentIds: string[], ziel: AblageZiel): Promise<AblageErgebnis> {
  const data = await rufe({ action: 'eingang_ablegen', dokumentIds, ziel }, 'Das Ablegen ist fehlgeschlagen')
  if (!data?.ziel || !Array.isArray(data?.sammelDokumente)) throw new Error('Das Ablegen ist fehlgeschlagen: Der Server hat keine Bestätigung geschickt.')
  return {
    abgelegt: alsTexte(data.abgelegt),
    uebersprungen: alsTexte(data.uebersprungen),
    nichtAbgelegt: alsTexte(data.nichtAbgelegt),
    sammelDokumente: data.sammelDokumente,
    ziel: data.ziel,
  }
}

/** Nimmt Einträge aus der Liste, ohne sie abzulegen. Die gespeicherte Datei wird dabei nicht gelöscht. */
export async function nimmEingaengeHeraus(dokumentIds: string[]): Promise<EntnahmeErgebnis> {
  const data = await rufe({ action: 'eingang_entfernen', dokumentIds }, 'Das Herausnehmen ist fehlgeschlagen')
  if (!Array.isArray(data?.sammelDokumente)) throw new Error('Das Herausnehmen ist fehlgeschlagen: Der Server hat keine Bestätigung geschickt.')
  return {
    entfernt: alsTexte(data.entfernt),
    sammelDokumente: data.sammelDokumente,
    sammelActivities: Array.isArray(data.sammelActivities) ? data.sammelActivities : null,
  }
}

/** Die Sammelakte, wie sie jetzt in der Datenbank steht — `null`, wenn es sie (noch) nicht gibt oder
 *  das Programm ohne Datenbank läuft. */
export async function ladeUngeklaerteEingaenge(): Promise<{ dokumente: Dokument[]; activities: ActivityEntry[] } | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('kunden').select('id, dokumente, activities').eq('id', AKTE_UNGEKLAERT).maybeSingle()
  if (error) throw new Error(`Die ungeklärten Eingänge ließen sich nicht laden: ${error.message}`)
  if (!data) return null
  return {
    dokumente: Array.isArray(data.dokumente) ? (data.dokumente as Dokument[]) : [],
    activities: Array.isArray(data.activities) ? (data.activities as ActivityEntry[]) : [],
  }
}
