// Tests für den Akten-Hinweis nach kostenvoranschlag_anlegen ohne Akte (erfundene Namen).
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { kvAkteHinweisNachAnlegen } from './kvAkteVorschlag.ts'
import { falscheDatenbank } from '../_shared/testDoppel.ts'

const DB = () =>
  falscheDatenbank({
    kunden: [
      { id: 'k_zabel', bereich: 'beratung', firma: 'Versicherung Daniel Zabelski', ansprechpartner: 'Daniel Zabelski', email: null, verantwortlich_email: null },
      { id: 'k_geheim', bereich: 'erben', firma: 'Daniel Zabelski Erbe', ansprechpartner: 'Daniel Zabelski', email: null, verantwortlich_email: null },
      { id: 'k_priv', bereich: 'privat', firma: 'Rolf Brenner', ansprechpartner: 'Rolf Brenner', email: null, verantwortlich_email: 'kollege@firma.test' },
    ],
  })
const kollege = { name: 'Kollege', email: 'kollege@firma.test', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }

Deno.test('Hinweis nennt nur sichtbare, passende Akten mit kunde_id und kv_id', async () => {
  const input = { eintraege: [{ name: 'Daniel Zabelski', betrag: 100 }, { name: 'Niemand' }] }
  const t = await kvAkteHinweisNachAnlegen(DB(), kollege, input, 'Angelegt: 2 Kostenvoranschläge ohne Akte … IDs: kv_a, kv_b')
  assert(t.includes('kv_id=kv_a'))
  assert(t.includes('kunde_id=k_zabel'))
  assert(!t.includes('k_geheim')) // Bereich Erben nicht freigegeben
  assert(!t.includes('kv_b'))
})

Deno.test('mit kunde_id, bei Fehlern oder privat zu fremder Akte: kein Hinweis', async () => {
  assertEquals(await kvAkteHinweisNachAnlegen(DB(), kollege, { kunde_id: 'k_zabel', eintraege: [{ name: 'Daniel Zabelski' }] }, 'Angelegt: … IDs: kv_a'), '')
  assertEquals(await kvAkteHinweisNachAnlegen(DB(), kollege, { eintraege: [{ name: 'Daniel Zabelski' }] }, 'Fehler beim Speichern'), '')
  // öffentlicher Eintrag → private Akte wird nicht vorgeschlagen; privater Eintrag → eigene private Akte schon
  assertEquals(await kvAkteHinweisNachAnlegen(DB(), kollege, { eintraege: [{ name: 'Rolf Brenner' }] }, 'Angelegt: … IDs: kv_a'), '')
  assert((await kvAkteHinweisNachAnlegen(DB(), kollege, { privat: true, eintraege: [{ name: 'Rolf Brenner' }] }, 'Angelegt: … IDs: kv_a')).includes('k_priv'))
})
