// „Neu im CRM“ im Browser (23.11.2026): ein gemeinsamer Stand für das Symbol mit Zähler in der Kopfleiste
// (components/NeuigkeitenKnopf.tsx), die Seite /neuigkeiten und die Hinweise „Neu: …“ neben Knöpfen
// (components/NeuHinweis.tsx). Einmal geladen, von allen geteilt — viele Hinweise auf einer Seite lösen keine
// eigenen Abfragen aus.
//
// Tabellen und Regeln: neuigkeiten (lesen alle aktiven Mitarbeiter), neuigkeiten_gelesen und
// neuigkeiten_einstellung (nur die eigene Zeile). Fehlen die Tabellen noch (SQL nicht eingespielt), zeigen
// alle drei Stellen einfach nichts. Gemeinsame Regeln (wer was sieht, Reihenfolge): supabase/functions/_shared/neuigkeitenKern.ts.
//
// Immer der echte angemeldete Mensch (auch bei „Ansehen als …“): Gelesen-Stand und Einstellung gehören zur Anmeldung.
// Im Modus „Ansehen als“ wird nichts gespeichert (nurLesen.ts) — weggeklickt wird dann nur bis zum Neuladen.

import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from './supabaseClient'
import { istNurLesen } from './nurLesen'
import { useAuth } from '../context/AuthContext'
import {
  HINWEIS_VORSATZ,
  istRelevant,
  NEUIGKEIT_SPALTEN,
  neuigkeitAusZeile,
  sortiereNeuigkeiten,
  type Neuigkeit,
} from '../../supabase/functions/_shared/neuigkeitenKern.ts'

export type NeuigkeitenEinstellung = { telegram_tipp: boolean; schwerpunkte: string[] }

export type NeuigkeitenStand = {
  /** Erste Ladung fertig (egal ob mit Erfolg). */
  geladen: boolean
  /** Tabellen vorhanden und lesbar. */
  verfuegbar: boolean
  email: string
  eintraege: Neuigkeit[]
  gelesen: Set<string>
  einstellung: NeuigkeitenEinstellung
}

const LEER: NeuigkeitenStand = { geladen: false, verfuegbar: false, email: '', eintraege: [], gelesen: new Set(), einstellung: { telegram_tipp: true, schwerpunkte: [] } }

let stand: NeuigkeitenStand = LEER
const hoerer = new Set<() => void>()
let laufend: Promise<void> | null = null
let geladenAm = 0
const NEU_LADEN_NACH_MS = 30 * 60_000

function setze(teil: Partial<NeuigkeitenStand>): void {
  stand = { ...stand, ...teil }
  for (const f of hoerer) f()
}

function abonniere(f: () => void): () => void {
  hoerer.add(f)
  return () => hoerer.delete(f)
}

/** Lädt Einträge, Gelesen-Stand und Einstellung. Ohne erzwingen höchstens alle 30 Minuten neu. */
export function ladeNeuigkeiten(emailRoh: string | null | undefined, erzwingen = false): Promise<void> {
  const email = String(emailRoh ?? '').trim().toLowerCase()
  if (!supabase || !email) return Promise.resolve()
  if (laufend && stand.email === email) return laufend
  if (!erzwingen && stand.email === email && stand.geladen && Date.now() - geladenAm < NEU_LADEN_NACH_MS) return Promise.resolve()
  const db = supabase
  if (stand.email !== email) setze({ ...LEER, email })
  laufend = (async () => {
    try {
      const [neu, gel, einst] = await Promise.all([
        db.from('neuigkeiten').select(NEUIGKEIT_SPALTEN).eq('aktiv', true).order('datum', { ascending: false }).limit(500),
        db.from('neuigkeiten_gelesen').select('schluessel').eq('email', email).limit(1000),
        db.from('neuigkeiten_einstellung').select('telegram_tipp, schwerpunkte').eq('email', email).maybeSingle(),
      ])
      if (neu.error || gel.error) {
        setze({ geladen: true, verfuegbar: false })
        return
      }
      const e = (einst.data ?? null) as { telegram_tipp?: boolean | null; schwerpunkte?: string[] | null } | null
      // Gerade lokal Weggeklicktes (noch unterwegs zum Server) nicht wieder einblenden.
      const gelesen = new Set<string>([...stand.gelesen, ...((gel.data ?? []) as { schluessel: string }[]).map((z) => String(z.schluessel))])
      setze({
        geladen: true,
        verfuegbar: true,
        eintraege: ((neu.data ?? []) as Record<string, unknown>[]).map(neuigkeitAusZeile).filter((n) => n.id && n.titel),
        gelesen,
        einstellung: { telegram_tipp: e?.telegram_tipp !== false, schwerpunkte: Array.isArray(e?.schwerpunkte) ? e!.schwerpunkte! : [] },
      })
      geladenAm = Date.now()
    } catch {
      setze({ geladen: true, verfuegbar: false })
    } finally {
      laufend = null
    }
  })()
  return laufend
}

/** Vermerkt Neuigkeiten (id) oder Hinweise ('hinweis:<name>') als gelesen — sofort in der Anzeige, dann in der Datenbank. */
export async function markiereGelesen(schluessel: string[]): Promise<boolean> {
  const neu = schluessel.filter((s) => s && !stand.gelesen.has(s))
  if (neu.length === 0) return true
  setze({ gelesen: new Set([...stand.gelesen, ...neu]) })
  if (!supabase || !stand.email || istNurLesen()) return false
  const jetzt = new Date().toISOString()
  const { error } = await supabase
    .from('neuigkeiten_gelesen')
    .upsert(neu.map((s) => ({ email: stand.email, schluessel: s, gelesen_am: jetzt })), { onConflict: 'email,schluessel', ignoreDuplicates: true })
  return !error
}

/** Hinweis neben einem Knopf weggeklickt? */
export function hinweisSchluessel(name: string): string {
  return `${HINWEIS_VORSATZ}${name}`
}

/** Eigene Einstellung ändern (Tipp der Woche, Schwerpunkte). false = nicht gespeichert (Anzeige springt zurück). */
export async function speichereNeuigkeitenEinstellung(teil: Partial<NeuigkeitenEinstellung>): Promise<boolean> {
  if (!supabase || !stand.email || istNurLesen()) return false
  const vorher = stand.einstellung
  setze({ einstellung: { ...vorher, ...teil } })
  const zeile: Record<string, unknown> = { email: stand.email, geaendert_am: new Date().toISOString() }
  if (teil.telegram_tipp !== undefined) zeile.telegram_tipp = teil.telegram_tipp
  if (teil.schwerpunkte !== undefined) zeile.schwerpunkte = teil.schwerpunkte
  const { error } = await supabase.from('neuigkeiten_einstellung').upsert(zeile, { onConflict: 'email' })
  if (error) {
    setze({ einstellung: vorher })
    return false
  }
  return true
}

/** Gemeinsamer Stand plus die für den Angemeldeten relevanten (und davon ungelesenen) Neuigkeiten. */
export function useNeuigkeiten(): NeuigkeitenStand & { relevant: Neuigkeit[]; ungelesen: Neuigkeit[]; neuLaden: () => Promise<void> } {
  const { echterMitarbeiter } = useAuth()
  const email = echterMitarbeiter?.email ?? ''
  const s = useSyncExternalStore(abonniere, () => stand, () => stand)
  useEffect(() => {
    void ladeNeuigkeiten(email)
  }, [email])
  const person = echterMitarbeiter ? { rolle: echterMitarbeiter.rolle, ist_admin: echterMitarbeiter.ist_admin, bereiche: echterMitarbeiter.bereiche } : null
  const relevant = sortiereNeuigkeiten(
    s.eintraege.filter((n) => n.aktiv && istRelevant(n, person)),
    s.einstellung.schwerpunkte,
  )
  return {
    ...s,
    relevant,
    ungelesen: relevant.filter((n) => !s.gelesen.has(n.id)),
    neuLaden: () => ladeNeuigkeiten(email, true),
  }
}
