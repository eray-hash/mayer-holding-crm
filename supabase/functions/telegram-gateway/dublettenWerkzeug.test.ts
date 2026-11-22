// Tests für dubletten_finden: Liste mit IDs und Gründen, nur lesen, Bereichsrechte, Objekte nur mit Immobilien.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { fuehreDublettenWerkzeugAus, istDublettenWerkzeug } from './dublettenWerkzeug.ts'

const GF = { name: 'Bernd', email: 'bernd@firma.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }
const CARL = { name: 'Carl', email: 'carl@firma.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }

function daten(): Record<string, Zeile[]> {
  return {
    kunden: [
      { id: 'k1', bereich: 'beratung', firma: 'Muster GmbH', email: 'max@muster.de', telefon: '0731 111111' },
      { id: 'k2', bereich: 'beratung', firma: 'Muster', email: 'max@muster.de', telefon: '' },
      { id: 'k3', bereich: 'erben', firma: 'Muster GmbH', email: 'max@muster.de' },
      { id: 'k4', bereich: 'erben', firma: 'Erbe Eins', telefon: '0049-163-6058' },
      { id: 'k5', bereich: 'erben', firma: 'Erbe Zwei', telefon: '0049-163-6058100' },
      { id: 'k6', bereich: 'privat', firma: 'Muster GmbH', email: 'max@muster.de', verantwortlich_email: 'carl@firma.de' },
    ],
    objekte: [
      { id: 'o1', bezeichnung: 'MFH Weststadt', adresse: 'Söflinger Str. 100, 89077 Ulm' },
      { id: 'o2', bezeichnung: 'Mehrfamilienhaus', adresse: 'Söflinger Straße 100, 89077 Ulm' },
    ],
    dubletten_ausnahmen: [],
  }
}

async function rufe(db: ReturnType<typeof falscheDatenbank>, m: Zeile, input: Zeile): Promise<string> {
  return await fuehreDublettenWerkzeugAus('dubletten_finden', input, { supabase: db, mitarbeiter: m as never, protokolliere: () => {}, heute: '2026-11-22' })
}

Deno.test('Geschäftsführung: Akten- und Objekt-Dubletten mit IDs, Gründen und dem Hinweis auf verschiedene Bereiche', async () => {
  assert(istDublettenWerkzeug('dubletten_finden'))
  const db = falscheDatenbank(daten())
  const text = await rufe(db, GF, {})
  assertStringIncludes(text, 'Mögliche doppelte Kundenakten: 2 Gruppe(n), davon 1 über verschiedene Bereiche')
  assertStringIncludes(text, 'kunde_id=k1')
  assertStringIncludes(text, 'kunde_id=k3')
  assertStringIncludes(text, 'kunde_bereich_wechseln')
  assertStringIncludes(text, 'Telefonnummer gleich bis auf fehlende Endziffern')
  assertStringIncludes(text, 'objekt_id=o1')
  assert(!text.includes('k6'))
  // nur lesen
  assert(db.protokoll.every((p) => p.art === 'select'))
})

Deno.test('Mitarbeiter mit Beratung: nur eigene Bereiche, keine Objekte; Filter nach Akte', async () => {
  const db = falscheDatenbank(daten())
  const text = await rufe(db, CARL, {})
  assertStringIncludes(text, 'Mögliche doppelte Kundenakten: 1 Gruppe(n).')
  assert(!text.includes('k3') && !text.includes('k4') && !text.includes('objekt_id'))
  assertStringIncludes(text, 'Zusammenführen kann nur die Geschäftsführung.')
  assertStringIncludes(await rufe(db, CARL, { art: 'objekte' }), 'nicht freigegeben')
  assertStringIncludes(await rufe(db, GF, { kunde_id: 'k4', art: 'kunden' }), 'kunde_id=k5')
  assertEquals((await rufe(db, GF, { kunde_id: 'k_gibtsnicht', art: 'kunden' })).split('\n')[0], 'Zu dieser Akte gibt es keine mögliche Dublette.')
})
