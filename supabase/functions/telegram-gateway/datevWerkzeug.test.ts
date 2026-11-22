// Prüft das Werkzeug export_steuerberater_status mit einer nachgebauten Datenbank (ohne Netz).
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { DATEV_WERKZEUGE, fuehreDatevWerkzeugAus, istDatevWerkzeug } from './datevWerkzeug.ts'

const gf = { name: 'Andreas', email: 'gf@x.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }
const erben = { name: 'Erbin', email: 'e@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['erben'] }
const beraterin = { name: 'Beraterin', email: 'b@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }

const tabellen = (): Record<string, Zeile[]> => ({
  rechnungen: [
    { id: 'r1', nummer: 'RE-2026-001', datum: '2026-10-05', kunde_id: 'k_1', betrag_netto: 1000, betrag_brutto: 1190, ust_satz: 19, status: 'Versendet', zahlungen: [], dokument: { kundeId: 'k_1', dokumentId: 'd1', name: 'x.pdf' } },
    { id: 'r2', nummer: 'RE-2026-002', datum: '2026-10-20', kunde_id: 'k_1', betrag_netto: 500, betrag_brutto: 595, ust_satz: null, status: 'Bezahlt', zahlungen: [{ betrag: 595 }], dokument: null },
    { id: 'r3', nummer: 'RE-2026-003', datum: '2026-10-21', kunde_id: 'k_1', betrag_netto: 100, betrag_brutto: 119, status: 'Entwurf', dokument: null },
    { id: 'r4', nummer: 'RE-2026-004', datum: '2026-10-22', kunde_id: 'k_erben', betrag_netto: 200, betrag_brutto: 238, status: 'Versendet', dokument: null },
    { id: 'r5', nummer: 'RE-2026-005', datum: '2026-11-02', kunde_id: 'k_1', betrag_netto: 100, betrag_brutto: 119, status: 'Versendet', dokument: null },
  ],
  verbindlichkeiten: [
    { id: 'v1', lieferant: 'IONOS', rechnungsnummer: 'R1', datum: '2026-10-10', betrag_netto: 10, betrag_brutto: 11.9, kategorie: 'Software & Hosting', status: 'bezahlt', quelle: 'manuell', geprueft: null, beleg: { name: 'a.pdf', url: 'verbindlichkeiten/a.pdf' } },
    { id: 'v2', lieferant: 'Europcar', rechnungsnummer: null, datum: '2026-10-11', betrag_netto: null, betrag_brutto: null, kategorie: null, status: 'offen', quelle: 'email-automatisch', quell_email_id: '<m1>', geprueft: false, beleg: null },
    { id: 'v3', lieferant: 'PayPal', rechnungsnummer: 'P', datum: '2026-10-12', betrag_netto: null, betrag_brutto: 20, kategorie: 'Sonstiges', status: 'offen', quelle: 'email-automatisch', quell_email_id: '<m2>', geprueft: true, beleg: null },
  ],
  eingegangene_emails: [
    { id: 'e1', message_id: '<m1>', anhaenge: [{ filename: 'RA.pdf', url: 'https://x/storage/v1/object/public/a/RA.pdf' }] },
    { id: 'e2', message_id: '<m2>', anhaenge: [] },
  ],
  kunden: [
    { id: 'k_1', bereich: 'beratung', firma: 'Bäckerei Brot GmbH', ansprechpartner: null, verantwortlich_email: null },
    { id: 'k_erben', bereich: 'erben', firma: 'Erbengemeinschaft Huber', ansprechpartner: null, verantwortlich_email: null },
  ],
  steuerberater_einstellung: [{ id: 1, berater_nr: '29098', mandanten_nr: null, kontenrahmen: 'SKR03', wj_beginn_monat: 1, erloeskonten: {}, aufwandskonten: {}, beleg_info: true, konten_bestaetigt: false }],
})

function ctx(mitarbeiter: Zeile, t = tabellen()) {
  const db = falscheDatenbank(t)
  const protokoll: string[] = []
  // deno-lint-ignore no-explicit-any
  return { db, protokoll, k: { supabase: db, mitarbeiter: mitarbeiter as any, protokolliere: (s: string) => protokoll.push(s), heute: '2026-11-22' } }
}

Deno.test('Werkzeugliste', () => {
  assertEquals(DATEV_WERKZEUGE.map((w) => w.name), ['export_steuerberater_status'])
  assert(istDatevWerkzeug('export_steuerberater_status'))
  assert(!istDatevWerkzeug('rechnungen_offen'))
})

Deno.test('Status für den Vormonat (Geschäftsführung)', async () => {
  const { k, protokoll } = ctx(gf)
  const t = await fuehreDatevWerkzeugAus('export_steuerberater_status', {}, k)
  assertStringIncludes(t, 'Oktober 2026')
  assertStringIncludes(t, 'Ausgangsrechnungen: 3') // r1, r2, r4 (Entwurf r3 und November r5 nicht)
  assertStringIncludes(t, '1 Entwurf')
  assertStringIncludes(t, 'Eingangsrechnungen: 3')
  assertStringIncludes(t, 'Rechnung RE-2026-002 (Bäckerei Brot GmbH) hat kein gespeichertes PDF')
  assertStringIncludes(t, 'Rechnung id=r4')
  assertStringIncludes(t, 'Europcar vom 11.10.2026: automatisch erkannt und noch nicht geprüft')
  assertStringIncludes(t, 'Europcar vom 11.10.2026: kein Betrag eingetragen')
  assertStringIncludes(t, 'Verbindlichkeit id=v2')
  // PayPal: keine Anhänge in der Mail → Beleg fehlt; Europcar hat Mail-Anhang → kein „Beleg fehlt“
  assertStringIncludes(t, 'PayPal Nr. P vom 12.10.2026: Beleg fehlt.')
  assert(!t.includes('Europcar vom 11.10.2026: Beleg fehlt'))
  // Hinweise nur auf Wunsch
  assert(!t.includes('Zur Kenntnis'))
  assertStringIncludes(t, 'Export für Steuerberater')
  assertEquals(protokoll, [])
  const mit = await fuehreDatevWerkzeugAus('export_steuerberater_status', { zeitraum: 'Oktober 2026', mit_hinweisen: true }, k)
  assertStringIncludes(mit, 'Zur Kenntnis')
  assertStringIncludes(mit, 'Mandantennummer')
  assertStringIncludes(mit, 'Anhänge der Original-Mail werden beigelegt')
})

Deno.test('Rechte: Akten aus nicht freigegebenen Bereichen zählen nicht, ohne Beratung gar nichts', async () => {
  const b = await fuehreDatevWerkzeugAus('export_steuerberater_status', { zeitraum: '2026-10' }, ctx(beraterin).k)
  assertStringIncludes(b, 'Ausgangsrechnungen: 2')
  assert(!b.includes('RE-2026-004'))
  assert(!b.includes('Huber'))
  const e = await fuehreDatevWerkzeugAus('export_steuerberater_status', { zeitraum: '2026-10' }, ctx(erben).k)
  assertStringIncludes(e, 'Nicht freigegeben')
})

Deno.test('Zeitraum: Quartal, unverständlich, ohne Einstellungstabelle', async () => {
  const t = tabellen()
  delete t.steuerberater_einstellung
  const q = await fuehreDatevWerkzeugAus('export_steuerberater_status', { zeitraum: 'Q4 2026', mit_hinweisen: true }, ctx(gf, t).k)
  assertStringIncludes(q, '4. Quartal 2026')
  assertStringIncludes(q, 'Ausgangsrechnungen: 4') // inkl. November
  assertStringIncludes(q, 'Berater- und/oder Mandantennummer')
  const f = await fuehreDatevWerkzeugAus('export_steuerberater_status', { zeitraum: 'irgendwann' }, ctx(gf).k)
  assert(f.startsWith('Fehler: '))
})
