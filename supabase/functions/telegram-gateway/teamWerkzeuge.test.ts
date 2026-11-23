// To-do suchen für todo_aendern / todo_erledigen (teamWerkzeuge.ts, findeTodo). Kein Netz, keine Datenbank.
//
// Anlass (23.11.2026): Die Suche lief über ALLE offenen To-dos, war auf 20 begrenzt und filterte erst danach
// nach Rechten. Hasan hat über 2.600 private To-dos; bei häufigen Wörtern („anrufen“, „senden“) füllten sie die
// 20 Plätze, und Quirin bekam „Kein passendes offenes To-do“, obwohl seines da war.
//
//   npx -y deno test --allow-env --allow-read telegram-gateway/teamWerkzeuge.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { todoAendern, todoErledigen } from './teamWerkzeuge.ts'

type Zeile = Record<string, unknown>

/** Kleine Testdatenbank mit den Filtern, die findeTodo benutzt (ilike, not … is null, order, limit). */
function falscheDb(todos: Zeile[]) {
  const aenderungen: { id: unknown; patch: Zeile }[] = []
  const wieIlike = (wert: unknown, muster: string) => {
    const re = new RegExp(`^${muster.split('%').map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')).join('.*')}$`, 'is')
    return re.test(String(wert ?? ''))
  }
  const from = (_tabelle: string) => {
    const filter: ((z: Zeile) => boolean)[] = []
    let sortiert: { spalte: string; auf: boolean } | null = null
    let grenze = Infinity
    let einzel = false
    let patch: Zeile | null = null
    const q = {
      select: () => q,
      update: (p: Zeile) => ((patch = p), q),
      is: (s: string, w: null) => (filter.push((z) => (w === null ? z[s] === null || z[s] === undefined : z[s] === w)), q),
      not: (s: string, op: string, w: null) => (op === 'is' && w === null ? filter.push((z) => z[s] !== null && z[s] !== undefined) : filter.push(() => true), q),
      eq: (s: string, w: unknown) => (filter.push((z) => z[s] === w), q),
      ilike: (s: string, m: string) => (filter.push((z) => wieIlike(z[s], m)), q),
      order: (spalte: string, o: { ascending?: boolean } = {}) => ((sortiert = { spalte, auf: o.ascending !== false }), q),
      limit: (n: number) => ((grenze = n), q),
      maybeSingle: () => ((einzel = true), q),
      then: (ok: (e: unknown) => unknown) => {
        let zeilen = todos.filter((z) => filter.every((f) => f(z)))
        if (patch) {
          for (const z of zeilen) {
            Object.assign(z, patch)
            aenderungen.push({ id: z.id, patch })
          }
          return Promise.resolve({ data: null, error: null }).then(ok)
        }
        if (sortiert) {
          const { spalte, auf } = sortiert
          zeilen = [...zeilen].sort((a, b) => (String(a[spalte]) < String(b[spalte]) ? -1 : String(a[spalte]) > String(b[spalte]) ? 1 : 0) * (auf ? 1 : -1))
        }
        zeilen = zeilen.slice(0, grenze)
        return Promise.resolve(einzel ? { data: zeilen[0] ?? null, error: null } : { data: zeilen, error: null }).then(ok)
      },
    }
    return q
  }
  return { from, aenderungen }
}

const todo = (id: string, aufgabe: string, besitzer: string | null, bereich: string | null = null, updated = '2026-11-20T10:00:00Z'): Zeile => ({
  id,
  aufgabe,
  besitzer_email: besitzer,
  bereich,
  erledigt_am: null,
  erledigen_bis: null,
  zustaendig: null,
  kunde_projekt: null,
  aktueller_stand: null,
  prio: null,
  erinnern_um: null,
  updated_at: updated,
})

const QUIRIN = { id: 'm_q', name: 'Quirin Lutzenberger', email: 'immo@amayer-holding.com', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }
const HASAN_PRIVAT = { id: 'm_h', name: 'Hasan Süslü', email: 'sueslue@hotmail.com', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], nurPrivat: true }

/** 60 offene private To-dos eines Kollegen, deren Ids VOR Quirins To-do sortiert werden. */
function vieleFremde(): Zeile[] {
  return Array.from({ length: 60 }, (_, i) => todo(`todo_a${String(i).padStart(3, '0')}`, `Hotel anrufen wegen Strom ${i}`, 'sueslue@hotmail.com'))
}

Deno.test('todo_erledigen: eigenes To-do wird gefunden, auch wenn viele fremde To-dos dasselbe Wort enthalten', async () => {
  const db = falscheDb([...vieleFremde(), todo('todo_zq1', 'Herrn Maier anrufen (Senden)', 'immo@amayer-holding.com')])
  const protokoll: string[] = []
  const antwort = await todoErledigen(db, QUIRIN, { suchbegriff: 'anrufen' }, (t) => protokoll.push(t))
  assert(!antwort.startsWith('Kein passendes'), antwort)
  assertEquals(db.aenderungen.map((a) => a.id), ['todo_zq1'])
  assertEquals(protokoll.length, 1)
})

Deno.test('todo_aendern: Bereichsliste wird durchsucht, fremde Bereiche und fremde eigene Listen nicht', async () => {
  const db = falscheDb([
    ...vieleFremde(),
    todo('todo_b1', 'Exposé Lorch anrufen', null, 'immobilien'),
    todo('todo_b2', 'Steuerberater anrufen', null, 'beratung'),
    todo('todo_e1', 'Eray anrufen', 'eray.yesil@fundament-it.de'),
  ])
  const antwort = await todoAendern(db, QUIRIN, { suchbegriff: 'anrufen', prio: 'A' }, () => {})
  assertStringIncludes(antwort, 'Geändert (Liste Immobilien')
  assertEquals(db.aenderungen.map((a) => a.id), ['todo_b1'])
})

Deno.test('todo_aendern: mehrere eigene Treffer → Liste zum Nachfragen, nur eigene', async () => {
  const db = falscheDb([...vieleFremde(), todo('todo_q1', 'Maier anrufen', 'immo@amayer-holding.com'), todo('todo_q2', 'Huber anrufen', 'IMMO@amayer-holding.com')])
  const antwort = await todoAendern(db, QUIRIN, { suchbegriff: 'anrufen', prio: 'B' }, () => {})
  assertStringIncludes(antwort, 'Mehrere passende To-dos')
  assertStringIncludes(antwort, 'todo_q1')
  assertStringIncludes(antwort, 'todo_q2')
  assert(!antwort.includes('Hotel anrufen'), antwort)
  assertEquals(db.aenderungen.length, 0)
})

Deno.test('kein Treffer: zuletzt geänderte eigene To-dos als Hilfe (falsch gehörter Suchbegriff), nichts geändert', async () => {
  const db = falscheDb([
    todo('todo_alt', 'Alte Sache', 'sueslue@hotmail.com', null, '2026-11-01T10:00:00Z'),
    todo('todo_aok', 'AOK-Krankschreibungen prüfen', 'sueslue@hotmail.com', null, '2026-11-22T11:43:31Z'),
    todo('todo_fremd', 'Fremdes To-do', 'immo@amayer-holding.com', null, '2026-11-22T12:00:00Z'),
    todo('todo_ber', 'Bereichs-To-do', null, 'immobilien', '2026-11-22T12:00:00Z'),
  ])
  const antwort = await todoAendern(db, HASAN_PRIVAT, { suchbegriff: 'Judo', erinnern_um: '' }, () => {})
  assert(antwort.startsWith('Kein passendes offenes To-do'), antwort)
  assertStringIncludes(antwort, 'todo_aok')
  assert(antwort.indexOf('todo_aok') < antwort.indexOf('todo_alt'), 'neueste zuerst')
  assert(!antwort.includes('todo_fremd') && !antwort.includes('todo_ber'), antwort)
  assertEquals(db.aenderungen.length, 0)
})

Deno.test('kein Treffer per todo_id: nur die kurze Meldung', async () => {
  const db = falscheDb([todo('todo_x', 'Etwas', 'immo@amayer-holding.com')])
  assertEquals(await todoErledigen(db, QUIRIN, { todo_id: 'todo_gibtsnicht' }, () => {}), 'Kein passendes offenes To-do in Listen gefunden, die dieser Mitarbeiter ändern darf.')
  // Fremdes To-do per Id: genauso unbekannt.
  const db2 = falscheDb([todo('todo_h', 'Privat', 'sueslue@hotmail.com')])
  assertEquals(await todoErledigen(db2, QUIRIN, { todo_id: 'todo_h' }, () => {}), 'Kein passendes offenes To-do in Listen gefunden, die dieser Mitarbeiter ändern darf.')
  assertEquals(db2.aenderungen.length, 0)
})

Deno.test('privater Assistent: Bereichslisten nie, auch nicht bei passendem Wort', async () => {
  const db = falscheDb([todo('todo_b1', 'Lorch anrufen', null, 'immobilien'), todo('todo_h1', 'Strom anrufen', 'sueslue@hotmail.com')])
  const antwort = await todoErledigen(db, HASAN_PRIVAT, { suchbegriff: 'anrufen' }, () => {})
  assertEquals(db.aenderungen.map((a) => a.id), ['todo_h1'])
  assert(!antwort.includes('Lorch'), antwort)
})
