import { useAuth, type Mitarbeiter } from '../context/AuthContext'
import { isSupabaseConfigured } from './supabaseClient'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { AKTE_INTERN, AKTE_UNGEKLAERT } from '../data/sammelakten'
import type { Bereich, KundeBereich } from '../types'

// Wer sieht welchen Bereich — dieselbe Regel wie in der Datenbank (Funktion darf_bereich, siehe
// Rechte-Skript vom 18.11.2026): Geschäftsführung und Admins sehen alles, alle anderen nur die Bereiche
// aus mitarbeiter.bereiche. Die Kundenliste der Immobilienabteilung heißt in der Datenbank
// "immobilienkunden", die Freigabe dafür ist "immobilien". "privat" ist keine Freigabe: Jeder sieht
// seine eigenen privaten Kontakte (eigene Regel in der Datenbank).
// Die beiden Sammelakten ("Ungeklärte Eingänge", interne Akte) liegen in der Unternehmensberatung,
// sind aber für jeden aktiven Mitarbeiter da — unabhängig von seinen Bereichen.

export function freigabeFuer(bereich: Bereich | KundeBereich): Bereich {
  return bereich === 'immobilienkunden' ? 'immobilien' : bereich
}

export function siehtAlles(m: Pick<Mitarbeiter, 'rolle' | 'ist_admin'> | null | undefined): boolean {
  // Ohne Datenbank (Vorführmodus) oder bevor die eigene Zeile geladen ist, wird nichts versteckt —
  // genau wie bisher in RequireBereich. Die Datenbank schützt die Daten ohnehin selbst.
  if (!isSupabaseConfigured || !m) return true
  return m.rolle === 'geschaeftsfuehrung' || !!m.ist_admin
}

export function darfBereich(m: Pick<Mitarbeiter, 'rolle' | 'ist_admin' | 'bereiche'> | null | undefined, bereich: Bereich | KundeBereich): boolean {
  if (bereich === 'privat') return true
  if (siehtAlles(m)) return true
  return (m!.bereiche ?? []).includes(freigabeFuer(bereich))
}

export function istFuerAlleSichtbar(kundeId: string | undefined): boolean {
  return kundeId === AKTE_UNGEKLAERT || kundeId === AKTE_INTERN
}

/** Für Auswahllisten: nur die Kunden-Bereiche, in denen der angemeldete Mitarbeiter arbeiten darf. */
export function useBereichsRechte() {
  const { mitarbeiter } = useAuth()
  const darf = (bereich: Bereich | KundeBereich) => darfBereich(mitarbeiter, bereich)
  return {
    darf,
    /** KUNDEN_BEREICHE ohne Privat, gefiltert nach Freigabe. */
    oeffentlicheKundenBereiche: KUNDEN_BEREICHE.filter((b) => b.id !== 'privat' && darf(b.id)),
    /** KUNDEN_BEREICHE mit Privat, gefiltert nach Freigabe. */
    kundenBereiche: KUNDEN_BEREICHE.filter((b) => darf(b.id)),
  }
}
