// Prüft die Wiedervorlage-Werkzeuge mit einer nachgebauten Datenbank (ohne Netz): Rechte je Bereich,
// private Akten, Filter und Sortierung der Liste, Felder beim Anlegen, Erledigen und Verschieben.
import { assert, assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import { darfWv, fuehreWvWerkzeugAus, pruefeDatum, type WvKontext } from './wiedervorlageWerkzeuge.ts'
import { aufgabenUebersicht } from './aufgaben.ts'

// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

/** Kleine Nachbildung des Supabase-Abfrageaufbaus: select/eq/is/in/lte/order/limit/maybeSingle/single, insert/update. */
function falscheDb(tabellen: Record<string, Zeile[]>) {
  const geschrieben: { tabelle: string; art: 'insert' | 'update'; werte: Zeile; id?: string }[] = []
  function abfrage(tabelle: string) {
    const filter: ((z: Zeile) => boolean)[] = []
    let sortierung: { spalte: string; auf: boolean } | null = null
    let grenze = Infinity
    let art: 'select' | 'insert' | 'update' = 'select'
    let werte: Zeile = {}
    let einzeln: 'maybe' | 'single' | null = null
    const ausfuehren = () => {
      const zeilen = tabellen[tabelle] ?? (tabellen[tabelle] = [])
      if (art === 'insert') {
        const neu = { id: `wv_test${zeilen.length + 1}`, erledigt_am: null, ...werte }
        zeilen.push(neu)
        geschrieben.push({ tabelle, art, werte })
        return { data: einzeln ? neu : [neu], error: null }
      }
      let treffer = zeilen.filter((z) => filter.every((f) => f(z)))
      if (art === 'update') {
        for (const z of treffer) Object.assign(z, werte)
        geschrieben.push({ tabelle, art, werte, id: treffer[0]?.id })
        return { data: null, error: null }
      }
      if (sortierung) {
        const { spalte, auf } = sortierung
        treffer = [...treffer].sort((a, b) => String(a[spalte]).localeCompare(String(b[spalte])) * (auf ? 1 : -1))
      }
      // Wie die echte Datenbank: Kopien, keine Verweise auf die gespeicherten Zeilen.
      treffer = treffer.slice(0, grenze).map((z) => ({ ...z }))
      if (einzeln) return { data: treffer[0] ?? null, error: null }
      return { data: treffer, error: null }
    }
    const q = {
      select: () => q,
      insert: (w: Zeile) => ((art = 'insert'), (werte = w), q),
      update: (w: Zeile) => ((art = 'update'), (werte = w), q),
      eq: (s: string, v: unknown) => (filter.push((z) => z[s] === v), q),
      is: (s: string, v: unknown) => (filter.push((z) => (z[s] ?? null) === v), q),
      in: (s: string, v: unknown[]) => (filter.push((z) => v.includes(z[s])), q),
      lte: (s: string, v: string) => (filter.push((z) => String(z[s]) <= v), q),
      order: (spalte: string, o?: { ascending?: boolean }) => ((sortierung = { spalte, auf: o?.ascending !== false }), q),
      limit: (n: number) => ((grenze = n), q),
      maybeSingle: () => ((einzeln = 'maybe'), q),
      single: () => ((einzeln = 'single'), q),
      // deno-lint-ignore no-explicit-any
      then: (ok: (r: any) => unknown, nein?: (e: unknown) => unknown) => Promise.resolve(ausfuehren()).then(ok, nein),
    }
    return q
  }
  return { supabase: { from: abfrage }, geschrieben, tabellen }
}

const HEUTE = '2026-11-20'

function grunddaten(): Record<string, Zeile[]> {
  return {
    kunden: [
      { id: 'k_erb', bereich: 'erben', firma: 'Familie Huber', ansprechpartner: 'Anna Huber', verantwortlich: 'Quirin Lang', verantwortlich_email: 'q@x.de' },
      { id: 'k_ber', bereich: 'beratung', firma: 'Bäckerei Maier', ansprechpartner: null, verantwortlich: 'Hasan Süslü', verantwortlich_email: 'h@x.de' },
      { id: 'k_priv', bereich: 'privat', firma: 'Privatkontakt', ansprechpartner: null, verantwortlich: 'MA', verantwortlich_email: 'ma@x.de' },
      { id: 'k_priv_fremd', bereich: 'privat', firma: 'Fremd privat', ansprechpartner: null, verantwortlich: 'GF', verantwortlich_email: 'gf@x.de' },
      { id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: 'Ungeklärte Eingänge', ansprechpartner: null, verantwortlich: null, verantwortlich_email: null },
    ],
    mitarbeiter: [
      { name: 'Quirin Lang', aktiv: true },
      { name: 'Hasan Süslü', aktiv: true },
      { name: 'MA Test', aktiv: true },
    ],
    wiedervorlagen: [
      { id: 'wv_spaet', kunde_id: 'k_erb', bereich: 'erben', regel: null, titel: 'Später', notiz: null, faellig: '2026-12-15', verantwortlich: 'Quirin Lang', quelle: 'hand', erledigt_am: null },
      { id: 'wv_woche', kunde_id: 'k_erb', bereich: 'erben', regel: 'r1', titel: 'Unterlagen nachfassen', notiz: null, faellig: '2026-11-24', verantwortlich: 'Quirin Lang', quelle: 'regel', erledigt_am: null },
      { id: 'wv_ueber', kunde_id: 'k_erb', bereich: 'erben', regel: null, titel: 'Anrufen', notiz: 'dringend', faellig: '2026-11-10', verantwortlich: 'Hasan Süslü', quelle: 'hand', erledigt_am: null },
      { id: 'wv_heute', kunde_id: 'k_erb', bereich: 'erben', regel: null, titel: 'Heute dran', notiz: null, faellig: HEUTE, verantwortlich: 'Quirin Lang', quelle: 'hand', erledigt_am: null },
      { id: 'wv_erledigt', kunde_id: 'k_erb', bereich: 'erben', regel: null, titel: 'Schon erledigt', notiz: null, faellig: '2026-11-11', verantwortlich: 'Quirin Lang', quelle: 'hand', erledigt_am: '2026-11-12T10:00:00Z' },
      { id: 'wv_beratung', kunde_id: 'k_ber', bereich: 'beratung', regel: null, titel: 'Geheime Beratung', notiz: null, faellig: '2026-11-19', verantwortlich: 'Hasan Süslü', quelle: 'hand', erledigt_am: null },
    ],
  }
}

const ma = { name: 'MA Test', email: 'ma@x.de', rolle: 'mitarbeiter', bereiche: ['erben'] }
const gf = { name: 'GF', email: 'gf@x.de', rolle: 'geschaeftsfuehrung', bereiche: [] }

function kontext(m: WvKontext['mitarbeiter'], db = falscheDb(grunddaten())) {
  const protokoll: string[] = []
  const k: WvKontext = { supabase: db.supabase, mitarbeiter: m, protokolliere: (t) => protokoll.push(t), heute: HEUTE }
  return { k, db, protokoll }
}

Deno.test('darfWv: nur freigegebene Bereiche, privat nie', () => {
  assertEquals(darfWv(ma, { bereich: 'erben' }), true)
  assertEquals(darfWv(ma, { bereich: 'beratung' }), false)
  assertEquals(darfWv(gf, { bereich: 'beratung' }), true)
  assertEquals(darfWv(gf, { bereich: 'privat' }), false)
  assertEquals(darfWv({ ...gf, nurPrivat: true }, { bereich: 'erben' }), false)
})

Deno.test('pruefeDatum: nur echte Tage', () => {
  assertEquals(pruefeDatum('2026-11-27'), '2026-11-27')
  assertEquals(pruefeDatum('27.11.2026'), '2026-11-27')
  assertEquals(pruefeDatum('2026-02-30'), undefined)
  assertEquals(pruefeDatum('Freitag'), undefined)
})

Deno.test('auflisten: Vorgabe 7 Tage, Überfälliges zuerst, ohne Erledigtes und ohne fremde Bereiche', async () => {
  const { k } = kontext(ma)
  const text = await fuehreWvWerkzeugAus('wiedervorlagen_auflisten', {}, k)
  const zeilen = text.split('\n').filter((z) => z.startsWith('- '))
  assertEquals(zeilen.map((z) => z.match(/id=(\w+)/)?.[1]), ['wv_ueber', 'wv_heute', 'wv_woche'])
  assertStringIncludes(zeilen[0], '10.11.2026 (überfällig)')
  assertStringIncludes(zeilen[1], '(heute)')
  assertStringIncludes(zeilen[2], 'automatisch')
  assertStringIncludes(zeilen[2], 'Akte: Familie Huber (Anna Huber)')
  assert(!text.includes('Geheime Beratung'))
  assert(!text.includes('Schon erledigt'))
  assert(!text.includes('Später'))
})

Deno.test('auflisten: nur_faellig, zustaendig und tage', async () => {
  const { k } = kontext(gf)
  const faellig = await fuehreWvWerkzeugAus('wiedervorlagen_auflisten', { nur_faellig: true }, k)
  assertEquals((faellig.match(/id=\w+/g) ?? []).sort(), ['id=wv_beratung', 'id=wv_heute', 'id=wv_ueber'])
  const quirin = await fuehreWvWerkzeugAus('wiedervorlagen_auflisten', { zustaendig: 'Quirin', tage: 60 }, k)
  assertEquals(quirin.match(/id=\w+/g), ['id=wv_heute', 'id=wv_woche', 'id=wv_spaet'])
  assertStringIncludes(quirin, 'zuständig: Quirin Lang')
})

Deno.test('auflisten: mit Akte ohne tage alle offenen der Akte; fremder Bereich abgelehnt; privat ohne Wiedervorlagen', async () => {
  const { k } = kontext(ma)
  const akte = await fuehreWvWerkzeugAus('wiedervorlagen_auflisten', { kunde_id: 'k_erb' }, k)
  assertEquals(akte.match(/id=\w+/g)?.length, 4)
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlagen_auflisten', { kunde_id: 'k_ber' }, k), 'Nicht freigegeben')
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlagen_auflisten', { kunde_id: 'k_priv' }, k), 'Private Kontakte haben keine Wiedervorlagen')
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlagen_auflisten', { kunde_id: 'k_priv_fremd' }, k), 'gibt es für dich nicht')
})

Deno.test('anlegen: Felder aus der Akte, quelle hand, erstellt_von', async () => {
  const { k, db, protokoll } = kontext(ma)
  const text = await fuehreWvWerkzeugAus('wiedervorlage_anlegen', { kunde_id: 'k_erb', titel: '  Wegen   Testament nachfassen ', faellig: '2026-11-27', notiz: 'Notar fragen' }, k)
  assertStringIncludes(text, 'Angelegt')
  assertStringIncludes(text, '27.11.2026')
  const w = db.geschrieben.find((g) => g.art === 'insert')!.werte
  assertEquals(w, {
    kunde_id: 'k_erb',
    bereich: 'erben',
    titel: 'Wegen Testament nachfassen',
    faellig: '2026-11-27',
    notiz: 'Notar fragen',
    verantwortlich: 'Quirin Lang',
    quelle: 'hand',
    erstellt_von: 'MA Test',
  })
  assertEquals(protokoll.length, 1)
})

Deno.test('anlegen: abgelehnt bei fremdem Bereich, privat, Sammelakte, falschem Datum', async () => {
  const { k, db } = kontext(ma)
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_anlegen', { kunde_id: 'k_ber', titel: 'X', faellig: '2026-11-27' }, k), 'Nicht freigegeben')
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_anlegen', { kunde_id: 'k_priv', titel: 'X', faellig: '2026-11-27' }, k), 'Private Kontakte haben keine Wiedervorlagen')
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_anlegen', { kunde_id: 'k_priv_fremd', titel: 'X', faellig: '2026-11-27' }, k), 'gibt es für dich nicht')
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_anlegen', { kunde_id: 'k_eingang_ungeklaert', titel: 'X', faellig: '2026-11-27' }, k), 'Sammelakten')
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_anlegen', { kunde_id: 'k_erb', titel: 'X', faellig: 'nächste Woche' }, k), 'kein gültiges Datum')
  assertEquals(db.geschrieben.length, 0)
})

Deno.test('erledigen und verschieben: Rechte über den Bereich der Zeile', async () => {
  const { k, db } = kontext(ma)
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_erledigen', { id: 'wv_beratung' }, k), 'Nicht freigegeben')
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_verschieben', { id: 'wv_beratung', faellig: '2026-12-01' }, k), 'Nicht freigegeben')
  assertEquals(db.geschrieben.length, 0)

  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_erledigen', { id: 'wv_heute' }, k), 'Erledigt')
  const e = db.geschrieben[0]
  assertEquals([e.art, e.id, e.werte.erledigt_von], ['update', 'wv_heute', 'MA Test'])
  assert(typeof e.werte.erledigt_am === 'string')
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_erledigen', { id: 'wv_heute' }, k), 'schon erledigt')

  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_verschieben', { id: 'wv_ueber', faellig: '2026-12-01' }, k), 'vom 10.11.2026 auf den 01.12.2026')
  assertEquals(db.tabellen.wiedervorlagen.find((z) => z.id === 'wv_ueber')!.faellig, '2026-12-01')
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_verschieben', { id: 'wv_ueber', faellig: '31.02.2026' }, k), 'kein gültiges Datum')
  assertStringIncludes(await fuehreWvWerkzeugAus('wiedervorlage_erledigen', { id: 'gibts_nicht' }, k), 'gibt es nicht')
})

Deno.test('aufgaben_uebersicht: offene Wiedervorlagen als Follow-up „Wiedervorlage“, nur freigegebene Bereiche', async () => {
  const daten = grunddaten()
  // Ohne Zuständigen in der Zeile gilt der Verantwortliche der Akte.
  daten.wiedervorlagen.push({ id: 'wv_ohne', kunde_id: 'k_erb', bereich: 'erben', regel: null, titel: 'Ohne Zuständigen', notiz: null, faellig: '2026-11-21', verantwortlich: null, quelle: 'hand', erledigt_am: null })
  const db = falscheDb({ ...daten, todos: [], todo_freigaben: [], objekte: [], projekte: [] })
  const text = await aufgabenUebersicht(db.supabase, ma, { mitarbeiter: 'Quirin' }, HEUTE)
  assertStringIncludes(text, 'Wiedervorlage 20.11.2026 (heute fällig): Heute dran · Follow-up · Familie Huber · Anna Huber · Erben')
  assertStringIncludes(text, 'Unterlagen nachfassen (automatisch)')
  assertStringIncludes(text, 'Ohne Zuständigen')
  assert(!text.includes('Schon erledigt'))
  const hasan = await aufgabenUebersicht(db.supabase, ma, { mitarbeiter: 'Hasan' }, HEUTE)
  assertStringIncludes(hasan, 'Anrufen')
  assert(!hasan.includes('Geheime Beratung'))
  const privat = await aufgabenUebersicht(db.supabase, { ...ma, nurPrivat: true }, {}, HEUTE)
  assert(!/Wiedervorlage \d/.test(privat))
  assertStringIncludes(privat, 'Keine offenen Aufgaben')
})

Deno.test('aufgaben_uebersicht: Zeilen tragen die Kennung für Erledigen (todo_id, wiedervorlage id)', async () => {
  const daten = grunddaten()
  const todos = [{ id: 'todo_42', aufgabe: 'Steuerberater anrufen', kunde_projekt: null, zustaendig: 'Quirin', erledigen_bis: '2026-11-21', geplante_wiedervorlage: null, erledigt_am: null, bereich: 'erben', besitzer_email: null }]
  const db = falscheDb({ ...daten, todos, todo_freigaben: [], objekte: [], projekte: [] })
  const text = await aufgabenUebersicht(db.supabase, ma, { mitarbeiter: 'Quirin' }, HEUTE)
  assertMatch(text, /Steuerberater anrufen · To-do · Erben · todo_id=todo_42$/m)
  assertMatch(text, /Heute dran · Follow-up · Familie Huber · Anna Huber · Erben · wiedervorlage id=\S+$/m)
})
