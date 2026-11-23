// Zwei gleichzeitige Online-Buchungen derselben Zeit: genau eine bleibt (die früher angelegte), nicht keine.
import { assertEquals } from 'jsr:@std/assert@1'
import { mussZurueckziehen, type Belegung } from './buchung.ts'

const zeit = { beginn: '2026-12-01T09:00:00.000Z', ende: '2026-12-01T09:30:00.000Z' }

Deno.test('Gleichzeitige Buchungen: die spätere zieht zurück, die frühere bleibt', () => {
  const a: Belegung = { id: 'a', ...zeit, erstellt_am: '2026-11-23T10:00:00.100Z', quelle: 'buchung' }
  const b: Belegung = { id: 'b', ...zeit, erstellt_am: '2026-11-23T10:00:00.200Z', quelle: 'buchung' }
  const beide = [a, b]
  assertEquals(mussZurueckziehen({ id: 'a', erstellt_am: a.erstellt_am }, beide), false)
  assertEquals(mussZurueckziehen({ id: 'b', erstellt_am: b.erstellt_am }, beide), true)
})

Deno.test('Gleiche Anlagezeit: Entscheidung über die Kennung, genau eine bleibt', () => {
  const t = '2026-11-23T10:00:00.000Z'
  const beide: Belegung[] = [{ id: 'x1', ...zeit, erstellt_am: t, quelle: 'buchung' }, { id: 'x2', ...zeit, erstellt_am: t, quelle: 'buchung' }]
  const zurueck = ['x1', 'x2'].filter((id) => mussZurueckziehen({ id, erstellt_am: t }, beide))
  assertEquals(zurueck, ['x2'])
})

Deno.test('Anderer Termin des Mitarbeiters (nicht online gebucht) in der Zeit: Buchung zieht immer zurück', () => {
  const eigener: Belegung = { id: 'm', ...zeit, erstellt_am: '2026-11-23T10:00:05.000Z', quelle: 'crm' }
  assertEquals(mussZurueckziehen({ id: 'a', erstellt_am: '2026-11-23T10:00:00.000Z' }, [eigener]), true)
  assertEquals(mussZurueckziehen({ id: 'a', erstellt_am: '2026-11-23T10:00:00.000Z' }, [{ id: 'a', ...zeit }]), false)
})
