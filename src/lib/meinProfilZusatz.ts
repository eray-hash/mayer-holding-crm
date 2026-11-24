import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import {
  FIRMEN_KONTAKT_ID,
  firmenKontaktAus,
  firmenTelefonAus,
  wirksamesTelefon,
  type FirmenKontakt,
} from '../../supabase/functions/_shared/profilKern.ts'

// Zusatzangaben aus „Mein Profil“, die nicht in der mitarbeiter-Zeile stehen (Runde 5, 22.11.2026):
// Tabelle mitarbeiter_profil (id = mitarbeiter.id; Mobil, Funktion, Nachfrage-Einstellung, seit 24.11.2026
// auch „Telefonnummer im Exposé zeigen“, Spalte telefon_im_expose, SQL 2026-11-24_expose_telefon.sql) — bewusst
// keine neuen Spalten auf mitarbeiter (die bräuchten GRANT SELECT, sonst sperrt das CRM alle aus).
// Schreiben darf jeder nur die eigene Zeile (Zeilenregel in der Datenbank).
// Dazu die Firmen-Ersatznummer (abteilung_eintraege 'firmen_kontakt'; ändern nur Geschäftsführung/Admin).

export type ProfilZusatz = {
  mobil: string
  position: string
  profilNachfrage: boolean
  /** Eigene Telefon-/Mobilnummer im Exposé zeigen (Vorgabe ja). Aus: dort steht die Firmennummer. */
  telefonImExpose: boolean
}

export const LEERER_ZUSATZ: ProfilZusatz = { mobil: '', position: '', profilNachfrage: true, telefonImExpose: true }

export async function ladeProfilZusatz(mitarbeiterId: string): Promise<ProfilZusatz> {
  if (!supabase || !mitarbeiterId) return LEERER_ZUSATZ
  // '*' statt einzelner Spalten: so klappt das Laden auch, solange die Spalte telefon_im_expose noch fehlt.
  const { data, error } = await supabase.from('mitarbeiter_profil').select('*').eq('id', mitarbeiterId).maybeSingle()
  if (error) throw new Error(error.message)
  return {
    mobil: String(data?.mobil ?? ''),
    position: String(data?.position ?? ''),
    profilNachfrage: data?.profil_nachfrage !== false,
    telefonImExpose: data?.telefon_im_expose !== false,
  }
}

/** Schreibt nur die übergebenen Felder der eigenen Zeile; legt sie beim ersten Mal an. */
export async function speichereProfilZusatz(mitarbeiterId: string, patch: Partial<ProfilZusatz>): Promise<void> {
  if (!supabase || !mitarbeiterId) return
  const zeile: Record<string, unknown> = { geaendert_am: new Date().toISOString() }
  if (patch.mobil !== undefined) zeile.mobil = patch.mobil.trim() || null
  if (patch.position !== undefined) zeile.position = patch.position.trim() || null
  if (patch.profilNachfrage !== undefined) zeile.profil_nachfrage = patch.profilNachfrage
  if (patch.telefonImExpose !== undefined) zeile.telefon_im_expose = patch.telefonImExpose
  const { data, error } = await supabase.from('mitarbeiter_profil').update(zeile).eq('id', mitarbeiterId).select('id')
  if (error) throw new Error(error.message)
  if (data && data.length > 0) return
  const { error: anlegeFehler } = await supabase.from('mitarbeiter_profil').insert({ id: mitarbeiterId, ...zeile })
  if (!anlegeFehler) return
  if (anlegeFehler.code !== '23505') throw new Error(anlegeFehler.message)
  // Gleichzeitig angelegt (z. B. vom Assistenten): dann nur ändern.
  const { error: zweiter } = await supabase.from('mitarbeiter_profil').update(zeile).eq('id', mitarbeiterId)
  if (zweiter) throw new Error(zweiter.message)
}

export async function ladeFirmenKontaktCrm(): Promise<FirmenKontakt> {
  if (!supabase) return firmenKontaktAus(null)
  const { data } = await supabase.from('abteilung_eintraege').select('daten').eq('id', FIRMEN_KONTAKT_ID).maybeSingle()
  return firmenKontaktAus(data?.daten)
}

/** Nur Geschäftsführung/Admin (Zeilenregel); liest die Zeile frisch und ändert nur an/telefon. */
export async function speichereFirmenKontakt(patch: { an?: boolean; telefon?: string }, vonName: string): Promise<void> {
  if (!supabase) return
  const { data: alt } = await supabase.from('abteilung_eintraege').select('daten').eq('id', FIRMEN_KONTAKT_ID).maybeSingle()
  const daten = {
    ...((alt?.daten as Record<string, unknown> | null) ?? {}),
    ...(patch.an !== undefined ? { an: patch.an } : {}),
    ...(patch.telefon !== undefined ? { telefon: patch.telefon.trim() } : {}),
    geaendertAm: new Date().toISOString(),
    geaendertVon: vonName,
  }
  const { error } = await supabase
    .from('abteilung_eintraege')
    .upsert({ id: FIRMEN_KONTAKT_ID, art: FIRMEN_KONTAKT_ID, daten, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

/**
 * Telefonnummer für das Exposé: liefert eine Funktion, die zur eigenen Nummer die Mobilnummer aus
 * „Mein Profil“ und sonst die Firmennummer ergänzt. Hat der Mitarbeiter „Telefonnummer im Exposé zeigen“
 * ausgeschaltet, steht dort nur die Firmennummer (oder nichts, wenn der Firmen-Ersatz abgeschaltet ist).
 * Bis geladen ist: nur die eigene Nummer.
 */
export function useExposeTelefon(mitarbeiterId: string | null | undefined): (eigene: string | null | undefined) => string {
  const [ersatz, setErsatz] = useState<{ mobil: string; firma: FirmenKontakt | null; zeigen: boolean }>({ mobil: '', firma: null, zeigen: true })
  useEffect(() => {
    if (!supabase || !mitarbeiterId) return
    let aktiv = true
    Promise.all([ladeProfilZusatz(mitarbeiterId), ladeFirmenKontaktCrm()])
      .then(([z, f]) => {
        if (aktiv) setErsatz({ mobil: z.mobil, firma: f, zeigen: z.telefonImExpose })
      })
      .catch(() => undefined)
    return () => {
      aktiv = false
    }
  }, [mitarbeiterId])
  return useCallback(
    (eigene) =>
      ersatz.zeigen ? wirksamesTelefon(eigene, ersatz.mobil, ersatz.firma) : ersatz.firma ? firmenTelefonAus(ersatz.firma) : '',
    [ersatz],
  )
}
