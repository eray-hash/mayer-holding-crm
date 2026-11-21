import { assertEquals } from 'jsr:@std/assert@1'
import { speicherName } from './outlookWerkzeuge.ts'

Deno.test('speicherName: Umlaute und Sonderzeichen raus aus dem Speicherpfad (Ablage lehnt sie ab)', () => {
  assertEquals(speicherName('2026-11-20_Herr-Müller_Testbrief'), '2026-11-20_Herr-Mueller_Testbrief')
  assertEquals(speicherName('Größe & Maß: Straße'), 'Groesse_Mass_Strasse')
  assertEquals(speicherName('Café Noël'), 'Cafe_Noel')
  assertEquals(speicherName('§§§'), '_')
})
