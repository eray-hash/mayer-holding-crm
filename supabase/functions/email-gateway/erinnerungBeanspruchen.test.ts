// Erinnerungen (Termine: kalender.ts sendeErinnerungen, To-dos: todoErinnerung.ts) werden erst beansprucht und dann
// gesendet: Scheitert das Speichern, geht keine Nachricht raus (vorher kam dieselbe Erinnerung jede Minute), zwei
// gleichzeitige Läufe senden nie doppelt, ein gescheiterter privater Versand wird beim nächsten Lauf wiederholt.
import { assertEquals } from 'jsr:@std/assert@1'
import { sendeErinnerungen } from './kalender.ts'
import { sendeTodoErinnerungen } from './todoErinnerung.ts'

type Zeile = Record<string, unknown>

function stabil(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stabil).join(',')}]`
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stabil((x as Zeile)[k])}`).join(',')}}`
  return JSON.stringify(x ?? null)
}

/** Vergleich wie PostgREST: jsonb-Spalten mit einem JSON-Text als Wert vergleichen inhaltlich. */
function gleich(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false
  if (typeof a === 'object') {
    try {
      return stabil(a) === stabil(typeof b === 'string' ? JSON.parse(b) : b)
    } catch {
      return false
    }
  }
  return String(a) === String(b)
}

/** Kleine Datenbank im Speicher: genau die Aufrufketten der beiden Erinnerungs-Module. */
class Db {
  tabellen: Record<string, Zeile[]>
  /** Erzwingt einen Fehler bei jedem Update dieser Tabelle. */
  updateFehler: Record<string, string> = {}
  updates = 0
  constructor(t: Record<string, Zeile[]>) {
    this.tabellen = structuredClone(t)
  }
  from(tabelle: string) {
    const db = this
    const filter: ((z: Zeile) => boolean)[] = []
    let art: 'select' | 'update' = 'select'
    let aenderung: Zeile = {}
    let grenze = Infinity
    let einzel = false
    const q = {
      select() {
        return q
      },
      update(a: Zeile) {
        art = 'update'
        aenderung = a
        return q
      },
      eq(s: string, w: unknown) {
        filter.push((z) => gleich(z[s], w))
        return q
      },
      is(s: string, w: unknown) {
        filter.push((z) => (w === null ? z[s] === null || z[s] === undefined : z[s] === w))
        return q
      },
      not(s: string, op: string, w: unknown) {
        if (op !== 'is' || w !== null) throw new Error('nicht unterstützt')
        filter.push((z) => z[s] !== null && z[s] !== undefined)
        return q
      },
      gt(s: string, w: unknown) {
        filter.push((z) => String(z[s]) > String(w))
        return q
      },
      lt(s: string, w: unknown) {
        filter.push((z) => String(z[s]) < String(w))
        return q
      },
      lte(s: string, w: unknown) {
        filter.push((z) => String(z[s]) <= String(w))
        return q
      },
      order() {
        return q
      },
      limit(n: number) {
        grenze = n
        return q
      },
      maybeSingle() {
        einzel = true
        return q
      },
      then(ok: (e: { data: unknown; error: { message: string } | null }) => unknown) {
        const zeilen = (db.tabellen[tabelle] ??= []).filter((z) => filter.every((f) => f(z)))
        if (art === 'update') {
          db.updates++
          if (db.updateFehler[tabelle]) return Promise.resolve({ data: null, error: { message: db.updateFehler[tabelle] } }).then(ok)
          for (const z of zeilen) Object.assign(z, structuredClone(aenderung))
          return Promise.resolve({ data: structuredClone(zeilen), error: null }).then(ok)
        }
        const aus = structuredClone(zeilen.slice(0, grenze))
        return Promise.resolve({ data: einzel ? aus[0] ?? null : aus, error: null }).then(ok)
      },
    }
    return q
  }
}

const TEAM = [
  { name: 'Eray', email: 'eray@x.de', telegram_chat_id: 1, aktiv: true },
  { name: 'Hasan', email: 'hasan@x.de', telegram_chat_id: 2, aktiv: true },
]

function termin(o: Zeile = {}): Zeile {
  const beginn = new Date(Date.now() + 50 * 60000).toISOString()
  return {
    id: 't1',
    titel: 'Besprechung',
    beschreibung: '',
    ort: '',
    beginn,
    ende: new Date(Date.now() + 110 * 60000).toISOString(),
    ganztags: false,
    besitzer_email: 'eray@x.de',
    teilnehmer: ['hasan@x.de'],
    kunde_id: null,
    kunde_bereich: null,
    kunde_name: null,
    quelle: 'crm',
    erinnert: {},
    ...o,
  }
}

Deno.test('Termin-Erinnerung: geht einmal raus und wird vorher vermerkt', async () => {
  const db = new Db({ termine: [termin()], mitarbeiter: TEAM, kalender_einstellungen: [] })
  const gesendet: (number | string | null)[] = []
  const sende = async (chat: number | string | null) => {
    // Beim Senden steht der Vermerk schon in der Datenbank.
    assertEquals((db.tabellen.termine[0].erinnert as Record<string, number[]>)['eray@x.de'], [60])
    gesendet.push(chat)
    return true
  }
  assertEquals((await sendeErinnerungen(db, { sende, hatPrivatBot: async () => false })).gesendet, 2)
  assertEquals(gesendet.sort(), [1, 2])
  assertEquals((await sendeErinnerungen(db, { sende, hatPrivatBot: async () => false })).gesendet, 0)
  assertEquals(gesendet.length, 2)
})

Deno.test('Termin-Erinnerung: scheitert das Speichern, geht keine Nachricht raus (statt jede Minute)', async () => {
  const db = new Db({ termine: [termin()], mitarbeiter: TEAM, kalender_einstellungen: [] })
  db.updateFehler.termine = 'Verbindung weg'
  let n = 0
  const sende = async () => {
    n++
    return true
  }
  for (let i = 0; i < 3; i++) await sendeErinnerungen(db, { sende, hatPrivatBot: async () => false })
  assertEquals(n, 0)
})

Deno.test('Termin-Erinnerung: zwei gleichzeitige Läufe senden nicht doppelt', async () => {
  const db = new Db({ termine: [termin({ teilnehmer: [] })], mitarbeiter: TEAM, kalender_einstellungen: [] })
  let n = 0
  const sende = async () => {
    n++
    return true
  }
  await Promise.all([sendeErinnerungen(db, { sende, hatPrivatBot: async () => false }), sendeErinnerungen(db, { sende, hatPrivatBot: async () => false })])
  assertEquals(n, 1)
})

Deno.test('Termin-Erinnerung: privater Versand gescheitert → beim nächsten Lauf erneut, nie über den Mayer-Bot', async () => {
  const db = new Db({ termine: [termin({ teilnehmer: [] })], mitarbeiter: TEAM, kalender_einstellungen: [] })
  let mayer = 0
  let privatOk = false
  let privatVersuche = 0
  const v = {
    sende: async () => {
      mayer++
      return true
    },
    sendePrivat: async () => {
      privatVersuche++
      return privatOk
    },
    hatPrivatBot: async () => true,
  }
  assertEquals((await sendeErinnerungen(db, v)).gesendet, 0)
  assertEquals((db.tabellen.termine[0].erinnert as Record<string, number[]>)['eray@x.de'], [])
  privatOk = true
  assertEquals((await sendeErinnerungen(db, v)).gesendet, 1)
  assertEquals((await sendeErinnerungen(db, v)).gesendet, 0)
  assertEquals(mayer, 0)
  assertEquals(privatVersuche, 2)
})

function todo(o: Zeile = {}): Zeile {
  return {
    id: 'd1',
    aufgabe: 'Angebot schicken',
    bereich: null,
    besitzer_email: 'eray@x.de',
    zustaendig: null,
    kunde_projekt: null,
    erledigen_bis: null,
    erinnern_um: new Date(Date.now() - 60000).toISOString(),
    erinnert_am: null,
    erledigt_am: null,
    ...o,
  }
}

Deno.test('To-do-Erinnerung: scheitert das Vermerken, geht keine Nachricht raus', async () => {
  const db = new Db({ todos: [todo()], mitarbeiter: TEAM })
  db.updateFehler.todos = 'Verbindung weg'
  let n = 0
  const sende = async () => {
    n++
    return true
  }
  for (let i = 0; i < 3; i++) await sendeTodoErinnerungen(db, { sende, hatPrivatBot: async () => false })
  assertEquals(n, 0)
})

Deno.test('To-do-Erinnerung: einmal senden, gleichzeitige Läufe nicht doppelt', async () => {
  const db = new Db({ todos: [todo()], mitarbeiter: TEAM })
  let n = 0
  const sende = async () => {
    n++
    return true
  }
  await Promise.all([sendeTodoErinnerungen(db, { sende, hatPrivatBot: async () => false }), sendeTodoErinnerungen(db, { sende, hatPrivatBot: async () => false })])
  await sendeTodoErinnerungen(db, { sende, hatPrivatBot: async () => false })
  assertEquals(n, 1)
  assertEquals(typeof db.tabellen.todos[0].erinnert_am, 'string')
})

Deno.test('To-do-Erinnerung: Versand gescheitert → Vermerk zurück, nächster Lauf sendet', async () => {
  const db = new Db({ todos: [todo()], mitarbeiter: TEAM })
  let ok = false
  let n = 0
  const sende = async () => {
    n++
    return ok
  }
  assertEquals((await sendeTodoErinnerungen(db, { sende, hatPrivatBot: async () => false })).gesendet, 0)
  assertEquals(db.tabellen.todos[0].erinnert_am, null)
  ok = true
  assertEquals((await sendeTodoErinnerungen(db, { sende, hatPrivatBot: async () => false })).gesendet, 1)
  assertEquals(n, 2)
})

Deno.test('Gäste: Erinnerungsmail 1 Stunde vorher an Kunde und externe Gäste, je einmal', async () => {
  const db = new Db({
    termine: [termin({
      gast: { email: 'kunde@beispiel.test', name: 'Kunde', eingeladen: true, sequenz: 0 },
      gaeste: [{ email: 'gast@beispiel.test', name: 'Gast', eingeladen: true, sequenz: 0 }, { email: 'nicht@beispiel.test', eingeladen: false }],
      erinnert: { 'gast:kunde@beispiel.test': [1440], 'gast:gast@beispiel.test': [1440] },
    })],
    mitarbeiter: TEAM,
    kalender_einstellungen: [],
  })
  const mails: string[] = []
  const v = { sende: async () => true, hatPrivatBot: async () => false, sendeMail: async (to: string) => { mails.push(to) } }
  await sendeErinnerungen(db, v)
  assertEquals(mails.sort(), ['gast@beispiel.test', 'kunde@beispiel.test'])
  await sendeErinnerungen(db, v)
  assertEquals(mails.length, 2)
})
