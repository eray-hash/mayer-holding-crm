// To-dos über den Assistenten (Wünsche vom 23.11.2026): einem Kollegen zuweisen (todo_anlegen/todo_aendern mit fuer
// oder zuständig) samt Telegram-Mitteilung, und endgültig löschen (todo_loeschen) nur auf ausdrücklichen Wunsch.
// Kein Netz, keine echte Datenbank; Telegram wird über ein falsches fetch beobachtet.
//
//   npx -y deno test --allow-env --allow-read telegram-gateway/todoZuweisung.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { todoAendern, todoAnlegen, todoLoeschen, type MitteilungsWege } from './teamWerkzeuge.ts'
import { findeKollege, loeschWunsch, mitAbsender, zuweisungsMitteilung } from './todoZuweisung.ts'
import { mitBot } from './privatBot.ts'

type Zeile = Record<string, unknown>

// ---------- reine Helfer ----------

const TEAM = ['Anna Beispiel', 'Bernd Muster', 'Bernd Probe', 'Clara Test-Frei', 'Holding Mayer']

Deno.test('findeKollege: Vorname, Nachname, ganzer Name, Initiale.Nachname', () => {
  assertEquals(findeKollege('Anna', TEAM), { art: 'eindeutig', name: 'Anna Beispiel' })
  assertEquals(findeKollege('beispiel', TEAM), { art: 'eindeutig', name: 'Anna Beispiel' })
  assertEquals(findeKollege('Frau Beispiel', TEAM), { art: 'eindeutig', name: 'Anna Beispiel' })
  assertEquals(findeKollege('B. Muster', TEAM), { art: 'eindeutig', name: 'Bernd Muster' })
  assertEquals(findeKollege('Bernd Probe', TEAM), { art: 'eindeutig', name: 'Bernd Probe' })
})

Deno.test('findeKollege: mehrdeutig → alle passenden, unbekannt → keiner, Teilwort ab drei Buchstaben', () => {
  assertEquals(findeKollege('Bernd', TEAM), { art: 'mehrdeutig', namen: ['Bernd Muster', 'Bernd Probe'] })
  assertEquals(findeKollege('Steuerberater', TEAM), { art: 'keiner' })
  assertEquals(findeKollege('', TEAM), { art: 'keiner' })
  assertEquals(findeKollege('Clara Test', TEAM), { art: 'eindeutig', name: 'Clara Test-Frei' })
  assertEquals(findeKollege('An', TEAM), { art: 'keiner' })
})

Deno.test('loeschWunsch: nur ausdrücklich, auch als Antwort auf die Rückfrage; Dateien/Systemmeldungen nie', () => {
  assert(loeschWunsch(['Lösch bitte den Punkt Steuer']))
  assert(loeschWunsch(['nimm das von der Liste']))
  assert(loeschWunsch(['kannst du die Aufgabe entfernen?']))
  assert(loeschWunsch(['das kann weg']))
  assert(loeschWunsch(['streich das']))
  assert(loeschWunsch(['[Sprachnachricht des Mitarbeiters, automatisch abgehört — …]\nbitte loeschen']))
  assert(loeschWunsch(['ja', 'Soll das gelöscht werden? Ja, raus damit']))
  assert(!loeschWunsch(['ist erledigt']))
  assert(!loeschWunsch(['hak das ab', '']))
  assert(!loeschWunsch(['[Datei-Eingang] Vertrag: … Daten löschen nach 10 Jahren …']))
  assert(!loeschWunsch(['[Systemmeldung, nicht vom Mitarbeiter getippt] … löschen']))
  assert(!loeschWunsch([undefined, null]))
})

Deno.test('mitAbsender und Mitteilungstext', () => {
  assertEquals(mitAbsender('Exposé prüfen', 'Anna Beispiel'), 'Exposé prüfen (von Anna Beispiel)')
  assertEquals(mitAbsender('Exposé prüfen (von Bernd Muster)', 'Anna Beispiel'), 'Exposé prüfen (von Bernd Muster)')
  const t = zuweisungsMitteilung({ von: 'Anna Beispiel', aufgabe: 'Exposé prüfen', faellig: '27.11.2026', neu: true })
  assertStringIncludes(t, 'Neues To-do von Anna Beispiel')
  assertStringIncludes(t, 'bis 27.11.2026')
  assertStringIncludes(t, 'deiner To-do-Liste')
})

// ---------- mit Testdatenbank ----------

const ICH = { id: 'm_a', name: 'Anna Beispiel', email: 'anna@beispiel.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }
const MITARBEITER: Zeile[] = [
  { id: 'm_a', name: 'Anna Beispiel', email: 'anna@beispiel.de', aktiv: true, telegram_chat_id: 1, rolle: 'mitarbeiter', bereiche: ['immobilien'] },
  { id: 'm_b', name: 'Bernd Muster', email: 'bernd@beispiel.de', aktiv: true, telegram_chat_id: 2, rolle: 'mitarbeiter', bereiche: ['beratung'], telegram_pending: null },
  { id: 'm_c', name: 'Bernd Probe', email: 'probe@beispiel.de', aktiv: true, telegram_chat_id: null, rolle: 'mitarbeiter', bereiche: ['immobilien'] },
  { id: 'm_d', name: 'Clara Test-Frei', email: 'clara@beispiel.de', aktiv: true, telegram_chat_id: null, rolle: 'mitarbeiter', bereiche: ['immobilien'] },
]

/** Kleine Testdatenbank mit genau den Aufrufketten aus teamWerkzeuge.ts (select/insert/update/delete, Filter, order, limit). */
function falscheDb(tabellen: Record<string, Zeile[]>) {
  const wieIlike = (wert: unknown, muster: string) =>
    new RegExp(`^${muster.split('%').map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')).join('.*')}$`, 'is').test(String(wert ?? ''))
  const geloescht: string[] = []
  const from = (name: string) => {
    const zeilen = (tabellen[name] ??= [])
    const filter: ((z: Zeile) => boolean)[] = []
    let art: 'select' | 'update' | 'delete' | 'insert' = 'select'
    let patch: Zeile = {}
    let sortiert: { spalte: string; auf: boolean } | null = null
    let grenze = Infinity
    let einzel = false
    const q = {
      select: () => q,
      insert: (z: Zeile) => ((art = 'insert'), zeilen.push({ ...z }), q),
      update: (p: Zeile) => ((art = 'update'), (patch = p), q),
      delete: () => ((art = 'delete'), q),
      is: (s: string, w: null) => (filter.push((z) => (w === null ? z[s] === null || z[s] === undefined : z[s] === w)), q),
      not: (s: string, _op: string, _w: null) => (filter.push((z) => z[s] !== null && z[s] !== undefined), q),
      eq: (s: string, w: unknown) => (filter.push((z) => z[s] === w), q),
      ilike: (s: string, m: string) => (filter.push((z) => wieIlike(z[s], m)), q),
      order: (spalte: string, o: { ascending?: boolean } = {}) => ((sortiert = { spalte, auf: o.ascending !== false }), q),
      limit: (n: number) => ((grenze = n), q),
      maybeSingle: () => ((einzel = true), q),
      then: (ok: (e: unknown) => unknown) => {
        if (art === 'insert') return Promise.resolve({ data: null, error: null }).then(ok)
        let treffer = zeilen.filter((z) => filter.every((f) => f(z)))
        if (art === 'update') {
          for (const z of treffer) Object.assign(z, patch)
          return Promise.resolve({ data: null, error: null }).then(ok)
        }
        if (art === 'delete') {
          for (const z of treffer) {
            zeilen.splice(zeilen.indexOf(z), 1)
            geloescht.push(String(z.id))
          }
          return Promise.resolve({ data: null, error: null }).then(ok)
        }
        if (sortiert) {
          const { spalte, auf } = sortiert
          treffer = [...treffer].sort((a, b) => (Number(a[spalte] ?? 0) - Number(b[spalte] ?? 0) || String(a[spalte]).localeCompare(String(b[spalte]))) * (auf ? 1 : -1))
        }
        treffer = treffer.slice(0, grenze)
        return Promise.resolve(einzel ? { data: treffer[0] ?? null, error: null } : { data: treffer, error: null }).then(ok)
      },
    }
    return q
  }
  return { from, tabellen, geloescht, todo: (id: string) => tabellen.todos.find((z) => z.id === id) }
}

const todo = (id: string, aufgabe: string, besitzer: string | null, mehr: Zeile = {}): Zeile => ({
  id,
  aufgabe,
  besitzer_email: besitzer,
  bereich: null,
  erledigt_am: null,
  erledigen_bis: null,
  zustaendig: null,
  kunde_projekt: null,
  aktueller_stand: null,
  prio: null,
  erinnern_um: null,
  ms_id: null,
  reihenfolge: 1,
  updated_at: '2026-11-20T10:00:00Z',
  ...mehr,
})

/** Telegram beobachten: jedes sendMessage landet in `gesendet`. */
function mitTelegram<T>(arbeit: (wege: MitteilungsWege, gesendet: { chat_id: unknown; text: string }[]) => Promise<T>): Promise<T> {
  const gesendet: { chat_id: unknown; text: string }[] = []
  const echt = globalThis.fetch
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    gesendet.push(JSON.parse(String(init?.body ?? '{}')))
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }))
  }) as typeof fetch
  const wege: MitteilungsWege = { botToken: 'test', ladeState: () => ({ zuege: [] }), speichereZustand: () => Promise.resolve() }
  return arbeit(wege, gesendet).finally(() => {
    globalThis.fetch = echt
  })
}

Deno.test('todo_anlegen mit fuer: in die Liste des Kollegen, Absender in Klammern, Telegram-Nachricht, Antwort nennt die Zuweisung', async () => {
  const db = falscheDb({ mitarbeiter: structuredClone(MITARBEITER), todos: [todo('todo_alt', 'Alt', 'bernd@beispiel.de', { reihenfolge: 7 })] })
  await mitTelegram(async (wege, gesendet) => {
    const antwort = await todoAnlegen(db, ICH, { aufgabe: 'Exposé prüfen', fuer: 'Muster', erledigen_bis: '27.11.2026' }, () => {}, wege)
    assert(antwort.startsWith('ZUGEWIESEN AN Bernd Muster'), antwort)
    assertStringIncludes(antwort, 'per Telegram benachrichtigt')
    const neu = db.tabellen.todos.find((z) => z.id !== 'todo_alt')!
    assertEquals(neu.besitzer_email, 'bernd@beispiel.de')
    assertEquals(neu.zustaendig, 'Bernd Muster')
    assertEquals(neu.aufgabe, 'Exposé prüfen (von Anna Beispiel)')
    assertEquals(neu.reihenfolge, 8)
    assertEquals(gesendet.length, 1)
    assertEquals(gesendet[0].chat_id, 2)
    assertStringIncludes(gesendet[0].text, 'Neues To-do von Anna Beispiel')
  })
})

Deno.test('todo_anlegen: zuständig = Kollege gilt als Zuweisung (vorher blieb es still in der eigenen Liste)', async () => {
  const db = falscheDb({ mitarbeiter: structuredClone(MITARBEITER), todos: [] })
  await mitTelegram(async (wege) => {
    const antwort = await todoAnlegen(db, ICH, { aufgabe: 'Grundbuch anfordern', zustaendig: 'Clara' }, () => {}, wege)
    assertStringIncludes(antwort, 'ZUGEWIESEN AN Clara Test-Frei')
    assertStringIncludes(antwort, 'nicht mit Telegram verbunden')
    assertEquals(db.tabellen.todos[0].besitzer_email, 'clara@beispiel.de')
  })
})

Deno.test('todo_anlegen: Externer in zuständig bleibt Text in der eigenen Liste; mehrdeutiger Kollege → Rückfrage mit Liste', async () => {
  const db = falscheDb({ mitarbeiter: structuredClone(MITARBEITER), todos: [] })
  const extern = await todoAnlegen(db, ICH, { aufgabe: 'Unterlagen schicken', zustaendig: 'Steuerberater' }, () => {})
  assert(!extern.includes('ZUGEWIESEN'), extern)
  assertEquals(db.tabellen.todos[0].besitzer_email, 'anna@beispiel.de')
  assertEquals(db.tabellen.todos[0].zustaendig, 'Steuerberater')
  const unklar = await todoAnlegen(db, ICH, { aufgabe: 'X', fuer: 'Bernd' }, () => {})
  assertStringIncludes(unklar, 'kein eindeutiger Kollege')
  assertStringIncludes(unklar, 'Bernd Muster, Bernd Probe')
  assertStringIncludes(unklar, 'Aktive Kollegen')
  const unbekannt = await todoAnlegen(db, ICH, { aufgabe: 'X', fuer: 'Niemand' }, () => {})
  assertStringIncludes(unbekannt, 'kein eindeutiger Kollege')
  assertEquals(db.tabellen.todos.length, 1)
})

Deno.test('todo_anlegen mit bereich + Kollege: bleibt in der Bereichsliste, Kollege zuständig und benachrichtigt; Hinweis ohne Bereichsrecht', async () => {
  const db = falscheDb({ mitarbeiter: structuredClone(MITARBEITER), todos: [] })
  await mitTelegram(async (wege, gesendet) => {
    const antwort = await todoAnlegen(db, ICH, { aufgabe: 'Besichtigung planen', bereich: 'immobilien', fuer: 'Bernd Muster' }, () => {}, wege)
    assertStringIncludes(antwort, 'ZUGEWIESEN AN Bernd Muster')
    assertStringIncludes(antwort, 'nicht freigegeben')
    assertEquals(db.tabellen.todos[0].bereich, 'immobilien')
    assertEquals(db.tabellen.todos[0].zustaendig, 'Bernd Muster')
    assertStringIncludes(gesendet[0].text, 'To-do-Liste Immobilien')
  })
})

Deno.test('todo_aendern mit fuer: eigenes To-do wandert zum Kollegen und er bekommt Bescheid', async () => {
  const db = falscheDb({ mitarbeiter: structuredClone(MITARBEITER), todos: [todo('todo_1', 'Mieter anrufen', 'anna@beispiel.de')] })
  await mitTelegram(async (wege, gesendet) => {
    const antwort = await todoAendern(db, ICH, { suchbegriff: 'Mieter', fuer: 'Bernd Muster' }, () => {}, wege)
    assertStringIncludes(antwort, 'ZUGEWIESEN AN Bernd Muster')
    const t = db.todo('todo_1')!
    assertEquals(t.besitzer_email, 'bernd@beispiel.de')
    assertEquals(t.zustaendig, 'Bernd Muster')
    assertEquals(t.aufgabe, 'Mieter anrufen (von Anna Beispiel)')
    assertEquals(gesendet.length, 1)
  })
})

Deno.test('todo_aendern: Microsoft-Aufgabe wird nicht verschoben, unklarer Name ändert nichts', async () => {
  const db = falscheDb({ mitarbeiter: structuredClone(MITARBEITER), todos: [todo('todo_ms', 'Strom', 'anna@beispiel.de', { ms_id: 'AAA' })] })
  assertStringIncludes(await todoAendern(db, ICH, { todo_id: 'todo_ms', fuer: 'Bernd Muster' }, () => {}), 'Microsoft To Do')
  assertStringIncludes(await todoAendern(db, ICH, { todo_id: 'todo_ms', fuer: 'Bernd', prio: 'A' }, () => {}), 'kein eindeutiger Kollege')
  assertEquals(db.todo('todo_ms')!.besitzer_email, 'anna@beispiel.de')
  assertEquals(db.todo('todo_ms')!.prio, null)
})

Deno.test('todo_loeschen: nur auf ausdrücklichen Wunsch, auch abgehakte, nur eigene Liste/Bereichsliste', async () => {
  const db = falscheDb({
    mitarbeiter: structuredClone(MITARBEITER),
    todos: [
      todo('todo_e', 'Steuer sortieren', 'anna@beispiel.de', { erledigt_am: '2026-11-23' }),
      todo('todo_f', 'Steuer fremd', 'bernd@beispiel.de'),
      todo('todo_b', 'Bereich Sache', null, { bereich: 'immobilien' }),
      todo('todo_x', 'Bereich fremd', null, { bereich: 'beratung' }),
    ],
  })
  const ohneWunsch = await todoLoeschen(db, ICH, { suchbegriff: 'Steuer' }, () => {}, ['ist erledigt'])
  assert(ohneWunsch.startsWith('Nicht gelöscht'), ohneWunsch)
  assertEquals(db.geloescht, [])
  const ok = await todoLoeschen(db, ICH, { suchbegriff: 'Steuer' }, () => {}, ['Lösch den Punkt Steuer'])
  assertStringIncludes(ok, 'Gelöscht (eigene Liste)')
  assertEquals(db.geloescht, ['todo_e'])
  assertStringIncludes(await todoLoeschen(db, ICH, { todo_id: 'todo_f' }, () => {}, ['löschen']), 'Kein passendes To-do')
  assertStringIncludes(await todoLoeschen(db, ICH, { todo_id: 'todo_x' }, () => {}, ['löschen']), 'Kein passendes To-do')
  assertStringIncludes(await todoLoeschen(db, ICH, { todo_id: 'todo_b' }, () => {}, ['entfernen']), 'Liste Immobilien')
  assertEquals(db.geloescht, ['todo_e', 'todo_b'])
})

Deno.test('todo_loeschen: Microsoft-Aufgabe nur im privaten Assistenten', async () => {
  const db = falscheDb({ mitarbeiter: structuredClone(MITARBEITER), todos: [todo('todo_ms', 'Strom', 'anna@beispiel.de', { ms_id: 'AAA' })] })
  assertStringIncludes(await todoLoeschen(db, ICH, { todo_id: 'todo_ms' }, () => {}, ['löschen']), 'Nicht gelöscht')
  assertEquals(db.geloescht, [])
  const privat = await mitBot(true, () => todoLoeschen(db, { ...ICH, nurPrivat: true }, { todo_id: 'todo_ms' }, () => {}, ['löschen']))
  assertStringIncludes(privat, 'Gelöscht (private Liste)')
  assertStringIncludes(privat, 'Microsoft To Do')
  assertEquals(db.geloescht, ['todo_ms'])
})
