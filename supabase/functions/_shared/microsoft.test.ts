import { assertEquals } from 'jsr:@std/assert@1'
import { berlinZuUtc, erlaubterRuecksprung, isoZuMsZeit, msErlaubt, msZeitZuIso } from './microsoft.ts'

Deno.test('To Do liefert Fälligkeit in UTC: 21.11. 00:00 deutscher Zeit bleibt der 21.11.', () => {
  const iso = msZeitZuIso({ dateTime: '2026-11-20T23:00:00.0000000', timeZone: 'UTC' })
  assertEquals(iso, '2026-11-20T23:00:00.000Z')
  assertEquals(isoZuMsZeit(iso!).dateTime, '2026-11-21T00:00:00')
})

Deno.test('Deutsche Zeit → UTC, Winter und Sommer', () => {
  assertEquals(berlinZuUtc('2026-01-15T10:00:00'), '2026-01-15T09:00:00.000Z')
  assertEquals(berlinZuUtc('2026-07-15T10:00:00'), '2026-07-15T08:00:00.000Z')
  assertEquals(msZeitZuIso({ dateTime: '2026-07-15T10:00:00', timeZone: 'W. Europe Standard Time' }), '2026-07-15T08:00:00.000Z')
})

Deno.test('Umstellungstage', () => {
  // 29.03.2026: 02:00 → 03:00 Sommerzeit
  assertEquals(berlinZuUtc('2026-03-29T01:30:00'), '2026-03-29T00:30:00.000Z')
  assertEquals(berlinZuUtc('2026-03-29T03:30:00'), '2026-03-29T01:30:00.000Z')
  // 25.10.2026: 03:00 → 02:00 Winterzeit
  assertEquals(berlinZuUtc('2026-10-25T12:00:00'), '2026-10-25T11:00:00.000Z')
  assertEquals(isoZuMsZeit('2026-10-25T11:00:00.000Z'), { dateTime: '2026-10-25T12:00:00', timeZone: 'W. Europe Standard Time' })
})

Deno.test('Freigabe nur über MS_ERLAUBT, Groß-/Kleinschreibung egal', () => {
  Deno.env.set('MS_ERLAUBT', ' a@b.de, Test@Beispiel.de ')
  assertEquals(msErlaubt('test@beispiel.de'), true)
  assertEquals(msErlaubt('A@B.DE'), true)
  assertEquals(msErlaubt('c@b.de'), false)
  Deno.env.set('MS_ERLAUBT', '')
  assertEquals(msErlaubt('a@b.de'), false)
})

Deno.test('Rücksprung nur auf die echte CRM-Seite', () => {
  assertEquals(erlaubterRuecksprung('https://eray-hash.github.io/mayer-holding-crm/'), true)
  assertEquals(erlaubterRuecksprung('http://localhost:5173'), true)
  assertEquals(erlaubterRuecksprung('https://boese.example/mayer-holding-crm/'), false)
  assertEquals(erlaubterRuecksprung('https://eray-hash.github.io/mayer-holding-crm/../x'), false)
})
