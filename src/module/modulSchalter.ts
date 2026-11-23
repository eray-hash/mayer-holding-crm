// Abschaltbare Zusatzmodule (23.11.2026). Welche Module an sind, steht in der Tabelle crm_module
// (id, name, aktiv, geaendert_am, geaendert_von). Lesen dürfen alle aktiven Mitarbeiter, ändern nur die
// Geschäftsführung (Zeilenregel in der Datenbank).
//
// Die Tabelle wird einmal geladen und im Speicher gehalten. Fehler beim Laden oder eine fehlende Zeile
// bedeuten „aus“ — ein Modul erscheint nur, wenn es ausdrücklich eingeschaltet ist. Schlägt das Laden
// fehl, wird es beim nächsten Öffnen einer Seite erneut versucht.
//
//   const aktiv = useModulAktiv('e_rechnung')
import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabaseClient'

export type ModulZeile = { id: string; name: string; aktiv: boolean; geaendertAm?: string; geaendertVon?: string }

type Stand = { geladen: boolean; fehler: string; liste: ModulZeile[] }

let stand: Stand = { geladen: false, fehler: '', liste: [] }
let laeuft: Promise<void> | null = null
const zuhoerer = new Set<() => void>()

function setze(neu: Stand) {
  stand = neu
  zuhoerer.forEach((f) => f())
}

function abonnieren(f: () => void) {
  zuhoerer.add(f)
  return () => {
    zuhoerer.delete(f)
  }
}

type Rohzeile = { id: string; name: string | null; aktiv: boolean | null; geaendert_am: string | null; geaendert_von: string | null }

const zeileAus = (z: Rohzeile): ModulZeile => ({
  id: z.id,
  name: z.name?.trim() || z.id,
  aktiv: z.aktiv === true,
  geaendertAm: z.geaendert_am ?? undefined,
  geaendertVon: z.geaendert_von ?? undefined,
})

/** Lädt die Modulliste (nur einmal; nach einem Fehler beim nächsten Aufruf erneut). */
export function ladeModule(neuLaden = false): Promise<void> {
  if (!neuLaden && (stand.geladen || laeuft)) return laeuft ?? Promise.resolve()
  laeuft = (async () => {
    try {
      if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
      const { data, error } = await supabase.from('crm_module').select('id, name, aktiv, geaendert_am, geaendert_von').order('name')
      if (error) throw new Error(error.message)
      setze({ geladen: true, fehler: '', liste: ((data ?? []) as Rohzeile[]).map(zeileAus) })
    } catch (e) {
      // Fehler = alles aus; geladen bleibt falsch, damit der nächste Aufruf es noch einmal versucht.
      setze({ geladen: false, fehler: e instanceof Error ? e.message : 'Die Zusatzmodule ließen sich nicht laden.', liste: [] })
    } finally {
      laeuft = null
    }
  })()
  return laeuft
}

// Beim Abmelden vergessen, damit der nächste Mitarbeiter frisch lädt; wurde vor dem Anmelden eine leere
// Liste geladen (ohne Login sieht man keine Zeilen), nach dem Anmelden neu laden.
supabase?.auth.onAuthStateChange((ereignis) => {
  if (ereignis === 'SIGNED_OUT') setze({ geladen: false, fehler: '', liste: [] })
  else if (ereignis === 'SIGNED_IN' && stand.geladen && stand.liste.length === 0) void ladeModule(true)
})

/** Alle Module mit Stand (für die Einstellungen). */
export function useModule(): Stand & { laedt: boolean } {
  const s = useSyncExternalStore(abonnieren, () => stand)
  useEffect(() => {
    void ladeModule()
  }, [])
  return { ...s, laedt: !s.geladen && !s.fehler }
}

/** Ist das Modul eingeschaltet? Solange noch geladen wird, bei Fehler oder fehlender Zeile: nein. */
export function useModulAktiv(id: string): boolean {
  const s = useSyncExternalStore(abonnieren, () => stand)
  useEffect(() => {
    void ladeModule()
  }, [])
  return s.liste.some((m) => m.id === id && m.aktiv)
}

/**
 * Schaltet ein Modul an oder aus (nur Geschäftsführung — die Datenbank lehnt alle anderen ab).
 * Wirft mit deutscher Meldung, wenn es nicht geklappt hat.
 */
export async function schalteModul(id: string, aktiv: boolean, vonName: string): Promise<void> {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  const geaendertAm = new Date().toISOString()
  const { data, error } = await supabase
    .from('crm_module')
    .update({ aktiv, geaendert_am: geaendertAm, geaendert_von: vonName })
    .eq('id', id)
    .select('id, name, aktiv, geaendert_am, geaendert_von')
  if (error) throw new Error(`Das Umschalten hat nicht geklappt (${error.message}).`)
  // Ohne Recht liefert die Datenbank keinen Fehler, sondern ändert einfach nichts.
  const zeile = (data as Rohzeile[] | null)?.[0]
  if (!zeile) throw new Error('Das Umschalten hat nicht geklappt — nur die Geschäftsführung darf Zusatzmodule ein- oder ausschalten.')
  const neu = zeileAus(zeile)
  setze({ ...stand, liste: stand.liste.some((m) => m.id === id) ? stand.liste.map((m) => (m.id === id ? neu : m)) : [...stand.liste, neu] })
}
