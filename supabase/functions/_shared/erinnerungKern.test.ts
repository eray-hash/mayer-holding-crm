// Zeitrechnung, Fälligkeit, Wiederholung, Knöpfe und „Erinnerung oder To-do?“ (erinnerungKern.ts).
//   npx -y deno test --allow-all --no-check _shared/erinnerungKern.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  berlinZeitZuUtc, erinnerungKnoepfe, erinnerungsNachricht, istErinnerungKnopf, istFaellig, istZuAlt, klingtNachErinnerung, leseErinnerungKnopf,
  leseWiederholung, leseZeitpunkt, naechsterZeitpunkt,
} from './erinnerungKern.ts'

Deno.test('Berliner Zeit → UTC: Winter, Sommer, deutsche Form, nur Datum = 09:00', () => {
  assertEquals(berlinZeitZuUtc('2026-11-25T12:00'), '2026-11-25T11:00:00.000Z')
  assertEquals(berlinZeitZuUtc('2026-07-01T12:00'), '2026-07-01T10:00:00.000Z')
  assertEquals(berlinZeitZuUtc('25.11.2026, 12.00 Uhr'), '2026-11-25T11:00:00.000Z')
  assertEquals(berlinZeitZuUtc('2026-11-26'), '2026-11-26T08:00:00.000Z')
  assertEquals(berlinZeitZuUtc('2026-02-31T10:00'), undefined)
  assertEquals(berlinZeitZuUtc('morgen 9 Uhr'), undefined)
  // Umstellung: 29.03.2026 ist Sommerzeit ab 3 Uhr.
  assertEquals(berlinZeitZuUtc('2026-03-29T09:00'), '2026-03-29T07:00:00.000Z')
  assertEquals(berlinZeitZuUtc('2026-03-28T09:00'), '2026-03-28T08:00:00.000Z')
})

Deno.test('leseZeitpunkt: Vergangenheit und Unsinn sind Fehler, 5 Minuten Spielraum', () => {
  const jetzt = Date.parse('2026-11-25T10:00:00.000Z') // 11:00 Berlin
  assertEquals(leseZeitpunkt('2026-11-25T12:00', jetzt), { utc: '2026-11-25T11:00:00.000Z' })
  assert('fehler' in leseZeitpunkt('2026-11-25T10:00', jetzt))
  assert('utc' in leseZeitpunkt('2026-11-25T10:57', jetzt))
  assert('fehler' in leseZeitpunkt('', jetzt))
  assert('fehler' in leseZeitpunkt('in 2 Stunden', jetzt))
})

Deno.test('Fälligkeit: nur offen, nicht gesendet, Zeit erreicht; zu alt nach 2 Tagen', () => {
  const jetzt = Date.parse('2026-11-25T11:00:00.000Z')
  assert(istFaellig({ faellig_um: '2026-11-25T11:00:00.000Z', gesendet_am: null, erledigt_am: null }, jetzt))
  assert(!istFaellig({ faellig_um: '2026-11-25T11:01:00.000Z', gesendet_am: null, erledigt_am: null }, jetzt))
  assert(!istFaellig({ faellig_um: '2026-11-25T10:00:00.000Z', gesendet_am: '2026-11-25T10:00:05.000Z', erledigt_am: null }, jetzt))
  assert(!istFaellig({ faellig_um: '2026-11-25T10:00:00.000Z', gesendet_am: null, erledigt_am: '2026-11-25T10:30:00.000Z' }, jetzt))
  assert(istZuAlt({ faellig_um: '2026-11-23T10:59:00.000Z' }, jetzt))
  assert(!istZuAlt({ faellig_um: '2026-11-23T11:01:00.000Z' }, jetzt))
})

Deno.test('Wiederholung: gleiche Berliner Uhrzeit über die Zeitumstellung, Monatsende, Nachholen', () => {
  // Samstag 28.03.2026 08:00 Berlin (Winter) → Sonntag 08:00 Berlin (Sommer)
  assertEquals(naechsterZeitpunkt('2026-03-28T07:00:00.000Z', 'taeglich', Date.parse('2026-03-28T07:00:00.000Z')), '2026-03-29T06:00:00.000Z')
  assertEquals(naechsterZeitpunkt('2026-11-25T11:00:00.000Z', 'woechentlich', Date.parse('2026-11-25T11:00:00.000Z')), '2026-12-02T11:00:00.000Z')
  // 31.01. → 28.02. (letzter Tag), 09:00 Berlin
  assertEquals(naechsterZeitpunkt('2026-01-31T08:00:00.000Z', 'monatlich', Date.parse('2026-01-31T08:00:00.000Z')), '2026-02-28T08:00:00.000Z')
  // Stand der Zeitplan drei Tage still: der nächste Termin liegt nach „jetzt“.
  assertEquals(naechsterZeitpunkt('2026-11-20T08:00:00.000Z', 'taeglich', Date.parse('2026-11-23T09:00:00.000Z')), '2026-11-24T08:00:00.000Z')
  assertEquals(naechsterZeitpunkt('2026-11-20T08:00:00.000Z', '', Date.now()), null)
  assertEquals(leseWiederholung('woechentlich'), 'woechentlich')
  assertEquals(leseWiederholung(undefined), '')
  assertEquals(leseWiederholung('stündlich'), null)
})

Deno.test('Nachricht: Text, Akte, „(von Vorname)“ nur bei Kollegen', () => {
  const basis = { text: 'Bestätigungsschreiben prüfen', fuer_email: 'b@firma.de', wiederholung: '' }
  assertEquals(erinnerungsNachricht({ ...basis, von_email: 'a@firma.de', von_name: 'Erika Beispiel' }, 'Muster GmbH'), '⏰ Erinnerung: Bestätigungsschreiben prüfen\nAkte: Muster GmbH\n(von Erika)')
  assertEquals(erinnerungsNachricht({ ...basis, von_email: 'B@firma.de', von_name: 'Max Muster' }), '⏰ Erinnerung: Bestätigungsschreiben prüfen')
  assert(erinnerungsNachricht({ ...basis, von_email: null, von_name: null, wiederholung: 'taeglich' }).endsWith('Wiederholt sich täglich.'))
})

Deno.test('Knöpfe: Form, höchstens 64 Bytes, lesen', () => {
  const id = '0b6f1c2e-6a59-4c8e-9a62-3f1a2b3c4d5e'
  const k = erinnerungKnoepfe(id)
  assertEquals(k[0].map((x) => x.callback_data), [`er:e:${id}`, `er:s:${id}`])
  for (const x of k[0]) assert(new TextEncoder().encode(x.callback_data).length <= 64)
  assert(istErinnerungKnopf(`er:s:${id}`))
  assert(!istErinnerungKnopf('ar:e:todo_abc'))
  assertEquals(leseErinnerungKnopf(`er:e:${id}`), { art: 'e', id })
  assertEquals(leseErinnerungKnopf('er:x:1'), null)
})

Deno.test('Erinnerung oder To-do? (Sicherheitsnetz für todo_anlegen)', () => {
  assert(klingtNachErinnerung('Erinnerung an Erika wg Bestätigungsschreiben'))
  assert(klingtNachErinnerung('Erinnere mich um 13 Uhr, dass wir die Mail einrichten'))
  assert(klingtNachErinnerung('[Sprachnachricht des Mitarbeiters, automatisch abgehört] erinnere Max morgen um 9 an den Vertrag'))
  assert(klingtNachErinnerung('Denk dran, dass ich um 15 Uhr den Steuerberater anrufen muss'))
  assert(klingtNachErinnerung('schick mir um 15 Uhr eine Nachricht wegen der Bank'))
  assert(!klingtNachErinnerung('Setz mir ein To-do: Steuerunterlagen sortieren und erinnere mich Freitag'))
  assert(!klingtNachErinnerung('Aufgabe für Max: Exposé prüfen'))
  assert(!klingtNachErinnerung('schreib mir auf: Steuerunterlagen bis Freitag sortieren'))
  assert(!klingtNachErinnerung('[Datei-Eingang] Erinnerungsschreiben.pdf'))
  assert(!klingtNachErinnerung(undefined))
})
