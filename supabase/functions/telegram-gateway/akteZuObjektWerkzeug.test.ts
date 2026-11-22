import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehreAkteZuObjektWerkzeugAus, istAkteZuObjektWerkzeug } from './akteZuObjektWerkzeug.ts'

const VORSCHAU = {
  umzugId: 'u_1',
  kundeId: 'k_hirsch',
  kundeName: 'Hotel Gasthof Hirsch Alfdorf (HD-IMMO, Helmut Dick)',
  status: 'vorschau',
  objektId: null,
  objektName: 'Hotel Gasthof Hirsch Alfdorf',
  neuesObjekt: true,
  eckdaten: { bezeichnung: 'Hotel Gasthof Hirsch Alfdorf', adresse: 'Untere Schloßstraße 46, 73553 Alfdorf', kaufpreis: 2980000, typ: 'Gewerbe', nichtOeffentlich: true, anbieter: { art: 'Makler', name: 'Helmut Dick', firma: 'HD-IMMO', telefon: '', email: '' }, eigentuemer: null },
  dublette: null,
  kandidaten: [{ id: 'o_remstal', name: 'Boarding House Remstal' }],
  ordnerZahlen: { 'Exposé': 2 },
  andereZiele: [{ id: 'o_remstal', name: 'Boarding House Remstal', anzahl: 96 }],
  bleiben: 4,
  doppelt: 4,
  dokumente: [],
  hinweise: ['96 Datei(en) gehören vermutlich zum schon vorhandenen Objekt „Boarding House Remstal“.'],
  erledigt: 0,
  gesamt: 102,
  fehler: [],
  behalten: false,
}

function kontext(m: Record<string, unknown>, antworten: Record<string, unknown>) {
  const aufrufe: Record<string, unknown>[] = []
  const protokoll: string[] = []
  const db = falscheDatenbank({ kunden: [{ id: 'k_hirsch', bereich: 'immobilienkunden', firma: 'Hotel Gasthof Hirsch Alfdorf (HD-IMMO, Helmut Dick)' }, { id: 'k_p', bereich: 'privat', firma: 'Privat', verantwortlich_email: 'a@x.de' }] })
  return {
    aufrufe,
    protokoll,
    k: {
      supabase: db,
      mitarbeiter: { name: 'Andreas Mayer', email: 'A@X.de', rolle: 'mitarbeiter', bereiche: ['immobilien'], ...m },
      protokolliere: (t: string) => void protokoll.push(t),
      heute: '2026-11-22',
      rufeEmailGateway: (action: string, body: Record<string, unknown>) => {
        aufrufe.push({ action, ...body })
        const a = antworten[String(body.modus)]
        if (a instanceof Error) return Promise.reject(a)
        return Promise.resolve(a)
      },
    },
  }
}

Deno.test('Vorschau ohne bestaetigt, Start mit bestaetigt', async () => {
  assert(istAkteZuObjektWerkzeug('akte_in_objekt_umwandeln'))
  const c = kontext({}, { stand: new Error('Diesen Umzug gibt es nicht'), vorschau: VORSCHAU, start: { ...VORSCHAU, status: 'laeuft', objektId: 'o_neu', erledigt: 0 } })
  const v = await fuehreAkteZuObjektWerkzeugAus('akte_in_objekt_umwandeln', { kunde_id: 'k_hirsch' }, c.k)
  assertMatch(v, /^Vorschau/)
  assertMatch(v, /Kaufpreis 2\.980\.000 €/)
  assertMatch(v, /„Boarding House Remstal“ \(objekt_id=o_remstal\): 96 Datei/)
  assertMatch(v, /umzug_id=u_1/)
  assertEquals(c.aufrufe.map((a) => a.modus), ['stand', 'vorschau'])
  assertEquals(c.aufrufe[1].imAuftragVon, 'a@x.de')

  const s = await fuehreAkteZuObjektWerkzeugAus('akte_in_objekt_umwandeln', { kunde_id: 'k_hirsch', bestaetigt: true, kaufpreis: '2,9 Mio', adresse: ' Untere Schloßstraße 46, 73553 Alfdorf ' }, c.k)
  assertMatch(s, /^Gestartet: neue Objektakte „Hotel Gasthof Hirsch Alfdorf“ \(objekt_id=o_neu\)/)
  const start = c.aufrufe.find((a) => a.modus === 'start')!
  assertEquals(start.umzug_id, 'u_1')
  assertEquals(start.quelle, 'telegram')
  assertEquals(start.eckdaten, { adresse: 'Untere Schloßstraße 46, 73553 Alfdorf', kaufpreis: '2,9 Mio' })
  assertEquals(c.protokoll.length, 1)
})

Deno.test('Laufender Umzug: Stand statt neuer Vorschau', async () => {
  const c = kontext({}, { stand: { ...VORSCHAU, status: 'laeuft', objektId: 'o_neu', erledigt: 40 } })
  const r = await fuehreAkteZuObjektWerkzeugAus('akte_in_objekt_umwandeln', { kunde_id: 'k_hirsch', bestaetigt: true }, c.k)
  assertMatch(r, /^Läuft: .* 40 von 102 Dateien/)
  assertEquals(c.aufrufe.length, 1)
})

Deno.test('Rechte: privater Assistent, ohne Immobilien, private Akte, Fehler vom Server', async () => {
  const privat = await fuehreAkteZuObjektWerkzeugAus('akte_in_objekt_umwandeln', { kunde_id: 'k_hirsch' }, kontext({ nurPrivat: true }, {}).k)
  assertMatch(privat, /^Fehler: Im privaten Assistenten/)
  const ohne = await fuehreAkteZuObjektWerkzeugAus('akte_in_objekt_umwandeln', { kunde_id: 'k_hirsch' }, kontext({ bereiche: ['beratung'] }, {}).k)
  assertMatch(ohne, /nicht freigegeben/i)
  const pa = await fuehreAkteZuObjektWerkzeugAus('akte_in_objekt_umwandeln', { kunde_id: 'k_p' }, kontext({}, {}).k)
  assertMatch(pa, /^Fehler: Private Kontakte/)
  const fehlt = await fuehreAkteZuObjektWerkzeugAus('akte_in_objekt_umwandeln', { kunde_id: 'k_x' }, kontext({}, {}).k)
  assertMatch(fehlt, /^Fehler: Es gibt keine Kundenakte/)
  const server = await fuehreAkteZuObjektWerkzeugAus('akte_in_objekt_umwandeln', { kunde_id: 'k_hirsch', bestaetigt: true }, kontext({}, { stand: new Error('x'), vorschau: VORSCHAU, start: new Error('Es gibt schon eine Objektakte, die passt: „X“') }).k)
  assertMatch(server, /^Fehler: Es gibt schon eine Objektakte/)
})
