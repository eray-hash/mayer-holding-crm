// Prüft die Aktion `tagesplan` (Lösungsvorschläge, Anruf notieren) und die Telegram-Meldungen morgens/abends mit der
// Test-Datenbank — ohne Netz und ohne echte KI.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { bereinigeLoesungen, loesungsPrompt, tagesplanAktion, type TagesplanHelfer } from './tagesplan.ts'
import { fenster, sendeTagesplanMeldungen } from './tagesplanMeldungen.ts'
import type { PlanTag } from '../_shared/tagesplanKern.ts'

const QUIRIN = 'immo@amayer-holding.com'

function db() {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', name: 'Quirin Lutzenberger', email: QUIRIN, rolle: 'mitarbeiter', bereiche: ['immobilien'], aktiv: true, telegram_chat_id: 111 },
      { id: 'm2', name: 'Hasan Süslü', email: 'privat.gf@beispiel.de', rolle: 'geschaeftsfuehrung', aktiv: true, telegram_chat_id: 222 },
      { id: 'm3', name: 'Ohne Telegram', email: 'ohne@x.de', rolle: 'mitarbeiter', bereiche: ['immobilien'], aktiv: true, telegram_chat_id: null },
    ],
    todos: [
      { id: 't1', besitzer_email: QUIRIN, bereich: null, aufgabe: 'Umbau / Teilungserklärung', kunde_projekt: 'Otilie Mayr', prio: 'A', umsatz_wert: 45000, welche_fragen: 'Bauamt kann Bauakte nicht schicken. Wie bekomme ich die Daten?', erledigt_am: null, bezug: { art: 'objekt', id: 'o_mayr', name: 'Ottilye Mayr' } },
      { id: 't2', besitzer_email: 'privat.gf@beispiel.de', bereich: null, aufgabe: 'Privat Hasan', erledigt_am: null },
      { id: 't3', besitzer_email: QUIRIN, bereich: null, aufgabe: 'Fristsache Bank', prio: 'C', erledigen_bis: '2026-11-20', erledigt_am: null },
    ],
    todo_freigaben: [],
    objekte: [{ id: 'o_mayr', bezeichnung: 'Ottilye Mayr', adresse: '', typ: 'MFH', status: 'akquise', activities: [{ id: 'a0', date: '2026-11-01', text: 'Pläne von Nadja Mayr erhalten', user: 'QL' }], privat_besitzer: null }],
    kunden: [{ id: 'k1', bereich: 'immobilienkunden', firma: 'Claudia Corvalli', activities: [], status: 'neu' }],
    tagesplan_einstellungen: [
      { email: QUIRIN, morgen_an: true, abend_an: true },
      { email: 'privat.gf@beispiel.de', morgen_an: false, abend_an: false },
      { email: 'ohne@x.de', morgen_an: true, abend_an: true },
    ],
    tagesplan_meldungen: [],
    abteilung_eintraege: [],
    wiedervorlagen: [],
    termine: [],
    willkommen_einstellung: [],
  })
}

const erlaubt: TagesplanHelfer = { darfKunde: async () => true, darfObjekt: async () => true, darfBereich: async () => true }

Deno.test('loesungen: Prompt mit To-do und Objekt, drei bereinigte Vorschläge; fremdes To-do verboten', async () => {
  const d = db()
  let prompt = ''
  const ki = async (p: string) => {
    prompt = p
    return { vorschlaege: [{ titel: 'Archiv anfragen', schritt: 'Beim Bauamt Einsicht ins Archiv beantragen', warum: 'Pläne liegen dort' }, { titel: 'Architekt', schritt: 'Hans Hicker anrufen', warum: 'Hat alte Pläne' }, { titel: 'Aufmaß', schritt: 'Neues Aufmaß beauftragen', warum: 'Unabhängig vom Amt' }, { titel: 'zu viel', schritt: 'x', warum: 'y' }] }
  }
  const r = await tagesplanAktion(d, { email: QUIRIN }, { art: 'loesungen', todoId: 't1' }, { ...erlaubt, ki })
  assertEquals(r.status, 200)
  assertEquals((r.body.vorschlaege as unknown[]).length, 3)
  assertEquals(r.body.mitAkte, true)
  assertStringIncludes(prompt, 'Offene Fragen: Bauamt kann Bauakte nicht schicken.')
  assertStringIncludes(prompt, 'Objekt: Ottilye Mayr')
  assertStringIncludes(prompt, 'Pläne von Nadja Mayr erhalten')
  const fremd = await tagesplanAktion(d, { email: QUIRIN }, { art: 'loesungen', todoId: 't2' }, { ...erlaubt, ki })
  assertEquals(fremd.status, 403)
  // Ohne Recht auf das Objekt: Vorschläge ohne Objektdaten.
  await tagesplanAktion(d, { email: QUIRIN }, { art: 'loesungen', todoId: 't1' }, { ...erlaubt, darfObjekt: async () => false, ki })
  assert(!prompt.includes('Objekt: Ottilye Mayr'))
  assertEquals(bereinigeLoesungen({ vorschlaege: [{ titel: '', schritt: 'x' }, { titel: 'T', schritt: 'S', warum: 'W' }] }), [{ titel: 'T', schritt: 'S', warum: 'W' }])
  assertStringIncludes(loesungsPrompt({ aufgabe: 'A' }, ''), 'keine englischen Wörter')
})

Deno.test('anruf_notieren: Verlauf oben ergänzt (Objekt und Akte), ohne Recht verboten, ohne Text Fehler', async () => {
  const d = db()
  const r = await tagesplanAktion(d, { email: QUIRIN }, { art: 'anruf_notieren', bezug: { art: 'objekt', id: 'o_mayr', name: 'Ottilye Mayr' }, text: 'Architekt erreicht, schickt Pläne' }, erlaubt)
  assertEquals(r.status, 200)
  const o = d.tabelle('objekte')[0] as { activities: { text: string; user: string }[] }
  assertEquals(o.activities.length, 2)
  assertEquals([o.activities[0].text, o.activities[0].user], ['Anruf: Architekt erreicht, schickt Pläne', 'Quirin Lutzenberger'])
  const k = await tagesplanAktion(d, { email: QUIRIN }, { art: 'anruf_notieren', bezug: { art: 'kunde', id: 'k1', name: 'Corvalli' }, text: 'Rückruf Montag' }, erlaubt)
  assertEquals(k.status, 200)
  assert((d.tabelle('kunden')[0] as { letzte_aktivitaet?: string }).letzte_aktivitaet)
  assertEquals((await tagesplanAktion(d, { email: QUIRIN }, { art: 'anruf_notieren', bezug: { art: 'kunde', id: 'k1' }, text: 'x' }, { ...erlaubt, darfKunde: async () => false })).status, 403)
  assertEquals((await tagesplanAktion(d, { email: QUIRIN }, { art: 'anruf_notieren', bezug: { art: 'kunde', id: 'k1' }, text: ' ' }, erlaubt)).status, 400)
  assertEquals((await tagesplanAktion(d, { email: QUIRIN }, { art: 'quatsch' }, erlaubt)).status, 400)
})

Deno.test('Zeitfenster: werktags 7:45–9:30 und 17:30–19:00 Berliner Zeit', () => {
  assertEquals(fenster(new Date('2026-11-23T06:44:00Z')), null) // 7:44 MEZ
  assertEquals(fenster(new Date('2026-11-23T06:45:00Z'))?.art, 'morgen')
  assertEquals(fenster(new Date('2026-11-23T08:29:00Z'))?.art, 'morgen')
  assertEquals(fenster(new Date('2026-11-23T08:30:00Z')), null)
  assertEquals(fenster(new Date('2026-11-23T16:30:00Z'))?.art, 'abend')
  assertEquals(fenster(new Date('2026-11-22T06:50:00Z')), null) // Sonntag
  assertEquals(fenster(new Date('2026-07-06T05:45:00Z'))?.art, 'morgen') // Sommerzeit: 7:45 MESZ
})

Deno.test('Morgen: baut und speichert den Plan, sendet einmal, nur an Eingeschaltete mit Telegram', async () => {
  const d = db()
  const gesendet: [number | string, string][] = []
  const sende = async (chat: number | string, text: string) => (gesendet.push([chat, text]), true)
  const jetzt = new Date('2026-11-23T06:50:00Z')
  const r = await sendeTagesplanMeldungen(d, { sende, jetzt, linkBasis: 'https://crm/' })
  assertEquals(r.morgen, 1)
  assertEquals(gesendet.length, 1)
  assertEquals(gesendet[0][0], 111)
  assertStringIncludes(gesendet[0][1], '☀️ Dein Tag – Montag, 23.11.')
  assertStringIncludes(gesendet[0][1], 'Fristsache Bank')
  assertStringIncludes(gesendet[0][1], 'A1 Umbau / Teilungserklärung (Otilie Mayr) (45 Tsd. €)')
  assertStringIncludes(gesendet[0][1], 'https://crm/#/immobilien/tagesablauf')
  const plan = d.tabelle('abteilung_eintraege').find((z) => z.id === 'Quirin Lutzenberger|2026-11-23')?.daten as PlanTag
  assert(plan && plan.zeilen.some((z) => z.todoId === 't1'))
  // Zweiter Takt: nichts mehr.
  await sendeTagesplanMeldungen(d, { sende, jetzt: new Date('2026-11-23T06:51:00Z'), linkBasis: 'https://crm/' })
  assertEquals(gesendet.length, 1)
  assertEquals(d.tabelle('tagesplan_meldungen').filter((z) => z.email === QUIRIN).length, 1)
})

Deno.test('Abend: offene Einträge (anderswo erledigte To-dos zählen nicht), sonst keine Nachricht', async () => {
  const d = db()
  const gesendet: string[] = []
  const sende = async (_c: number | string, text: string) => (gesendet.push(text), true)
  // Ohne Plan: nichts.
  await sendeTagesplanMeldungen(d, { sende, jetzt: new Date('2026-11-23T16:31:00Z'), linkBasis: 'https://crm/' })
  assertEquals(gesendet.length, 0)
  const d2 = db()
  await sendeTagesplanMeldungen(d2, { sende: async () => true, jetzt: new Date('2026-11-23T06:50:00Z'), linkBasis: 'https://crm/' })
  ;(d2.tabelle('todos').find((t) => t.id === 't3') as { erledigt_am: string | null }).erledigt_am = '2026-11-23'
  await sendeTagesplanMeldungen(d2, { sende, jetzt: new Date('2026-11-23T16:31:00Z'), linkBasis: 'https://crm/' })
  assertEquals(gesendet.length, 1)
  assertStringIncludes(gesendet[0], '🌙 Offen geblieben – morgen übernehmen?')
  assertStringIncludes(gesendet[0], 'Umbau / Teilungserklärung')
  assert(!gesendet[0].includes('Fristsache Bank'))
})
