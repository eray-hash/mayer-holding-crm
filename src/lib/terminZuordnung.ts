// Zuordnung Termin → Akte im Kalender (22.11.2026). Der Server prüft jeden Termin einmal (email-gateway
// terminZuordnung.ts): sichere Treffer (E-Mail-Adresse eines Gastes) verknüpft er selbst, Namen im Titel legt er als
// Vorschlag in termine.zuordnung_vorschlag ab. Hier: Vorschläge lesen und von Hand zuordnen, lösen oder ablehnen —
// geschrieben wird nur über den Server (Aktion termin_zuordnen; Regeln in supabase/functions/_shared/terminZuordnungKern.ts).
import { supabase } from './supabaseClient'
import { callAuthenticated } from './emailGateway'

export type ZuordnungVorschlag = {
  stand?: 'vorschlag' | 'automatisch' | 'hand' | 'keiner'
  kunde_id?: string
  bereich?: string
  name?: string
  wie?: string
  am?: string
  abgelehnt?: string[]
}

/** Vorschläge und Herkunft der Zuordnung je Termin im Zeitraum. Leer, wenn die Spalte (noch) fehlt. */
export async function ladeZuordnungen(von: Date, bis: Date): Promise<Map<string, ZuordnungVorschlag>> {
  const karte = new Map<string, ZuordnungVorschlag>()
  if (!supabase) return karte
  const { data, error } = await supabase
    .from('termine')
    .select('id, zuordnung_vorschlag')
    .lt('beginn', bis.toISOString())
    .gt('ende', von.toISOString())
    .not('zuordnung_vorschlag', 'is', null)
    .limit(1000)
  if (error) return karte
  for (const z of (data ?? []) as { id: string; zuordnung_vorschlag: ZuordnungVorschlag | null }[]) {
    if (z.zuordnung_vorschlag && typeof z.zuordnung_vorschlag === 'object') karte.set(z.id, z.zuordnung_vorschlag)
  }
  return karte
}

export type ZuordnungAntwort = { termin: { id: string; kunde_id: string | null; kunde_bereich: string | null; kunde_name: string | null; zuordnung_vorschlag: ZuordnungVorschlag | null }; text: string; weitere: number }

/** Termin einer Akte zuordnen; mit gleicheTitel auch die eigenen anderen Termine mit genau diesem Titel. */
export async function ordneTerminZu(terminId: string, kundeId: string, gleicheTitel = false): Promise<ZuordnungAntwort> {
  return await callAuthenticated({ action: 'termin_zuordnen', terminId, kundeId, gleicheTitel })
}

/** Verknüpfung lösen — die Akte schlägt die automatische Zuordnung für diesen Termin danach nicht wieder vor. */
export async function loeseTerminZuordnung(terminId: string): Promise<ZuordnungAntwort> {
  return await callAuthenticated({ action: 'termin_zuordnen', terminId, kundeId: null })
}

/** Vorschlag ablehnen (kommt für diesen Termin nicht wieder). */
export async function lehneZuordnungsVorschlagAb(terminId: string): Promise<ZuordnungAntwort> {
  return await callAuthenticated({ action: 'termin_zuordnen', terminId, kundeId: null, vorschlagAblehnen: true })
}
