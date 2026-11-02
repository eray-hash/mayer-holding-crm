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

// Message-IDs enthalten u.a. spitze Klammern und @ (z.B. "<123@mail.example.com>"), die im
// Storage-Pfad nicht erlaubt sind — deshalb wird hier auf ein sicheres Zeichenset reduziert.
function sicheresPfadsegment(s: string): string {
  return s.replace(/^<|>$/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
}

function parseFromHeader(raw: string): { email: string; name: string } {
  const match = raw.match(/^(.*?)<(.+)>$/)
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '')
    const email = match[2].trim()
    return { email, name: name || email }
  }
  return { email: raw.trim(), name: raw.trim() }
}

// Live-Gegenstück zu scripts/cleanup-inbox.mjs (dort nur als manueller Einmal-Lauf für den
// historischen Rückstand): klassifiziert jede neu eingehende Mail direkt beim Eingang, damit das
// Postfach nicht erneut mit Newslettern/Werbung/automatisierten Rechnungen vollläuft. Bewusst nur
// verstecken ("nicht_relevant" setzen), nie löschen — bei einer KI-Fehlklassifizierung geht dadurch
// nichts verloren, siehe Mitarbeiter-Rückfrage vom 30.10.2026. Ein Fehler beim Klassifizieren darf
// das Einsortieren der Mail selbst nicht verhindern — im Zweifel bleibt sie sichtbar ("kunde").
async function klassifiziereRelevanz(vonName: string, von: string, betreff: string, ausschnitt: string): Promise<'kunde' | 'nicht_relevant'> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return 'kunde'
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        tools: [{
          name: 'klassifiziere_email',
          description: 'Klassifiziert eine eingehende E-Mail danach, ob sie von/an einen echten (potenziellen) Kunden ist oder nicht.',
          input_schema: {
            type: 'object',
            properties: { kategorie: { type: 'string', enum: ['kunde', 'nicht_relevant'] } },
            required: ['kategorie'],
          },
        }],
        tool_choice: { type: 'tool', name: 'klassifiziere_email' },
        messages: [{
          role: 'user',
          content: `Du hilfst, den E-Mail-Posteingang einer Unternehmensberatung/Immobilien-/Finanzierungsholding (Mayer Holding, info@amayer-holding.com) sauber zu halten. Klassifiziere die folgende eingehende E-Mail:

- "kunde": Eine echte, individuell adressierte Anfrage oder Korrespondenz von/an einen bestehenden oder potenziellen Kunden/Mandanten/Interessenten (z. B. Anfrage zu Beratung, Finanzierung, Immobilien, Vertragsunterlagen, persönliche Korrespondenz zu einem konkreten Anliegen).
- "nicht_relevant": Newsletter, Werbe-/Marketing-Mails, automatisierte Rechnungen/Belege/Quittungen (z. B. PayPal, Zoom, Telefonanbieter), Spam, Lead-Marktplatz-Benachrichtigungen (z. B. bark.com), Kontoauszüge, Systembenachrichtigungen, Abo-Dienste, Vereins-/Schul-Rundmails ohne direkten Geschäftsbezug.

Im Zweifel (du bist dir nicht sicher, ob Geschäftsbezug zu einem Kunden/Interessenten besteht) wähle "kunde", damit nichts Wichtiges verloren geht.

Von: ${vonName} <${von}>
Betreff: ${betreff}
Ausschnitt: ${ausschnitt.slice(0, 300)}`,
        }],
      }),
    })
    if (!res.ok) return 'kunde'
    const data = await res.json()
    const toolUse = data.content?.find((c: { type: string }) => c.type === 'tool_use')
    const kategorie = toolUse?.input?.kategorie
    return kategorie === 'nicht_relevant' ? 'nicht_relevant' : 'kunde'
  } catch (err) {
    console.error('Relevanz-Klassifizierung fehlgeschlagen', err)
    return 'kunde'
  }
}

// Live-Gegenstück zu scripts/auto-assign-emails.mjs (dort nur als Einmal-Lauf für den historischen
// Rückstand): ordnet eine neu eingehende Kunden-Mail automatisch zu, wenn genau ein Kunde/Mandant
// (über alle Bereiche hinweg) exakt dieselbe E-Mail-Adresse hinterlegt hat — sonst (kein Treffer
// oder mehrere Kunden teilen sich dieselbe Adresse) bleibt die Mail unzugeordnet und taucht im
// Postfach weiter zur manuellen Zuordnung auf. Ein Fehler hier darf das Einsortieren der Mail
// selbst nicht verhindern.
async function versucheAutomatischeZuordnung(
  supabase: ReturnType<typeof createClient>,
  von: string,
  vonName: string,
  betreff: string,
  anhaenge: { filename: string; size: number; contentType: string; url: string }[],
): Promise<{ kundeId: string; bereich: string; kundeName: string } | null> {
  try {
    const { data: treffer, error } = await supabase
      .from('kunden')
      .select('id, bereich, firma, ansprechpartner, dokumente, activities')
      .ilike('email', von.trim())
    if (error || !treffer || treffer.length !== 1) return null

    const kunde = treffer[0]
    const hatAnhaenge = anhaenge.length > 0
    const heute = new Date().toISOString().slice(0, 10)
    const neueDokumente = anhaenge.map((a) => ({
      id: crypto.randomUUID(),
      name: a.filename,
      typ: a.contentType,
      datum: heute,
      groesse: a.size < 1024 * 1024 ? `${Math.round(a.size / 1024)} KB` : `${(a.size / (1024 * 1024)).toFixed(1)} MB`,
      url: a.url,
    }))
    const activity = {
      id: crypto.randomUUID(),
      date: heute,
      text: hatAnhaenge
        ? `E-Mail automatisch zugeordnet: „${betreff}" von ${vonName} (${anhaenge.length} Anhang/Anhänge in Dokumente abgelegt)`
        : `E-Mail automatisch zugeordnet: „${betreff}" von ${vonName}`,
      user: 'System (automatische E-Mail-Zuordnung)',
    }
    const { error: updateError } = await supabase
      .from('kunden')
      .update({
        dokumente: [...neueDokumente, ...((kunde.dokumente as unknown[]) ?? [])],
        activities: [activity, ...((kunde.activities as unknown[]) ?? [])],
      })
      .eq('id', kunde.id)
    if (updateError) {
      console.error('Automatische Zuordnung fehlgeschlagen (Kunde-Update)', updateError)
      return null
    }
    return { kundeId: kunde.id, bereich: kunde.bereich, kundeName: `${kunde.firma} (${kunde.ansprechpartner})` }
  } catch (err) {
    console.error('Automatische Zuordnung fehlgeschlagen', err)
    return null
  }
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
      const pfad = `${sicheresPfadsegment(messageId)}/${sicheresPfadsegment(datei.name)}`
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

  const ausschnitt = text.slice(0, 500)
  const relevanz = await klassifiziereRelevanz(vonName, von, betreff, ausschnitt)
  const zuordnung = relevanz === 'kunde' ? await versucheAutomatischeZuordnung(supabase, von, vonName, betreff, anhaenge) : null

  const { error } = await supabase.from('eingegangene_emails').insert({
    message_id: messageId,
    von,
    von_name: vonName,
    betreff,
    ausschnitt,
    rohdaten: payload,
    anhaenge: anhaenge.length > 0 ? anhaenge : null,
    relevanz,
    zugewiesener_kunde_id: zuordnung?.kundeId ?? null,
    zugewiesener_bereich: zuordnung?.bereich ?? null,
    zugewiesener_kunde_name: zuordnung?.kundeName ?? null,
  })

  if (error) {
    console.error('insert failed', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
})
