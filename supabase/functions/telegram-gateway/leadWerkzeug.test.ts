// Prüft lead_einstufen mit der Testdatenbank (ohne Netz): Statuswechsel je Antwort, Wiedervorlage bei „später“
// (von Hand, wenn die Regel fehlt; Datum angepasst, wenn der Auslöser sie schon angelegt hat), Rechte und Grenzen.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { ergebnisAus, fuehreLeadWerkzeugAus, REGEL_NEUANFRAGE, REGEL_ZURUECKGESTELLT, TITEL_ZURUECKGESTELLT } from './leadWerkzeug.ts'

const HEUTE = '2026-11-23'
const HASAN = { name: 'Hasan Süslü', email: 'h@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }
const QUIRIN = { name: 'Quirin Lutzenberger', email: 'q@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }

function welt() {
  return falscheDatenbank({
    kunden: [
      { id: 'k_lead', bereich: 'beratung', firma: 'Bäckerei Maier', ansprechpartner: 'Max Maier', status: 'lead', verantwortlich: 'Hasan Süslü', verantwortlich_email: null, activities: [{ id: 'a0', date: '2026-11-01', text: 'angelegt' }] },
      { id: 'k_termin', bereich: 'beratung', firma: 'Weiter AG', ansprechpartner: null, status: 'termin', verantwortlich: 'Hasan Süslü', verantwortlich_email: null, activities: [] },
      { id: 'k_erb', bereich: 'erben', firma: 'Familie Huber', ansprechpartner: null, status: 'erstkontakt', verantwortlich: 'Hasan Süslü', verantwortlich_email: null, activities: [] },
      { id: 'k_priv', bereich: 'privat', firma: 'Privat', ansprechpartner: null, status: 'neu', verantwortlich: 'X', verantwortlich_email: 'x@x.de', activities: [] },
    ],
    wiedervorlagen: [
      { id: 'wv_lead', kunde_id: 'k_lead', bereich: 'beratung', regel: REGEL_NEUANFRAGE, titel: 'Neuanfrage prüfen', faellig: '2026-11-25', quelle: 'regel', erledigt_am: null },
    ],
  })
}

function kontext(db: ReturnType<typeof welt>, m = HASAN) {
  const protokoll: string[] = []
  return { k: { supabase: db, mitarbeiter: m, protokolliere: (t: string) => protokoll.push(t), heute: HEUTE }, protokoll }
}

Deno.test('ergebnisAus versteht eigene Worte', () => {
  assertEquals(ergebnisAus('qualifiziert'), 'qualifiziert')
  assertEquals(ergebnisAus('passt nicht'), 'passt_nicht')
  assertEquals(ergebnisAus('Später'), 'spaeter')
  assertEquals(ergebnisAus('vielleicht'), undefined)
})

Deno.test('qualifiziert → erstkontakt, Verlaufseintrag vorne, Neuanfrage-Wiedervorlage geschlossen', async () => {
  const db = welt()
  const { k, protokoll } = kontext(db)
  const r = await fuehreLeadWerkzeugAus('lead_einstufen', { kunde_id: 'k_lead', ergebnis: 'qualifiziert' }, k)
  assertStringIncludes(r, 'Erstkontakt hergestellt')
  const akte = db.tabelle('kunden').find((z) => z.id === 'k_lead')!
  assertEquals(akte.status, 'erstkontakt')
  assertEquals(akte.letzte_aktivitaet, HEUTE)
  const verlauf = akte.activities as { text: string; user: string }[]
  assertEquals(verlauf.length, 2)
  assertStringIncludes(verlauf[0].text, 'qualifiziert')
  assertEquals(verlauf[0].user, 'Hasan Süslü')
  assert(db.tabelle('wiedervorlagen').find((w) => w.id === 'wv_lead')!.erledigt_am, 'Neuanfrage prüfen bleibt offen')
  assertEquals(protokoll.length, 1)
})

Deno.test('passt nicht → nicht_qualifiziert mit Grund', async () => {
  const db = welt()
  const { k } = kontext(db)
  const r = await fuehreLeadWerkzeugAus('lead_einstufen', { kunde_id: 'k_lead', ergebnis: 'passt_nicht', grund: 'nur Privatkunde' }, k)
  assertStringIncludes(r, 'Nicht qualifiziert')
  const akte = db.tabelle('kunden').find((z) => z.id === 'k_lead')!
  assertEquals(akte.status, 'nicht_qualifiziert')
  assertStringIncludes((akte.activities as { text: string }[])[0].text, 'nur Privatkunde')
})

Deno.test('später ohne Regel → Status wiedervorlage und Wiedervorlage von Hand in 14 Tagen', async () => {
  const db = welt()
  const { k } = kontext(db)
  const r = await fuehreLeadWerkzeugAus('lead_einstufen', { kunde_id: 'k_lead', ergebnis: 'spaeter' }, k)
  assertStringIncludes(r, '07.12.2026')
  assertEquals(db.tabelle('kunden').find((z) => z.id === 'k_lead')!.status, 'wiedervorlage')
  const neu = db.tabelle('wiedervorlagen').filter((w) => w.titel === TITEL_ZURUECKGESTELLT)
  assertEquals(neu.length, 1)
  assertEquals(neu[0].faellig, '2026-12-07')
  assertEquals(neu[0].quelle, 'hand')
  assertEquals(neu[0].verantwortlich, 'Hasan Süslü')
})

Deno.test('später mit vorhandener Regel-Wiedervorlage → nur Datum nach „tage“ angepasst, nichts doppelt', async () => {
  const db = welt()
  db.tabelle('wiedervorlagen').push({ id: 'wv_zurueck', kunde_id: 'k_lead', bereich: 'beratung', regel: REGEL_ZURUECKGESTELLT, titel: TITEL_ZURUECKGESTELLT, faellig: '2026-12-07', quelle: 'regel', erledigt_am: null })
  const { k } = kontext(db)
  await fuehreLeadWerkzeugAus('lead_einstufen', { kunde_id: 'k_lead', ergebnis: 'spaeter', tage: 30 }, k)
  const zurueck = db.tabelle('wiedervorlagen').filter((w) => w.titel === TITEL_ZURUECKGESTELLT)
  assertEquals(zurueck.length, 1)
  assertEquals(zurueck[0].faellig, '2026-12-23')
})

Deno.test('Grenzen: falscher Stand, anderer Bereich, fremder Bereich, private Akte', async () => {
  const db = welt()
  assertStringIncludes(await fuehreLeadWerkzeugAus('lead_einstufen', { kunde_id: 'k_termin', ergebnis: 'qualifiziert' }, kontext(db).k), 'Nicht geändert')
  assertStringIncludes(await fuehreLeadWerkzeugAus('lead_einstufen', { kunde_id: 'k_erb', ergebnis: 'qualifiziert' }, kontext(db, { ...HASAN, bereiche: ['beratung', 'erben'] }).k), 'nur für Neuanfragen der Unternehmensberatung')
  assertStringIncludes(await fuehreLeadWerkzeugAus('lead_einstufen', { kunde_id: 'k_lead', ergebnis: 'qualifiziert' }, kontext(db, QUIRIN).k), 'Nicht freigegeben')
  assertStringIncludes(await fuehreLeadWerkzeugAus('lead_einstufen', { kunde_id: 'k_priv', ergebnis: 'qualifiziert' }, kontext(db).k), 'keine Akte')
  assertStringIncludes(await fuehreLeadWerkzeugAus('lead_einstufen', { kunde_id: 'k_lead', ergebnis: 'egal' }, kontext(db).k), 'Fehler')
  assertEquals(db.tabelle('kunden').find((z) => z.id === 'k_lead')!.status, 'lead')
})

Deno.test('eine zurückgestellte Anfrage kann erneut eingestuft werden', async () => {
  const db = welt()
  db.tabelle('kunden').find((z) => z.id === 'k_lead')!.status = 'wiedervorlage'
  const r = await fuehreLeadWerkzeugAus('lead_einstufen', { kunde_id: 'k_lead', ergebnis: 'qualifiziert' }, kontext(db).k)
  assertStringIncludes(r, 'Erledigt')
  assertEquals(db.tabelle('kunden').find((z) => z.id === 'k_lead')!.status, 'erstkontakt')
})
