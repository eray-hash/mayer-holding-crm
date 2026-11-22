// Kleine React-Helfer der Gesprächs-App.
import { useEffect, useState } from 'react'
import * as speicher from './speicher'
import type { LokaleAufnahme } from './warteschlange'
import { aktuellePerson } from './uploader'

/** Alle Aufnahmen der angemeldeten Person im Gerätespeicher, aktualisiert bei jeder Änderung. */
export function useLokaleAufnahmen(): LokaleAufnahme[] {
  const [liste, setListe] = useState<LokaleAufnahme[]>([])
  useEffect(() => {
    let aktiv = true
    const laden = () =>
      void speicher
        .alleAufnahmen()
        .then((l) => aktiv && setListe(l.filter((a) => a.mitarbeiterEmail === aktuellePerson())))
        .catch(() => undefined)
    laden()
    const weg = speicher.beiAenderung(laden)
    // Lebenszeichen/Wartezeiten ändern die Anzeige auch ohne Speichervorgang
    const uhr = window.setInterval(laden, 10_000)
    return () => {
      aktiv = false
      weg()
      window.clearInterval(uhr)
    }
  }, [])
  return liste
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  useEffect(() => {
    const an = () => setOnline(true)
    const aus = () => setOnline(false)
    window.addEventListener('online', an)
    window.addEventListener('offline', aus)
    return () => {
      window.removeEventListener('online', an)
      window.removeEventListener('offline', aus)
    }
  }, [])
  return online
}

/** Läuft jede Sekunde neu (für Uhren). */
export function useTakt(ms = 1000): number {
  const [jetzt, setJetzt] = useState(() => Date.now())
  useEffect(() => {
    const uhr = window.setInterval(() => setJetzt(Date.now()), ms)
    return () => window.clearInterval(uhr)
  }, [ms])
  return jetzt
}

const UHR = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
const TAG = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })

export function wannText(iso: string): string {
  const d = new Date(iso)
  const heute = new Date()
  const morgen = new Date(heute.getTime() + 24 * 3600_000)
  const gleich = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const tag = gleich(d, heute) ? 'Heute' : gleich(d, morgen) ? 'Morgen' : TAG.format(d)
  return `${tag}, ${UHR.format(d)} Uhr`
}

export function minutenText(sekunden: number): string {
  const m = Math.round(sekunden / 60)
  return m < 1 ? 'unter 1 Min.' : `${m} Min.`
}
