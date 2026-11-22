// Abschrift von Tonaufnahmen (Whisper) für email-gateway — Fassung von transkribiere() aus
// telegram-gateway/index.ts (dort unverändert), ergänzt um Zeitmarken je Stück.
//
// Mit GROQ_API_KEY (kostenloser Schlüssel, seit 19.11.2026) geht die Abschrift an Groq mit dem Modell
// whisper-large-v3-turbo; ohne ihn an OpenAI (OPENAI_API_KEY, whisper-1). TRANSKRIPTION_URL,
// TRANSKRIPTION_MODELL und TRANSKRIPTION_SPRACHE überschreiben das wie in telegram-gateway.
// Die Werte werden bei jedem Aufruf gelesen (nicht beim Laden), damit Tests sie setzen können.

export const TRANSKRIPTION_MAX_BYTES = 24 * 1024 * 1024 // der Dienst nimmt höchstens 25 MB je Datei

// Sätze, die Whisper bei Stille oder Rauschen erfindet (bekanntes Verhalten: es stammt aus den
// Untertiteln, mit denen das Modell gelernt hat). Besteht eine Abschrift nur daraus, ist sie leer.
const ERFUNDEN = [
  /^untertitel(ung)? (der|von|des|im auftrag) .{0,60}$/i,
  /^(vielen dank|danke) (fürs|für das) zuschauen[.!]?$/i,
  /^(vielen dank|danke)( für (ihre|eure) aufmerksamkeit)?[.!]?$/i,
  /^bis zum nächsten mal[.!]?$/i,
  /^copyright .{0,60}$/i,
  // Dasselbe in anderen Sprachen (Aufnahmen mit automatischer Spracherkennung, seit Runde 5).
  /^(thank you|thanks) (so much )?for watching[.!]?$/i,
  /^altyaz[ıi] .{0,60}$/i,
  /^(izlediğiniz için teşekkürler|abone olmayı unutmayın)[.!]?$/i,
  /^\.{1,5}$/,
]

export function istErfunden(t: string): boolean {
  const s = t.trim()
  return !s || ERFUNDEN.some((m) => m.test(s))
}

export type Abschrift = {
  text: string
  /** Stücke mit Beginn in Sekunden ab Anfang der Datei (leer, wenn der Dienst keine liefert). */
  stuecke: { ab: number; text: string }[]
  /** Länge laut Dienst in Sekunden (falls geliefert). */
  dauer?: number
  /** Erkannte Sprache laut Dienst (z. B. „turkish“ oder „tr“), falls geliefert. */
  sprache?: string
}

/** Fehler des Abschrift-Dienstes; `status` 429 = Mengengrenze (später erneut versuchen). */
export class AbschriftFehler extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export function abschriftEingerichtet(): boolean {
  return !!(Deno.env.get('GROQ_API_KEY') || Deno.env.get('OPENAI_API_KEY'))
}

/**
 * Schreibt eine Tonaufnahme ab. `hinweis`: Namen, die vorkommen können, und/oder der unmittelbar davor
 * gesprochene Text (bei Aufnahmen in Abschnitten) — verbessert die Schreibweise; höchstens 600 Zeichen.
 */
export async function schreibeAb(bytes: Uint8Array, dateiname: string, contentType: string, hinweis = '', timeoutMs = 100_000, sprachWahl?: string | null): Promise<Abschrift> {
  const groq = Deno.env.get('GROQ_API_KEY')
  const schluessel = groq ?? Deno.env.get('OPENAI_API_KEY')
  if (!schluessel) throw new AbschriftFehler('Die Abschrift von Aufnahmen ist noch nicht eingerichtet (kein Schlüssel hinterlegt).', 0)
  if (bytes.length > TRANSKRIPTION_MAX_BYTES) throw new AbschriftFehler('Der Aufnahme-Abschnitt ist für die Abschrift zu groß (über 24 MB).', 413)
  const url = Deno.env.get('TRANSKRIPTION_URL') ?? (groq ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions')
  const modell = Deno.env.get('TRANSKRIPTION_MODELL') ?? (groq ? 'whisper-large-v3-turbo' : 'whisper-1')
  // sprachWahl: undefined = Vorgabe (TRANSKRIPTION_SPRACHE, sonst Deutsch); null oder '' = automatisch erkennen lassen.
  const sprache = sprachWahl === undefined ? (Deno.env.get('TRANSKRIPTION_SPRACHE') ?? 'de') : (sprachWahl ?? '')
  const form = new FormData()
  form.append('file', new Blob([bytes.slice().buffer as ArrayBuffer], { type: contentType || 'application/octet-stream' }), dateiname)
  form.append('model', modell)
  // verbose_json liefert zusätzlich Stücke mit Zeitmarken (für die Sprung-Stellen in der Abschrift).
  form.append('response_format', 'verbose_json')
  if (sprache) form.append('language', sprache)
  if (hinweis.trim()) form.append('prompt', hinweis.trim().slice(-600))
  const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${schluessel}` }, body: form, signal: AbortSignal.timeout(timeoutMs) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new AbschriftFehler(`Der Abschrift-Dienst antwortet mit ${res.status}: ${data?.error?.message ?? 'unbekannter Fehler'}`, res.status)
  const text = String(data?.text ?? '').trim()
  // deno-lint-ignore no-explicit-any
  const roh: any[] = Array.isArray(data?.segments) ? data.segments : []
  const stuecke = roh
    .map((s) => ({ ab: Math.max(0, Math.round(Number(s?.start) * 10) / 10 || 0), text: String(s?.text ?? '').trim() }))
    .filter((s) => s.text && !istErfunden(s.text))
  const erkannt = typeof data?.language === 'string' && data.language.trim() ? { sprache: data.language.trim() } : {}
  if (istErfunden(text)) return { text: '', stuecke: [], dauer: Number(data?.duration) || undefined, ...erkannt }
  return { text, stuecke, dauer: Number(data?.duration) || undefined, ...erkannt }
}
