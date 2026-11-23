// Prüft den Aufgaben-Teil der Morgen-Übersicht nach Runde 6 (ohne Netz):
// - Microsoft To Do nie über den Mayer-Bot („Privat bleibt privat“, wie todoAufraeumenHinweis.ts),
// - mit privatem Assistenten die ganze eigene Liste nur in der Privat-Übersicht,
// - Microsoft-Aufgaben älter als 90 Tage und aus ausgeblendeten Listen fehlen,
// - Reihenfolge: heute Fälliges, dann die neuesten Überfälligen.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { aufgabenZeilen, type Daten, morgenNachrichten, morgenText, type Person } from './tagesmeldung.ts'
import { ausgeblendeteListen, ausgeschlosseneListen, listenEintraege } from './todoAbgleich.ts'

const HEUTE = '2026-11-23'
const JETZT = new Date('2026-11-23T07:05:00Z') // Montag 8:05 Uhr in Berlin
const HASAN: Person = { email: 'h@x.de', name: 'Hasan Süslü', chat: 222, gf: false, bereiche: ['beratung'] }

function todo(id: string, aufgabe: string, extra: Record<string, unknown> = {}) {
  return { id, besitzer_email: 'h@x.de', bereich: null, aufgabe, kunde_projekt: null, zustaendig: null, erledigt_am: null, erledigen_bis: null, geplante_wiedervorlage: null, ms_id: null, ms_liste_id: null, ...extra }
}

function daten(): Daten {
  return {
    kunden: [],
    objekte: [],
    termine: [],
    treffer: [],
    fragen: [],
    ungeklaert: 0,
    trefferErststand: null,
    todos: [
      todo('t_crm_alt', 'CRM alt', { erledigen_bis: '2026-01-10' }),
      todo('t_crm_heute', 'CRM heute', { erledigen_bis: HEUTE }),
      todo('t_crm_neu', 'CRM neu überfällig', { erledigen_bis: '2026-11-20' }),
      todo('t_ms_neu', 'Microsoft neu', { erledigen_bis: '2026-11-21', ms_id: 'M1', ms_liste_id: 'L-aufgaben' }),
      todo('t_ms_2020', 'Microsoft 2020', { erledigen_bis: '2020-05-01', ms_id: 'M2', ms_liste_id: 'L-aufgaben' }),
      todo('t_ms_flag', 'Markierte Mail', { erledigen_bis: '2026-11-22', ms_id: 'M3', ms_liste_id: 'L-flagged' }),
      todo('t_bereich', 'Beratung für Hasan', { bereich: 'beratung', zustaendig: 'Hasan', erledigen_bis: '2026-11-19' }),
    ],
    ausgeblendeteListen: new Map([['h@x.de', new Set(['L-flagged'])]]),
  }
}

Deno.test('Mayer-Bot: eigene Liste ohne Microsoft To Do, heute zuerst, dann neueste Überfällige', () => {
  const z = aufgabenZeilen(HASAN, daten(), HEUTE, 'mayer')
  assertEquals(z.length, 4)
  assertStringIncludes(z[0], 'CRM heute')
  assertStringIncludes(z[1], 'CRM neu überfällig')
  assertStringIncludes(z[2], 'Beratung für Hasan')
  assertStringIncludes(z[3], 'CRM alt')
  assert(!z.some((x) => x.includes('Microsoft') || x.includes('Markierte')))
})

Deno.test('Privat-Übersicht: eigene Liste mit Microsoft, ohne alte (über 90 Tage) und ohne ausgeblendete Listen', () => {
  const z = aufgabenZeilen(HASAN, daten(), HEUTE, 'privat')
  assert(z.some((x) => x.includes('Microsoft neu')))
  assert(!z.some((x) => x.includes('Microsoft 2020')), 'Microsoft-Aufgabe von 2020 gezeigt')
  assert(!z.some((x) => x.includes('Markierte Mail')), 'ausgeblendete Liste gezeigt')
  assert(z.some((x) => x.includes('CRM alt')), 'eigene CRM-Aufgaben gehören dazu (ohne 90-Tage-Grenze)')
  assert(!z.some((x) => x.includes('Beratung für Hasan')), 'Bereichsaufgabe in der Privat-Übersicht')
  assertEquals(aufgabenZeilen(HASAN, daten(), HEUTE, 'nur_bereiche').length, 1)
})

Deno.test('morgenNachrichten: mit privatem Assistenten eigene Liste nur privat, ohne nur Mayer-Teil ohne Microsoft', async () => {
  const mit = await morgenNachrichten({}, HASAN, daten(), JETZT, () => Promise.resolve(true))
  assert(mit.mayer && mit.mayer.includes('Beratung für Hasan'))
  assert(!mit.mayer!.includes('CRM heute'), 'eigene Liste im Mayer-Teil trotz privatem Assistenten')
  assert(mit.privat && mit.privat.includes('Eigene Aufgaben') && mit.privat.includes('Microsoft neu') && mit.privat.includes('CRM heute'))
  const ohne = await morgenNachrichten({}, HASAN, daten(), JETZT, () => Promise.resolve(false))
  assertEquals(ohne.privat, null)
  assert(ohne.mayer!.includes('CRM heute'))
  assert(!ohne.mayer!.includes('Microsoft'), 'Microsoft-Aufgabe über den Mayer-Bot')
})

Deno.test('Listen-Auswahl: ohne Wahl nur „Flagged Emails“ aus, gespeicherte Wahl gilt genau so', () => {
  const listen = [
    { id: 'L-aufgaben', displayName: 'Aufgaben', wellknownListName: 'defaultList' },
    { id: 'L-flagged', displayName: 'Flagged Emails', wellknownListName: 'flaggedEmails' },
    { id: 'L-einkauf', displayName: 'Einkauf', wellknownListName: 'none' },
  ]
  assertEquals([...ausgeschlosseneListen(listen, undefined)], ['L-flagged'])
  assertEquals([...ausgeschlosseneListen(listen, [])], [])
  assertEquals([...ausgeschlosseneListen(listen, ['L-einkauf', 'L-weg'])], ['L-einkauf'])
  const eintraege = listenEintraege(listen, new Set(['L-flagged']))
  assertEquals(eintraege[1], { id: 'L-flagged', name: 'Flagged Emails', aus: true, markiert: true })
  assertEquals([...ausgeblendeteListen({ todoListen: eintraege })], ['L-flagged'])
  assertEquals(ausgeblendeteListen(null).size, 0)
})

Deno.test('Wiedervorlagen aus dem Reiter „Wiedervorlagen“ stehen in der Morgen-Übersicht (nur zuständig, nur eigener Bereich)', () => {
  const d = daten()
  d.kunden = [{ id: 'k1', bereich: 'beratung', firma: 'Bäckerei Maier' }, { id: 'k2', bereich: 'erben', firma: 'Familie Huber' }]
  d.wiedervorlagen = [
    { id: 'w1', kunde_id: 'k1', bereich: 'beratung', titel: 'Neuanfrage prüfen: qualifiziert, passt nicht oder später?', faellig: HEUTE, verantwortlich: 'Hasan Süslü' },
    { id: 'w2', kunde_id: 'k2', bereich: 'erben', titel: 'Erstgespräch vereinbaren', faellig: HEUTE, verantwortlich: 'Hasan Süslü' },
    { id: 'w3', kunde_id: 'k1', bereich: 'beratung', titel: 'Später', faellig: '2026-12-01', verantwortlich: 'Hasan Süslü' },
    { id: 'w4', kunde_id: 'k1', bereich: 'beratung', titel: 'Für Andreas', faellig: HEUTE, verantwortlich: 'Andreas Mayer' },
  ]
  const t = morgenText(HASAN, d, JETZT)!
  assertStringIncludes(t, 'Wiedervorlagen')
  assertStringIncludes(t, 'Neuanfrage prüfen: qualifiziert, passt nicht oder später?: Bäckerei Maier – heute')
  assert(!t.includes('Familie Huber'), 'fremder Bereich')
  assert(!t.includes('Später') && !t.includes('Für Andreas'))
})

