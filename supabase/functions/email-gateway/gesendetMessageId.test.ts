import { assert, assertEquals, assertMatch, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { domainVon, gesendetKennung, neueMessageId } from './gesendetMessageId.ts'
import { kennungNorm, verlaufsKennungen } from './mailZuordnung.ts'

Deno.test('domainVon: aus Adresse oder „Name <adresse>“, sonst Firmendomain', () => {
  assertEquals(domainVon('info@amayer-holding.com'), 'amayer-holding.com')
  assertEquals(domainVon('Quirin <immo@AMAYER-holding.com>'), 'amayer-holding.com')
  assertEquals(domainVon('eray@fundament-it.de'), 'fundament-it.de')
  assertEquals(domainVon(undefined), 'amayer-holding.com')
  assertEquals(domainVon('kaputt@'), 'amayer-holding.com')
  assertEquals(domainVon('x@localhost'), 'amayer-holding.com')
})

Deno.test('neueMessageId: Form <zufall.crm@domain>, eindeutig', () => {
  assertEquals(neueMessageId('info@amayer-holding.com', 'abc-123'), '<abc-123.crm@amayer-holding.com>')
  assertEquals(neueMessageId('a@b.de', 'x<>@y'), '<xy.crm@b.de>')
  const a = neueMessageId('info@amayer-holding.com')
  const b = neueMessageId('info@amayer-holding.com')
  assertNotEquals(a, b)
  assertMatch(a, /^<[0-9a-f-]{36}\.crm@amayer-holding\.com>$/)
})

Deno.test('gesendetKennung: gemeinsam nackt, persönlich mit Postfach-Kennung (wie gesendetAbruf.ts)', () => {
  const mid = '<abc.crm@amayer-holding.com>'
  assertEquals(gesendetKennung(mid, { id: 'standard', persoenlich: false }), mid)
  assertEquals(gesendetKennung(mid, { id: 'pf_eray', persoenlich: true }), `pf_eray:${mid}`)
  assertEquals(gesendetKennung('abc@x.de', { id: 'standard', persoenlich: false }), '<abc@x.de>')
  assertEquals(gesendetKennung('', { id: 'standard', persoenlich: false }), null)
  assertEquals(gesendetKennung(undefined, { id: 'standard', persoenlich: false }), null)
})

Deno.test('Antwort des Kunden findet die gespeicherte Kennung (mailZuordnung: kennungNorm/verlaufsKennungen)', () => {
  const mid = neueMessageId('info@amayer-holding.com')
  const gespeichert = gesendetKennung(mid, { id: 'standard', persoenlich: false })
  // Antwort über den Weiterleitungsdienst: Kopfzeilen flach in rohdaten.
  const antwortRoh = { 'headers[in_reply_to]': mid.toUpperCase(), 'headers[references]': `<alt@x.de> ${mid}` }
  const kennungen = verlaufsKennungen(antwortRoh)
  assert(kennungen.includes(kennungNorm(gespeichert)))
  // Persönliches Postfach: Vorsatz wird beim Vergleich abgeschnitten.
  assertEquals(kennungNorm(gesendetKennung(mid, { id: 'pf_x', persoenlich: true })), kennungNorm(mid))
})
