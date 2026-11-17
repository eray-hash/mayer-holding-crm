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

/** `offen`: was im CRM gerade geöffnet ist (Mail im gemeinsamen Postfach oder eine Akte), siehe assistentKontext.ts. */
export function frageAssistent(text: string, offen?: { art: 'mail' | 'akte'; kennung: string } | null): Promise<AssistentAntwort> {
  return anfrage<AssistentAntwort>({ web: 'chat', text, ...(offen ? { offen } : {}) })
}

/** Benachrichtigt über Telegram: bei einer neuen Frage die Geschäftsführung, bei einer Antwort den Fragesteller.
 *  Schlägt das fehl (niemand mit Telegram verbunden, kein Netz), bleibt die Frage trotzdem gespeichert. */
export function meldeFrage(id: string, art: 'neu' | 'antwort'): void {
  if (!istServerAssistentVerfuegbar) return
  void anfrage({ web: 'frage_melden', id, art }).catch(() => undefined)
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

// ---------- Dateien und Fotos an den Assistenten geben (ohne Telegram) ----------

export const DATEI_HOECHSTENS = 30 * 1024 * 1024
/** Welche Dateien der Auswahldialog anbietet. Mit "image/*" liefert das Handy Fotos als JPEG. */
export const DATEI_ARTEN =
  'image/*,application/pdf,audio/*,video/*,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ods,.ppt,.pptx,.eml,.msg,.zip'

/** Handy-Fotos sind oft 5–12 MB groß. Für die Ablage und fürs Lesen reicht eine Kantenlänge von
 *  2600 Punkten (gut lesbares A4) — das spart Wartezeit und Speicher. Alles andere bleibt unverändert. */
export async function verkleinereBild(datei: File): Promise<File> {
  if (!datei.type.startsWith('image/') || /gif|svg/.test(datei.type)) return datei
  if (datei.size < 1_500_000 && /jpe?g|png|webp/.test(datei.type)) return datei
  try {
    const bild = await createImageBitmap(datei)
    const faktor = Math.min(1, 2600 / Math.max(bild.width, bild.height))
    const flaeche = document.createElement('canvas')
    flaeche.width = Math.round(bild.width * faktor)
    flaeche.height = Math.round(bild.height * faktor)
    const stift = flaeche.getContext('2d')
    if (!stift) return datei
    stift.drawImage(bild, 0, 0, flaeche.width, flaeche.height)
    bild.close()
    const blob = await new Promise<Blob | null>((fertig) => flaeche.toBlob(fertig, 'image/jpeg', 0.86))
    if (!blob || blob.size >= datei.size) return datei
    return new File([blob], datei.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return datei // lässt sich das Bild hier nicht öffnen, geht es so, wie es ist
  }
}

/** Lädt eine Datei direkt in die Ablage und übergibt sie dem Assistenten zum Einsortieren. Die Arbeit
 *  läuft auf dem Server weiter; das Ergebnis kommt über dateiStatus(). `sammel`: viele Dateien auf
 *  einmal — dann wird nur gespeichert und der Reihe nach einsortiert. */
export async function schickeDatei(datei: File, text: string, sammel: boolean): Promise<{ auftrag: string; wartet: boolean }> {
  if (!supabase) throw new Error('Der Assistent ist nicht eingerichtet.')
  if (datei.size > DATEI_HOECHSTENS) throw new Error('zu groß (höchstens 30 MB). Lade sie bitte direkt in der Akte unter „Dokumente" hoch.')
  const typ = datei.type || 'application/octet-stream'
  const ziel = await anfrage<{ pfad: string; token: string }>({ web: 'datei_ziel', name: datei.name, groesse: datei.size })
  const { error } = await supabase.storage.from('email-anhaenge').uploadToSignedUrl(ziel.pfad, ziel.token, datei, { contentType: typ })
  if (error) throw new Error(`Hochladen fehlgeschlagen (${error.message}).`)
  return anfrage({ web: 'datei', pfad: ziel.pfad, name: datei.name, typ, text, sammel })
}

export type DateiStatus = { wartend: number; laeuft: boolean; ergebnisse: { id: string; text: string; z: string }[] }

export function dateiStatus(): Promise<DateiStatus> {
  return anfrage<DateiStatus>({ web: 'datei_status' })
}
