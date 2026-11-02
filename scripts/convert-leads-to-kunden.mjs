#!/usr/bin/env node
// Einmaliges/rerunnbares Skript: übernimmt alle offenen Lead-Vorschläge aus
// public.vorgeschlagene_leads (angelegt von scripts/extract-leads.mjs bzw. der
// classify_new_leads-Aktion der email-gateway-Funktion) als echte Kunden/Mandanten in
// public.kunden — Bulk-Pendant zum manuellen "Übernehmen"-Klick pro Lead im Postfach
// (src/pages/postfach/Postfach.tsx, neuerKunde()/addKundeZuBereich()), dessen Felder hier bewusst
// 1:1 nachgebaut werden, damit neu angelegte Kunden sich nicht von manuell übernommenen
// unterscheiden.
//
// Lädt SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY automatisch aus .env.local, falls vorhanden (siehe
// scripts/setup-local-secrets.sh) — sonst per Umgebungsvariable übergeben.

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local'))
} catch {
  // .env.local existiert nicht — Secrets müssen dann per Umgebungsvariable übergeben werden.
}

function env(name, fallback) {
  const value = process.env[name] ?? fallback
  if (value === undefined) {
    console.error(`Fehlt: Umgebungsvariable ${name}`)
    process.exit(1)
  }
  return value
}

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

function heute() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

// Gleiche Platzhalter-Belegung wie der bestehende manuelle "Übernehmen"-Klick im Postfach
// (es gibt noch kein echtes Mitarbeiter-/Berechtigungssystem, siehe Postfach.tsx neuerKunde()).
const VERANTWORTLICH_DEFAULT = 'Thomas Berger'

// Bereiche ohne eigene Kunde[]-Liste (Immobilien führt Objekte statt Kunden) bzw. "unklar" aus der
// KI-Klassifizierung landen in der Allzweck-Bereich "beratung", damit kein Lead verloren geht.
const BEREICH_FALLBACK = 'beratung'
function bereichOderFallback(bereich) {
  return bereich && bereich !== 'unklar' && bereich !== 'immobilien' ? bereich : BEREICH_FALLBACK
}

// Erster Status je Bereichs-Pipeline (siehe src/data/statusNetworks.ts) — damit neu angelegte
// Kunden im jeweiligen Beratungsnetz korrekt ganz am Anfang stehen statt mit einer für den
// Bereich ungültigen Status-ID (das bestehende neuerKunde() im Postfach setzt pauschal "lead",
// was nur für "beratung" ein gültiger Status ist).
const ERSTER_STATUS = {
  beratung: 'lead',
  erben: 'erstkontakt',
  betriebsuebergabe: 'erstkontakt',
  betriebsformen: 'erstkontakt',
  akademie: 'interessent',
  finanzierungen: 'interessent',
}

function leadToKundeRow(lead, bereich) {
  return {
    id: uid('k'),
    bereich,
    firma: lead.firma || lead.name || lead.email,
    ansprechpartner: lead.name || lead.firma || lead.email,
    email: lead.email,
    telefon: lead.telefon || '',
    prioritaet: 'Mittel',
    status: ERSTER_STATUS[bereich] ?? 'erstkontakt',
    follow_up: { date: addDays(heute(), 2), note: 'Erstkontakt aufnehmen', done: false },
    verantwortlich: VERANTWORTLICH_DEFAULT,
    letzte_aktivitaet: heute(),
    activities: [{ id: uid('act'), date: heute(), text: `Als Lead aus E-Mail-Analyse übernommen: „${lead.notiz}"`, user: 'KI-Lead-Analyse' }],
    dokumente: null, // wird im Anschluss von scripts/auto-assign-emails.mjs befüllt
  }
}

async function main() {
  const { data: leads, error } = await supabase.from('vorgeschlagene_leads').select('*').eq('status', 'offen')
  if (error) {
    console.error('Lead-Vorschläge konnten nicht geladen werden:', error.message)
    process.exit(1)
  }
  if (!leads || leads.length === 0) {
    console.log('Keine offenen Lead-Vorschläge gefunden.')
    return
  }

  console.log(`${leads.length} offene Lead-Vorschläge gefunden. Lege Kunden an...`)

  let angelegt = 0
  const proBereich = {}

  for (const lead of leads) {
    const bereich = bereichOderFallback(lead.bereich_vorschlag)
    const row = leadToKundeRow(lead, bereich)

    const { error: insertError } = await supabase.from('kunden').insert(row)
    if (insertError) {
      console.error(`Kunde für ${lead.email} konnte nicht angelegt werden:`, insertError.message)
      continue
    }

    const { error: statusError } = await supabase.from('vorgeschlagene_leads').update({ status: 'uebernommen' }).eq('id', lead.id)
    if (statusError) console.error(`Lead ${lead.email} konnte nicht als übernommen markiert werden:`, statusError.message)

    angelegt++
    proBereich[bereich] = (proBereich[bereich] ?? 0) + 1
  }

  console.log(`\nFertig. ${angelegt} von ${leads.length} Leads als Kunden angelegt.`)
  for (const [bereich, anzahl] of Object.entries(proBereich)) console.log(`  ${bereich}: ${anzahl}`)
  console.log('\nNächster Schritt: node scripts/auto-assign-emails.mjs, um die E-Mails/Anhänge diesen neuen Kunden zuzuordnen.')
}

main().catch((err) => {
  console.error('Lead-Übernahme fehlgeschlagen:', err)
  process.exit(1)
})
