import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { gaesteEingabe, gaesteText, gaesteZeile } from './terminGaeste.ts'

Deno.test('Gäste-Eingabe und Rückmeldung', () => {
  assertEquals(gaesteEingabe({ gaeste: ['Anna <anna@beispiel.test>', ' '], kunde_einladen: true }), { gaeste: [{ email: 'Anna <anna@beispiel.test>' }], gast_einladen: true })
  assertEquals(gaesteEingabe({}), {})
  assertStringIncludes(gaesteZeile({ gaesteEingeladen: ['anna@beispiel.test'] }), 'anna@beispiel.test')
  assertEquals(gaesteZeile({ gaesteEingeladen: [] }), '')
  assertEquals(gaesteText({ gaeste: [{ email: 'a@b.test', name: 'A' }] }), 'Gäste: A <a@b.test>')
})
