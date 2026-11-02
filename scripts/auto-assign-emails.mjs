#!/usr/bin/env node
// Einmaliges/rerunnbares Backfill-Skript: ordnet bereits importierte E-Mails aus
// public.eingegangene_emails automatisch einem Kunden/Mandanten zu, wenn genau ein Kunde (über
// alle Bereiche hinweg) exakt dieselbe E-Mail-Adresse hinterlegt hat — dasselbe Verhalten, das
// supabase/functions/inbound-email/index.ts jetzt für neu eingehende Mails live macht (siehe dort
// versucheAutomatischeZuordnung). Mails mit keinem oder mehreren Treffern bleiben unverändert und
// damit weiter zur manuellen Zuordnung im Postfach sichtbar.
//
// Sicher mehrfach ausführbar: überspringt Mails, die bereits eine zugewiesener_kunde_id haben.
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

function formatGroesse(size) {
  return size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

async function main() {
  const { data: kundenRows, error: kundenError } = await supabase
    .from('kunden')
    .select('id, bereich, firma, ansprechpartner, email, dokumente, activities')
  if (kundenError) {
    console.error('Kunden konnten nicht geladen werden:', kundenError.message)
    process.exit(1)
  }

  // Index nach E-Mail-Adresse, um mehrdeutige Treffer (mehrere Kunden mit derselben Adresse,
  // ggf. über Bereiche hinweg) sicher zu erkennen statt "irgendeinen" davon zu nehmen.
  const kundenByEmail = new Map()
  const kundenById = new Map()
  for (const k of kundenRows ?? []) {
    kundenById.set(k.id, k)
    const key = (k.email ?? '').trim().toLowerCase()
    if (!key) continue
    if (!kundenByEmail.has(key)) kundenByEmail.set(key, [])
    kundenByEmail.get(key).push(k.id)
  }

  // relevanz ist bei älteren Mails NULL (nicht klassifiziert) — "<> 'nicht_relevant'" würde NULL-
  // Zeilen fälschlich ausschließen (SQL: NULL <> x ist NULL, nicht true), deshalb explizit "oder NULL".
  const { data: mails, error: mailsError } = await supabase
    .from('eingegangene_emails')
    .select('id, von, von_name, betreff, anhaenge, zugewiesener_kunde_id')
    .is('zugewiesener_kunde_id', null)
    .or('relevanz.is.null,relevanz.neq.nicht_relevant')
    .order('mail_datum', { ascending: true })
  if (mailsError) {
    console.error('E-Mails konnten nicht geladen werden:', mailsError.message)
    process.exit(1)
  }

  let zugeordnet = 0
  let mehrdeutig = 0
  let keinTreffer = 0
  const dirtyKunden = new Set()
  const mailUpdates = []

  for (const mail of mails ?? []) {
    const key = (mail.von ?? '').trim().toLowerCase()
    const treffer = kundenByEmail.get(key)
    if (!treffer || treffer.length === 0) {
      keinTreffer++
      continue
    }
    if (treffer.length > 1) {
      mehrdeutig++
      continue
    }

    const kunde = kundenById.get(treffer[0])
    const anhaenge = mail.anhaenge ?? []
    const hatAnhaenge = anhaenge.length > 0
    const neueDokumente = anhaenge.map((a) => ({
      id: crypto.randomUUID(),
      name: a.filename,
      typ: a.contentType,
      datum: heute(),
      groesse: formatGroesse(a.size),
      url: a.url,
    }))
    const activity = {
      id: crypto.randomUUID(),
      date: heute(),
      text: hatAnhaenge
        ? `E-Mail automatisch zugeordnet: „${mail.betreff}" von ${mail.von_name} (${anhaenge.length} Anhang/Anhänge in Dokumente abgelegt)`
        : `E-Mail automatisch zugeordnet: „${mail.betreff}" von ${mail.von_name}`,
      user: 'System (automatische E-Mail-Zuordnung)',
    }

    // In-Memory kumulieren statt pro Mail neu aus der DB zu lesen, damit mehrere Mails an
    // denselben Kunden in diesem Lauf nicht gegenseitig ihre Dokumente/Aktivitäten überschreiben.
    kunde.dokumente = [...neueDokumente, ...(kunde.dokumente ?? [])]
    kunde.activities = [activity, ...(kunde.activities ?? [])]
    dirtyKunden.add(kunde.id)

    mailUpdates.push({
      id: mail.id,
      zugewiesener_kunde_id: kunde.id,
      zugewiesener_bereich: kunde.bereich,
      zugewiesener_kunde_name: `${kunde.firma} (${kunde.ansprechpartner})`,
    })
    zugeordnet++
  }

  for (const kundeId of dirtyKunden) {
    const kunde = kundenById.get(kundeId)
    const { error } = await supabase.from('kunden').update({ dokumente: kunde.dokumente, activities: kunde.activities }).eq('id', kundeId)
    if (error) console.error(`Kunde ${kunde.firma} konnte nicht aktualisiert werden:`, error.message)
  }

  for (const update of mailUpdates) {
    const { id, ...patch } = update
    const { error } = await supabase.from('eingegangene_emails').update(patch).eq('id', id)
    if (error) console.error(`E-Mail ${id} konnte nicht als zugeordnet markiert werden:`, error.message)
  }

  console.log(`Fertig. ${zugeordnet} E-Mails automatisch zugeordnet, ${mehrdeutig} mehrdeutig (mehrere Kunden teilen sich die Adresse, übersprungen), ${keinTreffer} ohne Treffer (bleiben für manuelle Zuordnung im Postfach).`)
}

main().catch((err) => {
  console.error('Automatische Zuordnung fehlgeschlagen:', err)
  process.exit(1)
})
