// Assistent-Werkzeug mahn_vorschlaege mit der Testdatenbank (nur lesen).
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehreMahnVorschlagWerkzeugAus } from './mahnVorschlagWerkzeug.ts'

function daten() {
  return falscheDatenbank({
    mahn_einstellung: [{ id: 1, aktiv: true, tage_erinnerung: 3, tage_mahnung1: 14, tage_mahnung2: 28, ruhe_tage_zahlung: 3 }],
    rechnungen: [
      { id: 'r1', nummer: 'RE-2026-001', kunde_id: 'k_brot', status: 'Versendet', zahlungsziel: '2026-11-18', mahnstufe: null, betrag_brutto: 1190, zahlungen: [], mahnungen: [] },
      { id: 'r2', nummer: 'RE-2026-002', kunde_id: 'k_erbe', status: 'Versendet', zahlungsziel: '2026-11-10', mahnstufe: null, betrag_brutto: 500, zahlungen: [], mahnungen: [] },
      { id: 'r3', nummer: 'RE-2026-003', kunde_id: 'k_brot', status: 'Versendet', zahlungsziel: '2026-11-01', mahnstufe: null, betrag_brutto: 300, zahlungen: [{ datum: '2026-11-22', betrag: 100 }], mahnungen: [] },
      { id: 'r4', nummer: 'RE-2026-004', kunde_id: 'k_brot', status: 'Versendet', zahlungsziel: '2026-11-01', mahnstufe: null, betrag_brutto: 300, zahlungen: [], mahnungen: [] },
    ],
    kunden: [
      { id: 'k_brot', bereich: 'beratung', firma: 'Bäckerei Brot', ansprechpartner: '', verantwortlich_email: null },
      { id: 'k_erbe', bereich: 'erben', firma: 'Erbe', ansprechpartner: '', verantwortlich_email: null },
    ],
    mahn_vorschlaege: [
      { id: 'r4:erinnerung', rechnung_id: 'r4', stufe: 'erinnerung', kunde_id: 'k_brot', rechnung_nummer: 'RE-2026-004', status: 'zurueckgestellt', zurueckgestellt_bis: '2026-12-15', notiz: 'Ratenzahlung vereinbart' },
    ],
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.example/' }],
  })
}

const ctx = (db: ReturnType<typeof daten>, bereiche: string[], rolle = 'mitarbeiter') => ({
  supabase: db,
  mitarbeiter: { name: 'Petra', email: 'petra@mayer.de', rolle, bereiche },
  protokolliere: () => {},
  heute: '2026-11-23',
  ladeAuszuege: async () => [],
})

Deno.test('zählt, was heute einen Vorschlag bekäme, und schreibt nichts', async () => {
  const db = daten()
  const vorher = JSON.stringify(db.tabellen)
  const t = await fuehreMahnVorschlagWerkzeugAus('mahn_vorschlaege', {}, ctx(db, [], 'geschaeftsfuehrung'))
  assertStringIncludes(t, 'Heute bekämen 2 Rechnungen einen Mahnvorschlag')
  assertStringIncludes(t, 'RE-2026-001 (Bäckerei Brot): 5 Tage überfällig — Zahlungserinnerung, offen 1.190,00 €')
  assertStringIncludes(t, 'Zurückgestellt (1)')
  assertStringIncludes(t, 'bis 15.12.2026 — Ratenzahlung vereinbart')
  assertStringIncludes(t, 'Übersprungen (1)')
  assertStringIncludes(t, 'Zahlung am 22.11.2026 eingegangen')
  assertEquals(JSON.stringify(db.tabellen), vorher)
})

Deno.test('Rechte: ohne Bereich der Akte fehlt die Rechnung; ohne Beratung nicht freigegeben', async () => {
  const t = await fuehreMahnVorschlagWerkzeugAus('mahn_vorschlaege', {}, ctx(daten(), ['beratung']))
  assertStringIncludes(t, 'Heute bekäme 1 Rechnung einen Mahnvorschlag')
  assertEquals(t.includes('RE-2026-002'), false)
  const n = await fuehreMahnVorschlagWerkzeugAus('mahn_vorschlaege', {}, ctx(daten(), ['immobilien']))
  assertStringIncludes(n, 'Nicht freigegeben')
})
