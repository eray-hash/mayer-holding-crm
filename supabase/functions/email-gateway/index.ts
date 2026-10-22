// Edge Function "email-gateway" — Brücke zwischen dem CRM-Frontend und dem echten
// IONOS-Postfach info@amayer-holding.com. Zwei Aktionen über denselben Endpunkt:
//   { action: "sync" }                         -> letzte E-Mails aus dem Posteingang lesen
//   { action: "send", to, subject, text, html } -> E-Mail über dasselbe Postfach versenden
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

async function syncInbox(limit: number) {
  const client = new ImapFlow({
    host: Deno.env.get('IMAP_HOST') ?? 'imap.ionos.de',
    port: Number(Deno.env.get('IMAP_PORT') ?? '993'),
    secure: true,
    auth: { user: env('IMAP_USER'), pass: env('IMAP_PASSWORD') },
    logger: false,
  })

  await client.connect()
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

    return new Response(JSON.stringify({ error: 'Unbekannte action — erwartet "sync" oder "send"' }), { status: 400, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers })
  }
})
