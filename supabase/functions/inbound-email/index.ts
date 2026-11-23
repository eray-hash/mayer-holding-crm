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

import { createClient } from 'npm:@supabase/supabase-js@2.119.1'
import { mitAnlass, setzeAnlass } from '../_shared/kiVerbrauch.ts'
import { klassifiziereEingang, nachDemSpeichern } from '../_shared/mailEingang.ts'
import { anhangPfad, mailDatum, parseFromHeader, textAusHtml } from './eingang.ts'

function istDienstSchluessel(token: string): boolean {
  if (token.length < 30) return false
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return true
  try {
    const sammle = (wert: unknown): string[] =>
      typeof wert === 'string' ? [wert] : wert && typeof wert === 'object' ? Object.values(wert as Record<string, unknown>).flatMap(sammle) : []
    return sammle(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')).includes(token)
  } catch {
    return false
  }
}


Deno.serve((req: Request) => mitAnlass(async () => {
  setzeAnlass('mail-eingang')
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Interner Aufruf (nur mit Dienstschlüssel): bereits gespeicherte Mails des gemeinsamen Postfachs mit
  // derselben Einordnung wie beim Eingang neu bewerten — z. B. nach einem Ausfall des KI-Dienstes, in
  // dem alles als relevant durchgerutscht ist. Setzt nur `relevanz`; gelöscht wird nichts.
  const dienst = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (istDienstSchluessel(dienst)) {
    const auftrag = await req.json().catch(() => null)
    const ids: string[] = Array.isArray(auftrag?.neuEinordnen) ? auftrag.neuEinordnen.map(String).slice(0, 100) : []
    if (ids.length === 0) return new Response(JSON.stringify({ error: 'neuEinordnen (Liste von Mail-Kennungen) fehlt' }), { status: 400 })
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: mails, error } = await db.from('eingegangene_emails').select('id, von, von_name, betreff, ausschnitt, relevanz, besitzer_email').in('id', ids)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    const ergebnis: { id: string; vorher: string | null; nachher: string }[] = []
    // deno-lint-ignore no-explicit-any
    for (const m of (mails ?? []) as any[]) {
      if (m.besitzer_email) continue // private Postfächer werden hier nicht angefasst
      const nachher = await klassifiziereEingang(db, { von: m.von ?? '', vonName: m.von_name ?? '', betreff: m.betreff ?? '', text: m.ausschnitt ?? '' })
      if (nachher !== m.relevanz) await db.from('eingegangene_emails').update({ relevanz: nachher }).eq('id', m.id)
      ergebnis.push({ id: m.id, vorher: m.relevanz, nachher })
    }
    return new Response(JSON.stringify({ ok: true, ergebnis }), { headers: { 'content-type': 'application/json' } })
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
  const text = plain ?? (html ? textAusHtml(html) : '')
  const messageId = pick('headers[message_id]', 'headers[message-id]')
    ?? (typeof headers.message_id === 'string' ? headers.message_id : undefined)
    ?? crypto.randomUUID()
  const datum = mailDatum(pick('headers[date]') ?? (typeof headers.date === 'string' ? headers.date : undefined))

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Dieselbe Mail kann zusätzlich über den Postfach-Abruf hereinkommen (er holt die großen Mails, die
  // der Weiterleitungsdienst ablehnt). Was schon im öffentlichen Postfach liegt, nicht doppelt anlegen.
  const { data: schonDa } = await supabase.from('eingegangene_emails').select('id').eq('message_id', messageId).is('besitzer_email', null).limit(1).maybeSingle()
  if (schonDa) return new Response(JSON.stringify({ ok: true, doppelt: true }), { status: 200 })

  // Gefundene Anhänge in den Storage-Bucket "email-anhaenge" hochladen (öffentlich lesbar, wie der
  // Rest dieses Projekts bewusst als internes Tool ohne zusätzliche Zugriffsprüfung behandelt) —
  // ein fehlgeschlagener Upload darf das Einsortieren der E-Mail selbst nicht verhindern.
  const anhaenge: { filename: string; size: number; contentType: string; url: string }[] = []
  for (const [i, datei] of gefundeneDateien.entries()) {
    try {
      const pfad = anhangPfad(messageId, datei.name, i + 1)
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

  // Voller Text (bis 20.000 Zeichen) wie beim Postfach-Abruf — vorher 500, dadurch fehlten Signaturen (22.11.2026).
  const ausschnitt = text.slice(0, 20000)
  const relevanz = await klassifiziereEingang(supabase, { von, vonName, betreff, text: ausschnitt })

  // Erst die Mail speichern, DANN Zuordnung zur Akte und Verbindlichkeit. Vorher lief beides vor dem Speichern: Kam
  // dieselbe Mail ein zweites Mal (der Weiterleitungsdienst wiederholt, wenn die Antwort zu lange dauert oder ein
  // Fehler kommt; der Postfach-Abruf holt große Mails), entstanden Verlaufseintrag, Dokumente und Verbindlichkeit
  // doppelt — und der Fehler beim zweiten Speichern ließ den Dienst immer wieder neu zustellen.
  const { data: gespeichert, error } = await supabase.from('eingegangene_emails').insert({
    message_id: messageId,
    von,
    von_name: vonName,
    betreff,
    mail_datum: datum,
    ausschnitt,
    rohdaten: payload,
    anhaenge: anhaenge.length > 0 ? anhaenge : null,
    relevanz,
  }).select('id').maybeSingle()

  if (error) {
    // 23505 = dieselbe Message-ID ist inzwischen gespeichert (gleichzeitige Zustellung) — erledigt, kein neuer Versuch.
    if (error.code === '23505') return new Response(JSON.stringify({ ok: true, doppelt: true }), { status: 200 })
    console.error('insert failed', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  await nachDemSpeichern(supabase, gespeichert?.id ?? null, { messageId, von, vonName, betreff, text, anhaenge }, relevanz)

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}))
