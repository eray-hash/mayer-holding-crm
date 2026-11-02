#!/usr/bin/env node
// Einmaliges Hilfsskript: legt einen Test-Mitarbeiter-Account an (Supabase-Auth-User + Zeile in
// public.mitarbeiter), ohne auf den (laut Memory unzuverlässigen) Supabase-eigenen Mailversand
// angewiesen zu sein — das Passwort wird direkt per Admin-API gesetzt statt per Einladungsmail.
// Rein für Entwicklungs-/Test-Zwecke, nicht für echte Mitarbeiter (dafür gibt es die
// "Mitarbeiter verwalten"-Seite im CRM selbst, src/pages/admin/MitarbeiterVerwalten.tsx).
//
// Lädt SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY automatisch aus .env.local, falls vorhanden.

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import crypto from 'node:crypto'

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

const EMAIL = process.env.TEST_MITARBEITER_EMAIL ?? 'test@fundament-it.de'
const NAME = process.env.TEST_MITARBEITER_NAME ?? 'Test Mitarbeiter'
const PASSWORT = process.env.TEST_MITARBEITER_PASSWORT ?? crypto.randomBytes(9).toString('base64url')

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

async function main() {
  const { data: existing } = await supabase.auth.admin.listUsers()
  const bestehenderUser = existing?.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase())

  let userId
  if (bestehenderUser) {
    console.log(`Auth-User ${EMAIL} existiert bereits — setze Passwort neu.`)
    const { data, error } = await supabase.auth.admin.updateUserById(bestehenderUser.id, { password: PASSWORT })
    if (error) throw new Error(error.message)
    userId = data.user.id
  } else {
    const { data, error } = await supabase.auth.admin.createUser({ email: EMAIL, password: PASSWORT, email_confirm: true })
    if (error) throw new Error(error.message)
    userId = data.user.id
    console.log(`Auth-User ${EMAIL} angelegt.`)
  }

  const KUNDEN_BEREICHE = ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']
  const { error: mitarbeiterError } = await supabase
    .from('mitarbeiter')
    .upsert({ id: userId, name: NAME, email: EMAIL, rolle: 'mitarbeiter', bereiche: KUNDEN_BEREICHE, aktiv: true }, { onConflict: 'id' })
  if (mitarbeiterError) throw new Error(mitarbeiterError.message)

  console.log(`\nFertig. Login-Daten:`)
  console.log(`  E-Mail:    ${EMAIL}`)
  console.log(`  Passwort:  ${PASSWORT}`)
  console.log(`\nZum Entfernen nach dem Testen: supabase.auth.admin.deleteUser('${userId}') bzw. die Zeile in public.mitarbeiter löschen.`)
}

main().catch((err) => {
  console.error('Test-Mitarbeiter-Anlage fehlgeschlagen:', err)
  process.exit(1)
})
