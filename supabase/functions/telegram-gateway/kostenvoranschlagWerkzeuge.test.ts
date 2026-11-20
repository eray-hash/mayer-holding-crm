// Prüft die Nachbildung der Zeilenregeln für Kostenvoranschläge (ohne Datenbank).
import { assertEquals } from 'jsr:@std/assert@1'
import { darfKv, euro, zuordnungVon } from './kostenvoranschlagWerkzeuge.ts'

const gf = { name: 'GF', email: 'gf@x.de', rolle: 'geschaeftsfuehrung', bereiche: [] }
const ma = { name: 'MA', email: 'ma@x.de', rolle: 'mitarbeiter', bereiche: ['erben'] }
const hasan = { name: 'H', email: 'h@x.de', rolle: 'geschaeftsfuehrung', bereiche: [] }

Deno.test('ohne Bereich sehen alle', () => {
  assertEquals(darfKv(ma, { bereich: null, privat_besitzer: null }), true)
})
Deno.test('Bereich nur mit Recht', () => {
  assertEquals(darfKv(ma, { bereich: 'erben', privat_besitzer: null }), true)
  assertEquals(darfKv(ma, { bereich: 'beratung', privat_besitzer: null }), false)
  assertEquals(darfKv(gf, { bereich: 'beratung', privat_besitzer: null }), true)
})
Deno.test('privat nur Besitzer, auch nicht GF', () => {
  assertEquals(darfKv(hasan, { bereich: 'privat', privat_besitzer: 'H@x.de' }), true)
  assertEquals(darfKv(gf, { bereich: 'privat', privat_besitzer: 'h@x.de' }), false)
  assertEquals(darfKv(gf, { bereich: 'privat', privat_besitzer: null }), false)
})
Deno.test('Zuordnung übernimmt Bereich/Besitzer, Sammelakte ohne Bereich', () => {
  assertEquals(zuordnungVon({ id: 'k1', bereich: 'privat', firma: 'A', ansprechpartner: null, verantwortlich_email: ' H@x.de ' }), { kunde_id: 'k1', bereich: 'privat', privat_besitzer: 'h@x.de' })
  assertEquals(zuordnungVon({ id: 'k2', bereich: 'erben', firma: 'B', ansprechpartner: null, verantwortlich_email: 'x@y.de' }), { kunde_id: 'k2', bereich: 'erben', privat_besitzer: null })
  assertEquals(zuordnungVon({ id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: 'U', ansprechpartner: null, verantwortlich_email: null }).bereich, null)
  assertEquals(zuordnungVon(null), { kunde_id: null, bereich: null, privat_besitzer: null })
})
Deno.test('Euro deutsch', () => {
  assertEquals(euro(3850), '3.850 €')
})
