#!/usr/bin/env node
// Einmaliges Skript: legt ein minimales Immobilien-Objekt "Karlstr. 46, Blaubeuren" an, dem die 2
// losen Aufteilungsplan-PDFs aus Quirins Finanzierungs-Altbestand (M-Z/Z/, keinem Kunden zuordenbar)
// als Dokumente (Ordner "Teilungserklärung") angehängt werden. Entscheidung vom Nutzer, 2026-11-10.

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local'))
} catch {}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BUCKET = 'objekt-dokumente'
const SCRATCH =
  '/private/tmp/claude-501/-Users-erayyesil-Documents-Fundament-IT-UG-mayer-holding-crm/e5a0c7e3-2682-46f8-a7bc-cd1c8689a1a8/scratchpad/quirin-finanzierung/M-Z/Z'

const DATEIEN = [
  { rel: 'Aufteilungsplan Karlstr. 46, Blaubeuren Teil 1.pdf', name: 'Aufteilungsplan Karlstr. 46, Blaubeuren Teil 1.pdf' },
  { rel: 'Teil 2.pdf', name: 'Aufteilungsplan Karlstr. 46, Blaubeuren Teil 2.pdf' },
]

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}
function heute() {
  return new Date().toISOString().slice(0, 10)
}
function formatiereGroesse(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function main() {
  const objektId = uid('o')
  const dokumente = []
  for (const d of DATEIEN) {
    const abs = path.join(SCRATCH, d.rel)
    const buffer = fs.readFileSync(abs)
    const pfad = `${objektId}/${uid('dok')}_${d.name}`
    const { error } = await supabase.storage.from(BUCKET).upload(pfad, buffer, { contentType: 'application/pdf' })
    if (error) throw new Error(`Upload fehlgeschlagen für ${d.rel}: ${error.message}`)
    dokumente.push({ id: uid('dok'), name: d.name, typ: 'application/pdf', datum: heute(), groesse: formatiereGroesse(buffer.length), url: pfad })
    console.log(`Hochgeladen: ${d.name} (${formatiereGroesse(buffer.length)})`)
  }

  const row = {
    id: objektId,
    bezeichnung: 'Karlstr. 46, Blaubeuren',
    adresse: 'Karlstr. 46, Blaubeuren',
    gruppe: 'aktuell',
    typ: 'Wohnung',
    kaufpreis: 0,
    prioritaet: 'Mittel',
    status: 'akquise',
    follow_up: {},
    verantwortlich: 'Quirin Lutzenberger',
    activities: [{ id: uid('act'), date: heute(), text: 'Angelegt aus Quirins Finanzierungs-Altbestand (lose Aufteilungsplan-Dokumente ohne zugehörigen Kunden).', user: 'Import' }],
    dokumente: { 'Teilungserklärung': dokumente },
  }

  const { error: insertError } = await supabase.from('objekte').insert(row)
  if (insertError) throw new Error(`Anlegen fehlgeschlagen: ${insertError.message}`)

  console.log(`\nFertig. Objekt ${objektId} "Karlstr. 46, Blaubeuren" angelegt mit ${dokumente.length} Dokumenten.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
