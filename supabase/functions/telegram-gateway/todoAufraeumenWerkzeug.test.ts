// Prüft das Werkzeug todos_aufraeumen mit einer Datenbank im Speicher: nur eigene Liste, Vorschau ändert nichts,
// Anwenden nur mit bestaetigt + Gruppe/IDs, Gruppe veraltet → nichts, weich erledigen mit Vermerk, löschen nur
// ausdrücklich, Doppel behalten eine, Privat-Regel (Mayer-Bot ohne Microsoft-Aufgaben / ohne private Liste),
// seitenweises Lesen über 1000 Zeilen.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { ladeOffeneTodos } from '../_shared/todoAufraeumen.ts'
import { fuehreTodoAufraeumenWerkzeugAus, type TodoAufraeumenKontext } from './todoAufraeumenWerkzeug.ts'

const HEUTE = '2026-11-22'
const ICH = 'ich@mayer.de'

function todo(id: string, aufgabe: string, mehr: Zeile = {}): Zeile {
  return { id, aufgabe, besitzer_email: ICH, bereich: null, erledigt_am: null, erstellt_am: '2026-11-20', aktueller_stand: null, ...mehr }
}

function aufbau(todos: Zeile[], o: { privat?: boolean; hatPrivatBot?: boolean } = {}) {
  const db = falscheDatenbank({ todos, kunden: [], objekte: [], projekte: [] })
  const protokoll: string[] = []
  const ctx: TodoAufraeumenKontext = {
    supabase: db,
    mitarbeiter: { name: 'Ich', email: ICH, rolle: 'mitarbeiter' },
    protokolliere: (t) => protokoll.push(t),
    heute: HEUTE,
    privat: o.privat,
    privatBotAktiv: () => Promise.resolve(o.hatPrivatBot === true),
  }
  return { db, ctx, protokoll, zeile: (id: string) => db.tabelle('todos').find((z) => z.id === id)! }
}

function standardTodos(): Zeile[] {
  return [
    todo('d1', 'Miete Saray überweisen'),
    todo('d2', 'Miete Saray überweisen!', { erledigen_bis: '2026-12-01' }),
    todo('alt1', 'Garage aufräumen', { erstellt_am: '2025-01-01', aktueller_stand: 'Notiz' }),
    todo('alt2', 'Keller aufräumen', { erstellt_am: '2025-02-01' }),
    todo('neu', 'Frisch', { erstellt_am: '2026-11-21' }),
    todo('fremd', 'Garage aufräumen', { besitzer_email: 'andere@mayer.de', erstellt_am: '2020-01-01' }),
    todo('bereich', 'Bereichsaufgabe', { bereich: 'beratung', erstellt_am: '2020-01-01' }),
  ]
}

Deno.test('Vorschau: nur eigene Liste, Zahlen und Gruppen, ändert nichts', async () => {
  const { db, ctx, protokoll } = aufbau(standardTodos())
  const vorher = JSON.stringify(db.tabelle('todos'))
  const r = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', {}, ctx)
  assertStringIncludes(r, '5 offen')
  assertStringIncludes(r, 'Doppelt: 1 Gruppen, 1 Aufgaben zu viel')
  assertStringIncludes(r, 'Lange unberührt: 2')
  assertStringIncludes(r, 'gruppe=G')
  assert(!r.includes('fremd') && !r.includes('Bereichsaufgabe'))
  assertEquals(JSON.stringify(db.tabelle('todos')), vorher)
  assertEquals(protokoll.length, 0)
  // Mit art kommen einzelne Aufgaben mit todo_id
  const einzeln = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { art: 'alt' }, ctx)
  assertStringIncludes(einzeln, 'todo_id=alt1')
  assert(!einzeln.includes('todo_id=d1'))
})

Deno.test('Anwenden per Gruppe: weich erledigen mit Vermerk; veralteter Code ändert nichts', async () => {
  const { ctx, zeile, protokoll } = aufbau(standardTodos())
  const vorschau = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { art: 'alt' }, ctx)
  const code = vorschau.match(/gruppe=(G[0-9a-z]+)/)![1]
  // Ohne bestaetigt: nur Vorschau
  await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { gruppe: code }, ctx)
  assertEquals(zeile('alt1').erledigt_am, null)
  // Falscher Code
  const falsch = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { bestaetigt: true, gruppe: 'Gxyz' }, ctx)
  assert(falsch.startsWith('Fehler:'))
  // Richtig
  const r = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { bestaetigt: true, gruppe: code }, ctx)
  assertStringIncludes(r, '2 abgehakt')
  assertEquals(zeile('alt1').erledigt_am, HEUTE)
  assertEquals(zeile('alt1').aktueller_stand, 'Notiz\naufgeräumt am 22.11.2026: lange unberührt')
  assertEquals(zeile('alt2').aktueller_stand, 'aufgeräumt am 22.11.2026: lange unberührt')
  assertEquals(zeile('fremd').erledigt_am, null)
  assertEquals(protokoll.length, 1)
  // Derselbe Code passt danach nicht mehr (Menge hat sich geändert)
  const nochmal = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { bestaetigt: true, gruppe: code }, ctx)
  assert(nochmal.startsWith('Fehler:'))
})

Deno.test('Anwenden per IDs: nur vorgeschlagene, Doppel behält eine, löschen nur ausdrücklich', async () => {
  const { db, ctx, zeile } = aufbau(standardTodos())
  const r = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { bestaetigt: true, todo_ids: ['d1', 'neu', 'fremd'] }, ctx)
  assertStringIncludes(r, '1 Doppel abgehakt')
  assertStringIncludes(r, 'Unverändert (nicht vorgeschlagen): neu, fremd')
  assertEquals(zeile('d1').erledigt_am, HEUTE)
  assertEquals(zeile('d2').erledigt_am, null)
  assertEquals(zeile('neu').erledigt_am, null)
  // Löschen ausdrücklich
  const lo = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { bestaetigt: true, todo_ids: ['alt2'], aktion: 'loeschen' }, ctx)
  assertStringIncludes(lo, '1 gelöscht')
  assert(!db.tabelle('todos').some((z) => z.id === 'alt2'))
  // Fremde ID wird nie gelöscht, auch wenn genannt
  await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { bestaetigt: true, todo_ids: ['fremd'], aktion: 'loeschen' }, ctx)
  assert(db.tabelle('todos').some((z) => z.id === 'fremd'))
  // Verschieben mit Datum
  const vs = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { bestaetigt: true, todo_ids: ['alt1'], aktion: 'verschieben', datum: '2027-01-15' }, ctx)
  assertStringIncludes(vs, '1 verschoben')
  assertEquals(zeile('alt1').erledigen_bis, '2027-01-15')
  assertEquals(zeile('alt1').erledigt_am, null)
  // Ohne Gruppe/IDs
  assert((await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { bestaetigt: true }, ctx)).startsWith('Fehler:'))
})

Deno.test('Privat bleibt privat: Mayer-Bot ohne Microsoft-Aufgaben und ohne Liste mit privatem Assistenten', async () => {
  const todos = [
    todo('ms1', 'Alte Microsoft-Aufgabe', { ms_id: 'AAA', ms_liste_name: 'Aufgaben', ms_geaendert: '2022-01-01T00:00:00Z' }),
    todo('crm1', 'Alte CRM-Aufgabe', { erstellt_am: '2024-01-01' }),
  ]
  const mayer = aufbau(todos)
  const r = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { art: 'alt' }, mayer.ctx)
  assertStringIncludes(r, 'todo_id=crm1')
  assert(!r.includes('ms1') && !r.includes('Microsoft'))
  const mitPrivatBot = aufbau(todos, { hatPrivatBot: true })
  assertStringIncludes(await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', {}, mitPrivatBot.ctx), 'privaten Assistenten')
  const privat = aufbau(todos, { privat: true })
  const p = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { art: 'alt' }, privat.ctx)
  assertStringIncludes(p, 'todo_id=ms1')
  assertStringIncludes(p, 'Microsoft-Liste „Aufgaben“')
  const an = await fuehreTodoAufraeumenWerkzeugAus('todos_aufraeumen', { bestaetigt: true, todo_ids: ['ms1'] }, privat.ctx)
  assertStringIncludes(an, 'Microsoft To Do')
  assertEquals(privat.zeile('ms1').erledigt_am, HEUTE)
})

Deno.test('ladeOffeneTodos liest über 1000 Zeilen seitenweise', async () => {
  const viele: Zeile[] = []
  for (let i = 0; i < 2345; i++) viele.push(todo(`t${String(i).padStart(5, '0')}`, `Aufgabe ${i}`))
  viele.push(todo('zu', 'Erledigt', { erledigt_am: '2026-01-01' }))
  const db = falscheDatenbank({ todos: viele })
  const r = await ladeOffeneTodos(db, { besitzer: ICH })
  assertEquals(r.length, 2345)
  assertEquals(new Set(r.map((x) => x.id)).size, 2345)
})
