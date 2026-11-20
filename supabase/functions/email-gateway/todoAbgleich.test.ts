import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1'
import { abgleichHash, ausMicrosoft, berlinDatum, nachMicrosoft, type CrmAufgabe } from './todoAbgleich.ts'

Deno.test('To Do → CRM: Fälligkeit in UTC wird zum richtigen deutschen Datum', () => {
  const f = ausMicrosoft({ id: 'x', title: ' Steuer ', status: 'notStarted', importance: 'high', dueDateTime: { dateTime: '2026-11-20T23:00:00.0000000', timeZone: 'UTC' }, body: { content: 'Belege', contentType: 'text' } })
  assertEquals(f.aufgabe, 'Steuer')
  assertEquals(f.erledigen_bis, '2026-11-21')
  assertEquals(f.prio, 'A')
  assertEquals(f.aktueller_stand, 'Belege')
  assertEquals(f.erledigt_am, null)
})

Deno.test('To Do → CRM: Wichtigkeit normal stuft A auf B, andere Prioritäten bleiben', () => {
  assertEquals(ausMicrosoft({ id: 'x', title: 't', importance: 'normal' }, { prio: 'A' }).prio, 'B')
  assertEquals(ausMicrosoft({ id: 'x', title: 't', importance: 'normal' }, { prio: 'C' }).prio, 'C')
  assertEquals(ausMicrosoft({ id: 'x', title: 't', importance: 'normal' }).prio, null)
})

Deno.test('To Do → CRM: erledigt übernimmt vorhandenes Datum, sonst Erledigt-Zeitpunkt', () => {
  assertEquals(ausMicrosoft({ id: 'x', title: 't', status: 'completed' }, { erledigt_am: '2026-11-01' }).erledigt_am, '2026-11-01')
  assertEquals(ausMicrosoft({ id: 'x', title: 't', status: 'completed', completedDateTime: { dateTime: '2026-11-19T23:30:00', timeZone: 'UTC' } }).erledigt_am, '2026-11-20')
})

Deno.test('CRM → To Do: Felder und Zeitzone', () => {
  const a: CrmAufgabe = { id: '1', aufgabe: 'Anruf', erledigt_am: null, erledigen_bis: '2026-11-25', prio: 'A', aktueller_stand: 'Notiz', erinnern_um: '2026-11-24T08:00:00.000Z' }
  const t = nachMicrosoft(a)
  assertEquals(t.title, 'Anruf')
  assertEquals(t.status, 'notStarted')
  assertEquals(t.importance, 'high')
  assertEquals(t.dueDateTime, { dateTime: '2026-11-25T00:00:00', timeZone: 'W. Europe Standard Time' })
  assertEquals(t.isReminderOn, true)
  assertEquals(t.reminderDateTime, { dateTime: '2026-11-24T09:00:00', timeZone: 'W. Europe Standard Time' })
})

Deno.test('Hin und zurück ändert den Abgleich-Stand nicht (kein Pingpong)', async () => {
  const a: CrmAufgabe = { id: '1', aufgabe: 'Anruf', erledigt_am: null, erledigen_bis: '2026-11-25', prio: 'A', aktueller_stand: 'Notiz', erinnern_um: '2026-11-24T08:00:00.000Z' }
  const t = nachMicrosoft(a) as Record<string, unknown>
  // Microsoft liefert Fälligkeit in UTC zurück und die Erinnerung in der gesetzten Zone
  const zurueck = ausMicrosoft(
    { id: 'x', title: t.title as string, status: 'notStarted', importance: 'high', body: { content: 'Notiz' }, dueDateTime: { dateTime: '2026-11-24T23:00:00.0000000', timeZone: 'UTC' }, isReminderOn: true, reminderDateTime: { dateTime: '2026-11-24T09:00:00.0000000', timeZone: 'W. Europe Standard Time' } },
    a,
  )
  assertEquals(await abgleichHash(zurueck), await abgleichHash(a))
  assertNotEquals(await abgleichHash({ ...a, aufgabe: 'Anders' }), await abgleichHash(a))
  // Prioritäten unterhalb von A gelten als gleich (To Do kennt nur wichtig/nicht wichtig)
  assertEquals(await abgleichHash({ ...a, prio: 'B' }), await abgleichHash({ ...a, prio: 'C' }))
})

Deno.test('berlinDatum um Mitternacht', () => {
  assertEquals(berlinDatum('2026-06-30T22:30:00Z'), '2026-07-01')
  assertEquals(berlinDatum('2026-12-31T22:59:00Z'), '2026-12-31')
})
