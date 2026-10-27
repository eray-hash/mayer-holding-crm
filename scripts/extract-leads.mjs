#!/usr/bin/env node
// Einmaliges Skript: analysiert die (bereits per cleanup-inbox.mjs von Spam/Newsletter bereinigten)
// E-Mails in public.eingegangene_emails per Anthropic-API, gruppiert nach Absender, und schreibt
// pro echtem Absender einen Lead-Vorschlag nach public.vorgeschlagene_leads. Die eigentliche
// Übernahme als Kunde/Mandant passiert danach im CRM selbst (Review-Schritt mit Dedup-Check gegen
// die echten, nur lokal im Browser liegenden Kundendaten) — dieses Skript legt nur Vorschläge an,
// nie direkt Kunden.
//
// Benötigte Umgebungsvariablen:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
// Optional:
//   BATCH_SIZE=8   (Anzahl Absender pro Anthropic-Aufruf)
//
//   SUPABASE_URL=https://qyqtxltwgetliddwceox.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY='...' \
//   ANTHROPIC_API_KEY='...' \
//   node scripts/extract-leads.mjs

import { createClient } from '@supabase/supabase-js'

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
const BATCH_SIZE = Number(env('BATCH_SIZE', '8'))

// Eigene/interne Domains ausschließen — das sind keine Leads, sondern Mitarbeiter/Dienstleister-Mails.
const INTERNE_DOMAINS = ['amayer-holding.com', 'fundament-it.de']

const BEREICHE = ['beratung', 'immobilien', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']

const TOOL = {
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
            bereich_vorschlag: { type: 'string', enum: [...BEREICHE, 'unklar'], description: 'Welcher Geschäftsbereich am besten passt.' },
            notiz: { type: 'string', description: 'Ein bis zwei Sätze: worum es geht / aktueller Stand, als Aktivitätsnotiz fürs CRM.' },
          },
          required: ['email', 'relevant', 'bereich_vorschlag', 'notiz'],
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

async function fetchAllEmails() {
  const pageSize = 1000
  const all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('eingegangene_emails')
      .select('von, von_name, betreff, ausschnitt, mail_datum')
      .order('mail_datum', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    all.push(...data)
    if (data.length < pageSize) break
  }
  return all
}

function groupBySender(emails) {
  const groups = new Map()
  for (const e of emails) {
    const email = (e.von ?? '').trim().toLowerCase()
    if (!email || !email.includes('@')) continue
    const domain = email.split('@')[1]
    if (INTERNE_DOMAINS.includes(domain)) continue
    if (!groups.has(email)) groups.set(email, { email, vonName: e.von_name, mails: [] })
    groups.get(email).mails.push({ betreff: e.betreff, ausschnitt: e.ausschnitt, datum: e.mail_datum })
  }
  return [...groups.values()]
}

async function classifyBatch(gruppen) {
  const list = gruppen
    .map((g, i) => {
      const beispiele = g.mails
        .slice(0, 5)
        .map((m) => `  - "${m.betreff}" (${(m.datum ?? '').slice(0, 10)}): ${(m.ausschnitt ?? '').slice(0, 200)}`)
        .join('\n')
      return `${i + 1}. email=${g.email}\nName lt. Absenderfeld: ${g.vonName}\nAnzahl E-Mails: ${g.mails.length}\nBeispiele:\n${beispiele}`
    })
    .join('\n\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [
        {
          role: 'user',
          content: `Du hilfst, aus dem E-Mail-Postfach einer Unternehmensberatungs-/Immobilien-/Finanzierungsholding (Mayer Holding, Bereiche: Unternehmensberatung, Immobilien, Erben, Betriebsübergabe, Betriebsformen, Akademie, Finanzierungen) Lead-Vorschläge für das CRM zu extrahieren. Du bekommst pro Absender eine Zusammenfassung mehrerer E-Mails. Bewerte pro Absender, ob es sich um einen echten (potenziellen) Kunden/Mandanten handelt, und falls ja, zu welchem Geschäftsbereich das am besten passt.

Absender:

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
  console.log('Lade E-Mails...')
  const emails = await fetchAllEmails()
  console.log(`${emails.length} E-Mails geladen.`)

  const gruppen = groupBySender(emails)
  console.log(`${gruppen.length} eindeutige externe Absender gefunden. Klassifiziere in Batches von ${BATCH_SIZE}...`)

  const byEmail = new Map(gruppen.map((g) => [g.email, g]))
  const batches = chunk(gruppen, BATCH_SIZE)

  let vorgeschlagen = 0
  let uebersprungen = 0

  for (let i = 0; i < batches.length; i++) {
    const results = await classifyBatch(batches[i])
    for (const r of results) {
      const gruppe = byEmail.get(r.email?.trim().toLowerCase())
      if (!gruppe) continue
      if (!r.relevant) {
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
          rohdaten: { anzahl_mails: gruppe.mails.length, erste_mail: gruppe.mails.at(-1)?.datum, letzte_mail: gruppe.mails[0]?.datum },
        },
        { onConflict: 'email' },
      )
      if (error) {
        console.error(`Fehler bei ${gruppe.email}:`, error.message)
      } else {
        vorgeschlagen++
      }
    }
    console.log(`Batch ${i + 1}/${batches.length} verarbeitet (${vorgeschlagen} Lead-Vorschläge bisher, ${uebersprungen} als nicht relevant übersprungen)`)
  }

  console.log(`\nFertig. ${vorgeschlagen} Lead-Vorschläge in vorgeschlagene_leads angelegt/aktualisiert, ${uebersprungen} Absender als nicht relevant eingestuft.`)
  console.log('Im CRM unter "Neue Leads" (Postfach) prüfen und übernehmen.')
}

main().catch((err) => {
  console.error('Lead-Extraktion fehlgeschlagen:', err)
  process.exit(1)
})
