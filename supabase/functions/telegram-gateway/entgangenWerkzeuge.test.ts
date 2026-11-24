// Prüft als_entgangen_markieren und entgangene_klienten mit einer nachgebauten Datenbank (ohne Netz):
// Grund ist Pflicht, private Akten und fremde Bereiche bleiben außen vor, Auswertung und „droht zu entgehen“.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { type EntgangenKontext, fuehreEntgangenWerkzeugAus } from './entgangenWerkzeuge.ts'

const HEUTE = '2026-11-24'

function aufbau() {
  const db = falscheDatenbank({
    kunden: [
      { id: 'k_b1', bereich: 'beratung', status: 'angebot', firma: 'Muster GmbH', ansprechpartner: '', auftrag_chance: { prozent: 40, bestaetigt: true, umsatzNetto: 5000 }, vermittler: { name: 'Partner Eins' }, activities: [], letzte_aktivitaet: '2026-11-20' },
      { id: 'k_b2', bereich: 'beratung', status: 'lead', firma: 'Stille KG', ansprechpartner: '', activities: [], letzte_aktivitaet: '2026-08-01' },
      { id: 'k_b3', bereich: 'beratung', status: 'verloren', firma: 'Weg AG', ansprechpartner: '', verloren: { grund: 'zu_teuer', am: '2026-11-01', von: 'A', phaseVorher: 'angebot', wertNetto: 2000 }, activities: [] },
      { id: 'k_e1', bereich: 'erben', status: 'verloren', firma: 'Erbe Test', ansprechpartner: '', verloren: { grund: 'keine_rueckmeldung', am: '2026-10-01', von: 'B' }, activities: [] },
      { id: 'k_p1', bereich: 'privat', status: 'neu', firma: 'Privat', ansprechpartner: '', verantwortlich_email: 'q@x.de', activities: [] },
    ],
    rechnungen: [],
  })
  const protokoll: string[] = []
  const ctx = (bereiche: string[]): EntgangenKontext => ({
    supabase: db,
    mitarbeiter: { name: 'Test Mitarbeiter', email: 'q@x.de', rolle: 'mitarbeiter', bereiche },
    protokolliere: (t) => protokoll.push(t),
    heute: HEUTE,
    statusName: (_a, s) => ({ angebot: 'Angebot versendet', verloren: 'Verloren / Kein Interesse', lead: 'Lead' } as Record<string, string>)[s] ?? s,
  })
  return { db, ctx, protokoll }
}

// deno-lint-ignore no-explicit-any
const zeile = (db: ReturnType<typeof falscheDatenbank>, id: string): Record<string, any> => db.tabelle('kunden').find((z) => z.id === id)!

Deno.test('als_entgangen_markieren: ohne Grund nichts ändern, mit Grund Status, Feld und Verlauf', async () => {
  const { db, ctx, protokoll } = aufbau()
  const ohne = await fuehreEntgangenWerkzeugAus('als_entgangen_markieren', { kunde_id: 'k_b1' }, ctx(['beratung']))
  assertStringIncludes(ohne, 'Nicht geändert')
  assertEquals(zeile(db, 'k_b1').status, 'angebot')

  const t = await fuehreEntgangenWerkzeugAus('als_entgangen_markieren', { kunde_id: 'k_b1', grund: 'zu_teuer', notiz: 'Preis zu hoch' }, ctx(['beratung']))
  assertStringIncludes(t, 'Gespeichert: Muster GmbH')
  const k = zeile(db, 'k_b1')
  assertEquals(k.status, 'verloren')
  assertEquals(k.verloren, { grund: 'zu_teuer', notiz: 'Preis zu hoch', am: HEUTE, von: 'Test Mitarbeiter', phaseVorher: 'angebot', wertNetto: 5000, vermittler: 'Partner Eins' })
  assertStringIncludes(k.activities[0].text, 'Angebot versendet → Verloren / Kein Interesse')
  assertEquals(protokoll.length, 1)
})

Deno.test('als_entgangen_markieren: privat, fremder Bereich, Sammelakte', async () => {
  const { ctx } = aufbau()
  assertStringIncludes(await fuehreEntgangenWerkzeugAus('als_entgangen_markieren', { kunde_id: 'k_p1', grund: 'zu_teuer' }, ctx(['beratung'])), 'Private Kontakte')
  assertStringIncludes(await fuehreEntgangenWerkzeugAus('als_entgangen_markieren', { kunde_id: 'k_e1', grund: 'zu_teuer' }, ctx(['beratung'])), 'Nicht freigegeben')
  assertStringIncludes(await fuehreEntgangenWerkzeugAus('als_entgangen_markieren', { kunde_id: 'k_intern_holding', grund: 'zu_teuer' }, ctx(['beratung'])), 'Sammelakten')
})

Deno.test('entgangene_klienten: nur freigegebene Bereiche, Zeitraum, drohend', async () => {
  const { ctx } = aufbau()
  const nurBeratung = await fuehreEntgangenWerkzeugAus('entgangene_klienten', {}, ctx(['beratung']))
  assertStringIncludes(nurBeratung, '1 entgangene Akte')
  assertStringIncludes(nurBeratung, 'Weg AG')
  assert(!nurBeratung.includes('Erbe Test'))

  const alle = await fuehreEntgangenWerkzeugAus('entgangene_klienten', { drohend: true }, ctx(['beratung', 'erben']))
  assertStringIncludes(alle, '2 entgangene Akten')
  assertStringIncludes(alle, 'Stille KG')
  assertStringIncludes(alle, 'keine Aktivität')
  assert(!alle.includes('Privat ('))

  const zeitraum = await fuehreEntgangenWerkzeugAus('entgangene_klienten', { von: '2026-10-15' }, ctx(['beratung', 'erben']))
  assertStringIncludes(zeitraum, '1 entgangene Akte')
  assertStringIncludes(await fuehreEntgangenWerkzeugAus('entgangene_klienten', { bereich: 'erben' }, ctx(['beratung'])), 'Nicht freigegeben')
})
