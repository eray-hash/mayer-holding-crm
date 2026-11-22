// Tests für die Aktion kv_zuordnen: nur Geschäftsführung, Vorschau ändert nichts, Zuordnen setzt kunde_id/bereich/
// privat_besitzer wie der Assistent, schon zugeordnete und unpassende (privat ↔ öffentlich) bleiben unverändert.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { kvZuordnungAktion } from './kvZuordnung.ts'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'

function db() {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', name: 'Chefin', email: 'chefin@firma.test', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], aktiv: true },
      { id: 'm2', name: 'Kollege', email: 'kollege@firma.test', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'], aktiv: true },
    ],
    kunden: [
      { id: 'k_zabel', bereich: 'beratung', firma: 'Versicherung Daniel Zabelski', ansprechpartner: 'Daniel Zabelski', email: null, verantwortlich_email: null, dokumente: [] },
      { id: 'k_brenner', bereich: 'immobilienkunden', firma: 'Rolf Brenner', ansprechpartner: 'Rolf Brenner', email: null, verantwortlich_email: null, dokumente: [] },
      { id: 'k_priv', bereich: 'privat', firma: 'Rolf Brenner privat', ansprechpartner: 'Rolf Brenner', email: null, verantwortlich_email: 'chefin@firma.test', dokumente: [] },
      {
        id: 'k_eingang_ungeklaert',
        bereich: 'beratung',
        firma: 'Ungeklärte Eingänge',
        ansprechpartner: 'Ungeklärte Eingänge',
        dokumente: [{ id: 'dok1', name: 'Zettel.jpg', url: 'k_eingang_ungeklaert/zettel.jpg' }],
      },
    ],
    kostenvoranschlaege: [
      { id: 'kv_1', kunde_id: null, bereich: null, privat_besitzer: null, name: 'Daniel Zabelski', beschreibung: 'Fenster', betrag: '1500', status: 'offen', datum: '2026-11-17', notiz: null, dokument: { kundeId: 'k_eingang_ungeklaert', dokumentId: 'dok1', name: 'Zettel.jpg' } },
      { id: 'kv_2', kunde_id: null, bereich: null, privat_besitzer: null, name: 'Azim Bren.', beschreibung: null, betrag: null, status: 'offen', datum: '2026-11-17', notiz: null, dokument: { kundeId: 'k_eingang_ungeklaert', dokumentId: 'dok1', name: 'Zettel.jpg' } },
      { id: 'kv_3', kunde_id: null, bereich: null, privat_besitzer: null, name: 'Niemand', beschreibung: null, betrag: null, status: 'offen', datum: null, notiz: null, dokument: null },
      { id: 'kv_4', kunde_id: 'k_zabel', bereich: 'beratung', privat_besitzer: null, name: 'Daniel Zabelski', beschreibung: 'Dach', betrag: '900', status: 'offen', datum: null, notiz: null, dokument: null },
    ],
    dokument_inhalte: [],
  })
}

const chefin = { email: 'chefin@firma.test', name: 'Chefin' }

Deno.test('nur Geschäftsführung', async () => {
  const r = await kvZuordnungAktion({ admin: db(), aufrufer: { email: 'kollege@firma.test', name: 'Kollege' } }, {})
  assertEquals(r.status, 403)
})

Deno.test('Vorschläge: zählt, sortiert sichere zuerst und ändert nichts', async () => {
  const d = db()
  const r = await kvZuordnungAktion({ admin: d, aufrufer: chefin }, { modus: 'vorschlaege' })
  assertEquals(r.status, 200)
  // deno-lint-ignore no-explicit-any
  const daten = r.daten as any
  assertEquals(daten.zaehler, { gesamt: 3, sicher: 1, wahrscheinlich: 1, ohne: 1 })
  assertEquals(daten.eintraege.map((e: Zeile) => e.id), ['kv_1', 'kv_2', 'kv_3'])
  assertEquals(daten.eintraege[0].kandidaten[0].kunde_id, 'k_zabel')
  assertEquals(daten.eintraege[0].kandidaten[0].bereichName.length > 0, true)
  // öffentlicher Eintrag: die private Akte wird nicht vorgeschlagen
  assertEquals(daten.eintraege[1].kandidaten.map((k: Zeile) => k.kunde_id), ['k_brenner'])
  assert(d.protokoll.every((p) => p.art === 'select'))
})

Deno.test('Zuordnen ohne anwenden = nur Prüfung', async () => {
  const d = db()
  const r = await kvZuordnungAktion({ admin: d, aufrufer: chefin }, { modus: 'zuordnen', paare: [{ kv_id: 'kv_2', kunde_id: 'k_brenner' }] })
  // deno-lint-ignore no-explicit-any
  const daten = r.daten as any
  assertEquals(daten.angewendet, false)
  assertEquals(daten.ergebnisse[0].setzt, { kunde_id: 'k_brenner', bereich: 'immobilienkunden', privat_besitzer: null })
  assertEquals(d.tabelle('kostenvoranschlaege').find((k) => k.id === 'kv_2')!.kunde_id, null)
})

Deno.test('Zuordnen mit anwenden setzt Akte und Bereich; schon zugeordnete und private Akte bleiben unverändert', async () => {
  const d = db()
  const protokoll: string[] = []
  const r = await kvZuordnungAktion(
    { admin: d, aufrufer: chefin, protokolliere: (t) => protokoll.push(t) },
    {
      modus: 'zuordnen',
      anwenden: true,
      paare: [
        { kv_id: 'kv_2', kunde_id: 'k_brenner' },
        { kv_id: 'kv_4', kunde_id: 'k_brenner' },
        { kv_id: 'kv_3', kunde_id: 'k_priv' },
        { kv_id: 'kv_1', kunde_id: 'k_eingang_ungeklaert' },
      ],
    },
  )
  // deno-lint-ignore no-explicit-any
  const daten = r.daten as any
  assertEquals(daten.zugeordnet, 1)
  assertEquals(daten.ergebnisse.map((e: Zeile) => e.ok), [true, false, false, false])
  const kv2 = d.tabelle('kostenvoranschlaege').find((k) => k.id === 'kv_2')!
  assertEquals([kv2.kunde_id, kv2.bereich, kv2.privat_besitzer], ['k_brenner', 'immobilienkunden', null])
  assertEquals(d.tabelle('kostenvoranschlaege').find((k) => k.id === 'kv_4')!.kunde_id, 'k_zabel')
  assertEquals(d.tabelle('kostenvoranschlaege').find((k) => k.id === 'kv_3')!.kunde_id, null)
  assertEquals(protokoll.length, 1)
})

Deno.test('zu viele oder leere Paare', async () => {
  const leer = await kvZuordnungAktion({ admin: db(), aufrufer: chefin }, { modus: 'zuordnen', paare: [] })
  assertEquals(leer.status, 400)
  const viele = Array.from({ length: 101 }, (_, i) => ({ kv_id: `kv_x${i}`, kunde_id: 'k_zabel' }))
  assertEquals((await kvZuordnungAktion({ admin: db(), aufrufer: chefin }, { modus: 'zuordnen', paare: viele })).status, 400)
})
