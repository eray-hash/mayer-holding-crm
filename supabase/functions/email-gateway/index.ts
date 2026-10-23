// Edge Function "email-gateway" — Brücke zwischen dem CRM-Frontend und echten externen Diensten,
// die einen Server-seitigen Schlüssel/Zugangsdaten brauchen. Drei Aktionen über denselben Endpunkt:
//   { action: "sync" }                          -> letzte E-Mails aus dem IONOS-Posteingang lesen
//   { action: "send", to, subject, text, html }  -> E-Mail über dasselbe Postfach versenden
//   { action: "summarize", transcript }          -> Gesprächstranskript per Claude strukturiert
//                                                    zusammenfassen (Kernthemen/Vereinbarungen/
//                                                    offene Punkte/Stimmung), für die
//                                                    "Gespräch aufzeichnen"-Funktion
//
// Alle Zugangsdaten kommen ausschließlich aus Supabase Function Secrets (nie im Code, nie im
// Frontend). Siehe README-Abschnitt "E-Mail-Postfach-Anbindung" für die Einrichtung.

import { ImapFlow } from 'npm:imapflow@1'
import { simpleParser } from 'npm:mailparser@3'
import nodemailer from 'npm:nodemailer@6'

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
      const { to, subject, text, html } = body
      if (!to || !subject || !text) {
        return new Response(JSON.stringify({ error: 'to, subject und text sind Pflichtfelder' }), { status: 400, headers })
      }
      await sendMail(to, subject, text, html)
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

    return new Response(JSON.stringify({ error: 'Unbekannte action — erwartet "sync", "send" oder "summarize"' }), { status: 400, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers })
  }
})
