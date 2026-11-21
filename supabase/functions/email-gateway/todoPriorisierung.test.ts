// Tests der automatischen To-do-Priorisierung: Datenbank im Speicher, falsche KI — kein Netz.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { berechneOrdnung, berlinZeit, type KiWerkzeug, MAX_OFFEN, priorisiereListe, pruefeTodoPriorisierung, tageBis, type TodoZeile } from './todoPriorisierung.ts'

const MONTAG_0635 = new Date('2026-11-23T05:35:00Z') // 06:35 deutsche Zeit, Montag
const SAMSTAG_0635 = new Date('2026-11-21T05:35:00Z')
const SAMSTAG_1440 = new Date('2026-11-21T13:40:00Z') // 14:40, volle zehn Minuten

type Eintrag = { nr: number; prio: string; rang: number; grund: string }

/** Falsche KI: merkt sich die Prompts und antwortet mit `antwort(prompt)`. */
function falscheKi(antwort: (prompt: string) => { eintraege: Eintrag[] } | unknown) {
  const prompts: string[] = []
  const ki: KiWerkzeug = <T>(prompt: string) => {
    prompts.push(prompt)
    return Promise.resolve(antwort(prompt) as T)
  }
  return { ki, prompts }
}

function todo(id: string, teil: Partial<TodoZeile> & Zeile = {}): Zeile {
  return {
    id,
    aufgabe: `Aufgabe ${id}`,
    prio: null,
    reihenfolge: null,
    erledigt_am: null,
    bereich: null,
    besitzer_email: 'a@test.de',
    erstellt_am: '2026-11-10',
    updated_at: '2026-11-20T10:00:00.000Z',
    prio_quelle: null,
    prio_grund: null,
    prio_am: null,
    ms_id: null,
    ...teil,
  }
}

const updatesAufTodos = (db: ReturnType<typeof falscheDatenbank>) => db.protokoll.filter((p) => p.tabelle === 'todos' && p.art === 'update').length
const zeile = (db: ReturnType<typeof falscheDatenbank>, id: string) => db.tabellen.todos.find((z) => z.id === id)!

// ---------- reine Hilfen ----------

Deno.test('berlinZeit und tageBis', () => {
  assertEquals(berlinZeit(MONTAG_0635), { datum: '2026-11-23', stunde: 6, minute: 35, wochentag: 1 })
  assertEquals(berlinZeit(SAMSTAG_0635).wochentag, 6)
  assertEquals(tageBis('2026-11-20', '2026-11-23'), -3)
  assertEquals(tageBis('2026-11-24', '2026-11-23'), 1)
  assertEquals(tageBis('nächste Woche', '2026-11-23'), null)
})

Deno.test('Ordnung: Gruppen A/B/C, Rang der KI, von Hand gesetzte behalten ihre Folge untereinander', () => {
  const zeilen: TodoZeile[] = [
    { id: 'h1', prio: 'B', reihenfolge: 1, aufgabe: 'h1', prio_quelle: 'hand' },
    { id: 'x', prio: null, reihenfolge: 2, aufgabe: 'x' },
    { id: 'h2', prio: 'B', reihenfolge: 3, aufgabe: 'h2', prio_quelle: 'hand' },
    { id: 'y', prio: 'C', reihenfolge: 4, aufgabe: 'y', prio_quelle: 'auto' },
  ]
  // KI will h2 vor h1 — die beiden von Hand gesetzten bleiben aber in ihrer Folge (h1 vor h2) auf denselben Plätzen.
  const plan = berechneOrdnung(zeilen, {
    eintraege: [
      { nr: 1, prio: 'A', rang: 3, grund: 'egal' },
      { nr: 2, prio: 'A', rang: 1, grund: 'Frist heute' },
      { nr: 3, prio: 'C', rang: 2, grund: 'egal' },
      { nr: 4, prio: 'B', rang: 4, grund: 'Kunde wartet' },
    ],
  })
  assertEquals(plan.map((p) => [p.id, p.prio, p.reihenfolge]), [
    ['x', 'A', 1],
    ['h1', 'B', 2],
    ['h2', 'B', 3],
    ['y', 'B', 4],
  ])
  assertEquals(plan.find((p) => p.id === 'h1')!.grund, null) // Grund der KI nicht an von Hand gesetzte
})

Deno.test('Ordnung: Microsoft-„wichtig“ wird nie gesetzt und nie entfernt; Grund wird gekürzt', () => {
  const zeilen: TodoZeile[] = [
    { id: 'm1', prio: 'A', reihenfolge: 1, aufgabe: 'm1', ms_id: 'MS1' },
    { id: 'm2', prio: null, reihenfolge: 2, aufgabe: 'm2', ms_id: 'MS2' },
  ]
  const plan = berechneOrdnung(zeilen, {
    eintraege: [
      { nr: 1, prio: 'C', rang: 2, grund: 'eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn' },
      { nr: 2, prio: 'A', rang: 1, grund: 'dringend' },
    ],
  })
  assertEquals(plan.find((p) => p.id === 'm1')!.prio, 'A')
  assertEquals(plan.find((p) => p.id === 'm2')!.prio, 'B')
  assertEquals(plan.find((p) => p.id === 'm1')!.grund!.split(' ').length, 12)
})

Deno.test('Ordnung: unbrauchbare Antwort wirft', () => {
  let geworfen = false
  try {
    berechneOrdnung([{ id: 'a', prio: null, reihenfolge: 1, aufgabe: 'a' }], { eintraege: [{ nr: 7, prio: 'A', rang: 1 }] })
  } catch {
    geworfen = true
  }
  assert(geworfen)
})

// ---------- eine Liste mit Datenbank ----------

Deno.test('Liste: von Hand gesetzte bleiben, Ränge und Prio werden geschrieben, zweiter Lauf schreibt nichts', async () => {
  const db = falscheDatenbank({
    todos: [
      todo('t1', { prio: 'C', reihenfolge: 1, prio_quelle: 'hand', prio_grund: null }),
      todo('t2', { reihenfolge: 2, erledigen_bis: '2026-11-22' }),
      todo('t3', { prio: 'B', reihenfolge: 3, prio_quelle: 'auto', prio_grund: 'alt' }),
      todo('t4', { prio: 'A', reihenfolge: 4, prio_quelle: 'hand' }),
      todo('fertig', { prio: 'A', reihenfolge: 5, erledigt_am: '2026-11-19' }),
    ],
  })
  // Antwort je Aufgabe (nicht je Nummer — die Nummern folgen der aktuellen Reihenfolge und ändern sich nach dem Lauf).
  const jeAufgabe: Record<string, Omit<Eintrag, 'nr'>> = {
    t1: { prio: 'A', rang: 4, grund: 'x' },
    t2: { prio: 'A', rang: 1, grund: 'Frist gestern überschritten' },
    t3: { prio: 'C', rang: 3, grund: 'kann warten' },
    t4: { prio: 'A', rang: 2, grund: 'y' },
  }
  const { ki, prompts } = falscheKi((prompt) => ({
    eintraege: [...prompt.matchAll(/^(\d+) \| Aufgabe (\w+)/gm)].map((m) => ({ nr: Number(m[1]), ...jeAufgabe[m[2]] })),
  }))
  const r = await priorisiereListe(db, { besitzer: 'a@test.de' }, { callClaudeTool: ki, jetzt: MONTAG_0635 })
  assert(r.ok)
  assertEquals(r.offen, 4)
  assertEquals(prompts.length, 1)
  assertStringIncludes(prompts[0], 'fest: C')
  assertStringIncludes(prompts[0], 'erledigen bis: 2026-11-22 (seit 1 Tag überfällig)')
  assert(!prompts[0].includes('Aufgabe fertig'))

  // Von Hand: Prio, Quelle und Grund unverändert.
  assertEquals([zeile(db, 't1').prio, zeile(db, 't1').prio_quelle, zeile(db, 't1').prio_grund], ['C', 'hand', null])
  assertEquals([zeile(db, 't4').prio, zeile(db, 't4').prio_quelle], ['A', 'hand'])
  // Automatisch: Prio, Quelle, Grund, Zeitpunkt.
  assertEquals([zeile(db, 't2').prio, zeile(db, 't2').prio_quelle, zeile(db, 't2').prio_grund], ['A', 'auto', 'Frist gestern überschritten'])
  assertEquals([zeile(db, 't3').prio, zeile(db, 't3').prio_grund], ['C', 'kann warten'])
  assertEquals(zeile(db, 't2').prio_am, MONTAG_0635.toISOString())
  // Reihenfolge: A (t2, t4), C (t3, t1 — Rang 3 vor 4).
  assertEquals(['t2', 't4', 't3', 't1'].map((id) => zeile(db, id).reihenfolge), [1, 2, 3, 4])
  // Erledigte unangetastet.
  assertEquals([zeile(db, 'fertig').reihenfolge, zeile(db, 'fertig').prio_am], [5, null])
  // Stand der Liste gemerkt.
  assert(db.tabellen.todo_prio_stand.some((z) => z.id === 'liste:privat:a@test.de'))

  // Zweiter Lauf mit derselben Antwort: nichts zu schreiben.
  const vorher = updatesAufTodos(db)
  const r2 = await priorisiereListe(db, { besitzer: 'a@test.de' }, { callClaudeTool: ki, jetzt: MONTAG_0635 })
  assert(r2.ok)
  assertEquals(r2.geaendert, 0)
  assertEquals(updatesAufTodos(db), vorher)
})

Deno.test('Liste: private Listen sind getrennt — fremde und Bereichs-Aufgaben weder gelesen noch geschrieben', async () => {
  const db = falscheDatenbank({
    todos: [
      todo('a1', { aufgabe: 'Meine private Aufgabe' }),
      todo('b1', { aufgabe: 'Geheime Aufgabe von B', besitzer_email: 'b@test.de' }),
      todo('a_bereich', { aufgabe: 'Bereichsaufgabe', bereich: 'beratung' }),
    ],
  })
  const { ki, prompts } = falscheKi(() => ({ eintraege: [{ nr: 1, prio: 'B', rang: 1, grund: 'ok' }] }))
  const r = await priorisiereListe(db, { besitzer: 'A@Test.de' }, { callClaudeTool: ki, jetzt: MONTAG_0635 })
  assert(r.ok)
  assertEquals(r.offen, 1)
  assertStringIncludes(prompts[0], 'Meine private Aufgabe')
  assert(!prompts[0].includes('Geheime Aufgabe von B'))
  assert(!prompts[0].includes('Bereichsaufgabe'))
  assertEquals(zeile(db, 'a1').prio, 'B')
  assertEquals([zeile(db, 'b1').prio, zeile(db, 'b1').prio_quelle], [null, null])
  assertEquals([zeile(db, 'a_bereich').prio, zeile(db, 'a_bereich').prio_quelle], [null, null])

  // Bereichsliste: nur die Bereichsaufgabe.
  const r2 = await priorisiereListe(db, { bereich: 'beratung' }, { callClaudeTool: ki, jetzt: MONTAG_0635 })
  assert(r2.ok)
  assertEquals(r2.offen, 1)
  assertStringIncludes(prompts[1], 'Bereichsaufgabe')
  assert(!prompts[1].includes('Meine private Aufgabe'))
})

Deno.test('Liste: zu groß → kein KI-Aufruf; unbrauchbare KI-Antwort → nichts geschrieben', async () => {
  const viele = Array.from({ length: MAX_OFFEN + 1 }, (_, i) => todo(`v${i}`, { reihenfolge: i }))
  const db = falscheDatenbank({ todos: viele })
  const { ki, prompts } = falscheKi(() => ({ eintraege: [] }))
  const r = await priorisiereListe(db, { besitzer: 'a@test.de' }, { callClaudeTool: ki, jetzt: MONTAG_0635 })
  assertEquals(r.ok, false)
  assertEquals(prompts.length, 0)

  const db2 = falscheDatenbank({ todos: [todo('a'), todo('b')] })
  let geworfen = false
  try {
    await priorisiereListe(db2, { besitzer: 'a@test.de' }, { callClaudeTool: falscheKi(() => ({ quatsch: 1 })).ki, jetzt: MONTAG_0635 })
  } catch {
    geworfen = true
  }
  assert(geworfen)
  assertEquals(updatesAufTodos(db2), 0)
})

Deno.test('Liste: eine während des KI-Aufrufs von Hand gesetzte Prio wird nicht überschrieben', async () => {
  const db = falscheDatenbank({ todos: [todo('a', { reihenfolge: 1 }), todo('b', { reihenfolge: 2 })] })
  const ki: KiWerkzeug = <T>() => {
    zeile(db, 'a').prio = 'C'
    zeile(db, 'a').prio_quelle = 'hand'
    return Promise.resolve({ eintraege: [{ nr: 1, prio: 'A', rang: 1, grund: 'x' }, { nr: 2, prio: 'B', rang: 2, grund: 'y' }] } as T)
  }
  await priorisiereListe(db, { besitzer: 'a@test.de' }, { callClaudeTool: ki, jetzt: MONTAG_0635 })
  assertEquals([zeile(db, 'a').prio, zeile(db, 'a').prio_quelle], ['C', 'hand'])
  assertEquals(zeile(db, 'b').prio, 'B')
})

// ---------- Zeitplan ----------

function zeitplanDb() {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', email: 'A@test.de', aktiv: true },
      { id: 'm2', email: 'b@test.de', aktiv: true },
      { id: 'm3', email: 'weg@test.de', aktiv: false },
    ],
    todos: [
      todo('a1', { besitzer_email: 'a@test.de' }),
      todo('b1', { besitzer_email: 'b@test.de', prio: 'B', prio_quelle: 'auto', prio_grund: 'g', reihenfolge: 1, prio_am: '2026-11-19T00:00:00.000Z' }),
      todo('w1', { besitzer_email: 'weg@test.de' }),
      todo('r1', { bereich: 'immobilien', besitzer_email: 'a@test.de' }),
    ],
  })
}

const einsJeNr = (prompt: string) => ({
  eintraege: [...prompt.matchAll(/^(\d+) \| /gm)].map((m, i) => ({ nr: Number(m[1]), prio: 'B', rang: i + 1, grund: 'g' })),
})

Deno.test('Zeitplan: außerhalb der Fenster kein Datenbankzugriff', async () => {
  const db = zeitplanDb()
  const { ki } = falscheKi(einsJeNr)
  const e = await pruefeTodoPriorisierung(db, { callClaudeTool: ki, jetzt: SAMSTAG_0635 })
  assertEquals(e.lauf, null)
  assertEquals(db.protokoll.length, 0)
})

Deno.test('Zeitplan: Werktagmorgen einmal — alle Listen mit Bedarf, inaktive Mitarbeiter nicht; zweiter Takt läuft nicht', async () => {
  const db = zeitplanDb()
  const { ki, prompts } = falscheKi(einsJeNr)
  const e = await pruefeTodoPriorisierung(db, { callClaudeTool: ki, jetzt: MONTAG_0635 })
  assertEquals(e.lauf, 'morgen')
  // immobilien + a (neue Aufgaben) + b (noch nie gelaufen) = 3 KI-Aufrufe; weg@ ist inaktiv.
  assertEquals(prompts.length, 3)
  assertEquals(zeile(db, 'w1').prio_quelle, null)
  assertEquals(zeile(db, 'r1').prio_quelle, 'auto')
  assertEquals((db.tabellen.todo_prio_stand.find((z) => z.id === 'zeitplan')!.daten as Record<string, string>).morgen, '2026-11-23')

  const e2 = await pruefeTodoPriorisierung(db, { callClaudeTool: ki, jetzt: new Date('2026-11-23T05:36:00Z') })
  assertEquals(e2.lauf, null)
  assertEquals(prompts.length, 3)
})

Deno.test('Zeitplan: alle zehn Minuten nur Listen mit neuen Aufgaben; unveränderte Listen ohne KI', async () => {
  const db = zeitplanDb()
  const { ki, prompts } = falscheKi(einsJeNr)
  // Ein früherer Lauf für b ist gemerkt — b hat keine neue Aufgabe.
  db.tabellen.todo_prio_stand = [{ id: 'liste:privat:b@test.de', am: '2026-11-20T12:00:00.000Z', daten: {} }]
  const e = await pruefeTodoPriorisierung(db, { callClaudeTool: ki, jetzt: SAMSTAG_1440 })
  assertEquals(e.lauf, 'neu')
  assertEquals(prompts.length, 2) // a und immobilien
  assert(prompts.every((p) => !p.includes('Aufgabe b1')))
  // Gleicher Platz noch einmal: kein Lauf.
  const e2 = await pruefeTodoPriorisierung(db, { callClaudeTool: ki, jetzt: new Date('2026-11-21T13:40:30Z') })
  assertEquals(e2.lauf, null)
  // Nächster Platz: nichts Neues mehr → zwar Lauf, aber keine KI.
  const e3 = await pruefeTodoPriorisierung(db, { callClaudeTool: ki, jetzt: new Date('2026-11-21T13:50:00Z') })
  assertEquals(e3.lauf, 'neu')
  assertEquals(prompts.length, 2)
})
