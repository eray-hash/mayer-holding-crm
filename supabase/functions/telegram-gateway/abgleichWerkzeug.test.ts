// Prüft kontoauszug_abgleichen mit nachgebauter Datenbank und Ablage (ohne Netz, ohne KI): Vorschläge
// ohne Buchung, Buchen nur mit bestaetigt und Kennungen, kein doppeltes Buchen, Verbindlichkeiten,
// Rechte (Bereich Unternehmensberatung, Akten anderer Bereiche), CSV direkt, PDF über leseAuszug.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { fuehreAbgleichWerkzeugAus, type AuszugGelesen } from './abgleichWerkzeug.ts'

const gf = { name: 'Andreas Mayer', email: 'gf@x.de', rolle: 'geschaeftsfuehrung', bereiche: [] as string[] }
const quirin = { name: 'Quirin Lang', email: 'q@x.de', rolle: 'mitarbeiter', bereiche: ['immobilien'] }
const berater = { name: 'Bernd Berater', email: 'b@x.de', rolle: 'mitarbeiter', bereiche: ['beratung'] }

function rechnung(z: Partial<Zeile> = {}): Zeile {
  return {
    id: 'r_1', nummer: 'RE-2026-010', kunde_id: 'k_1', datum: '2026-11-01', betrag_netto: 1000, betrag_brutto: 1190, status: 'Versendet',
    zahlungsziel: '2026-11-15', mahnstufe: null, zahlungen: null, mahnungen: null, versendet_am: '2026-11-01', bezahlt_am: null, ...z,
  }
}

const tabellen = () => ({
  rechnungen: [
    rechnung(),
    rechnung({ id: 'r_2', nummer: 'RE-2026-011', betrag_brutto: 1000, mahnstufe: 'erinnerung' }),
    rechnung({ id: 'r_erben', nummer: 'RE-2026-020', kunde_id: 'k_erben', betrag_brutto: 300 }),
  ],
  kunden: [
    { id: 'k_1', bereich: 'beratung', firma: 'Bäckerei Brot GmbH', ansprechpartner: 'Herr Brot', verantwortlich_email: null, activities: [{ id: 'act_alt', date: '2026-11-01', text: 'alt', user: 'x' }] },
    { id: 'k_erben', bereich: 'erben', firma: 'Erbengemeinschaft Huber', ansprechpartner: null, verantwortlich_email: null, activities: [] },
  ],
  verbindlichkeiten: [
    { id: 'v_1', lieferant: 'Telekom Deutschland GmbH', lieferant_email: 'rechnung@telekom.de', rechnungsnummer: '4711-0815', datum: '2026-11-01', betrag_brutto: 59.9, status: 'offen', bezahlt_am: null, notiz: 'Mobilfunk' },
  ],
})

const BUCHUNGEN = [
  { id: 'pdf_1', datum: '2026-11-10', betrag: 1190, verwendungszweck: 'RE-2026-010 Danke', gegenName: 'Baeckerei Brot GmbH' },
  { id: 'pdf_2', datum: '2026-11-11', betrag: 980, verwendungszweck: 'RE-2026-011 abzgl. 2% Skonto', gegenName: 'Herr Brot' },
  { id: 'pdf_3', datum: '2026-11-12', betrag: -59.9, verwendungszweck: 'Rechnung 4711-0815', gegenName: 'Telekom' },
  { id: 'pdf_4', datum: '2026-11-13', betrag: 300, verwendungszweck: 'RE-2026-020', gegenName: 'Huber' },
  { id: 'pdf_5', datum: '2026-11-14', betrag: -12.5, verwendungszweck: 'Kontofuehrung', gegenName: null },
]

function umgebung(mitarbeiter: Zeile = gf) {
  const db = falscheDatenbank(tabellen())
  let gelesen = 0
  const protokoll: string[] = []
  const ctx = {
    supabase: db,
    // deno-lint-ignore no-explicit-any
    mitarbeiter: mitarbeiter as any,
    protokolliere: (s: string) => protokoll.push(s),
    heute: '2026-11-22',
    leseAuszug: (): Promise<AuszugGelesen> => {
      gelesen++
      return Promise.resolve({ ok: true, buchungen: structuredClone(BUCHUNGEN), datei: { name: 'auszug.pdf', bank: 'Sparkasse Ulm', von: '2026-11-01', bis: '2026-11-30', anzahl: 5 } })
    },
  }
  return { db, ctx, protokoll, gelesen: () => gelesen }
}

const kennungen = (text: string, ohne?: string) => text.split('\n').filter((z) => !ohne || !z.includes(ohne)).flatMap((z) => [...z.matchAll(/\[(v[0-9a-z]+)\]/g)].map((m) => m[1]))

Deno.test('Erster Aufruf: Vorschläge, nichts gebucht; zweiter Aufruf liest den Auszug nicht neu', async () => {
  const { db, ctx, gelesen } = umgebung()
  const text = await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'telegram/auszug.pdf' }, ctx)
  assertStringIncludes(text, 'SICHER:')
  assertStringIncludes(text, 'RE-2026-010')
  assertStringIncludes(text, 'Skonto')
  assertStringIncludes(text, 'Nichts gebucht')
  assertEquals(db.tabellen.rechnungen[0].status, 'Versendet')
  await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'telegram/auszug.pdf' }, ctx)
  assertEquals(gelesen(), 1)
})

Deno.test('Buchen nur mit bestaetigt und Kennungen; kein doppeltes Buchen', async () => {
  const { db, ctx, protokoll } = umgebung()
  const liste = await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'telegram/auszug.pdf' }, ctx)
  const ids = kennungen(liste)
  assertEquals(ids.length, 4) // RE-010, RE-011 (Skonto), Telekom, RE-020 (GF sieht Erben)
  const ohne = await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'telegram/auszug.pdf', vorschlag_ids: ids }, ctx)
  assertStringIncludes(ohne, 'Nichts gebucht')
  const ohneErben = kennungen(liste, 'RE-2026-020')
  assertEquals(ohneErben.length, 3)
  const gebucht = await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'telegram/auszug.pdf', bestaetigt: true, vorschlag_ids: ohneErben }, ctx)
  assertStringIncludes(gebucht, 'RE-2026-010: 1.190,00 € gebucht, Rechnung bezahlt')
  assertStringIncludes(gebucht, 'RE-2026-011: 980,00 € gebucht, Rechnung bezahlt')
  assertStringIncludes(gebucht, 'Telekom')
  const r1 = db.tabellen.rechnungen.find((r) => r.id === 'r_1')!
  assertEquals(r1.status, 'Bezahlt')
  assertEquals(r1.bezahlt_am, '2026-11-10')
  // deno-lint-ignore no-explicit-any
  assertEquals((r1.zahlungen as any[])[0].quelle, 'kontoauszug:2026-11-10:+119000:1')
  const r2 = db.tabellen.rechnungen.find((r) => r.id === 'r_2')!
  assertEquals(r2.status, 'Bezahlt')
  assertEquals(r2.mahnstufe, null)
  // deno-lint-ignore no-explicit-any
  assertStringIncludes((r2.zahlungen as any[])[0].notiz, '2 % Skonto')
  const v1 = db.tabellen.verbindlichkeiten[0]
  assertEquals(v1.status, 'bezahlt')
  assertEquals(v1.bezahlt_am, '2026-11-12')
  assertStringIncludes(String(v1.notiz), 'Mobilfunk\nBezahlt laut Kontoauszug am 12.11.2026')
  // deno-lint-ignore no-explicit-any
  const akt = db.tabellen.kunden[0].activities as any[]
  assertEquals(akt.length, 3)
  assertStringIncludes(akt[0].text, 'aus dem Kontoauszug')
  assert(protokoll.length >= 3)
  // Nochmals bestätigen: gebuchte Vorschläge gibt es nicht mehr, nichts doppelt
  const nochmal = await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'telegram/auszug.pdf', bestaetigt: true, vorschlag_ids: kennungen(liste, 'RE-2026-020').filter((id) => liste.split('\n').some((z) => z.includes(id) && z.includes('RE-2026-010'))) }, ctx)
  assertStringIncludes(nochmal, 'gibt es nicht mehr')
  // deno-lint-ignore no-explicit-any
  assertEquals((db.tabellen.rechnungen.find((r) => r.id === 'r_1')!.zahlungen as any[]).length, 1)
  const liste2 = await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'telegram/auszug.pdf' }, ctx)
  assertStringIncludes(liste2, 'Schon gebucht: 3')
})

Deno.test('Rechte: ohne Beratung nicht freigegeben; Rechnungen fremder Bereiche tauchen nicht auf', async () => {
  const q = umgebung(quirin)
  assertStringIncludes(await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'telegram/auszug.pdf' }, q.ctx), 'Nicht freigegeben')
  const b = umgebung(berater)
  const text = await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'telegram/auszug.pdf' }, b.ctx)
  assert(!text.includes('RE-2026-020'))
  assert(!text.includes('Huber') || text.includes('Ohne passenden'))
})

Deno.test('Pfad muss aus dem Datei-Eingang stammen', async () => {
  const { ctx } = umgebung()
  assertStringIncludes(await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'kunde/../x.pdf' }, ctx), 'Fehler')
  assertStringIncludes(await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'telegram/../geheim.pdf' }, ctx), 'Fehler')
})

Deno.test('CSV wird direkt gelesen (ohne KI)', async () => {
  const { db, ctx, gelesen } = umgebung()
  const csv = 'Buchungstag;Name Zahlungsbeteiligter;Verwendungszweck;Betrag\n10.11.2026;Bäckerei Brot;RE-2026-010;1.190,00\n'
  await db.storage.from('email-anhaenge').upload('telegram/umsaetze.csv', new TextEncoder().encode(csv))
  const text = await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: 'telegram/umsaetze.csv' }, ctx)
  assertStringIncludes(text, 'RE-2026-010')
  assertStringIncludes(text, 'SICHER:')
  assertEquals(gelesen(), 0)
})
