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
  /** In welchem Postfach die Mail angekommen ist (leer bei älteren Mails). */
  postfachId?: string
  /** Ordner des Postfachs, aus dem die Mail stammt; leer = Posteingang. */
  ordner?: string
}

// Schickt den eigenen Login mit, sobald es einen gibt (öffentliche Formulare haben keinen): Der Server
// kann damit prüfen, wer fragt — das geteilte Secret steht im ausgelieferten Programm und beweist nichts.
async function call(body: Record<string, unknown>): Promise<any> {
  if (!FUNCTION_URL) throw new Error('E-Mail-Postfach ist noch nicht konfiguriert (VITE_EMAIL_GATEWAY_URL fehlt).')
  const { data: sessionData } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const token = sessionData.session?.access_token
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

// Schickt den eigenen Login mit, wenn es einen gibt — nötig, sobald von einem persönlichen Postfach
// oder aus dem privaten Bereich gesendet wird (das geteilte Secret allein beweist nicht, wer fragt).
async function callMitLogin(body: Record<string, unknown>): Promise<any> {
  if (!FUNCTION_URL) throw new Error('E-Mail-Postfach ist noch nicht konfiguriert (VITE_EMAIL_GATEWAY_URL fehlt).')
  const { data: sessionData } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const token = sessionData.session?.access_token
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(SHARED_SECRET ? { 'x-crm-secret': SHARED_SECRET } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? `Fehler beim Abruf (${res.status})`)
  return data
}

/** `postfachId`: von welchem Postfach gesendet wird (ohne Angabe das gemeinsame Hauptpostfach).
 *  `privat`: aus dem privaten Postfach geschrieben — die Mail bleibt nur für den Absender sichtbar. */
export type SendeOptionen = { postfachId?: string; privat?: boolean }

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string,
  kontext?: SendEmailKundeKontext,
  attachments?: MailAnhang[],
  optionen?: SendeOptionen,
): Promise<void> {
  await callMitLogin({ action: 'send', to, subject, text, html, attachments, ...kontext, ...optionen })
}

// ---------- Postfächer ----------

export type PostfachInfo = {
  id: string
  adresse: string
  anzeigeName: string
  /** Gemeinsames Postfach (für alle) — sonst gehört es einem Mitarbeiter. */
  gemeinsam: boolean
  eigenes: boolean
  besitzer: string | null
  /** Zugang hinterlegt. */
  bereit: boolean
  /** Als Absender nutzbar. Falsch bei Anbietern, die den Versand von unserem Server sperren (z. B. Telekom) — dann nur Empfang. */
  kannSenden: boolean
  /** Eigene Ordner, aus denen Mails abgeholt werden (nur beim eigenen Postfach). */
  ordner?: string[]
  /** Wird regelmäßig abgeholt (persönliche Postfächer). */
  holtAb: boolean
  letzterAbruf: string | null
  letzterFehler: string | null
}

export async function ladePostfaecher(alle = false): Promise<PostfachInfo[]> {
  const data = await callAuthenticated({ action: 'postfaecher_liste', alle })
  return data.postfaecher ?? []
}

export async function verbindePostfach(eingabe: { adresse?: string; passwort: string; gemeinsam?: boolean; anzeigeName?: string }): Promise<{ id: string; adresse: string; nurEmpfang?: boolean }> {
  return callAuthenticated({ action: 'postfach_verbinden', ...eingabe })
}

export async function trennePostfach(postfachId: string): Promise<void> {
  await callAuthenticated({ action: 'postfach_trennen', postfachId })
}

/** Holt neue Mails ab. Je Aufruf nur wenige (Rechenzeit-Grenze des Servers) — liegt noch mehr an,
 *  wird ein paar Mal nachgefasst; den Rest holt ohnehin der Zeitplan alle paar Minuten. */
export async function rufePostfachAb(postfachId: string): Promise<number> {
  let neu = 0
  for (let runde = 0; runde < 4; runde++) {
    const data = await callAuthenticated({ action: 'postfach_abruf', postfachId, sofort: runde > 0 })
    neu += data.neu ?? 0
    if (!data.offen) break
  }
  return neu
}

export async function holeMailInOeffentlich(
  art: 'eingang' | 'gesendet',
  id: string,
  kunde?: { bereich: string; id: string; name: string },
): Promise<void> {
  await callAuthenticated({ action: 'mail_freigeben', art, id, kunde })
}

const ABLAGE_ADRESSE = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''}/storage/v1/object/public/`

/** Dateien aus persönlichen Postfächern ("privat:…") und aus der gemeinsamen Ablage (Mail-Anhänge,
 *  Dateien aus Telegram und dem Assistenten) sind nicht offen abrufbar. Ihre gespeicherte Adresse ist
 *  nur eine Kennung — zum Öffnen braucht es einen kurz gültigen Link, siehe holeAnhangUrl(). */
export function brauchtDateiLink(url: string): boolean {
  return url.startsWith('privat:') || (ABLAGE_ADRESSE.length > 40 && url.startsWith(ABLAGE_ADRESSE))
}

/** Kurz gültiger Link auf eine solche Datei — nur für angemeldete Mitarbeiter. */
export async function holeAnhangUrl(verweis: string): Promise<string> {
  const data = await callAuthenticated({ action: 'mail_anhang_url', verweis })
  return data.url
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

export type ObjektDatenVorschlag = {
  /** Felder, die in den Unterlagen ausdrücklich standen; null, wenn nichts lesbar war. */
  vorschlag: (Record<string, string | number | undefined> & { belege?: string; hinweise?: string }) | null
  gelesen: string[]
  ausgelassen: string[]
  hinweis?: string
}

/** Liest die Unterlagen eines Objekts und schlägt Werte für das Verkaufsdatenblatt vor (dauert bis zu zwei Minuten). */
export async function holeObjektDatenVorschlag(objektId: string): Promise<ObjektDatenVorschlag> {
  return await callAuthenticated({ action: 'objekt_daten_vorschlag', objektId })
}

/** Lässt eine unter „Vorlagen → KI-Anweisungen" hinterlegte Anweisung für ein Objekt ausführen, z. B. ein Exposé schreiben. */
export async function schreibeObjektTextNachAnweisung(
  objektId: string,
  vorlageId: string,
  zusatz = '',
): Promise<{ text: string; fehlendeAngaben: string; anweisung: string; gelesen: string[]; ausgelassen: string[] }> {
  return await callAuthenticated({ action: 'objekt_text_nach_anweisung', objektId, vorlageId, zusatz })
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

// Investoren-Portal: Der Server erzeugt den Anmelde-Link und verschickt ihn selbst. Antwortet immer
// gleich, egal ob die Adresse zu einem Investor gehört.
export async function fordrePortalLinkAn(email: string): Promise<void> {
  await call({ action: 'public_portal_link', email, basis: `${window.location.origin}${window.location.pathname}` })
}

// Setzt das allererste Passwort für eine hinterlegte Mitarbeiter-E-Mail, ganz ohne Mailversand —
// aber nur, solange der Zugang noch nie geöffnet wurde. Wurde er schon einmal geöffnet (z. B. über
// den Einladungs-Link, der anmeldet, ohne ein Passwort zu vergeben), setzt der Server das Passwort
// NICHT, sondern schickt einen Link an das Postfach; dann kommt linkGeschickt zurück.
// Seit 19.11.2026 schickt der Server nur einen Link zum Festlegen des Passworts (nie ein direkt
// gesetztes Passwort) und antwortet immer gleich.
export async function selbstRegistrieren(email: string): Promise<void> {
  await call({ action: 'self_register', email })
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

/** `formular`: Nur das Selbstauskunft-Formular bekommt die gespeicherte Selbstauskunft, nur der
 *  Mandantenfragebogen die Unterlagen-Liste (seit 19.11.2026). */
export async function holePublicKunde(bereich: string, kundeId: string, formular?: 'selbstauskunft' | 'mandantenfragebogen'): Promise<PublicKunde | null> {
  const data = await call({ action: 'public_get_kunde', bereich, kundeId, ...(formular ? { formular } : {}) })
  return data.kunde ?? null
}

/** Prüfzeichen für den Behörden-Versand im Vollmacht-Link (nur angemeldet). */
export async function holeBehoerdenPruefzeichen(kundeId: string, email: string): Promise<string> {
  const data = await call({ action: 'behoerde_link_pruefzeichen', kundeId, email })
  return String(data.sig ?? '')
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
  // `sig`: Prüfzeichen aus dem Link (&sig=…), ohne gültiges Zeichen verschickt der Server nichts.
  behoerde?: { email: string; name?: string; sig?: string; pdfBase64?: string; pdfFilename?: string }
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
  /** Unsichtbares Feld gegen Programme (bleibt bei Menschen leer). */
  webseite?: string
}): Promise<void> {
  await call({ action: 'public_create_lead', ...params })
}

// Öffentliches Eigentümer-Portal (PublicEigentuemerPortal.tsx) — Eigentümer ist beim Ausfüllen
// nicht als Mitarbeiter eingeloggt, die objekte-RLS-Policy lässt sonst weder Lesen noch Schreiben zu.
// Seit 19.11.2026 braucht jede dieser Aktionen das geheime Zeichen des Objekts (`zugang`, steht im Link
// der Eigentümer-Seite). Ohne gültiges Zeichen kommt `{ objekt: null, abgelaufen: true }` zurück.
export type PublicObjekt = {
  bezeichnung: string
  adresse: string
  typ: import('../types').ObjektTyp
  /** Nur die Namen der vorhandenen Unterlagen je Ordner — keine Ablage-Pfade. */
  dokumente: Partial<Record<import('../types').DokumentOrdnerName, { name: string }[]>>
  eigentuemer?: import('../types').ObjektEigentuemer
  /** Die jüngste Anforderung von Unterlagen durch den Mitarbeiter (falls es eine gibt). */
  angefordert?: { datum: string; ordner: import('../types').DokumentOrdnerName[]; weitere?: string }
}

export async function holePublicObjekt(objektId: string, zugang: string): Promise<PublicObjekt | null> {
  const data = await call({ action: 'public_get_objekt', objektId, zugang })
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
export async function holeObjektUploadUrl(objektId: string, zugang: string, dateiname: string): Promise<{ pfad: string; token: string }> {
  const data = await call({ action: 'public_objekt_upload_url', objektId, zugang, dateiname })
  return { pfad: data.pfad, token: data.token }
}

export async function sendePublicObjektFormular(params: {
  objektId: string
  zugang: string
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
  ansprechpartner?: string
  email?: string
  akteWissen?: string
}): Promise<void> {
  await call({ action: 'bewertung_recherche_start', ...params })
}

// Startet die steuerliche Analyse eines Kunden (Unterlagen lesen, Firmen ermitteln, öffentliche
// Abschlüsse und Rechtsstand prüfen, Vorschläge). Läuft auf dem Server weiter; Fortschritt und
// Ergebnis stehen in kunden.steuer_analyse.
export async function starteSteuerAnalyse(params: { bereich: string; kundeId: string; gestartetVon: string }): Promise<void> {
  await call({ action: 'steuer_analyse_start', ...params })
}

// wiederaufnehmen: auch nach einem Fehler ab dem gescheiterten Schritt weitermachen (fertige Schritte
// bleiben erhalten).
export async function setzeSteuerAnalyseFort(params: { bereich: string; kundeId: string; wiederaufnehmen?: boolean }): Promise<void> {
  await call({ action: 'steuer_analyse_schritt', ...params })
}

export type DokumentInhaltInfo = { url: string; status: 'gelesen' | 'laeuft' | 'ungelesen' | 'nicht lesbar' | 'fehler'; zusammenfassung: string; seiten: number | null }

// Welche Dokumente einer Akte sind schon inhaltlich gelesen (mit Kurzfassung)? Mit einlesen=true wird
// das Lesen der übrigen auf dem Server angestoßen (dauert je Dokument bis zu ein paar Minuten).
export async function holeDokumentInhalte(dokumente: { url: string; name: string; typ?: string }[], einlesen = true): Promise<{ dokumente: DokumentInhaltInfo[]; angestossen: number }> {
  if (dokumente.length === 0) return { dokumente: [], angestossen: 0 }
  const data = await call({ action: 'dokument_inhalte', dokumente: dokumente.map((d) => ({ url: d.url, name: d.name, typ: d.typ })), einlesen })
  return { dokumente: data.dokumente ?? [], angestossen: data.angestossen ?? 0 }
}

export type UmfeldFund = { text: string; quelle_url?: string; sicherheit?: 'gesichert' | 'wahrscheinlich' | 'unsicher'; bereits_bekannt?: boolean }

// Öffentliche Internet-Recherche über einen Kunden: weitere Firmen, Funktionen und Beteiligungen der
// Person, Firmengruppe. Liefert Einzelfunde mit Quelle und Angabe, wie sicher die Zuordnung ist.
export async function rechercheKundenUmfeld(params: { person: string; firma: string; email?: string; webseite?: string; bekannt: string }): Promise<{ funde: UmfeldFund[]; rohtext: string }> {
  const data = await call({ action: 'kunden_umfeld_recherche', ...params })
  return { funde: data.funde ?? [], rohtext: data.rohtext ?? '' }
}

// Setzt eine hängen gebliebene Recherche beim nächsten offenen Schritt fort (bereits fertige
// Schritte werden nicht wiederholt).
export async function setzeBewertungRechercheFort(params: { bereich: string; kundeId: string }): Promise<void> {
  await call({ action: 'bewertung_recherche_schritt', ...params })
}

// ---------- Kalender ----------

export type TerminEingabe = {
  id?: string
  titel: string
  beschreibung?: string
  ort?: string
  beginn: string
  ende: string
  ganztags?: boolean
  teilnehmer?: string[]
  kunde?: { id: string; bereich: string; name: string } | null
  trotzUeberschneidung?: boolean
}

/** Der Server meldet, dass jemand in der Zeit schon belegt ist — der Nutzer kann trotzdem buchen. */
export class TerminUeberschneidung extends Error {}

export async function speichereTerminRemote(termin: TerminEingabe): Promise<{ benachrichtigt: string[]; ohneTelegram: string[] }> {
  try {
    const data = await callAuthenticated({ action: 'termin_speichern', termin })
    return { benachrichtigt: data.benachrichtigt ?? [], ohneTelegram: data.ohneTelegram ?? [] }
  } catch (err) {
    if (err instanceof Error && /schon belegt/.test(err.message)) throw new TerminUeberschneidung(err.message)
    throw err
  }
}

export async function loescheTerminRemote(id: string): Promise<'abgesagt' | 'ausgetragen'> {
  const data = await callAuthenticated({ action: 'termin_loeschen', id })
  return data.art
}

// ---------- Bewertung eines Objekts per Knopf (läuft auf dem Server in mehreren Schritten) ----------

/** Startet die Bewertung nach einer hinterlegten KI-Anweisung. Antwortet sofort; der Stand steht danach in `objekte.bewertung`. */
export async function starteObjektBewertung(objektId: string, vorlageId: string, zusatz = '', neuEinlesen = false): Promise<void> {
  await callAuthenticated({ action: 'objekt_bewertung_start', objektId, vorlageId, zusatz, neuEinlesen })
}

/** Stößt eine hängen gebliebene Bewertung ab dem letzten fertigen Schritt wieder an. */
export async function setzeObjektBewertungFort(objektId: string): Promise<void> {
  await callAuthenticated({ action: 'objekt_bewertung_schritt', objektId, wiederaufnehmen: true })
}

/** Entfernt Stand und Ergebnis der Bewertung dieses Objekts. */
export async function verwerfeObjektBewertung(objektId: string): Promise<void> {
  await callAuthenticated({ action: 'objekt_bewertung_verwerfen', objektId })
}

/** Liest den aktuellen Stand der Bewertung direkt aus der Datenbank (für die Fortschrittsanzeige). */
export async function ladeObjektBewertung(objektId: string): Promise<import('../types').ObjektBewertung | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('objekte').select('bewertung').eq('id', objektId).maybeSingle()
  if (error) throw new Error(error.message)
  return ((data as { bewertung?: import('../types').ObjektBewertung | null } | null)?.bewertung ?? null) as import('../types').ObjektBewertung | null
}

// ---------- Kalender-Abo (CRM-Termine in der eigenen Kalender-App) ----------

export type KalenderAbo = { https: string; webcal: string }

/** Persönliche, geheime Abo-Adresse. Legt sie beim ersten Aufruf an; `neu` erzeugt eine frische (die alte wird ungültig). */
export async function holeKalenderAbo(neu = false): Promise<KalenderAbo> {
  const data = await callAuthenticated({ action: 'kalender_abo_link', neu })
  return { https: data.https, webcal: data.webcal }
}

// ---------- Kontoauszüge auswerten (Kundenakte) ----------

/** Liest EINE Datei (Kontoauszug als PDF oder Bild) auf dem Server aus; dauert etwa 40–130 Sekunden.
 *  `datei.url` ist der Verweis aus der Akte (kunde.dokumente[].url) oder der Speicherpfad
 *  `<kundeId>/…` einer eben mit ladeKundenDokumentHoch() abgelegten Datei — alles andere lehnt der
 *  Server ab (403). Kategorien kommen aus den 26 Privatkategorien; für Geschäftskonten setzt die
 *  Oberfläche sie um (siehe kontoauszugAuswertung.ts). `datei.fehler` kann auch bei Erfolg gesetzt sein. */
export async function leseKontoauszug(
  kundeId: string,
  bereich: import('../types').KundeBereich,
  datei: { url: string; name: string; typ?: string },
): Promise<{ buchungen: import('../types').KontoBuchung[]; datei: import('../types').KontoauszugDatei }> {
  const data = await callAuthenticated({ action: 'kontoauszug_auslesen', kundeId, bereich, datei })
  if (data?.error && !data?.ok) throw new Error(String(data.error))
  return {
    buchungen: Array.isArray(data?.buchungen) ? data.buchungen : [],
    datei: data?.datei ?? { name: datei.name, url: datei.url, anzahl: 0 },
  }
}

// ---------- Unterlagen vom Kunden (öffentliche Hochlade-Seite /formular/unterlagen/:token) ----------

/** Was die Hochlade-Seite über die Anforderung erfährt — bewusst nur das (siehe kundenUnterlagen.ts). */
export type PublicUnterlagen = {
  vorname: string | null
  firma: string | null
  punkte: { name: string; erledigt: boolean }[]
  weitere: string | null
}

/** null = Link unbekannt oder abgelaufen. */
export async function holePublicUnterlagen(token: string): Promise<PublicUnterlagen | null> {
  const data = await call({ action: 'public_get_unterlagen', token })
  return (data?.unterlagen ?? null) as PublicUnterlagen | null
}

/** Einmalige Hochlade-Adresse für genau eine Datei in der Akte, die zu `token` gehört. */
export async function holeUnterlagenUploadUrl(token: string, punkt: string, dateiname: string, groesse: number): Promise<{ pfad: string; token: string }> {
  const data = await call({ action: 'public_unterlagen_upload_url', token, punkt, dateiname, groesse })
  return { pfad: data.pfad, token: data.token }
}

/** Lädt die Datei mit der einmaligen Adresse in die geschützte Ablage — ohne Login. */
export async function ladeKundenUnterlageHoch(pfad: string, uploadToken: string, datei: Blob, typ: string): Promise<void> {
  if (!supabase) throw new Error('Die Ablage ist gerade nicht erreichbar.')
  const { error } = await supabase.storage.from('kunden-dokumente').uploadToSignedUrl(pfad, uploadToken, datei, { contentType: typ })
  if (error) throw new Error(error.message)
}

/** Meldet die hochgeladene Datei; der Server prüft sie und legt sie in der Akte ab. */
export async function meldeKundenUnterlage(token: string, punkt: string, dokument: { pfad: string; name: string }): Promise<void> {
  await call({ action: 'public_unterlagen_eingang', token, punkt, dokument })
}

/** Superuser-Auswertungen (nur Mitarbeiter mit ist_superuser; der Server prüft das Login). */
export type SuperuserTeil = 'nutzung' | 'verlauf' | 'zahlen' | 'technik'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeSuperuserAuswertung(teil: SuperuserTeil, zeitraum: 7 | 30 | 90, filter: { person?: string; bereich?: string } = {}): Promise<any> {
  return callAuthenticated({ action: 'superuser_auswertung', teil, zeitraum: String(zeitraum), ...filter })
}
