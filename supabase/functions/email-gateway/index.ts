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
//   { action: "pflege_classify", text }          -> Pflege-Modus (KI-Assistent, nur GF/Admin):
//                                                   klassifiziert eine Massenkorrektur-Anweisung
//                                                   ("X ist kein Kunde", "verschiebe X zu Erben",
//                                                   "X und Y sind dieselbe Firma") als
//                                                   verschieben/loeschen/merge — die eigentliche
//                                                   Kundenzuordnung und jede Datenänderung passiert
//                                                   erst nach expliziter Bestätigung im Frontend
//
// Alle Zugangsdaten kommen ausschließlich aus Supabase Function Secrets (nie im Code, nie im
// Frontend). Siehe README-Abschnitt "E-Mail-Postfach-Anbindung" für die Einrichtung.

import { ImapFlow } from 'npm:imapflow@1'
import { simpleParser } from 'npm:mailparser@3'
import nodemailer from 'npm:nodemailer@6'
import { createClient } from 'npm:@supabase/supabase-js@2'

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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
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

Klassifiziere den folgenden Text als genau einen von fünf Typen:
- "aufnahme": eine Bitte, ein gerade stattfindendes oder jetzt beginnendes Gespräch/Telefonat/Meeting mit einem Kunden aufzuzeichnen, z. B. "ich habe jetzt ein Gespräch mit X, nimm es auf" oder "zeichne das Meeting mit Y auf".
- "aufgabe": eine konkrete Handlungsaufforderung an sich selbst, z. B. "Kunde X anrufen", "bei Y Unterlagen anfordern", "Z noch erledigen".
- "frage": eine Frage zu einem bestehenden, namentlich genannten Kunden/Mandanten, z. B. "was wurde beim letzten Termin mit X besprochen", "wie ist der Stand bei Y".
- "uebersicht": eine allgemeine Frage nach dem eigenen Tagesgeschäft/Status OHNE Bezug auf einen bestimmten, namentlich genannten Kunden, z. B. "was muss ich heute machen", "was steht an", "wie ist mein Stand", "habe ich noch offene Aufgaben".
- "notiz": alles andere, ein allgemeiner Gedanke oder eine Beobachtung ohne konkrete Handlung oder Frage.

Extrahiere zusätzlich, falls vorhanden:
- erkannter_name: der Name einer Person oder Firma, die im Text erwähnt wird (nur der Name, keine Anrede/Titel).
- titel: bei "aufgabe" oder "notiz" ein kurzer, prägnanter Titel (max. ca. 80 Zeichen) für die Aufgabe/Notiz.
- faelligkeitsdatum: falls ein relatives oder konkretes Datum erwähnt wird (z. B. "nächste Woche", "morgen", "Freitag"), berechne daraus das konkrete Datum im Format YYYY-MM-DD ausgehend vom heutigen Datum. Sonst weglassen.
- frage: bei "frage" die Frage selbst, neutral und vollständig formuliert.

Text:
"""${transcript}"""`,
    {
      name: 'ki_assistent_klassifikation',
      description: 'Klassifiziert ein Diktat als Notiz, Aufgabe oder Frage und extrahiert relevante Felder.',
      input_schema: {
        type: 'object',
        properties: {
          typ: { type: 'string', enum: ['notiz', 'aufgabe', 'frage', 'aufnahme', 'uebersicht'] },
          erkannter_name: { type: 'string' },
          titel: { type: 'string' },
          faelligkeitsdatum: { type: 'string' },
          frage: { type: 'string' },
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

type PotenzialChance = {
  bereich: string
  titel: string
  begruendung: string
  naechster_schritt: string
  prioritaet: 'Hoch' | 'Mittel' | 'Niedrig'
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

Gib maximal drei konkrete, plausible Chancen zurück, sortiert nach Priorität (höchste zuerst). Schlage keine Chance im selben Bereich vor, in dem der Kunde ohnehin schon aktiv betreut wird, außer es gibt eine klar erkennbare zusätzliche Leistung. Jede Chance braucht: den passenden Bereich (exakt eine der sieben Bereichs-IDs oben, z. B. "erben"), einen kurzen prägnanten Titel, eine nachvollziehbare Begründung basierend auf den CRM-Daten (zwei bis drei Sätze, auf Deutsch, in einfacher und klarer Sprache ohne Anglizismen oder Fachjargon), einen konkreten nächsten Schritt, und eine Priorität (Hoch/Mittel/Niedrig). Wenn aus den Daten keine plausible Chance erkennbar ist, gib eine leere Liste zurück statt zu spekulieren.`,
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
              },
              required: ['bereich', 'titel', 'begruendung', 'naechster_schritt', 'prioritaet'],
            },
          },
        },
        required: ['chancen'],
      },
    },
  )
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

// Nachfolger von scripts/extract-leads.mjs — macht dasselbe, aber automatisch und nur für Absender,
// die wirklich neu sind (noch kein Kunde, noch kein Lead-Vorschlag), statt bei jedem Lauf alle
// jemals eingegangenen E-Mails erneut zu klassifizieren.
const INTERNE_DOMAINS = ['amayer-holding.com', 'fundament-it.de']
const LEAD_BEREICHE = ['beratung', 'immobilien', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']

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

  // Bereits bekannte Absender (bestehender Kunde ODER schon mal bewerteter Lead-Vorschlag,
  // unabhängig vom Status) werden nicht erneut klassifiziert.
  const [{ data: bekannteKunden }, { data: bekannteLeads }] = await Promise.all([
    supabase.from('kunden').select('email'),
    supabase.from('vorgeschlagene_leads').select('email'),
  ])
  const bekannt = new Set([...(bekannteKunden ?? []), ...(bekannteLeads ?? [])].map((r: { email: string }) => (r.email ?? '').trim().toLowerCase()))

  const neueGruppen = [...gruppenMap.values()].filter((g) => !bekannt.has(g.email))
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
          { quelle: 'email-analyse', email: gruppe.email, name: r.name || gruppe.vonName, status: 'nicht_relevant', notiz: r.notiz },
          { onConflict: 'email' },
        )
        uebersprungen++
        continue
      }
      const { error } = await supabase.from('vorgeschlagene_leads').upsert(
        {
          quelle: 'email-analyse',
          email: gruppe.email,
          name: r.name || gruppe.vonName,
          firma: r.firma || null,
          telefon: r.telefon || null,
          bereich_vorschlag: r.bereich_vorschlag,
          notiz: r.notiz,
          status: 'offen',
          rohdaten: { anzahl_mails: gruppe.mails.length, erste_mail: gruppe.mails.at(-1)?.datum, letzte_mail: gruppe.mails[0]?.datum },
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
      if (treffer) {
        const { data, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email: treffer.email })
        if (!linkError && data.properties?.action_link) {
          try {
            await sendMail(
              treffer.email,
              'Mayer Holding CRM — Passwort zurücksetzen',
              `Hallo,\n\nüber den folgenden Link kannst du dein Passwort im Mayer Holding CRM neu setzen:\n\n${data.properties.action_link}\n\nDer Link ist 24 Stunden gültig. Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.`,
            )
          } catch (mailErr) {
            console.error('Passwort-Reset-Mail fehlgeschlagen:', mailErr)
          }
        }
      }
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
      // Sicherheitsgrenze: Registrieren setzt nur das ALLERERSTE Passwort. Wer schon mal eingeloggt
      // war, hat bereits ein Passwort — sonst könnte jeder, der die (oft erratbare) Firmen-E-Mail
      // eines Kollegen kennt, dessen Account einfach übernehmen, ohne je Zugriff auf dessen Postfach
      // gehabt zu haben.
      if (bestehenderUser?.last_sign_in_at) {
        return new Response(
          JSON.stringify({
            error: 'Für diesen Account wurde bereits ein Passwort gesetzt. Bitte „Passwort vergessen" nutzen oder einen Admin um einen Login-Link bitten.',
          }),
          { status: 409, headers },
        )
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

    return new Response(JSON.stringify({ error: 'Unbekannte action — erwartet "sync", "send", "summarize", "assistant_classify", "assistant_answer", "potenzial_analyse", "draft_campaign", "assistant_vision", "invite_mitarbeiter", "generate_login_link", "update_mitarbeiter_email", "request_password_reset", "self_register", "classify_new_leads", "public_get_kunde", "public_submit_formular", "public_create_lead", "immoradar_top", "pflege_classify", "classify_objekt_dokument", "public_get_objekt", "public_objekt_upload_url", "public_submit_objekt_formular", "public_get_vorschlag", "public_entscheide_vorschlag" oder "firmenwissen_answer"' }), { status: 400, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers })
  }
})
