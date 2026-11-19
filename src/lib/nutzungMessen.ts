// Nutzungsdauer im CRM (Superuser-Auswertung, seit 19.11.2026): Für jede Minute, in der jemand das CRM
// tatsächlich benutzt, entsteht eine Zeile in `nutzung_minuten` (E-Mail, Minute, Seite). „Benutzt“
// heißt: Das Fenster ist sichtbar UND in den letzten 2 Minuten gab es eine Eingabe (Maus, Tastatur,
// Berühren, Blättern). Ein offenes, aber unbeachtetes Fenster zählt also nicht.
// - Höchstens eine Zeile pro Minute; dieselbe Minute zweimal ist harmlos (Primärschlüssel, ignoriert).
// - Ohne Netz werden die Minuten gesammelt und später nachgereicht (höchstens 3 Stunden).
// - Läuft nicht im Vorführmodus (ohne Datenbank) und nicht bei „Ansehen als …“.
// - Fehler bleiben still: Die Messung darf nie bei der Arbeit stören.
// Lesen darf die Tabelle nur der Superuser (Zeilenschutz in der Datenbank).
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from './supabaseClient'
import { istNurLesen } from './nurLesen'

const AKTIV_FENSTER_MS = 2 * 60 * 1000
const PUFFER_HOECHSTENS = 180

type Minute = { email: string; minute: string; seite: string | null }

/** Pfad ohne Kennungen: /beratung/kunden/k_ab12cd → /beratung/kunden */
export function seiteOhneKennung(pfad: string): string {
  const teile = pfad.split('/').filter(Boolean)
  // Kennungen: alles mit Unterstrich (k_…, o_ql_…, todo_…; keine Route enthält einen), lange
  // Zahlen-/Hex-Folgen und lange Teile mit Ziffern.
  const sauber = teile.filter((t) => !(t.includes('_') || /^[0-9a-f-]{8,}$/i.test(t) || (/\d/.test(t) && t.length > 14)))
  return '/' + sauber.join('/')
}

export function minuteVon(zeit: Date): string {
  const d = new Date(zeit)
  d.setUTCSeconds(0, 0)
  return d.toISOString()
}

export function useNutzungMessen(email: string | null | undefined): void {
  const location = useLocation()
  const seite = useRef(seiteOhneKennung(location.pathname))
  seite.current = seiteOhneKennung(location.pathname)

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !email) return
    const client = supabase
    const ich = email.trim().toLowerCase()
    let letzteEingabe = Date.now()
    let letzteMinute = ''
    let puffer: Minute[] = []
    let sendet = false

    const eingabe = () => {
      letzteEingabe = Date.now()
    }
    const ereignisse = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const
    for (const e of ereignisse) window.addEventListener(e, eingabe, { passive: true, capture: true })

    const senden = async () => {
      if (sendet || puffer.length === 0 || istNurLesen()) return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      sendet = true
      const stapel = puffer.slice(0, 60)
      try {
        const { error } = await client.from('nutzung_minuten').upsert(stapel, { onConflict: 'email,minute', ignoreDuplicates: true })
        if (!error) puffer = puffer.slice(stapel.length)
      } catch {
        // still — nächster Versuch in einer Minute
      } finally {
        sendet = false
      }
    }

    const takt = () => {
      if (istNurLesen()) return
      const sichtbar = typeof document === 'undefined' || document.visibilityState === 'visible'
      if (sichtbar && Date.now() - letzteEingabe <= AKTIV_FENSTER_MS) {
        const minute = minuteVon(new Date())
        if (minute !== letzteMinute) {
          letzteMinute = minute
          puffer.push({ email: ich, minute, seite: seite.current })
          if (puffer.length > PUFFER_HOECHSTENS) puffer = puffer.slice(-PUFFER_HOECHSTENS)
        }
      }
      void senden()
    }

    takt()
    const uhr = window.setInterval(takt, 20000)
    const online = () => void senden()
    window.addEventListener('online', online)
    return () => {
      window.clearInterval(uhr)
      window.removeEventListener('online', online)
      for (const e of ereignisse) window.removeEventListener(e, eingabe, { capture: true })
      void senden()
    }
  }, [email])
}
