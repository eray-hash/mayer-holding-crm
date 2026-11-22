// Tests für alleZeilen: seitenweises Lesen über die 1000-Zeilen-Grenze, Test-Doppel ohne .range, Fehler, Obergrenze.
import { assertEquals } from 'jsr:@std/assert@1'
import { alleZeilen, alleZeilenOderFehler, schluesselVon } from './alleZeilen.ts'
import { FalscheDatenbank } from './testDoppel.ts'

type Z = { id: string; wert: number }

/** Nachbau des Servers: sortiert nach den order-Aufrufen, liefert je range höchstens `grenze` Zeilen. */
function server(zeilen: Z[], grenze = 1000, fehlerAbVon?: number) {
  const aufrufe: { order: string[]; von: number; bis: number }[] = []
  const baue = () => {
    const order: string[] = []
    // Ohne range wie der echte Server: höchstens `grenze` Zeilen (abwartbar wie ein Supabase-Abfrageobjekt).
    // deno-lint-ignore no-explicit-any
    const q: any = Object.assign(Promise.resolve({ data: zeilen.slice(0, grenze), error: null }), {
      order(spalte: string) {
        order.push(spalte)
        return q
      },
      range(von: number, bis: number) {
        aufrufe.push({ order: [...order], von, bis })
        const sortiert = [...zeilen].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const teil = sortiert.slice(von, Math.min(bis + 1, von + grenze))
        const antwort = fehlerAbVon !== undefined && von >= fehlerAbVon ? { data: null, error: { message: 'kaputt', code: 'X1' } } : { data: teil, error: null }
        return Promise.resolve(antwort)
      },
    })
    return q
  }
  return { baue, aufrufe }
}

const viele = (n: number): Z[] => Array.from({ length: n }, (_, i) => ({ id: `z${String(i).padStart(5, '0')}`, wert: i }))

Deno.test('alleZeilen: 2.600 Zeilen in drei Seiten, sortiert nach id', async () => {
  const s = server(viele(2600))
  const { data, error } = await alleZeilen<Z>(s.baue)
  assertEquals(error, null)
  assertEquals(data.length, 2600)
  assertEquals(new Set(data.map((z) => z.id)).size, 2600)
  assertEquals(s.aufrufe.map((a) => [a.von, a.bis]), [[0, 999], [1000, 1999], [2000, 2999]])
  assertEquals(s.aufrufe[0].order, ['id'])
})

Deno.test('alleZeilen: genau 1000 Zeilen → eine leere Folgeseite, dann Schluss', async () => {
  const s = server(viele(1000))
  const { data } = await alleZeilen<Z>(s.baue)
  assertEquals(data.length, 1000)
  assertEquals(s.aufrufe.length, 2)
})

Deno.test('alleZeilen: eigene Sortierspalten und ordnung null', async () => {
  const a = server(viele(3))
  await alleZeilen(a.baue, { ordnung: ['email', 'minute'] })
  assertEquals(a.aufrufe[0].order, ['email', 'minute'])
  const b = server(viele(3))
  await alleZeilen(b.baue, { ordnung: null })
  assertEquals(b.aufrufe[0].order, [])
})

Deno.test('alleZeilen: Obergrenze hoechstens', async () => {
  const s = server(viele(2600))
  const { data } = await alleZeilen<Z>(s.baue, { hoechstens: 1500 })
  assertEquals(data.length, 1500)
  assertEquals(s.aufrufe.length, 2)
})

Deno.test('alleZeilen: Fehler mitten drin → bisherige Zeilen und der Fehler', async () => {
  const s = server(viele(2600), 1000, 1000)
  const { data, error } = await alleZeilen<Z>(s.baue)
  assertEquals(data.length, 1000)
  assertEquals(error, { message: 'kaputt', code: 'X1' })
  let geworfen = ''
  try {
    await alleZeilenOderFehler(server(viele(2600), 1000, 0).baue, {}, 'Aufgaben')
  } catch (e) {
    geworfen = (e as Error).message
  }
  assertEquals(geworfen, 'Aufgaben nicht lesbar: kaputt')
})

Deno.test('alleZeilen: Test-Doppel ohne .range → genau eine Abfrage mit Filtern', async () => {
  const db = new FalscheDatenbank({ todos: [{ id: 'a', erledigt_am: null }, { id: 'b', erledigt_am: '2026-11-01' }, { id: 'c', erledigt_am: null }] })
  const { data, error } = await alleZeilen(() => db.from('todos').select('id').is('erledigt_am', null))
  assertEquals(error, null)
  assertEquals(data.map((z) => z.id), ['a', 'c'])
  assertEquals(db.protokoll.length, 1)
})

Deno.test('alleZeilen: Objekt ohne order und range (reines Promise)', async () => {
  const { data } = await alleZeilen(() => Promise.resolve({ data: [{ id: 1 }], error: null }))
  assertEquals(data, [{ id: 1 }])
})

Deno.test('schluesselVon: Sonderfälle und Vorgabe', () => {
  assertEquals(schluesselVon('nutzung_minuten'), ['email', 'minute'])
  assertEquals(schluesselVon('objekt_anfragen'), ['email_id'])
  assertEquals(schluesselVon('kunden'), ['id'])
})
