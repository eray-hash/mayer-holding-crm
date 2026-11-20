import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1'
import { ausOutlook, darfNachOutlook, nachOutlook, terminHash, type CrmTermin } from './kalenderAbgleich.ts'

const basis: CrmTermin = { id: '1', titel: 'Zahnarzt', beschreibung: '', ort: 'Ulm', beginn: '2026-11-25T09:00:00.000Z', ende: '2026-11-25T10:00:00.000Z', ganztags: false, besitzer_email: 'h@x.de', teilnehmer: [], kunde_id: null, kunde_bereich: null, gast: null, ms_id: null, ms_hash: null, ms_geaendert: null, ms_teilnehmer: null }

Deno.test('Outlook → CRM: Zeiten in deutscher Zeit werden zu UTC', () => {
  const f = ausOutlook({ id: 'a', subject: ' Zahnarzt ', location: { displayName: 'Ulm' }, start: { dateTime: '2026-11-25T10:00:00.0000000', timeZone: 'W. Europe Standard Time' }, end: { dateTime: '2026-11-25T11:00:00.0000000', timeZone: 'W. Europe Standard Time' } })
  assertEquals(f, { titel: 'Zahnarzt', ort: 'Ulm', beginn: '2026-11-25T09:00:00.000Z', ende: '2026-11-25T10:00:00.000Z', ganztags: false })
})

Deno.test('Outlook → CRM: ganztägig = Mitternacht deutscher Zeit bis Mitternacht des Folgetags (Sommerzeit)', () => {
  const f = ausOutlook({ id: 'a', subject: 'Urlaub', isAllDay: true, start: { dateTime: '2026-07-10T00:00:00.0000000', timeZone: 'W. Europe Standard Time' }, end: { dateTime: '2026-07-12T00:00:00.0000000', timeZone: 'W. Europe Standard Time' } })
  assertEquals(f.beginn, '2026-07-09T22:00:00.000Z')
  assertEquals(f.ende, '2026-07-11T22:00:00.000Z')
  assertEquals(f.ganztags, true)
})

Deno.test('Hin und zurück: gleiche Prüfsumme (kein Pingpong), auch ganztägig', async () => {
  for (const t of [basis, { ...basis, ganztags: true, beginn: '2026-07-09T22:00:00.000Z', ende: '2026-07-11T22:00:00.000Z' }]) {
    const o = nachOutlook(t) as { subject: string; location: { displayName: string }; isAllDay: boolean; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } }
    const zurueck = ausOutlook({ id: 'a', subject: o.subject, location: o.location, isAllDay: o.isAllDay, start: o.start, end: o.end })
    assertEquals(await terminHash(zurueck), await terminHash(t))
  }
  assertNotEquals(await terminHash({ ...basis, ort: 'Neu-Ulm' }), await terminHash(basis))
})

Deno.test('CRM → Outlook: ganztägig mit Datum, sonst deutsche Zeit; Notiz nur beim Anlegen', () => {
  const g = nachOutlook({ ...basis, ganztags: true, beginn: '2026-11-24T23:00:00.000Z', ende: '2026-11-25T23:00:00.000Z', beschreibung: 'x' }, true) as Record<string, unknown>
  assertEquals(g.start, { dateTime: '2026-11-25T00:00:00', timeZone: 'W. Europe Standard Time' })
  assertEquals(g.end, { dateTime: '2026-11-26T00:00:00', timeZone: 'W. Europe Standard Time' })
  assertEquals((g.body as { content: string }).content, 'x')
  const n = nachOutlook({ ...basis, beschreibung: 'geheim' }) as Record<string, unknown>
  assertEquals(n.start, { dateTime: '2026-11-25T10:00:00', timeZone: 'W. Europe Standard Time' })
  assertEquals(n.body, undefined)
})

Deno.test('Mayer-Termine gehen nicht ins private Outlook', () => {
  assertEquals(darfNachOutlook(basis), true)
  assertEquals(darfNachOutlook({ ...basis, teilnehmer: ['kollege@amayer-holding.com'] }), false)
  assertEquals(darfNachOutlook({ ...basis, gast: { email: 'kunde@x.de', eingeladen: true } }), false)
  assertEquals(darfNachOutlook({ ...basis, kunde_id: 'k1', kunde_bereich: 'beratung' }), false)
  assertEquals(darfNachOutlook({ ...basis, kunde_id: 'k1', kunde_bereich: 'privat' }), true)
})
