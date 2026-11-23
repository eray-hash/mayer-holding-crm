// Prüft den Abend-Rückblick im Mayer-Bot (abendRueckblick.ts) ohne Netz und ohne Telegram: Zeitfenster und Uhrzeit,
// welche Aufgaben (keine Microsoft-/privaten), Text und Knöpfe, Schalter aus / superuser (Probelauf „ginge an …“) / alle,
// kein doppelter Abend für Leute mit Tagesablauf-Abend, je Person abschaltbar, einmal am Tag, Knopf-Rechte, Ersetzen
// der Nachricht nach dem Klick, Trockenlauf ohne Schreiben.
import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import {
  abendRueckblickTrockenlauf,
  fuehreAbendKnopfAus,
  imAbendFenster,
  istAbendKnopf,
  istMayerAufgabe,
  naechsterTagName,
  naechsterWerktag,
  nachrichtNachKlick,
  probeNachrichten,
  type RueckblickPerson,
  sendeAbendRueckblicke,
  setzeAbendRueckblick,
  uhrzeitMinuten,
} from './abendRueckblick.ts'

// November: Berlin = UTC+1. 2026-11-23 ist ein Montag, 2026-11-27 ein Freitag, 2026-11-28 ein Samstag.
const MO_1735 = new Date('2026-11-23T16:35:00Z')
const MO_1725 = new Date('2026-11-23T16:25:00Z')
const MO_1900 = new Date('2026-11-23T18:00:00Z')
const MO_1030 = new Date('2026-11-23T09:30:00Z')
const SA_1735 = new Date('2026-11-28T16:35:00Z')
const FR_1735 = new Date('2026-11-27T16:35:00Z')
const HEUTE = '2026-11-23'

const ERAY = 'e@x.de'
const HASAN = 'h@x.de'
const QUIRIN = 'q@x.de'
const ANDREAS = 'a@x.de'

const ERAY_P: RueckblickPerson = { email: ERAY, name: 'Eray Yesil', gf: true, bereiche: [] }
const HASAN_P: RueckblickPerson = { email: HASAN, name: 'Hasan Süslü', gf: false, bereiche: ['beratung'] }

function todo(id: string, aufgabe: string, extra: Zeile = {}): Zeile {
  return { id, aufgabe, prio: null, erledigen_bis: null, geplante_wiedervorlage: null, erledigt_am: null, kunde_projekt: null, besitzer_email: ERAY, bereich: null, zustaendig: null, ms_id: null, ms_liste_id: null, ...extra }
}

function termin(id: string, titel: string, beginn: string, ende: string, extra: Zeile = {}): Zeile {
  return { id, titel, beginn, ende, ganztags: false, besitzer_email: ERAY, teilnehmer: [], kunde_bereich: null, ms_id: null, ...extra }
}

function welt(extra: Record<string, Zeile[]> = {}, modus = 'superuser'): FalscheDatenbank {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm_e', name: 'Eray Yesil', email: ERAY, rolle: 'mitarbeiter', ist_admin: true, ist_superuser: true, bereiche: [], telegram_chat_id: 333, aktiv: true },
      { id: 'm_h', name: 'Hasan Süslü', email: HASAN, rolle: 'mitarbeiter', ist_admin: false, ist_superuser: false, bereiche: ['beratung'], telegram_chat_id: 222, aktiv: true },
      { id: 'm_q', name: 'Quirin Lutzenberger', email: QUIRIN, rolle: 'mitarbeiter', ist_admin: false, ist_superuser: false, bereiche: ['immobilien'], telegram_chat_id: 111, aktiv: true },
      { id: 'm_a', name: 'Andreas Mayer', email: ANDREAS, rolle: 'geschaeftsfuehrung', ist_admin: false, ist_superuser: false, bereiche: [], telegram_chat_id: 444, aktiv: true },
      { id: 'm_o', name: 'Ohne Telegram', email: 'o@x.de', rolle: 'mitarbeiter', ist_admin: false, ist_superuser: false, bereiche: [], telegram_chat_id: null, aktiv: true },
    ],
    assistent_hinweis_einstellung: [{ id: 1, kontakt_nachfrage: 'aus', kurzpruefung_hinweis: 'aus', abend_rueckblick: modus, abend_rueckblick_uhrzeit: '17:30' }],
    assistent_hinweise: [],
    tagesplan_einstellungen: [{ email: QUIRIN, morgen_an: true, abend_an: true }],
    todos: [
      todo('e1', 'Angebot nachfassen', { erledigen_bis: '2026-11-20', prio: 'A', kunde_projekt: 'Muster GmbH' }),
      todo('e2', 'Rückruf Steuerbüro', { erledigen_bis: HEUTE }),
      todo('e3', 'Exposé prüfen', { erledigen_bis: '2026-11-18', prio: 'B' }),
      todo('e4', 'Unterlagen anfordern', { geplante_wiedervorlage: '2026-11-21' }),
      todo('e5', 'Vertrag lesen', { erledigen_bis: '2026-11-10', prio: 'C' }),
      todo('e6', 'Rechnung schreiben', { erledigen_bis: '2026-11-02' }),
      todo('e7', 'Termin vereinbaren', { erledigen_bis: '2026-11-22' }),
      todo('e_spaeter', 'Später', { erledigen_bis: '2026-12-10' }),
      todo('e_ms', 'Microsoft-Aufgabe', { erledigen_bis: '2026-11-20', ms_id: 'M1', ms_liste_id: 'L1' }),
      todo('e_fremd_zust', 'Für Hasan in Erays Liste', { erledigen_bis: '2026-11-20', zustaendig: 'Hasan Süslü' }),
      todo('e_done1', 'Erledigt 1', { erledigt_am: HEUTE }),
      todo('e_done2', 'Erledigt 2', { erledigt_am: HEUTE, erledigen_bis: '2026-11-20' }),
      todo('e_done_ms', 'Erledigt Microsoft', { erledigt_am: HEUTE, ms_id: 'M2' }),
      todo('h_own', 'Hasans private Liste', { besitzer_email: HASAN, erledigen_bis: '2026-11-19' }),
      todo('h_ber', 'Beratungsaufgabe Hasan', { besitzer_email: ERAY, bereich: 'beratung', zustaendig: 'Hasan', erledigen_bis: HEUTE }),
      todo('h_immo', 'Immo-Aufgabe ohne Recht', { besitzer_email: QUIRIN, bereich: 'immobilien', zustaendig: 'Hasan Süslü', erledigen_bis: HEUTE }),
      todo('q1', 'Quirins Aufgabe', { besitzer_email: QUIRIN, erledigen_bis: '2026-11-20' }),
    ],
    termine: [
      termin('t1', 'Notartermin', '2026-11-24T08:00:00Z', '2026-11-24T09:00:00Z'),
      termin('t2', 'Besichtigung', '2026-11-24T13:00:00Z', '2026-11-24T14:00:00Z'),
      termin('t3', 'Teamrunde', '2026-11-24T10:00:00Z', '2026-11-24T10:30:00Z', { besitzer_email: HASAN, teilnehmer: [ERAY] }),
      termin('t_ms', 'Aus Outlook', '2026-11-24T07:00:00Z', '2026-11-24T07:30:00Z', { ms_id: 'X1' }),
      termin('t_priv', 'Privater Termin', '2026-11-24T15:00:00Z', '2026-11-24T16:00:00Z', { kunde_bereich: 'privat' }),
      termin('t_abg', 'Abgesagt: Kunde', '2026-11-24T16:00:00Z', '2026-11-24T17:00:00Z'),
      termin('t_heute', 'Heute', '2026-11-23T08:00:00Z', '2026-11-23T09:00:00Z'),
    ],
    wiedervorlagen: [
      { id: 'w1', kunde_id: 'k1', bereich: 'beratung', titel: 'Neuanfrage prüfen', faellig: '2026-11-24', verantwortlich: 'Eray Yesil', erledigt_am: null },
      { id: 'w2', kunde_id: 'k1', bereich: 'beratung', titel: 'Später', faellig: '2026-11-26', verantwortlich: 'Eray Yesil', erledigt_am: null },
    ],
    kunden: [
      { id: 'k1', bereich: 'beratung', verantwortlich: 'Eray Yesil', follow_up: { date: HEUTE, done: false } },
      { id: 'k2', bereich: 'privat', verantwortlich: 'Eray Yesil', follow_up: { date: HEUTE, done: false } },
      { id: 'k3', bereich: 'beratung', verantwortlich: 'Eray Yesil', follow_up: { date: HEUTE, done: true } },
    ],
    objekte: [
      { id: 'o1', verantwortlich: 'Eray Yesil', follow_up: { date: '2026-11-24', done: false }, privat_besitzer: null },
      { id: 'o2', verantwortlich: 'Eray Yesil', follow_up: { date: '2026-11-24', done: false }, privat_besitzer: ERAY },
    ],
    ...extra,
  })
}

function bote() {
  const gesendet: { methode: string; daten: Record<string, unknown> }[] = []
  const telegram = (methode: string, daten: Record<string, unknown>) => {
    gesendet.push({ methode, daten })
    return Promise.resolve({ message_id: gesendet.length } as Record<string, unknown>)
  }
  return { gesendet, telegram }
}

const privatAktiv = (e: string) => Promise.resolve(e === HASAN)

Deno.test('Zeitfenster: werktags ab der Uhrzeit 90 Minuten; Uhrzeit einstellbar, Unlesbares → 17:30', () => {
  assert(imAbendFenster(MO_1735))
  assertFalse(imAbendFenster(MO_1725))
  assertFalse(imAbendFenster(MO_1900))
  assertFalse(imAbendFenster(SA_1735))
  assert(imAbendFenster(MO_1725, '17:00'))
  assertEquals(uhrzeitMinuten('kaputt'), 17 * 60 + 30)
  assertEquals(uhrzeitMinuten('03:00'), 17 * 60 + 30)
  assertEquals(uhrzeitMinuten('18:15'), 18 * 60 + 15)
})

Deno.test('Nächster Werktag: Freitag → Montag', () => {
  assertEquals(naechsterWerktag(HEUTE), '2026-11-24')
  assertEquals(naechsterWerktag('2026-11-27'), '2026-11-30')
  assertEquals(naechsterTagName(HEUTE), 'Morgen')
  assertEquals(naechsterTagName('2026-11-27'), 'Montag')
})

Deno.test('Welche Aufgaben: eigene Liste ohne Microsoft, Bereichsliste nur zuständig und mit Recht, private Liste mit privatem Assistenten nicht', () => {
  const t = (x: Zeile) => x as unknown as Parameters<typeof istMayerAufgabe>[1]
  assert(istMayerAufgabe(ERAY_P, t(todo('a', 'x')), true))
  assertFalse(istMayerAufgabe(ERAY_P, t(todo('a', 'x')), false), 'eigene Liste mit privatem Assistenten')
  assertFalse(istMayerAufgabe(ERAY_P, t(todo('a', 'x', { ms_id: 'M' })), true), 'Microsoft To Do')
  assertFalse(istMayerAufgabe(ERAY_P, t(todo('a', 'x', { zustaendig: 'Hasan Süslü' })), true), 'jemand anderes zuständig')
  assert(istMayerAufgabe(HASAN_P, t(todo('a', 'x', { bereich: 'beratung', zustaendig: 'Hasan' })), false))
  assertFalse(istMayerAufgabe(HASAN_P, t(todo('a', 'x', { bereich: 'immobilien', zustaendig: 'Hasan' })), true), 'fremder Bereich')
  assertFalse(istMayerAufgabe(HASAN_P, t(todo('a', 'x', { bereich: 'beratung', zustaendig: 'Quirin' })), true), 'nicht zuständig')
})

Deno.test('Außerhalb möglicher Fenster und bei Schalter aus: kein Versand, vormittags gar kein Datenbankzugriff', async () => {
  const db = welt()
  const b = bote()
  assertEquals((await sendeAbendRueckblicke(db, { jetzt: MO_1030, telegram: b.telegram, privatAktiv })).gesendet, 0)
  assertEquals(db.protokoll.length, 0)
  const db2 = welt({}, 'aus')
  const r = await sendeAbendRueckblicke(db2, { jetzt: MO_1735, telegram: b.telegram, privatAktiv })
  assertEquals(r.gesendet, 0)
  assertFalse(r.gelaufen)
  assertEquals(b.gesendet.length, 0)
  assertEquals(db2.protokoll.map((p) => p.tabelle), ['assistent_hinweis_einstellung'])
})

Deno.test('Probelauf (superuser): nur Eray — eigener Rückblick mit Knöpfen, dann „ginge an …“ ohne Knöpfe; einmal am Tag', async () => {
  const db = welt()
  const b = bote()
  const r = await sendeAbendRueckblicke(db, { jetzt: MO_1735, telegram: b.telegram, privatAktiv })
  assertEquals(r.fehler, [])
  assertEquals(r.gesendet, 1)
  assert(b.gesendet.every((g) => g.daten.chat_id === 333), 'nur an Eray')
  assertEquals(b.gesendet.length, 2)

  const eigene = b.gesendet[0].daten
  const text = String(eigene.text)
  assertEquals(
    text,
    [
      '🌙 Rückblick Montag, 23.11.',
      '✓ Heute erledigt: 2',
      'Noch offen (7):',
      '1. Angebot nachfassen (Muster GmbH) – überfällig seit 20.11. · Prio A',
      '2. Exposé prüfen – überfällig seit 18.11. · Prio B',
      '3. Vertrag lesen – überfällig seit 10.11. · Prio C',
      '4. Rechnung schreiben – überfällig seit 02.11.',
      '5. Unterlagen anfordern – Wiedervorlage seit 21.11.',
      '… und 2 weitere',
      'Morgen: 3 Termine (09:00 Notartermin, 11:00 Teamrunde …) · 3 Wiedervorlagen fällig',
    ].join('\n'),
  )
  assertFalse(text.includes('Microsoft'))
  // deno-lint-ignore no-explicit-any
  const knoepfe = (eigene.reply_markup as any).inline_keyboard
  assertEquals(knoepfe.length, 5)
  assertEquals(knoepfe[0], [{ text: '✓ Erledigt (1)', callback_data: 'ar:e:e1' }, { text: '→ Morgen (1)', callback_data: 'ar:m:e1' }])
  assert(knoepfe.flat().every((k: { callback_data: string }) => istAbendKnopf(k.callback_data)))

  const probe = String(b.gesendet[1].daten.text)
  assertEquals(b.gesendet[1].daten.reply_markup, undefined)
  assertStringIncludes(probe, 'Probelauf Abend-Rückblick')
  assertStringIncludes(probe, '— ginge an Hasan Süslü:')
  assertStringIncludes(probe, 'Beratungsaufgabe Hasan')
  assertFalse(probe.includes('Hasans private Liste'), 'eigene Liste ist mit privatem Assistenten privat')
  assertFalse(probe.includes('Immo-Aufgabe'), 'fremder Bereich')
  assertFalse(probe.includes('ginge an Quirin'), 'Quirin hat den Tagesablauf-Abend')
  assertStringIncludes(probe, 'Quirin (hat schon „Offen geblieben“)')
  assertStringIncludes(probe, 'Andreas (nichts erledigt, nichts offen)')
  assertFalse(probe.includes('Ohne Telegram'))

  // Zweiter Takt: nichts mehr.
  const r2 = await sendeAbendRueckblicke(db, { jetzt: new Date(MO_1735.getTime() + 60_000), telegram: b.telegram, privatAktiv })
  assertEquals(r2.gesendet, 0)
  assertEquals(b.gesendet.length, 2)
  assertEquals(db.tabelle('assistent_hinweise').find((z) => z.email === ERAY)?.abend_rueckblick_tag, HEUTE)
})

Deno.test('Alle: jeder mit Telegram und Inhalt; Quirin (Tagesablauf-Abend) und Abgeschaltete nicht; ohne Inhalt nichts', async () => {
  const db = welt({}, 'alle')
  const b = bote()
  const r = await sendeAbendRueckblicke(db, { jetzt: MO_1735, telegram: b.telegram, privatAktiv })
  assertEquals(r.fehler, [])
  assertEquals(b.gesendet.map((g) => g.daten.chat_id).sort(), [222, 333])
  const hasan = String(b.gesendet.find((g) => g.daten.chat_id === 222)!.daten.text)
  assertStringIncludes(hasan, '✓ Heute erledigt: 0')
  assertStringIncludes(hasan, '1. Beratungsaufgabe Hasan – fällig heute')
  assertStringIncludes(hasan, 'Morgen: 1 Termin (11:00 Teamrunde)')
  assertFalse(hasan.includes('Probelauf'))

  const db2 = welt({ assistent_hinweise: [{ email: HASAN, abend_rueckblick: false }] }, 'alle')
  const b2 = bote()
  await sendeAbendRueckblicke(db2, { jetzt: MO_1735, telegram: b2.telegram, privatAktiv })
  assertEquals(b2.gesendet.map((g) => g.daten.chat_id), [333])
})

Deno.test('Freitag: Knopf „→ Montag“ und Zeile für Montag', async () => {
  const db = welt({}, 'alle')
  const b = bote()
  await sendeAbendRueckblicke(db, { jetzt: FR_1735, telegram: b.telegram, privatAktiv })
  const eray = b.gesendet.find((g) => g.daten.chat_id === 333)!.daten
  assertStringIncludes(String(eray.text), '🌙 Rückblick Freitag, 27.11.')
  // Bis Montag fällig: w1, w2 (Tabelle), k1 (Kontakt), o1 (Objekt).
  assertStringIncludes(String(eray.text), 'Montag: 4 Wiedervorlagen fällig')
  // deno-lint-ignore no-explicit-any
  assertEquals((eray.reply_markup as any).inline_keyboard[0][1].text, '→ Montag (1)')
})

Deno.test('Lesefehler: nichts beansprucht, nichts gesendet (nächster Takt versucht es erneut)', async () => {
  const db = welt({}, 'alle')
  db.nachAbfrage = (info) => {
    if (info.tabelle === 'termine') throw new Error('Netz weg')
  }
  const b = bote()
  const r = await sendeAbendRueckblicke(db, { jetzt: MO_1735, telegram: b.telegram, privatAktiv })
  assertEquals(b.gesendet.length, 0)
  assert(r.fehler.length > 0)
  assertEquals(db.tabelle('assistent_hinweise').length, 0)
})

Deno.test('Knopf: Erledigt und → Morgen nur für eigene bzw. zugewiesene offene Aufgaben', async () => {
  const db = welt()
  const e = await fuehreAbendKnopfAus(db, ERAY_P, 'ar:e:e1', MO_1735)
  assert(e.ok)
  assertEquals(e.vermerk, '✓ erledigt')
  assertEquals(db.tabelle('todos').find((t) => t.id === 'e1')?.erledigt_am, HEUTE)

  const m = await fuehreAbendKnopfAus(db, ERAY_P, 'ar:m:e4', FR_1735)
  assert(m.ok)
  assertEquals(m.vermerk, '→ auf Montag verschoben')
  const e4 = db.tabelle('todos').find((t) => t.id === 'e4')!
  assertEquals(e4.erledigen_bis, '2026-11-30')
  assertEquals(e4.geplante_wiedervorlage, '2026-11-30')

  assertEquals((await fuehreAbendKnopfAus(db, ERAY_P, 'ar:m:e2', MO_1735)).vermerk, '→ auf morgen verschoben')
  assertEquals(db.tabelle('todos').find((t) => t.id === 'e2')?.erledigen_bis, '2026-11-24')

  const wieder = await fuehreAbendKnopfAus(db, ERAY_P, 'ar:e:e1', MO_1735)
  assertFalse(wieder.ok)
  assertEquals(wieder.vermerk, '✓ schon erledigt')

  for (const fremd of ['ar:e:q1', 'ar:e:e_ms', 'ar:e:h_ber', 'ar:e:gibtsnicht']) {
    const r = await fuehreAbendKnopfAus(db, ERAY_P, fremd, MO_1735)
    assertFalse(r.ok, fremd)
    assertEquals(r.vermerk, undefined, fremd)
  }
  assertEquals(db.tabelle('todos').find((t) => t.id === 'q1')?.erledigt_am, null)
  // Bereichsaufgabe, für die Hasan zuständig ist: darf er.
  assert((await fuehreAbendKnopfAus(db, HASAN_P, 'ar:e:h_ber', MO_1735)).ok)
  assertFalse((await fuehreAbendKnopfAus(db, HASAN_P, 'ar:e:h_immo', MO_1735)).ok)
  assertFalse((await fuehreAbendKnopfAus(db, ERAY_P, 'pt:e:e2', MO_1735)).ok)
})

Deno.test('Nach dem Klick: Zeile mit Vermerk, ihre Knöpfe weg, die übrigen bleiben', () => {
  const text = '🌙 Rückblick Montag, 23.11.\n✓ Heute erledigt: 2\nNoch offen (2):\n1. A – überfällig seit 20.11.\n2. B – fällig heute\nMorgen: keine Termine, keine Wiedervorlagen'
  const tastatur = [
    [{ text: '✓ Erledigt (1)', callback_data: 'ar:e:a' }, { text: '→ Morgen (1)', callback_data: 'ar:m:a' }],
    [{ text: '✓ Erledigt (2)', callback_data: 'ar:e:b' }, { text: '→ Morgen (2)', callback_data: 'ar:m:b' }],
  ]
  const n = nachrichtNachKlick(text, tastatur, 'ar:m:b', '→ auf morgen verschoben')
  assertStringIncludes(n.text, '2. B – fällig heute — → auf morgen verschoben')
  assertStringIncludes(n.text, '1. A – überfällig seit 20.11.\n')
  assertEquals(n.tastatur, [tastatur[0]])
  const n2 = nachrichtNachKlick(n.text, n.tastatur, 'ar:e:a', '✓ erledigt')
  assertStringIncludes(n2.text, '1. A – überfällig seit 20.11. — ✓ erledigt')
  assertEquals(n2.tastatur, [])
  // Schon weg: nichts doppelt.
  assertEquals(nachrichtNachKlick(n2.text, n2.tastatur, 'ar:e:a', '✓ erledigt').text, n2.text)
})

Deno.test('Probelauf-Text: unter der Telegram-Grenze aufgeteilt', () => {
  const lang = 'x'.repeat(1500)
  const teile = probeNachrichten([{ name: 'A', text: lang }, { name: 'B', text: lang }, { name: 'C', text: lang }])
  assert(teile.length >= 2)
  assert(teile.every((t) => t.length <= 3800))
  assertStringIncludes(teile.join('\n'), '— ginge an C:')
  assertStringIncludes(probeNachrichten([])[0], 'Heute ginge an niemanden sonst etwas.')
})

Deno.test('Trockenlauf: Stand und Text je Person, schreibt und sendet nichts', async () => {
  const db = welt()
  const r = await abendRueckblickTrockenlauf(db, { jetzt: MO_1735, privatAktiv })
  assertEquals(r.fehler, [])
  assertEquals(r.modus, 'superuser')
  assert(r.imFenster)
  const stand = Object.fromEntries(r.personen.map((p) => [p.email, p.stand]))
  assertEquals(stand, { [ERAY]: 'wuerde_senden', [HASAN]: 'wuerde_senden', [QUIRIN]: 'tagesplan_abend', [ANDREAS]: 'nichts_offen', 'o@x.de': 'ohne_telegram' })
  assertStringIncludes(r.personen.find((p) => p.email === ERAY)!.text!, 'Noch offen (7):')
  assertEquals(r.personen.find((p) => p.email === ERAY)!.knoepfe!.length, 10)
  assert(db.protokoll.every((p) => p.art === 'select'), 'nur gelesen')

  const nur = await abendRueckblickTrockenlauf(db, { email: 'H@x.de', jetzt: MO_1735, privatAktiv })
  assertEquals(nur.personen.map((p) => p.email), [HASAN])
})

Deno.test('Abschalten je Person: setzeAbendRueckblick schreibt nur die eigene Zeile', async () => {
  const db = welt()
  assertEquals(await setzeAbendRueckblick(db, ' E@x.de ', false), null)
  assertEquals(db.tabelle('assistent_hinweise').map((z) => [z.email, z.abend_rueckblick]), [[ERAY, false]])
  const b = bote()
  await sendeAbendRueckblicke(db, { jetzt: MO_1735, telegram: b.telegram, privatAktiv })
  assertEquals(b.gesendet.length, 0)
})
