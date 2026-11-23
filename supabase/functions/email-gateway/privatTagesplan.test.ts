// Prüft den privaten Tagesplan (privatTagesplan.ts) ohne Netz: Zeitfenster (auch Wochenende), Sortierung, Vagheit,
// privater Termin-Filter, keine Nachricht ohne Inhalt, kein Doppelversand, Einstellung aus, Knopf-Rechte.
import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import {
  abendrueckblickNachricht,
  faelligkeit,
  fuehrePlanKnopfAus,
  istPlanKnopf,
  istVage,
  morgenplanText,
  type PlanDaten,
  planEinstellung,
  planFenster,
  type PlanSenden,
  type PlanTodo,
  privatMorgenplanAktiv,
  sendePrivatTagesplaene,
  sortiereFaellige,
  sperrKennung,
} from './privatTagesplan.ts'

const HASAN = 'sueslue@hotmail.com'
const QUIRIN = 'quirin@x.de'
// November: Berlin = UTC+1. 2026-11-28 ist ein Samstag, 2026-11-23 ein Montag.
const SA_MORGEN = new Date('2026-11-28T07:05:00Z') // Samstag 8:05
const SA_ABEND = new Date('2026-11-28T20:35:00Z') // Samstag 21:35
const MO_MORGEN = new Date('2026-11-23T07:05:00Z') // Montag 8:05
const SA = '2026-11-28'

function todo(id: string, aufgabe: string, extra: Partial<PlanTodo> = {}): PlanTodo {
  return { id, aufgabe, prio: null, erledigen_bis: null, geplante_wiedervorlage: null, erledigt_am: null, kunde_projekt: 'Privat', aktueller_stand: null, besitzer_email: HASAN, bereich: null, ms_id: null, ms_liste_id: null, erstellt_am: '2026-11-20', ...extra }
}

function termin(id: string, titel: string, beginn: string, ende: string, extra: Zeile = {}): Zeile {
  return { id, titel, beginn, ende, ganztags: false, ort: null, teilnehmer: [], kunde_id: null, kunde_bereich: null, besitzer_email: HASAN, ...extra }
}

function welt(extra: Record<string, Zeile[]> = {}): FalscheDatenbank {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', name: 'Hasan Süslü', email: HASAN, telegram_chat_id: 222, aktiv: true },
      { id: 'm2', name: 'Quirin L', email: QUIRIN, telegram_chat_id: 333, aktiv: true },
      { id: 'm3', name: 'Ohne Telegram', email: 'ohne@x.de', telegram_chat_id: null, aktiv: true },
    ],
    privat_einstellungen: [{ login_email: HASAN, briefing: { privatBot: true } }],
    todos: [
      todo('t_heute_c', 'Heute fällig C', { erledigen_bis: SA, prio: 'C' }),
      todo('t_ueber_b_alt', 'Überfällig B alt', { erledigen_bis: '2026-11-01', prio: 'B' }),
      todo('t_ueber_a_neu', 'Überfällig A neu', { erledigen_bis: '2026-11-27', prio: 'A' }),
      todo('t_ueber_a_alt', 'Überfällig A alt', { erledigen_bis: '2026-11-10', prio: 'A' }),
      todo('t_ueber_ohne', 'Überfällig ohne Prio', { erledigen_bis: '2026-11-02' }),
      todo('t_wv', 'Wiedervorlage fällig', { geplante_wiedervorlage: '2026-11-20', prio: 'B' }),
      todo('t_heute_a', 'Heute fällig A', { erledigen_bis: SA, prio: 'A' }),
      todo('t_morgen', 'Morgen fällig Steuer', { erledigen_bis: '2026-11-29', prio: 'A' }),
      todo('t_spaeter', 'Später', { erledigen_bis: '2026-12-10' }),
      todo('t_erledigt', 'Schon erledigt', { erledigen_bis: '2026-11-20', erledigt_am: SA }),
      todo('t_erledigt2', 'Auch erledigt', { erledigt_am: SA }),
      todo('t_ms_alt', 'Microsoft uralt', { erledigen_bis: '2020-01-01', ms_id: 'M1', ms_liste_id: 'L1' }),
      todo('t_ms_aus', 'Markierte Mail', { erledigen_bis: '2026-11-25', ms_id: 'M2', ms_liste_id: 'L-flag' }),
      todo('t_bereich', 'Beratung für Hasan', { erledigen_bis: '2026-11-25', bereich: 'beratung' }),
      todo('t_fremd', 'Quirins Aufgabe', { erledigen_bis: '2026-11-25', besitzer_email: QUIRIN }),
      todo('t_vage', 'Bosler?', { erstellt_am: '2026-11-28', kunde_projekt: null }),
    ],
    termine: [
      termin('tm_privat', 'Zahnarzt', '2026-11-28T09:00:00Z', '2026-11-28T10:00:00Z', { ort: 'Ulm' }),
      termin('tm_team', 'Teamrunde', '2026-11-28T11:00:00Z', '2026-11-28T12:00:00Z', { teilnehmer: [QUIRIN] }),
      termin('tm_mayer', 'Kunde Mayer-Akte', '2026-11-28T13:00:00Z', '2026-11-28T14:00:00Z', { kunde_id: 'k1', kunde_bereich: 'beratung' }),
      termin('tm_privatakte', 'Privatakte Notar', '2026-11-28T15:00:00Z', '2026-11-28T16:00:00Z', { kunde_id: 'k2', kunde_bereich: 'privat' }),
      termin('tm_morgen', 'Familienfest', '2026-11-29T12:00:00Z', '2026-11-29T15:00:00Z'),
      termin('tm_quirin', 'Quirin privat', '2026-11-28T09:00:00Z', '2026-11-28T10:00:00Z', { besitzer_email: QUIRIN }),
    ],
    ms_konten: [{ login_email: HASAN, stand: { todoListen: [{ id: 'L-flag', name: 'Flagged Emails', aus: true }] } }],
    ...extra,
  })
}

type Gesendet = { chat: number | string; text: string; extra?: Record<string, unknown> }
function sender(ok = true): PlanSenden & { gesendet: Gesendet[] } {
  const gesendet: Gesendet[] = []
  const f = ((chat, text, extra) => {
    gesendet.push({ chat, text, extra })
    return Promise.resolve(ok)
  }) as PlanSenden & { gesendet: Gesendet[] }
  f.gesendet = gesendet
  return f
}

const nurHasan = { privatAktiv: (e: string) => Promise.resolve(e === HASAN) }

// ---------------------------------------------------------------------------------------------

Deno.test('Zeitfenster: morgens 8:00–11:00 und abends 21:30–23:30, jeden Tag inkl. Wochenende', () => {
  assertEquals(planFenster(SA_MORGEN)?.art, 'morgen')
  assertEquals(planFenster(SA_MORGEN)?.wochentag, 6)
  assertEquals(planFenster(new Date('2026-11-29T07:00:00Z'))?.art, 'morgen') // Sonntag 8:00
  assertEquals(planFenster(new Date('2026-11-28T06:59:00Z')), null) // 7:59
  assertEquals(planFenster(new Date('2026-11-28T10:00:00Z')), null) // 11:00
  assertEquals(planFenster(new Date('2026-11-28T20:29:00Z')), null) // 21:29
  assertEquals(planFenster(new Date('2026-11-28T20:30:00Z'))?.art, 'abend') // 21:30
  assertEquals(planFenster(new Date('2026-11-28T22:29:00Z'))?.art, 'abend') // 23:29
  assertEquals(planFenster(new Date('2026-11-28T22:30:00Z')), null) // 23:30
  // Sommerzeit: 8:00 Berlin = 6:00 UTC
  assertEquals(planFenster(new Date('2026-07-04T06:00:00Z'))?.art, 'morgen')
})

Deno.test('Außerhalb der Fenster kein Datenbankzugriff', async () => {
  const db = welt()
  const s = sender()
  const r = await sendePrivatTagesplaene(db, new Date('2026-11-28T12:00:00Z'), s, nurHasan)
  assertEquals(db.protokoll.length, 0)
  assertEquals(s.gesendet.length, 0)
  assertEquals(r.fehler, [])
})

Deno.test('Sortierung: überfällig vor heute, dann Prio A–D (ohne zuletzt), dann älteste Frist; MS-alt und ausgeblendet fehlen', () => {
  const db = welt()
  const todos = db.tabellen.todos as PlanTodo[]
  const f = sortiereFaellige(todos.filter((t) => !t.bereich && t.besitzer_email === HASAN).map((t) => faelligkeit(t, SA, SA, new Set(['L-flag']))).filter((x) => !!x) as never)
  assertEquals(f.map((x) => x.todo.id), ['t_ueber_a_alt', 't_ueber_a_neu', 't_ueber_b_alt', 't_wv', 't_ueber_ohne', 't_heute_a', 't_heute_c'])
  assert(f.find((x) => x.todo.id === 't_wv')!.wiedervorlage)
})

Deno.test('Vagheit: „unklar“, „Details“, „?“, „…“, 1–2 Wörter ohne Zusammenhang', () => {
  assert(istVage({ aufgabe: 'Bosler?' }))
  assert(istVage({ aufgabe: 'Steuer unklar mit Berater' }))
  assert(istVage({ aufgabe: 'Details zum Vertrag klären lassen' }))
  assert(istVage({ aufgabe: 'Wegen dem Ding …' }))
  assert(istVage({ aufgabe: 'Anrufen' }))
  assert(istVage({ aufgabe: 'Bosler anrufen' }))
  assertFalse(istVage({ aufgabe: 'Bosler anrufen', kunde_projekt: 'Hausverkauf Neu-Ulm' }))
  assertFalse(istVage({ aufgabe: 'Herrn Bosler wegen Kaufvertrag zurückrufen' }))
  assertFalse(istVage({ aufgabe: '' }))
})

Deno.test('Morgenplan am Samstag: Wochenend-Ton, nur private Termine, höchstens 5 Aufgaben + Rest, Zusatzteile', async () => {
  const db = welt()
  const s = sender()
  const r = await sendePrivatTagesplaene(db, SA_MORGEN, s, {
    ...nurHasan,
    zusatzMorgen: [() => Promise.resolve(['Fristen:', '• Kfz-Steuer bis 30.11.']), () => Promise.resolve([]), () => Promise.reject(new Error('kaputt'))],
  })
  assertEquals(r.morgen, 1)
  assertEquals(s.gesendet.length, 1)
  const { chat, text, extra } = s.gesendet[0]
  assertEquals(chat, 222)
  assertEquals(extra, undefined)
  assertStringIncludes(text, 'Guten Morgen Hasan, dein Samstag (28.11.)')
  assertStringIncludes(text, 'Zahnarzt')
  assertStringIncludes(text, 'Privatakte Notar')
  for (const nicht of ['Teamrunde', 'Kunde Mayer-Akte', 'Quirin privat', 'Familienfest', 'Quirins Aufgabe', 'Beratung für Hasan', 'Microsoft uralt', 'Markierte Mail', 'Schon erledigt', 'Später', '€']) {
    assertFalse(text.includes(nicht), `${nicht} gehört nicht in den Morgenplan`)
  }
  assertStringIncludes(text, 'Fällig (5 überfällig, 2 heute):')
  const aufgaben = text.split('\n').filter((z) => z.startsWith('• ') && z.includes(' – '))
  assertEquals(aufgaben.length, 5)
  assertStringIncludes(aufgaben[0], 'Überfällig A alt')
  assertStringIncludes(aufgaben[0], 'überfällig seit 10.11. · Prio A')
  assertStringIncludes(text, '… und 2 weitere')
  assertStringIncludes(text, 'Kfz-Steuer bis 30.11.')
  assert(text.split('\n').length <= 18, `zu lang: ${text.split('\n').length} Zeilen`)
  assertEquals(r.fehler.length, 1) // der kaputte Zusatzteil steht im Ergebnis, die Nachricht geht trotzdem
  // Quirin (kein privater Bot) bekommt nichts
  assertFalse(s.gesendet.some((g) => g.chat === 333))
})

Deno.test('Morgenplan werktags: anderer Ton', () => {
  const d: PlanDaten = { faellig: [todo('x', 'Rechnung an Hausverwaltung prüfen', { erledigen_bis: '2026-11-23' })], neu: [], heuteErledigt: 0, termine: [], ausgeblendet: new Set() }
  const t = morgenplanText('Hasan Süslü', d, HASAN, '2026-11-23', 1)!
  assertStringIncludes(t, 'dein privater Plan für Montag (23.11.)')
  assertStringIncludes(t, 'Heute fällig (1):')
})

Deno.test('Kein Doppelversand: zweiter Takt sendet nichts, Sperrzeile mit eigener Kennung', async () => {
  const db = welt()
  const s = sender()
  await sendePrivatTagesplaene(db, SA_MORGEN, s, nurHasan)
  const r2 = await sendePrivatTagesplaene(db, new Date('2026-11-28T07:06:00Z'), s, nurHasan)
  assertEquals(s.gesendet.length, 1)
  assertEquals(r2.morgen, 0)
  const zeilen = db.tabelle('tagesplan_meldungen')
  assertEquals(zeilen.length, 1)
  assertEquals(zeilen[0].id, sperrKennung('morgen', HASAN, SA))
  assertEquals(zeilen[0].art, 'morgen') // Tabelle erlaubt nur 'morgen'/'abend'
  assertEquals(zeilen[0].zugestellt, true)
  // Quirins Sperrzeile (tagesplanMeldungen.ts) stört nicht und wird nicht gestört
  assert(String(zeilen[0].id).startsWith('privatplan|'))
})

Deno.test('Sperrzeile schon da (gleichzeitiger Lauf): nicht senden', async () => {
  const db = welt({ tagesplan_meldungen: [{ id: sperrKennung('morgen', HASAN, SA), email: HASAN, art: 'morgen', datum: SA }] })
  const s = sender()
  await sendePrivatTagesplaene(db, SA_MORGEN, s, nurHasan)
  assertEquals(s.gesendet.length, 0)
})

Deno.test('Nichts steht an: keine Nachricht, Tag trotzdem vermerkt (kein erneutes Lesen jede Minute)', async () => {
  const db = welt({ todos: [], termine: [] })
  const s = sender()
  const r = await sendePrivatTagesplaene(db, SA_MORGEN, s, nurHasan)
  assertEquals(s.gesendet.length, 0)
  assertEquals(r.leer, 1)
  assertEquals(db.tabelle('tagesplan_meldungen').length, 1)
  const abend = abendrueckblickNachricht('Hasan', { faellig: [], neu: [], heuteErledigt: 0, termine: [], ausgeblendet: new Set() }, HASAN, SA, 6)
  assertEquals(abend, null)
})

Deno.test('Einstellung aus (briefing.morgenplan=false): kein Morgenplan, Abend bleibt an', async () => {
  const db = welt({ privat_einstellungen: [{ login_email: HASAN, briefing: { privatBot: true, morgenplan: false } }] })
  const s = sender()
  await sendePrivatTagesplaene(db, SA_MORGEN, s, nurHasan)
  assertEquals(s.gesendet.length, 0)
  assertEquals(db.tabelle('tagesplan_meldungen').length, 0)
  await sendePrivatTagesplaene(db, SA_ABEND, s, nurHasan)
  assertEquals(s.gesendet.length, 1)
  assertEquals(planEinstellung(null), { morgenplan: true, abendrueckblick: true })
  assertEquals(planEinstellung({ abendrueckblick: false }), { morgenplan: true, abendrueckblick: false })
})

Deno.test('Ohne privaten Bot keine Nachricht', async () => {
  const db = welt()
  const s = sender()
  await sendePrivatTagesplaene(db, SA_MORGEN, s, { privatAktiv: () => Promise.resolve(false) })
  assertEquals(s.gesendet.length, 0)
  assertEquals(db.tabelle('tagesplan_meldungen').length, 0)
})

Deno.test('Lesefehler: keine Sperre, nächster Takt versucht es erneut', async () => {
  const db = welt()
  // deno-lint-ignore no-explicit-any
  const kaputt: any = new Proxy({}, {
    get: (_z, name) => name === 'then' ? (ok: (e: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'Zeitüberschreitung' } }).then(ok) : () => kaputt,
  })
  const admin = { from: (t: string) => (t === 'todos' ? kaputt : db.from(t)) }
  const s = sender()
  const r = await sendePrivatTagesplaene(admin, SA_MORGEN, s, nurHasan)
  assertEquals(s.gesendet.length, 0)
  assertEquals(db.tabelle('tagesplan_meldungen').length, 0)
  assertStringIncludes(r.fehler.join(' '), 'Zeitüberschreitung')
  await sendePrivatTagesplaene(db, new Date('2026-11-28T07:06:00Z'), s, nurHasan)
  assertEquals(s.gesendet.length, 1)
})

Deno.test('Senden scheitert: vermerkt als nicht zugestellt, kein Ersatz über den Mayer-Bot, keine Wiederholung', async () => {
  const db = welt()
  const s = sender(false)
  const r = await sendePrivatTagesplaene(db, SA_MORGEN, s, nurHasan)
  assertEquals(r.morgen, 0)
  assertEquals(db.tabelle('tagesplan_meldungen')[0].zugestellt, false)
  await sendePrivatTagesplaene(db, new Date('2026-11-28T07:06:00Z'), s, nurHasan)
  assertEquals(s.gesendet.length, 1)
})

Deno.test('Abend-Rückblick: erledigt heute, offen mit Knöpfen, morgen steht an, vage Aufgaben', async () => {
  const db = welt()
  const s = sender()
  const r = await sendePrivatTagesplaene(db, SA_ABEND, s, nurHasan)
  assertEquals(r.abend, 1)
  const { text, extra } = s.gesendet[0]
  assertStringIncludes(text, 'Guten Abend Hasan, dein Rückblick auf Samstag (28.11.)')
  assertStringIncludes(text, '✓ Heute erledigt: 2')
  assertStringIncludes(text, 'Noch offen für heute oder überfällig (7):')
  assertStringIncludes(text, '1. Überfällig A alt')
  assertStringIncludes(text, '… und 2 weitere')
  assertStringIncludes(text, 'Morgen steht an:')
  assertStringIncludes(text, 'Familienfest')
  assertStringIncludes(text, 'Morgen fällig Steuer (Privat) – fällig morgen · Prio A')
  assertStringIncludes(text, 'Bei diesen fehlt noch etwas: „Bosler?“')
  assertStringIncludes(text, 'sag mir kurz, was gemeint ist')
  // deno-lint-ignore no-explicit-any
  const tasten = (extra as any).reply_markup.inline_keyboard as { text: string; callback_data: string }[][]
  assertEquals(tasten.length, 5)
  assertEquals(tasten[0], [{ text: '✓ Erledigt (1)', callback_data: 'pt:e:t_ueber_a_alt' }, { text: '→ Morgen (1)', callback_data: 'pt:m:t_ueber_a_alt' }])
  for (const reihe of tasten) for (const k of reihe) assert(new TextEncoder().encode(k.callback_data).length <= 64)
  assertEquals(r.rueckfragen, [{ email: HASAN, todoIds: ['t_vage'] }])
  // Sperre gilt je Art: der Abend sperrt den Morgen nicht
  assertEquals(db.tabelle('tagesplan_meldungen').map((z) => z.id), [sperrKennung('abend', HASAN, SA)])
})

Deno.test('Knopf: Erledigt und Morgen nur für offene To-dos der eigenen Liste', async () => {
  const db = welt()
  assert(istPlanKnopf('pt:e:t_heute_a'))
  assertFalse(istPlanKnopf('vb:x:y'))
  assertFalse(istPlanKnopf('pt:x:t_heute_a'))

  const ok = await fuehrePlanKnopfAus(db, HASAN, 'pt:e:t_heute_a', SA_ABEND)
  assert(ok.ok)
  assertStringIncludes(ok.text, 'Erledigt: „Heute fällig A“')
  assertEquals(db.tabelle('todos').find((t) => t.id === 't_heute_a')!.erledigt_am, SA)

  const nochmal = await fuehrePlanKnopfAus(db, HASAN, 'pt:m:t_heute_a', SA_ABEND)
  assertFalse(nochmal.ok)
  assertStringIncludes(nochmal.text, 'schon erledigt')

  const morgen = await fuehrePlanKnopfAus(db, 'Sueslue@Hotmail.com', 'pt:m:t_wv', SA_ABEND)
  assert(morgen.ok)
  const wv = db.tabelle('todos').find((t) => t.id === 't_wv')!
  assertEquals(wv.erledigen_bis, '2026-11-29')
  assertEquals(wv.geplante_wiedervorlage, '2026-11-29')
  assertEquals(wv.erledigt_am, null)

  for (const [wer, daten] of [[HASAN, 'pt:e:t_fremd'], [HASAN, 'pt:e:t_bereich'], [QUIRIN, 'pt:e:t_ueber_a_alt'], [HASAN, 'pt:e:gibtsnicht'], [HASAN, 'Unsinn']] as const) {
    const r = await fuehrePlanKnopfAus(db, wer, daten, SA_ABEND)
    assertFalse(r.ok, `${wer} ${daten} hätte abgelehnt werden müssen`)
  }
  assertEquals(db.tabelle('todos').find((t) => t.id === 't_fremd')!.erledigt_am, null)
  assertEquals(db.tabelle('todos').find((t) => t.id === 't_bereich')!.erledigt_am, null)
  assertEquals(db.tabelle('todos').find((t) => t.id === 't_ueber_a_alt')!.erledigt_am, null)
})

Deno.test('privatMorgenplanAktiv: für die Zusammenführung mit tagesmeldung.ts', async () => {
  const db = welt()
  assert(await privatMorgenplanAktiv(db, HASAN, nurHasan.privatAktiv))
  assertFalse(await privatMorgenplanAktiv(db, QUIRIN, nurHasan.privatAktiv))
  const aus = welt({ privat_einstellungen: [{ login_email: HASAN, briefing: { privatBot: true, morgenplan: false } }] })
  assertFalse(await privatMorgenplanAktiv(aus, HASAN, nurHasan.privatAktiv))
  assertFalse(await privatMorgenplanAktiv(db, HASAN, () => Promise.reject(new Error('x'))))
})

Deno.test('Montag: gleiche Regeln werktags', async () => {
  const db = welt({ todos: [todo('t1', 'Hausverwaltung wegen Nebenkosten anrufen', { erledigen_bis: '2026-11-23', prio: 'A' })], termine: [] })
  const s = sender()
  await sendePrivatTagesplaene(db, MO_MORGEN, s, nurHasan)
  assertEquals(s.gesendet.length, 1)
  assertStringIncludes(s.gesendet[0].text, 'Montag (23.11.)')
})
