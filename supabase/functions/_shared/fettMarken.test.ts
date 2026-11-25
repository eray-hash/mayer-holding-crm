import { assertEquals } from 'jsr:@std/assert@1'
import { fettMarken, ohneFettMarken } from './fettMarken.ts'

Deno.test('fettMarken: Paar wird zu fetter Stelle', () => {
  const r = fettMarken('🟢 **Akte angelegt.** Rest')
  assertEquals(r.text, '🟢 Akte angelegt. Rest')
  // 🟢 zählt in UTF-16 als 2 Einheiten
  assertEquals(r.entities, [{ type: 'bold', offset: 3, length: 14 }])
})

Deno.test('fettMarken: mehrere Paare, unpaarig bleibt stehen', () => {
  const r = fettMarken('**a** und **b** und **c')
  assertEquals(r.text, 'a und b und **c')
  assertEquals(r.entities.map((e) => [e.offset, e.length]), [[0, 1], [6, 1]])
})

Deno.test('fettMarken: leer oder über Absätze wird nicht fett', () => {
  assertEquals(fettMarken('x **** y').entities, [])
  assertEquals(fettMarken('**a\n\nb**').entities, [])
  assertEquals(ohneFettMarken('Rechnung **3 * 4** fertig'), 'Rechnung 3 * 4 fertig')
})
