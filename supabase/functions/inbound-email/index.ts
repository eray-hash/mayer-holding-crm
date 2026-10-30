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

  const contentType = req.headers.get('content-type') ?? ''
  let payload: Record<string, unknown>
  // Anhänge aus dem multipart/form-data-Payload — welchen Feldnamen CloudMailin dafür genau nutzt,
  // ist nicht dokumentiert/getestet, daher bewusst format-agnostisch: JEDER Form-Teil, der ein
  // "File" ist (unabhängig vom Feldnamen), wird als Anhang behandelt. Separat gesammelt, damit die
  // File-Objekte nicht im rohdaten-JSONB landen (das würde den Insert zum Scheitern bringen).
  const gefundeneDateien: File[] = []
  try {
    if (contentType.includes('application/json')) {
      payload = await req.json()
    } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData()
      const entries: [string, FormDataEntryValue][] = []
      for (const [key, value] of form.entries()) {
        if (value instanceof File) {
          if (value.size > 0) gefundeneDateien.push(value)
        } else {
          entries.push([key, value])
        }
      }
      payload = Object.fromEntries(entries)
    } else {
      // Unbekanntes/unerwartetes Format — Rohtext unverändert speichern, um das tatsächliche
      // Format des Anbieters zu sehen, statt blind zu raten.
      payload = { _raw_content_type: contentType, _raw_body: await req.text() }
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: `Payload konnte nicht gelesen werden: ${err instanceof Error ? err.message : String(err)}` }), { status: 400 })
  }

  // CloudMailin sendet standardmäßig multipart/form-data mit flach geklammerten Feldnamen
  // (z. B. "headers[subject]", "headers[from]", "envelope[from]", "plain", "html") statt
  // verschachtelter JSON-Objekte — per echtem Test (23.10.2026) bestätigt. Zur Sicherheit wird
  // zusätzlich das verschachtelte Format geprüft, falls sich das Anbieter-Format mal ändert.
  function pick(...keys: string[]): string | undefined {
    for (const key of keys) {
      const value = payload[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
    return undefined
  }
  const headers = (payload.headers as Record<string, unknown>) ?? {}
  const envelope = (payload.envelope as Record<string, unknown>) ?? {}
  const rawFrom = pick('headers[from]', 'envelope[from]')
    ?? (typeof headers.from === 'string' ? headers.from : undefined)
    ?? (typeof envelope.from === 'string' ? envelope.from : undefined)
    ?? 'unbekannt'
  const { email: von, name: vonName } = parseFromHeader(rawFrom)
  const betreff = pick('headers[subject]')
    ?? (typeof headers.subject === 'string' ? headers.subject : undefined)
    ?? '(ohne Betreff)'
  const plain = pick('plain', 'reply_plain')
  const html = pick('html')
  const text = plain ?? (html
    ? html.replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim()
    : '')
  const messageId = pick('headers[message_id]', 'headers[message-id]')
    ?? (typeof headers.message_id === 'string' ? headers.message_id : undefined)
    ?? crypto.randomUUID()

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Gefundene Anhänge in den Storage-Bucket "email-anhaenge" hochladen (öffentlich lesbar, wie der
  // Rest dieses Projekts bewusst als internes Tool ohne zusätzliche Zugriffsprüfung behandelt) —
  // ein fehlgeschlagener Upload darf das Einsortieren der E-Mail selbst nicht verhindern.
  const anhaenge: { filename: string; size: number; contentType: string; url: string }[] = []
  for (const datei of gefundeneDateien) {
    try {
      const pfad = `${messageId}/${datei.name}`
      const { error: uploadError } = await supabase.storage
        .from('email-anhaenge')
        .upload(pfad, datei, { contentType: datei.type || 'application/octet-stream', upsert: true })
      if (uploadError) {
        console.error('Anhang-Upload fehlgeschlagen', datei.name, uploadError)
        continue
      }
      const { data: urlData } = supabase.storage.from('email-anhaenge').getPublicUrl(pfad)
      anhaenge.push({ filename: datei.name, size: datei.size, contentType: datei.type || 'application/octet-stream', url: urlData.publicUrl })
    } catch (err) {
      console.error('Anhang-Upload fehlgeschlagen', datei.name, err)
    }
  }

  const { error } = await supabase.from('eingegangene_emails').insert({
    message_id: messageId,
    von,
    von_name: vonName,
    betreff,
    ausschnitt: text.slice(0, 500),
    rohdaten: payload,
    anhaenge: anhaenge.length > 0 ? anhaenge : null,
  })

  if (error) {
    console.error('insert failed', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
})
