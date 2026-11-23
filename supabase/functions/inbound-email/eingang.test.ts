// Tests: reine Hilfsfunktionen von inbound-email — Fälle aus echten Mails (Absender mit Kommentar, zwei Anhänge
// gleichen Namens, CSS im Mailtext, Date-Kopf).
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1'
import { anhangPfad, mailDatum, parseFromHeader, textAusHtml } from './eingang.ts'

Deno.test('Absender: Name und Adresse, auch mit Kommentar hinter der Adresse', () => {
  assertEquals(parseFromHeader('"Dr. Med. Janina" <noreply@Hoehle-der-Loewen.de> (WEGO6)'), { email: 'noreply@hoehle-der-loewen.de', name: 'Dr. Med. Janina' })
  assertEquals(parseFromHeader('Max Muster <Max@Firma.de>'), { email: 'max@firma.de', name: 'Max Muster' })
  assertEquals(parseFromHeader('<nur@adresse.de>'), { email: 'nur@adresse.de', name: 'nur@adresse.de' })
  assertEquals(parseFromHeader('a@b.de (Anna B.)'), { email: 'a@b.de', name: 'Anna B.' })
  assertEquals(parseFromHeader(' A@B.de '), { email: 'a@b.de', name: 'a@b.de' })
  assertEquals(parseFromHeader('unbekannt'), { email: 'unbekannt', name: 'unbekannt' })
})

Deno.test('Anhänge gleichen Namens bekommen verschiedene Ablagepfade', () => {
  const a = anhangPfad('<abc@mail.example.com>', 'inline', 1)
  const b = anhangPfad('<abc@mail.example.com>', 'inline', 2)
  assertNotEquals(a, b)
  assertEquals(a, 'abc_mail.example.com/1_inline')
  assertEquals(anhangPfad('<x@y>', 'Rechnung März.pdf', 3), 'x_y/3_Rechnung_M_rz.pdf')
  assertEquals(anhangPfad('<x@y>', '', 1), 'x_y/1_anhang')
})

Deno.test('HTML ohne Stil- und Skriptblöcke', () => {
  const html = '<html><head><style>:root { --farbe: red } td { font-family: Arial }</style></head><body><!-- Kommentar --><p>Guten Tag &amp; danke</p><script>var x = 1</script></body></html>'
  assertEquals(textAusHtml(html), 'Guten Tag & danke')
})

Deno.test('Mail-Datum aus dem Date-Kopf, sonst Eingangszeit', () => {
  const jetzt = Date.parse('2026-11-22T19:05:11Z')
  assertEquals(mailDatum('Sun, 22 Nov 2026 19:04:43 +0000', jetzt), '2026-11-22T19:04:43.000Z')
  assertEquals(mailDatum('Fri, 20 Nov 2026 10:00:00 +0100 (CET)', jetzt), '2026-11-20T09:00:00.000Z')
  assertEquals(mailDatum(undefined, jetzt), new Date(jetzt).toISOString())
  assertEquals(mailDatum('kein Datum', jetzt), new Date(jetzt).toISOString())
  // In der Zukunft (Spam mit falscher Uhr): Eingangszeit.
  assertEquals(mailDatum('Mon, 01 Jan 2035 10:00:00 +0000', jetzt), new Date(jetzt).toISOString())
  assert(mailDatum('Sun, 22 Nov 2026 19:08:00 +0000', jetzt).startsWith('2026-11-22T19:08'))
})
