import { assert, assertEquals } from 'jsr:@std/assert@1'
import { berechneTreffer, trefferNachricht, type KundenZeile, type ObjektZeile } from './gesuchTreffer.ts'

// Ein Gesuch, das auf jedes Haus in Ulm passt.
const gesuch = (id: string) => ({ id, titel: `Gesuch ${id}`, objekttypen: ['Haus'], lage: 'Ulm' })
const objekt = (id: string, privat_besitzer: string | null = null): ObjektZeile => ({ id, bezeichnung: `Objekt ${id}`, adresse: 'Hauptstraße 1, Ulm', typ: 'Haus', status: 'aktiv', privat_besitzer })

const mayerKunde: KundenZeile = { id: 'k_mayer', bereich: 'immobilienkunden', firma: 'Mayer-Kunde', gesuche: [gesuch('g_mayer')] }
const privatA: KundenZeile = { id: 'k_pa', bereich: 'privat', privat_art: 'immobilienkunden', verantwortlich_email: 'Anna@Beispiel.de', firma: 'Privat A', gesuche: [gesuch('g_pa')] }
const privatB: KundenZeile = { id: 'k_pb', bereich: 'privat', privat_art: 'immobilienkunden', verantwortlich_email: 'bernd@beispiel.de', firma: 'Privat B', gesuche: [gesuch('g_pb')] }

const objekte = [objekt('o_mayer'), objekt('o_a', 'anna@beispiel.de'), objekt('o_b', 'BERND@beispiel.de')]

function paare(kunden: KundenZeile[]) {
  return berechneTreffer(kunden, objekte)
    .map((t) => `${t.gesuchId}>${t.objektId}${t.besitzer ? `@${t.besitzer}` : ''}`)
    .sort()
}

Deno.test('Mayer-Gesuche treffen nur Mayer-Objekte', () => {
  assertEquals(paare([mayerKunde]), ['g_mayer>o_mayer'])
})

Deno.test('Private Gesuche treffen nur private Objekte desselben Besitzers', () => {
  assertEquals(paare([privatA, privatB]), ['g_pa>o_a@anna@beispiel.de', 'g_pb>o_b@bernd@beispiel.de'])
})

Deno.test('Alles zusammen: keine Überkreuzung zwischen Mayer und Privat', () => {
  assertEquals(paare([mayerKunde, privatA, privatB]), ['g_mayer>o_mayer', 'g_pa>o_a@anna@beispiel.de', 'g_pb>o_b@bernd@beispiel.de'])
})

Deno.test('Private Kontakte ohne Immobilien-Ablauf oder ohne Besitzer suchen nicht', () => {
  const ohneArt: KundenZeile = { ...privatA, id: 'k_x', privat_art: 'beratung', gesuche: [gesuch('g_x')] }
  const ohneBesitzer: KundenZeile = { ...privatA, id: 'k_y', verantwortlich_email: null, gesuche: [gesuch('g_y')] }
  assertEquals(paare([ohneArt, ohneBesitzer]), [])
})

Deno.test('Mayer-Treffer tragen keinen Besitzer', () => {
  const [t] = berechneTreffer([mayerKunde], objekte)
  assert(t)
  assertEquals(t.besitzer, undefined)
})

Deno.test('Nachricht für private Treffer verweist auf den Bereich Privat', () => {
  const [t] = berechneTreffer([privatA], objekte)
  const text = trefferNachricht([{ treffer: t, anlass: 'neu' }], true)
  assert(text.startsWith('Neuer Treffer zu deinen privaten Gesuchen:'))
  assert(text.includes('Bereich Privat'))
  assert(!text.includes('Immobilienabteilung'))
})
