import { assertEquals } from 'jsr:@std/assert@1'
import { HAIKU_MIN_TOKENS, ladeSparEinstellung, sparenFuer, sparKoerper, SPAR_AUS, vergissSparEinstellung } from './kiSparmodus.ts'

Deno.test('sparenFuer: aus, Personen, alle, Ausnahmen', () => {
  const r = { anlass: 'telegram', person: 'a@b.de' }
  assertEquals(sparenFuer(SPAR_AUS, r), false)
  assertEquals(sparenFuer({ modus: 'personen', personen: ['A@B.de'], ausnahmen: [] }, r), true)
  assertEquals(sparenFuer({ modus: 'personen', personen: ['x@y.de'], ausnahmen: [] }, r), false)
  assertEquals(sparenFuer({ modus: 'personen', personen: ['a@b.de'], ausnahmen: [] }, { anlass: 'mail-eingang', person: '' }), false)
  assertEquals(sparenFuer({ modus: 'alle', personen: [], ausnahmen: [] }, { anlass: 'dokument_lesen', person: '' }), true)
  assertEquals(sparenFuer({ modus: 'alle', personen: [], ausnahmen: ['bonitaet'] }, { anlass: 'bonitaet_pruefen', person: '' }), false)
})

Deno.test('sparKoerper: nur Sonnet wird umgestellt', () => {
  assertEquals(sparKoerper(JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 100 })), null)
  assertEquals(sparKoerper('kein json'), null)
})

Deno.test('sparKoerper: ohne Denk-Einstellung mindestens 12.000 Token', () => {
  const k = JSON.parse(sparKoerper(JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 4000, messages: [] }))!)
  assertEquals(k.model, 'claude-haiku-5-5')
  assertEquals(k.max_tokens, HAIKU_MIN_TOKENS)
  assertEquals(k.messages, [])
})

Deno.test('sparKoerper: between_tools wird zu disabled, max_tokens bleibt', () => {
  const k = JSON.parse(sparKoerper(JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 600, thinking: { type: 'between_tools' } }))!)
  assertEquals(k.thinking, { type: 'disabled' })
  assertEquals(k.max_tokens, 600)
})

Deno.test('ladeSparEinstellung: Fehler oder leere Tabelle → aus, Zwischenspeicher eine Minute', async () => {
  vergissSparEinstellung()
  assertEquals(await ladeSparEinstellung(() => { throw new Error('keine Verbindung') }, 0), SPAR_AUS)
  vergissSparEinstellung()
  let aufrufe = 0
  const db = () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => { aufrufe++; return Promise.resolve({ data: { modus: 'alle', personen: null, ausnahmen: ['x'] } }) } }) }) }),
  })
  assertEquals(await ladeSparEinstellung(db, 1000), { modus: 'alle', personen: [], ausnahmen: ['x'] })
  await ladeSparEinstellung(db, 30_000)
  assertEquals(aufrufe, 1)
  await ladeSparEinstellung(db, 70_000)
  assertEquals(aufrufe, 2)
  vergissSparEinstellung()
})
