// Edge Function "email-gateway" — Brücke zwischen dem CRM-Frontend und echten externen Diensten,
// die einen Server-seitigen Schlüssel/Zugangsdaten brauchen. Aktionen über denselben Endpunkt:
//   { action: "sync" }                          -> letzte E-Mails aus dem IONOS-Posteingang lesen
//   { action: "send", to, subject, text, html }  -> E-Mail über dasselbe Postfach versenden
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
//                                                   den Service-Role-Key, läuft daher nur serverseitig
//   { action: "generate_login_link", email }     -> erzeugt einen Login-/Passwort-setzen-Link ohne
//                                                   selbst eine Mail zu verschicken (Workaround, da
//                                                   Supabases eingebauter Mailversand ratelimitiert
//                                                   und bei manchen Empfängern unzuverlässig ist) —
//                                                   der Link wird direkt zurückgegeben und muss über
//                                                   einen anderen Kanal (Chat, Signal, ...) zugestellt
//                                                   werden
//   { action: "classify_new_leads" }             -> Nachfolger von scripts/extract-leads.mjs, aber
//                                                   automatisch statt manuell: findet Absender in
//                                                   eingegangene_emails, die weder einem bestehenden
//                                                   Kunden (Tabelle kunden) noch einem bereits
//                                                   vorhandenen Eintrag in vorgeschlagene_leads
//                                                   entsprechen, klassifiziert nur diese NEUEN
//                                                   Absender per KI und legt relevante als Lead an
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
    'Access-Control-Allow-Headers': 'content-type, x-crm-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }
}

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Fehlende Konfiguration: ${name} (Supabase Edge Function Secret nicht gesetzt)`)
  return v
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

async function sendMail(to: string, subject: string, text: string, html?: string) {
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

Klassifiziere den folgenden Text als genau einen von vier Typen:
- "aufnahme": eine Bitte, ein gerade stattfindendes oder jetzt beginnendes Gespräch/Telefonat/Meeting mit einem Kunden aufzuzeichnen, z. B. "ich habe jetzt ein Gespräch mit X, nimm es auf" oder "zeichne das Meeting mit Y auf".
- "aufgabe": eine konkrete Handlungsaufforderung an sich selbst, z. B. "Kunde X anrufen", "bei Y Unterlagen anfordern", "Z noch erledigen".
- "frage": eine Frage zu einem bestehenden Kunden/Mandanten, z. B. "was wurde beim letzten Termin mit X besprochen", "wie ist der Stand bei Y".
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
          typ: { type: 'string', enum: ['notiz', 'aufgabe', 'frage', 'aufnahme'] },
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

// Zweiter Schritt (nur bei typ="frage"): beantwortet die Frage ausschließlich auf Basis des vom
// Frontend mitgeschickten Kunden-Kontexts (Protokolle, Aktivitäten, Status, Follow-up) — die
// Function selbst hat keinen Datenbankzugriff auf die CRM-Daten, die leben nur im Browser.
async function answerAssistantQuestion(frage: string, kontext: string): Promise<{ antwort: string }> {
  const result = await callClaudeTool<{ antwort: string }>(
    `Beantworte die folgende Frage eines Mitarbeiters ausschließlich auf Basis der gegebenen CRM-Daten zu einem Kunden/Mandanten. Antworte auf Deutsch, knapp und konkret, als reiner Fließtext ohne jegliche Tags oder Markup. Wenn die Daten die Frage nicht beantworten können, sage das ehrlich statt zu spekulieren.

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
  const gruppenMap = new Map<string, LeadGruppe>()
  for (const e of emails) {
    const email = (e.von ?? '').trim().toLowerCase()
    if (!email || !email.includes('@')) continue
    const domain = email.split('@')[1]
    if (INTERNE_DOMAINS.includes(domain)) continue
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
      const { to, toName, subject, text, html, kundeBereich, kundeId, kundeName } = body
      if (!to || !subject || !text) {
        return new Response(JSON.stringify({ error: 'to, subject und text sind Pflichtfelder' }), { status: 400, headers })
      }
      await sendMail(to, subject, text, html)

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
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email.trim())
      if (inviteError) {
        return new Response(JSON.stringify({ error: inviteError.message }), { status: 400, headers })
      }
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    if (body.action === 'generate_login_link') {
      const { email } = body
      if (!email || typeof email !== 'string' || !email.trim()) {
        return new Response(JSON.stringify({ error: 'email ist ein Pflichtfeld' }), { status: 400, headers })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email: email.trim() })
      if (linkError) {
        return new Response(JSON.stringify({ error: linkError.message }), { status: 400, headers })
      }
      return new Response(JSON.stringify({ link: data.properties?.action_link }), { headers })
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

    return new Response(JSON.stringify({ error: 'Unbekannte action — erwartet "sync", "send", "summarize", "assistant_classify", "assistant_answer", "potenzial_analyse", "draft_campaign", "assistant_vision", "invite_mitarbeiter", "generate_login_link" oder "classify_new_leads"' }), { status: 400, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers })
  }
})
