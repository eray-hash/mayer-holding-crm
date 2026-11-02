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
  anhaenge?: { filename: string; size: number; contentType: string; url: string }[]
  // Bei eindeutigem E-Mail-Match automatisch gesetzt (siehe inbound-email/index.ts und
  // scripts/auto-assign-emails.mjs) — kein manuelles Zuordnen im Postfach mehr nötig.
  zugewiesen?: { bereich: import('../types').KundeBereich; kundeId: string; kundeName: string }
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

export type MailAnhang = { filename: string; contentBase64?: string; url?: string; contentType?: string }

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string,
  kontext?: SendEmailKundeKontext,
  attachments?: MailAnhang[],
): Promise<void> {
  await call({ action: 'send', to, subject, text, html, attachments, ...kontext })
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

export type AssistentTyp = 'notiz' | 'aufgabe' | 'frage' | 'aufnahme'

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

export async function draftCampaign(ziel: string): Promise<{ betreff: string; text: string }> {
  const data = await call({ action: 'draft_campaign', ziel })
  return { betreff: data.betreff, text: data.text }
}

export async function answerWithImage(frage: string, imageBase64: string, mediaType: string): Promise<string> {
  const data = await call({ action: 'assistant_vision', frage, image_base64: imageBase64, media_type: mediaType })
  return data.antwort
}

export async function inviteMitarbeiter(email: string): Promise<void> {
  await call({ action: 'invite_mitarbeiter', email })
}

export type LeadKlassifizierungsErgebnis = { geprueft: number; vorgeschlagen: number; uebersprungen: number }

// Klassifiziert nur neue, noch unbekannte E-Mail-Absender als Lead-Vorschlag (Nachfolger von
// scripts/extract-leads.mjs — läuft automatisch statt manuell, siehe Postfach.tsx).
export async function classifyNewLeads(): Promise<LeadKlassifizierungsErgebnis> {
  return call({ action: 'classify_new_leads' })
}

// Öffentliche, unauthentifizierte Formulare (src/pages/formulare/Public*.tsx) dürfen die
// kunden-Tabelle nicht direkt per Supabase-Client lesen/schreiben (RLS verlangt einen eingeloggten
// Mitarbeiter) — diese drei Aktionen laufen stattdessen serverseitig mit dem Service-Role-Key,
// siehe supabase/functions/email-gateway/index.ts.
export type PublicKunde = {
  firma: string
  ansprechpartner: string
  email: string
  selbstauskunft?: import('../types').Selbstauskunft
  ndaUnterschrieben?: boolean
}

export async function holePublicKunde(bereich: string, kundeId: string): Promise<PublicKunde | null> {
  const data = await call({ action: 'public_get_kunde', bereich, kundeId })
  return data.kunde ?? null
}

export async function sendePublicFormular(params: {
  bereich: string
  kundeId: string
  aktivitaetText: string
  aktivitaetUser?: string
  signatur?: { name: string; dataUrl: string; kontext: string }
  selbstauskunft?: import('../types').Selbstauskunft
  // Modul 8 (Behörden-Automatisierung): wenn gesetzt, schickt automatisch eine E-Mail an diese
  // Adresse und legt eine Wiedervorlage an — email/name kommen aus dem ?behoerde=.../&behoerdeName=
  // Query-Parameter des Formular-Links (vom Mitarbeiter beim Versenden festgelegt). pdfBase64 sollte
  // praktisch immer mitgeschickt werden (siehe generateDokumentPdf) — sonst geht nur die isolierte
  // Signatur raus, die für die Behörde allein nicht nachvollziehbar ist.
  behoerde?: { email: string; name?: string; pdfBase64?: string; pdfFilename?: string }
}): Promise<void> {
  await call({ action: 'public_submit_formular', ...params })
}

export type ImmoRadarTreffer = {
  id: string
  url: string
  titel: string
  ort: string
  bundesland: string
  flaecheM2: number | null
  kaufpreis: number | null
  preisProM2: number | null
  objektTypLabel: string
  lukrativitaet: string
  score: number
  beschreibung: string
  kiEinschaetzung: string | null
}

// Modul 3: ersetzt das manuelle Copy/Paste aus dem ImmoRadar-Dashboard — lädt serverseitig
// gefilterte, vielversprechende Treffer (siehe email-gateway/index.ts fetchImmoRadarTopListings).
export async function holeImmoRadarTopListings(): Promise<ImmoRadarTreffer[]> {
  const data = await call({ action: 'immoradar_top' })
  return data.listings ?? []
}

export type PflegeKlassifikation = {
  aktion: 'verschieben' | 'loeschen' | 'merge' | 'unklar'
  kunde_name?: string
  kunde_name_2?: string
  ziel_bereich?: import('../types').KundeBereich
}

// Pflege-Modus im KI-Assistenten (nur Geschäftsführung/Admin, siehe KiAssistentPanel.tsx) —
// klassifiziert eine Massenkorrektur-Anweisung, die eigentliche Kundenzuordnung und jede
// Schreiboperation passiert erst im Frontend nach expliziter Bestätigung.
export async function classifyPflegeInput(text: string): Promise<PflegeKlassifikation> {
  const data = await call({ action: 'pflege_classify', text })
  return data.klassifikation
}

export async function erstellePublicLead(params: {
  firma: string
  ansprechpartner?: string
  email: string
  telefon?: string
  prioritaet?: 'Hoch' | 'Mittel' | 'Niedrig'
  followUp?: { date: string; note: string; done: boolean }
  aktivitaetText: string
  aktivitaetUser?: string
  signatur?: { name: string; dataUrl: string; kontext: string }
}): Promise<void> {
  await call({ action: 'public_create_lead', ...params })
}
