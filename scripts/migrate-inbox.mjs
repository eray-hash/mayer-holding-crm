#!/usr/bin/env node
// Einmaliges Migrations-Skript: holt bestehende E-Mails aus dem IONOS-Postfach
// info@amayer-holding.com per IMAP (funktioniert nur außerhalb der Supabase-Edge-
// Function-Laufzeit, siehe README) und schreibt sie in dieselbe Tabelle, die auch
// der Posteingang-Webhook befüllt (public.eingegangene_emails). Per message_id-
// Upsert werden Mails, die der Webhook bereits erfasst hat, übersprungen statt
// dupliziert.
//
// IONOS beendet lang laufende IMAP-Sessions von sich aus (beobachtet nach ca.
// 1300+ Mails in einer Verbindung) — das Skript merkt sich deshalb die zuletzt
// verarbeitete UID und baut die Verbindung bei einem Abbruch automatisch neu auf,
// statt komplett abzubrechen.
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

function createImapClient() {
  return new ImapFlow({
    host: env('IMAP_HOST', 'imap.ionos.de'),
    port: Number(env('IMAP_PORT', '993')),
    secure: true,
    auth: { user: env('IMAP_USER'), pass: env('IMAP_PASSWORD') },
    logger: false,
  })
}

async function importMessage(message) {
  const parsed = await simpleParser(message.source)
  const rawFrom = parsed.from?.text ?? 'unbekannt'
  const { email: von, name: vonName } = parseFromHeader(rawFrom)
  const betreff = parsed.subject ?? '(ohne Betreff)'
  const text = (parsed.text ?? '').trim()
  const messageId = parsed.messageId ?? `imap-uid-${message.uid}`
  const mailDatum = parsed.date ?? new Date()

  return supabase.from('eingegangene_emails').upsert(
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
}

async function main() {
  const limit = process.env.IMAP_LIMIT ? Number(process.env.IMAP_LIMIT) : undefined
  const maxAttempts = 8

  let imported = 0
  let skipped = 0
  let lastUid = null // wird nach dem ersten erfolgreichen connect gesetzt
  let attempt = 0

  while (true) {
    attempt++
    const client = createImapClient()
    try {
      console.log(attempt === 1 ? 'Verbinde mit IMAP...' : `Verbinde erneut mit IMAP (Versuch ${attempt})...`)
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        if (lastUid === null) {
          const status = await client.status('INBOX', { messages: true })
          const total = status.messages ?? 0
          console.log(`${total} E-Mails im Postfach gefunden.`)
          if (total === 0) return

          if (limit) {
            const seqFrom = Math.max(1, total - limit + 1)
            const uids = []
            for await (const m of client.fetch(`${seqFrom}:*`, { uid: true })) uids.push(m.uid)
            lastUid = (uids.length ? Math.min(...uids) : 1) - 1
          } else {
            lastUid = 0
          }
        }

        const fromUid = lastUid + 1
        for await (const message of client.fetch(`${fromUid}:*`, { source: true }, { uid: true })) {
          if (message.uid <= lastUid) continue // bereits in einem früheren Versuch verarbeitet
          lastUid = message.uid
          const { error } = await importMessage(message)
          if (error) {
            console.error(`Fehler bei UID ${message.uid}:`, error.message)
            skipped++
          } else {
            imported++
            if (imported % 25 === 0) console.log(`${imported} verarbeitet... (zuletzt UID ${message.uid})`)
          }
        }

        console.log(`Fertig. ${imported} importiert/aktualisiert, ${skipped} fehlgeschlagen.`)
        return
      } finally {
        lock.release()
        await client.logout().catch(() => {})
      }
    } catch (err) {
      console.error(`Verbindung unterbrochen (zuletzt verarbeitete UID: ${lastUid ?? '–'}): ${err.message}`)
      try {
        client.close() // synchron, kein Promise
      } catch {
        // Verbindung ist ohnehin schon weg
      }
      if (attempt >= maxAttempts) {
        console.error(`Maximale Anzahl an Wiederverbindungsversuchen erreicht (${maxAttempts}). Abbruch.`)
        console.error(`${imported} importiert/aktualisiert, ${skipped} fehlgeschlagen bis dahin. Einfach erneut starten, um fortzusetzen (dank Upsert werden bereits importierte Mails nicht dupliziert).`)
        process.exit(1)
      }
      console.log('Warte 5 Sekunden und verbinde erneut...')
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
}

main().catch((err) => {
  console.error('Migration fehlgeschlagen:', err)
  process.exit(1)
})
