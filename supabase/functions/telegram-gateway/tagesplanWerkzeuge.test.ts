// Prüft die Tagesplan-Werkzeuge mit der Test-Datenbank (_shared/testDoppel.ts): Vorschlag speichern, Zeigen (eigener
// und fremder Tag, nur lesen), Hinzufügen mit To-do-Verknüpfung, Abhaken hakt das eigene To-do ab (fremdes nicht),
// Entfernen, Rechte (ohne Immobilien kein Zugriff, privater Assistent nicht).
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { findeEintrag, fuehreTagesplanWerkzeugAus, kuerzelListe, type TagesplanKontext } from './tagesplanWerkzeuge.ts'
import type { PlanTag } from '../_shared/tagesplanKern.ts'

const QUIRIN = { name: 'Quirin Lutzenberger', email: 'immo@amayer-holding.com', rolle: 'mitarbeiter', bereiche: ['immobilien'] }
const HEUTE = '2026-11-23'

function db() {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', ...QUIRIN, aktiv: true },
      { id: 'm2', name: 'Hasan Süslü', email: 'sueslue@hotmail.com', rolle: 'geschaeftsfuehrung', aktiv: true },
    ],
    todos: [
      { id: 't_ebay', besitzer_email: QUIRIN.email, bereich: null, aufgabe: 'Ebay Anzeige ändern', kunde_projekt: 'Elmali MFH Aislingen', prio: 'A', umsatz_wert: 25000, geplante_zeit: '60', erledigt_am: null, ist_zeit: 200, bezug: { art: 'objekt', id: 'o_ql_aislingen', name: 'Aislingen' } },
      { id: 't_frist', besitzer_email: QUIRIN.email, bereich: null, aufgabe: 'Unterlagen an Bank', prio: 'C', erledigen_bis: '2026-11-20', erledigt_am: null },
      { id: 't_hasan', besitzer_email: QUIRIN.email, bereich: null, aufgabe: 'Fonds raussuchen', prio: 'A', zustaendig: 'Hasan Süslü', erledigt_am: null },
      { id: 't_gutachten', besitzer_email: QUIRIN.email, bereich: null, aufgabe: 'Gutachten Vöhringen Fragen beantworten', prio: 'B', erledigt_am: null },
      { id: 't_fremd', besitzer_email: 'sueslue@hotmail.com', bereich: null, aufgabe: 'Fremd', prio: 'A', erledigt_am: null },
    ],
    objekte: [{ id: 'o_ql_voehringen', bezeichnung: 'Vöhringen (Boardinghouse / Wohnpark)', privat_besitzer: null }],
    kunden: [],
    wiedervorlagen: [],
    termine: [],
    abteilung_eintraege: [
      { id: 'Hasan Süslü|2026-11-23', art: 'tagesplan', daten: { id: 'Hasan Süslü|2026-11-23', mitarbeiter: 'Hasan Süslü', datum: HEUTE, zeilen: [{ id: 'h1', block: 'A', was: 'Bankgespräch' }], anrufe: '', aktualisiertAm: '' } },
    ],
  })
}

function kontext(d: ReturnType<typeof db>, m: TagesplanKontext['mitarbeiter'] = QUIRIN): TagesplanKontext & { protokoll: string[] } {
  const protokoll: string[] = []
  return { supabase: d, mitarbeiter: m, protokolliere: (t) => protokoll.push(t), heute: HEUTE, protokoll }
}

function plan(d: ReturnType<typeof db>, id = `${QUIRIN.name}|${HEUTE}`): PlanTag {
  return (d.tabelle('abteilung_eintraege').find((z) => z.id === id)?.daten ?? null) as PlanTag
}

Deno.test('tag_vorschlagen baut und speichert den eigenen Tag; Aufgaben anderer Zuständiger fehlen', async () => {
  const d = db()
  const k = kontext(d)
  const r = await fuehreTagesplanWerkzeugAus('tag_vorschlagen', {}, k)
  assertStringIncludes(r, 'Gespeichert:')
  const p = plan(d)
  assertEquals(p.mitarbeiter, QUIRIN.name)
  assertEquals(p.zeilen.find((z) => z.todoId === 't_frist')?.block, 'frist')
  assertEquals(p.zeilen.find((z) => z.todoId === 't_ebay')?.block, 'A')
  assertEquals(p.zeilen.find((z) => z.todoId === 't_ebay')?.bezug?.id, 'o_ql_aislingen')
  assert(!p.zeilen.some((z) => z.todoId === 't_hasan'))
  assert(!p.zeilen.some((z) => z.todoId === 't_fremd'))
  // Zweimal: nichts kommt doppelt.
  const r2 = await fuehreTagesplanWerkzeugAus('tag_vorschlagen', {}, k)
  assertStringIncludes(r2, 'Nichts Neues')
  assertEquals(plan(d).zeilen.length, p.zeilen.length)
  assertEquals(k.protokoll.length, 1)
})

Deno.test('tag_zeigen: eigener Tag mit Kürzeln, fremder nur lesen, ohne Plan ein Hinweis', async () => {
  const d = db()
  const k = kontext(d)
  assertStringIncludes(await fuehreTagesplanWerkzeugAus('tag_zeigen', {}, k), 'noch keinen Tagesplan')
  await fuehreTagesplanWerkzeugAus('tag_vorschlagen', {}, k)
  const eigen = await fuehreTagesplanWerkzeugAus('tag_zeigen', {}, k)
  assertStringIncludes(eigen, '☐ F1')
  assertStringIncludes(eigen, 'A1 ')
  assertStringIncludes(eigen, 'Ebay Anzeige ändern (Elmali MFH Aislingen)')
  assertStringIncludes(eigen, 'möglicher Umsatz 25 Tsd. €')
  const fremd = await fuehreTagesplanWerkzeugAus('tag_zeigen', { wer: 'Hasan' }, k)
  assertStringIncludes(fremd, '(nur lesen)')
  assertStringIncludes(fremd, 'Bankgespräch')
})

Deno.test('tag_eintrag_hinzufuegen verknüpft das passende To-do und erkennt das Objekt', async () => {
  const d = db()
  const k = kontext(d)
  const r = await fuehreTagesplanWerkzeugAus('tag_eintrag_hinzufuegen', { text: 'Gutachten Vöhringen Fragen beantworten', block: 'B' }, k)
  assertStringIncludes(r, 'Eingetragen: B1')
  assertStringIncludes(r, 'mit dem To-do verknüpft')
  const z = plan(d).zeilen.find((x) => x.block === 'B')!
  assertEquals([z.todoId, z.quelle, z.dauerMin], ['t_gutachten', 'telegram', 30])
  // Doppelt eintragen geht nicht.
  assertStringIncludes(await fuehreTagesplanWerkzeugAus('tag_eintrag_hinzufuegen', { text: 'Gutachten Vöhringen', block: 'A', todo_id: 't_gutachten' }, k), 'schon im Plan')
  // Ein fremdes To-do lässt sich nicht verknüpfen.
  assertStringIncludes(await fuehreTagesplanWerkzeugAus('tag_eintrag_hinzufuegen', { text: 'x', block: 'A', todo_id: 't_fremd' }, k), 'Fehler')
  // Ohne To-do: Objekt über den Namen.
  await fuehreTagesplanWerkzeugAus('tag_eintrag_hinzufuegen', { text: 'Vöhringen Exposé drucken', block: 'kurz', dauer_min: 5 }, k)
  const kurz = plan(d).zeilen.find((x) => x.block === 'kurz')!
  assertEquals([kurz.bezug?.id, kurz.dauerMin, kurz.todoId], ['o_ql_voehringen', 5, undefined])
})

Deno.test('tag_eintrag_erledigt hakt Eintrag und eigenes To-do ab (mit Ist-Zeit), wieder öffnen geht', async () => {
  const d = db()
  const k = kontext(d)
  await fuehreTagesplanWerkzeugAus('tag_vorschlagen', {}, k)
  const r = await fuehreTagesplanWerkzeugAus('tag_eintrag_erledigt', { eintrag: 'Ebay', ist_minuten: 40 }, k)
  assertStringIncludes(r, 'Abgehakt: A1')
  assertStringIncludes(r, 'To-do in der Liste abgehakt')
  const t = d.tabelle('todos').find((x) => x.id === 't_ebay')!
  assertEquals([t.erledigt_am, t.ist_zeit], [HEUTE, 240])
  const z = plan(d).zeilen.find((x) => x.todoId === 't_ebay')!
  assertEquals([z.erledigt, z.istMin], [true, 40])
  await fuehreTagesplanWerkzeugAus('tag_eintrag_erledigt', { eintrag: 'A1', erledigt: false }, k)
  assertEquals(d.tabelle('todos').find((x) => x.id === 't_ebay')!.erledigt_am, null)
  assertEquals(plan(d).zeilen.find((x) => x.todoId === 't_ebay')!.erledigt, undefined)
})

Deno.test('tag_eintrag_entfernen nimmt nur den Eintrag heraus; mehrdeutige Stichworte werden abgelehnt', async () => {
  const d = db()
  const k = kontext(d)
  await fuehreTagesplanWerkzeugAus('tag_vorschlagen', {}, k)
  assertStringIncludes(await fuehreTagesplanWerkzeugAus('tag_eintrag_entfernen', { eintrag: 'e' }, k), 'mehrere Einträge')
  const r = await fuehreTagesplanWerkzeugAus('tag_eintrag_entfernen', { eintrag: 'Unterlagen an Bank' }, k)
  assertStringIncludes(r, 'Entfernt: F1')
  assert(!plan(d).zeilen.some((z) => z.todoId === 't_frist'))
  assertEquals(d.tabelle('todos').find((x) => x.id === 't_frist')!.erledigt_am, null)
})

Deno.test('Rechte: ohne Immobilien nichts, privater Assistent nichts; Kürzel und Suche', async () => {
  const d = db()
  assertStringIncludes(await fuehreTagesplanWerkzeugAus('tag_zeigen', {}, kontext(d, { ...QUIRIN, bereiche: ['beratung'] })), 'nicht freigegeben')
  assertStringIncludes(await fuehreTagesplanWerkzeugAus('tag_zeigen', {}, kontext(d, { ...QUIRIN, nurPrivat: true })), 'privaten Assistenten')
  assertStringIncludes(await fuehreTagesplanWerkzeugAus('tag_zeigen', { datum: '23.11.' }, kontext(d)), 'kein gültiges Datum')
  const zeilen = [
    { id: 'a', block: 'A' as const, was: 'Erste' },
    { id: 'f', block: 'frist' as const, was: 'Frist' },
    { id: 'b', block: 'A' as const, was: 'Zweite' },
  ]
  assertEquals([...kuerzelListe(zeilen)], [['f', 'F1'], ['a', 'A1'], ['b', 'A2']])
  assertEquals(findeEintrag(zeilen, 'a2').zeile?.id, 'b')
  assertEquals(findeEintrag(zeilen, 'zweite').zeile?.id, 'b')
  assert(findeEintrag(zeilen, 'nix').fehler)
})
