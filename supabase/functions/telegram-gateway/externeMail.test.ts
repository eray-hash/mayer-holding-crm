// Adressen ohne Kundenakte für mail_vorbereiten (an_adressen). Kein Netz.
//
//   npx -y deno test telegram-gateway/externeMail.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { leseExterneAdressen, zerlegeAdresse } from './externeMail.ts'

Deno.test('zerlegeAdresse: mit Name, in Klammern, nur Adresse, mailto, ungültig', () => {
  assertEquals(zerlegeAdresse('Max Muster <Max.Muster@Firma.de>'), { email: 'max.muster@firma.de', name: 'Max Muster' })
  assertEquals(zerlegeAdresse('"Dr. Erika Beispiel" <erika@beispiel.de>'), { email: 'erika@beispiel.de', name: 'Dr. Erika Beispiel' })
  assertEquals(zerlegeAdresse('<gast@beispiel.de>'), { email: 'gast@beispiel.de', name: '' })
  assertEquals(zerlegeAdresse('gast@beispiel.de'), { email: 'gast@beispiel.de', name: '' })
  assertEquals(zerlegeAdresse('mailto:gast@beispiel.de'), { email: 'gast@beispiel.de', name: '' })
  assertEquals(zerlegeAdresse('gast@beispiel.de <gast@beispiel.de>'), { email: 'gast@beispiel.de', name: '' })
  assertEquals(zerlegeAdresse('Max Muster'), null)
  assertEquals(zerlegeAdresse('max@muster'), null)
  assertEquals(zerlegeAdresse(''), null)
})

Deno.test('leseExterneAdressen: Liste oder Text, doppelte einmal, eigene Adresse und Sammeladressen abgelehnt', () => {
  const r = leseExterneAdressen(['Max Muster <max@firma.de>', 'MAX@firma.de', 'kein-mail', 'info@holding.de', 'noreply@dienst.de'], 'Info@Holding.de')
  assertEquals(r.adressen, [{ email: 'max@firma.de', name: 'Max Muster' }])
  assertEquals(r.fehler.length, 3)
  const t = leseExterneAdressen('Max Muster <max@firma.de>, erika@beispiel.de; "Nachname, Vorname" <nv@beispiel.de>')
  assertEquals(t.adressen.map((a) => a.email), ['max@firma.de', 'erika@beispiel.de', 'nv@beispiel.de'])
  assertEquals(leseExterneAdressen(undefined), { adressen: [], fehler: [] })
})
