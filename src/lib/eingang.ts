// Ungeklärte Eingänge einsortieren: Was der Assistent keiner Akte zuordnen konnte, liegt in der
// Sammelakte „Ungeklärte Eingänge". Der Server trägt die gewählten Dateien beim Kunden oder beim Objekt
// ein und aus der Sammelakte aus, hält jede Ablage fest und kann sie rückgängig machen — siehe
// supabase/functions/email-gateway/eingang.ts.
import { supabase } from './supabaseClient'
import { AKTE_UNGEKLAERT } from '../data/sammelakten'
import type { ActivityEntry, Dokument, DokumentOrdnerName, KundeBereich } from '../types'

const FUNCTION_URL = import.meta.env.VITE_EMAIL_GATEWAY_URL as string | undefined
const SHARED_SECRET = import.meta.env.VITE_EMAIL_GATEWAY_SECRET as string | undefined

export type AblageZiel = { art: 'kunde'; id: string } | { art: 'objekt'; id: string; ordner: DokumentOrdnerName }

type ZielStand =
  | { art: 'kunde'; id: string; bereich: KundeBereich; name: string; dokumente: Dokument[]; activities: ActivityEntry[]; letzteAktivitaet: string }
  | { art: 'objekt'; id: string; name: string; ordner: DokumentOrdnerName; dokumente: Partial<Record<DokumentOrdnerName, Dokument[]>>; activities: ActivityEntry[] }

export type AblageErgebnis = {
  /** Namen der Dateien, die jetzt im Ziel liegen. */
  abgelegt: string[]
  /** Namen der Dateien, die im Ziel schon lagen — sie sind nur aus der Liste ausgetragen. */
  uebersprungen: string[]
  /** Ganze Sätze zu Dateien, die sich nicht ablegen ließen — sie liegen weiter in der Liste. */
  nichtAbgelegt: string[]
  /** Kennung zum Rückgängigmachen; `null`, wenn sie sich nicht speichern ließ (Grund in `hinweise`). */
  ablageId: string | null
  hinweise: string[]
  /** Die Sammelakte nach dem Ablegen. */
  sammelDokumente: Dokument[]
  ziel: ZielStand
}

export type RueckgaengigErgebnis = {
  /** Aus dem Ziel genommen und wieder in der Liste. */
  zurueck: string[]
  /** Lagen beim Ablegen schon im Ziel und stehen jetzt wieder in der Liste. */
  wiederInListe: string[]
  /** Inzwischen nicht mehr im Ziel — bleiben, wie sie sind. */
  nichtMehrDort: string[]
  sammelDokumente: Dokument[]
  /** Frischer Stand des Ziels; `null`, wenn es das Ziel nicht mehr gibt. */
  ziel: ZielStand | null
}

/** Eine festgehaltene Ablage (Tabelle abteilung_eintraege, art „ablage") — schreibt nur der Server. */
export type AblageProtokoll = {
  id: string
  art: 'ablage'
  am: string
  von: string
  ziel: { art: 'kunde'; id: string; name: string; bereich: KundeBereich } | { art: 'objekt'; id: string; name: string; ordner: DokumentOrdnerName }
  dateien: { original: Dokument; zielId: string; zielUrl?: string; zielName: string }[]
  uebersprungen: Dokument[]
  rueckgaengigAm?: string
  rueckgaengigVon?: string
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
    ablageId: typeof data.ablageId === 'string' ? data.ablageId : null,
    hinweise: alsTexte(data.hinweise),
    sammelDokumente: data.sammelDokumente,
    ziel: data.ziel,
  }
}

/** Nimmt eine Ablage zurück: Was noch unverändert im Ziel liegt, kommt wieder unter die ungeklärten Eingänge. */
export async function macheAblageRueckgaengig(ablageId: string): Promise<RueckgaengigErgebnis> {
  const data = await rufe({ action: 'eingang_rueckgaengig', ablageId }, 'Das Rückgängigmachen ist fehlgeschlagen')
  if (!Array.isArray(data?.sammelDokumente)) throw new Error('Das Rückgängigmachen ist fehlgeschlagen: Der Server hat keine Bestätigung geschickt.')
  return {
    zurueck: alsTexte(data.zurueck),
    wiederInListe: alsTexte(data.wiederInListe),
    nichtMehrDort: alsTexte(data.nichtMehrDort),
    sammelDokumente: data.sammelDokumente,
    ziel: data.ziel ?? null,
  }
}

/** Ablagen der letzten `tage` Tage, die noch nicht rückgängig gemacht sind, neueste zuerst. */
export async function ladeLetzteAblagen(tage = 14): Promise<AblageProtokoll[]> {
  if (!supabase) return []
  const seit = new Date(Date.now() - tage * 24 * 60 * 60 * 1000).toISOString()
  const ergebnis: AblageProtokoll[] = []
  // In Portionen lesen — eine Abfrage liefert höchstens 1000 Zeilen.
  for (let von = 0; ; von += 500) {
    const { data, error } = await supabase
      .from('abteilung_eintraege')
      .select('id, daten')
      .eq('art', 'ablage')
      .gte('updated_at', seit)
      .order('updated_at', { ascending: false })
      .range(von, von + 499)
    if (error) throw new Error(`Die zuletzt abgelegten Dateien ließen sich nicht laden: ${error.message}`)
    const zeilen = (data ?? []) as { id: string; daten: AblageProtokoll | null }[]
    for (const z of zeilen) {
      const p = z.daten
      if (p && !p.rueckgaengigAm && typeof p.am === 'string' && p.am >= seit && p.ziel && Array.isArray(p.dateien)) ergebnis.push({ ...p, id: z.id })
    }
    if (zeilen.length < 500) break
  }
  return ergebnis.sort((a, b) => b.am.localeCompare(a.am))
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
