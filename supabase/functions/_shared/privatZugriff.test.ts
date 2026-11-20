import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import { darfObjekt, darfPrivatKunde, istPrivaterKunde, istPrivatesObjekt, nurMayerKunden, nurMayerObjekte } from './privatZugriff.ts'

Deno.test('istPrivatesObjekt: nur mit eingetragenem Besitzer', () => {
  assert(istPrivatesObjekt({ privat_besitzer: 'a@x.de' }))
  assertFalse(istPrivatesObjekt({ privat_besitzer: null }))
  assertFalse(istPrivatesObjekt({ privat_besitzer: '   ' }))
  assertFalse(istPrivatesObjekt({}))
  assertFalse(istPrivatesObjekt(null))
})

Deno.test('darfObjekt: privates Objekt nur für den Besitzer, ohne Rücksicht auf Groß-/Kleinschreibung', () => {
  const o = { privat_besitzer: 'Eray@Beispiel.de' }
  assert(darfObjekt(o, 'eray@beispiel.de', false))
  assert(darfObjekt(o, ' ERAY@beispiel.de ', true))
  // Auch wer Immobilien darf (oder Geschäftsführung ist), sieht fremde private Objekte nicht.
  assertFalse(darfObjekt(o, 'andreas@beispiel.de', true))
  assertFalse(darfObjekt(o, '', true))
})

Deno.test('darfObjekt: Mayer-Objekt nach Immobilien-Recht', () => {
  assert(darfObjekt({ privat_besitzer: null }, 'x@y.de', true))
  assertFalse(darfObjekt({ privat_besitzer: null }, 'x@y.de', false))
  assert(darfObjekt({}, 'x@y.de', true))
})

Deno.test('darfPrivatKunde: private Kontakte nur für den Besitzer, andere immer', () => {
  assert(istPrivaterKunde({ bereich: 'privat' }))
  assertFalse(istPrivaterKunde({ bereich: 'beratung' }))
  assert(darfPrivatKunde({ bereich: 'privat', verantwortlich_email: 'A@x.de' }, 'a@X.de'))
  assertFalse(darfPrivatKunde({ bereich: 'privat', verantwortlich_email: 'a@x.de' }, 'b@x.de'))
  // Ohne eingetragenen Besitzer darf niemand.
  assertFalse(darfPrivatKunde({ bereich: 'privat', verantwortlich_email: null }, 'b@x.de'))
  assertFalse(darfPrivatKunde({ bereich: 'privat', verantwortlich_email: '' }, ''))
  assert(darfPrivatKunde({ bereich: 'erben', verantwortlich_email: 'a@x.de' }, 'b@x.de'))
})

Deno.test('nurMayerObjekte / nurMayerKunden: private fallen heraus', () => {
  const objekte = [{ id: '1', privat_besitzer: null }, { id: '2', privat_besitzer: 'a@x.de' }, { id: '3' }]
  assertEquals(nurMayerObjekte(objekte).map((o) => o.id), ['1', '3'])
  const kunden = [{ id: 'a', bereich: 'privat' }, { id: 'b', bereich: 'beratung' }, { id: 'c', bereich: null }]
  assertEquals(nurMayerKunden(kunden).map((k) => k.id), ['b', 'c'])
})
