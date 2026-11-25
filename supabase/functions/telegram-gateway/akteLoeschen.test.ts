import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { loeschBitteAnGf, selbstLoeschRecht } from './akteLoeschen.ts'

const jetzt = new Date('2026-11-25T12:00:00Z')
const wer = { id: 'm_ma', name: 'Test Mitarbeiter', email: 'test@beispiel.de' }
const frisch = { id: 'k_test', activities: [{ id: 'a1', date: '2026-11-24', text: 'Akte angelegt', user: 'Test Mitarbeiter' }], verantwortlich: null, verantwortlich_email: null }

Deno.test('selbstLoeschRecht: eigene frische Akte ohne Anhänge → ja', async () => {
  const db = falscheDatenbank({ rechnungen: [], kostenvoranschlaege: [], protokolle: [] })
  assertEquals((await selbstLoeschRecht(db, wer, frisch, jetzt)).ok, true)
})

Deno.test('selbstLoeschRecht: Kostenvoranschlag an der Akte → nein, mit Grund', async () => {
  const db = falscheDatenbank({ rechnungen: [], kostenvoranschlaege: [{ id: 'kv1', kunde_id: 'k_test' }], protokolle: [] })
  const r = await selbstLoeschRecht(db, wer, frisch, jetzt)
  assertEquals(r.ok, false)
  if (!r.ok) assertStringIncludes(r.grund, 'Kostenvoranschlag')
})

Deno.test('selbstLoeschRecht: Akte eines Kollegen → nein', async () => {
  const db = falscheDatenbank({ rechnungen: [], kostenvoranschlaege: [], protokolle: [] })
  const r = await selbstLoeschRecht(db, wer, { ...frisch, activities: [{ date: '2026-11-24', user: 'Kollege' }] }, jetzt)
  assertEquals(r.ok, false)
})

Deno.test('loeschBitteAnGf: Mitteilung an die Geschäftsführung, nicht an den Fragenden', async () => {
  const db = falscheDatenbank({
    mitarbeiter: [
      { id: 'm_gf', name: 'Chef Beispiel', rolle: 'geschaeftsfuehrung', aktiv: true, telegram_chat_id: 11, telegram_pending: null },
      { id: 'm_ma', name: 'Test Mitarbeiter', rolle: 'mitarbeiter', aktiv: true, telegram_chat_id: 22, telegram_pending: null },
    ],
  })
  const gesendet: string[] = []
  const altesFetch = globalThis.fetch
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    gesendet.push(String(init?.body ?? ''))
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }))
  }) as typeof fetch
  try {
    const log: string[] = []
    const wege = { botToken: 'X', ladeState: () => ({ zuege: [] }), speichereZustand: () => Promise.resolve() }
    const text = await loeschBitteAnGf(db, wege, wer, { id: 'k_test', name: 'Testakte', bereich: 'Immobilien' }, 'An der Akte hängen 1 Rechnung.', 'bitte die Testakte löschen', (t) => log.push(t))
    assertStringIncludes(text, 'NICHT GELÖSCHT')
    assertStringIncludes(text, 'Chef Beispiel')
    assertEquals(gesendet.length, 1)
    assertStringIncludes(gesendet[0], '"chat_id":11')
    assertStringIncludes(gesendet[0], 'Löschbitte von Test Mitarbeiter')
    assertEquals(log.length, 1)
  } finally {
    globalThis.fetch = altesFetch
  }
})

Deno.test('loeschBitteAnGf: ohne Bot-Weg ehrliche Antwort', async () => {
  const db = falscheDatenbank({ mitarbeiter: [] })
  const text = await loeschBitteAnGf(db, undefined, wer, { id: 'k_test', name: 'Testakte', bereich: 'Immobilien' }, 'Grund.', undefined, () => {})
  assertStringIncludes(text, 'direkt fragen')
})
