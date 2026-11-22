// Prüft das Werkzeug objekt_luecken mit der Testdatenbank (ohne Netz): ein Objekt ausführlich, „meine“
// Objekte, Kollegen, Rechte (Bereich Immobilien, private Objekte, privater Assistent) und den Schalter
// für den Wochenhinweis.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehreLueckenWerkzeugAus, istLueckenWerkzeug, type LueckenKontext } from './objektLueckenWerkzeug.ts'

const QUIRIN = { name: 'Quirin Lutzenberger', email: 'quirin@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }
const ANDREAS = { name: 'Andreas Mayer', email: 'andreas@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }
const OHNE = { name: 'Petra Ohne', email: 'petra@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }

const bilder = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `f${i}.jpg`, typ: 'image/jpeg' }))

function daten() {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', ...QUIRIN, aktiv: true },
      { id: 'm2', ...ANDREAS, aktiv: true },
      { id: 'm3', ...OHNE, aktiv: true },
    ],
    objekte: [
      { id: 'o_lorch', bezeichnung: 'MFH Lorch', status: 'vermarktung', typ: 'Haus', kaufpreis: 0, adresse: 'Teckstraße 62, 73547 Lorch', verantwortlich: 'Quirin', dokumente: { Bilder: bilder(2) }, bilder_reihenfolge: [], anfrage_kennungen: null, interessenten_dokumente: null, off_market: false, privat_besitzer: null },
      { id: 'o_geis', bezeichnung: 'Geislingen', status: 'akquise', typ: 'Haus', kaufpreis: 0, adresse: 'Geislingen', verantwortlich: 'Quirin Lutzenberger', dokumente: {}, privat_besitzer: null },
      { id: 'o_ulm', bezeichnung: 'Büro Ulm', status: 'vorbereitung', typ: 'Gewerbe', kaufpreis: 500000, adresse: 'Schwabstr. 3, 89075 Ulm', verantwortlich: 'Andreas Mayer', dokumente: {}, privat_besitzer: null },
      { id: 'o_alt', bezeichnung: 'Altbau verkauft', status: 'archiv', typ: 'Haus', kaufpreis: 0, adresse: '', verantwortlich: 'Quirin', dokumente: {}, privat_besitzer: null },
      { id: 'o_priv', bezeichnung: 'Privat Wohnung', status: 'akquise', typ: 'Wohnung', kaufpreis: 0, adresse: '', verantwortlich: 'Andreas Mayer', dokumente: {}, privat_besitzer: 'andreas@mayer.de' },
    ],
  })
}

function kontext(db: ReturnType<typeof daten>, m: Record<string, unknown>): LueckenKontext & { protokoll: string[] } {
  const protokoll: string[] = []
  return { supabase: db, mitarbeiter: m as LueckenKontext['mitarbeiter'], protokolliere: (t) => protokoll.push(t), heute: '2026-11-23', protokoll }
}

Deno.test('Werkzeugname', () => {
  assert(istLueckenWerkzeug('objekt_luecken'))
  assert(!istLueckenWerkzeug('objekt_aendern'))
})

Deno.test('ein Objekt: Prozent, fehlende Punkte mit Hinweis', async () => {
  const t = await fuehreLueckenWerkzeugAus('objekt_luecken', { objekt_id: 'o_lorch' }, kontext(daten(), QUIRIN))
  assertStringIncludes(t, 'MFH Lorch (objekt_id=o_lorch)')
  assertStringIncludes(t, 'Aktiv in Vermarktung')
  assertStringIncludes(t, 'Kaufpreis (kein Kaufpreis)')
  assertStringIncludes(t, 'Mindestens 5 Fotos (2 von 5 Fotos)')
  assertStringIncludes(t, 'Nummern des Inserats')
  assertStringIncludes(t, 'Per Assistent:')
  const archiv = await fuehreLueckenWerkzeugAus('objekt_luecken', { objekt_id: 'o_alt' }, kontext(daten(), QUIRIN))
  assertStringIncludes(archiv, 'nicht mehr auf Vollständigkeit geprüft')
})

Deno.test('meine Objekte: nur eigene, Archiv nicht, Vermarktung zuerst', async () => {
  const t = await fuehreLueckenWerkzeugAus('objekt_luecken', {}, kontext(daten(), QUIRIN))
  assertStringIncludes(t, 'deine Objekte')
  assert(t.indexOf('MFH Lorch') < t.indexOf('Geislingen'))
  assert(!t.includes('Büro Ulm'))
  assert(!t.includes('Altbau'))
  const aktiv = await fuehreLueckenWerkzeugAus('objekt_luecken', { nur_aktive: true }, kontext(daten(), QUIRIN))
  assert(aktiv.includes('MFH Lorch') && !aktiv.includes('Geislingen'))
})

Deno.test('Kollege und alle; private Objekte nur für den Besitzer', async () => {
  const quirinFragtAndreas = await fuehreLueckenWerkzeugAus('objekt_luecken', { wer: 'Andreas' }, kontext(daten(), QUIRIN))
  assertStringIncludes(quirinFragtAndreas, 'Büro Ulm')
  assert(!quirinFragtAndreas.includes('Privat Wohnung'))
  const andreasMeine = await fuehreLueckenWerkzeugAus('objekt_luecken', { wer: 'ich' }, kontext(daten(), ANDREAS))
  assert(andreasMeine.includes('Privat Wohnung') && andreasMeine.includes('Büro Ulm'))
  const alle = await fuehreLueckenWerkzeugAus('objekt_luecken', { wer: 'alle' }, kontext(daten(), QUIRIN))
  assert(alle.includes('MFH Lorch') && alle.includes('Büro Ulm') && !alle.includes('Privat Wohnung'))
  const fremd = await fuehreLueckenWerkzeugAus('objekt_luecken', { objekt_id: 'o_priv' }, kontext(daten(), QUIRIN))
  assert(fremd.startsWith('Fehler: Es gibt kein Objekt'))
  const unbekannt = await fuehreLueckenWerkzeugAus('objekt_luecken', { wer: 'Niemand' }, kontext(daten(), QUIRIN))
  assert(unbekannt.startsWith('Fehler:'))
})

Deno.test('ohne Immobilien-Rechte: nicht freigegeben; privater Assistent nur eigene private', async () => {
  const t = await fuehreLueckenWerkzeugAus('objekt_luecken', {}, kontext(daten(), OHNE))
  assert(t.startsWith('Nicht freigegeben'))
  const einzeln = await fuehreLueckenWerkzeugAus('objekt_luecken', { objekt_id: 'o_lorch' }, kontext(daten(), OHNE))
  assert(einzeln.startsWith('Nicht freigegeben'))
  const privat = await fuehreLueckenWerkzeugAus('objekt_luecken', { wer: 'alle' }, kontext(daten(), { ...ANDREAS, nurPrivat: true }))
  assert(privat.includes('Privat Wohnung') && !privat.includes('Büro Ulm'))
  // Private Objekte haben kein Interessenten-Portal
  const p = await fuehreLueckenWerkzeugAus('objekt_luecken', { objekt_id: 'o_priv' }, kontext(daten(), ANDREAS))
  assert(!p.includes('Interessenten-Portal“: Unterlagen ankreuzen'))
})

Deno.test('Wochenhinweis an- und abschalten', async () => {
  const db = daten()
  const k = kontext(db, QUIRIN)
  const aus = await fuehreLueckenWerkzeugAus('objekt_luecken', { wochenhinweis: false }, k)
  assertStringIncludes(aus, 'Wochenhinweis ist aus')
  const zeilen = db.tabelle('objekt_luecken_hinweis')
  assertEquals(zeilen.length, 1)
  assertEquals(zeilen[0].email, 'quirin@mayer.de')
  assertEquals(zeilen[0].aktiv, false)
  await fuehreLueckenWerkzeugAus('objekt_luecken', { wochenhinweis: true }, k)
  assertEquals(db.tabelle('objekt_luecken_hinweis').length, 1)
  assertEquals(db.tabelle('objekt_luecken_hinweis')[0].aktiv, true)
  assertEquals(k.protokoll.length, 2)
})
