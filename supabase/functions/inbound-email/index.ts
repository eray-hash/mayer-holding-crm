// Edge Function "inbound-email" — nimmt eingehende E-Mails entgegen, die IONOS per
// Weiterleitungsregel an einen Inbound-Email-Webhook-Dienst (z. B. CloudMailin) schickt, und
// speichert sie in der Tabelle public.eingegangene_emails. So funktioniert der Posteingang über
// HTTP (Webhook-Push) statt über eine direkte IMAP-Verbindung, die sich in dieser
// Edge-Function-Laufzeit als nicht nutzbar erwiesen hat (siehe email-gateway/index.ts).
//
// Das CRM-Frontend liest public.eingegangene_emails danach direkt per Supabase-Client
// (anon key, nur Lesezugriff per RLS-Policy) — kein Abruf über diese Function nötig.
//
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY sind in jeder Edge Function automatisch als Secret
// vorhanden, müssen nicht manuell gesetzt werden. Nur INBOUND_SECRET ist ein frei gewähltes
// Secret, das in der URL des Webhook-Ziels (?secret=...) mitgeschickt werden muss.

import { createClient } from 'npm:@supabase/supabase-js@2'

function parseFromHeader(raw: string): { email: string; name: string } {
  const match = raw.match(/^(.*?)<(.+)>$/)
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '')
    const email = match[2].trim()
    return { email, name: name || email }
  }
  return { email: raw.trim(), name: raw.trim() }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const url = new URL(req.url)
  const expectedSecret = Deno.env.get('INBOUND_SECRET')
  if (expectedSecret && url.searchParams.get('secret') !== expectedSecret) {
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      payload = await req.json()
    } else {
      const form = await req.formData()
      payload = Object.fromEntries(form.entries())
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Payload konnte nicht gelesen werden' }), { status: 400 })
  }

  // CloudMailin "normalized" JSON-Format: { envelope: {from, to}, headers: {subject, from, ...},
  // plain, html, reply_plain, attachments }. Andere Anbieter (Postmark, Mailgun) liefern ähnliche,
  // aber nicht identische Felder — hier bewusst defensiv/mehrfach abgesichert.
  const headers = (payload.headers as Record<string, unknown>) ?? {}
  const envelope = (payload.envelope as Record<string, unknown>) ?? {}
  const rawFrom = String(headers.from ?? envelope.from ?? payload.from ?? 'unbekannt')
  const { email: von, name: vonName } = parseFromHeader(rawFrom)
  const betreff = String(headers.subject ?? payload.subject ?? '(ohne Betreff)')
  const text = String(payload.plain ?? payload.reply_plain ?? payload.text ?? '')
  const messageId = String(headers.message_id ?? headers['message-id'] ?? crypto.randomUUID())

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { error } = await supabase.from('eingegangene_emails').insert({
    message_id: messageId,
    von,
    von_name: vonName,
    betreff,
    ausschnitt: text.slice(0, 500),
    rohdaten: payload,
  })

  if (error) {
    console.error('insert failed', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
})
