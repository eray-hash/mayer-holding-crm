// Verbindung des Assistenten-Fensters zum Assistenten auf dem Server — demselben, der auch im
// Telegram-Chat antwortet (supabase/functions/telegram-gateway). Er arbeitet direkt in der Datenbank:
// nachschlagen, Akten anlegen und ändern, Notizen, Aufgaben, E-Mails an Kunden vorbereiten und nach
// Freigabe versenden. Zugang über das eigene Login, nicht über das gemeinsame Geheimnis.
import { supabase } from './supabaseClient'

const EMAIL_GATEWAY_URL = import.meta.env.VITE_EMAIL_GATEWAY_URL as string | undefined
const ASSISTENT_URL = EMAIL_GATEWAY_URL?.replace(/email-gateway\/?$/, 'telegram-gateway')

export const istServerAssistentVerfuegbar = Boolean(supabase && ASSISTENT_URL && ASSISTENT_URL !== EMAIL_GATEWAY_URL)

async function anfrage<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase || !ASSISTENT_URL) throw new Error('Der Assistent ist nicht eingerichtet.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Nicht angemeldet.')
  const res = await fetch(ASSISTENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const inhalt = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(inhalt?.error ?? `Der Assistent antwortet nicht (${res.status}).`)
  return inhalt as T
}

export type AssistentAntwort = {
  antwort: string
  // true, wenn der Assistent in diesem Zug etwas im CRM geändert hat — dann die Daten neu laden.
  geaendert: boolean
  // Kennung eines eben freigegebenen E-Mail-Versands; sein Ergebnis kommt später über mailStatus().
  mailStart: string | null
}

export function frageAssistent(text: string): Promise<AssistentAntwort> {
  return anfrage<AssistentAntwort>({ web: 'chat', text })
}

export function mailStatus(): Promise<{ laeuft: boolean; ergebnis: { id: string; text: string; z: string } | null }> {
  return anfrage({ web: 'mail_status' })
}

// ---------- Abschrift von Aufnahmen (Whisper auf dem Server) ----------

let abhoerenAnfrage: Promise<boolean> | null = null

/** Ob der Server Aufnahmen abschreiben kann (Schlüssel hinterlegt). Wird je Sitzung einmal gefragt. */
export function abhoerenVerfuegbar(): Promise<boolean> {
  if (!istServerAssistentVerfuegbar) return Promise.resolve(false)
  abhoerenAnfrage ??= anfrage<{ abhoeren: boolean }>({ web: 'faehigkeiten' })
    .then((r) => r.abhoeren === true)
    .catch(() => {
      abhoerenAnfrage = null // beim nächsten Mal neu fragen (z. B. noch nicht angemeldet)
      return false
    })
  return abhoerenAnfrage
}

function alsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leser = new FileReader()
    leser.onload = () => resolve(String(leser.result).split(',')[1] ?? '')
    leser.onerror = () => reject(new Error('Die Aufnahme konnte nicht gelesen werden.'))
    leser.readAsDataURL(blob)
  })
}

/** Schreibt einen Abschnitt einer Aufnahme ab. `hinweis`: das zuletzt Gesprochene, für den Anschluss. */
export async function schreibeAb(aufnahme: Blob, hinweis = ''): Promise<string> {
  const r = await anfrage<{ text: string }>({ web: 'transkribiere', audio_base64: await alsBase64(aufnahme), mime: aufnahme.type, hinweis })
  return r.text ?? ''
}
