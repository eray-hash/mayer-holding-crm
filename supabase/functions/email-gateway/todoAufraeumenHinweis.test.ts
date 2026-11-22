// Prüft den monatlichen Aufräum-Hinweis: Zeitfenster (werktags 9 Uhr, sonst kein Datenbankzugriff), nur wer ihn
// eingeschaltet hat, einmal je Monat, Mindestanzahl, privater Bot für private Listen (nie ersatzweise Mayer-Bot).
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { berlinJetzt, type HinweisWege, pruefeTodoAufraeumHinweise } from './todoAufraeumenHinweis.ts'

// Montag, 2. November 2026, 9:15 Uhr in Berlin (MEZ = UTC+1)
const MONTAG_9 = new Date('2026-11-02T08:15:00Z')

function alteTodos(besitzer: string, n: number, mehr: Zeile = {}): Zeile[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${besitzer}-${i}`, aufgabe: `Alte Sache ${i}`, besitzer_email: besitzer, bereich: null, erledigt_am: null, erstellt_am: '2024-01-01', ...mehr }))
}

function aufbau(o: { privat?: string[] } = {}) {
  const db = falscheDatenbank({
    todo_aufraeumen_einstellungen: [
      { email: 'an@m.de', monatlich_hinweis: true, zuletzt_monat: null },
      { email: 'aus@m.de', monatlich_hinweis: false, zuletzt_monat: null },
      { email: 'wenig@m.de', monatlich_hinweis: true, zuletzt_monat: '2026-10' },
      { email: 'hasan@m.de', monatlich_hinweis: true, zuletzt_monat: null },
    ],
    mitarbeiter: [
      { email: 'an@m.de', telegram_chat_id: 1, aktiv: true },
      { email: 'aus@m.de', telegram_chat_id: 2, aktiv: true },
      { email: 'wenig@m.de', telegram_chat_id: 3, aktiv: true },
      { email: 'hasan@m.de', telegram_chat_id: 4, aktiv: true },
    ],
    todos: [
      ...alteTodos('an@m.de', 12),
      ...alteTodos('an@m.de', 30, { ms_id: 'x', ms_geaendert: '2022-01-01T00:00:00Z' }).map((z, i) => ({ ...z, id: `an-ms-${i}`, ms_id: `ms${i}` })),
      ...alteTodos('aus@m.de', 50),
      ...alteTodos('wenig@m.de', 3),
      ...alteTodos('hasan@m.de', 20, {}).map((z, i) => ({ ...z, ms_id: `h${i}`, ms_geaendert: '2022-01-01T00:00:00Z' })),
    ],
  })
  const mayer: [number | string, string][] = []
  const privat: [number | string, string][] = []
  const wege: HinweisWege = {
    sendeMayer: (c, t) => (mayer.push([c, t]), Promise.resolve(true)),
    sendePrivat: (c, t) => (privat.push([c, t]), Promise.resolve(true)),
    privatBotAktiv: (e) => Promise.resolve((o.privat ?? []).includes(e)),
  }
  return { db, mayer, privat, wege }
}

Deno.test('berlinJetzt rechnet in deutscher Zeit', () => {
  assertEquals(berlinJetzt(MONTAG_9), { wochentag: 1, stunde: 9, datum: '2026-11-02', monat: '2026-11' })
})

Deno.test('außerhalb des Fensters: kein Lauf, kein Datenbankzugriff', async () => {
  const { db, wege } = aufbau()
  let zugriffe = 0
  db.nachAbfrage = () => void zugriffe++
  assertEquals((await pruefeTodoAufraeumHinweise(db, wege, new Date('2026-11-02T10:15:00Z'))).gelaufen, false) // 11 Uhr
  assertEquals((await pruefeTodoAufraeumHinweise(db, wege, new Date('2026-11-01T08:15:00Z'))).gelaufen, false) // Sonntag
  assertEquals(zugriffe, 0)
})

Deno.test('nur Eingeschaltete, Mindestanzahl, ohne Microsoft im Mayer-Bot, einmal je Monat', async () => {
  const { db, mayer, privat, wege } = aufbau()
  const r = await pruefeTodoAufraeumHinweise(db, wege, MONTAG_9)
  assertEquals(r.gesendet, 1)
  assertEquals(mayer.length, 1)
  assertEquals(mayer[0][0], 1)
  assertStringIncludes(mayer[0][1], '12 Aufgaben') // ohne die 30 aus Microsoft
  assertStringIncludes(mayer[0][1], 'eigenen To-do-Liste')
  assertEquals(privat.length, 0) // hasan ohne privaten Bot: Microsoft-Aufgaben zählen im Mayer-Bot nicht → unter 10
  assertEquals(db.tabelle('todo_aufraeumen_einstellungen').find((z) => z.email === 'wenig@m.de')!.zuletzt_monat, '2026-11')
  assertEquals(db.tabelle('todo_aufraeumen_einstellungen').find((z) => z.email === 'aus@m.de')!.zuletzt_monat, null)
  // Zweiter Lauf im selben Monat: nichts
  const zweiter = await pruefeTodoAufraeumHinweise(db, wege, new Date('2026-11-03T08:30:00Z'))
  assertEquals(zweiter.gesendet, 0)
  assertEquals(mayer.length, 1)
})

Deno.test('private Liste: nur über den privaten Bot, mit Microsoft-Aufgaben', async () => {
  const { db, mayer, privat, wege } = aufbau({ privat: ['hasan@m.de'] })
  await pruefeTodoAufraeumHinweise(db, wege, MONTAG_9)
  assertEquals(privat.length, 1)
  assertEquals(privat[0][0], 4)
  assertStringIncludes(privat[0][1], '20 Aufgaben')
  assertStringIncludes(privat[0][1], 'privaten To-do-Liste')
  assertEquals(mayer.filter(([c]) => c === 4).length, 0)
})
