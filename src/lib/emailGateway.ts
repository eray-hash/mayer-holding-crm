// Client für die Supabase Edge Function "email-gateway" (siehe
// supabase/functions/email-gateway/index.ts). Liest URL + geteiltes Secret aus Vite-Env-Variablen,
// damit nirgends ein echtes Postfach-Passwort oder API-Key im Frontend-Code landet. Trotz des
// Namens bündelt diese eine Function inzwischen auch die KI-Gesprächszusammenfassung
// (summarizeTranscript) — gleiche URL, gleiches Secret, kein zweites Deployment nötig.

const FUNCTION_URL = import.meta.env.VITE_EMAIL_GATEWAY_URL as string | undefined
const SHARED_SECRET = import.meta.env.VITE_EMAIL_GATEWAY_SECRET as string | undefined

export const isEmailGatewayConfigured = Boolean(FUNCTION_URL)

export type EingegangeneMail = {
  messageId: string
  von: string
  vonName: string
  betreff: string
  datum: string
  ausschnitt: string
}

async function call(body: Record<string, unknown>): Promise<any> {
  if (!FUNCTION_URL) throw new Error('E-Mail-Postfach ist noch nicht konfiguriert (VITE_EMAIL_GATEWAY_URL fehlt).')
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SHARED_SECRET ? { 'x-crm-secret': SHARED_SECRET } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? `Fehler beim Abruf (${res.status})`)
  return data
}

export async function syncPosteingang(limit = 20): Promise<EingegangeneMail[]> {
  const data = await call({ action: 'sync', limit })
  return data.mails ?? []
}

export type SendEmailKundeKontext = {
  toName?: string
  kundeBereich?: string
  kundeId?: string
  kundeName?: string
}

export async function sendEmail(to: string, subject: string, text: string, html?: string, kontext?: SendEmailKundeKontext): Promise<void> {
  await call({ action: 'send', to, subject, text, html, ...kontext })
}

export type Gespraechszusammenfassung = {
  kernthemen: string[]
  vereinbarungen: string[]
  offene_punkte: string[]
  stimmung: string
  zusammenfassung: string
}

export async function summarizeTranscript(transcript: string): Promise<Gespraechszusammenfassung> {
  const data = await call({ action: 'summarize', transcript })
  return data.summary
}

export type AssistentTyp = 'notiz' | 'aufgabe' | 'frage'

export type AssistentKlassifikation = {
  typ: AssistentTyp
  erkannter_name?: string
  titel?: string
  faelligkeitsdatum?: string
  frage?: string
}

export async function classifyAssistantInput(transcript: string, heute: string): Promise<AssistentKlassifikation> {
  const data = await call({ action: 'assistant_classify', transcript, heute })
  return data.klassifikation
}

export async function answerAssistantQuestion(frage: string, kontext: string): Promise<string> {
  const data = await call({ action: 'assistant_answer', frage, kontext })
  return data.antwort
}

export type PotenzialChance = {
  bereich: string
  titel: string
  begruendung: string
  naechster_schritt: string
  prioritaet: 'Hoch' | 'Mittel' | 'Niedrig'
}

export async function analysierePotenzial(kontext: string): Promise<PotenzialChance[]> {
  const data = await call({ action: 'potenzial_analyse', kontext })
  return data.chancen ?? []
}
