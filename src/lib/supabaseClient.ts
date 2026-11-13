import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && key)

// Wer über einen Einladungs-, Login- oder Passwort-Link kommt, ist sofort angemeldet, hat aber
// (noch) kein eigenes Passwort. Ohne Zwischenschritt landet er im CRM, schließt das Fenster und
// kommt nie wieder hinein — so bei Andreas Mayer am 12.11.2026. Deshalb wird die Art des Links
// gemerkt, BEVOR der Supabase-Client die Adresszeile ausliest und leert; die App zeigt dann zuerst
// "Passwort festlegen" (siehe App.tsx). Der Merker liegt im Browser, damit er ein Neuladen übersteht.
const PASSWORT_MERKER = 'mh_passwort_festlegen'
try {
  const adresse = window.location.href
  if (/[#&?]type=(invite|recovery|magiclink|signup)\b/.test(adresse) && !/[#&?]error=/.test(adresse)) {
    window.localStorage.setItem(PASSWORT_MERKER, '1')
  }
} catch {
  // Ohne Browser-Speicher (privates Fenster o. Ä.) gibt es den Zwischenschritt nicht — Login geht trotzdem.
}

export function passwortFestlegenNoetig(): boolean {
  try {
    return window.localStorage.getItem(PASSWORT_MERKER) === '1'
  } catch {
    return false
  }
}

export function setzePasswortFestlegenNoetig(noetig: boolean): void {
  try {
    if (noetig) window.localStorage.setItem(PASSWORT_MERKER, '1')
    else window.localStorage.removeItem(PASSWORT_MERKER)
  } catch {
    // siehe oben
  }
}

// Ohne .env.local läuft die App im Demo-Modus mit den lokalen Mock-Daten (siehe AppContext.tsx) —
// genau wie im Fundament Command Center.
export const supabase = isSupabaseConfigured ? createClient(url!, key!) : null
