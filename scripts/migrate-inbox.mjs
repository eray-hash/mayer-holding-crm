#!/usr/bin/env node
// Einmaliges Migrations-Skript: holt bestehende E-Mails aus dem IONOS-Postfach
// info@amayer-holding.com per IMAP (funktioniert nur außerhalb der Supabase-Edge-
// Function-Laufzeit, siehe README) und schreibt sie in dieselbe Tabelle, die auch
// der Posteingang-Webhook befüllt (public.eingegangene_emails). Per message_id-
// Upsert werden Mails, die der Webhook bereits erfasst hat, übersprungen statt
// dupliziert.
//
// Einmalig lokal ausführen, NICHT in CI/CD. Zugangsdaten nur per Umgebungsvariable
// übergeben, nie im Code oder in der Shell-History fest hinterlegt:
//
//   IMAP_USER=info@amayer-holding.com \
//   IMAP_PASSWORD='...' \
//   SUPABASE_URL=https://qyqtxltwgetliddwceox.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY='...' \
//   node scripts/migrate-inbox.mjs
//
// Optional: IMAP_HOST (Standard imap.ionos.de), IMAP_PORT (Standard 993),
// IMAP_LIMIT (nur die letzten N Mails statt aller).

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createClient } from '@supabase/supabase-js'

function env(name, fallback) {
  const value = process.env[name] ?? fallback
  if (value === undefined) {
    console.error(`Fehlt: Umgebungsvariable ${name}`)
    process.exit(1)
  }
  return value
}

function parseFromHeader(raw) {
  const match = raw.match(/^(.*?)<(.+)>$/)
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '')
    const email = match[2].trim()
    return { email, name: name || email }
  }
  return { email: raw.trim(), name: raw.trim() }
}

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

const client = new ImapFlow({
  host: env('IMAP_HOST', 'imap.ionos.de'),
  port: Number(env('IMAP_PORT', '993')),
  secure: true,
  auth: { user: env('IMAP_USER'), pass: env('IMAP_PASSWORD') },
  logger: false,
})

async function main() {
  console.log('Verbinde mit IMAP...')
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  try {
    const status = await client.status('INBOX', { messages: true })
    const total = status.messages ?? 0
    console.log(`${total} E-Mails im Postfach gefunden.`)
    if (total === 0) return

    const limit = process.env.IMAP_LIMIT ? Number(process.env.IMAP_LIMIT) : undefined
    const from = limit ? Math.max(1, total - limit + 1) : 1

    let imported = 0
    let skipped = 0

    for await (const message of client.fetch(`${from}:*`, { source: true })) {
      const parsed = await simpleParser(message.source)
      const rawFrom = parsed.from?.text ?? 'unbekannt'
      const { email: von, name: vonName } = parseFromHeader(rawFrom)
      const betreff = parsed.subject ?? '(ohne Betreff)'
      const text = (parsed.text ?? '').trim()
      const messageId = parsed.messageId ?? `imap-uid-${message.uid}`
      const mailDatum = parsed.date ?? new Date()

      const { error } = await supabase.from('eingegangene_emails').upsert(
        {
          message_id: messageId,
          von,
          von_name: vonName,
          betreff,
          mail_datum: mailDatum.toISOString(),
          ausschnitt: text.slice(0, 500),
          rohdaten: { quelle: 'imap-migration', uid: message.uid },
        },
        { onConflict: 'message_id' },
      )

      if (error) {
        console.error(`Fehler bei UID ${message.uid} ("${betreff}"):`, error.message)
        skipped++
      } else {
        imported++
        if (imported % 25 === 0) console.log(`${imported} verarbeitet...`)
      }
    }

    console.log(`Fertig. ${imported} importiert/aktualisiert, ${skipped} fehlgeschlagen.`)
  } finally {
    lock.release()
    await client.logout()
  }
}

main().catch((err) => {
  console.error('Migration fehlgeschlagen:', err)
  process.exit(1)
})
