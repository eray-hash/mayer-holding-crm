// To-dos in der Liste eines Kollegen ändern und keine Duplikate anlegen (Wünsche 25.11.2026), dazu die
// wiederkehrende Erinnerung (Spalte erinnerung_wiederholung). Erfundene Namen, Testdatenbank im Speicher.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { todoAendern, todoAnlegen } from './teamWerkzeuge.ts'
import { aehnlicheAufgabe, leseWiederholung } from './todoZuweisung.ts'

const ANNA = { id: 'm_a', name: 'Anna Beispiel', email: 'anna@beispiel.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }
const BERND = { id: 'm_b', name: 'Bernd Muster', email: 'bernd@beispiel.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }
const CHEFIN = { id: 'm_c', name: 'Clara Chef', email: 'clara@beispiel.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }

const todo = (id: string, aufgabe: string, besitzer: string | null, extra: Zeile = {}): Zeile => ({
  id, aufgabe, besitzer_email: besitzer, bereich: null, erledigt_am: null, erledigen_bis: null, zustaendig: null,
  kunde_projekt: null, aktueller_stand: null, prio: null, erinnern_um: null, ms_id: null, reihenfolge: 1, updated_at: '2026-11-20T10:00:00Z', ...extra,
})

function db(todos: Zeile[]) {
  return falscheDatenbank({ todos, mitarbeiter: [ANNA, BERND, CHEFIN].map((m) => ({ ...m, aktiv: true, telegram_chat_id: null })) })
}

// deno-lint-ignore no-explicit-any
async function zeile(d: any, id: string): Promise<Zeile> {
  const { data } = await d.from('todos').select('*').eq('id', id).maybeSingle()
  return data
}

const morgen = () => {
  const t = new Date(Date.now() + 26 * 3600 * 1000)
  return `${t.toISOString().slice(0, 10)}T09:00`
}

Deno.test('ähnliche Aufgabe: gleicher Text mit Absender, Wortreihenfolge, Umlaute', () => {
  assert(aehnlicheAufgabe('Grundbuchauszug Musterweg anfordern (von Anna Beispiel)', 'Grundbuchauszug Musterweg anfordern'))
  assert(aehnlicheAufgabe('Musterweg: Grundbuchauszug anfordern', 'grundbuchauszug für musterweg anfordern'))
  assert(aehnlicheAufgabe('Übergabeprotokoll prüfen', 'Uebergabeprotokoll pruefen'))
  assert(!aehnlicheAufgabe('Grundbuchauszug Musterweg anfordern', 'Energieausweis Musterweg anfordern'))
})

Deno.test('leseWiederholung', () => {
  assertEquals(leseWiederholung(undefined).wert, undefined)
  assertEquals(leseWiederholung('einmalig').wert, null)
  assertEquals(leseWiederholung('täglich').wert, 'taeglich')
  assertEquals(leseWiederholung('werktags').wert, 'werktags')
  assert(leseWiederholung('stündlich').fehler)
})

Deno.test('todo_aendern: Absender ändert Frist und Erinnerung in der Liste des Kollegen, kein neues To-do', async () => {
  const d = db([todo('t1', 'Grundbuchauszug anfordern (von Anna Beispiel)', 'bernd@beispiel.de', { zustaendig: 'Bernd Muster' })])
  const antwort = await todoAendern(d, ANNA, { suchbegriff: 'Grundbuchauszug', erledigen_bis: '2026-12-01', erinnern_um: morgen() }, () => {})
  assertStringIncludes(antwort, 'Geändert (Liste von Bernd Muster')
  assertStringIncludes(antwort, 'an Bernd Muster')
  const z = await zeile(d, 't1')
  assertEquals(z.erledigen_bis, '2026-12-01')
  assert(z.erinnern_um)
  const { data } = await d.from('todos').select('id')
  assertEquals((data as unknown[]).length, 1)
})

Deno.test('todo_aendern: To-do eines Kollegen, das jemand anderes geschickt hat → nicht für normale Mitarbeiter', async () => {
  const d = db([todo('t1', 'Grundbuchauszug anfordern (von Clara Chef)', 'bernd@beispiel.de')])
  const antwort = await todoAendern(d, ANNA, { suchbegriff: 'Grundbuchauszug', prio: 'A' }, () => {})
  assertStringIncludes(antwort, 'Kein passendes')
  assertEquals((await zeile(d, 't1')).prio, null)
})

Deno.test('todo_aendern: Geschäftsführung darf To-dos in Kollegen-Listen ändern, nicht aus Microsoft To Do', async () => {
  const d = db([
    todo('t1', 'Energieausweis bestellen', 'bernd@beispiel.de'),
    todo('t2', 'Energieausweis privat', 'bernd@beispiel.de', { ms_id: 'ms1' }),
  ])
  const antwort = await todoAendern(d, CHEFIN, { suchbegriff: 'Energieausweis', prio: 'A' }, () => {})
  assertStringIncludes(antwort, 'Geändert')
  assertEquals((await zeile(d, 't1')).prio, 'A')
  assertEquals((await zeile(d, 't2')).prio, null)
})

Deno.test('todo_anlegen: passendes offenes To-do in der Ziel-Liste → kein Duplikat, Hinweis auf todo_aendern', async () => {
  const d = db([todo('t1', 'Grundbuchauszug Musterweg anfordern (von Anna Beispiel)', 'bernd@beispiel.de', { zustaendig: 'Bernd Muster' })])
  const antwort = await todoAnlegen(d, ANNA, { aufgabe: 'Grundbuchauszug Musterweg anfordern', fuer: 'Bernd', erinnern_um: morgen() }, () => {})
  assertStringIncludes(antwort, 'NICHT ANGELEGT')
  assertStringIncludes(antwort, 'todo_id=t1')
  const { data } = await d.from('todos').select('id')
  assertEquals((data as unknown[]).length, 1)
  // Ausdrücklich ein zweites gewollt:
  const zweit = await todoAnlegen(d, ANNA, { aufgabe: 'Grundbuchauszug Musterweg anfordern', fuer: 'Bernd', trotzdem_neu: true }, () => {})
  assertStringIncludes(zweit, 'ZUGEWIESEN AN Bernd Muster')
})

Deno.test('todo_anlegen: wiederkehrende Erinnerung wird gespeichert, ohne Erinnerungszeit abgelehnt', async () => {
  const d = db([])
  const ohne = await todoAnlegen(d, ANNA, { aufgabe: 'Ablage sortieren', wiederholen: 'taeglich' }, () => {})
  assertStringIncludes(ohne, 'braucht eine Erinnerungszeit')
  const mit = await todoAnlegen(d, ANNA, { aufgabe: 'Ablage sortieren', erinnern_um: morgen(), wiederholen: 'taeglich' }, () => {})
  assertStringIncludes(mit, 'wiederholt sich täglich')
  const { data } = await d.from('todos').select('*')
  assertEquals((data as Zeile[])[0].erinnerung_wiederholung, 'taeglich')
})

Deno.test('todo_aendern: Wiederholung setzen und mit der Erinnerung wieder entfernen', async () => {
  const d = db([todo('t1', 'Ablage sortieren', 'anna@beispiel.de', { erinnern_um: '2026-12-01T08:00:00.000Z' })])
  const a = await todoAendern(d, ANNA, { todo_id: 't1', wiederholen: 'werktags' }, () => {})
  assertStringIncludes(a, 'werktags')
  assertEquals((await zeile(d, 't1')).erinnerung_wiederholung, 'werktags')
  await todoAendern(d, ANNA, { todo_id: 't1', erinnern_um: '' }, () => {})
  const z = await zeile(d, 't1')
  assertEquals(z.erinnern_um, null)
  assertEquals(z.erinnerung_wiederholung, null)
})
