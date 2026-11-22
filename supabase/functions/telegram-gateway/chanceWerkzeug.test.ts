// Prüft die Werkzeuge chance_setzen und chance_vorschlaege_zeigen mit einer nachgebauten Datenbank (ohne
// Netz): Rechte je Bereich, private Akten, Übernehmen des Vorschlags, Monat lesen, Neuberechnen schreibt
// nur chance_vorschlag.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { type ChanceKontext, fuehreChanceWerkzeugAus, leseMonat } from './chanceWerkzeug.ts'

const HEUTE = '2026-11-22'
const vorschlag = { prozent: 40, umsatzNetto: 3850, monat: '2027-01', begruendung: 'Angebot liegt vor.', umsatzQuelle: 'annahme', quelle: 'regel', am: '2026-11-22T08:00:00Z' }

function aufbau() {
  const db = falscheDatenbank({
    kunden: [
      { id: 'k_b1', bereich: 'beratung', status: 'angebot', firma: 'Bau GmbH', auftrag_chance: null, chance_vorschlag: vorschlag, activities: [] },
      { id: 'k_b2', bereich: 'beratung', status: 'erstkontakt', firma: 'Zweite', auftrag_chance: { prozent: 70, bestaetigt: true, begruendung: 'alt' }, chance_vorschlag: { ...vorschlag, prozent: 10, chanceBestaetigt: true } },
      { id: 'k_f1', bereich: 'finanzierungen', status: 'interessent', firma: 'Anleger', auftrag_chance: null, chance_vorschlag: vorschlag },
      { id: 'k_p1', bereich: 'privat', status: 'neu', firma: 'Privat', verantwortlich_email: 'andere@x.de' },
      { id: 'k_e1', bereich: 'erben', status: 'erstkontakt', firma: 'Erbe', auftrag_chance: null, chance_vorschlag: null, activities: [{ date: '2026-11-20', text: 'Anruf' }] },
    ],
    kostenvoranschlaege: [],
    rechnungen: [],
    termine: [],
    leistungen_preisliste: [],
  })
  const protokoll: string[] = []
  const ctx = (bereiche: string[]): ChanceKontext => ({
    supabase: db,
    mitarbeiter: { name: 'Quirin', email: 'q@x.de', rolle: 'mitarbeiter', bereiche },
    protokolliere: (t) => protokoll.push(t),
    heute: HEUTE,
  })
  return { db, ctx, protokoll }
}

// deno-lint-ignore no-explicit-any
const zeile = (db: ReturnType<typeof falscheDatenbank>, id: string): Record<string, any> => db.tabelle('kunden').find((z) => z.id === id)!

Deno.test('Monat lesen', () => {
  assertEquals(leseMonat('2027-01', HEUTE), '2027-01')
  assertEquals(leseMonat('3/2027', HEUTE), '2027-03')
  assertEquals(leseMonat('Januar 2027', HEUTE), '2027-01')
  assertEquals(leseMonat('Februar', HEUTE), '2027-02')
  assertEquals(leseMonat('Dezember', HEUTE), '2026-12')
  assertEquals(leseMonat('irgendwann', HEUTE), undefined)
})

Deno.test('chance_setzen: Vorschlag übernehmen, bestätigt mit Umsatz und Monat', async () => {
  const { db, ctx, protokoll } = aufbau()
  const t = await fuehreChanceWerkzeugAus('chance_setzen', { kunde_id: 'k_b1', vorschlag_uebernehmen: true }, ctx(['beratung']))
  assertStringIncludes(t, 'Gespeichert für Bau GmbH')
  const c = zeile(db, 'k_b1').auftrag_chance
  assertEquals([c.prozent, c.bestaetigt, c.umsatzNetto, c.monat, c.von], [40, true, 3850, '2027-01', 'Quirin'])
  assertEquals(zeile(db, 'k_b1').chance_vorschlag.prozent, 40)
  assertEquals(protokoll.length, 1)
})

Deno.test('chance_setzen: genannte Werte gehen vor, bestätigte Chance bleibt beim Übernehmen', async () => {
  const { db, ctx } = aufbau()
  await fuehreChanceWerkzeugAus('chance_setzen', { kunde_id: 'k_b2', vorschlag_uebernehmen: true }, ctx(['beratung']))
  const c = zeile(db, 'k_b2').auftrag_chance
  assertEquals([c.prozent, c.umsatzNetto], [70, 3850])
  await fuehreChanceWerkzeugAus('chance_setzen', { kunde_id: 'k_b2', chance: 55, umsatz: '5.000', monat: 'März 2027' }, ctx(['beratung']))
  const d = zeile(db, 'k_b2').auftrag_chance
  assertEquals([d.prozent, d.umsatzNetto, d.monat], [55, 5000, '2027-03'])
  await fuehreChanceWerkzeugAus('chance_setzen', { kunde_id: 'k_b2', umsatz: 0 }, ctx(['beratung']))
  const e = zeile(db, 'k_b2').auftrag_chance
  assertEquals([e.prozent, e.umsatzNetto, e.monat], [55, undefined, undefined])
})

Deno.test('chance_setzen: Rechte, private Akte, fehlende Werte', async () => {
  const { db, ctx } = aufbau()
  assertStringIncludes(await fuehreChanceWerkzeugAus('chance_setzen', { kunde_id: 'k_f1', chance: 50 }, ctx(['beratung'])), 'Nicht freigegeben')
  assertEquals(zeile(db, 'k_f1').auftrag_chance, null)
  assertStringIncludes(await fuehreChanceWerkzeugAus('chance_setzen', { kunde_id: 'k_p1', chance: 50 }, ctx(['beratung'])), 'Es gibt keine Akte')
  assertStringIncludes(await fuehreChanceWerkzeugAus('chance_setzen', { kunde_id: 'k_e1' }, ctx(['erben'])), 'Fehler: Die Akte hat noch keine Chance')
  assertStringIncludes(await fuehreChanceWerkzeugAus('chance_setzen', { kunde_id: 'k_e1', vorschlag_uebernehmen: true }, ctx(['erben'])), 'kein Vorschlag')
  assertStringIncludes(await fuehreChanceWerkzeugAus('chance_setzen', { kunde_id: 'k_e1', chance: 150 }, ctx(['erben'])), 'Fehler')
  assertStringIncludes(await fuehreChanceWerkzeugAus('chance_setzen', { kunde_id: 'k_eingang_ungeklaert', chance: 10 }, ctx(['beratung'])), 'Sammelakten')
  const privat = { ...ctx(['beratung']), mitarbeiter: { name: 'H', email: 'h@x.de', nurPrivat: true } }
  assertStringIncludes(await fuehreChanceWerkzeugAus('chance_setzen', { kunde_id: 'k_b1', chance: 10 }, privat), 'privaten Assistenten')
})

Deno.test('chance_vorschlaege_zeigen: nur freigegebene, offene; neu berechnen schreibt nur Vorschläge', async () => {
  const { db, ctx } = aufbau()
  const t = await fuehreChanceWerkzeugAus('chance_vorschlaege_zeigen', {}, ctx(['beratung']))
  assertStringIncludes(t, 'Bau GmbH')
  assertStringIncludes(t, 'Zweite') // bestätigt, aber noch ohne Umsatz
  assert(!t.includes('Anleger'))
  const n = await fuehreChanceWerkzeugAus('chance_vorschlaege_zeigen', { bereich: 'erben', neu_berechnen: true }, ctx(['erben']))
  assertStringIncludes(n, '1 Vorschlag nach festen Regeln neu berechnet')
  assertEquals(zeile(db, 'k_e1').chance_vorschlag.prozent, 10)
  assertEquals(zeile(db, 'k_e1').auftrag_chance, null)
  assertEquals(zeile(db, 'k_b1').chance_vorschlag.prozent, 40) // andere Bereiche unberührt
  assertStringIncludes(await fuehreChanceWerkzeugAus('chance_vorschlaege_zeigen', { bereich: 'finanzierungen' }, ctx(['beratung'])), 'Nicht freigegeben')
})
