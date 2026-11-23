// Prüft kunde_bereich_wechseln mit einer Datenbank im Speicher (ohne Netz): erst Rückfrage, nach Bestätigung zieht
// alles mit, was den Bereich der Akte trägt — auch die neueren Tabellen, deren Zeilenregel am Bereich hängt.
import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehrePflegeWerkzeugAus, type PflegeAnfrage, type PflegeKontext } from './pflegeWerkzeuge.ts'

const GF = { name: 'Andreas Mayer', email: 'andreas@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }

function datenbank() {
  const db = falscheDatenbank({
    kunden: [{ id: 'k_mueller', bereich: 'beratung', firma: 'Müller GmbH', ansprechpartner: 'Hans Müller', status: 'erstgespraech', activities: [], dokumente: [], verknuepfte_kunden: null, pruef_hinweis: null }],
    kostenvoranschlaege: [{ id: 'kv1', kunde_id: 'k_mueller', bereich: 'beratung' }, { id: 'kv2', kunde_id: 'k_andere', bereich: 'beratung' }],
    unterschrift_anfragen: [{ id: 'u1', kunde_id: 'k_mueller', bereich: 'beratung' }],
    willkommen_nachrichten: [{ id: 'w1', kunde_id: 'k_mueller', bereich: 'beratung' }],
    kundenbericht_einstellung: [{ id: 'k_mueller', kunde_id: 'k_mueller', bereich: 'beratung' }],
    kunden_portal_zugaenge: [{ id: 'p1', kunde_id: 'k_mueller', kunde_bereich: 'beratung' }],
    kontoauszug_auswertungen: [{ id: 'ka1', kunde_id: 'k_mueller', bereich: 'beratung' }],
    rechnung_vorschlaege: [{ id: 'rv1', kunde_id: 'k_mueller', kunde_bereich: 'beratung' }],
    mahn_vorschlaege: [{ id: 'mv1', kunde_id: 'k_mueller', kunde_bereich: 'beratung' }],
    termine: [{ id: 't1', kunde_id: 'k_mueller', kunde_bereich: 'beratung' }],
  })
  // Die Testdatenbank kennt .not() nicht: "nicht leer" = ungleich einem Wert, den es nie gibt.
  const from = db.from.bind(db)
  // deno-lint-ignore no-explicit-any
  ;(db as any).from = (t: string) => {
    // deno-lint-ignore no-explicit-any
    const q: any = from(t)
    q.not = (s: string, op: string, w: unknown) => (op === 'is' && w === null ? q.neq(s, '\u0000') : q)
    return q
  }
  return db
}

function kontext(db: ReturnType<typeof datenbank>, vorherige?: PflegeAnfrage): PflegeKontext & { gemerkt: PflegeAnfrage[] } {
  const gemerkt: PflegeAnfrage[] = []
  return {
    supabase: db,
    mitarbeiter: GF,
    vorherige,
    merkeAnfrage: (a) => gemerkt.push(a),
    protokolliere: () => {},
    heute: '2026-11-23',
    statusJeBereich: { beratung: { erstgespraech: 'Erstgespräch' }, erben: { erstgespraech: 'Erstgespräch' } },
    startStatus: { beratung: 'erstgespraech', erben: 'erstgespraech' },
    gemerkt,
  }
}

Deno.test('Bereich wechseln: erst Rückfrage, nach Bestätigung ziehen alle Tabellen mit Bereich der Akte mit um', async () => {
  const db = datenbank()
  const k1 = kontext(db)
  assertMatch(await fuehrePflegeWerkzeugAus('kunde_bereich_wechseln', { kunde_id: 'k_mueller', nach_bereich: 'erben' }, k1), /^NOCH NICHT VERSCHOBEN/)
  assertEquals(db.tabellen.kunden[0].bereich, 'beratung')

  const r = await fuehrePflegeWerkzeugAus('kunde_bereich_wechseln', { kunde_id: 'k_mueller', nach_bereich: 'erben' }, kontext(db, k1.gemerkt[0]))
  assertMatch(r, /^Verschoben: Müller GmbH \(Hans Müller\) liegt jetzt im Bereich Erben\.$/)
  assertEquals(db.tabellen.kunden[0].bereich, 'erben')
  for (const t of ['kostenvoranschlaege', 'unterschrift_anfragen', 'willkommen_nachrichten', 'kundenbericht_einstellung', 'kontoauszug_auswertungen']) {
    assertEquals(db.tabellen[t].filter((z) => z.kunde_id === 'k_mueller').map((z) => z.bereich), ['erben'], t)
  }
  for (const t of ['kunden_portal_zugaenge', 'rechnung_vorschlaege', 'mahn_vorschlaege', 'termine']) {
    assertEquals(db.tabellen[t].map((z) => z.kunde_bereich), ['erben'], t)
  }
  // Zeilen anderer Akten bleiben unberührt.
  assertEquals(db.tabellen.kostenvoranschlaege.find((z) => z.id === 'kv2')!.bereich, 'beratung')
})
