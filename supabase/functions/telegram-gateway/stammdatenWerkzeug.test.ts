// Prüft das Assistent-Werkzeug stammdaten_vorschlaege mit einer Datenbank im Speicher: Auflisten nach
// Bereichsrechten, Übernehmen (Feld, Verlauf, Status), Verwerfen, erledigte und unbekannte Vorschläge.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehreStammdatenWerkzeugAus, istStammdatenWerkzeug, type StammdatenKontext } from './stammdatenWerkzeug.ts'

// deno-lint-ignore no-explicit-any
type Lose = Record<string, any>

function vorschlag(id: string, feld: string, wert: string, bisher: string): Lose {
  return { id, feld, wert, bisher, mailDatum: '2026-11-12', mailId: 'e1', erstellt: '2026-11-22T10:00:00Z', status: 'offen' }
}

function db() {
  return falscheDatenbank({
    kunden: [
      { id: 'k_b', bereich: 'beratung', firma: 'Beispiel GmbH', telefon: '0731 111111', anschrift: 'Altweg 1\n89073 Ulm', email: 'eva@beispiel.de', activities: [{ id: 'alt', date: '2026-11-01', text: 'alt', user: 'x' }], stammdaten_vorschlaege: [vorschlag('sv_1', 'telefon', '0731 222222', '0731 111111'), vorschlag('sv_2', 'anschrift', 'Neuer Weg 7\n89077 Ulm', 'Altweg 1\n89073 Ulm')] },
      { id: 'k_f', bereich: 'finanzierungen', firma: 'Finanz AG', telefon: '1', anschrift: '', email: '', activities: [], stammdaten_vorschlaege: [vorschlag('sv_3', 'telefon', '0821 333333', '1')] },
      { id: 'k_p', bereich: 'privat', verantwortlich_email: 'quirin@x.de', firma: 'Privat', telefon: '', anschrift: '', email: '', activities: [], stammdaten_vorschlaege: [vorschlag('sv_4', 'telefon', '0821 444444', '')] },
    ],
  })
}

function kontext(d: ReturnType<typeof db>, m: Lose = { name: 'Quirin', email: 'quirin@x.de', rolle: 'mitarbeiter', bereiche: ['beratung'] }) {
  const protokoll: string[] = []
  const k: StammdatenKontext = { supabase: d, mitarbeiter: m as StammdatenKontext['mitarbeiter'], protokolliere: (t) => protokoll.push(t), heute: '2026-11-22' }
  return { k, protokoll }
}

Deno.test('Auflisten: nur Akten aus freigegebenen Bereichen, keine privaten', async () => {
  const d = db()
  const { k } = kontext(d)
  assert(istStammdatenWerkzeug('stammdaten_vorschlaege'))
  const text = await fuehreStammdatenWerkzeugAus('stammdaten_vorschlaege', {}, k)
  assertStringIncludes(text, 'sv_1 · Beispiel GmbH (k_b): Neue Telefonnummer aus Mail vom 12.11.2026: 0731 222222 (bisher: 0731 111111)')
  assertStringIncludes(text, 'Neue Anschrift aus Mail vom 12.11.2026: Neuer Weg 7, 89077 Ulm')
  assert(!text.includes('sv_3') && !text.includes('sv_4'))
  const gf = kontext(d, { name: 'Andreas', email: 'a@x.de', rolle: 'geschaeftsfuehrung' }).k
  const alle = await fuehreStammdatenWerkzeugAus('stammdaten_vorschlaege', { aktion: 'auflisten' }, gf)
  assert(alle.includes('sv_3') && !alle.includes('sv_4'))
  const fremd = await fuehreStammdatenWerkzeugAus('stammdaten_vorschlaege', { kunde_id: 'k_f' }, k)
  assert(fremd.startsWith('Fehler: '))
})

Deno.test('Übernehmen: Feld überschrieben, Verlauf vorn, Vorschlag erledigt; zweites Mal abgelehnt', async () => {
  const d = db()
  const { k, protokoll } = kontext(d)
  const text = await fuehreStammdatenWerkzeugAus('stammdaten_vorschlaege', { aktion: 'uebernehmen', id: 'sv_1' }, k)
  assertStringIncludes(text, 'Übernommen in Akte Beispiel GmbH (k_b): Telefon aus Mail vom 12.11.2026 übernommen von Quirin: 0731 222222 (bisher: 0731 111111)')
  const akte = d.tabelle('kunden').find((z) => z.id === 'k_b') as Lose
  assertEquals(akte.telefon, '0731 222222')
  assertEquals(akte.activities.length, 2)
  assertEquals(akte.activities[0].user, 'Quirin')
  assertEquals(akte.stammdaten_vorschlaege.map((v: Lose) => v.status), ['uebernommen', 'offen'])
  assertEquals(akte.stammdaten_vorschlaege[0].erledigtVon, 'Quirin')
  assertEquals(protokoll.length, 1)
  const nochmal = await fuehreStammdatenWerkzeugAus('stammdaten_vorschlaege', { aktion: 'uebernehmen', id: 'sv_1' }, k)
  assert(nochmal.startsWith('Fehler: '))
})

Deno.test('Verwerfen ändert nur den Vorschlag; fremde und unbekannte Vorschläge werden abgelehnt', async () => {
  const d = db()
  const { k } = kontext(d)
  const text = await fuehreStammdatenWerkzeugAus('stammdaten_vorschlaege', { aktion: 'verwerfen', id: 'sv_2' }, k)
  assertStringIncludes(text, 'Verworfen:')
  const akte = d.tabelle('kunden').find((z) => z.id === 'k_b') as Lose
  assertEquals(akte.anschrift, 'Altweg 1\n89073 Ulm')
  assertEquals(akte.activities.length, 1)
  assertEquals(akte.stammdaten_vorschlaege[1].status, 'verworfen')
  assert((await fuehreStammdatenWerkzeugAus('stammdaten_vorschlaege', { aktion: 'uebernehmen', id: 'sv_3' }, k)).startsWith('Fehler: '))
  assert((await fuehreStammdatenWerkzeugAus('stammdaten_vorschlaege', { aktion: 'uebernehmen', id: 'sv_4' }, k)).startsWith('Fehler: '))
  assert((await fuehreStammdatenWerkzeugAus('stammdaten_vorschlaege', { aktion: 'uebernehmen' }, k)).startsWith('Fehler: '))
  assert((await fuehreStammdatenWerkzeugAus('stammdaten_vorschlaege', { aktion: 'loeschen', id: 'sv_1' }, k)).startsWith('Fehler: '))
})
