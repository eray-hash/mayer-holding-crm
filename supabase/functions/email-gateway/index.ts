// Edge Function "email-gateway" — Brücke zwischen dem CRM-Frontend und echten externen Diensten,
// die einen Server-seitigen Schlüssel/Zugangsdaten brauchen. Aktionen über denselben Endpunkt:
//   { action: "sync" }                          -> letzte E-Mails aus dem IONOS-Posteingang lesen
//   { action: "send", to, subject, text, html, kundeBereich?, kundeId?, kundeName?, attachments? }
//                                                -> E-Mail über dasselbe Postfach versenden.
//                                                   attachments: [{ filename, contentBase64? oder
//                                                   url?, contentType? }] — z.B. um ein signiertes
//                                                   Dokument automatisiert an eine Behörde zu
//                                                   schicken (siehe public_submit_formular-Folgen).
//                                                   Bei gesetzter kundeId prüft erkenneRechnungUndLegeAn
//                                                   per KI, ob die Mail eine Rechnung ist, und legt sie
//                                                   bei Treffer direkt in public.rechnungen ab
//   { action: "summarize", transcript }          -> Gesprächstranskript per Claude strukturiert
//                                                    zusammenfassen (Kernthemen/Vereinbarungen/
//                                                    offene Punkte/Stimmung), für die
//                                                    "Gespräch aufzeichnen"-Funktion
//   { action: "assistant_classify", transcript, heute }
//                                                -> freies Diktat als Notiz/Aufgabe/Frage
//                                                   klassifizieren (KI-Assistent, Schritt 1)
//   { action: "assistant_answer", frage, kontext }
//                                                -> Frage zu einem Kunden anhand mitgeschickter
//                                                   CRM-Daten beantworten (KI-Assistent, Schritt 2)
//   { action: "potenzial_analyse", kontext }     -> Cross-Sell-/Upsell-Chancen zu einem Kunden auf
//                                                   Basis mitgeschickter CRM-Daten und allgemeinem
//                                                   Fachwissen zu den Leistungsbereichen der Holding
//                                                   vorschlagen (keine echte Otto-Schmidt-Verlag-
//                                                   Anbindung, da nicht lizenziert)
//   { action: "draft_campaign", ziel }           -> Betreff + Text für eine Segment-/Kampagnen-Mail
//                                                   (z.B. zweiwöchentlicher Newsletter) anhand eines
//                                                   kurz beschriebenen Ziels entwerfen
//   { action: "assistant_vision", frage, image_base64, media_type }
//                                                -> Frage zu einem per Copy/Paste eingefügten Bild
//                                                   beantworten (KI-Assistent, multimodale Eingabe)
//   { action: "invite_mitarbeiter", email }      -> schickt per Supabase Auth Admin API eine
//                                                   Einladungs-Mail (Mitarbeiter setzt sein eigenes
//                                                   Passwort selbst, landet nie bei uns) — braucht
//                                                   den Service-Role-Key, läuft daher nur serverseitig.
//                                                   NUR für eingeloggte Geschäftsführung/Admin
//                                                   (Authorization-Header + pruefeAdminAufrufer), weil
//                                                   das x-crm-secret allein im öffentlichen Frontend-
//                                                   Bundle steckt und daher kein echter Zugriffsschutz ist
//   { action: "update_mitarbeiter_email", mitarbeiterId, neueEmail }
//                                                -> ändert die Login-E-Mail eines Mitarbeiters sowohl
//                                                   im Supabase-Auth-Account als auch in der
//                                                   mitarbeiter-Tabelle (beides muss synchron bleiben,
//                                                   sonst findet der Login-Abgleich den Datensatz
//                                                   nicht mehr) — z.B. um vorübergehend auf eine
//                                                   private Adresse auszuweichen, falls ein
//                                                   amayer-holding.com-Postfach gerade nicht zustellt.
//                                                   NUR für eingeloggte Geschäftsführung/Admin (s.o.)
//   { action: "generate_login_link", email }     -> erzeugt einen Login-/Passwort-setzen-Link ohne
//                                                   selbst eine Mail zu verschicken (Workaround, da
//                                                   Supabases eingebauter Mailversand ratelimitiert
//                                                   und bei manchen Empfängern unzuverlässig ist) —
//                                                   der Link wird direkt zurückgegeben und muss über
//                                                   einen anderen Kanal (Chat, Signal, ...) zugestellt
//                                                   werden. NUR für eingeloggte Geschäftsführung/Admin (s.o.)
//   { action: "request_password_reset", email }  -> Selbstbedienungs-Pendant zu generate_login_link
//                                                   für die Login-Seite ("Passwort vergessen?"):
//                                                   generiert denselben Recovery-Link, verschickt ihn
//                                                   aber selbst über das echte IONOS-SMTP (sendMail,
//                                                   nicht Supabases eigenen unzuverlässigen Mailer) —
//                                                   nur wenn die E-Mail zu einem aktiven Mitarbeiter
//                                                   gehört, sonst passiert nichts. Antwortet immer
//                                                   gleich (kein Hinweis, ob die Adresse existiert),
//                                                   damit sich darüber keine Mitarbeiter-Mailadressen
//                                                   erraten lassen
//   { action: "self_register", email, passwort } -> setzt das allererste Passwort für eine aktive
//                                                   Mitarbeiter-E-Mail, ganz ohne Mailversand — nur
//                                                   erlaubt, wenn für diesen Account noch nie ein
//                                                   erfolgreicher Login stattgefunden hat (sonst
//                                                   könnte jeder mit einer erratbaren Firmen-E-Mail
//                                                   fremde Accounts übernehmen). Für Mitarbeiter mit
//                                                   bestehendem Passwort bleibt "Passwort vergessen"
//                                                   bzw. der admin-geschützte Login-Link der richtige Weg
//   { action: "classify_new_leads" }             -> Nachfolger von scripts/extract-leads.mjs, aber
//                                                   automatisch statt manuell: findet Absender in
//                                                   eingegangene_emails, die weder einem bestehenden
//                                                   Kunden (Tabelle kunden) noch einem bereits
//                                                   vorhandenen Eintrag in vorgeschlagene_leads
//                                                   entsprechen, klassifiziert nur diese NEUEN
//                                                   Absender per KI und legt relevante als Lead an
//   { action: "public_get_kunde", bereich, kundeId }
//                                                -> liest Stammdaten (firma/ansprechpartner/email/
//                                                   selbstauskunft/unterlagenCheckliste) für ein
//                                                   öffentliches Formular (src/pages/formulare/
//                                                   Public*.tsx) — läuft serverseitig mit Service-
//                                                   Role-Key, da der Kunde beim Ausfüllen nicht als
//                                                   Mitarbeiter eingeloggt ist und die kunden-RLS-
//                                                   Policy sonst jeden Zugriff verweigern würde
//   { action: "public_submit_formular", bereich, kundeId, aktivitaetText, aktivitaetUser?,
//     signatur?, selbstauskunft?, unterlagenCheckliste?, behoerde? }
//                                                -> schreibt die Antwort/Unterschrift eines
//                                                   öffentlichen Formulars direkt in die
//                                                   bestehende kunden-Zeile (aus demselben Grund
//                                                   serverseitig statt über das Frontend).
//                                                   behoerde: { email, name? } -> Modul 8: schickt
//                                                   die Signatur automatisch als Anhang an diese
//                                                   Adresse und legt eine Wiedervorlage an (wird
//                                                   beim Versenden des Formular-Links festgelegt,
//                                                   siehe PublicVollmachtBeratung.tsx)
//   { action: "public_create_lead", firma, email, ... , aktivitaetText, signatur? }
//                                                -> legt aus dem öffentlichen Feedbackbogen einen
//                                                   neuen Kunden (Bereich "beratung") an
//   { action: "firmenwissen_answer", frage, kontext }
//                                                -> Firmen-Wissens-KI: beantwortet eine
//                                                   bereichsübergreifende Frage ("Wo liegt das
//                                                   Exposé Musterstraße 17?") auf Basis einer vom
//                                                   Frontend mitgeschickten Zusammenfassung ALLER
//                                                   Kunden/Objekte/Prozesse (siehe
//                                                   src/lib/firmenwissenKontext.ts) — kein
//                                                   Dokumenten-RAG, die Daten sind schon strukturiert
//   { action: "public_get_objekt", objektId }    -> liest Stammdaten (bezeichnung/adresse/typ/
//                                                   dokumente/eigentuemer) für das öffentliche
//                                                   Eigentümer-Formular (PublicEigentuemerPortal.tsx)
//                                                   — serverseitig mit Service-Role-Key, da der
//                                                   Eigentümer nicht als Mitarbeiter eingeloggt ist
//   { action: "public_objekt_upload_url", objektId, dateiname }
//                                                -> erzeugt einen Signed-Upload-Token für den
//                                                   privaten Storage-Bucket "objekt-dokumente" —
//                                                   der eigentliche Datei-Upload läuft danach direkt
//                                                   vom Browser des Eigentümers zu Supabase Storage,
//                                                   nicht über dieses Gateway (Größenlimit!)
//   { action: "public_submit_objekt_formular", objektId, aktivitaetText, eigentuemer?, dokument?, ordner? }
//                                                -> schreibt Eigentümer-Stammdaten und/oder ein
//                                                   bereits hochgeladenes Dokument (Pfad aus
//                                                   public_objekt_upload_url) direkt in die
//                                                   bestehende objekte-Zeile
//   { action: "public_get_vorschlag", vorschlagId }
//                                                -> liest einen Objekt-Vorschlag (Exposé) + die
//                                                   öffentlich relevanten Objekt-Stammdaten für
//                                                   PublicExpose.tsx — serverseitig, da objekte UND
//                                                   objekt_vorschlaege RLS-seitig auf
//                                                   ist_aktiver_mitarbeiter() beschränkt sind und der
//                                                   externe Kunde, der diesen Link anklickt, kein
//                                                   Mitarbeiter-Login hat (echter Fund beim
//                                                   Bugfixing-Durchgang 2026-11-03: das Formular las
//                                                   bis dahin direkt über den normalen, RLS-
//                                                   gebundenen Client und zeigte einem echten
//                                                   anonymen Kunden daher immer "Link ungültig" —
//                                                   unbemerkt, weil es bisher nur eingeloggt getestet
//                                                   wurde)
//   { action: "public_entscheide_vorschlag", vorschlagId, entscheidung }
//                                                -> Annahme/Ablehnung eines Exposés (Gegenstück zu
//                                                   public_get_vorschlag, selber Grund für
//                                                   Service-Role statt Frontend-Dispatch) —
//                                                   entscheidung ist "akzeptiert" oder "abgelehnt";
//                                                   bei Annahme wird das Objekt serverseitig dem
//                                                   Kunden zugewiesen (zugewiesener_kunde) und eine
//                                                   Aktivität angehängt, exakt wie zuvor der
//                                                   ACCEPT_OBJEKT_VORSCHLAG-Reducer es lokal tat
//   { action: "immoradar_top" }                  -> lädt die ~40 MB große listings.json des
//                                                   separaten immobilien-radar-Projekts serverseitig,
//                                                   filtert auf "interessant"/"sehr interessant" und
//                                                   gibt nur die fürs Auswahl-Modal nötigen Felder
//                                                   zurück (Modul 3: Immobilienradar-Integration)
//   { action: "classify_objekt_dokument", datei_base64, media_type, dateiname }
//                                                -> KI-Dokumentenverarbeitung Immobilien: erkennt
//                                                   anhand des Inhalts (Bild oder PDF) die passende
//                                                   Unterlagen-Kategorie (DOKUMENT_ORDNER), schlägt
//                                                   einen Dateinamen vor und liest ggf. ein Datum
//                                                   aus — die eigentliche Zuordnung bestätigt der
//                                                   Mitarbeiter im Frontend
//   { action: "classify_kunden_dokument", datei_base64, media_type, dateiname }
//                                                -> wie classify_objekt_dokument, aber für per
//                                                   Telegram geschickte Kunden-Unterlagen: erkennt
//                                                   Person/Firma + Unterlagenart aus dem Inhalt,
//                                                   damit telegram-gateway auch ohne Bildunterschrift
//                                                   den richtigen Kunden finden kann
//   { action: "split_scan_dokument", datei_base64, dateiname, seitenzahl }
//                                                -> erkennt in einem mehrseitigen Sammel-Scan (z.B.
//                                                   ein ganzer Aktenordner auf einmal gescannt) die
//                                                   einzelnen darin enthaltenen Dokumente mit
//                                                   Seitenbereich/Kategorie/Datum/Dateinamen-
//                                                   Vorschlag — das eigentliche Zerschneiden der PDF
//                                                   und Ablegen passiert im aufrufenden Kanal
//                                                   (telegram-gateway)
//   { action: "pflege_classify", text }          -> Pflege-Modus (KI-Assistent, nur GF/Admin):
//                                                   klassifiziert eine Massenkorrektur-Anweisung
//                                                   ("X ist kein Kunde", "verschiebe X zu Erben",
//                                                   "X und Y sind dieselbe Firma") als
//                                                   verschieben/loeschen/merge — die eigentliche
//                                                   Kundenzuordnung und jede Datenänderung passiert
//                                                   erst nach expliziter Bestätigung im Frontend
//   { action: "bewertung_recherche_start", bereich, kundeId, firma, webseite, anlass, stichtag,
//     vorhandeneZahlen? }                           -> KI-Recherche + Unternehmensbewertung (Modul:
//                                                   Firmenidentifikation → 5 parallele Recherche-
//                                                   Agents (Firmenprofil/Finanzdaten/Markt/Risiken/
//                                                   Zinsen) → Prüf-Agent → finale Bewertungssynthese,
//                                                   jeweils mit Websuche-Tool). Schreibt sofort
//                                                   status "laeuft" in kunden.unternehmensbewertung_
//                                                   recherche und läuft dann per EdgeRuntime.waitUntil
//                                                   im Hintergrund weiter (mehrere Minuten Laufzeit,
//                                                   zu lang für einen einzelnen synchronen Request) —
//                                                   das Frontend pollt den Status selbst direkt per
//                                                   Supabase-Select. Ergänzt den rein deterministischen
//                                                   Unternehmensbewertung-Rechner nur um Vorschläge,
//                                                   ersetzt ihn nicht (Nutzer-Entscheidung 2026-11-06).
//
// Alle Zugangsdaten kommen ausschließlich aus Supabase Function Secrets (nie im Code, nie im
// Frontend). Siehe README-Abschnitt "E-Mail-Postfach-Anbindung" für die Einrichtung.

import { ImapFlow } from 'npm:imapflow@1'
import { simpleParser } from 'npm:mailparser@3'
import nodemailer from 'npm:nodemailer@6'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'

const ALLOWED_ORIGINS = [
  'https://eray-hash.github.io',
  'http://localhost:5173',
  'http://localhost:5174',
]

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'content-type, x-crm-secret, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }
}

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Fehlende Konfiguration: ${name} (Supabase Edge Function Secret nicht gesetzt)`)
  return v
}

// Das geteilte Secret (x-crm-secret) steckt zwangsläufig im öffentlich ausgelieferten
// Frontend-Bundle (VITE_-Variable) und ist damit KEIN echter Zugriffsschutz — jeder, der die Seite
// lädt, kann es auslesen. Für Aktionen, die Account-Zugriff gewähren (Login-Link erzeugen, Mitarbeiter
// einladen, Login-E-Mail ändern), reicht das Secret allein daher nicht: zusätzlich muss der Aufrufer
// per eigenem Supabase-Login nachweisen, dass er eine aktive Geschäftsführung/Admin-Person ist.
async function pruefeAdminAufrufer(
  req: Request,
  admin: ReturnType<typeof createClient>,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'Kein Login-Nachweis mitgeschickt.' }
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user?.email) return { ok: false, status: 401, error: 'Login-Nachweis ungültig.' }
  const { data: mRow } = await admin
    .from('mitarbeiter')
    .select('aktiv, rolle, ist_admin')
    .eq('email', userData.user.email)
    .maybeSingle()
  const berechtigt = !!mRow?.aktiv && (mRow.rolle === 'geschaeftsfuehrung' || mRow.ist_admin)
  if (!berechtigt) return { ok: false, status: 403, error: 'Nur Geschäftsführung/Admin darf das.' }
  return { ok: true }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ])
}

async function syncInbox(limit: number) {
  // Port 993 (implizites TLS) hängt sich in dieser Laufzeitumgebung auf — Port 143 mit STARTTLS
  // (gleiches Muster wie das bereits funktionierende SMTP auf Port 587) ist die verlässliche Wahl.
  const port = Number(Deno.env.get('IMAP_PORT') ?? '143')
  const client = new ImapFlow({
    host: Deno.env.get('IMAP_HOST') ?? 'imap.ionos.de',
    port,
    secure: port === 993,
    auth: { user: env('IMAP_USER'), pass: env('IMAP_PASSWORD') },
    logger: false,
  })

  await withTimeout(client.connect(), 20000, 'IMAP-Verbindung hat nach 20 Sekunden nicht geantwortet (Timeout).')
  const mails: Array<{
    messageId: string
    von: string
    vonName: string
    betreff: string
    datum: string
    ausschnitt: string
  }> = []

  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const status = await client.status('INBOX', { messages: true })
      const total = status.messages ?? 0
      const from = Math.max(1, total - limit + 1)
      if (total === 0) return mails

      for await (const message of client.fetch(`${from}:${total}`, { source: true, envelope: true })) {
        const parsed = await simpleParser(message.source as Buffer)
        const fromAddr = parsed.from?.value?.[0]
        mails.push({
          messageId: parsed.messageId ?? `${message.uid}`,
          von: fromAddr?.address ?? 'unbekannt',
          vonName: fromAddr?.name ?? fromAddr?.address ?? 'Unbekannt',
          betreff: parsed.subject ?? '(ohne Betreff)',
          datum: (parsed.date ?? new Date()).toISOString(),
          ausschnitt: (parsed.text ?? '').trim().slice(0, 400),
        })
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }

  return mails.reverse() // neueste zuerst
}

// Anhänge entweder als Base64 (z.B. eine Signatur-dataUrl ohne das "data:...;base64,"-Präfix) oder
// als URL (z.B. ein bereits in Supabase Storage liegendes Dokument) — nodemailer unterstützt beides
// nativ. Für die Behörden-Automatisierung (signiertes Dokument mitschicken) gebraucht.
type MailAnhang = { filename: string; contentBase64?: string; url?: string; contentType?: string }

async function sendMail(to: string, subject: string, text: string, html?: string, attachments?: MailAnhang[]) {
  const transporter = nodemailer.createTransport({
    host: Deno.env.get('SMTP_HOST') ?? 'smtp.ionos.de',
    port: Number(Deno.env.get('SMTP_PORT') ?? '587'),
    secure: false, // STARTTLS auf Port 587
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASSWORD') },
  })
  await transporter.sendMail({
    from: Deno.env.get('SMTP_USER'),
    to,
    subject,
    text,
    html,
    attachments: (attachments ?? []).map((a) =>
      a.contentBase64
        ? { filename: a.filename, content: a.contentBase64, encoding: 'base64', contentType: a.contentType }
        : { filename: a.filename, path: a.url, contentType: a.contentType },
    ),
  })
}

// Schickt einen Link zum Festlegen des Passworts über das eigene Postfach (nicht über Supabases
// Mailversand, der bei manchen Empfängern nie ankommt). Liefert false, wenn Link oder Versand scheitern.
// deno-lint-ignore no-explicit-any
async function schickePasswortLink(admin: any, email: string): Promise<boolean> {
  const { data, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email })
  if (linkError || !data?.properties?.action_link) {
    console.error('Passwort-Link konnte nicht erzeugt werden:', linkError)
    return false
  }
  try {
    await sendMail(
      email,
      'Mayer Holding CRM — Passwort festlegen',
      `Hallo,\n\nüber den folgenden Link kannst du dein Passwort im Mayer Holding CRM festlegen:\n\n${data.properties.action_link}\n\nNach dem Öffnen wirst du direkt gebeten, ein Passwort einzugeben. Der Link funktioniert nur einmal. Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.`,
    )
    return true
  } catch (mailErr) {
    console.error('Passwort-Link-Mail fehlgeschlagen:', mailErr)
    return false
  }
}

type RechnungsErkennung = {
  ist_rechnung: boolean
  rechnungsnummer: string | null
  betrag_netto: number | null
  betrag_brutto: number | null
  zahlungsziel: string | null
}

// Erkennt per KI, ob eine an einen Kunden gesendete Mail eine Rechnung ist, und legt sie direkt als
// Rechnung im CRM ab (public.rechnungen) — bisher landeten per Mail gestellte Rechnungen nirgends im
// CRM, nur die manuell über "Neue Rechnung" angelegten. Fehlt einer der beiden Beträge, wird er aus
// dem jeweils anderen mit 19% USt. berechnet (gleiche Logik wie im "Neue Rechnung"-Formular).
async function erkenneRechnungUndLegeAn(kundeId: string, betreff: string, text: string): Promise<void> {
  const erkennung = await callClaudeTool<RechnungsErkennung>(
    `Ist die folgende, soeben an einen Kunden versendete E-Mail eine Rechnung (kein Angebot, keine Mahnung, keine allgemeine Korrespondenz)? Falls ja, extrahiere Rechnungsnummer, Netto- und Bruttobetrag (als Zahl ohne Währungssymbol, Dezimaltrennzeichen Punkt) sowie Zahlungsziel (als Datum YYYY-MM-DD), jeweils falls im Text vorhanden, sonst null.\n\nBetreff: ${betreff}\n\n${text.slice(0, 3000)}`,
    {
      name: 'rechnung_erkennen',
      description: 'Erkennt, ob eine E-Mail eine Rechnung ist, und extrahiert deren Eckdaten.',
      input_schema: {
        type: 'object',
        properties: {
          ist_rechnung: { type: 'boolean' },
          rechnungsnummer: { type: ['string', 'null'] },
          betrag_netto: { type: ['number', 'null'] },
          betrag_brutto: { type: ['number', 'null'] },
          zahlungsziel: { type: ['string', 'null'] },
        },
        required: ['ist_rechnung', 'rechnungsnummer', 'betrag_netto', 'betrag_brutto', 'zahlungsziel'],
      },
    },
    512,
  )
  if (!erkennung.ist_rechnung) return
  const betragNetto = erkennung.betrag_netto ?? (erkennung.betrag_brutto ? erkennung.betrag_brutto / 1.19 : null)
  const betragBrutto = erkennung.betrag_brutto ?? (erkennung.betrag_netto ? erkennung.betrag_netto * 1.19 : null)
  if (betragNetto == null || betragBrutto == null) return // ohne jeden Betrag kein sinnvoller Rechnungs-Datensatz

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const heute = new Date().toISOString().slice(0, 10)
  await admin.from('rechnungen').insert({
    id: crypto.randomUUID(),
    nummer: erkennung.rechnungsnummer || `RE-${heute.slice(0, 4)}-${Math.floor(1000 + Math.random() * 8999)}`,
    kunde_id: kundeId,
    datum: heute,
    betrag_netto: Math.round(betragNetto * 100) / 100,
    betrag_brutto: Math.round(betragBrutto * 100) / 100,
    status: 'Versendet',
    zahlungsziel: erkennung.zahlungsziel || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  })
}

type Zusammenfassung = {
  kernthemen: string[]
  vereinbarungen: string[]
  offene_punkte: string[]
  stimmung: string
  zusammenfassung: string
}

async function summarizeTranscript(transcript: string): Promise<Zusammenfassung> {
  const apiKey = env('ANTHROPIC_API_KEY')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [
        {
          name: 'gespraechs_zusammenfassung',
          description: 'Strukturierte Zusammenfassung eines Beratungsgesprächs auf Deutsch.',
          input_schema: {
            type: 'object',
            properties: {
              kernthemen: { type: 'array', items: { type: 'string' }, description: 'Die wichtigsten besprochenen Themen, kurz und stichpunktartig.' },
              vereinbarungen: { type: 'array', items: { type: 'string' }, description: 'Was konkret vereinbart wurde.' },
              offene_punkte: { type: 'array', items: { type: 'string' }, description: 'Offene Fragen oder vereinbarte nächste Schritte.' },
              stimmung: { type: 'string', description: 'Kurze Einschätzung der Gesprächsstimmung in ein bis zwei Worten, z. B. "positiv", "angespannt", "neutral".' },
              zusammenfassung: { type: 'string', description: 'Ein kurzer Fließtext-Absatz (2-4 Sätze), der das Gespräch zusammenfasst.' },
            },
            required: ['kernthemen', 'vereinbarungen', 'offene_punkte', 'stimmung', 'zusammenfassung'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'gespraechs_zusammenfassung' },
      messages: [
        {
          role: 'user',
          content: `Fasse folgendes Transkript eines Beratungsgesprächs strukturiert zusammen. Antworte ausschließlich auf Deutsch.\n\nTranskript:\n${transcript}`,
        },
      ],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Anthropic-API-Fehler (${res.status}): ${detail.slice(0, 300)}`)
  }
  const data = await res.json()
  const toolUse = data.content?.find((c: { type: string }) => c.type === 'tool_use')
  if (!toolUse) throw new Error('Keine strukturierte Antwort von der Anthropic-API erhalten.')
  return toolUse.input as Zusammenfassung
}

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }

// Gemeinsamer Aufruf für die KI-Assistent-Aktionen unten — erzwingt per tool_choice eine
// strukturierte Antwort im gegebenen Schema, statt Freitext parsen zu müssen. `prompt` kann ein
// reiner Text sein oder (für multimodale Eingaben, siehe assistant_vision) ein Array aus
// Text-/Bild-Content-Blöcken.
async function callClaudeTool<T>(
  prompt: string | ClaudeContentBlock[],
  tool: { name: string; description: string; input_schema: Record<string, unknown> },
  maxTokens = 1024,
  model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-5-5' = 'claude-haiku-4-5-20251001',
  // Manche Modelle/Anfragen (siehe echter Fund: Sonnet bei einem langen, mehrseitigen PDF-Dokument-
  // Block) lehnen ein erzwungenes tool_choice mit "tool_choice: type \"tool\" ... not supported for
  // this model" ab — dann hilft nur "auto" (das Modell antwortet dann zwar frei, ruft das Tool aber
  // i.d.R. trotzdem auf, da es das einzig sinnvolle Werkzeug ist).
  toolChoice: 'tool' | 'auto' = 'tool',
): Promise<T> {
  const apiKey = env('ANTHROPIC_API_KEY')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: toolChoice === 'tool' ? { type: 'tool', name: tool.name } : { type: 'auto' },
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Anthropic-API-Fehler (${res.status}): ${detail.slice(0, 300)}`)
  }
  const data = await res.json()
  const toolUse = data.content?.find((c: { type: string }) => c.type === 'tool_use')
  if (!toolUse) throw new Error('Keine strukturierte Antwort von der Anthropic-API erhalten.')
  return toolUse.input as T
}

// Für die Unternehmensbewertung-Recherche (bewertung_recherche_start): anders als callClaudeTool
// erzwingt dies KEINE sofortige Tool-Antwort, da das Modell erst frei im Web recherchieren und erst
// danach in Fließtext antworten soll. Das serverseitige Websuche-Tool braucht dafür tool_choice
// "auto" (Default) statt eines erzwungenen eigenen Tools — beides zusammen unterstützt die
// Anthropic-API nicht zuverlässig. Gibt den reinen Antworttext (alle text-Blöcke konkateniert)
// zurück; etwaige Quellenangaben/strukturierte Zahlen bittet der jeweilige Prompt selbst als Teil
// des Fließtexts aus (siehe z.B. abschließender ```json-Block der Bewertungssynthese).
async function callClaudeResearch(
  prompt: string | ClaudeContentBlock[],
  opts: { model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-5-5'; maxSearches: number; maxTokens?: number; timeoutMs?: number; ohneNachdenken?: boolean },
): Promise<string> {
  const apiKey = env('ANTHROPIC_API_KEY')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    // Eigenes Zeitlimit, damit ein zu langer Aufruf als Fehler zurückkommt (und wiederholt werden
    // kann), statt dass die Plattform den ganzen Worker kommentarlos beendet.
    ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      // Sonnet denkt von sich aus vor der Antwort nach, und das zählt gegen max_tokens. Bei langen,
      // strukturierten Antworten war das Kontingent schon fürs Nachdenken verbraucht — es kam gar kein
      // Text zurück (stop_reason max_tokens). Damit steht das ganze Kontingent der Antwort zur Verfügung.
      ...(opts.ohneNachdenken ? { thinking: { type: 'between_tools' } } : {}),
      ...(opts.maxSearches > 0
        ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: opts.maxSearches }] }
        : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Anthropic-API-Fehler (${res.status}): ${detail.slice(0, 300)}`)
  }
  const data = await res.json()
  const text = (data.content ?? [])
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text: string }) => c.text)
    .join('\n\n')
  if (!text.trim()) {
    // stop_reason "max_tokens" heißt meist: zu viele Websuchen haben das Antwort-Token-Budget
    // aufgebraucht, bevor überhaupt Text geschrieben wurde — dann hilft nur ein höheres maxTokens.
    throw new Error(`Keine Textantwort von der Anthropic-API erhalten (stop_reason: ${data.stop_reason ?? 'unbekannt'}).`)
  }
  return text
}

type AssistentKlassifikation = {
  typ: 'notiz' | 'aufgabe' | 'frage' | 'aufnahme'
  erkannter_name?: string
  titel?: string
  faelligkeitsdatum?: string
  frage?: string
}

// Erster Schritt des KI-Assistenten: erkennt aus freiem Diktat/Text, ob es sich um eine reine
// Notiz, eine konkrete Aufgabe (z.B. "Kunde X kontaktieren") oder eine Frage zu einem Kunden
// handelt, und extrahiert dabei einen eventuell genannten Namen sowie ein relatives Datum
// ("nächste Woche" -> konkretes Datum). Die eigentliche Kundenzuordnung passiert im Frontend per
// Textabgleich gegen die echten Kundendaten — die KI kennt die Kundenliste nicht.
async function classifyAssistantInput(transcript: string, heute: string): Promise<AssistentKlassifikation> {
  return callClaudeTool<AssistentKlassifikation>(
    `Du hilfst einem Mitarbeiter einer Unternehmensberatungs-/Immobilien-/Finanzierungsholding, ein kurzes gesprochenes oder getipptes Diktat einzuordnen. Heutiges Datum: ${heute}.

Klassifiziere den folgenden Text als genau einen von sechs Typen:
- "aufnahme": eine Bitte, ein gerade stattfindendes oder jetzt beginnendes Gespräch/Telefonat/Meeting mit einem Kunden aufzuzeichnen, z. B. "ich habe jetzt ein Gespräch mit X, nimm es auf" oder "zeichne das Meeting mit Y auf".
- "aufgabe": eine konkrete Handlungsaufforderung an sich selbst, z. B. "Kunde X anrufen", "bei Y Unterlagen anfordern", "Z noch erledigen".
- "frage": eine Frage zu einem bestehenden, namentlich genannten Kunden/Mandanten, z. B. "was wurde beim letzten Termin mit X besprochen", "wie ist der Stand bei Y".
- "uebersicht": eine allgemeine Frage nach dem eigenen Tagesgeschäft/Status OHNE Bezug auf einen bestimmten, namentlich genannten Kunden, z. B. "was muss ich heute machen", "was steht an", "wie ist mein Stand", "habe ich noch offene Aufgaben".
- "aktion_lead_anlegen": eine Bitte, einen NEUEN Lead/Kunden/Mandanten im CRM anzulegen, z. B. "leg einen Lead an bei Erben", "neuen Testkunden bei Beratung anlegen für Firma X".
- "aktion_lead_loeschen": eine Bitte, einen BESTEHENDEN Lead/Kunden/Mandanten wieder zu LÖSCHEN/entfernen, z. B. "lösch den Lead Testfirma wieder", "entferne den Kunden X".
- "notiz": alles andere, ein allgemeiner Gedanke oder eine Beobachtung ohne konkrete Handlung oder Frage.

Extrahiere zusätzlich, falls vorhanden:
- erkannter_name: der Name einer Person oder Firma, die im Text erwähnt wird (nur der Name, keine Anrede/Titel).
- titel: bei "aufgabe" oder "notiz" ein kurzer, prägnanter Titel (max. ca. 80 Zeichen) für die Aufgabe/Notiz.
- faelligkeitsdatum: falls ein relatives oder konkretes Datum erwähnt wird (z. B. "nächste Woche", "morgen", "Freitag"), berechne daraus das konkrete Datum im Format YYYY-MM-DD ausgehend vom heutigen Datum. Sonst weglassen.
- frage: bei "frage" die Frage selbst, neutral und vollständig formuliert.
- aktion_bereich: bei "aktion_lead_anlegen", falls erkennbar, einer von: beratung, erben, betriebsuebergabe, betriebsformen, akademie, finanzierungen (sonst weglassen).
- aktion_firma: bei "aktion_lead_anlegen", falls ein Firmen-/Kundenname genannt wird (sonst weglassen).

Text:
"""${transcript}"""`,
    {
      name: 'ki_assistent_klassifikation',
      description: 'Klassifiziert ein Diktat als Notiz, Aufgabe, Frage, Übersicht oder Aktion und extrahiert relevante Felder.',
      input_schema: {
        type: 'object',
        properties: {
          typ: { type: 'string', enum: ['notiz', 'aufgabe', 'frage', 'aufnahme', 'uebersicht', 'aktion_lead_anlegen', 'aktion_lead_loeschen'] },
          erkannter_name: { type: 'string' },
          titel: { type: 'string' },
          faelligkeitsdatum: { type: 'string' },
          frage: { type: 'string' },
          aktion_bereich: { type: 'string', enum: ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen'] },
          aktion_firma: { type: 'string' },
        },
        required: ['typ'],
      },
    },
  )
}

const PFLEGE_BEREICHE = ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']

type PflegeKlassifikation = {
  aktion: 'verschieben' | 'loeschen' | 'merge' | 'unklar'
  kunde_name?: string
  kunde_name_2?: string
  ziel_bereich?: string
}

// Pflege-Modus (nur Geschäftsführung/Admin, siehe KiAssistentPanel.tsx): klassifiziert eine
// gesprochene/getippte Massenkorrektur-Anweisung. Die KI kennt die echten Kundendaten nicht (genau
// wie bei classifyAssistantInput) — sie extrahiert nur Namen/Zielbereich, die eigentliche Zuordnung
// zu einem echten Kunden-Datensatz und jede Schreiboperation passiert ausschließlich im Frontend,
// erst nachdem der Mitarbeiter den konkreten Vorschlag bestätigt hat.
async function classifyPflegeInput(text: string): Promise<PflegeKlassifikation> {
  return callClaudeTool<PflegeKlassifikation>(
    `Du hilfst einer Geschäftsführung/einem Admin, eine Pflege-/Korrekturanweisung für ein CRM einzuordnen (Pflege-Modus: nachträgliche Korrekturen an bestehenden Kunden-/Mandanten-Datensätzen per Sprache/Text).

Klassifiziere die folgende Anweisung als genau eine von vier Aktionen:
- "verschieben": ein bestehender Kunde/Mandant soll einem anderen Geschäftsbereich zugeordnet werden, z. B. "verschiebe Kunde X zu Erben" oder "X gehört eigentlich zu Betriebsübergabe, nicht zu Beratung".
- "loeschen": ein bestehender Datensatz ist fälschlich als Kunde angelegt und soll entfernt werden, z. B. "X ist kein Kunde, das ist ein Mitarbeiter" oder "lösche den Datensatz von Y, der ist doppelt/falsch".
- "merge": zwei bestehende Datensätze sind Duplikate desselben Kunden und sollen zu einem zusammengeführt werden, z. B. "X und Y sind derselbe Kunde, führe die zusammen".
- "unklar": die Anweisung passt zu keiner der drei Aktionen oder ist zu vage, um sie umzusetzen.

Extrahiere zusätzlich, falls vorhanden:
- kunde_name: der Name des betroffenen Kunden/Mandanten/Datensatzes (bei allen drei Aktionen nötig).
- kunde_name_2: NUR bei "merge" — der Name des zweiten Datensatzes, der mit dem ersten zusammengeführt (und danach entfernt) werden soll.
- ziel_bereich: NUR bei "verschieben" — der Ziel-Geschäftsbereich, exakt einer von: ${PFLEGE_BEREICHE.join(', ')}.

Anweisung:
"""${text}"""`,
    {
      name: 'pflege_klassifikation',
      description: 'Klassifiziert eine Pflege-Modus-Anweisung (Kunde verschieben/löschen/zusammenführen) und extrahiert die genannten Namen/Zielbereich.',
      input_schema: {
        type: 'object',
        properties: {
          aktion: { type: 'string', enum: ['verschieben', 'loeschen', 'merge', 'unklar'] },
          kunde_name: { type: 'string' },
          kunde_name_2: { type: 'string' },
          ziel_bereich: { type: 'string', enum: PFLEGE_BEREICHE },
        },
        required: ['aktion'],
      },
    },
  )
}

// Zweiter Schritt (nur bei typ="frage"): beantwortet die Frage ausschließlich auf Basis des vom
// Frontend mitgeschickten Kunden-Kontexts (Protokolle, Aktivitäten, Status, Follow-up) — die
// Function selbst hat keinen Datenbankzugriff auf die CRM-Daten, die leben nur im Browser.
async function answerAssistantQuestion(frage: string, kontext: string): Promise<{ antwort: string }> {
  const result = await callClaudeTool<{ antwort: string }>(
    `Beantworte die folgende Frage eines Mitarbeiters ausschließlich auf Basis der gegebenen CRM-Daten zu einem Kunden/Mandanten. Antworte auf Deutsch, knapp und konkret, als reiner Fließtext ohne jegliche Tags oder Markup (die Antwort wird oft vorgelesen, also keine Aufzählungszeichen/Formatierung, sondern gesprochene Sätze). Wenn die Daten die Frage nicht beantworten können, sage das ehrlich statt zu spekulieren.

Wenn es inhaltlich wirklich passt (z. B. ein offener Punkt aus dem letzten Gespräch, ein fehlendes Dokument, ein überfälliger Follow-up), schlage am Ende EINEN konkreten nächsten Schritt proaktiv vor (z. B. "Soll ich ihn auf Wiedervorlage legen?") — aber nur wenn es wirklich angebracht ist, nicht bei jeder Antwort erzwingen.

CRM-Daten zum Kunden:
"""${kontext}"""

Frage: ${frage}`,
    {
      name: 'ki_assistent_antwort',
      description: 'Beantwortet eine Frage zu einem Kunden basierend auf gegebenen CRM-Daten.',
      input_schema: {
        type: 'object',
        properties: { antwort: { type: 'string' } },
        required: ['antwort'],
      },
    },
  )
  // Verteidigt gegen gelegentliche Reste von Pseudo-XML/Tool-Syntax, die das Modell manchmal ans
  // Ende des Strings anhängt (z. B. "</antwort> </invoke>") statt sie sauber im tool_use zu lassen.
  return { antwort: result.antwort.replace(/<\/?[a-zA-Z_][^>]*>/g, '').trim() }
}

// Firmen-Wissens-KI (Quirin Lutzenberger: "Eigene Firmen-KI, greift ausschließlich auf eure
// freigegebenen Unternehmensdaten zu") — anders als answerAssistantQuestion oben (ein Kunde) bezieht
// sich kontext hier auf eine Zusammenfassung ALLER Kunden/Objekte/Prozesse (siehe
// firmenwissenKontext.ts), damit bereichsübergreifende Fragen wie "Welche Objekte haben seit 30
// Tagen keinen Kundenkontakt?" beantwortbar sind.
async function answerFirmenwissen(frage: string, kontext: string): Promise<{ antwort: string }> {
  const result = await callClaudeTool<{ antwort: string }>(
    `Du bist die interne Firmen-Wissens-KI der Andreas Mayer Holding. Beantworte die folgende Frage eines Mitarbeiters ausschließlich auf Basis der unten gegebenen Unternehmensdaten (eine Momentaufnahme). Antworte auf Deutsch, klar und konkret. Wenn mehrere Datensätze zur Frage passen, liste sie auf. Wenn sich die Frage aus den Daten nicht beantworten lässt, sage das ehrlich, statt zu spekulieren oder etwas zu erfinden.

Unternehmensdaten:
"""${kontext}"""

Frage: ${frage}`,
    {
      name: 'firmenwissen_antwort',
      description: 'Beantwortet eine bereichsübergreifende Frage zu den Unternehmensdaten.',
      input_schema: {
        type: 'object',
        properties: { antwort: { type: 'string' } },
        required: ['antwort'],
      },
    },
    1536,
  )
  return { antwort: result.antwort.replace(/<\/?[a-zA-Z_][^>]*>/g, '').trim() }
}

// Automatisches 1-Seiten-Exposé (Whitelabel) direkt bei Anlage einer neuen Immobilie — matcht die
// in Erays privater ToDo-Liste notierte Anforderung ("ein 1 Seiten Expose soll es automatisch
// erstellt als Whitelabel"). Nur die vier bei Objektanlage bekannten Stammdaten als Grundlage, kein
// Erfinden von Details, die nicht gegeben sind.
async function generiereExpose(bezeichnung: string, adresse: string, typ: string, kaufpreis: number): Promise<{ expose_text: string }> {
  return callClaudeTool<{ expose_text: string }>(
    `Erstelle einen professionellen, werblichen aber sachlichen Exposé-Text (ca. 150-250 Wörter, Fließtext auf Deutsch, Whitelabel ohne Firmennamen) für folgende Immobilie. Erfinde keine Ausstattungsmerkmale, Baujahr, Wohnfläche o.Ä., die nicht gegeben sind — bleibe bei den gegebenen Eckdaten und allgemein gehaltenen, aber ansprechenden Formulierungen.

Bezeichnung: ${bezeichnung}
Adresse: ${adresse}
Objekttyp: ${typ}
Kaufpreis: ${kaufpreis} €`,
    {
      name: 'expose_text',
      description: 'Erstellt den Fließtext für ein Immobilien-Exposé.',
      input_schema: {
        type: 'object',
        properties: { expose_text: { type: 'string' } },
        required: ['expose_text'],
      },
    },
    800,
  )
}

type PotenzialChance = {
  bereich: string
  titel: string
  begruendung: string
  naechster_schritt: string
  prioritaet: 'Hoch' | 'Mittel' | 'Niedrig'
  quellen?: string[]
  annahmen?: string
}

// Beschreibung der sieben Leistungsbereiche der Holding als Wissensgrundlage für die
// Potenzialanalyse — ersetzt die ursprünglich angefragte, aber nicht lizenzierte Anbindung an den
// Otto Schmidt Verlag; die KI arbeitet stattdessen mit ihrem allgemeinen Fachwissen zu Steuer-,
// Nachfolge- und Finanzierungsthemen (siehe Projektnotiz "mach es mit allgemeinem Wissen").
const LEISTUNGSBEREICHE = `- beratung (Unternehmensberatung): strategische und betriebswirtschaftliche Beratung für Unternehmen.
- immobilien (Immobilien): Vermittlung, Bewertung und Verwaltung von Wohn- und Gewerbeimmobilien, auch zur Vermögensanlage oder im Rahmen einer Nachfolge.
- erben (Erben): Nachlassplanung, Optimierung der Erbschaftsteuer, Testamentsgestaltung, Übergabe von Vermögen an die nächste Generation.
- betriebsuebergabe (Betriebsübergabe): Planung und Begleitung der Unternehmensnachfolge (familienintern oder extern), Bewertung, steuerliche Gestaltung.
- betriebsformen (Betriebsformen): Prüfung und Optimierung der Rechtsform eines Unternehmens (z. B. GmbH, GmbH & Co. KG, Holding-Struktur) aus steuerlicher und haftungsrechtlicher Sicht.
- akademie (Akademie): Schulungen und Weiterbildungen für Unternehmer und Führungskräfte.
- finanzierungen (Finanzierungen): Beschaffung und Strukturierung von Finanzierungen (Bankkredite, Fördermittel, Investoren) für Unternehmen oder Immobilienvorhaben.`

// Analysiert die CRM-Daten eines bestehenden Kunden/Mandanten und schlägt plausible Cross-Sell-/
// Upsell-Chancen in den anderen Leistungsbereichen der Holding vor. Rein auf Basis des
// mitgeschickten Kontexts und allgemeinen Fachwissens, keine externe Datenquelle.
async function analysePotenzial(kontext: string): Promise<{ chancen: PotenzialChance[] }> {
  return callClaudeTool<{ chancen: PotenzialChance[] }>(
    `Du bist ein erfahrener Berater einer Beratungsholding mit mehreren Geschäftsbereichen. Analysiere die folgenden CRM-Daten zu einem bestehenden Kunden/Mandanten und identifiziere realistische Cross-Sell- oder Upsell-Chancen — zusätzliche Leistungen der Holding, die für diesen Kunden aufgrund seiner Situation, Branche, Gesprächshistorie und seines Status sinnvoll sein könnten. Nutze dafür dein allgemeines Fachwissen zu Steueroptimierung, Unternehmensnachfolge, Vermögensplanung und Finanzierung — du hast keinen Zugriff auf externe Datenbanken oder Fachverlage.

Geschäftsbereiche der Holding:
${LEISTUNGSBEREICHE}

CRM-Daten zum Kunden:
"""${kontext}"""

Gib maximal drei konkrete, plausible Chancen zurück, sortiert nach Priorität (höchste zuerst). Schlage keine Chance im selben Bereich vor, in dem der Kunde ohnehin schon aktiv betreut wird, außer es gibt eine klar erkennbare zusätzliche Leistung. Jede Chance braucht: den passenden Bereich (exakt eine der sieben Bereichs-IDs oben, z. B. "erben"), einen kurzen prägnanten Titel, eine nachvollziehbare Begründung basierend auf den CRM-Daten (zwei bis drei Sätze, auf Deutsch, in einfacher und klarer Sprache ohne Anglizismen oder Fachjargon), einen konkreten nächsten Schritt, und eine Priorität (Hoch/Mittel/Niedrig). Wenn aus den Daten keine plausible Chance erkennbar ist, gib eine leere Liste zurück statt zu spekulieren.

Nachvollziehbarkeit: Jeder Eintrag der CRM-Daten trägt eine Kennung in eckigen Klammern (z. B. [S1], [A3], [D2], [P1], [R1]). Nenne zu jeder Chance unter quellen genau die Kennungen, auf die sich deine Begründung tatsächlich stützt — keine, die du nicht verwendet hast. Zu Dokumenten liegt dir der Dateiname vor und — wo angegeben — eine Kurzfassung des Inhalts; steht dort "Inhalt lag nicht vor", kennst du nur den Namen: stütze dich nie auf vermuteten Inhalt. Einträge mit der Kennung [W…] stammen aus einer öffentlichen Internet-Recherche über den Kunden (weitere Firmen, Funktionen, Beteiligungen) und tragen eine Angabe zur Sicherheit; nutze sie ausdrücklich für deine Vorschläge, behandle "unsicher" gekennzeichnete Funde aber als zu prüfende Vermutung. Benenne unter annahmen in ein bis zwei Sätzen ehrlich, was du nur vermutest oder aus einem Dateinamen bzw. einer kurzen Notiz geschlossen hast und was vor einem Gespräch mit dem Kunden geprüft werden sollte.`,
    {
      name: 'potenzial_analyse',
      description: 'Schlägt Cross-Sell-/Upsell-Chancen für einen Kunden in den Leistungsbereichen der Holding vor.',
      input_schema: {
        type: 'object',
        properties: {
          chancen: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                bereich: { type: 'string', enum: ['beratung', 'immobilien', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen'] },
                titel: { type: 'string' },
                begruendung: { type: 'string' },
                naechster_schritt: { type: 'string' },
                prioritaet: { type: 'string', enum: ['Hoch', 'Mittel', 'Niedrig'] },
                quellen: { type: 'array', items: { type: 'string' }, description: 'Kennungen der CRM-Einträge, auf die sich die Begründung stützt, z. B. ["A2", "D1"].' },
                annahmen: { type: 'string', description: 'Was hier nur vermutet oder geschlossen wurde und noch zu prüfen ist.' },
              },
              required: ['bereich', 'titel', 'begruendung', 'naechster_schritt', 'prioritaet', 'quellen', 'annahmen'],
            },
          },
        },
        required: ['chancen'],
      },
    },
    2048,
  )
}

// Auftrag "Was wissen wir noch NICHT über diesen Kunden?" — sucht öffentlich nach weiteren Firmen,
// Funktionen und Beteiligungen der handelnden Person(en) und nach der Firmengruppe. Wird sowohl von
// der Unternehmensbewertung (als sechster Recherche-Agent) als auch von der Potenzial-Analyse genutzt.
// Nutzerwunsch vom 12.11.2026: Eine Analyse soll mehr herausfinden, als schon in der Akte steht —
// "hat er evtl. sogar mehr Firmen, als wir momentan wissen".
function umfeldAuftrag(k: { person: string; firma: string; email?: string; webseite?: string; bekannt: string }): string {
  return `Du recherchierst für eine Beratungsholding öffentlich zugängliche Geschäftsinformationen über einen Kunden. Ziel: herausfinden, was über das hinausgeht, was schon in der Kundenakte steht.

Kunde laut Akte:
- Person: ${k.person || '(nicht angegeben)'}
- Firma/Bezeichnung in der Akte: ${k.firma || '(nicht angegeben)'}
- E-Mail: ${k.email || '(nicht angegeben)'}
- Webseite: ${k.webseite || '(nicht angegeben)'}

Bereits bekannt laut Akte (Auszug aus Notizen und Dateinamen):
${k.bekannt || '(nichts weiter)'}

Finde vor allem heraus:
1. An welchen WEITEREN Firmen ist die Person als Geschäftsführer, Inhaber, Gesellschafter, Prokurist, Vorstand oder Aufsichtsrat beteiligt — aktuell und früher?
2. Welche Firmen gehören zur selben Gruppe (Mutter-, Tochter-, Schwester- und Beteiligungsgesellschaften, Holding)?
3. Zu jeder gefundenen Firma: Rechtsform, Sitz, Registergericht und Registernummer, Unternehmensgegenstand/Branche, Gründungsjahr, veröffentlichte Größenangaben (Bilanzsumme, Mitarbeiter), Status (aktiv, in Liquidation, gelöscht, Insolvenz).
4. Auffälliges: Insolvenz- oder Löschungsbekanntmachungen, Wechsel in Geschäftsführung oder Gesellschafterkreis, Sitzverlegungen.

Suche gezielt in öffentlichen Handelsregister-Auskünften und Firmenverzeichnissen (z. B. northdata.de, unternehmensregister.de, handelsregister.de, bundesanzeiger.de, firmenwissen.de, implisense.com, companyhouse.de), im Impressum der Firmenwebseiten und in der Wirtschaftspresse. Suche sowohl nach dem Namen der Person als auch nach jeder Firma, die dabei auftaucht.

Namensgleichheit: Viele Namen gibt es mehrfach. Prüfe bei jedem Fund anhand von Ort, Branche, bekannten Firmen und Mitgeschäftsführern, ob es wirklich dieselbe Person ist, und gib an, wie sicher die Zuordnung ist (gesichert / wahrscheinlich / unsicher). Lieber einen unsicheren Fund als unsicher kennzeichnen als ihn weglassen oder als sicher ausgeben.

Grenzen: nur öffentliche Geschäftsdaten. Keine privaten Daten (Wohnanschrift, Familie, Gesundheit, Vermögen außerhalb veröffentlichter Firmendaten). Erfinde nichts; was du nicht gefunden hast, gibt es in deiner Antwort nicht. Jede Angabe braucht die Quelle (URL).`
}

type UmfeldFund = { text: string; quelle_url?: string; sicherheit?: 'gesichert' | 'wahrscheinlich' | 'unsicher'; bereits_bekannt?: boolean }

// Eigenständige Umfeld-Recherche für die Potenzial-Analyse: liefert die Funde strukturiert, damit die
// Oberfläche sie einzeln mit Quelle zeigen und als Beleg verwenden kann.
async function rechercheKundenUmfeld(k: { person: string; firma: string; email?: string; webseite?: string; bekannt: string }): Promise<{ funde: UmfeldFund[]; rohtext: string }> {
  // Innerhalb der garantierten Restlaufzeit dieses Workers bleiben (siehe WORKER_LEBENSDAUER_MS).
  const rest = WORKER_LEBENSDAUER_MS - (Date.now() - WORKER_GEBOOTET)
  const text = await callClaudeResearch(
    `${umfeldAuftrag(k)}

Antworte auf Deutsch. Gib GANZ AM ENDE einen einzelnen Codeblock mit reinem JSON zurück (danach nichts mehr) — eine Liste deiner Funde, jeder Fund ein eigenständiger, vollständiger Satz:
\`\`\`json
[{"text": "…", "quelle_url": "https://…", "sicherheit": "gesichert", "bereits_bekannt": false}]
\`\`\`
"bereits_bekannt" ist true, wenn der Fund schon aus der Akte hervorgeht, sonst false. Findest du nichts Belastbares, gib eine leere Liste zurück.`,
    { model: 'claude-haiku-4-5-20251001', maxSearches: 8, maxTokens: 4096, timeoutMs: Math.max(20_000, Math.min(70_000, rest - 8_000)) },
  )
  const m = text.match(/```json\s*([\s\S]*?)```/)
  let funde: UmfeldFund[] = []
  if (m) {
    try {
      const roh = JSON.parse(m[1])
      // deno-lint-ignore no-explicit-any
      if (Array.isArray(roh)) funde = roh.filter((f: any) => typeof f?.text === 'string' && f.text.trim()).slice(0, 25)
    } catch {
      funde = []
    }
  }
  return { funde, rohtext: text.replace(/```json[\s\S]*?```/, '').trim() }
}

// Unternehmensbewertung-Recherche: Firmenidentifikation → 5 parallele Recherche-Agents → Prüf-Agent
// → Bewertungssynthese.
//
// Jeder der vier Schritte läuft als EIGENER Funktionsaufruf; Zwischenergebnisse stehen in
// kunden.unternehmensbewertung_recherche, das das Frontend pollt. Grund: Die Plattform beendet jeden
// Worker hart nach WORKER_LEBENSDAUER_MS ab seinem Start (150 s im aktuellen Tarif) — gezählt ab
// Worker-Start, nicht ab Eingang der Anfrage. Die frühere Fassung ließ alle vier Schritte in einem
// Hintergrund-Task laufen (~2 Minuten). Traf die Anfrage einen schon 70 Sekunden alten Worker, wurde
// er mitten in Schritt 3 beendet, ohne dass der catch-Block lief: der Status blieb für immer
// "laeuft" (echter Fall: Christopher Lipps, 12.11.2026).
//
// Deshalb: Vor jedem Schritt wird geprüft, ob dem Worker genug Restlaufzeit bleibt. Wenn nicht,
// wartet er, bis er selbst keine neuen Anfragen mehr bekommt (ab halber Lebensdauer), und reicht den
// Schritt dann weiter — der landet auf einem frischen Worker. Jeder KI-Aufruf hat ein eigenes
// Zeitlimit unterhalb der Restlaufzeit, damit ein zu langer Aufruf als Fehler ankommt und der Schritt
// wiederholt werden kann.
const WORKER_GEBOOTET = Date.now()
const WORKER_LEBENSDAUER_MS = Number(Deno.env.get('WORKER_WALL_CLOCK_MS') ?? '150000')

const RECHERCHE_SCHRITTE = [
  { nr: 1, titel: 'Firmenidentifikation', bedarfMs: 45_000 },
  { nr: 2, titel: 'Recherche-Agents (Firmenprofil, Finanzdaten, Markt, Risiken, Zinsen)', bedarfMs: 85_000 },
  { nr: 3, titel: 'Prüfung der Rechercheergebnisse', bedarfMs: 115_000 },
  { nr: 4, titel: 'Bewertung wird erstellt', bedarfMs: 115_000 },
]

type RechercheZustand = {
  status: 'laeuft' | 'fertig' | 'fehler'
  schritt?: string
  schrittNr?: number
  versuch?: number
  laeuftSeit?: string | null
  anlass: string
  stichtag: string
  gestartetAm: string
  aktualisiertAm?: string
  eingabe?: { firma: string; webseite: string; vorhandeneZahlen: Record<string, unknown>; ansprechpartner?: string; email?: string; akteWissen?: string }
  zwischen?: { identifikation?: string; recherche?: string; pruefung?: string }
  bericht?: string
  abgeleiteteZahlen?: Record<string, number | null>
  abgeschlossenAm?: string
  fehler?: string
}

async function stosseRechercheSchrittAn(bereich: string, kundeId: string, umleitungen = 0, action = 'bewertung_recherche_schritt'): Promise<void> {
  const secret = Deno.env.get('CRM_SHARED_SECRET')
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/email-gateway`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-crm-secret': secret } : {}) },
    body: JSON.stringify({ action, bereich, kundeId, umleitungen }),
  }).catch((err) => console.error('Recherche-Schritt konnte nicht angestoßen werden:', err))
}

// Wartet, bis dieser Worker die halbe Lebensdauer überschritten hat — danach bekommt er keine neuen
// Anfragen mehr, die weitergereichte landet also auf einem frischen Worker.
async function warteBisWorkerAbgeloestWird(): Promise<void> {
  const alter = Date.now() - WORKER_GEBOOTET
  const warte = WORKER_LEBENSDAUER_MS / 2 + 4000 - alter
  if (warte > 0) await new Promise((r) => setTimeout(r, warte))
}

async function fuehreRechercheSchrittAus(bereich: string, kundeId: string, umleitungen: number): Promise<void> {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data } = await admin.from('kunden').select('unternehmensbewertung_recherche').eq('id', kundeId).eq('bereich', bereich).maybeSingle()
  // deno-lint-ignore no-explicit-any
  const z = (data as any)?.unternehmensbewertung_recherche as RechercheZustand | null
  if (!z || z.status !== 'laeuft' || !z.eingabe || !z.schrittNr) return
  const schritt = RECHERCHE_SCHRITTE.find((x) => x.nr === z.schrittNr)
  if (!schritt) return
  // Derselbe Schritt läuft gerade schon woanders (z. B. doppelter Klick auf "Fortsetzen").
  if (z.laeuftSeit && Date.now() - new Date(z.laeuftSeit).getTime() < WORKER_LEBENSDAUER_MS) return

  async function schreibe(patch: Partial<RechercheZustand>) {
    Object.assign(z!, patch, { aktualisiertAm: new Date().toISOString() })
    await admin.from('kunden').update({ unternehmensbewertung_recherche: z }).eq('id', kundeId).eq('bereich', bereich)
  }

  const rest = WORKER_LEBENSDAUER_MS - (Date.now() - WORKER_GEBOOTET)
  if (rest < schritt.bedarfMs + 10_000 && umleitungen < 3) {
    await schreibe({ schritt: schritt.titel })
    await warteBisWorkerAbgeloestWird()
    await stosseRechercheSchrittAn(bereich, kundeId, umleitungen + 1)
    return
  }
  const timeoutMs = Math.max(20_000, rest - 12_000)

  const input = { firma: z.eingabe.firma, webseite: z.eingabe.webseite, anlass: z.anlass, stichtag: z.stichtag, vorhandeneZahlen: z.eingabe.vorhandeneZahlen ?? {} }
  const vorhandeneZahlenText = Object.keys(input.vorhandeneZahlen ?? {}).length
    ? `Folgende Zahlen wurden bereits intern bestätigt und müssen NICHT erneut recherchiert werden, nur gegen die Marktdaten auf Plausibilität geprüft: ${JSON.stringify(input.vorhandeneZahlen)}`
    : 'Es liegen keine intern bestätigten Zahlen vor — alles muss recherchiert werden.'
  const identifikation = z.zwischen?.identifikation ?? ''
  const rechercheGesamt = z.zwischen?.recherche ?? ''
  const pruefung = z.zwischen?.pruefung ?? ''

  try {
    await schreibe({ schritt: schritt.titel, laeuftSeit: new Date().toISOString() })

    if (schritt.nr === 1) {
      const ergebnis = await callClaudeResearch(
        `Öffne die Webseite ${input.webseite} der Firma "${input.firma}" sowie deren Impressum. Halte fest: exakter Firmenname, Rechtsform, Sitz, Registergericht und HRB-/HRA-Nummer, Geschäftsführung, USt-ID. Antworte als kurzer Fließtext auf Deutsch, nur Fakten die du auf den geöffneten Seiten tatsächlich gefunden hast, fehlende Angaben als "nicht gefunden" kennzeichnen.`,
        { model: 'claude-haiku-4-5-20251001', maxSearches: 3, maxTokens: 2048, timeoutMs },
      )
      await schreibe({ zwischen: { ...z.zwischen, identifikation: ergebnis }, schrittNr: 2, versuch: 0, laeuftSeit: null })
    } else if (schritt.nr === 2) {
      const agentAuftraege: { key: string; prompt: string }[] = [
        {
          key: 'Firmenprofil',
          prompt: `Firmenidentität:\n${identifikation}\n\nRecherchiere auf der Webseite ${input.webseite}: Produkte/Leistungen, Zielkunden, Standorte, Mitarbeiterzahl, Gründungsjahr, Referenzkunden, Zertifikate, aktuelle Stellenanzeigen (Hinweis auf Wachstum). Jede Angabe mit Quelle (URL), Datum der Quelle und Abrufdatum. Was du nicht findest, als "nicht gefunden" kennzeichnen. Antworte auf Deutsch als Stichpunkte.`,
        },
        {
          key: 'Finanzdaten',
          prompt: `Firmenidentität:\n${identifikation}\n\n${vorhandeneZahlenText}\n\nRecherchiere Jahresabschlüsse der letzten 3-5 Jahre im Unternehmensregister/Bundesanzeiger sowie ergänzend im Handelsregister. Erfasse: Umsatz (falls veröffentlicht), Bilanzsumme, Eigenkapital, Jahresüberschuss, EBIT, EBITDA, Verbindlichkeiten, Rückstellungen, Mitarbeiterzahl. Vermerke, falls nur ein kleiner Abschluss (nur Bilanz) offengelegt ist — das ist normal, keine Lücke. Jede Angabe mit Quelle, Datum, Abrufdatum. Antworte auf Deutsch.`,
        },
        {
          key: 'Markt & Wettbewerb',
          prompt: `Firmenidentität:\n${identifikation}\n\nRecherchiere: Branche (WZ-Code), Marktgröße und -wachstum, 3-5 direkte Wettbewerber mit Größe, aktuelle Branchen-Multiplikatoren (EBIT-, EBITDA-, Umsatz-Multiple) für kleine und mittlere Unternehmen dieser Branche, jeweils mit Quelle und Stand. Antworte auf Deutsch.`,
        },
        {
          key: 'Risiken & Reputation',
          prompt: `Firmenidentität:\n${identifikation}\n\nRecherchiere: Nachrichten der letzten 3 Jahre, Insolvenz- oder Registerbekanntmachungen, Gesellschafter-/Geschäftsführerwechsel, Rechtsstreitigkeiten, Kunden-/Arbeitgeberbewertungen (nur Tendenz, keine Einzelzitate), erkennbare Abhängigkeit von wenigen Großkunden oder vom Inhaber, Saisongeschäft. Nur öffentliche Firmendaten, keine privaten Daten von Personen über Name und Funktion hinaus. Antworte auf Deutsch.`,
        },
        {
          key: 'Zinsen & Parameter',
          prompt: `Recherchiere den aktuellen Basiszins (Rendite langfristiger Bundesanleihen bzw. Zinsstrukturkurve der Deutschen Bundesbank), die übliche Marktrisikoprämie und übliche Zuschläge für kleine Unternehmen im deutschen Mittelstand, jeweils mit Quelle und Stand (Stichtag ${input.stichtag}). Antworte auf Deutsch.`,
        },
      ]
      agentAuftraege.push({
        key: 'Inhaber & Firmenverflechtungen (über die Akte hinaus)',
        prompt: `Firmenidentität:\n${identifikation}\n\n${umfeldAuftrag({ person: z.eingabe.ansprechpartner ?? '', firma: input.firma, email: z.eingabe.email, webseite: input.webseite, bekannt: z.eingabe.akteWissen ?? '' })}\n\nAntworte auf Deutsch als Stichpunkte. Kennzeichne jeden Fund mit [NEU] oder [BEKANNT laut Akte] und mit der Sicherheit der Zuordnung.`,
      })
      const agentErgebnisse = await Promise.all(
        agentAuftraege.map((a) =>
          callClaudeResearch(a.prompt, { model: 'claude-haiku-4-5-20251001', maxSearches: a.key.startsWith('Inhaber') ? 8 : 4, maxTokens: 4096, timeoutMs })
            .then((text) => `### ${a.key}\n${text}`)
            .catch((err) => `### ${a.key}\nRecherche fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`),
        ),
      )
      await schreibe({ zwischen: { ...z.zwischen, recherche: agentErgebnisse.join('\n\n') }, schrittNr: 3, versuch: 0, laeuftSeit: null })
    } else if (schritt.nr === 3) {
      const ergebnis = await callClaudeResearch(
        `Du bist ein unabhängiger Prüf-Agent. Firmenidentität:\n${identifikation}\n\nPrüfe die folgenden Rechercheergebnisse kritisch gegen:
- Öffne jede zitierte Quelle erneut und prüfe, ob der Wert dort wirklich so steht.
- Prüfe, ob jede Quelle zur richtigen Firma gehört (Registernummer, Sitz).
- Wichtige Zahlen (Umsatz, Ergebnis, Eigenkapital, Multiplikator) brauchen möglichst 2 unabhängige Quellen; Widersprüche auflisten, nicht still auflösen.
- Markiere veraltete Daten (älter als 2 Jahre zum Stichtag ${input.stichtag}).
- Intern bereits bestätigte Zahlen (siehe unten) nicht erneut recherchieren, nur auf Plausibilität gegen die Marktdaten prüfen.
- Ergebnis je Angabe: bestätigt / abweichend / nicht prüfbar, mit Begründung.

${vorhandeneZahlenText}

Rechercheergebnisse:
${rechercheGesamt}

Antworte auf Deutsch als strukturierte Liste.`,
        { model: 'claude-sonnet-5-5', maxSearches: 6, maxTokens: 8192, timeoutMs },
      )
      await schreibe({ zwischen: { ...z.zwischen, pruefung: ergebnis }, schrittNr: 4, versuch: 0, laeuftSeit: null })
    } else {
      const bewertung = await callClaudeResearch(
        `Du bist ein erfahrener Berater für Unternehmensbewertung im Mittelstand. Anlass: ${input.anlass}. Stichtag: ${input.stichtag}.

Firmenidentität:
${identifikation}

Rechercheergebnisse:
${rechercheGesamt}

Prüfergebnis:
${pruefung}

${vorhandeneZahlenText}

Erstelle daraus eine praxisnahe Kaufpreis-Schätzung:
1. Bereinige Inhabergehalt (falls kein marktübliches Geschäftsführergehalt abgezogen ist) und Einmaleffekte — lege offen, was angepasst wurde.
2. Leite aus den recherchierten Branchendaten einen Branchenmultiplikator ab (typisch 3-7) und begründe die Wahl.
3. Leite aus Basiszins + Marktrisikoprämie + Zuschlag einen Kapitalisierungszins ab (typisch 8-12%).
4. Rechne mit mindestens zwei Verfahren, nur wofür ausreichend Daten vorliegen — benenne explizit, welches Verfahren entfällt und warum: Multiplikatorverfahren (EBIT × Branchenmultiplikator), Ertragswertverfahren (nachhaltiger Jahresüberschuss ÷ (Kapitalisierungszins / 100)), Substanzwertverfahren (Substanzwert als Wertuntergrenze).
5. Sensitivität: wie ändert sich der Wert bei ±1 Prozentpunkt Kapitalisierungszins und ±10% Ergebnis?
6. Zeige das Ergebnis als Bandbreite (Minimum/Mittelwert/Maximum), niemals eine einzelne exakte Zahl.
7. Liste Widersprüche/offene Fragen, die nur mit internen Unterlagen (BWA, Planung, Verträge) zu klären sind, sowie die Quellenliste.
8. Schließe mit dem Hinweis: Ergebnis beruht auf öffentlichen Daten bzw. den übergebenen Angaben und ersetzt kein Gutachten eines Wirtschaftsprüfers oder Steuerberaters.

Antworte auf Deutsch, klar und ohne Fachjargon, als Bericht mit den Abschnitten Kurzfazit, Firmensteckbrief, Inhaber und Firmenverflechtungen, Bewertungsrechnung, Sensitivität, Widersprüche/offene Fragen, Quellenliste, Hinweis. Im Abschnitt "Inhaber und Firmenverflechtungen" steht, was die Recherche über die Kundenakte hinaus ergeben hat: weitere Firmen, Funktionen und Beteiligungen der handelnden Personen sowie Gruppenzugehörigkeiten — je Fund mit Quelle, mit der Sicherheit der Zuordnung zur Person und mit dem Vermerk NEU oder BEKANNT laut Akte; nenne ausdrücklich, wenn nichts Neues gefunden wurde, und was das Gefundene für die Bewertung bedeutet (z. B. Betriebsaufspaltung, Abhängigkeiten, Haftungsverbund). WICHTIG: Fasse dich prägnant — insgesamt maximal ca. 950 Wörter Fließtext über alle Abschnitte zusammen, auch wenn die Datenlage unsicher ist oder viele Widersprüche vorliegen (dann die Unsicherheiten knapp stichpunktartig benennen statt sie einzeln auszubreiten). Der abschließende JSON-Block (siehe unten) MUSS in jedem Fall noch Platz haben und vollständig ausgegeben werden — das hat Vorrang vor Ausführlichkeit im Fließtext.

Gib GANZ AM ENDE zusätzlich einen einzelnen Codeblock mit reinem JSON zurück (danach nichts mehr), exakt in diesem Format, mit den von dir verwendeten Werten (null wenn ein Wert nicht ermittelbar war):
\`\`\`json
{"ebit": null, "substanzwert": null, "nachhaltigerJahresueberschuss": null, "branchenmultiplikator": null, "kapitalisierungszinsProzent": null}
\`\`\``,
        { model: 'claude-sonnet-5-5', maxSearches: 0, maxTokens: 8192, timeoutMs },
      )
      const jsonMatch = bewertung.match(/```json\s*([\s\S]*?)```/)
      let abgeleiteteZahlen: Record<string, number | null> | undefined
      if (jsonMatch) {
        try {
          abgeleiteteZahlen = JSON.parse(jsonMatch[1])
        } catch {
          abgeleiteteZahlen = undefined
        }
      }
      // Zwischenergebnisse und Eingabe werden nicht mehr gebraucht — der Bericht enthält alles.
      await schreibe({ status: 'fertig', schritt: 'Fertig', schrittNr: undefined, laeuftSeit: null, zwischen: undefined, bericht: bewertung, abgeleiteteZahlen, abgeschlossenAm: new Date().toISOString() })
      return
    }
    await stosseRechercheSchrittAn(bereich, kundeId, 0)
  } catch (err) {
    console.error(`Unternehmensbewertung-Recherche, Schritt ${schritt.nr} fehlgeschlagen:`, err)
    const versuch = (z.versuch ?? 0) + 1
    if (versuch <= 2) {
      // Noch einmal versuchen, auf einem frischen Worker mit voller Laufzeit.
      await schreibe({ versuch, laeuftSeit: null }).catch(() => {})
      await warteBisWorkerAbgeloestWird()
      await stosseRechercheSchrittAn(bereich, kundeId, 0)
    } else {
      await schreibe({
        status: 'fehler',
        laeuftSeit: null,
        fehler: `Schritt „${schritt.titel}" ist auch nach drei Versuchen gescheitert: ${err instanceof Error ? err.message : String(err)}`,
        abgeschlossenAm: new Date().toISOString(),
      }).catch(() => {})
    }
  }
}

// ---------- Dokumente inhaltlich lesen und den Inhalt aufbewahren ----------
//
// Jedes Dokument einer Akte wird EINMAL gelesen (Scans und Fotos per KI inkl. Handschrift, Word/Excel/
// CSV direkt) und der Volltext samt Kurzfassung in der Tabelle dokument_inhalte abgelegt. Telegram-Bot
// und Analysen greifen darauf zu, statt nur Dateinamen zu kennen oder jedes Mal neu zu lesen.
// Schlüssel ist der Speicherort der Datei, nicht die Akte — der Inhalt bleibt also erhalten, wenn ein
// Dokument in eine andere Akte umzieht. Die Tabelle ist nur für den Server zugänglich.
//
// Dokumente liegen an zwei Orten: Mail- und Telegram-Anhänge im Bucket "email-anhaenge" (url ist die
// volle Adresse), im CRM hochgeladene Dateien im privaten Bucket "kunden-dokumente" (url ist der Pfad).
const SEITEN_JE_TEIL = 8
const MAX_TEILE = 8

type DokumentRef = { url: string; name: string; typ?: string }
type DokumentInhaltZeile = {
  schluessel: string
  name: string
  status: 'laeuft' | 'gelesen' | 'fehler'
  zusammenfassung: string | null
  inhalt: string
  teile: Record<string, string> | null
  teile_gesamt: number | null
  seiten: number | null
  versuche: number
  fehler: string | null
  aktualisiert_am: string
}

function dokumentSchluessel(url: string): string {
  const marker = '/object/public/'
  if (/^https?:\/\//i.test(url)) return url.includes(marker) ? decodeURIComponent(url.split(marker)[1].split('?')[0]) : url
  return `kunden-dokumente/${url}`
}

// deno-lint-ignore no-explicit-any
async function ladeDokumentBytes(admin: any, url: string): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) })
    if (!res.ok) throw new Error(`Datei nicht abrufbar (${res.status})`)
    return new Uint8Array(await res.arrayBuffer())
  }
  const { data, error } = await admin.storage.from('kunden-dokumente').download(url)
  if (error || !data) throw new Error(`Datei nicht abrufbar (${error?.message ?? 'unbekannt'})`)
  return new Uint8Array(await data.arrayBuffer())
}

function lesbareArt(name: string, typ?: string): 'pdf' | 'bild' | 'buero' | null {
  if (/\.pdf$/i.test(name) || typ === 'application/pdf') return 'pdf'
  if (istDocx(name, typ) || istXlsx(name, typ) || istCsv(name, typ)) return 'buero'
  if (/\.(jpe?g|png|webp|gif)$/i.test(name) || (typ ?? '').startsWith('image/')) return 'bild'
  return null
}

const ABSCHRIFT_AUFTRAG = `Gib den Inhalt dieses Dokuments vollständig und wortgetreu als Text wieder, Seite für Seite (jede Seite beginnt mit einer Zeile "--- Seite n ---"). Tabellen als Zeilen mit " | " zwischen den Spalten. Zahlen, Namen, Daten und Beträge exakt wie im Dokument. Handschriftliches gibst du ebenfalls wieder und kennzeichnest es mit [handschriftlich: …]; was du nicht sicher lesen kannst, mit [unleserlich] oder [unsicher: …]. Stempel, Unterschriften und Skizzen beschreibst du kurz in eckigen Klammern. Nichts zusammenfassen, nichts weglassen, nichts ergänzen.

Beginne deine Antwort mit genau diesen zwei Zeilen und danach einer Zeile "=====":
ZUSAMMENFASSUNG: zwei bis drei Sätze — was für ein Dokument das ist, von wem an wen, welches Datum, die Kernaussage und die wichtigsten Zahlen.
ART: die Dokumentart in ein bis drei Wörtern.`

function trenneAbschrift(text: string): { zusammenfassung: string; inhalt: string } {
  const [kopf, ...rest] = text.split(/\n={5,}\n?/)
  if (rest.length === 0) return { zusammenfassung: '', inhalt: text.trim() }
  const zus = kopf.match(/ZUSAMMENFASSUNG:\s*([\s\S]*?)(?:\nART:|$)/)?.[1]?.trim() ?? ''
  const art = kopf.match(/ART:\s*(.+)/)?.[1]?.trim()
  return { zusammenfassung: [art ? `${art}.` : '', zus].filter(Boolean).join(' '), inhalt: rest.join('\n=====\n').trim() }
}

async function stosseDokumentLesenAn(ref: DokumentRef, extra: Record<string, unknown> = {}): Promise<void> {
  const secret = Deno.env.get('CRM_SHARED_SECRET')
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/email-gateway`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-crm-secret': secret } : {}) },
    body: JSON.stringify({ action: 'dokument_lesen', ...ref, ...extra }),
  }).catch((err) => console.error('Dokument-Lesen konnte nicht angestoßen werden:', err))
}

// Liest ein Dokument (oder bei langen PDFs einen Teil davon) und legt das Ergebnis ab. Lange PDFs
// werden in Teilen zu je SEITEN_JE_TEIL Seiten nacheinander gelesen — jeder Teil ist ein eigener
// Aufruf mit eigener Laufzeit, und nacheinander statt parallel, damit sich die Teile beim Speichern
// nicht gegenseitig überschreiben.
async function leseDokument(ref: DokumentRef, teil: number, umleitungen: number): Promise<void> {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const schluessel = dokumentSchluessel(ref.url)
  const art = lesbareArt(ref.name, ref.typ)
  const { data: vorhandenRoh } = await admin.from('dokument_inhalte').select('*').eq('schluessel', schluessel).maybeSingle()
  const vorhanden = vorhandenRoh as DokumentInhaltZeile | null
  if (vorhanden?.status === 'gelesen') return
  const jetztIso = () => new Date().toISOString()

  if (!art) {
    await admin.from('dokument_inhalte').upsert({ schluessel, name: ref.name, status: 'fehler', fehler: 'Dateityp kann nicht gelesen werden', versuche: 3, aktualisiert_am: jetztIso() })
    return
  }
  // Ein neuer Lauf (teil 0) startet nur, wenn nicht gerade schon einer arbeitet.
  if (teil === 0 && umleitungen === 0 && vorhanden?.status === 'laeuft' && Date.now() - new Date(vorhanden.aktualisiert_am).getTime() < 4 * 60 * 1000) return

  const rest = WORKER_LEBENSDAUER_MS - (Date.now() - WORKER_GEBOOTET)
  if (rest < 120_000 && umleitungen < 3) {
    if (teil === 0) await admin.from('dokument_inhalte').upsert({ schluessel, name: ref.name, status: 'laeuft', versuche: vorhanden?.versuche ?? 0, aktualisiert_am: jetztIso() })
    await warteBisWorkerAbgeloestWird()
    await stosseDokumentLesenAn(ref, { teil, umleitungen: umleitungen + 1 })
    return
  }
  const timeoutMs = Math.max(20_000, rest - 12_000)

  try {
    if (teil === 0) {
      const { error: startFehler } = await admin.from('dokument_inhalte').upsert({
        schluessel,
        name: ref.name,
        status: 'laeuft',
        inhalt: '',
        teile: null,
        teile_gesamt: null,
        fehler: null,
        versuche: (vorhanden?.versuche ?? 0) + 1,
        aktualisiert_am: jetztIso(),
      })
      // Ohne Ablageort (Tabelle fehlt oder nicht erreichbar) gar nicht erst lesen — das Ergebnis ginge verloren.
      if (startFehler) throw new Error(`Ablage für Dokument-Inhalte nicht erreichbar: ${startFehler.message}`)
    }
    const bytes = await ladeDokumentBytes(admin, ref.url)
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Datei größer als 20 MB')

    if (art === 'buero') {
      const text = bueroDateiText(ref.name, ref.typ, bytes, 200_000) ?? ''
      const zusammenfassung = await callClaudeResearch(
        // Sonnet statt Haiku: Haiku hat hier Eigenschaften dazuerfunden ("anwaltliche" Analyse) und
        // Begriffe verdreht ("Steuernachlass" statt "Steuer auf den Gewinn") — die Kurzfassung fließt
        // aber ungeprüft in Analysen und Bot-Antworten ein.
        `Fasse in zwei bis drei Sätzen zusammen, was für ein Dokument das ist (Art, von wem, an wen oder worüber, Datum bzw. Zeitraum, Kernaussage und wichtigste Zahlen). Verwende nur, was im Text steht: keine Eigenschaften oder Einordnungen, die dort nicht ausdrücklich genannt sind (z. B. nicht "anwaltlich", wenn kein Anwalt genannt ist), und bei Zahlen die Bezeichnung aus dem Text übernehmen (z. B. "Steuer auf den Gewinn" nicht in "Steuernachlass" umdeuten). Nur die Zusammenfassung, kein Vorspann.\n\nDateiname: ${ref.name}\n\n${text.slice(0, 12_000)}`,
        { model: 'claude-sonnet-5-5', maxSearches: 0, maxTokens: 600, timeoutMs, ohneNachdenken: true },
      ).catch(() => '')
      await admin.from('dokument_inhalte').update({ status: 'gelesen', inhalt: text, zusammenfassung: zusammenfassung.trim(), aktualisiert_am: jetztIso() }).eq('schluessel', schluessel)
      return
    }

    if (art === 'bild') {
      const mediaType = ref.typ && ref.typ.startsWith('image/') ? ref.typ : /\.png$/i.test(ref.name) ? 'image/png' : /\.gif$/i.test(ref.name) ? 'image/gif' : /\.webp$/i.test(ref.name) ? 'image/webp' : 'image/jpeg'
      const antwort = await callClaudeResearch(
        [{ type: 'text', text: `${ABSCHRIFT_AUFTRAG}\n\nDateiname: ${ref.name}. Ist es kein Dokument, sondern ein Foto (z. B. von einem Gebäude) oder ein Logo, beschreibe kurz, was zu sehen ist.` }, { type: 'image', source: { type: 'base64', media_type: mediaType, data: bytesNachBase64(bytes) } }],
        { model: 'claude-sonnet-5-5', maxSearches: 0, maxTokens: 4000, timeoutMs, ohneNachdenken: true },
      )
      await admin.from('dokument_inhalte').update({ status: 'gelesen', ...trenneAbschrift(antwort), seiten: 1, aktualisiert_am: jetztIso() }).eq('schluessel', schluessel)
      return
    }

    // PDF
    let seiten = 0
    try {
      seiten = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount()
    } catch {
      seiten = 0 // beschädigt oder ungewöhnlich aufgebaut: als Ganzes versuchen
    }
    const teileGesamt = seiten > SEITEN_JE_TEIL + 2 ? Math.min(MAX_TEILE, Math.ceil(seiten / SEITEN_JE_TEIL)) : 1
    let teilBytes = bytes
    let bereich = ''
    if (teileGesamt > 1) {
      const von = teil * SEITEN_JE_TEIL
      const bis = Math.min(seiten, von + SEITEN_JE_TEIL)
      const quelle = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const ziel = await PDFDocument.create()
      for (const seite of await ziel.copyPages(quelle, Array.from({ length: bis - von }, (_, i) => von + i))) ziel.addPage(seite)
      teilBytes = await ziel.save()
      bereich = ` Dir liegen die Seiten ${von + 1} bis ${bis} von insgesamt ${seiten} vor; nummeriere die Seiten entsprechend ab ${von + 1}.${teil > 0 ? ' Lass die Zeilen ZUSAMMENFASSUNG und ART leer, sie stehen schon beim ersten Teil.' : ''}`
    }
    const antwort = await callClaudeResearch(
      [{ type: 'text', text: `${ABSCHRIFT_AUFTRAG}\n\nDateiname: ${ref.name}.${bereich}` }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytesNachBase64(teilBytes) } }],
      { model: 'claude-sonnet-5-5', maxSearches: 0, maxTokens: 8192, timeoutMs, ohneNachdenken: true },
    )
    const abschrift = trenneAbschrift(antwort)

    if (teileGesamt === 1) {
      await admin.from('dokument_inhalte').update({ status: 'gelesen', ...abschrift, seiten: seiten || null, aktualisiert_am: jetztIso() }).eq('schluessel', schluessel)
      return
    }
    const { data: aktuellRoh } = await admin.from('dokument_inhalte').select('teile, zusammenfassung').eq('schluessel', schluessel).maybeSingle()
    // deno-lint-ignore no-explicit-any
    const aktuell = aktuellRoh as any
    const teile: Record<string, string> = { ...(aktuell?.teile ?? {}), [String(teil)]: abschrift.inhalt }
    const fertig = teil + 1 >= teileGesamt
    const abgeschnitten = seiten > MAX_TEILE * SEITEN_JE_TEIL ? `\n\n[Hinweis: Das Dokument hat ${seiten} Seiten; gelesen wurden die ersten ${MAX_TEILE * SEITEN_JE_TEIL}.]` : ''
    await admin
      .from('dokument_inhalte')
      .update({
        status: fertig ? 'gelesen' : 'laeuft',
        teile: fertig ? null : teile,
        teile_gesamt: teileGesamt,
        seiten,
        zusammenfassung: teil === 0 ? abschrift.zusammenfassung : aktuell?.zusammenfassung ?? '',
        inhalt: fertig ? Array.from({ length: teileGesamt }, (_, i) => teile[String(i)] ?? '').join('\n\n') + abgeschnitten : '',
        aktualisiert_am: jetztIso(),
      })
      .eq('schluessel', schluessel)
    if (!fertig) await stosseDokumentLesenAn(ref, { teil: teil + 1, umleitungen: 0 })
  } catch (err) {
    console.error(`Dokument lesen fehlgeschlagen (${ref.name}, Teil ${teil}):`, err)
    await admin
      .from('dokument_inhalte')
      .update({ status: 'fehler', fehler: err instanceof Error ? err.message : String(err), aktualisiert_am: jetztIso() })
      .eq('schluessel', schluessel)
  }
}

// Liefert zu einer Liste von Dokumenten, was schon gelesen ist, und stößt auf Wunsch das Lesen der
// übrigen an (höchstens zwölf je Aufruf, damit nicht eine ganze Akte auf einmal Kosten auslöst).
async function dokumentInhalte(dokumente: DokumentRef[], einlesen: boolean, volltext: boolean) {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const refs = dokumente.filter((d) => d?.url).slice(0, 200)
  const schluessel = refs.map((d) => dokumentSchluessel(d.url))
  const { data, error } = await admin.from('dokument_inhalte').select(volltext ? '*' : 'schluessel, status, zusammenfassung, seiten, versuche, fehler, aktualisiert_am').in('schluessel', schluessel)
  if (error) throw new Error(`Dokument-Inhalte nicht lesbar: ${error.message}`)
  // deno-lint-ignore no-explicit-any
  const nach = new Map(((data ?? []) as any[]).map((z) => [z.schluessel, z]))
  let angestossen = 0
  const ergebnis = []
  for (let i = 0; i < refs.length; i++) {
    const zeile = nach.get(schluessel[i])
    const lesbar = !!lesbareArt(refs[i].name, refs[i].typ)
    let status: string = zeile?.status ?? (lesbar ? 'ungelesen' : 'nicht lesbar')
    const haengt = zeile?.status === 'laeuft' && Date.now() - new Date(zeile.aktualisiert_am).getTime() > 6 * 60 * 1000
    const darfNochmal = (zeile?.status === 'fehler' && (zeile.versuche ?? 0) < 3) || haengt
    if (einlesen && lesbar && (!zeile || darfNochmal) && angestossen < 12) {
      await stosseDokumentLesenAn(refs[i])
      angestossen++
      status = 'laeuft'
    }
    ergebnis.push({
      url: refs[i].url,
      status,
      zusammenfassung: zeile?.zusammenfassung ?? '',
      seiten: zeile?.seiten ?? null,
      fehler: zeile?.status === 'fehler' ? zeile.fehler : undefined,
      ...(volltext ? { inhalt: zeile?.inhalt ?? '' } : {}),
    })
  }
  return { dokumente: ergebnis, angestossen }
}

// ---------- Steuerliche Ansatzpunkte (Teil der Potenzial-Analyse) ----------
//
// Liest Finanzunterlagen aus der Akte (BWA, Jahresabschluss, …) tatsächlich inhaltlich, ermittelt
// alle Firmen des Kunden samt öffentlich einsehbarer Abschlüsse, prüft den aktuellen Rechtsstand der
// gängigen Gestaltungsmittel und leitet daraus Vorschläge zur Steuerersparnis (dauerhaft) und
// Steuerverlagerung (zeitlich) ab. Läuft wie die Unternehmensbewertung als Kette einzelner Aufrufe
// (Worker-Lebensdauer, siehe oben); der Zustand liegt in kunden.steuer_analyse und gehört dem Server.
//
// Das Ergebnis ist ausdrücklich KEINE Steuerberatung, sondern eine Vorbereitung für das Gespräch mit
// dem Steuerberater — die Oberfläche sagt das, und jeder Vorschlag nennt seine Datengrundlage.
const STEUER_SCHRITTE = [
  { nr: 1, titel: 'Unterlagen aus der Akte lesen', bedarfMs: 110_000 },
  { nr: 2, titel: 'Firmen des Kunden ermitteln', bedarfMs: 85_000 },
  { nr: 3, titel: 'Öffentliche Abschlüsse und aktuelle Steuerregeln prüfen', bedarfMs: 110_000 },
  { nr: 4, titel: 'Vorschläge erarbeiten', bedarfMs: 120_000 },
]

// Welche Dateien der Akte sind Finanz- oder Strukturunterlagen? Bewusst eine einfache, nachvollziehbare
// Namensregel statt einer KI-Auswahl — die Oberfläche zeigt, was gelesen und was übersprungen wurde.
const FINANZ_DATEI = /bwa|jahresabschluss|abschluss|bilanz|guv|gewinn|verlust|e[uü]r|einnahmen|summen|saldenliste|susa|kontennachweis|anlage(n|spiegel|verzeichnis)|steuer|bescheid|lohn|gehalt|betriebswirtschaft|struktur|finanz|kennzahl|planung|budget|liquidit/i

const STEUER_LESEAUFTRAG = (dateiname: string) => `Lies dieses Dokument aus einer Kundenakte vollständig (Dateiname: "${dateiname}"). Halte fest: Art des Dokuments, betroffene Firma oder Person, Zeitraum bzw. Stichtag, und alle steuerlich relevanten Zahlen und Angaben EXAKT wie im Dokument — soweit vorhanden: Umsatz, Material-/Wareneinsatz, Personalaufwand, Vergütung der Geschäftsführer, Abschreibungen, Zinsen, Ergebnis vor und nach Steuern, Steueraufwand, Anlagevermögen nach Gruppen, Vorräte, Forderungen, liquide Mittel, Eigenkapital, Rückstellungen (besonders Pensionsrückstellungen), Verbindlichkeiten, Gesellschafterdarlehen, Entnahmen/Ausschüttungen, Fahrzeuge, geplante Investitionen, Mitarbeiterzahl, Rechtsform, Beteiligungsverhältnisse und Firmenstruktur, außerdem alle handschriftlichen Anmerkungen. Was nicht im Dokument steht, lässt du weg — nichts schätzen, nichts ergänzen. Unleserliches kennzeichnest du als unleserlich. Antworte als kompakte Stichpunktliste auf Deutsch.`

const KONTEXT_DATEI = /protokoll|notiz|gespr[aä]e?ch|to-?do|memo|vermerk|aufnahme/i

type SteuerVorschlag = {
  titel: string
  art: 'Steuerersparnis' | 'Steuerverlagerung'
  firma: string
  massnahme: string
  wirkung: string
  voraussetzungen: string
  haken: string
  naechster_schritt: string
  rechtsgrundlage: string
  grundlage: string
  belastbarkeit: 'hoch' | 'mittel' | 'niedrig'
}

type SteuerZustand = {
  status: 'laeuft' | 'fertig' | 'fehler'
  schritt?: string
  schrittNr?: number
  versuch?: number
  laeuftSeit?: string | null
  gestartetAm: string
  gestartetVon?: string
  aktualisiertAm?: string
  abgeschlossenAm?: string
  fehler?: string
  zwischen?: { unterlagen?: string; firmen?: string; zahlen?: string; rechtsstand?: string }
  gelesen?: { name: string; ergebnis: 'gelesen' | 'nicht lesbar' | 'übersprungen'; hinweis?: string }[]
  zusammenfassung?: string
  datenlage?: string
  vorschlaege?: SteuerVorschlag[]
  quellen?: string[]
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function istDocx(name: string, typ?: string): boolean {
  return /\.docx$/i.test(name) || typ === DOCX_MIME
}

// Zieht den Fließtext aus einer Word-Datei (.docx = ZIP mit word/document.xml). Absätze und
// Tabellenzeilen bleiben als Zeilen erhalten; eingebettete Bilder werden nicht gelesen. Das alte
// .doc-Format ist kein ZIP und wird nicht unterstützt.
function docxText(bytes: Uint8Array): string {
  const dateien = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })
  const xml = dateien['word/document.xml']
  if (!xml) throw new Error('keine Word-Datei im .docx-Format')
  const entschluesseln = (t: string) =>
    t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')
  return strFromU8(xml)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .split(/<\/w:p>/)
    .map((absatz) => entschluesseln([...absatz.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|(\t)|(\n)/g)].map((m) => m[1] ?? m[2] ?? m[3]).join('')).trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function istXlsx(name: string, typ?: string): boolean {
  return /\.xlsx$/i.test(name) || typ === XLSX_MIME
}

function istCsv(name: string, typ?: string): boolean {
  return /\.csv$/i.test(name) || typ === 'text/csv'
}

const xmlText = (t: string) =>
  t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')

// Liest eine Excel-Datei (.xlsx = ZIP mit XML-Tabellenblättern) als Text: je Blatt eine Überschrift,
// je Zeile die Zellen durch Tabulator getrennt, Spaltenpositionen bleiben erhalten. Formeln erscheinen
// mit ihrem zuletzt gespeicherten Ergebnis. Das alte .xls-Format ist kein ZIP und wird nicht unterstützt.
function xlsxText(bytes: Uint8Array, maxZeichen = 80_000): string {
  const zip = unzipSync(bytes, { filter: (f) => /^xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(f.name) })
  const lies = (name: string) => (zip[name] ? strFromU8(zip[name]) : '')
  if (!zip['xl/workbook.xml']) throw new Error('keine Excel-Datei im .xlsx-Format')

  const texte = [...lies('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText([...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join('')))

  // Welche Zellformate sind Datumsformate? (Excel speichert ein Datum als laufende Tageszahl.)
  const styles = lies('xl/styles.xml')
  const eigeneFormate = new Map([...styles.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), m[2]]))
  const zellFormate = [...(styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? '').matchAll(/<xf\s[^>]*?numFmtId="(\d+)"/g)].map((m) => Number(m[1]))
  const istDatum = (stil: number) => {
    const id = zellFormate[stil]
    if (id === undefined) return false
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true
    const code = eigeneFormate.get(id)
    return !!code && /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, ''))
  }

  const ziele = new Map([...lies('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"|<Relationship\s[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)].map((m) => [m[1] ?? m[4], m[2] ?? m[3]]))
  const blaetter = [...lies('xl/workbook.xml').matchAll(/<sheet\s[^>]*?name="([^"]*)"[^>]*?r:id="([^"]+)"/g)].map((m) => ({ name: xmlText(m[1]), pfad: `xl/${(ziele.get(m[2]) ?? '').replace(/^\/?xl\//, '').replace(/^\//, '')}` }))

  const spalte = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1
  const teile: string[] = []
  for (const blatt of blaetter) {
    const xml = lies(blatt.pfad)
    if (!xml) continue
    const zeilen: string[] = []
    for (const z of xml.matchAll(/<row\s[^>]*>([\s\S]*?)<\/row>/g)) {
      const zellen: string[] = []
      for (const c of z[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attr = c[1]
        const inhalt = c[2] ?? ''
        const ref = attr.match(/r="([A-Z]+\d+)"/)?.[1]
        const typ = attr.match(/t="([^"]+)"/)?.[1]
        const stil = Number(attr.match(/s="(\d+)"/)?.[1] ?? -1)
        const v = inhalt.match(/<v>([^<]*)<\/v>/)?.[1]
        let wert = ''
        if (typ === 's') wert = texte[Number(v)] ?? ''
        else if (typ === 'inlineStr') wert = xmlText([...inhalt.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join(''))
        else if (typ === 'b') wert = v === '1' ? 'ja' : 'nein'
        else if (v !== undefined && typ !== 'str' && typ !== 'e' && stil >= 0 && istDatum(stil) && !Number.isNaN(Number(v))) {
          wert = new Date(Math.round((Number(v) - 25569) * 86400000)).toISOString().slice(0, 10)
        } else if (v !== undefined && typ !== 'str' && typ !== 'e' && !Number.isNaN(Number(v))) {
          // Rechenungenauigkeiten wie 204549.59999999998 glätten, ohne echte Nachkommastellen zu verlieren.
          wert = String(Math.round(Number(v) * 1e6) / 1e6)
        } else wert = xmlText(v ?? '')
        if (ref) zellen[spalte(ref)] = wert.replace(/[\t\n\r]+/g, ' ')
        else zellen.push(wert)
      }
      const zeile = Array.from(zellen, (x) => x ?? '').join('\t').trimEnd()
      if (zeile.trim()) zeilen.push(zeile)
    }
    teile.push(`=== Tabellenblatt: ${blatt.name} ===\n${zeilen.length > 0 ? zeilen.join('\n') : '(leer)'}`)
  }
  const text = teile.join('\n\n')
  return text.length > maxZeichen ? `${text.slice(0, maxZeichen)}\n… (gekürzt: die Datei ist länger, als hier gelesen wurde)` : text
}

// Text einer Büro-Datei (Word, Excel, CSV) für die KI aufbereiten; null, wenn es keine solche Datei ist.
function bueroDateiText(name: string, typ: string | undefined, bytes: Uint8Array, maxZeichen: number): string | null {
  if (istDocx(name, typ)) return `Text der Word-Datei (eingebettete Bilder und Skizzen fehlen):\n\n${docxText(bytes).slice(0, maxZeichen)}`
  if (istXlsx(name, typ)) return `Inhalt der Excel-Datei (Zellen einer Zeile durch Tabulator getrennt, Formeln mit ihrem gespeicherten Ergebnis):\n\n${xlsxText(bytes, maxZeichen)}`
  if (istCsv(name, typ)) return `Inhalt der CSV-Datei:\n\n${new TextDecoder().decode(bytes).slice(0, maxZeichen)}`
  return null
}

function base64NachBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesNachBase64(bytes: Uint8Array): string {
  let binaer = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binaer += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binaer)
}

async function fuehreSteuerSchrittAus(bereich: string, kundeId: string, umleitungen: number, wiederaufnehmen = false): Promise<void> {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data } = await admin
    .from('kunden')
    .select('firma, ansprechpartner, email, activities, dokumente, unternehmensbewertung, steuer_analyse')
    .eq('id', kundeId)
    .eq('bereich', bereich)
    .maybeSingle()
  // deno-lint-ignore no-explicit-any
  const kunde = data as any
  const z = kunde?.steuer_analyse as SteuerZustand | null
  // Nach einem Fehler ab dem gescheiterten Schritt weitermachen, statt die fertigen Schritte (und
  // deren Kosten) zu wiederholen.
  if (z && z.status === 'fehler' && z.schrittNr && wiederaufnehmen) {
    z.status = 'laeuft'
    z.versuch = 0
    z.fehler = undefined
    z.abgeschlossenAm = undefined
    z.laeuftSeit = null
  }
  if (!kunde || !z || z.status !== 'laeuft' || !z.schrittNr) return
  const schritt = STEUER_SCHRITTE.find((x) => x.nr === z.schrittNr)
  if (!schritt) return
  if (z.laeuftSeit && Date.now() - new Date(z.laeuftSeit).getTime() < WORKER_LEBENSDAUER_MS) return

  async function schreibe(patch: Partial<SteuerZustand>) {
    Object.assign(z!, patch, { aktualisiertAm: new Date().toISOString() })
    await admin.from('kunden').update({ steuer_analyse: z }).eq('id', kundeId).eq('bereich', bereich)
  }

  const rest = WORKER_LEBENSDAUER_MS - (Date.now() - WORKER_GEBOOTET)
  if (rest < schritt.bedarfMs + 10_000 && umleitungen < 3) {
    await schreibe({ schritt: schritt.titel })
    await warteBisWorkerAbgeloestWird()
    await stosseRechercheSchrittAn(bereich, kundeId, umleitungen + 1, 'steuer_analyse_schritt')
    return
  }
  const timeoutMs = Math.max(20_000, rest - 12_000)
  const heute = new Date().toISOString().slice(0, 10)
  const person = kunde.ansprechpartner || kunde.firma
  // deno-lint-ignore no-explicit-any
  const dokumente: { name: string; url: string; typ?: string; groesse?: string }[] = (kunde.dokumente ?? []) as any[]

  try {
    await schreibe({ schritt: schritt.titel, laeuftSeit: new Date().toISOString() })

    if (schritt.nr === 1) {
      const gelesen: NonNullable<SteuerZustand['gelesen']> = []
      // Finanzunterlagen zuerst, dann Gesprächsprotokolle und Notizen (dort stehen oft Pläne, Fristen
      // und Zahlen aus dem Gespräch); zusammen höchstens sechs Dateien.
      // Tabellen (Excel, CSV) gelten immer als Finanzunterlage — in einer Kundenakte sind das praktisch
      // immer Auswertungen, Summenlisten oder Planungen, egal wie die Datei heißt.
      const istFinanz = (d: { name: string; typ?: string }) => FINANZ_DATEI.test(d.name) || istXlsx(d.name, d.typ) || istCsv(d.name, d.typ)
      const finanz = dokumente.filter(istFinanz)
      const kontext = dokumente.filter((d) => !istFinanz(d) && KONTEXT_DATEI.test(d.name))
      const kandidaten = [...finanz, ...kontext]
      for (const d of dokumente.filter((d) => !kandidaten.includes(d))) {
        gelesen.push({ name: d.name, ergebnis: 'übersprungen', hinweis: 'dem Namen nach weder Finanzunterlage noch Gesprächsnotiz' })
      }
      const zuLesen = kandidaten.slice(0, 6)
      // Was schon einmal vollständig gelesen wurde, wird nicht erneut aus der Datei gelesen.
      const { data: inhaltZeilen } = await admin.from('dokument_inhalte').select('schluessel, inhalt').eq('status', 'gelesen').in('schluessel', zuLesen.map((d) => dokumentSchluessel(d.url)))
      // deno-lint-ignore no-explicit-any
      const gespeicherteInhalte = new Map<string, string>(((inhaltZeilen ?? []) as any[]).filter((r) => r.inhalt).map((r) => [r.schluessel, r.inhalt]))
      for (const d of kandidaten.slice(6)) gelesen.push({ name: d.name, ergebnis: 'übersprungen', hinweis: 'mehr als sechs passende Unterlagen — nur die ersten sechs wurden gelesen' })

      const auszuege = await Promise.all(
        zuLesen.map(async (d) => {
          try {
            const istPdf = /\.pdf$/i.test(d.name) || d.typ === 'application/pdf'
            const istBild = /\.(jpe?g|png|webp)$/i.test(d.name) || (d.typ ?? '').startsWith('image/')
            const istBuero = istDocx(d.name, d.typ) || istXlsx(d.name, d.typ) || istCsv(d.name, d.typ)
            if (!istPdf && !istBild && !istBuero) {
              gelesen.push({ name: d.name, ergebnis: 'nicht lesbar', hinweis: 'Dateityp kann nicht gelesen werden (lesbar sind PDF, Bilder, Word .docx, Excel .xlsx und CSV)' })
              return ''
            }
            const gespeichert = gespeicherteInhalte.get(dokumentSchluessel(d.url))
            if (gespeichert) {
              const text = await callClaudeResearch(
                `${STEUER_LESEAUFTRAG(d.name)}\n\nVollständige Abschrift des Dokuments:\n\n${gespeichert.slice(0, 120_000)}`,
                { model: 'claude-sonnet-5-5', maxSearches: 0, maxTokens: 2500, timeoutMs, ohneNachdenken: true },
              )
              gelesen.push({ name: d.name, ergebnis: 'gelesen' })
              return `### Unterlage aus der Akte: ${d.name}\n${text}`
            }
            const bytes = await ladeDokumentBytes(admin, d.url)
            if (bytes.length > 15 * 1024 * 1024) {
              gelesen.push({ name: d.name, ergebnis: 'nicht lesbar', hinweis: 'Datei größer als 15 MB' })
              return ''
            }
            const mediaType = istPdf ? 'application/pdf' : d.typ && d.typ.startsWith('image/') ? d.typ : 'image/jpeg'
            const block: ClaudeContentBlock = istBuero
              ? { type: 'text', text: bueroDateiText(d.name, d.typ, bytes, 80_000) ?? '' }
              : istPdf
                ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: bytesNachBase64(bytes) } }
                : { type: 'image', source: { type: 'base64', media_type: mediaType, data: bytesNachBase64(bytes) } }
            const text = await callClaudeResearch(
              [
                {
                  type: 'text',
                  text: STEUER_LESEAUFTRAG(d.name),
                },
                block,
              ],
              { model: 'claude-sonnet-5-5', maxSearches: 0, maxTokens: 2500, timeoutMs, ohneNachdenken: true },
            )
            gelesen.push({ name: d.name, ergebnis: 'gelesen' })
            return `### Unterlage aus der Akte: ${d.name}\n${text}`
          } catch (err) {
            gelesen.push({ name: d.name, ergebnis: 'nicht lesbar', hinweis: err instanceof Error ? err.message : String(err) })
            return ''
          }
        }),
      )
      await schreibe({ zwischen: { ...z.zwischen, unterlagen: auszuege.filter(Boolean).join('\n\n') }, gelesen, schrittNr: 2, versuch: 0, laeuftSeit: null })
    } else if (schritt.nr === 2) {
      // deno-lint-ignore no-explicit-any
      const notizen = ((kunde.activities ?? []) as any[]).slice(0, 15).map((a) => `- Notiz ${a.date}: ${a.text}`)
      const firmen = await callClaudeResearch(
        `${umfeldAuftrag({
          person,
          firma: kunde.firma,
          email: kunde.email,
          webseite: kunde.unternehmensbewertung?.webseite,
          bekannt: [...notizen, ...dokumente.slice(0, 40).map((d) => `- Dokument: ${d.name}`), z.zwischen?.unterlagen ? `\nAus gelesenen Unterlagen der Akte:\n${z.zwischen.unterlagen.slice(0, 3000)}` : ''].join('\n'),
        })}\n\nAntworte auf Deutsch als Liste der Firmen. Je Firma: genauer Name, Rechtsform, Sitz, Registernummer, Rolle der Person (Geschäftsführer, Gesellschafter mit Anteil falls bekannt), Branche, Status, Quelle (URL), Sicherheit der Zuordnung, und [NEU] oder [BEKANNT laut Akte].`,
        { model: 'claude-haiku-4-5-20251001', maxSearches: 8, maxTokens: 4096, timeoutMs },
      )
      await schreibe({ zwischen: { ...z.zwischen, firmen }, schrittNr: 3, versuch: 0, laeuftSeit: null })
    } else if (schritt.nr === 3) {
      const [zahlen, rechtsstand] = await Promise.all([
        callClaudeResearch(
          `Für die folgenden Firmen eines Kunden sollen die öffentlich und kostenlos einsehbaren Finanzdaten zusammengetragen werden.\n\nFirmen:\n${z.zwischen?.firmen ?? '(keine ermittelt)'}\n\nSuche je Firma nach offengelegten Jahresabschlüssen und Kennzahlen in kostenlos zugänglichen Quellen: Unternehmensregister (unternehmensregister.de), Bundesanzeiger (bundesanzeiger.de), Handelsregister-Bekanntmachungen sowie frei einsehbare Firmenprofile (z. B. northdata.de, companyhouse.de, openregister.de, implisense.com). Keine kostenpflichtigen Abrufe. Erfasse je Firma und Geschäftsjahr, soweit veröffentlicht: Bilanzsumme, Anlagevermögen, Umlaufvermögen, Eigenkapital, Gewinn- oder Verlustvortrag, Jahresüberschuss/-fehlbetrag, Rückstellungen, Verbindlichkeiten, Umsatz, Mitarbeiterzahl, Größenklasse (Kleinst/klein/mittel), sowie ob überhaupt ein Abschluss veröffentlicht ist. Kleine Gesellschaften veröffentlichen oft nur eine verkürzte Bilanz — das vermerken, nicht als Lücke werten. Jede Zahl mit Quelle (URL) und Geschäftsjahr. Was du nicht findest, als "nicht veröffentlicht/nicht gefunden" kennzeichnen — nichts schätzen. Antworte auf Deutsch, je Firma ein Abschnitt.`,
          { model: 'claude-haiku-4-5-20251001', maxSearches: 10, maxTokens: 4096, timeoutMs },
        ).catch((err) => `Öffentliche Finanzdaten konnten nicht abgerufen werden: ${err instanceof Error ? err.message : String(err)}`),
        callClaudeResearch(
          `Prüfe den zum ${heute} in Deutschland geltenden Rechtsstand für diese steuerlichen Gestaltungsmittel und nenne je Mittel die aktuellen Werte, Grenzen und Fristen mit Quelle (URL, möglichst Gesetzestext, BMF, IHK, Steuerberaterkammer oder Haufe/DATEV):\n1. Investitionsabzugsbetrag nach § 7g EStG (Prozentsatz, Höchstbetrag, Gewinngrenze, Investitionsfrist, Rückgängigmachung) und Sonderabschreibung nach § 7g Abs. 5 EStG.\n2. Geringwertige Wirtschaftsgüter und Sammelposten (Grenzen).\n3. Degressive Abschreibung für bewegliche Wirtschaftsgüter (gilt sie aktuell, für welche Anschaffungszeiträume, welcher Satz) und Sonderregeln für Elektrofahrzeuge sowie die Dienstwagenbesteuerung von Elektro- und Hybridfahrzeugen.\n4. Steuerfreie oder pauschal versteuerte Arbeitgeberleistungen: Sachbezugsfreigrenze, Aufmerksamkeiten, Essenszuschuss, Jobticket/Deutschlandticket, Kindergartenzuschuss, Gesundheitsförderung, Erholungsbeihilfe, Internetpauschale, Überlassung von Fahrrädern und Elektrogeräten.\n5. Betriebliche Altersversorgung für Gesellschafter-Geschäftsführer: Direktversicherung (steuer- und sozialversicherungsfreie Höchstbeträge, aktuelle Beitragsbemessungsgrenze), Pensionszusage (Anerkennungsvoraussetzungen wie Erdienbarkeit, Probezeit, Angemessenheit), Unterstützungskasse, Pensionsfonds.\n6. Thesaurierung und Ausschüttung: Körperschaftsteuersatz (auch beschlossene künftige Änderungen), Thesaurierungsbegünstigung § 34a EStG, Option zur Körperschaftsbesteuerung § 1a KStG, Steuerfreistellung von Beteiligungserträgen und Veräußerungsgewinnen § 8b KStG.\n7. Rücklage nach § 6b EStG, Gewerbesteuer-Freibetrag und Anrechnung nach § 35 EStG, Verlustrücktrag und -vortrag (aktuelle Höchstbeträge).\nKennzeichne ausdrücklich, was du nicht sicher belegen konntest. Antworte auf Deutsch als nummerierte Liste.`,
          { model: 'claude-haiku-4-5-20251001', maxSearches: 10, maxTokens: 4096, timeoutMs },
        ).catch((err) => `Der aktuelle Rechtsstand konnte nicht geprüft werden: ${err instanceof Error ? err.message : String(err)}`),
      ])
      await schreibe({ zwischen: { ...z.zwischen, zahlen, rechtsstand }, schrittNr: 4, versuch: 0, laeuftSeit: null })
    } else {
      const antwort = await callClaudeResearch(
        `Du bereitest für eine Beratungsholding ein Gespräch mit einem Mandanten und dessen Steuerberater vor. Aufgabe: konkrete Ansatzpunkte finden, wie der Mandant über ALLE seine Firmen hinweg Steuern sparen (dauerhaft) oder Steuern in spätere Jahre verlagern (zeitlich) kann. Heute ist der ${heute}.

Mandant: ${person} (in der Akte geführt als "${kunde.firma}")

1) Aus Unterlagen der Akte gelesen (BWA, Jahresabschluss, Strukturunterlagen):
${z.zwischen?.unterlagen || '(Es lag keine lesbare Finanzunterlage in der Akte vor.)'}

2) Firmen des Mandanten laut öffentlicher Recherche:
${z.zwischen?.firmen || '(keine ermittelt)'}

3) Öffentlich einsehbare Finanzdaten dieser Firmen:
${z.zwischen?.zahlen || '(keine gefunden)'}

4) Geprüfter aktueller Rechtsstand:
${z.zwischen?.rechtsstand || '(nicht geprüft)'}

Prüfe für jede Firma mindestens diese Ansätze und schlage nur vor, was zur jeweiligen Firma passt:
- Investitionsabzugsbetrag (§ 7g EStG) für geplante Anschaffungen und Sonderabschreibung; Auflösung/Frist bestehender Abzugsbeträge.
- Anschaffungen mit schneller Abschreibung (geringwertige Wirtschaftsgüter, Sammelposten, degressive Abschreibung, Elektrofahrzeuge), vorgezogene Instandhaltung und Aufwendungen vor dem Bilanzstichtag.
- Vergütung an Mitarbeiter über steuerfreie oder pauschal versteuerte Leistungen statt Lohnerhöhung (Sachbezug, Essenszuschuss, Jobticket, Kindergartenzuschuss, Gesundheitsförderung, Fahrrad- und Geräteüberlassung).
- Altersvorsorge der Geschäftsführer über die Firma (Direktversicherung, Pensionszusage, Unterstützungskasse) — Aufwand in der Firma, Vorteil beim Geschäftsführer.
- Darüber hinaus alles, was du selbst aus den Zahlen und der Firmenstruktur ableitest, z. B.: Gewinn in der Holding belassen statt ausschütten, Steuerfreistellung von Beteiligungserträgen, Mischung aus Geschäftsführergehalt und Ausschüttung, Verrechnung von Verlusten zwischen den Firmen (Organschaft), Vermietung zwischen den Firmen und Risiken einer Betriebsaufspaltung, Rücklage nach § 6b EStG, Rückstellungen, Gewerbesteuer, Verlagerung von Einnahmen und Ausgaben über den Jahreswechsel.

Regeln:
- Jeder Vorschlag gehört zu genau einer Firma (oder "Mandant persönlich" bzw. "firmenübergreifend").
- "wirkung": Rechne nur, wenn die nötigen Zahlen oben stehen, und zeige dann die Rechnung mit den verwendeten Zahlen. Sonst beschreibe die Wirkung in Worten und sage, welche Zahl für eine Rechnung fehlt. Erfinde keine Zahlen.
- "grundlage": Nenne genau, worauf sich der Vorschlag stützt (welche Unterlage, welche veröffentlichte Zahl mit Jahr, welche Annahme).
- "belastbarkeit": hoch nur, wenn er auf Zahlen aus Unterlagen der Akte beruht; mittel bei veröffentlichten Zahlen; niedrig, wenn er nur aus Branche und Struktur abgeleitet ist.
- "rechtsgrundlage": Paragraf und der oben geprüfte aktuelle Wert. Wo der Rechtsstand nicht sicher belegt ist, schreibe das dazu.
- "haken": ehrlich die Nachteile, Bindungen und Risiken (z. B. Verzinsung bei Rückgängigmachung, Liquiditätsabfluss, Anerkennung durch das Finanzamt, verdeckte Gewinnausschüttung).
- Einfache, klare Sprache ohne englische Begriffe. Kurze Sätze.
- Höchstens neun Vorschläge, die wichtigsten zuerst. Lieber wenige belastbare als viele allgemeine.
- Jedes Feld höchstens drei kurze Sätze, damit die Antwort vollständig bleibt.

Gib NUR einen einzelnen Codeblock mit reinem JSON zurück, exakt in dieser Form:
\`\`\`json
{"zusammenfassung": "drei bis fünf Sätze: Lage des Mandanten und die wichtigsten Hebel", "datenlage": "ein bis drei Sätze: wie gut die Zahlenbasis ist und was fehlt, um genauer zu werden", "vorschlaege": [{"titel": "", "art": "Steuerersparnis oder Steuerverlagerung", "firma": "", "massnahme": "", "wirkung": "", "voraussetzungen": "", "haken": "", "naechster_schritt": "", "rechtsgrundlage": "", "grundlage": "", "belastbarkeit": "hoch, mittel oder niedrig"}], "quellen": ["Titel – URL"]}
\`\`\``,
        { model: 'claude-sonnet-5-5', maxSearches: 0, maxTokens: 8192, timeoutMs, ohneNachdenken: true },
      )
      const m = antwort.match(/```json\s*([\s\S]*?)```/) ?? antwort.match(/(\{[\s\S]*\})/)
      if (!m) throw new Error('Die KI hat kein auswertbares Ergebnis geliefert.')
      // deno-lint-ignore no-explicit-any
      const ergebnis = JSON.parse(m[1]) as any
      // deno-lint-ignore no-explicit-any
      const vorschlaege: SteuerVorschlag[] = (Array.isArray(ergebnis.vorschlaege) ? ergebnis.vorschlaege : []).filter((v: any) => v?.titel && v?.massnahme).slice(0, 9)
      await schreibe({
        status: 'fertig',
        schritt: 'Fertig',
        schrittNr: undefined,
        laeuftSeit: null,
        zusammenfassung: String(ergebnis.zusammenfassung ?? ''),
        datenlage: String(ergebnis.datenlage ?? ''),
        vorschlaege,
        quellen: Array.isArray(ergebnis.quellen) ? ergebnis.quellen.map(String).slice(0, 30) : [],
        abgeschlossenAm: new Date().toISOString(),
      })
      return
    }
    await stosseRechercheSchrittAn(bereich, kundeId, 0, 'steuer_analyse_schritt')
  } catch (err) {
    console.error(`Steuer-Analyse, Schritt ${schritt.nr} fehlgeschlagen:`, err)
    const versuch = (z.versuch ?? 0) + 1
    if (versuch <= 2) {
      await schreibe({ versuch, laeuftSeit: null }).catch(() => {})
      await warteBisWorkerAbgeloestWird()
      await stosseRechercheSchrittAn(bereich, kundeId, 0, 'steuer_analyse_schritt')
    } else {
      await schreibe({
        status: 'fehler',
        laeuftSeit: null,
        fehler: `Schritt „${schritt.titel}" ist auch nach drei Versuchen gescheitert: ${err instanceof Error ? err.message : String(err)}`,
        abgeschlossenAm: new Date().toISOString(),
      }).catch(() => {})
    }
  }
}

// Beantwortet eine Frage zu einem per Copy/Paste im KI-Assistenten eingefügten Bild (z.B. ein
// Foto von einem Dokument oder einer Immobilie) — multimodale Eingabe über Claudes Vision-Fähigkeit,
// kein CRM-Datenzugriff wie bei assistant_answer.
async function answerWithImage(frage: string, imageBase64: string, mediaType: string): Promise<{ antwort: string }> {
  const result = await callClaudeTool<{ antwort: string }>(
    [
      {
        type: 'text',
        text: `Ein Mitarbeiter einer Beratungsholding hat dir ein Bild geschickt, dazu diese Frage/Anweisung: "${frage || 'Beschreibe/analysiere das Bild allgemein.'}". Antworte auf Deutsch, knapp und konkret, als reiner Fließtext ohne Tags oder Markup.`,
      },
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
    ],
    {
      name: 'ki_assistent_bildantwort',
      description: 'Beantwortet eine Frage zu einem mitgeschickten Bild.',
      input_schema: {
        type: 'object',
        properties: { antwort: { type: 'string' } },
        required: ['antwort'],
      },
    },
  )
  return { antwort: result.antwort.replace(/<\/?[a-zA-Z_][^>]*>/g, '').trim() }
}

// Diese Liste muss mit DOKUMENT_ORDNER in src/types/index.ts übereinstimmen — kein gemeinsames
// TS-Modul zwischen Frontend und Edge Function in diesem Projekt (Deno-Deploy ist eigenständig),
// daher wie an anderer Stelle (z.B. pflege_classify) redundant gepflegt.
const OBJEKT_DOKUMENT_ORDNER = [
  'Aktennotiz', 'Angebote', 'Baulastenauskunft', 'Betriebskostenabrechnung', 'Bilder', 'Energieausweis',
  'Exposé', 'Finanzierung', 'Flurkarte', 'Gebäudeversicherung', 'Genehmigung', 'Grundbuch', 'Grundrisse',
  'Gutachten', 'Kostenaufstellung', 'Lageplan', 'Leistungsverzeichnisse', 'Mieterliste', 'Mietverträge',
  'Notarielle Dokumente', 'Persönliche Daten des Eigentümers', 'Pläne', 'Protokolle', 'Sanierungsunterlagen',
  'Sonstiges', 'Teilungserklärung', 'Verträge', 'Wohnflächenberechnung',
]

type ObjektDokumentKlassifikation = {
  ordner: string
  vorgeschlagener_dateiname: string
  erkanntes_datum?: string
}

// KI-Dokumentenverarbeitung für die Immobilienabteilung (Quirin Lutzenberger, Immobilienfachwirt:
// "Mitarbeiter ziehen einfach 50 unsortierte PDFs in einen Eingangsordner, die KI erkennt
// Dokumenttyp + ordnet zu") — erkennt anhand des hochgeladenen Bilds/PDFs die passende
// Unterlagen-Kategorie, schlägt einen Dateinamen vor und liest, falls erkennbar, ein Datum aus dem
// Dokument. Die eigentliche Zuordnung zum Objekt passiert im Frontend nach Bestätigung durch den
// Mitarbeiter (kein blindes Automatisieren einer potenziell falschen Zuordnung).
async function classifyObjektDokument(mediaBase64: string, mediaType: string, dateiname: string): Promise<ObjektDokumentKlassifikation> {
  const istPdf = mediaType === 'application/pdf'
  const block: ClaudeContentBlock = istPdf
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: mediaBase64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: mediaBase64 } }
  return callClaudeTool<ObjektDokumentKlassifikation>(
    [
      {
        type: 'text',
        text: `Ein Mitarbeiter einer Immobilienabteilung hat eine Datei hochgeladen (ursprünglicher Dateiname: "${dateiname}"). Erkenne anhand des tatsächlichen Inhalts, um welche Art von Immobilien-Unterlage es sich handelt, und ordne sie genau einer dieser Kategorien zu: ${OBJEKT_DOKUMENT_ORDNER.join(', ')}. Passt wirklich keine davon, nimm "Sonstiges".

Schlage außerdem einen kurzen, aussagekräftigen deutschen Dateinamen vor (mit der ursprünglichen Dateiendung, ohne Leerzeichen, z.B. "Grundbuchauszug_Musterstrasse17.pdf").

Falls im Dokument selbst ein Datum erkennbar ist (z.B. Ausstellungsdatum, Stichtag), gib es im Format YYYY-MM-DD an — sonst lass das Feld weg.`,
      },
      block,
    ],
    {
      name: 'objekt_dokument_klassifikation',
      description: 'Erkennt die Unterlagen-Kategorie, einen Dateinamen-Vorschlag und ein Datum für ein hochgeladenes Immobilien-Dokument.',
      input_schema: {
        type: 'object',
        properties: {
          ordner: { type: 'string', enum: OBJEKT_DOKUMENT_ORDNER },
          vorgeschlagener_dateiname: { type: 'string' },
          erkanntes_datum: { type: 'string' },
        },
        required: ['ordner', 'vorgeschlagener_dateiname'],
      },
    },
    512,
  )
}

type RechnungsDaten = {
  nummer?: string
  datum?: string
  betrag_netto?: number
  betrag_brutto?: number
  zahlungsziel?: string
  aussteller?: string
  empfaenger?: string
}

type KundenDokumentKlassifikation = {
  erkannter_name?: string
  erkannte_firma?: string
  kategorie: string
  drehung?: number
  rechnung?: RechnungsDaten
}

// KI-Dokumentenverarbeitung für per Telegram geschickte Kunden-Unterlagen (siehe telegram-gateway):
// erkennt anhand des tatsächlichen Inhalts (nicht nur Bildunterschrift/Dateiname), zu welcher Person
// oder Firma eine Datei gehört, damit sie auch OHNE explizite Bildunterschrift automatisch der
// richtigen Kundenakte zugeordnet werden kann (vorher zwingend nötig, siehe Projektnotiz). Die
// eigentliche Zuordnung/ein etwaiges Neuanlegen passiert weiterhin im telegram-gateway, nie blind.
async function classifyKundenDokument(mediaBase64: string, mediaType: string, dateiname: string): Promise<KundenDokumentKlassifikation> {
  const istPdf = mediaType === 'application/pdf'
  const bueroText = istDocx(dateiname, mediaType) || istXlsx(dateiname, mediaType) || istCsv(dateiname, mediaType) ? bueroDateiText(dateiname, mediaType, base64NachBytes(mediaBase64), 40_000) : null
  const block: ClaudeContentBlock = bueroText
    ? { type: 'text', text: bueroText }
    : istPdf
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: mediaBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: mediaBase64 } }
  return callClaudeTool<KundenDokumentKlassifikation>(
    [
      {
        type: 'text',
        text: `Ein Mitarbeiter hat über Telegram eine Datei geschickt (ursprünglicher Dateiname: "${dateiname}"), die einer Kunden-/Mandantenakte in einem CRM zugeordnet werden soll. Erkenne anhand des TATSÄCHLICHEN INHALTS der Datei (nicht nur des Dateinamens):
- den Namen der Person, zu der die Unterlage gehört (z.B. Kontoinhaber, Unterzeichner, im Ausweis genannte Person), exakt so wie er im Dokument steht — falls nicht erkennbar, weglassen.
- die Firma/den Betrieb, falls im Dokument genannt (z.B. im Briefkopf, Handelsregisterauszug, Mietvertrag) — falls nicht erkennbar, weglassen.
- eine kurze Kategorie der Unterlage (z.B. "BWA", "Kontoauszug", "Personalausweis", "Mietvertrag", "Lohnabrechnung", "Steuerbescheid", "Handelsregisterauszug", "Gesellschaftervertrag", "Selbstauskunft", "Schufa-Auskunft", "Sonstiges").
- ob die Datei verdreht eingescannt wurde: um wie viel Grad sie IM UHRZEIGERSINN gedreht werden muss, damit der Text aufrecht lesbar ist. Seiten, die bereits richtig liegen, brauchen 0. Maßgeblich ist, wie die Seite gerade aussieht: 180 = der Text steht auf dem Kopf; 90 = die Oberkante des Textes zeigt gerade nach links; 270 = die Oberkante des Textes zeigt gerade nach rechts. Eine Seite im Querformat, deren Text normal lesbar ist, ist NICHT verdreht.
- Ist das Dokument eine Rechnung, fülle zusätzlich rechnung aus: Rechnungsnummer, Rechnungsdatum, Netto- und Bruttobetrag, Aussteller und Empfänger. Beträge nur angeben, wenn sie eindeutig lesbar sind — lieber weglassen als raten.`,
      },
      block,
    ],
    {
      name: 'kunden_dokument_klassifikation',
      description: 'Erkennt Person/Firma und Unterlagenart für eine per Telegram geschickte Kunden-Datei.',
      input_schema: {
        type: 'object',
        properties: {
          erkannter_name: { type: 'string' },
          erkannte_firma: { type: 'string' },
          kategorie: { type: 'string' },
          drehung: { type: 'integer', enum: [0, 90, 180, 270], description: 'Nötige Drehung im Uhrzeigersinn in Grad, damit der Text aufrecht steht. 0, wenn die Datei richtig herum ist.' },
          rechnung: {
            type: 'object',
            description: 'NUR ausfüllen, wenn das Dokument eine Rechnung ist.',
            properties: {
              nummer: { type: 'string', description: 'Rechnungsnummer exakt wie im Dokument.' },
              datum: { type: 'string', description: 'Rechnungsdatum im Format JJJJ-MM-TT.' },
              betrag_netto: { type: 'number', description: 'Nettobetrag in Euro als Zahl, z.B. 3250.00.' },
              betrag_brutto: { type: 'number', description: 'Bruttobetrag (Gesamtbetrag) in Euro als Zahl, z.B. 3867.50.' },
              zahlungsziel: { type: 'string', description: 'Fälligkeit im Format JJJJ-MM-TT, falls genannt oder aus einer Zahlungsfrist berechenbar.' },
              aussteller: { type: 'string', description: 'Wer die Rechnung stellt (Briefkopf/Absender), exakt wie im Dokument.' },
              empfaenger: { type: 'string', description: 'An wen die Rechnung gerichtet ist, exakt wie im Dokument.' },
            },
          },
        },
        required: ['kategorie'],
      },
    },
    512,
  )
}

type ScanTeildokument = {
  start_seite: number
  end_seite: number
  kategorie: string
  erkannter_name?: string
  erkanntes_datum?: string
  vorgeschlagener_dateiname: string
  rechnung?: RechnungsDaten
}

type ScanAufteilung = {
  erkannter_name?: string
  erkannte_firma?: string
  dokumente: ScanTeildokument[]
  seiten_drehung?: { seite: number; grad: number }[]
}

// Analysiert einen mehrseitigen Sammel-Scan (z.B. ein ganzer Ordner Kundenunterlagen in einem
// Rutsch gescannt) und erkennt die einzelnen darin enthaltenen Einzeldokumente mit Seitenbereich,
// Kategorie, Datum und Dateinamen-Vorschlag — die eigentliche Aufteilung der PDF-Datei in echte
// Einzeldateien passiert im aufrufenden Kanal (telegram-gateway), hier wird nur die Struktur
// erkannt. Seitenzählung ist 1-basiert. Erkennt das Modell nur EIN zusammenhängendes Dokument,
// kommt trotzdem ein einzelner Eintrag zurück, der den gesamten Seitenbereich abdeckt — das
// Aufteilen wird dann zu einem Durchlauf ohne echte Trennung.
async function splitScanDokument(mediaBase64: string, dateiname: string, seitenzahl: number): Promise<ScanAufteilung> {
  return callClaudeTool<ScanAufteilung>(
    [
      {
        type: 'text',
        text: `Ein Mitarbeiter hat Papierunterlagen zu EINEM Kunden/Mandanten eingescannt und als eine PDF-Datei geschickt (ursprünglicher Dateiname: "${dateiname}", ${seitenzahl} Seiten). Das kann EIN einziges mehrseitiges Dokument sein (z.B. ein Vertrag über 12 Seiten, ein Bescheid mit Anlagen, ein mehrseitiges Protokoll) oder ein Stapel mehrerer unterschiedlicher Dokumente hintereinander (z.B. erst ein Kontoauszug, dann eine Lohnabrechnung, dann ein Mietvertrag). Entscheide das allein anhand des Inhalts.

Analysiere den tatsächlichen Inhalt jeder Seite. Seiten gehören zum selben Dokument, wenn der Text fortläuft, die Seitennummerierung weiterzählt ("Seite 2 von 5"), Briefkopf, Aktenzeichen, Vertragsparteien oder Vorgang dieselben bleiben oder eine Seite erkennbar Anlage/Fortsetzung der vorigen ist. Ein neues Dokument beginnt nur dort, wo der Inhalt das klar zeigt: neuer Briefkopf oder Absender, neue Überschrift mit anderem Thema, anderes Datum und anderer Vorgang, deutlich anderes Layout. Trenne im Zweifel NICHT — ein fälschlich zerrissenes Dokument ist schlimmer als zwei zusammengebliebene.

Gib für jedes erkannte Dokument zurück: den Seitenbereich (1-basiert, erste und letzte Seite), eine kurze Kategorie (z.B. "BWA", "Kontoauszug", "Personalausweis", "Mietvertrag", "Lohnabrechnung", "Steuerbescheid", "Handelsregisterauszug", "Gesellschaftervertrag", "Selbstauskunft", "Schufa-Auskunft", "Sonstiges"), falls im Dokument ein Datum erkennbar ist (Ausstellungsdatum, Abrechnungsmonat o.ä.) im Format YYYY-MM-DD oder YYYY-MM, und einen kurzen aussagekräftigen deutschen Dateinamen-Vorschlag (mit ".pdf"-Endung, ohne Leerzeichen). Bilde den Dateinamen immer nach demselben Muster Art_Bezug_Datum.pdf, damit dasselbe Dokument bei jedem Scan gleich heißt: Bezug ist bei Rechnungen die Rechnungsnummer, bei Verträgen und Vereinbarungen der Vertragsgegenstand, sonst der Aussteller; Datum im Format JJJJ-MM-TT, soweit erkennbar. Jede Seite gehört zu genau einem Dokument; die Seitenbereiche decken zusammen die Seiten 1 bis ${seitenzahl} lückenlos ab. Ist das Dokument eine Rechnung, fülle zusätzlich rechnung aus: Rechnungsnummer, Rechnungsdatum, Netto- und Bruttobetrag, Aussteller und Empfänger. Beträge nur angeben, wenn sie eindeutig lesbar sind — lieber weglassen als raten.

Gehört erkennbar alles zu derselben Person/Firma, nenne diese einmal zentral (Name und/oder Firma, exakt wie im Dokument geschrieben). Ist die gesamte Datei ein einziges zusammenhängendes Dokument, gib genau einen Eintrag zurück, der die Seiten 1 bis ${seitenzahl} abdeckt.

Prüfe außerdem jede Seite darauf, ob sie verdreht eingescannt wurde, und liste unter seiten_drehung jede verdrehte Seite mit der Gradzahl, um die sie IM UHRZEIGERSINN gedreht werden muss, damit der Text aufrecht lesbar ist. Seiten, die bereits richtig liegen, lässt du weg. Maßgeblich ist, wie die Seite gerade aussieht: 180 = der Text steht auf dem Kopf; 90 = die Oberkante des Textes zeigt gerade nach links; 270 = die Oberkante des Textes zeigt gerade nach rechts. Eine Seite im Querformat, deren Text normal lesbar ist, ist NICHT verdreht.`,
      },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: mediaBase64 } },
    ],
    {
      name: 'scan_aufteilung',
      description: 'Erkennt die einzelnen Dokumente innerhalb eines mehrseitigen Sammel-Scans mit Seitenbereichen.',
      input_schema: {
        type: 'object',
        properties: {
          erkannter_name: { type: 'string' },
          erkannte_firma: { type: 'string' },
          dokumente: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                start_seite: { type: 'integer' },
                end_seite: { type: 'integer' },
                kategorie: { type: 'string' },
                erkannter_name: { type: 'string' },
                erkanntes_datum: { type: 'string' },
                vorgeschlagener_dateiname: { type: 'string' },
                rechnung: {
                  type: 'object',
                  description: 'NUR ausfüllen, wenn das Dokument eine Rechnung ist.',
                  properties: {
                    nummer: { type: 'string', description: 'Rechnungsnummer exakt wie im Dokument.' },
                    datum: { type: 'string', description: 'Rechnungsdatum im Format JJJJ-MM-TT.' },
                    betrag_netto: { type: 'number', description: 'Nettobetrag in Euro als Zahl, z.B. 3250.00.' },
                    betrag_brutto: { type: 'number', description: 'Bruttobetrag (Gesamtbetrag) in Euro als Zahl, z.B. 3867.50.' },
                    zahlungsziel: { type: 'string', description: 'Fälligkeit im Format JJJJ-MM-TT, falls genannt oder aus einer Zahlungsfrist berechenbar.' },
                    aussteller: { type: 'string', description: 'Wer die Rechnung stellt (Briefkopf/Absender), exakt wie im Dokument.' },
                    empfaenger: { type: 'string', description: 'An wen die Rechnung gerichtet ist, exakt wie im Dokument.' },
                  },
                },
              },
              required: ['start_seite', 'end_seite', 'kategorie', 'vorgeschlagener_dateiname'],
            },
          },
          seiten_drehung: {
            type: 'array',
            description: 'Nur die verdreht eingescannten Seiten.',
            items: {
              type: 'object',
              properties: {
                seite: { type: 'integer', description: 'Seitennummer im Gesamt-Scan, 1-basiert.' },
                grad: { type: 'integer', enum: [90, 180, 270], description: 'Nötige Drehung im Uhrzeigersinn.' },
              },
              required: ['seite', 'grad'],
            },
          },
        },
        required: ['dokumente'],
      },
    },
    4096,
    'claude-sonnet-5-5',
    'auto',
  )
}

// Nachfolger von scripts/extract-leads.mjs — macht dasselbe, aber automatisch und nur für Absender,
// die wirklich neu sind (noch kein Kunde, noch kein Lead-Vorschlag), statt bei jedem Lauf alle
// jemals eingegangenen E-Mails erneut zu klassifizieren.
const INTERNE_DOMAINS = ['amayer-holding.com', 'fundament-it.de']
const LEAD_BEREICHE = ['beratung', 'immobilien', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']
// bereich_vorschlag (Klassifizierer-Ausgabe) -> echter bereich-Wert in der kunden-Tabelle. "immobilien"
// heißt dort "immobilienkunden" (siehe kundenBereiche.ts), "unklar" wird unten auf "beratung" gemappt.
const BEREICH_VORSCHLAG_ZU_KUNDE_BEREICH: Record<string, string> = {
  beratung: 'beratung',
  immobilien: 'immobilienkunden',
  erben: 'erben',
  betriebsuebergabe: 'betriebsuebergabe',
  betriebsformen: 'betriebsformen',
  akademie: 'akademie',
  finanzierungen: 'finanzierungen',
}

type LeadGruppe = { email: string; vonName: string; mails: { betreff: string; ausschnitt: string; datum: string }[] }
type LeadErgebnis = {
  email: string
  relevant: boolean
  firma?: string
  name?: string
  telefon?: string
  bereich_vorschlag: string
  notiz: string
}

async function fetchAlleEingegangeneEmails(supabase: ReturnType<typeof createClient>) {
  const pageSize = 1000
  const all: { von: string; von_name: string; betreff: string; ausschnitt: string; mail_datum: string }[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('eingegangene_emails')
      .select('von, von_name, betreff, ausschnitt, mail_datum')
      .order('mail_datum', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    all.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return all
}

async function classifyLeadBatch(gruppen: LeadGruppe[]): Promise<LeadErgebnis[]> {
  const list = gruppen
    .map((g, i) => {
      const beispiele = g.mails
        .slice(0, 5)
        .map((m) => `  - "${m.betreff}" (${(m.datum ?? '').slice(0, 10)}): ${(m.ausschnitt ?? '').slice(0, 200)}`)
        .join('\n')
      return `${i + 1}. email=${g.email}\nName lt. Absenderfeld: ${g.vonName}\nAnzahl E-Mails: ${g.mails.length}\nBeispiele:\n${beispiele}`
    })
    .join('\n\n')

  const result = await callClaudeTool<{ ergebnisse: LeadErgebnis[] }>(
    `Du hilfst, aus dem E-Mail-Postfach einer Unternehmensberatungs-/Immobilien-/Finanzierungsholding (Mayer Holding, Bereiche: Unternehmensberatung, Immobilien, Erben, Betriebsübergabe, Betriebsformen, Akademie, Finanzierungen) Lead-Vorschläge für das CRM zu extrahieren. Du bekommst pro Absender eine Zusammenfassung mehrerer E-Mails. Bewerte pro Absender, ob es sich um einen echten (potenziellen) Kunden/Mandanten handelt, und falls ja, zu welchem Geschäftsbereich das am besten passt — orientiere dich dabei in erster Linie daran, WER die Leistung in Anspruch nimmt bzw. nehmen möchte (z. B. ein Beratungsmandat läuft über "Unternehmensberatung", auch wenn im Text auch andere Themen wie Immobilien oder Holding-Strukturen erwähnt werden, solange die eigentliche Dienstleistung Unternehmensberatung ist).

WICHTIG: Jeder als relevant markierte Absender wird ohne weitere menschliche Prüfung sofort als Kundenakte angelegt. Markiere deshalb NUR als relevant, wer selbst eine Leistung der Mayer Holding in Anspruch nimmt oder erkennbar nehmen möchte. NICHT relevant (relevant=false) sind insbesondere:
- Anbieter/Dienstleister, die der Holding selbst etwas verkaufen oder anbieten wollen (Kaltakquise, Newsletter, Software-/KI-Angebote, Fördermittel- oder Marketingberater, Objekt- oder Fahrzeugangebote).
- Anwälte, Gerichte, Behörden, Insolvenzverwalter, Banken oder Steuerberater, die in eigener Sache oder zu einem Rechtsstreit/Verfahren schreiben.
- Interne Kommunikation: Geschäftsführung, Mitarbeiter und Partner der Holding, auch wenn sie von einer privaten Adresse schreiben.
Im Zweifel relevant=false.

Absender:

${list}`,
    {
      name: 'lead_vorschlaege',
      description: 'Extrahiert pro E-Mail-Absender einen strukturierten Lead-Vorschlag für ein CRM.',
      input_schema: {
        type: 'object',
        properties: {
          ergebnisse: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                relevant: { type: 'boolean', description: 'true, wenn dies ein echter potenzieller oder bestehender Kunde/Mandant ist, false bei Restrauschen (z.B. interne Kommunikation, Dienstleister, kein Geschäftsbezug).' },
                firma: { type: 'string', description: 'Firmenname, falls erkennbar, sonst leer lassen.' },
                name: { type: 'string', description: 'Name der Kontaktperson.' },
                telefon: { type: 'string', description: 'Telefonnummer, falls im Text erwähnt, sonst leer lassen.' },
                bereich_vorschlag: { type: 'string', enum: [...LEAD_BEREICHE, 'unklar'], description: 'Welcher Geschäftsbereich am besten passt.' },
                notiz: { type: 'string', description: 'Ein bis zwei Sätze: worum es geht / aktueller Stand, als Aktivitätsnotiz fürs CRM.' },
              },
              required: ['email', 'relevant', 'bereich_vorschlag', 'notiz'],
            },
          },
        },
        required: ['ergebnisse'],
      },
    },
    4096, // 1024 (Standard) reicht nicht für bis zu 8 Absender mit je eigener Begründung — Antwort
    // wurde sonst stillschweigend nach wenigen Einträgen abgeschnitten.
  )
  return result.ergebnisse ?? []
}

async function classifyNewLeads(): Promise<{ geprueft: number; vorgeschlagen: number; uebersprungen: number }> {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const emails = await fetchAlleEingegangeneEmails(supabase)
  // Echte Mitarbeiter nutzen teils private E-Mail-Adressen (gmx.de, hotmail.com, ...) für
  // Geschäftskorrespondenz statt der amayer-holding.com-Adresse — ohne diesen Abgleich würden sie
  // bei entsprechendem Mail-Volumen fälschlich als externer Lead angelegt (siehe echter Fall: Hasan
  // Süslü/Quirin Lutzenberger wurden so am 02.11.2026 versehentlich als Kunden angelegt).
  const { data: mitarbeiterRows } = await supabase.from('mitarbeiter').select('email')
  const mitarbeiterEmails = new Set((mitarbeiterRows ?? []).map((m: { email: string }) => m.email.trim().toLowerCase()))

  const gruppenMap = new Map<string, LeadGruppe>()
  for (const e of emails) {
    const email = (e.von ?? '').trim().toLowerCase()
    if (!email || !email.includes('@')) continue
    const domain = email.split('@')[1]
    if (INTERNE_DOMAINS.includes(domain)) continue
    if (mitarbeiterEmails.has(email)) continue
    if (!gruppenMap.has(email)) gruppenMap.set(email, { email, vonName: e.von_name, mails: [] })
    gruppenMap.get(email)!.mails.push({ betreff: e.betreff, ausschnitt: e.ausschnitt, datum: e.mail_datum })
  }

  // Bereits bekannte Absender (bestehender Kunde ODER schon als "offen"/übernommener Lead-Vorschlag
  // bewertet) werden nicht erneut klassifiziert. AUSNAHME: ein als "nicht_relevant" abgelehnter
  // Absender wird erneut geprüft, sobald seitdem eine NEUE E-Mail von ihm eingegangen ist — sonst
  // bleibt ein Absender für immer "nicht relevant", selbst wenn später eine eindeutig geschäftliche
  // Mail folgt (echter Fall: erste Mail von Christopher Lipps war nur "hier meine Adresse" und
  // korrekt abgelehnt, die beiden Mails danach kündigten ein echtes Erstgespräch samt Unterlagen
  // und eine Rechnung an — wurden aber nie mehr geprüft, weil der Absender schon einen Eintrag hatte).
  const [{ data: bekannteKunden }, { data: bekannteLeads }] = await Promise.all([
    supabase.from('kunden').select('email'),
    supabase.from('vorgeschlagene_leads').select('email, status, erstellt_am'),
  ])
  const kundenEmails = new Set((bekannteKunden ?? []).map((r: { email: string }) => (r.email ?? '').trim().toLowerCase()))
  const endgueltigBekannt = new Set(
    (bekannteLeads ?? [])
      .filter((r: { status: string }) => r.status !== 'nicht_relevant')
      .map((r: { email: string }) => (r.email ?? '').trim().toLowerCase()),
  )
  const abgelehntSeit = new Map(
    (bekannteLeads ?? [])
      .filter((r: { status: string }) => r.status === 'nicht_relevant')
      .map((r: { email: string; erstellt_am: string }) => [(r.email ?? '').trim().toLowerCase(), new Date(r.erstellt_am).getTime()]),
  )

  const neueGruppen = [...gruppenMap.values()].filter((g) => {
    if (kundenEmails.has(g.email) || endgueltigBekannt.has(g.email)) return false
    const abgelehntAm = abgelehntSeit.get(g.email)
    if (abgelehntAm === undefined) return true // wirklich neuer Absender
    return g.mails.some((m) => new Date(m.datum).getTime() > abgelehntAm) // seitdem neue Mail(s) -> erneut prüfen
  })
  if (neueGruppen.length === 0) return { geprueft: 0, vorgeschlagen: 0, uebersprungen: 0 }

  const byEmail = new Map(neueGruppen.map((g) => [g.email, g]))
  const batches: LeadGruppe[][] = []
  for (let i = 0; i < neueGruppen.length; i += 8) batches.push(neueGruppen.slice(i, i + 8))

  let vorgeschlagen = 0
  let uebersprungen = 0
  for (const batch of batches) {
    const ergebnisse = await classifyLeadBatch(batch)
    for (const r of ergebnisse) {
      const gruppe = byEmail.get((r.email ?? '').trim().toLowerCase())
      if (!gruppe) continue
      if (!r.relevant) {
        // Trotzdem anlegen (Status "nicht_relevant", taucht nie unter "Neue Leads" auf) — sonst würde
        // dieser Absender bei jedem künftigen Lauf erneut (unnötig) klassifiziert werden.
        await supabase.from('vorgeschlagene_leads').upsert(
          // erstellt_am mitschreiben: sonst gilt jede Mail nach der ERSTEN Ablehnung für immer als "neu"
          // und derselbe Absender wird bei jedem Lauf (alle paar Minuten per Cron) erneut klassifiziert.
          { quelle: 'email-analyse', email: gruppe.email, name: r.name || gruppe.vonName, status: 'nicht_relevant', notiz: r.notiz, erstellt_am: new Date().toISOString() },
          { onConflict: 'email' },
        )
        uebersprungen++
        continue
      }
      // Direkt als Kunde anlegen statt nur als Vorschlag abzulegen — der Nutzer will keinen manuellen
      // "Übernehmen"-Klick mehr pro Lead. Der Mitarbeiter-Abgleich oben (siehe Kommentar beim
      // Lipps-Fall) bleibt die eigentliche Sicherung gegen Fehlzuordnungen; zusätzlich landet jeder so
      // angelegte Kunde mit einer klar als "automatisch" markierten Aktivitätsnotiz in der Akte, damit
      // ein Fehlgriff beim nächsten Öffnen sofort auffällt statt sich zu verstecken.
      const heute = new Date().toISOString().slice(0, 10)
      const bereich = BEREICH_VORSCHLAG_ZU_KUNDE_BEREICH[r.bereich_vorschlag] ?? 'beratung'
      const kundeId = `k_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
      const { error: kundeError } = await supabase.from('kunden').insert({
        id: kundeId,
        bereich,
        firma: r.firma || r.name || gruppe.vonName || gruppe.email,
        ansprechpartner: r.name || gruppe.vonName || '',
        email: gruppe.email,
        telefon: r.telefon || '',
        prioritaet: 'Mittel',
        status: 'lead',
        follow_up: { date: heute, note: 'Erstkontakt aufnehmen', done: false },
        verantwortlich: '',
        letzte_aktivitaet: heute,
        activities: [
          {
            id: crypto.randomUUID(),
            date: heute,
            text: `Automatisch aus eingehender Mail angelegt${r.bereich_vorschlag === 'unklar' ? ' (Bereich unklar, Beratung als Standard gesetzt — bitte prüfen)' : ''}: „${r.notiz}"`,
            user: 'KI-Lead-Analyse (automatisch)',
          },
        ],
      })
      const { error } = await supabase.from('vorgeschlagene_leads').upsert(
        {
          quelle: 'email-analyse',
          email: gruppe.email,
          name: r.name || gruppe.vonName,
          firma: r.firma || null,
          telefon: r.telefon || null,
          bereich_vorschlag: r.bereich_vorschlag,
          notiz: r.notiz,
          status: kundeError ? 'offen' : 'uebernommen',
          rohdaten: {
            anzahl_mails: gruppe.mails.length,
            erste_mail: gruppe.mails.at(-1)?.datum,
            letzte_mail: gruppe.mails[0]?.datum,
            ...(kundeError ? { fehler: kundeError.message } : { automatisch_angelegter_kunde: kundeId, bereich }),
          },
        },
        { onConflict: 'email' },
      )
      if (!error) vorgeschlagen++
    }
  }
  return { geprueft: neueGruppen.length, vorgeschlagen, uebersprungen }
}

type KampagnenEntwurf = { betreff: string; text: string }

// Entwirft Betreff + Text für eine Segment-/Kampagnen-Mail (z.B. den zweiwöchentlichen Newsletter)
// anhand eines kurz beschriebenen Ziels. Nutzt {{firma}}/{{ansprechpartner}} als Platzhalter, damit
// der Text beim Versand pro Empfänger personalisiert werden kann (siehe applyMailVorlage im Frontend).
async function draftCampaign(ziel: string): Promise<KampagnenEntwurf> {
  return callClaudeTool<KampagnenEntwurf>(
    `Du verfasst eine E-Mail für eine Beratungsholding (Andreas Mayer Holding, Ulm), die an eine ausgewählte Gruppe bestehender Kunden/Mandanten verschickt wird. Ziel/Thema der Mail: "${ziel}".

Schreibe einen kurzen, prägnanten Betreff und einen freundlichen, professionellen Mailtext auf Deutsch, in einfacher und klarer Sprache ohne Anglizismen oder Fachjargon. Verwende im Text genau einmal die Platzhalter {{firma}} und {{ansprechpartner}} an einer passenden Stelle (z. B. in der Anrede), damit die Mail pro Empfänger personalisiert werden kann. Der Text soll ca. 4-8 Sätze lang sein, mit einer klaren Grußformel enden ("Mit freundlichen Grüßen\\nIhr Team der Andreas Mayer Holding") und keine Platzhalter außer {{firma}}/{{ansprechpartner}} enthalten.`,
    {
      name: 'kampagnen_entwurf',
      description: 'Entwirft Betreff und Text für eine Segment-/Kampagnen-Mail.',
      input_schema: {
        type: 'object',
        properties: {
          betreff: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['betreff', 'text'],
      },
    },
  )
}

// Modul 3 (Immobilienradar-Integration): das separate "immobilien-radar"-Projekt (eigenes Repo,
// eigene GitHub-Pages-Deployment) scrapt kleinanzeigen.de 3x täglich und veröffentlicht die
// Ergebnisse als öffentliche, aber ~40 MB große JSON-Datei. Vorher musste ein Mitarbeiter das
// Dashboard von Hand durchsuchen und Eckdaten per Copy/Paste in ein Formular übertragen — diese
// Funktion lädt die Datei stattdessen serverseitig, filtert auf die vielversprechendsten Treffer
// und reicht nur die fürs Auswahl-Modal nötigen Felder weiter (nicht die vollen ~40 MB, die ein
// Mitarbeiter-Browser nicht laden sollte).
type ImmoRadarRohTreffer = {
  id: string
  url: string
  title: string
  plz?: string
  ort?: string
  bundesland?: string
  wohnflaeche_m2?: number
  grundstuecksflaeche_m2?: number
  preis_eur?: number
  preis_pro_m2?: number
  objekt_typ_label?: string
  beschreibung?: string
  lukrativitaet?: { label?: string; score?: number; chancen?: string[]; risiken?: string[] }
  ki_einschaetzung?: { status?: string; text?: string }
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

const LUKRATIVITAET_RANG: Record<string, number> = { sehr_interessant: 5, interessant: 4, neutral: 3, zu_wenig_daten: 2, eher_unattraktiv: 1, unattraktiv: 0 }

async function fetchImmoRadarTopListings(): Promise<ImmoRadarTreffer[]> {
  const res = await fetch('https://eray-hash.github.io/immobilien-radar/data/listings.json')
  if (!res.ok) throw new Error(`ImmoRadar-Daten konnten nicht geladen werden (${res.status})`)
  const data = (await res.json()) as { listings: ImmoRadarRohTreffer[] }

  return data.listings
    .filter((l) => l.lukrativitaet?.label === 'sehr_interessant' || l.lukrativitaet?.label === 'interessant')
    .sort((a, b) => (LUKRATIVITAET_RANG[b.lukrativitaet?.label ?? ''] ?? 0) - (LUKRATIVITAET_RANG[a.lukrativitaet?.label ?? ''] ?? 0) || (b.lukrativitaet?.score ?? 0) - (a.lukrativitaet?.score ?? 0))
    .slice(0, 150)
    .map((l) => ({
      id: l.id,
      url: l.url,
      titel: l.title,
      ort: [l.plz, l.ort].filter(Boolean).join(' '),
      bundesland: l.bundesland ?? '',
      flaecheM2: l.wohnflaeche_m2 ?? l.grundstuecksflaeche_m2 ?? null,
      kaufpreis: l.preis_eur ?? null,
      preisProM2: l.preis_pro_m2 ?? null,
      objektTypLabel: l.objekt_typ_label ?? '',
      lukrativitaet: (l.lukrativitaet?.label ?? 'neutral').replace(/_/g, ' '),
      score: l.lukrativitaet?.score ?? 0,
      beschreibung: (l.beschreibung ?? '').slice(0, 400),
      kiEinschaetzung: l.ki_einschaetzung?.status === 'ok' ? l.ki_einschaetzung.text ?? null : null,
    }))
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response(null, { headers })

  const sharedSecret = Deno.env.get('CRM_SHARED_SECRET')
  if (sharedSecret && req.headers.get('x-crm-secret') !== sharedSecret) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), { status: 401, headers })
  }

  try {
    const body = await req.json()

    if (body.action === 'sync') {
      const mails = await syncInbox(Math.min(Number(body.limit ?? 20), 50))
      return new Response(JSON.stringify({ mails }), { headers })
    }

    if (body.action === 'send') {
      const { to, toName, subject, text, html, kundeBereich, kundeId, kundeName, attachments } = body
      if (!to || !subject || !text) {
        return new Response(JSON.stringify({ error: 'to, subject und text sind Pflichtfelder' }), { status: 400, headers })
      }
      await sendMail(to, subject, text, html, attachments)

      // Für den "Gesendet"-Ordner im Postfach mitschreiben — best effort, ein Fehler hier darf den
      // bereits erfolgreich versendeten Mailversand nicht als fehlgeschlagen melden.
      try {
        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
        await supabase.from('gesendete_emails').insert({
          an: to,
          an_name: toName ?? to,
          betreff: subject,
          text,
          kunde_bereich: kundeBereich ?? null,
          kunde_id: kundeId ?? null,
          kunde_name: kundeName ?? null,
        })
      } catch (logErr) {
        console.error('Konnte gesendete Mail nicht protokollieren:', logErr)
      }

      // Erkennt automatisch, ob eine gesendete Mail an einen Kunden eine Rechnung ist, und legt sie
      // direkt im CRM ab (Nutzer-Entscheidung 2026-11-06) — bisher wurden per Mail gestellte
      // Rechnungen nirgends im CRM erfasst, nur die manuell über "Neue Rechnung" angelegten. Best
      // effort: ein Fehler hier darf den bereits erfolgreich versendeten Mailversand nicht stören.
      if (kundeId) {
        try {
          await erkenneRechnungUndLegeAn(kundeId, subject, text)
        } catch (err) {
          console.error('Rechnungs-Erkennung fehlgeschlagen:', err)
        }
      }

      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    if (body.action === 'summarize') {
      const { transcript } = body
      if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
        return new Response(JSON.stringify({ error: 'transcript ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const summary = await summarizeTranscript(transcript)
      return new Response(JSON.stringify({ summary }), { headers })
    }

    if (body.action === 'assistant_classify') {
      const { transcript, heute } = body
      if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
        return new Response(JSON.stringify({ error: 'transcript ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const klassifikation = await classifyAssistantInput(transcript, heute || new Date().toISOString().slice(0, 10))
      return new Response(JSON.stringify({ klassifikation }), { headers })
    }

    if (body.action === 'assistant_answer') {
      const { frage, kontext } = body
      if (!frage || typeof frage !== 'string' || !frage.trim()) {
        return new Response(JSON.stringify({ error: 'frage ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const { antwort } = await answerAssistantQuestion(frage, kontext ?? '')
      return new Response(JSON.stringify({ antwort }), { headers })
    }

    if (body.action === 'generiere_expose') {
      const { bezeichnung, adresse, typ, kaufpreis } = body
      if (!bezeichnung || typeof bezeichnung !== 'string') {
        return new Response(JSON.stringify({ error: 'bezeichnung ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const { expose_text } = await generiereExpose(bezeichnung, adresse ?? '', typ ?? '', Number(kaufpreis) || 0)
      return new Response(JSON.stringify({ exposeText: expose_text }), { headers })
    }

    if (body.action === 'firmenwissen_answer') {
      const { frage, kontext } = body
      if (!frage || typeof frage !== 'string' || !frage.trim()) {
        return new Response(JSON.stringify({ error: 'frage ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const { antwort } = await answerFirmenwissen(frage, kontext ?? '')
      return new Response(JSON.stringify({ antwort }), { headers })
    }

    if (body.action === 'pflege_classify') {
      const { text } = body
      if (!text || typeof text !== 'string' || !text.trim()) {
        return new Response(JSON.stringify({ error: 'text ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const klassifikation = await classifyPflegeInput(text)
      return new Response(JSON.stringify({ klassifikation }), { headers })
    }

    if (body.action === 'kunden_umfeld_recherche') {
      const { person, firma, email, webseite, bekannt } = body
      if (!person && !firma) {
        return new Response(JSON.stringify({ error: 'person oder firma ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const ergebnis = await rechercheKundenUmfeld({
        person: String(person ?? ''),
        firma: String(firma ?? ''),
        email: typeof email === 'string' ? email : undefined,
        webseite: typeof webseite === 'string' ? webseite : undefined,
        bekannt: typeof bekannt === 'string' ? bekannt.slice(0, 6000) : '',
      })
      return new Response(JSON.stringify(ergebnis), { headers })
    }

    if (body.action === 'potenzial_analyse') {
      const { kontext } = body
      if (!kontext || typeof kontext !== 'string' || !kontext.trim()) {
        return new Response(JSON.stringify({ error: 'kontext ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const { chancen } = await analysePotenzial(kontext)
      return new Response(JSON.stringify({ chancen }), { headers })
    }

    if (body.action === 'invite_mitarbeiter') {
      const { email } = body
      if (!email || typeof email !== 'string' || !email.trim()) {
        return new Response(JSON.stringify({ error: 'email ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const berechtigung = await pruefeAdminAufrufer(req, admin)
      if (!berechtigung.ok) {
        return new Response(JSON.stringify({ error: berechtigung.error }), { status: berechtigung.status, headers })
      }
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email.trim())
      if (inviteError) {
        return new Response(JSON.stringify({ error: inviteError.message }), { status: 400, headers })
      }
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    if (body.action === 'update_mitarbeiter_email') {
      const { mitarbeiterId, neueEmail } = body
      if (!mitarbeiterId || !neueEmail || typeof neueEmail !== 'string' || !neueEmail.trim()) {
        return new Response(JSON.stringify({ error: 'mitarbeiterId und neueEmail sind Pflichtfelder' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const berechtigung = await pruefeAdminAufrufer(req, admin)
      if (!berechtigung.ok) {
        return new Response(JSON.stringify({ error: berechtigung.error }), { status: berechtigung.status, headers })
      }
      const { data: mRow, error: mErr } = await admin.from('mitarbeiter').select('email').eq('id', mitarbeiterId).maybeSingle()
      if (mErr || !mRow) {
        return new Response(JSON.stringify({ error: 'Mitarbeiter nicht gefunden' }), { status: 404, headers })
      }
      const alteEmail = (mRow.email as string).trim().toLowerCase()
      const { data: userList, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (listError) {
        return new Response(JSON.stringify({ error: listError.message }), { status: 400, headers })
      }
      const authUser = userList.users.find((u) => u.email?.trim().toLowerCase() === alteEmail)
      if (!authUser) {
        return new Response(JSON.stringify({ error: 'Kein Login-Account zu dieser E-Mail gefunden' }), { status: 404, headers })
      }
      const { error: updateAuthError } = await admin.auth.admin.updateUserById(authUser.id, {
        email: neueEmail.trim(),
        email_confirm: true,
      })
      if (updateAuthError) {
        return new Response(JSON.stringify({ error: updateAuthError.message }), { status: 400, headers })
      }
      const { error: updateTableError } = await admin.from('mitarbeiter').update({ email: neueEmail.trim() }).eq('id', mitarbeiterId)
      if (updateTableError) {
        return new Response(JSON.stringify({ error: updateTableError.message }), { status: 400, headers })
      }
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    if (body.action === 'generate_login_link') {
      const { email } = body
      if (!email || typeof email !== 'string' || !email.trim()) {
        return new Response(JSON.stringify({ error: 'email ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const berechtigung = await pruefeAdminAufrufer(req, admin)
      if (!berechtigung.ok) {
        return new Response(JSON.stringify({ error: berechtigung.error }), { status: berechtigung.status, headers })
      }
      const { data, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email: email.trim() })
      if (linkError) {
        return new Response(JSON.stringify({ error: linkError.message }), { status: 400, headers })
      }
      return new Response(JSON.stringify({ link: data.properties?.action_link }), { headers })
    }

    if (body.action === 'request_password_reset') {
      const { email } = body
      if (!email || typeof email !== 'string' || !email.trim()) {
        return new Response(JSON.stringify({ error: 'email ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const normalisiert = email.trim().toLowerCase()
      const { data: mitarbeiterRows } = await admin.from('mitarbeiter').select('email').eq('aktiv', true)
      const treffer = (mitarbeiterRows ?? []).find((m: { email: string }) => m.email?.trim().toLowerCase() === normalisiert)
      if (treffer) await schickePasswortLink(admin, treffer.email)
      // Immer dieselbe Antwort, egal ob die E-Mail zu einem echten Mitarbeiter gehört oder nicht.
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    if (body.action === 'self_register') {
      const { email, passwort } = body
      if (!email || typeof email !== 'string' || !email.trim() || !passwort || typeof passwort !== 'string' || passwort.length < 8) {
        return new Response(
          JSON.stringify({ error: 'E-Mail und ein Passwort mit mindestens 8 Zeichen sind Pflichtfelder' }),
          { status: 400, headers },
        )
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const normalisiert = email.trim().toLowerCase()
      const { data: mitarbeiterRows } = await admin.from('mitarbeiter').select('email').eq('aktiv', true)
      const treffer = (mitarbeiterRows ?? []).find((m: { email: string }) => m.email?.trim().toLowerCase() === normalisiert)
      if (!treffer) {
        return new Response(
          JSON.stringify({ error: 'Diese E-Mail-Adresse ist nicht als aktiver Mitarbeiter hinterlegt.' }),
          { status: 404, headers },
        )
      }
      const { data: userList, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (listError) {
        return new Response(JSON.stringify({ error: listError.message }), { status: 400, headers })
      }
      const bestehenderUser = userList.users.find((u) => u.email?.trim().toLowerCase() === normalisiert)
      // Sicherheitsgrenze: Registrieren setzt ein Passwort nur für einen Zugang, der noch nie geöffnet
      // wurde. Sonst könnte jeder, der die (oft erratbare) Firmen-E-Mail eines Kollegen kennt, dessen
      // Zugang übernehmen, ohne je in dessen Postfach gewesen zu sein.
      // "Schon geöffnet" heißt aber NICHT "hat ein Passwort": Wer nur den Einladungs-Link angeklickt
      // hat, gilt als angemeldet und hat trotzdem keins (so bei Andreas Mayer am 12.11.2026 — die alte
      // Meldung "bereits ein Passwort gesetzt" war falsch und ließ ihn ohne Ausweg stehen). Deshalb
      // geht in diesem Fall ein Link an das Postfach: Wer es lesen kann, legt dort sein Passwort fest.
      if (bestehenderUser?.last_sign_in_at) {
        const geschickt = await schickePasswortLink(admin, treffer.email)
        if (!geschickt) {
          return new Response(
            JSON.stringify({
              error: 'Dieser Zugang wurde schon einmal geöffnet. Der Link zum Festlegen des Passworts konnte gerade nicht verschickt werden — bitte Eray oder Hasan um einen Login-Link bitten.',
            }),
            { status: 502, headers },
          )
        }
        return new Response(JSON.stringify({ ok: true, linkGeschickt: true }), { headers })
      }
      if (bestehenderUser) {
        const { error: updateErr } = await admin.auth.admin.updateUserById(bestehenderUser.id, {
          password: passwort,
          email_confirm: true,
        })
        if (updateErr) {
          return new Response(JSON.stringify({ error: updateErr.message }), { status: 400, headers })
        }
      } else {
        const { error: createErr } = await admin.auth.admin.createUser({
          email: treffer.email,
          password: passwort,
          email_confirm: true,
        })
        if (createErr) {
          return new Response(JSON.stringify({ error: createErr.message }), { status: 400, headers })
        }
      }
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    if (body.action === 'classify_new_leads') {
      const ergebnis = await classifyNewLeads()
      return new Response(JSON.stringify(ergebnis), { headers })
    }

    if (body.action === 'draft_campaign') {
      const { ziel } = body
      if (!ziel || typeof ziel !== 'string' || !ziel.trim()) {
        return new Response(JSON.stringify({ error: 'ziel ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const entwurf = await draftCampaign(ziel)
      return new Response(JSON.stringify(entwurf), { headers })
    }

    if (body.action === 'assistant_vision') {
      const { frage, image_base64, media_type } = body
      if (!image_base64 || typeof image_base64 !== 'string') {
        return new Response(JSON.stringify({ error: 'image_base64 ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const { antwort } = await answerWithImage(frage ?? '', image_base64, media_type || 'image/png')
      return new Response(JSON.stringify({ antwort }), { headers })
    }

    if (body.action === 'classify_objekt_dokument') {
      const { datei_base64, media_type, dateiname } = body
      if (!datei_base64 || typeof datei_base64 !== 'string') {
        return new Response(JSON.stringify({ error: 'datei_base64 ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const klassifikation = await classifyObjektDokument(datei_base64, media_type || 'application/pdf', dateiname || '')
      return new Response(JSON.stringify({ klassifikation }), { headers })
    }

    if (body.action === 'classify_kunden_dokument') {
      const { datei_base64, media_type, dateiname } = body
      if (!datei_base64 || typeof datei_base64 !== 'string') {
        return new Response(JSON.stringify({ error: 'datei_base64 ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const klassifikation = await classifyKundenDokument(datei_base64, media_type || 'application/pdf', dateiname || '')
      return new Response(JSON.stringify({ klassifikation }), { headers })
    }

    if (body.action === 'split_scan_dokument') {
      const { datei_base64, dateiname, seitenzahl } = body
      if (!datei_base64 || typeof datei_base64 !== 'string') {
        return new Response(JSON.stringify({ error: 'datei_base64 ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const aufteilung = await splitScanDokument(datei_base64, dateiname || '', Number(seitenzahl) || 1)
      return new Response(JSON.stringify({ aufteilung }), { headers })
    }

    // Die folgenden drei Aktionen sind für die öffentlichen, unauthentifizierten Formulare unter
    // /formular/* gedacht (src/pages/formulare/Public*.tsx). Diese Seiten laufen ohne Mitarbeiter-
    // Login, die kunden-Tabelle in Supabase lässt per RLS aber nur Lese-/Schreibzugriff für
    // eingeloggte Mitarbeiter zu (ist_aktiver_mitarbeiter()) — ein Kunde, der extern einen
    // Formular-Link öffnet, hätte sonst weder Zugriff auf seine eigenen Stammdaten noch könnte seine
    // Antwort/Unterschrift je im echten CRM ankommen (sie würde nur im eigenen Browser verpuffen).
    // Diese drei Aktionen laufen deshalb serverseitig mit dem Service-Role-Key, exakt wie
    // generate_login_link/invite_mitarbeiter oben — die Autorisierung ist das geteilte
    // x-crm-secret (oben bereits geprüft) plus die praktisch unerratbare Kunden-ID in der URL.

    if (body.action === 'public_get_kunde') {
      const { bereich, kundeId } = body
      if (!bereich || !kundeId) {
        return new Response(JSON.stringify({ error: 'bereich und kundeId sind Pflichtfelder' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data, error: selectError } = await admin
        .from('kunden')
        .select('firma, ansprechpartner, email, selbstauskunft, signaturen, unterlagen_checkliste')
        .eq('id', kundeId)
        .eq('bereich', bereich)
        .maybeSingle()
      if (selectError) return new Response(JSON.stringify({ error: selectError.message }), { status: 500, headers })
      if (!data) return new Response(JSON.stringify({ kunde: null }), { headers })
      // Nur ob eine NDA-Signatur existiert zurückgeben, nicht die vollen (teils mehrere MB großen)
      // Signatur-Bilddaten aller bisherigen Formulare — die werden für kein öffentliches Formular
      // zur Anzeige gebraucht.
      const ndaUnterschrieben = ((data.signaturen as { kontext: string }[]) ?? []).some((s) => s.kontext === 'NDA – Geheimhaltungsvereinbarung')
      const { signaturen: _signaturen, unterlagen_checkliste, ...kundeOhneSignaturen } = data
      return new Response(
        JSON.stringify({ kunde: { ...kundeOhneSignaturen, ndaUnterschrieben, unterlagenCheckliste: unterlagen_checkliste ?? undefined } }),
        { headers },
      )
    }

    if (body.action === 'public_submit_formular') {
      const { bereich, kundeId, aktivitaetText, aktivitaetUser, signatur, selbstauskunft, unterlagenCheckliste, behoerde } = body
      if (!bereich || !kundeId || !aktivitaetText) {
        return new Response(JSON.stringify({ error: 'bereich, kundeId und aktivitaetText sind Pflichtfelder' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data: bestehend, error: selectError } = await admin
        .from('kunden')
        .select('firma, ansprechpartner, activities, signaturen, follow_up')
        .eq('id', kundeId)
        .eq('bereich', bereich)
        .maybeSingle()
      if (selectError) return new Response(JSON.stringify({ error: selectError.message }), { status: 500, headers })
      if (!bestehend) return new Response(JSON.stringify({ error: 'Kunde/Mandant nicht gefunden' }), { status: 404, headers })

      const heute = new Date().toISOString().slice(0, 10)
      const activities: unknown[] = [
        { id: crypto.randomUUID(), date: heute, text: aktivitaetText, user: aktivitaetUser || 'Kunde (Formular)' },
        ...((bestehend.activities as unknown[]) ?? []),
      ]
      const patch: Record<string, unknown> = { letzte_aktivitaet: heute, activities }
      if (signatur) {
        patch.signaturen = [
          { id: crypto.randomUUID(), name: signatur.name, dataUrl: signatur.dataUrl, datum: heute, kontext: signatur.kontext },
          ...((bestehend.signaturen as unknown[]) ?? []),
        ]
      }
      if (selbstauskunft) patch.selbstauskunft = selbstauskunft
      if (unterlagenCheckliste) patch.unterlagen_checkliste = unterlagenCheckliste

      // Behörden-Automatisierung (Modul 8): wenn beim Versenden des Formular-Links eine
      // Behörden-Adresse hinterlegt wurde (siehe FormularLinkButtons-Aufrufe mit ?behoerde=...),
      // wird nach erfolgreicher Unterschrift automatisch eine E-Mail mit der Signatur als Anhang an
      // diese Adresse geschickt und eine Wiedervorlage angelegt — kein manueller Schritt mehr nötig.
      // Ein Fehler hier darf das eigentliche Speichern der Formular-Antwort nicht verhindern.
      if (behoerde?.email && signatur) {
        try {
          const betreff = `${signatur.kontext} — ${bestehend.firma}`
          const text = `Sehr geehrte Damen und Herren,\n\nim Anhang erhalten Sie die digital unterschriebene "${signatur.kontext}" für ${bestehend.ansprechpartner} (${bestehend.firma}).\n\nMit freundlichen Grüßen\nAndreas Mayer Holding`
          // Bevorzugt das vom Frontend mitgeschickte vollständige PDF (Dokumenttext + ausgefüllte
          // Felder + Signatur, siehe src/lib/generateDokumentPdf.ts) — nur die isolierte Unterschrift
          // als Anhang wäre für die Behörde nicht nachvollziehbar/nutzbar (Nutzer-Feedback 2026-11-02).
          // Fällt auf die reine Signatur zurück, falls kein PDF mitgeschickt wurde.
          const anhang = behoerde.pdfBase64
            ? { filename: behoerde.pdfFilename || 'dokument.pdf', contentBase64: behoerde.pdfBase64, contentType: 'application/pdf' }
            : { filename: 'unterschrift.png', contentBase64: signatur.dataUrl.split(',')[1] ?? signatur.dataUrl, contentType: 'image/png' }
          await sendMail(behoerde.email, betreff, text, undefined, [anhang])
          try {
            await admin.from('gesendete_emails').insert({
              an: behoerde.email,
              an_name: behoerde.name ?? behoerde.email,
              betreff,
              text,
              kunde_bereich: bereich,
              kunde_id: kundeId,
              kunde_name: `${bestehend.firma} (${bestehend.ansprechpartner})`,
            })
          } catch (logErr) {
            console.error('Konnte Behörden-Mail nicht protokollieren:', logErr)
          }
          activities.unshift({
            id: crypto.randomUUID(),
            date: heute,
            text: `Automatisch an ${behoerde.name ?? behoerde.email} gesendet (${signatur.kontext}).`,
            user: 'System (automatisiert)',
          })
          patch.activities = activities
          patch.follow_up = { date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), note: `Rückmeldung von ${behoerde.name ?? 'Behörde'} prüfen`, done: false }
        } catch (mailErr) {
          console.error('Automatische Behörden-Mail fehlgeschlagen:', mailErr)
        }
      }

      const { error: updateError } = await admin.from('kunden').update(patch).eq('id', kundeId).eq('bereich', bereich)
      if (updateError) return new Response(JSON.stringify({ error: updateError.message }), { status: 500, headers })
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    if (body.action === 'public_create_lead') {
      const { firma, ansprechpartner, email, telefon, prioritaet, followUp, aktivitaetText, aktivitaetUser, signatur } = body
      if (!firma || !email || !aktivitaetText) {
        return new Response(JSON.stringify({ error: 'firma, email und aktivitaetText sind Pflichtfelder' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const heute = new Date().toISOString().slice(0, 10)
      const id = `k_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
      const { error: insertError } = await admin.from('kunden').insert({
        id,
        bereich: 'beratung',
        firma,
        ansprechpartner: ansprechpartner || firma,
        email,
        telefon: telefon || '',
        prioritaet: prioritaet || 'Mittel',
        status: 'lead',
        follow_up: followUp ?? { date: heute, note: 'Erstkontakt aufnehmen', done: false },
        verantwortlich: 'Andreas Mayer',
        letzte_aktivitaet: heute,
        activities: [{ id: crypto.randomUUID(), date: heute, text: aktivitaetText, user: aktivitaetUser || 'Kunde (Formular)' }],
        signaturen: signatur ? [{ id: crypto.randomUUID(), name: signatur.name, dataUrl: signatur.dataUrl, datum: heute, kontext: signatur.kontext }] : null,
      })
      if (insertError) return new Response(JSON.stringify({ error: insertError.message }), { status: 500, headers })
      return new Response(JSON.stringify({ ok: true, id }), { headers })
    }

    if (body.action === 'public_get_objekt') {
      const { objektId } = body
      if (!objektId) {
        return new Response(JSON.stringify({ error: 'objektId ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data, error: selectError } = await admin
        .from('objekte')
        .select('bezeichnung, adresse, typ, dokumente, eigentuemer')
        .eq('id', objektId)
        .maybeSingle()
      if (selectError) return new Response(JSON.stringify({ error: selectError.message }), { status: 500, headers })
      return new Response(JSON.stringify({ objekt: data }), { headers })
    }

    // Erzeugt einen Signed-Upload-Token statt den Datei-Inhalt selbst entgegenzunehmen — eine Edge
    // Function hat ein deutlich kleineres Body-Größenlimit als ein direkter Storage-Upload, und
    // Eigentümer laden oft mehrseitige Scans/Fotos hoch. Der eigentliche Upload läuft danach per
    // supabase.storage.from(...).uploadToSignedUrl(...) direkt vom Browser zu Supabase Storage.
    if (body.action === 'public_objekt_upload_url') {
      const { objektId, dateiname } = body
      if (!objektId || !dateiname) {
        return new Response(JSON.stringify({ error: 'objektId und dateiname sind Pflichtfelder' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const pfad = `${objektId}/eigentuemer_${crypto.randomUUID()}_${String(dateiname).replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { data, error: uploadUrlError } = await admin.storage.from('objekt-dokumente').createSignedUploadUrl(pfad)
      if (uploadUrlError) return new Response(JSON.stringify({ error: uploadUrlError.message }), { status: 500, headers })
      return new Response(JSON.stringify({ pfad: data.path, token: data.token }), { headers })
    }

    if (body.action === 'public_submit_objekt_formular') {
      const { objektId, aktivitaetText, eigentuemer, dokument, ordner } = body
      if (!objektId || !aktivitaetText) {
        return new Response(JSON.stringify({ error: 'objektId und aktivitaetText sind Pflichtfelder' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data: bestehend, error: selectError } = await admin
        .from('objekte')
        .select('activities, dokumente')
        .eq('id', objektId)
        .maybeSingle()
      if (selectError) return new Response(JSON.stringify({ error: selectError.message }), { status: 500, headers })
      if (!bestehend) return new Response(JSON.stringify({ error: 'Objekt nicht gefunden' }), { status: 404, headers })

      const heute = new Date().toISOString().slice(0, 10)
      const activities: unknown[] = [
        { id: crypto.randomUUID(), date: heute, text: aktivitaetText, user: 'Eigentümer (Formular)' },
        ...((bestehend.activities as unknown[]) ?? []),
      ]
      const patch: Record<string, unknown> = { activities }
      if (eigentuemer) patch.eigentuemer = eigentuemer
      if (dokument && ordner) {
        const dokumenteBisher = (bestehend.dokumente as Record<string, unknown[]>) ?? {}
        patch.dokumente = { ...dokumenteBisher, [ordner]: [dokument, ...((dokumenteBisher[ordner] as unknown[]) ?? [])] }
      }

      const { error: updateError } = await admin.from('objekte').update(patch).eq('id', objektId)
      if (updateError) return new Response(JSON.stringify({ error: updateError.message }), { status: 500, headers })
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    if (body.action === 'public_get_vorschlag') {
      const { vorschlagId } = body
      if (!vorschlagId) {
        return new Response(JSON.stringify({ error: 'vorschlagId ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data: vorschlagRow, error: vorschlagError } = await admin
        .from('objekt_vorschlaege')
        .select('id, objekt_id, kunde_name, steuer_begruendung, status')
        .eq('id', vorschlagId)
        .maybeSingle()
      if (vorschlagError) return new Response(JSON.stringify({ error: vorschlagError.message }), { status: 500, headers })
      if (!vorschlagRow) return new Response(JSON.stringify({ vorschlag: null, objekt: null }), { headers })
      const { data: objektRow, error: objektError } = await admin
        .from('objekte')
        .select('bezeichnung, adresse, typ, gruppe, kaufpreis')
        .eq('id', vorschlagRow.objekt_id)
        .maybeSingle()
      if (objektError) return new Response(JSON.stringify({ error: objektError.message }), { status: 500, headers })
      return new Response(
        JSON.stringify({
          vorschlag: {
            id: vorschlagRow.id,
            kundeName: vorschlagRow.kunde_name,
            steuerBegruendung: vorschlagRow.steuer_begruendung,
            status: vorschlagRow.status,
          },
          objekt: objektRow,
        }),
        { headers },
      )
    }

    if (body.action === 'public_entscheide_vorschlag') {
      const { vorschlagId, entscheidung } = body
      if (!vorschlagId || (entscheidung !== 'akzeptiert' && entscheidung !== 'abgelehnt')) {
        return new Response(JSON.stringify({ error: 'vorschlagId und eine gültige entscheidung sind Pflichtfelder' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const heute = new Date().toISOString().slice(0, 10)
      const { data: vorschlagRow, error: vorschlagError } = await admin
        .from('objekt_vorschlaege')
        .select('id, objekt_id, kunde_bereich, kunde_id, kunde_name, status')
        .eq('id', vorschlagId)
        .maybeSingle()
      if (vorschlagError) return new Response(JSON.stringify({ error: vorschlagError.message }), { status: 500, headers })
      if (!vorschlagRow) return new Response(JSON.stringify({ error: 'Vorschlag nicht gefunden' }), { status: 404, headers })
      // Bereits entschieden -> idempotent den bestehenden Status zurückgeben statt einen Fehler zu
      // werfen (z.B. wenn der Kunde den Link zweimal öffnet oder doppelt klickt).
      if (vorschlagRow.status !== 'offen') {
        return new Response(JSON.stringify({ ok: true, status: vorschlagRow.status }), { headers })
      }
      const { error: updateVorschlagError } = await admin
        .from('objekt_vorschlaege')
        .update({ status: entscheidung, beantwortet_am: heute })
        .eq('id', vorschlagId)
      if (updateVorschlagError) return new Response(JSON.stringify({ error: updateVorschlagError.message }), { status: 500, headers })

      if (entscheidung === 'akzeptiert') {
        const { data: objektRow } = await admin.from('objekte').select('activities').eq('id', vorschlagRow.objekt_id).maybeSingle()
        const activity = {
          id: `act_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
          date: heute,
          text: `Exposé von ${vorschlagRow.kunde_name} angenommen — Objekt dem Kunden-Portfolio zugewiesen.`,
          user: `${vorschlagRow.kunde_name} (Formular)`,
        }
        await admin
          .from('objekte')
          .update({
            zugewiesener_kunde: { bereich: vorschlagRow.kunde_bereich, kundeId: vorschlagRow.kunde_id, kundeName: vorschlagRow.kunde_name },
            activities: [activity, ...(objektRow?.activities ?? [])],
          })
          .eq('id', vorschlagRow.objekt_id)
      }

      return new Response(JSON.stringify({ ok: true, status: entscheidung }), { headers })
    }

    if (body.action === 'immoradar_top') {
      const listings = await fetchImmoRadarTopListings()
      return new Response(JSON.stringify({ listings }), { headers })
    }

    if (body.action === 'bewertung_recherche_start') {
      const { bereich, kundeId, firma, webseite, anlass, stichtag, vorhandeneZahlen } = body
      if (!bereich || !kundeId || !firma || !webseite || !anlass || !stichtag) {
        return new Response(JSON.stringify({ error: 'bereich, kundeId, firma, webseite, anlass und stichtag sind Pflichtfelder' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const gestartetAm = new Date().toISOString()
      const { error: startError } = await admin
        .from('kunden')
        .update({
          unternehmensbewertung_recherche: {
            status: 'laeuft',
            schritt: 'Wird gestartet …',
            schrittNr: 1,
            versuch: 0,
            anlass,
            stichtag,
            gestartetAm,
            aktualisiertAm: gestartetAm,
            eingabe: {
              firma,
              webseite,
              vorhandeneZahlen: vorhandeneZahlen ?? {},
              ansprechpartner: typeof body.ansprechpartner === 'string' ? body.ansprechpartner : '',
              email: typeof body.email === 'string' ? body.email : '',
              akteWissen: typeof body.akteWissen === 'string' ? body.akteWissen.slice(0, 6000) : '',
            },
            zwischen: {},
          },
        })
        .eq('id', kundeId)
        .eq('bereich', bereich)
      if (startError) return new Response(JSON.stringify({ error: startError.message }), { status: 500, headers })
      await stosseRechercheSchrittAn(bereich, kundeId, 0)
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    if (body.action === 'dokument_lesen') {
      const { url, name, typ } = body
      if (!url || !name) return new Response(JSON.stringify({ error: 'url und name sind Pflichtfelder' }), { status: 400, headers })
      // @ts-ignore EdgeRuntime ist in der Laufzeit global, aber nicht in den Deno-Typings deklariert.
      EdgeRuntime.waitUntil(leseDokument({ url: String(url), name: String(name), typ: typeof typ === 'string' ? typ : undefined }, Number(body.teil) || 0, Number(body.umleitungen) || 0))
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    if (body.action === 'dokument_inhalte') {
      if (!Array.isArray(body.dokumente)) return new Response(JSON.stringify({ error: 'dokumente ist ein Pflichtfeld' }), { status: 400, headers })
      const ergebnis = await dokumentInhalte(body.dokumente, body.einlesen === true, body.volltext === true)
      return new Response(JSON.stringify(ergebnis), { headers })
    }

    if (body.action === 'steuer_analyse_start') {
      const { bereich, kundeId, gestartetVon } = body
      if (!bereich || !kundeId) {
        return new Response(JSON.stringify({ error: 'bereich und kundeId sind Pflichtfelder' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const gestartetAm = new Date().toISOString()
      const { error: startError } = await admin
        .from('kunden')
        .update({
          steuer_analyse: {
            status: 'laeuft',
            schritt: 'Wird gestartet …',
            schrittNr: 1,
            versuch: 0,
            gestartetAm,
            aktualisiertAm: gestartetAm,
            gestartetVon: typeof gestartetVon === 'string' ? gestartetVon : '',
            zwischen: {},
          },
        })
        .eq('id', kundeId)
        .eq('bereich', bereich)
      if (startError) return new Response(JSON.stringify({ error: startError.message }), { status: 500, headers })
      await stosseRechercheSchrittAn(bereich, kundeId, 0, 'steuer_analyse_schritt')
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    if (body.action === 'steuer_analyse_schritt') {
      const { bereich, kundeId, umleitungen } = body
      if (!bereich || !kundeId) {
        return new Response(JSON.stringify({ error: 'bereich und kundeId sind Pflichtfelder' }), { status: 400, headers })
      }
      // @ts-ignore EdgeRuntime ist in der Laufzeit global, aber nicht in den Deno-Typings deklariert.
      EdgeRuntime.waitUntil(fuehreSteuerSchrittAus(bereich, kundeId, Number(umleitungen) || 0, body.wiederaufnehmen === true))
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    // Führt den nächsten offenen Schritt einer laufenden Recherche aus (siehe fuehreRechercheSchrittAus).
    // Antwortet sofort und arbeitet im Hintergrund weiter. Auch vom Frontend aufrufbar, um eine
    // hängen gebliebene Recherche ab dem letzten fertigen Schritt fortzusetzen.
    if (body.action === 'bewertung_recherche_schritt') {
      const { bereich, kundeId, umleitungen } = body
      if (!bereich || !kundeId) {
        return new Response(JSON.stringify({ error: 'bereich und kundeId sind Pflichtfelder' }), { status: 400, headers })
      }
      // @ts-ignore EdgeRuntime ist in der Laufzeit global, aber nicht in den Deno-Typings deklariert.
      EdgeRuntime.waitUntil(fuehreRechercheSchrittAus(bereich, kundeId, Number(umleitungen) || 0))
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    return new Response(JSON.stringify({ error: 'Unbekannte action — erwartet "sync", "send", "summarize", "assistant_classify", "assistant_answer", "potenzial_analyse", "draft_campaign", "assistant_vision", "invite_mitarbeiter", "generate_login_link", "update_mitarbeiter_email", "request_password_reset", "self_register", "classify_new_leads", "public_get_kunde", "public_submit_formular", "public_create_lead", "immoradar_top", "pflege_classify", "classify_objekt_dokument", "classify_kunden_dokument", "split_scan_dokument", "public_get_objekt", "public_objekt_upload_url", "public_submit_objekt_formular", "public_get_vorschlag", "public_entscheide_vorschlag", "bewertung_recherche_start", "bewertung_recherche_schritt", "kunden_umfeld_recherche", "steuer_analyse_start", "steuer_analyse_schritt", "dokument_lesen", "dokument_inhalte" oder "firmenwissen_answer"' }), { status: 400, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers })
  }
})
