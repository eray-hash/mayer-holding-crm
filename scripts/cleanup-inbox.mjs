#!/usr/bin/env node
// Einmaliges Aufräum-Skript für public.eingegangene_emails: klassifiziert jede Mail per
// Anthropic-API als "kunde" (echte Kunden-/Interessentenkorrespondenz) oder
// "nicht_relevant" (Newsletter, Werbung, automatisierte Rechnungen/Belege, Spam,
// Lead-Marktplätze wie bark.com, Abo-Dienste, Vereinsrundmails o.Ä.) und löscht
// Letztere aus der Tabelle.
//
// Läuft standardmäßig im DRY RUN: zeigt nur an, was gelöscht würde, und schreibt die
// komplette Liste zur Durchsicht in scripts/cleanup-inbox-report.json. Erst mit
// CONFIRM_DELETE=yes wird tatsächlich gelöscht.
//
// Benötigte Umgebungsvariablen:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
// Optional:
//   CONFIRM_DELETE=yes   (führt die Löschung tatsächlich aus, statt nur anzuzeigen)
//   BATCH_SIZE=25        (Anzahl E-Mails pro Anthropic-Aufruf)
//
//   SUPABASE_URL=https://qyqtxltwgetliddwceox.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY='...' \
//   ANTHROPIC_API_KEY='...' \
//   node scripts/cleanup-inbox.mjs

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

function env(name, fallback) {
  const value = process.env[name] ?? fallback
  if (value === undefined) {
    console.error(`Fehlt: Umgebungsvariable ${name}`)
    process.exit(1)
  }
  return value
}

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY')
const BATCH_SIZE = Number(env('BATCH_SIZE', '25'))
const CONFIRM_DELETE = process.env.CONFIRM_DELETE === 'yes'

const TOOL = {
  name: 'klassifiziere_emails',
  description: 'Klassifiziert eine Liste von E-Mails danach, ob sie von/an einen echten (potenziellen) Kunden sind oder nicht.',
  input_schema: {
    type: 'object',
    properties: {
      ergebnisse: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            kategorie: { type: 'string', enum: ['kunde', 'nicht_relevant'] },
          },
          required: ['id', 'kategorie'],
        },
      },
    },
    required: ['ergebnisse'],
  },
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function classifyBatch(emails) {
  const list = emails
    .map((e, i) => `${i + 1}. id=${e.id}\nVon: ${e.von_name} <${e.von}>\nBetreff: ${e.betreff}\nAusschnitt: ${(e.ausschnitt ?? '').slice(0, 200)}`)
    .join('\n\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [
        {
          role: 'user',
          content: `Du hilfst, den E-Mail-Posteingang einer Unternehmensberatung/Immobilien-/Finanzierungsholding (Mayer Holding, info@amayer-holding.com) aufzuräumen. Klassifiziere jede der folgenden E-Mails:

- "kunde": Eine echte, individuell adressierte Anfrage oder Korrespondenz von/an einen bestehenden oder potenziellen Kunden/Mandanten/Interessenten (z. B. Anfrage zu Beratung, Finanzierung, Immobilien, Vertragsunterlagen, persönliche Korrespondenz zu einem konkreten Anliegen).
- "nicht_relevant": Newsletter, Werbe-/Marketing-Mails, automatisierte Rechnungen/Belege/Quittungen (z. B. PayPal, Zoom, Telefonanbieter), Spam, Lead-Marktplatz-Benachrichtigungen (z. B. bark.com), Kontoauszüge, Systembenachrichtigungen, Abo-Dienste (z. B. getabstract.com), Vereins-/Schul-Rundmails ohne direkten Geschäftsbezug.

Im Zweifel (du bist dir nicht sicher, ob Geschäftsbezug zu einem Kunden/Interessenten besteht) wähle "kunde", damit nichts Wichtiges verloren geht.

E-Mails:

${list}`,
        },
      ],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Anthropic API Fehler ${res.status}: ${text}`)
  }

  const data = await res.json()
  const toolUse = data.content?.find((c) => c.type === 'tool_use')
  if (!toolUse) throw new Error('Keine Tool-Antwort erhalten')
  return toolUse.input.ergebnisse ?? []
}

async function main() {
  console.log('Lade E-Mails aus der Datenbank...')
  const { data: emails, error } = await supabase
    .from('eingegangene_emails')
    .select('id, von, von_name, betreff, ausschnitt')
    .order('mail_datum', { ascending: false })

  if (error) throw new Error(error.message)
  console.log(`${emails.length} E-Mails geladen. Klassifiziere in Batches von ${BATCH_SIZE}...`)

  const batches = chunk(emails, BATCH_SIZE)
  const byId = new Map(emails.map((e) => [e.id, e]))
  const nichtRelevant = []

  for (let i = 0; i < batches.length; i++) {
    const results = await classifyBatch(batches[i])
    for (const r of results) {
      if (r.kategorie === 'nicht_relevant' && byId.has(r.id)) {
        nichtRelevant.push(byId.get(r.id))
      }
    }
    console.log(`Batch ${i + 1}/${batches.length} verarbeitet (${nichtRelevant.length} bisher als nicht relevant markiert)`)
  }

  console.log(`\n${nichtRelevant.length} von ${emails.length} E-Mails als "nicht relevant" eingestuft.`)
  console.log(`${emails.length - nichtRelevant.length} bleiben als Kunden-/Interessentenkorrespondenz erhalten.\n`)

  const reportPath = new URL('./cleanup-inbox-report.json', import.meta.url)
  writeFileSync(reportPath, JSON.stringify(nichtRelevant.map((e) => ({ id: e.id, von: e.von, betreff: e.betreff })), null, 2))
  console.log(`Vollständige Liste zur Durchsicht gespeichert: ${reportPath.pathname}`)

  console.log('\nBeispiele (erste 15):')
  for (const e of nichtRelevant.slice(0, 15)) {
    console.log(`  - ${e.von_name} <${e.von}>: "${e.betreff}"`)
  }

  if (!CONFIRM_DELETE) {
    console.log('\nDRY RUN — es wurde nichts gelöscht. Report prüfen, dann zum tatsächlichen Löschen erneut mit CONFIRM_DELETE=yes starten.')
    return
  }

  console.log('\nLösche...')
  const ids = nichtRelevant.map((e) => e.id)
  const idBatches = chunk(ids, 500)
  let deleted = 0
  for (const batch of idBatches) {
    const { error: delError, count } = await supabase.from('eingegangene_emails').delete({ count: 'exact' }).in('id', batch)
    if (delError) {
      console.error('Fehler beim Löschen:', delError.message)
    } else {
      deleted += count ?? batch.length
    }
  }
  console.log(`Fertig. ${deleted} E-Mails gelöscht.`)
}

main().catch((err) => {
  console.error('Aufräumen fehlgeschlagen:', err)
  process.exit(1)
})
