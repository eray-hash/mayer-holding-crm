// Einstellungen der Gesprächs-App — je Gerät im Browser-Speicher (keine Server-Tabelle nötig).
import { useSyncExternalStore } from 'react'
import type { GespraechArt } from './typen'

export type GespraechEinstellungen = {
  standardModus: GespraechArt
  /** Nach wie vielen Tagen der Server den Ton löscht (Abschrift und Auswertung bleiben). */
  aufbewahrungTage: 7 | 30 | 90
  /** Bildschirm während der Aufnahme wach halten. */
  wachHalten: boolean
  /** Mitlesen während der Aufnahme (Spracherkennung des Browsers, nur als Hilfe). */
  untertitel: boolean
}

const SCHLUESSEL = 'mayer_gespraech_einstellungen'
const STANDARD: GespraechEinstellungen = { standardModus: 'termin', aufbewahrungTage: 30, wachHalten: true, untertitel: false }

let aktuell: GespraechEinstellungen = lies()
const zuhoerer = new Set<() => void>()

function lies(): GespraechEinstellungen {
  try {
    const roh = JSON.parse(window.localStorage.getItem(SCHLUESSEL) ?? '{}')
    const e = { ...STANDARD, ...(roh && typeof roh === 'object' ? roh : {}) } as GespraechEinstellungen
    if (!['termin', 'telefon', 'notiz'].includes(e.standardModus)) e.standardModus = 'termin'
    if (![7, 30, 90].includes(e.aufbewahrungTage)) e.aufbewahrungTage = 30
    return e
  } catch {
    return { ...STANDARD }
  }
}

export function einstellungen(): GespraechEinstellungen {
  return aktuell
}

export function setzeEinstellungen(aenderung: Partial<GespraechEinstellungen>): void {
  aktuell = { ...aktuell, ...aenderung }
  try {
    window.localStorage.setItem(SCHLUESSEL, JSON.stringify(aktuell))
  } catch {
    // privates Fenster: gilt dann nur bis zum Schließen
  }
  for (const f of zuhoerer) f()
}

export function useEinstellungen(): GespraechEinstellungen {
  return useSyncExternalStore(
    (f) => {
      zuhoerer.add(f)
      return () => zuhoerer.delete(f)
    },
    () => aktuell,
  )
}
