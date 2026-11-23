import { assertEquals } from 'jsr:@std/assert@1'
import { heuteBerlin } from './heuteBerlin.ts'

Deno.test('heuteBerlin: kurz nach Mitternacht schon der neue Tag', () => {
  assertEquals(heuteBerlin(new Date('2026-11-22T23:30:00Z')), '2026-11-23') // Winter, UTC+1
  assertEquals(heuteBerlin(new Date('2026-07-01T22:30:00Z')), '2026-07-02') // Sommer, UTC+2
  assertEquals(heuteBerlin(new Date('2026-11-23T10:00:00Z')), '2026-11-23')
})
