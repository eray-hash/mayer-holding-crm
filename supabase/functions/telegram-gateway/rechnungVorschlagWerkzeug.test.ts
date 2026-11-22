// Werkzeug rechnung_vorschlaege mit der Testdatenbank: Rechte, Liste, Wochenhinweis an/aus.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehreRechnungVorschlagWerkzeugAus, istRechnungVorschlagWerkzeug } from './rechnungVorschlagWerkzeug.ts'

function daten() {
  return falscheDatenbank({
    rechnung_vorschlaege: [
      { id: 'kv:kv1', art: 'kv', kunde_id: 'k1', kunde_bereich: 'beratung', titel: 'Strategie', betrag_netto: 3000, status: 'offen', grund: 'Kostenvoranschlag angenommen.', erstellt_am: '2026-11-20T10:00:00Z' },
      { id: 'provision:o1', art: 'provision', kunde_id: null, kunde_bereich: null, titel: 'Provision MFH Lorch', betrag_netto: 30000, status: 'offen', grund: 'Beurkundet.', erstellt_am: '2026-11-21T10:00:00Z' },
      { id: 'akte:k2', art: 'akte', kunde_id: 'k2', kunde_bereich: 'erben', titel: 'Leistung', betrag_netto: null, status: 'offen', grund: 'Abgeschlossen.', erstellt_am: '2026-11-21T11:00:00Z' },
      { id: 'kv:alt', art: 'kv', kunde_id: 'k1', kunde_bereich: 'beratung', titel: 'Alt', betrag_netto: 100, status: 'erstellt', grund: '', erledigt_am: '2026-11-19T10:00:00Z', erledigt_von: 'Hasan Süslü', erstellt_am: '2026-11-18T10:00:00Z' },
    ],
    kunden: [
      { id: 'k1', firma: 'Bäckerei Brot', ansprechpartner: '' },
      { id: 'k2', firma: '', ansprechpartner: 'Familie Erbe' },
    ],
    rechnung_vorschlag_hinweis: [],
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.example/' }],
  })
}

function ctx(db: ReturnType<typeof daten>, m: Record<string, unknown>) {
  const log: string[] = []
  return { log, c: { supabase: db, mitarbeiter: { name: 'Test', email: 'test@mayer.de', ...m }, protokolliere: (t: string) => log.push(t), heute: '2026-11-22' } }
}

Deno.test('Werkzeugname', () => {
  assert(istRechnungVorschlagWerkzeug('rechnung_vorschlaege'))
  assert(!istRechnungVorschlagWerkzeug('rechnungen_offen'))
})

Deno.test('Geschäftsführung sieht alle offenen mit Link', async () => {
  const { c } = ctx(daten(), { rolle: 'geschaeftsfuehrung' })
  const r = await fuehreRechnungVorschlagWerkzeugAus('rechnung_vorschlaege', {}, c)
  assertStringIncludes(r, '3 Rechnungen sind fällig zu stellen')
  assertStringIncludes(r, '[kv:kv1] Kostenvoranschlag · Bäckerei Brot · Strategie · 3.000,00 € netto')
  assertStringIncludes(r, 'Betrag offen')
  assertStringIncludes(r, 'https://crm.example/#/beratung/rechnungen?vorschlag=provision%3Ao1')
  assert(!r.includes('[kv:alt]'))
})

Deno.test('nur Beratung: ohne Provision und ohne Erben-Akte; ohne Beratung: nicht freigegeben; privat: Fehler', async () => {
  const db = daten()
  const nurBeratung = await fuehreRechnungVorschlagWerkzeugAus('rechnung_vorschlaege', {}, ctx(db, { rolle: 'mitarbeiter', bereiche: ['beratung'] }).c)
  assertStringIncludes(nurBeratung, '1 Rechnung ist fällig zu stellen')
  assert(!nurBeratung.includes('Provision MFH'))
  assert(!nurBeratung.includes('Familie Erbe'))
  const ohne = await fuehreRechnungVorschlagWerkzeugAus('rechnung_vorschlaege', {}, ctx(db, { rolle: 'mitarbeiter', bereiche: ['immobilien'] }).c)
  assertStringIncludes(ohne, 'Nicht freigegeben')
  const privat = await fuehreRechnungVorschlagWerkzeugAus('rechnung_vorschlaege', {}, ctx(db, { rolle: 'geschaeftsfuehrung', nurPrivat: true }).c)
  assert(privat.startsWith('Fehler: '))
})

Deno.test('erledigte zeigen', async () => {
  const r = await fuehreRechnungVorschlagWerkzeugAus('rechnung_vorschlaege', { status: 'erledigt' }, ctx(daten(), { rolle: 'geschaeftsfuehrung' }).c)
  assertStringIncludes(r, '[kv:alt]')
  assertStringIncludes(r, 'Rechnung angelegt von Hasan Süslü am 2026-11-19')
  assert(!r.includes('[kv:kv1]'))
})

Deno.test('Wochenhinweis an und aus, protokolliert', async () => {
  const db = daten()
  const { c, log } = ctx(db, { rolle: 'geschaeftsfuehrung' })
  const aus = await fuehreRechnungVorschlagWerkzeugAus('rechnung_vorschlaege', { wochenhinweis: false }, c)
  assertStringIncludes(aus, 'Wochenhinweis Rechnungen ist aus.')
  assertEquals(db.tabelle('rechnung_vorschlag_hinweis').map((z) => [z.email, z.aktiv]), [['test@mayer.de', false]])
  await fuehreRechnungVorschlagWerkzeugAus('rechnung_vorschlaege', { wochenhinweis: true }, c)
  assertEquals(db.tabelle('rechnung_vorschlag_hinweis').map((z) => [z.email, z.aktiv]), [['test@mayer.de', true]])
  assertEquals(log.length, 2)
})
