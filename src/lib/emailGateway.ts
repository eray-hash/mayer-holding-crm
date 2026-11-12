// Client für die Supabase Edge Function "email-gateway" (siehe
// supabase/functions/email-gateway/index.ts). Liest URL + geteiltes Secret aus Vite-Env-Variablen,
// damit nirgends ein echtes Postfach-Passwort oder API-Key im Frontend-Code landet. Trotz des
// Namens bündelt diese eine Function inzwischen auch die KI-Gesprächszusammenfassung
// (summarizeTranscript) — gleiche URL, gleiches Secret, kein zweites Deployment nötig.

import { supabase } from './supabaseClient'

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
  ignoriert?: boolean
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

// Für Aktionen, die Account-Zugriff gewähren (Login-Link erzeugen, Mitarbeiter einladen, Login-E-Mail
// ändern) — das x-crm-secret allein reicht da nicht als Schutz, weil es im öffentlichen Bundle steckt.
// Schickt zusätzlich das eigene Supabase-Login mit, das die Edge Function serverseitig prüft.
async function callAuthenticated(body: Record<string, unknown>): Promise<any> {
  if (!FUNCTION_URL) throw new Error('E-Mail-Postfach ist noch nicht konfiguriert (VITE_EMAIL_GATEWAY_URL fehlt).')
  const { data: sessionData } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Nicht eingeloggt.')
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
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

export type AssistentTyp = 'notiz' | 'aufgabe' | 'frage' | 'aufnahme' | 'uebersicht' | 'aktion_lead_anlegen' | 'aktion_lead_loeschen'

export type AssistentKlassifikation = {
  typ: AssistentTyp
  erkannter_name?: string
  titel?: string
  faelligkeitsdatum?: string
  frage?: string
  aktion_bereich?: string
  aktion_firma?: string
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
  quellen?: string[]
  annahmen?: string
}

// Firmen-Wissens-KI (bereichsübergreifende Fragen, siehe firmenwissenKontext.ts für den Aufbau des
// mitgeschickten kontext) — anders als answerAssistantQuestion (ein Kunde) deckt kontext hier
// potenziell alle Kunden/Objekte/Prozesse ab.
export async function generateExpose(bezeichnung: string, adresse: string, typ: string, kaufpreis: number): Promise<string> {
  const data = await call({ action: 'generiere_expose', bezeichnung, adresse, typ, kaufpreis })
  return data.exposeText
}

export async function answerFirmenwissen(frage: string, kontext: string): Promise<string> {
  const data = await call({ action: 'firmenwissen_answer', frage, kontext })
  return data.antwort
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
  await callAuthenticated({ action: 'invite_mitarbeiter', email })
}

// Workaround, da Supabases eingebauter Einladungs-/Reset-Mailversand bei manchen Empfängern (z.B.
// Hotmail) nie ankommt (siehe Projektnotiz "Supabase Email Delivery Broken") — erzeugt denselben
// Login-/Passwort-setzen-Link ohne selbst eine Mail zu verschicken. Muss über einen anderen Kanal
// (Chat, Signal, ...) an den Mitarbeiter zugestellt werden.
export async function generateLoginLink(email: string): Promise<string> {
  const data = await callAuthenticated({ action: 'generate_login_link', email })
  return data.link
}

// Ändert die Login-E-Mail eines Mitarbeiters synchron im Supabase-Auth-Account und in der
// mitarbeiter-Tabelle — z.B. um vorübergehend auf eine private Adresse auszuweichen, wenn ein
// amayer-holding.com-Postfach gerade nicht zustellt, und später wieder zurückzuschalten.
export async function updateMitarbeiterEmail(mitarbeiterId: string, neueEmail: string): Promise<void> {
  await callAuthenticated({ action: 'update_mitarbeiter_email', mitarbeiterId, neueEmail })
}

// Selbstbedienungs-Pendant zu generateLoginLink für die Login-Seite ("Passwort vergessen?") —
// verschickt den Link selbst über das echte IONOS-SMTP statt über Supabases unzuverlässigen Mailer.
// Antwortet immer gleich, unabhängig davon ob die E-Mail zu einem echten Mitarbeiter gehört.
export async function requestPasswordReset(email: string): Promise<void> {
  await call({ action: 'request_password_reset', email })
}

// Setzt das allererste Passwort für eine hinterlegte Mitarbeiter-E-Mail, ganz ohne Mailversand —
// nur möglich, solange für diesen Account noch nie ein Login stattgefunden hat (serverseitig geprüft).
export async function selbstRegistrieren(email: string, passwort: string): Promise<void> {
  await call({ action: 'self_register', email, passwort })
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
  unterlagenCheckliste?: Record<string, boolean>
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
  unterlagenCheckliste?: Record<string, boolean>
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

export type ObjektDokumentKlassifikation = {
  ordner: import('../types').DokumentOrdnerName
  vorgeschlagener_dateiname: string
  erkanntes_datum?: string
}

// KI-Dokumentenverarbeitung (Immobilienabteilung): erkennt Unterlagen-Kategorie + Dateinamen-
// Vorschlag + Datum aus einem hochgeladenen Bild/PDF. Siehe objektDokumenteStorage.ts für den Upload
// selbst (läuft direkt über den authentifizierten Supabase-Storage-Client, nicht über dieses Gateway).
export async function classifyObjektDokument(dateiBase64: string, mediaType: string, dateiname: string): Promise<ObjektDokumentKlassifikation> {
  const data = await call({ action: 'classify_objekt_dokument', datei_base64: dateiBase64, media_type: mediaType, dateiname })
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

// Öffentliches Eigentümer-Portal (PublicEigentuemerPortal.tsx) — Eigentümer ist beim Ausfüllen
// nicht als Mitarbeiter eingeloggt, die objekte-RLS-Policy lässt sonst weder Lesen noch Schreiben zu.
export type PublicObjekt = {
  bezeichnung: string
  adresse: string
  typ: import('../types').ObjektTyp
  dokumente: Partial<Record<import('../types').DokumentOrdnerName, import('../types').Dokument[]>>
  eigentuemer?: import('../types').ObjektEigentuemer
}

export async function holePublicObjekt(objektId: string): Promise<PublicObjekt | null> {
  const data = await call({ action: 'public_get_objekt', objektId })
  return data.objekt ?? null
}

// Öffentliches Exposé-Formular (PublicExpose.tsx) — lief bis zum Bugfixing-Fund 2026-11-03 über den
// normalen, RLS-gebundenen useApp()-Client (objekte/objekt_vorschlaege sind auf
// ist_aktiver_mitarbeiter() beschränkt) und zeigte einem echten, nicht eingeloggten Kunden deshalb
// immer "Link ungültig" — unbemerkt, weil es bisher nur eingeloggt getestet wurde. Jetzt wie die
// übrigen öffentlichen Formulare serverseitig mit Service-Role-Key.
export type PublicVorschlag = {
  id: string
  kundeName: string
  steuerBegruendung: string
  status: import('../types').ObjektVorschlagStatus
}
export type PublicExposeObjekt = {
  bezeichnung: string
  adresse: string
  typ: import('../types').ObjektTyp
  gruppe: import('../types').ObjektGruppe
  kaufpreis: number
}

export async function holePublicVorschlag(vorschlagId: string): Promise<{ vorschlag: PublicVorschlag | null; objekt: PublicExposeObjekt | null }> {
  const data = await call({ action: 'public_get_vorschlag', vorschlagId })
  return { vorschlag: data.vorschlag ?? null, objekt: data.objekt ?? null }
}

export async function entscheidePublicVorschlag(
  vorschlagId: string,
  entscheidung: 'akzeptiert' | 'abgelehnt',
): Promise<{ status: import('../types').ObjektVorschlagStatus }> {
  const data = await call({ action: 'public_entscheide_vorschlag', vorschlagId, entscheidung })
  return { status: data.status }
}

// Erzeugt einen Signed-Upload-Token statt den Datei-Inhalt entgegenzunehmen (Edge-Function-
// Größenlimit) — der eigentliche Upload läuft danach direkt vom Browser zu Supabase Storage, siehe
// objektDokumenteStorage.ts ladeAlsEigentuemerHoch().
export async function holeObjektUploadUrl(objektId: string, dateiname: string): Promise<{ pfad: string; token: string }> {
  const data = await call({ action: 'public_objekt_upload_url', objektId, dateiname })
  return { pfad: data.pfad, token: data.token }
}

export async function sendePublicObjektFormular(params: {
  objektId: string
  aktivitaetText: string
  eigentuemer?: import('../types').ObjektEigentuemer
  dokument?: import('../types').Dokument
  ordner?: import('../types').DokumentOrdnerName
}): Promise<void> {
  await call({ action: 'public_submit_objekt_formular', ...params })
}

// Stößt die mehrstufige Unternehmensbewertung-Recherche an (siehe email-gateway/index.ts
// fuehreBewertungRechercheAus) — läuft serverseitig im Hintergrund weiter und schreibt Fortschritt/
// Ergebnis direkt in die Kundenzeile; diese Funktion liefert nur die sofortige Start-Bestätigung,
// nicht das Ergebnis selbst (siehe UnternehmensbewertungSection.tsx für das Polling).
export async function starteBewertungRecherche(params: {
  bereich: import('../types').KundeBereich
  kundeId: string
  firma: string
  webseite: string
  anlass: string
  stichtag: string
  vorhandeneZahlen?: Record<string, unknown>
}): Promise<void> {
  await call({ action: 'bewertung_recherche_start', ...params })
}
