// Prüft den Profil-Kern: Ersatz-Telefon, Lücken, Telefonprüfung, Nummer aus der Signatur.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from './testDoppel.ts'
import {
  FIRMEN_TELEFON_STANDARD,
  firmenKontaktAus,
  profilLuecken,
  profilProzent,
  pruefeTelefon,
  telefonAusSignatur,
  telefonFuerMitarbeiter,
  wirksamesTelefon,
} from './profilKern.ts'

Deno.test('Firmen-Kontakt: Vorgaben, abgeschaltet, eigene Nummer', () => {
  assertEquals(firmenKontaktAus(null).telefon, FIRMEN_TELEFON_STANDARD)
  assertEquals(firmenKontaktAus({ an: false }).an, false)
  assertEquals(firmenKontaktAus({ telefon: ' 0731 555 ' }).telefon, '0731 555')
})

Deno.test('Wirksames Telefon: eigene → Mobil → Firma → leer', () => {
  const an = firmenKontaktAus(null)
  assertEquals(wirksamesTelefon('0731 1', '0176 2', an), '0731 1')
  assertEquals(wirksamesTelefon('', '0176 2', an), '0176 2')
  assertEquals(wirksamesTelefon(null, ' ', an), FIRMEN_TELEFON_STANDARD)
  assertEquals(wirksamesTelefon(null, null, firmenKontaktAus({ an: false })), '')
})

Deno.test('Telefon für Mitarbeiter aus der Datenbank (Name, E-Mail, unbekannt)', async () => {
  const d = falscheDatenbank({
    mitarbeiter: [
      { id: 'a', name: 'Quirin', email: 'q@x.de', aktiv: true, telefon: null },
      { id: 'b', name: 'Hasan', email: 'h@x.de', aktiv: true, telefon: '0731 9' },
    ],
    mitarbeiter_profil: [{ id: 'a', mobil: '0176 5555555' }],
    abteilung_eintraege: [{ id: 'firmen_kontakt', art: 'firmen_kontakt', daten: { an: true, telefon: '0731 000' } }],
  })
  assertEquals(await telefonFuerMitarbeiter(d, { name: 'quirin' }), '0176 5555555')
  assertEquals(await telefonFuerMitarbeiter(d, { email: 'H@x.de' }), '0731 9')
  assertEquals(await telefonFuerMitarbeiter(d, { name: 'Niemand' }), '0731 000')
  assertEquals(await telefonFuerMitarbeiter(d, { telefon: '0711 1', name: 'Quirin' }), '0711 1')
})

Deno.test('Lücken und Prozent', () => {
  const firma = firmenKontaktAus(null)
  const alle = profilLuecken({}, firma)
  assertEquals(alle.map((l) => l.feld), ['telefon', 'signatur', 'position'])
  assertStringIncludes(alle[0].warum, 'automatischen Mails an Interessenten')
  assertStringIncludes(alle[0].warum, FIRMEN_TELEFON_STANDARD)
  assertEquals(profilLuecken({ mobil: '0176 1234567', signatur: '<p>Q</p>', position: 'Berater' }).length, 0)
  assertEquals(profilLuecken({ telefon: '1234567', signatur: '<p> </p>' }).map((l) => l.feld), ['signatur', 'position'])
  assertEquals(profilProzent({ telefon: '0731 123456' }), 33)
})

Deno.test('Telefonprüfung', () => {
  assertEquals(pruefeTelefon(' +49  176 123 4567 '), { ok: true, wert: '+49 176 123 4567' })
  assertEquals(pruefeTelefon(''), { ok: true, wert: '' })
  assert(!pruefeTelefon('12345').ok)
  assert(!pruefeTelefon('ruf an').ok)
})

Deno.test('Nummer aus der Signatur', () => {
  assertEquals(telefonAusSignatur('<p>Quirin<br>Schwabstr. 3, 89075 Ulm<br>Tel.: 0731 / 123 456</p>'), '0731 / 123 456')
  assertEquals(telefonAusSignatur('<p>Mobil +49 176 2096 7139</p>'), '+49 176 2096 7139')
  assertEquals(telefonAusSignatur('<p>Schwabstr. 3, 89075 Ulm</p>'), '')
  assertEquals(telefonAusSignatur(null), '')
})
