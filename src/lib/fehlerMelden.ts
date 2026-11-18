// Meldet Fehler im Browser in die Tabelle `app_fehler`, damit die Geschäftsführung im täglichen
// Bericht sieht, wo das CRM hakt (Auswertung: supabase/functions/email-gateway/wunschAnalyse.ts).
//
// - Nur die Fehlermeldung, die Seite (Pfad ohne Suchparameter) und ein kurzer technischer Hinweis —
//   nie Formularinhalte, Eingaben oder Daten von Kunden.
// - Dieselbe Meldung höchstens einmal je 30 Sekunden, insgesamt höchstens 30 je Sitzung.
// - Scheitert das Melden (offline, nicht angemeldet, Zeilenschutz), passiert nichts weiter.
import { supabase } from './supabaseClient'

const SPERRE_MS = 30_000
const HOECHSTENS_JE_SITZUNG = 30
const zuletzt = new Map<string, number>()
let gemeldet = 0
let eingerichtet = false

function kurz(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

// Was in einer Fehlermeldung nach Kundendaten aussieht, kommt nicht mit.
function entschaerfe(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[E-Mail]')
    .replace(/(?:\+|\b0)\d[\d /-]{6,}\d/g, '[Nummer]')
    .replace(/\b\d{5,}\b/g, '[Nummer]')
}

function seite(): string {
  try {
    // HashRouter: der eigentliche Pfad steht hinter dem #. Lange Kennungen werden gekürzt.
    const pfad = (window.location.hash.replace(/^#/, '') || window.location.pathname).replace(/[?#].*$/, '')
    return kurz(pfad.replace(/\/[A-Za-z0-9_-]{12,}/g, '/…'), 120)
  } catch {
    return ''
  }
}

function alsText(wert: unknown): string {
  if (wert instanceof Error) return wert.message || wert.name
  if (typeof wert === 'string') return wert
  try {
    return JSON.stringify(wert) ?? String(wert)
  } catch {
    return String(wert)
  }
}

/** Für catch-Blöcke: `meldeFehler('Objekt konnte nicht gespeichert werden', err)`. Nie Formularinhalte übergeben. */
export function meldeFehler(meldung: string, details?: unknown): void {
  try {
    if (!supabase) return
    const text = kurz(entschaerfe(String(meldung || 'Unbekannter Fehler')), 300)
    const jetzt = Date.now()
    if (jetzt - (zuletzt.get(text) ?? 0) < SPERRE_MS) return
    if (gemeldet >= HOECHSTENS_JE_SITZUNG) return
    zuletzt.set(text, jetzt)
    gemeldet++
    const client = supabase
    const ort = seite()
    const zusatz = details === undefined ? null : kurz(entschaerfe(alsText(details)), 500)
    void (async () => {
      try {
        const { data } = await client.auth.getSession()
        const email = data.session?.user?.email
        if (!email) return // ohne Anmeldung lässt der Zeilenschutz ohnehin nichts zu
        await client.from('app_fehler').insert({ mitarbeiter_email: email.toLowerCase(), seite: ort, meldung: text, details: zusatz })
      } catch {
        // Melden darf nie selbst stören.
      }
    })()
  } catch {
    // siehe oben
  }
}

/** Einmal beim Start: fängt nicht behandelte Fehler und abgelehnte Versprechen ab. */
export function richteFehlerMeldenEin(): void {
  if (eingerichtet || typeof window === 'undefined') return
  eingerichtet = true
  window.addEventListener('error', (ereignis) => {
    // Nur Programmfehler — fehlgeschlagene Bilder oder Skripte (ohne Meldung) zählen nicht.
    if (!ereignis.message) return
    const ort = ereignis.filename ? `${ereignis.filename.split('/').pop()}:${ereignis.lineno}` : undefined
    meldeFehler(ereignis.message, ort)
  })
  window.addEventListener('unhandledrejection', (ereignis) => {
    const grund = ereignis.reason
    const text = grund instanceof Error ? grund.message : typeof grund === 'string' ? grund : 'Unbehandelter Fehler in einem Hintergrundvorgang'
    meldeFehler(text, grund instanceof Error && grund.stack ? grund.stack.split('\n').slice(0, 3).join(' | ') : undefined)
  })
}
