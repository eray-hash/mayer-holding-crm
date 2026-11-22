// Prüft Aufbau und Lesen der Direkt-Links in die Gesprächs-App (ohne Netz).
import { assertEquals } from 'jsr:@std/assert@1'
import { aufnehmenLink, gueltigeId, leseAufnehmenZiel } from './gespraechLink.ts'

const UUID = '3f2b8c1e-9a7d-4e6f-b1c2-0d9e8f7a6b5c'

Deno.test('Link bauen: Reihenfolge termin, kunde, objekt, art; leere Teile fallen weg', () => {
  assertEquals(aufnehmenLink('https://crm.test/', { termin: UUID }), `https://crm.test/gespraech/#/aufnehmen?termin=${UUID}`)
  assertEquals(aufnehmenLink('https://crm.test', { kunde: 'k_lehle', termin: UUID }), `https://crm.test/gespraech/#/aufnehmen?termin=${UUID}&kunde=k_lehle`)
  assertEquals(aufnehmenLink('https://crm.test/', { objekt: 'o_lager', art: 'telefon' }), 'https://crm.test/gespraech/#/aufnehmen?objekt=o_lager&art=telefon')
  assertEquals(aufnehmenLink('https://crm.test/', {}), 'https://crm.test/gespraech/#/aufnehmen')
  // Unbrauchbare Nummer wird nicht in den Link geschrieben.
  assertEquals(aufnehmenLink('https://crm.test/', { kunde: 'a&b=c' }), 'https://crm.test/gespraech/#/aufnehmen')
})

Deno.test('Link lesen: Hin und zurück', () => {
  const link = aufnehmenLink('https://crm.test/', { termin: UUID, kunde: 'k_lehle', art: 'termin' })
  const suche = link.slice(link.indexOf('?'))
  assertEquals(leseAufnehmenZiel(suche), { termin: UUID, kunde: 'k_lehle', art: 'termin' })
  assertEquals(leseAufnehmenZiel('objekt=o_lager&art=notiz'), { objekt: 'o_lager', art: 'notiz' })
  assertEquals(leseAufnehmenZiel('?art=TELEFON'), { art: 'telefon' })
})

Deno.test('Link lesen: kein Direkt-Link → null; fremde Teile werden ignoriert', () => {
  assertEquals(leseAufnehmenZiel(''), null)
  assertEquals(leseAufnehmenZiel(undefined), null)
  assertEquals(leseAufnehmenZiel('?'), null)
  assertEquals(leseAufnehmenZiel('?foo=bar'), null)
  assertEquals(leseAufnehmenZiel('?kunde=k_1&foo=bar'), { kunde: 'k_1' })
})

Deno.test('Link lesen: unbrauchbare Teile → weggelassen und vermerkt', () => {
  assertEquals(leseAufnehmenZiel('?kunde=%3Cscript%3E&art=termin'), { fehlerhaft: true, art: 'termin' })
  assertEquals(leseAufnehmenZiel('?termin=&art=video'), { fehlerhaft: true })
  assertEquals(leseAufnehmenZiel(`?termin=${UUID}&art=video`), { termin: UUID, fehlerhaft: true })
  assertEquals(gueltigeId(' k_1 '), 'k_1')
  assertEquals(gueltigeId('x'.repeat(101)), null)
  assertEquals(gueltigeId('a/b'), null)
})
