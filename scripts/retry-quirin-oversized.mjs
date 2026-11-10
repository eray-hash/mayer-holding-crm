#!/usr/bin/env node
// Einmaliges Nachhol-Skript: die 6 Dateien, die beim großen Import (import-quirin-finanzierung.mjs)
// am Supabase-Projekt-Storage-Limit gescheitert sind (alle bei Jouma Alsaado / Immergrün Glacis
// Galerie, kundeId k_1yf6tp9wt6u), nachdem der Nutzer das Limit im Dashboard angehoben hat.
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local'))
} catch {}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BUCKET = 'kunden-dokumente'
const KUNDE_ID = 'k_1yf6tp9wt6u'
const ROOT =
  '/private/tmp/claude-501/-Users-erayyesil-Documents-Fundament-IT-UG-mayer-holding-crm/e5a0c7e3-2682-46f8-a7bc-cd1c8689a1a8/scratchpad/quirin-finanzierung/A/A/Alsaado, Jouma, Immergrün Glacis Galerie'

const DATEIEN = [
  'Bank/BWA/BWA_SuSa_2023_01.pdf',
  'Bank/Steuererklärungen/Einkommensteuer_2019.pdf',
  'Bank/Steuererklärungen/Einkommensteuer_2020.pdf',
  'Bank/Steuererklärungen/Einkommensteuer_2021.pdf',
  'Bank/Steuererklärungen/Einkommensteuer_2022.pdf',
  'Bank/Steuererklärungen/Gewinnermittlung Alsaado_2023_07-12 (1).pdf',
]

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}
function formatiereGroesse(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
function sanitiereDateiname(name) {
  return name
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
}

async function main() {
  const neueDokumente = []
  for (const rel of DATEIEN) {
    const abs = path.join(ROOT, rel)
    const buffer = fs.readFileSync(abs)
    const basisName = path.basename(abs)
    const pfad = `${KUNDE_ID}/${uid('dok')}_${sanitiereDateiname(basisName)}`
    const { error } = await supabase.storage.from(BUCKET).upload(pfad, buffer, { contentType: 'application/pdf' })
    if (error) {
      console.error(`Fehlgeschlagen: ${rel}:`, error.message)
      continue
    }
    const datum = fs.statSync(abs).mtime.toISOString().slice(0, 10)
    neueDokumente.push({ id: uid('dok'), name: rel, typ: 'application/pdf', datum, groesse: formatiereGroesse(buffer.length), url: pfad })
    console.log(`OK: ${rel} (${formatiereGroesse(buffer.length)})`)
  }

  if (neueDokumente.length === 0) {
    console.log('Keine Datei erfolgreich hochgeladen, kein Update.')
    return
  }

  const { data: kunde, error: ladeFehler } = await supabase.from('kunden').select('dokumente, activities').eq('id', KUNDE_ID).single()
  if (ladeFehler) {
    console.error('Kunde nicht gefunden:', ladeFehler.message)
    process.exit(1)
  }
  const dokumente = [...(kunde.dokumente ?? []), ...neueDokumente]
  const activities = [
    ...(kunde.activities ?? []),
    { id: uid('act'), date: new Date().toISOString().slice(0, 10), text: `${neueDokumente.length} zuvor zu große Dokumente nachträglich übernommen (Supabase-Limit angehoben).`, user: 'Import' },
  ]
  const { error: updateFehler } = await supabase.from('kunden').update({ dokumente, activities }).eq('id', KUNDE_ID)
  if (updateFehler) {
    console.error('Update fehlgeschlagen:', updateFehler.message)
    process.exit(1)
  }
  console.log(`\nFertig. ${neueDokumente.length} von ${DATEIEN.length} Dateien nachgeholt.`)
}

main().catch((err) => {
  console.error('Fehlgeschlagen:', err)
  process.exit(1)
})
