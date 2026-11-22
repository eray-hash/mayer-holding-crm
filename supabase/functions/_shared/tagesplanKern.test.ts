// Prüft den Tagesplan-Kern: Budgets der Blöcke, Reihenfolge nach Prio und Umsatz, kurze Arbeiten, Fristsachen
// (fällig/überfällig/Wiedervorlage), Termine als feste Zeiten in der Zeitleiste, Übernahme vom Vortag, „Jetzt dran“,
// Stoppuhr, Bilanz und die Telegram-Texte; dazu die vorsichtige Zuordnung von Akten/Objekten.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  abendText,
  bilanz,
  BUDGET,
  jetztDran,
  minutenAusText,
  morgenText,
  type PlanTodo,
  type PlanZeile,
  schlageTagVor,
  stoppe,
  uebertrag,
  uhrZuMinuten,
  zeitplan,
} from './tagesplanKern.ts'
import { alsBezug, type BezugKandidat, findeBezugImText } from './tagesplanBezug.ts'

let n = 0
const id = () => `z${++n}`
const todo = (x: Partial<PlanTodo> & { id: string }): PlanTodo => ({ aufgabe: `Aufgabe ${x.id}`, ...x })
const minuten = (zeilen: PlanZeile[], block: string) => zeilen.filter((z) => z.block === block).reduce((s, z) => s + (z.dauerMin ?? 0), 0)

Deno.test('minutenAusText: Zahlen, Minuten, Stunden, Unsinn', () => {
  assertEquals(minutenAusText('45'), 45)
  assertEquals(minutenAusText('45 min'), 45)
  assertEquals(minutenAusText('1,5 Std'), 90)
  assertEquals(minutenAusText('2h'), 120)
  assertEquals(minutenAusText('180 std'), 480) // gedeckelt auf einen Arbeitstag
  assertEquals(minutenAusText('bald'), null)
  assertEquals(minutenAusText(''), null)
})

Deno.test('Vorschlag: feste Aufgaben, Budgets A 120 / B 90 / C 60, Überlauf nach unten', () => {
  const todos = [
    todo({ id: 'a1', prio: 'A', geplanteZeit: '60' }),
    todo({ id: 'a2', prio: 'A', geplanteZeit: '60' }),
    todo({ id: 'a3', prio: 'A', geplanteZeit: '60' }), // passt nicht mehr in A → B
    todo({ id: 'b1', prio: 'B', geplanteZeit: '30' }), // B: 60 + 30 = 90 — passt genau
    todo({ id: 'c1', prio: 'C', geplanteZeit: '30' }),
    todo({ id: 'c2', prio: 'C', geplanteZeit: '45' }), // C: 30 + 45 > 60 → nicht eingeplant
  ]
  const r = schlageTagVor({ datum: '2026-11-23', todos, neueId: id })
  const block = (tid: string) => r.zeilen.find((z) => z.todoId === tid)?.block
  assertEquals(r.zeilen.filter((z) => z.block === 'organisation').map((z) => z.was), ['To-do-Liste überarbeiten', 'Objektliste aktualisieren'])
  assertEquals([block('a1'), block('a2'), block('a3'), block('b1'), block('c1')], ['A', 'A', 'B', 'B', 'C'])
  assertEquals(r.nichtEingeplant.map((t) => t.id), ['c2'])
  // Eine B-Aufgabe, die in B keinen Platz mehr hat, rutscht in einen leeren C-Block (höhere Prio vor C-Aufgaben).
  const s = schlageTagVor({ datum: '2026-11-23', todos: [todo({ id: 'b', prio: 'B', geplanteZeit: '90' }), todo({ id: 'b9', prio: 'B', geplanteZeit: '45' }), todo({ id: 'c', prio: 'C', geplanteZeit: '30' })], neueId: id })
  assertEquals(s.zeilen.filter((z) => z.todoId).map((z) => `${z.todoId}:${z.block}`), ['b:B', 'b9:C'])
  assertEquals(s.nichtEingeplant.map((t) => t.id), ['c'])
  assert(minuten(r.zeilen, 'A') <= (BUDGET.A as number))
  assert(minuten(r.zeilen, 'B') <= (BUDGET.B as number))
  assert(minuten(r.zeilen, 'C') <= (BUDGET.C as number))
})

Deno.test('Vorschlag: innerhalb der Prio zuerst der höhere Umsatz („Fokus Umsatz“), dann Unter-Prio', () => {
  const todos = [
    todo({ id: 'klein', prio: 'B', umsatzWert: 5000, unterPrio: 1, geplanteZeit: '30' }),
    todo({ id: 'gross', prio: 'B', umsatzWert: 45000, unterPrio: 9, geplanteZeit: '30' }),
    todo({ id: 'ohne', prio: 'B', unterPrio: 2, geplanteZeit: '30' }),
    todo({ id: 'nullwert', prio: 'B', umsatzWert: 0, unterPrio: 3, geplanteZeit: '30' }),
  ]
  const r = schlageTagVor({ datum: '2026-11-23', todos, neueId: id })
  assertEquals(r.zeilen.filter((z) => z.block === 'B').map((z) => z.todoId), ['gross', 'klein', 'nullwert'])
  // B ist mit 90 Minuten voll — die Aufgabe ohne Umsatz rutscht nach C.
  assertEquals(r.zeilen.filter((z) => z.block === 'C').map((z) => z.todoId), ['ohne'])
  assertEquals(r.nichtEingeplant, [])
  assertEquals(r.zeilen.find((z) => z.todoId === 'gross')?.umsatz, 45000)
})

Deno.test('Vorschlag: ein leerer Block nimmt auch eine zu lange Aufgabe; kurze (≤ 10 Min.) kommen in „kurze Arbeiten“', () => {
  const r = schlageTagVor({
    datum: '2026-11-23',
    todos: [todo({ id: 'riesig', prio: 'A', geplanteZeit: '200' }), todo({ id: 'k1', prio: 'A', geplanteZeit: '5' }), todo({ id: 'k2', prio: 'D', geplanteZeit: '10' })],
    neueId: id,
  })
  assertEquals(r.zeilen.find((z) => z.todoId === 'riesig')?.block, 'A')
  assertEquals(r.zeilen.filter((z) => z.block === 'kurz').map((z) => z.todoId), ['k1', 'k2'])
  // Ohne geplante Zeit: 30 Minuten.
  const s = schlageTagVor({ datum: '2026-11-23', todos: [todo({ id: 'x', prio: 'C' })], neueId: id })
  assertEquals(s.zeilen.find((z) => z.todoId === 'x')?.dauerMin, 30)
})

Deno.test('Vorschlag: Fristsachen = fällig/überfällig (älteste zuerst) und Wiedervorlagen; erledigte fehlen', () => {
  const r = schlageTagVor({
    datum: '2026-11-23',
    todos: [
      todo({ id: 'heute', prio: 'C', erledigenBis: '2026-11-23' }),
      todo({ id: 'alt', prio: 'C', erledigenBis: '20.11.2026' }),
      todo({ id: 'wv', prio: 'B', geplanteWiedervorlage: '2026-11-22' }),
      todo({ id: 'spaeter', prio: 'A', erledigenBis: '2026-12-01' }),
      todo({ id: 'fertig', prio: 'A', erledigenBis: '2026-11-20', erledigtAm: '2026-11-21' }),
    ],
    wiedervorlagen: [
      { id: 'wv_1', titel: 'Wegen Unterlagen nachfassen', faellig: '2026-11-23', akteName: 'Corvalli' },
      { id: 'wv_2', titel: 'Noch nicht dran', faellig: '2026-11-30' },
    ],
    neueId: id,
  })
  const frist = r.zeilen.filter((z) => z.block === 'frist')
  assertEquals(frist.map((z) => z.todoId ?? z.wvId), ['alt', 'wv', 'heute', 'wv_1'])
  assertEquals(frist[3].was, 'Wegen Unterlagen nachfassen (Corvalli)')
  assertEquals(r.zeilen.find((z) => z.todoId === 'spaeter')?.block, 'A')
  assert(!r.zeilen.some((z) => z.todoId === 'fertig'))
})

Deno.test('Vorschlag: Termine als feste Zeiten; Zeitleiste weicht ihnen aus', () => {
  const r = schlageTagVor({
    datum: '2026-11-23',
    todos: [todo({ id: 'a', prio: 'A', geplanteZeit: '60' })],
    termine: [
      { id: 't1', titel: 'Besichtigung Aislingen', von: '09:00', bis: '10:00', ganztags: false, kundeName: 'Elmali' },
      { id: 't2', titel: 'Messe', ganztags: true },
    ],
    neueId: id,
  })
  const termin = r.zeilen.find((z) => z.terminId === 't1')!
  assertEquals([termin.block, termin.festVon, termin.festBis, termin.dauerMin], ['frist', '09:00', '10:00', 60])
  assertEquals(termin.was, '09:00–10:00 Uhr: Besichtigung Aislingen (Elmali)')
  assertEquals(r.zeilen.find((z) => z.terminId === 't2')?.was, 'ganztägig: Messe')

  // 08:30 Start: To-do-Liste 20 Min. (08:30–08:50), Objektliste 10 Min. (08:50–09:00), dann der Termin 9–10,
  // die A-Aufgabe (60 Min.) passt nicht davor und beginnt um 10:00.
  const plan = zeitplan(r.zeilen, '08:30')
  const von = (zid: string) => plan.eintraege.find((e) => e.id === zid)!
  const a = r.zeilen.find((z) => z.todoId === 'a')!
  assertEquals([von(termin.id).von, von(termin.id).bis, von(termin.id).fest], [540, 600, true])
  assertEquals([von(a.id).von, von(a.id).bis], [600, 660])
  assertEquals(plan.ende, 660)
  // Der ganztägige Termin belegt keine Zeit.
  assert(!plan.eintraege.some((e) => e.id === r.zeilen.find((z) => z.terminId === 't2')!.id))
  assert(plan.eintraege.every((e, i, l) => i === 0 || l[i - 1].von <= e.von))
})

Deno.test('Übernahme vom Vortag: Offenes ohne Häkchen/Ergebnis/Stoppuhr, nicht Erledigtes, Termine, Feste', () => {
  const vortag: PlanZeile[] = [
    { id: 'o1', block: 'organisation', was: 'To-do-Liste überarbeiten' },
    { id: 'v1', block: 'B', was: 'Gutachten Vöhringen Fragen beantworten', stand: 'Fragen an Gutachter', ergebnis: 'halb', istMin: 20, dauerMin: 45 },
    { id: 'v2', block: 'C', was: 'Harite Wohnung finden', todoId: 'harite' },
    { id: 'v3', block: 'C', was: 'Erledigt', erledigt: true },
    { id: 'v4', block: 'frist', was: '10:00 Uhr: Termin', terminId: 't' },
    { id: 'v5', block: 'A', was: 'To-do inzwischen erledigt', todoId: 'fertig' },
    { id: 'v6', block: 'C', was: 'Fond Berlin', todoId: 'fond' },
  ]
  const todos = new Map<string, PlanTodo>([
    ['harite', todo({ id: 'harite', prio: 'C' })],
    ['fertig', todo({ id: 'fertig', erledigtAm: '2026-11-22' })],
    ['fond', todo({ id: 'fond', prio: 'A', erledigenBis: '2026-11-23' })],
  ])
  const raus = uebertrag({ datum: '2026-11-21', zeilen: vortag }, todos, id)
  assertEquals(raus.map((z) => z.was), ['Gutachten Vöhringen Fragen beantworten', 'Harite Wohnung finden', 'Fond Berlin'])
  assertEquals([raus[0].stand, raus[0].ergebnis, raus[0].istMin, raus[0].erledigt, raus[0].ausVortag, raus[0].dauerMin], ['Fragen an Gutachter', undefined, undefined, undefined, '2026-11-21', 45])

  // Im Vorschlag: Übernommenes kommt vor neuen To-dos; ein inzwischen fälliges To-do wandert in die Fristsachen;
  // dasselbe To-do kommt nicht doppelt.
  const r = schlageTagVor({ datum: '2026-11-23', todos: [...todos.values()], vortag: { datum: '2026-11-21', zeilen: vortag }, neueId: id })
  assertEquals(r.zeilen.filter((z) => z.todoId === 'harite').length, 1)
  assertEquals(r.zeilen.find((z) => z.todoId === 'fond')?.block, 'frist')
  assertEquals(r.zeilen.find((z) => z.todoId === 'fond')?.ausVortag, '2026-11-21')
  assertEquals(r.zeilen.filter((z) => z.block === 'B').map((z) => z.was), ['Gutachten Vöhringen Fragen beantworten'])
})

Deno.test('Übernahme nur aus einem Plan der letzten 4 Tage (Freitag → Montag ja, eine Woche alt nein)', () => {
  const vortag = (datum: string) => ({ datum, zeilen: [{ id: 'v', block: 'B' as const, was: 'Offen geblieben' }] })
  assert(schlageTagVor({ datum: '2026-11-23', todos: [], vortag: vortag('2026-11-20'), neueId: id }).zeilen.some((z) => z.was === 'Offen geblieben'))
  assert(!schlageTagVor({ datum: '2026-11-23', todos: [], vortag: vortag('2026-11-17'), neueId: id }).zeilen.some((z) => z.was === 'Offen geblieben'))
})

Deno.test('Vorschlag auf bestehendem Plan: nichts doppelt, bestehende Zeilen zählen gegen das Budget', () => {
  const bestehend: PlanZeile[] = [
    { id: 'h1', block: 'A', was: 'Eigene Sache', dauerMin: 100, quelle: 'hand' },
    { id: 'h2', block: 'C', was: 'Aufgabe c1', todoId: 'c1', dauerMin: 30 },
  ]
  const r = schlageTagVor({
    datum: '2026-11-23',
    todos: [todo({ id: 'a1', prio: 'A', geplanteZeit: '30' }), todo({ id: 'c1', prio: 'C' })],
    bestehend,
    neueId: id,
  })
  assertEquals(r.zeilen.find((z) => z.todoId === 'a1')?.block, 'B') // A hat nur noch 20 Min.
  assertEquals(r.zeilen.filter((z) => z.todoId === 'c1').length, 1)
  assertEquals(r.zeilen.find((z) => z.id === 'h1')?.was, 'Eigene Sache')
  // Organisation wird ergänzt, weil der Block leer war.
  assertEquals(r.neu, 3)
})

Deno.test('Jetzt dran: laufender Termin vor allem, sonst die erste offene Aufgabe', () => {
  const zeilen: PlanZeile[] = [
    { id: 'o', block: 'organisation', was: 'To-do-Liste', dauerMin: 20, erledigt: true },
    { id: 't', block: 'frist', was: 'Termin', festVon: '10:00', festBis: '11:00', dauerMin: 60, terminId: 'x' },
    { id: 'a', block: 'A', was: 'A1', dauerMin: 60 },
    { id: 'b', block: 'B', was: 'B1', dauerMin: 30 },
  ]
  const plan = zeitplan(zeilen, '08:30')
  assertEquals(jetztDran(zeilen, plan, uhrZuMinuten('08:40')!), 'a')
  assertEquals(jetztDran(zeilen, plan, uhrZuMinuten('10:15')!), 't')
  assertEquals(jetztDran(zeilen.map((z) => (z.id === 't' ? { ...z, erledigt: true } : z)), plan, uhrZuMinuten('10:15')!), 'a')
  assertEquals(jetztDran(zeilen.map((z) => ({ ...z, erledigt: true })), plan, 600), null)
})

Deno.test('Stoppuhr und Bilanz', () => {
  const start = new Date('2026-11-23T09:00:00Z')
  const { zeile, minuten: dazu } = stoppe({ id: 'a', block: 'A', was: 'x', istMin: 10, laeuftSeit: start.toISOString() }, new Date('2026-11-23T09:25:20Z'))
  assertEquals([dazu, zeile.istMin, zeile.laeuftSeit], [25, 35, undefined])
  const b = bilanz([
    { id: '1', block: 'A', was: 'a', dauerMin: 60, istMin: 70, umsatz: 25000, erledigt: true, todoId: 't1' },
    { id: '2', block: 'B', was: 'b', dauerMin: 30, umsatz: 5000, todoId: 't2' },
    { id: '3', block: 'C', was: 'b nochmal', dauerMin: 30, umsatz: 5000, todoId: 't2' },
    { id: '4', block: 'C', was: '', dauerMin: 99 },
  ])
  assertEquals(b, { anzahl: 3, erledigt: 1, minutenGeplant: 120, minutenErledigt: 60, minutenIst: 70, umsatzMoeglich: 30000, umsatzErledigt: 25000 })
})

Deno.test('Texte: Morgen „Dein Tag“ und Abend „Offen geblieben“', () => {
  const zeilen: PlanZeile[] = [
    { id: 'o', block: 'organisation', was: 'To-do-Liste überarbeiten' },
    { id: 't', block: 'frist', was: '09:00–10:00 Uhr: Besichtigung', terminId: 'x', festVon: '09:00', festBis: '10:00' },
    { id: 'f', block: 'frist', was: 'Unterlagen an Bank' },
    { id: 'a', block: 'A', was: 'Ebay Anzeige ändern (Elmali)', umsatz: 25000 },
    { id: 'b', block: 'B', was: 'Exposé Illerkirchberg', erledigt: true },
  ]
  const m = morgenText({ datum: '2026-11-23', zeilen }, { link: 'https://x/#/immobilien/tagesablauf', wochentag: 'Montag' })!
  assert(m.startsWith('☀️ Dein Tag – Montag, 23.11.'))
  assert(m.includes('Termine:\n• 09:00–10:00 Besichtigung'))
  assert(m.includes('Fristsachen – unbedingt erledigen:\n• Unterlagen an Bank'))
  assert(m.includes('• A1 Ebay Anzeige ändern (Elmali) (25 Tsd. €)'))
  assert(m.includes('Möglicher Umsatz heute: 25 Tsd. €.'))
  const a = abendText({ zeilen })!
  assert(a.includes('1 von 5 erledigt'))
  assert(a.includes('• Unterlagen an Bank'))
  assert(!a.includes('Besichtigung'))
  assertEquals(abendText({ zeilen: zeilen.map((z) => ({ ...z, erledigt: true })) }), null)
})

// ── Zuordnung Akte/Objekt ─────────────────────────────────────────────────────────────────────────

const KANDIDATEN: BezugKandidat[] = [
  { art: 'objekt', id: 'o_aislingen', name: 'Aislingen' },
  { art: 'objekt', id: 'o_voehringen', name: 'Vöhringen (Boardinghouse / Wohnpark)' },
  { art: 'objekt', id: 'o_mayr', name: 'Ottilye Mayr' },
  { art: 'objekt', id: 'o_tank', name: 'Tankstelle Blaubeuren (Esso)' },
  { art: 'objekt', id: 'o_orhan', name: 'Blaubeuren – Haus mit 3 Wohnungen (Orhan)' },
  { art: 'objekt', id: 'o_tosic', name: 'Tosic Immo – Augsburg-Lechhausen und Kellmünz' },
  { art: 'objekt', id: 'o_villa', name: 'Villa Donaueschingen' },
  { art: 'kunde', id: 'k_nadja', name: 'Nadja Mayr', bereich: 'beratung' },
  { art: 'kunde', id: 'k_stehle', name: 'Marc Stehle', bereich: 'akademie' },
]

Deno.test('Bezug: eindeutige Treffer, Tippfehler nur mit genauem Nachbarwort, zwei Sachen → keiner', () => {
  assertEquals(findeBezugImText('Elmali MFH Aislingen 350k Ebay Anzeige ändern', KANDIDATEN)?.bezug.id, 'o_aislingen')
  assertEquals(findeBezugImText('Otilie Mayr Umbau / Teilungserklärung', KANDIDATEN)?.bezug.id, 'o_mayr')
  assertEquals(findeBezugImText('Tankstelle Pacht: Orhan anrufen, Tankstellen zur Pacht Blaubeuren', KANDIDATEN)?.bezug.id, 'o_tank')
  assertEquals(findeBezugImText('Fördermittel für Vöhringen und Aislingen schauen', KANDIDATEN), null)
  assertEquals(findeBezugImText('alte Projekte fertig abarbeiten Tosic/ Donaueschingen', KANDIDATEN), null)
  assertEquals(findeBezugImText('Ordner durcharbeiten und Fragen stellen', KANDIDATEN), null) // „stellen“ ≠ „Stehle“
  assertEquals(findeBezugImText('Büro: Objekt anlegen', KANDIDATEN), null)
  assertEquals(alsBezug({ art: 'objekt', id: 'o_1', name: 'X' }), { art: 'objekt', id: 'o_1', name: 'X' })
  assertEquals(alsBezug({ art: 'akte', id: 'o_1' }), null)
  assertEquals(alsBezug(null), null)
})
