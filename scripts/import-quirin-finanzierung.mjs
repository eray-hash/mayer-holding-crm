#!/usr/bin/env node
// Einmaliges Import-Skript: übernimmt Quirins realen Finanzierungs-Altbestand (26 Mandanten-Ordner
// aus 5 ZIPs "Finanzierung A/B-D/E-H/I-M/M-Z zip.zip", lokal entpackt) als echte Kunden/Mandanten
// in public.kunden (bereich: 'finanzierungen') samt aller Original-Dokumente, hochgeladen in den
// privaten Supabase-Storage-Bucket "kunden-dokumente" (siehe kundenDokumenteStorage.ts).
//
// Entscheidungen vom Nutzer (siehe Chat, 2026-11-09):
// - Namen, die schon unter einem ANDEREN Bereich existieren (Yildiz Efter, Seyfettin Bulut,
//   Hülya Kartal, Kitcom), bekommen trotzdem einen NEUEN Finanzierungen-Datensatz (1 Zeile pro
//   Person+Bereich, wie im übrigen CRM üblich) statt den bestehenden umzubereichen.
// - Andreas Mayer (Geschäftsführer) wird als normaler Finanzierungs-Kunde aufgenommen, da er hier
//   offenbar privat als Kreditnehmer auftritt.
// - Die 4 Alsaado-Ordner werden 1:1 als 4 separate Kunden angelegt.
// - Mustafa Karakaya existiert schon exakt (bereich=finanzierungen, id s.u.) — Dokumente werden an
//   diesen bestehenden Datensatz angehängt, kein neuer.
// - "Hartmann, Viktor" kommt (Zip-Überlappung) identisch in E-H UND I-M vor — nur einmal verarbeiten.
// - Die lose Datei "tragfähigkeit alexander Wiens...docx" (kein eigener Ordner) wird ein Mini-Kunde
//   mit nur diesem einen Dokument.
// - NICHT übernommen (bewusst außen vor gelassen, kein Kundendatum): interne Admin-Dateien
//   "_Finanzierungen.odt" + "Zeiterfassung/to do Liste _Zeiterfassung.ods" (liegen lose auf
//   Zip-Root-Ebene, keinem Kunden zuordenbar) sowie "Aufteilungsplan Karlstr. 46, Blaubeuren"
//   (kein Mensch, sondern ein Immobilien-Grundriss — es gibt noch kein passendes Objekt in
//   public.objekte, dafür separat nachfragen/anlegen statt hier zu raten).
//
// Sicher NICHT mehrfach ausführen ohne Anpassung — legt bei jedem Lauf neue Kunden/Uploads an.
//
// Lädt SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY automatisch aus .env.local, falls vorhanden.

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local'))
} catch {
  // .env.local existiert nicht — Secrets müssen dann per Umgebungsvariable übergeben werden.
}

function env(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`Fehlt: Umgebungsvariable ${name}`)
    process.exit(1)
  }
  return value
}

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
const BUCKET = 'kunden-dokumente'

const SCRATCH =
  '/private/tmp/claude-501/-Users-erayyesil-Documents-Fundament-IT-UG-mayer-holding-crm/e5a0c7e3-2682-46f8-a7bc-cd1c8689a1a8/scratchpad/quirin-finanzierung'

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

const MIME = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.eml': 'message/rfc822',
  '.url': 'text/plain',
  '.md': 'text/markdown',
}
function mimeFuer(datei) {
  return MIME[path.extname(datei).toLowerCase()] ?? 'application/octet-stream'
}

function dateiDatum(absPath) {
  return fs.statSync(absPath).mtime.toISOString().slice(0, 10)
}

// Supabase Storage lehnt Keys mit Umlauten/Sonderzeichen ab ("Invalid key"/InvalidKey, getestet
// 2026-11-09). Der Storage-Pfad ist ohnehin nur intern (per uid-Präfix eindeutig) — der echte
// Dateiname mit Umlauten bleibt unverändert in Dokument.name für die Anzeige erhalten.
function sanitiereDateiname(name) {
  return name
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/€/g, 'EUR')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
}

// Rekursiv alle Dateien unter `root` sammeln, relativer Pfad mit "/" als Trenner (für Dokument.name).
function sammleDateien(root) {
  const ergebnis = []
  function rek(dir, relPrefix) {
    for (const eintrag of fs.readdirSync(dir, { withFileTypes: true })) {
      if (eintrag.name === '.DS_Store') continue
      const abs = path.join(dir, eintrag.name)
      const rel = relPrefix ? `${relPrefix}/${eintrag.name}` : eintrag.name
      if (eintrag.isDirectory()) rek(abs, rel)
      else ergebnis.push({ abs, rel })
    }
  }
  if (fs.statSync(root).isDirectory()) rek(root, '')
  else ergebnis.push({ abs: root, rel: path.basename(root) })
  return ergebnis
}

const VERANTWORTLICH = 'Quirin Lutzenberger'

// { relPfad-zum-Ordner-oder-Datei-ab-SCRATCH, firma, ansprechpartner, modus: 'neu' | 'bestehend', bestehendeId? }
const MANDANTEN = [
  { rel: 'A/A/Abanoz, Ayse', firma: 'Ayse Abanoz', ansprechpartner: 'Ayse Abanoz' },
  { rel: 'A/A/Akbas, Abdul Celal', firma: 'Abdul Celal Akbas', ansprechpartner: 'Abdul Celal Akbas' },
  { rel: 'A/A/Alpaslan, Ayse', firma: 'Ayse Alpaslan', ansprechpartner: 'Ayse Alpaslan' },
  { rel: 'A/A/Alsaado Burgerladen Biberach', firma: 'Burgerladen Biberach', ansprechpartner: 'Alsaado' },
  { rel: 'A/A/Alsaado, Ibrahim', firma: 'Ibrahim Alsaado', ansprechpartner: 'Ibrahim Alsaado' },
  { rel: 'A/A/Alsaado, Jouma, Hege Restaurant Biberach', firma: 'Hege Restaurant Biberach', ansprechpartner: 'Jouma Alsaado' },
  { rel: 'A/A/Alsaado, Jouma, Immergrün Glacis Galerie', firma: 'Immergrün Glacis Galerie', ansprechpartner: 'Jouma Alsaado' },

  { rel: 'B-D/B/Berker, Sahin', firma: 'Sahin Berker', ansprechpartner: 'Sahin Berker' },
  { rel: 'B-D/B/Bozilovic Danilo', firma: 'Danilo Bozilovic', ansprechpartner: 'Danilo Bozilovic' },
  { rel: 'B-D/B/Bulut, Seyfettin', firma: 'Seyfettin Bulut', ansprechpartner: 'Seyfettin Bulut' },
  { rel: 'B-D/C/Caras', firma: 'Caras', ansprechpartner: 'Caras' },
  { rel: 'B-D/D/Dönmez, Nurcan', firma: 'Nurcan Dönmez', ansprechpartner: 'Nurcan Dönmez' },

  { rel: 'E-H/G/Georgiev, Emil', firma: 'Emil Georgiev', ansprechpartner: 'Emil Georgiev' },
  { rel: 'E-H/G/Gkiritli', firma: 'Gkiritli', ansprechpartner: 'Gkiritli' },
  { rel: 'E-H/G/Gökbulut, Gökay', firma: 'Gökay Gökbulut', ansprechpartner: 'Gökay Gökbulut' },
  { rel: 'E-H/H/Hartmann, Viktor', firma: 'Viktor Hartmann', ansprechpartner: 'Viktor Hartmann' },
  // I-M/H/Hartmann, Viktor ist eine exakte Doublette (Zip-Grenzüberlappung) — bewusst übersprungen.

  { rel: 'I-M/K/Karacizmeli', firma: 'Nihat Karacizmeli', ansprechpartner: 'Nihat Karacizmeli' },
  {
    rel: 'I-M/K/Karakaya, Mustafa',
    modus: 'bestehend',
    bestehendeId: 'k_i4vguufbc0m', // ZenKa Gastro GmbH / CiaoBella, bereich=finanzierungen, existiert schon
  },
  { rel: 'I-M/K/Kartal, Hülya', firma: 'Hülya Kartal', ansprechpartner: 'Hülya Kartal' },
  { rel: 'I-M/K/Kitcom, Friedl', firma: 'KITCOM Edelstahl-Schlosserei', ansprechpartner: 'Friedl Kitcom' },

  { rel: 'M-Z/M/Maier, Hans Peter', firma: 'Hans Peter Maier', ansprechpartner: 'Hans Peter Maier' },
  { rel: 'M-Z/M/Mayer Andreas', firma: 'Andreas Mayer', ansprechpartner: 'Andreas Mayer' },
  { rel: 'M-Z/M/Mendes, Dominik', firma: 'Dominik Mendes', ansprechpartner: 'Dominik Mendes' },
  { rel: 'M-Z/T/Tolga, Serkan', firma: 'Serkan Tolga', ansprechpartner: 'Serkan Tolga' },
  { rel: 'M-Z/Y/Yildiz Efter', firma: 'Ali-Efter Yildiz', ansprechpartner: 'Ali-Efter Yildiz' },
  { rel: 'M-Z/Z/Zengin, Ümit', firma: 'Ümit Zengin', ansprechpartner: 'Ümit Zengin' },
  {
    rel: "M-Z/W/tragfähigkeit alexander Wiens 09.08.2024.docx",
    firma: 'Alexander Wiens',
    ansprechpartner: 'Alexander Wiens',
  },
]

async function ladeDateiHoch(kundeId, abs, basisName) {
  const buffer = fs.readFileSync(abs)
  const pfad = `${kundeId}/${uid('dok')}_${sanitiereDateiname(basisName)}`
  const { error } = await supabase.storage.from(BUCKET).upload(pfad, buffer, { contentType: mimeFuer(abs) })
  if (error) throw new Error(error.message)
  return { pfad, groesse: formatiereGroesse(buffer.length) }
}

async function verarbeiteMandant(m) {
  const wurzel = path.join(SCRATCH, m.rel)
  if (!fs.existsSync(wurzel)) {
    console.error(`FEHLT auf Platte, übersprungen: ${m.rel}`)
    return { rel: m.rel, fehler: 'Pfad nicht gefunden', dokumente: 0 }
  }

  const dateien = sammleDateien(wurzel).filter((d) => fs.statSync(d.abs).size > 0)
  const kundeId = m.modus === 'bestehend' ? m.bestehendeId : uid('k')

  console.log(`\n${m.rel} -> ${m.modus === 'bestehend' ? `bestehender Kunde ${kundeId}` : `neuer Kunde ${kundeId} (${m.ansprechpartner})`} — ${dateien.length} Dateien`)

  const neueDokumente = []
  for (const d of dateien) {
    try {
      const basisName = path.basename(d.abs)
      const { pfad, groesse } = await ladeDateiHoch(kundeId, d.abs, basisName)
      neueDokumente.push({ id: uid('dok'), name: d.rel, typ: mimeFuer(d.abs), datum: dateiDatum(d.abs), groesse, url: pfad })
    } catch (err) {
      console.error(`  Upload fehlgeschlagen für ${d.rel}:`, err instanceof Error ? err.message : err)
    }
  }

  if (m.modus === 'bestehend') {
    const { data: bestehend, error: ladeFehler } = await supabase.from('kunden').select('dokumente, activities').eq('id', kundeId).single()
    if (ladeFehler) {
      console.error(`  Bestehender Kunde ${kundeId} nicht gefunden:`, ladeFehler.message)
      return { rel: m.rel, fehler: ladeFehler.message, dokumente: neueDokumente.length }
    }
    const dokumente = [...(bestehend.dokumente ?? []), ...neueDokumente]
    const activities = [
      ...(bestehend.activities ?? []),
      { id: uid('act'), date: heute(), text: `${neueDokumente.length} Dokumente aus Quirins Finanzierungs-Altbestand übernommen.`, user: 'Import' },
    ]
    const { error: updateFehler } = await supabase.from('kunden').update({ dokumente, activities }).eq('id', kundeId)
    if (updateFehler) console.error(`  Update fehlgeschlagen für ${kundeId}:`, updateFehler.message)
  } else {
    const row = {
      id: kundeId,
      bereich: 'finanzierungen',
      firma: m.firma,
      ansprechpartner: m.ansprechpartner,
      email: '',
      telefon: '',
      prioritaet: 'Mittel',
      status: 'interessent',
      follow_up: {},
      verantwortlich: VERANTWORTLICH,
      letzte_aktivitaet: heute(),
      activities: [{ id: uid('act'), date: heute(), text: `${neueDokumente.length} Dokumente aus Quirins Finanzierungs-Altbestand übernommen.`, user: 'Import' }],
      dokumente: neueDokumente,
    }
    const { error: insertFehler } = await supabase.from('kunden').insert(row)
    if (insertFehler) console.error(`  Anlegen fehlgeschlagen für ${kundeId}:`, insertFehler.message)
  }

  return { rel: m.rel, dokumente: neueDokumente.length }
}

async function main() {
  const ergebnisse = []
  for (const m of MANDANTEN) {
    ergebnisse.push(await verarbeiteMandant(m))
  }
  const gesamt = ergebnisse.reduce((s, r) => s + r.dokumente, 0)
  console.log(`\n\nFertig. ${ergebnisse.length} Mandanten verarbeitet, ${gesamt} Dokumente hochgeladen.`)
  const fehler = ergebnisse.filter((r) => r.fehler)
  if (fehler.length) {
    console.log('\nMit Fehlern:')
    for (const f of fehler) console.log(`  ${f.rel}: ${f.fehler}`)
  }
}

main().catch((err) => {
  console.error('Import fehlgeschlagen:', err)
  process.exit(1)
})
