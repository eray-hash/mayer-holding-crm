// Wiederkehrende To-do-Erinnerungen (todoErinnerung.ts, Spalte todos.erinnerung_wiederholung, 25.11.2026).
//   npx -y deno test --allow-all --no-check email-gateway/todoWiederholung.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { naechsteWiederholung, sendeTodoErinnerungen } from './todoErinnerung.ts'

// Mittwoch, 25.11.2026, 09:00 Berlin (Winterzeit) = 08:00 UTC
const MI_9 = '2026-11-25T08:00:00.000Z'

Deno.test('naechsteWiederholung: täglich, wöchentlich, werktags über das Wochenende', () => {
  const nach = Date.parse(MI_9) + 60000
  assertEquals(naechsteWiederholung(MI_9, 'taeglich', nach), '2026-11-26T08:00:00.000Z')
  assertEquals(naechsteWiederholung(MI_9, 'woechentlich', nach), '2026-12-02T08:00:00.000Z')
  assertEquals(naechsteWiederholung(MI_9, 'werktags', nach), '2026-11-26T08:00:00.000Z')
  // Freitag 27.11. 09:00 → Montag 30.11. 09:00
  const fr = '2026-11-27T08:00:00.000Z'
  assertEquals(naechsteWiederholung(fr, 'werktags', Date.parse(fr) + 1), '2026-11-30T08:00:00.000Z')
  // Samstag als Start (z. B. von Hand gesetzt) → Montag
  const sa = '2026-11-28T08:00:00.000Z'
  assertEquals(naechsteWiederholung(sa, 'werktags', Date.parse(sa) + 1), '2026-11-30T08:00:00.000Z')
})

Deno.test('naechsteWiederholung: gleiche Berliner Uhrzeit über die Zeitumstellung, immer in der Zukunft', () => {
  // Sa 27.03.2027 09:00 MEZ = 08:00 UTC → So 28.03.2027 09:00 MESZ = 07:00 UTC
  assertEquals(naechsteWiederholung('2027-03-27T08:00:00.000Z', 'taeglich', Date.parse('2027-03-27T08:00:01.000Z')), '2027-03-28T07:00:00.000Z')
  // Langer Stillstand: das erste Vorkommen nach „jetzt“
  const jetzt = Date.parse('2026-12-10T12:00:00.000Z')
  assertEquals(naechsteWiederholung(MI_9, 'taeglich', jetzt), '2026-12-11T08:00:00.000Z')
  assertEquals(naechsteWiederholung(MI_9, 'woechentlich', jetzt), '2026-12-16T08:00:00.000Z')
})

Deno.test('naechsteWiederholung: einmalig oder Unsinn → null', () => {
  assertEquals(naechsteWiederholung(MI_9, null), null)
  assertEquals(naechsteWiederholung(MI_9, ''), null)
  assertEquals(naechsteWiederholung(MI_9, 'monatlich'), null)
  assertEquals(naechsteWiederholung('kein Datum', 'taeglich'), null)
})

const TEAM = [{ id: 'm1', name: 'Erika Beispiel', email: 'erika@firma.de', telegram_chat_id: 101, aktiv: true }]

function todo(o: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    aufgabe: 'Angebot schicken',
    bereich: null,
    besitzer_email: 'erika@firma.de',
    zustaendig: null,
    kunde_projekt: null,
    erledigen_bis: null,
    erinnern_um: MI_9,
    erinnert_am: null,
    erledigt_am: null,
    erinnerung_wiederholung: 'taeglich',
    ...o,
  }
}

function versand(texte: string[], jetzt: number, ok = true) {
  return {
    jetzt: () => jetzt,
    sende: async (_chat: number | string | null, text: string) => {
      texte.push(text)
      return ok
    },
    hatPrivatBot: async () => false,
  }
}

Deno.test('Täglich: senden mit Hinweis, dann auf morgen 09:00 rücken; zweiter Lauf sendet nichts', async () => {
  const db = falscheDatenbank({ todos: [todo()], mitarbeiter: TEAM })
  const texte: string[] = []
  const jetzt = Date.parse(MI_9) + 30000
  assertEquals((await sendeTodoErinnerungen(db, versand(texte, jetzt))).gesendet, 1)
  assert(texte[0].startsWith('⏰ Erinnerung: Angebot schicken (wiederholt sich täglich, bis erledigt)'))
  const z = db.tabelle('todos')[0]
  assertEquals(z.erinnern_um, '2026-11-26T08:00:00.000Z')
  assertEquals(z.erinnert_am, null)
  assertEquals((await sendeTodoErinnerungen(db, versand(texte, jetzt + 60000))).gesendet, 0)
  // Am nächsten Tag zur gleichen Uhrzeit wieder
  assertEquals((await sendeTodoErinnerungen(db, versand(texte, Date.parse('2026-11-26T08:00:20.000Z')))).gesendet, 1)
  assertEquals(db.tabelle('todos')[0].erinnern_um, '2026-11-27T08:00:00.000Z')
})

Deno.test('Einmalig bleibt wie bisher: gesendet = erinnert_am gesetzt, Zeit bleibt', async () => {
  const db = falscheDatenbank({ todos: [todo({ erinnerung_wiederholung: null })], mitarbeiter: TEAM })
  const texte: string[] = []
  assertEquals((await sendeTodoErinnerungen(db, versand(texte, Date.parse(MI_9) + 30000))).gesendet, 1)
  assert(!texte[0].includes('wiederholt'))
  const z = db.tabelle('todos')[0]
  assertEquals(z.erinnern_um, MI_9)
  assert(typeof z.erinnert_am === 'string')
})

Deno.test('Wiederkehrend und länger als 2 Tage überfällig: nicht abhaken, sondern aufs nächste künftige Vorkommen', async () => {
  const db = falscheDatenbank({ todos: [todo({ erinnerung_wiederholung: 'werktags' })], mitarbeiter: TEAM })
  const texte: string[] = []
  // Freitag 04.12.2026 12:00 Berlin → nächstes Vorkommen Montag 07.12. 09:00
  assertEquals((await sendeTodoErinnerungen(db, versand(texte, Date.parse('2026-12-04T11:00:00.000Z')))).gesendet, 0)
  assertEquals(texte.length, 0)
  const z = db.tabelle('todos')[0]
  assertEquals(z.erinnern_um, '2026-12-07T08:00:00.000Z')
  assertEquals(z.erinnert_am, null)
})

Deno.test('Wiederkehrend, Versand gescheitert: Vermerk zurück, Zeit bleibt (nächster Lauf versucht es erneut)', async () => {
  const db = falscheDatenbank({ todos: [todo()], mitarbeiter: TEAM })
  const texte: string[] = []
  assertEquals((await sendeTodoErinnerungen(db, versand(texte, Date.parse(MI_9) + 30000, false))).gesendet, 0)
  const z = db.tabelle('todos')[0]
  assertEquals(z.erinnern_um, MI_9)
  assertEquals(z.erinnert_am, null)
})

Deno.test('Wiederkehrend, Empfänger ohne Telegram: nicht abhaken, nächstes Vorkommen', async () => {
  const db = falscheDatenbank({ todos: [todo()], mitarbeiter: [{ ...TEAM[0], telegram_chat_id: null }] })
  assertEquals((await sendeTodoErinnerungen(db, versand([], Date.parse(MI_9) + 30000))).gesendet, 0)
  const z = db.tabelle('todos')[0]
  assertEquals(z.erinnern_um, '2026-11-26T08:00:00.000Z')
  assertEquals(z.erinnert_am, null)
})

Deno.test('Spalte noch nicht angelegt: Abfrage ohne sie, Erinnerung geht einmalig raus', async () => {
  const echt = falscheDatenbank({ todos: [todo({ erinnerung_wiederholung: undefined })], mitarbeiter: TEAM })
  // Wie PostgREST ohne die Spalte: Fehler, sobald sie in der Spaltenliste steht.
  const fehler = { data: null, error: { message: 'column todos.erinnerung_wiederholung does not exist' } }
  const kette: Record<string, unknown> = {}
  for (const m of ['is', 'not', 'lte', 'order', 'limit', 'eq']) kette[m] = () => kette
  kette.then = (ok: (e: unknown) => unknown) => Promise.resolve(fehler).then(ok)
  const db = {
    from(t: string) {
      const q = echt.from(t)
      const select = q.select.bind(q)
      return Object.assign(q, { select: (s?: string) => (String(s ?? '').includes('erinnerung_wiederholung') ? kette : select(s)) })
    },
  }
  const texte: string[] = []
  assertEquals((await sendeTodoErinnerungen(db, versand(texte, Date.parse(MI_9) + 30000))).gesendet, 1)
  assert(typeof echt.tabelle('todos')[0].erinnert_am === 'string')
})
