// Prüft den täglichen Kontrollbericht (kontrollbericht.ts) ohne Netz: Zahlen des Tages (Mails im Bereichspostfach,
// To-dos, Objekte, Zeiterfassung, Tagesablauf, CRM-Minuten, Telegram-Anfragen), kurzer Text, Fenster werktags ab 18 Uhr,
// einmal am Tag, nur an den Empfänger der Einstellung über den Mayer-Bot, ohne Einstellung nichts.
//
//   npx -y deno test --allow-all --no-check email-gateway/kontrollbericht.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { imFenster, kontrollberichtTest, kontrollText, ladeKontrollDaten, normalisiereEinstellung, pruefeKontrollberichte, vergissEinstellung, vergissTag, zaehleAnfragen } from './kontrollbericht.ts'

const IMMO = 'immo@amayer-holding.com'
const HASAN = 'sueslue@hotmail.com'
// Montag, 23.11.2026, 18:30 Uhr in Berlin.
const JETZT = new Date('2026-11-23T17:30:00Z')
const HEUTE = (uhr: string) => `2026-11-23T${uhr}:00Z`

function einstellung(daten: Record<string, unknown> = { an: true, stunde: 18, eintraege: [{ mitarbeiter: IMMO, empfaenger: HASAN, an: true }] }): Zeile {
  return { id: 'kontrollbericht_einstellung', art: 'kontrollbericht_einstellung', daten, updated_at: '2026-11-23T08:00:00Z' }
}

function eingang(id: string, von: string, datum: string, extra: Zeile = {}): Zeile {
  return { id, von, betreff: `Mail ${id}`, ausschnitt: 'Hallo', rohdaten: {}, relevanz: 'kunde', ignoriert: false, besitzer_email: null, postfach_id: 'pf_immo', postfach_bereich: 'immobilien', mail_datum: datum, ...extra }
}

function aufbau(einst: Zeile | null = einstellung()): FalscheDatenbank {
  return new FalscheDatenbank({
    mitarbeiter: [
      { name: 'Quirin Lutzenberger', email: IMMO, aktiv: true, telegram_chat_id: 222 },
      { name: 'Hasan Süslü', email: HASAN, aktiv: true, telegram_chat_id: 111 },
      { name: 'Eray Yesil', email: 'eray.yesil@fundament-it.de', aktiv: true, telegram_chat_id: 333 },
    ],
    postfaecher: [{ id: 'pf_immo', adresse: IMMO, bereich: 'immobilien', besitzer_email: null, verantwortlich_email: IMMO }],
    eingegangene_emails: [
      eingang('e1', 'kaeufer@web.de', HEUTE('08:00')),
      eingang('e2', 'werbung@shop.de', HEUTE('09:00'), { relevanz: 'nicht_relevant' }),
      // Älter als zwei Tage: e3 beantwortet, e4 offen, e5 Systemabsender, e6 Kollege.
      eingang('e3', 'verkaeufer@firma.de', '2026-11-18T10:00:00Z'),
      eingang('e4', 'interessent@gmx.de', '2026-11-16T10:00:00Z'),
      eingang('e5', 'noreply@portal.de', '2026-11-16T10:00:00Z'),
      eingang('e6', 'sueslue@hotmail.com', '2026-11-16T10:00:00Z'),
    ],
    gesendete_emails: [
      { id: 'g1', an: 'verkaeufer@firma.de', gesendet_am: '2026-11-19T10:00:00Z', postfach_id: 'pf_immo' },
      { id: 'g2', an: 'kaeufer@web.de', gesendet_am: HEUTE('10:00'), postfach_id: 'pf_immo' },
      { id: 'g3', an: 'jemand@web.de', gesendet_am: HEUTE('11:00'), postfach_id: 'standard' },
    ],
    todos: [
      { id: 't1', aufgabe: 'Exposé schreiben', zustaendig: 'Quirin Lutzenberger', erledigt_am: '2026-11-23', besitzer_email: IMMO, bereich: null },
      { id: 't2', aufgabe: 'Anruf', zustaendig: null, erledigen_bis: '2026-11-20', erledigt_am: null, besitzer_email: IMMO, bereich: null },
      { id: 't3', aufgabe: 'Für Hasan', zustaendig: 'Hasan Süslü', erledigen_bis: '2026-11-20', erledigt_am: null, besitzer_email: IMMO, bereich: null },
      { id: 't4', aufgabe: 'Bereichsliste', zustaendig: 'Quirin', erledigen_bis: '2026-11-01', erledigt_am: null, besitzer_email: HASAN, bereich: 'immobilien' },
      { id: 't5', aufgabe: 'Microsoft', zustaendig: null, erledigen_bis: '2026-11-01', erledigt_am: null, besitzer_email: IMMO, bereich: null, ms_id: 'abc' },
    ],
    objekte: [
      { id: 'o1', verantwortlich: 'Quirin Lutzenberger', activities: [{ date: '2026-11-23', user: 'Quirin Lutzenberger', text: 'Exposé erstellt' }], kurzpruefung: { datum: '2026-11-23' }, bewertung: null, privat_besitzer: null },
      { id: 'o2', verantwortlich: 'Quirin Lutzenberger', activities: [], kurzpruefung: null, bewertung: { gestartetVon: IMMO, gestartetAm: HEUTE('09:30') }, privat_besitzer: null },
      { id: 'o3', verantwortlich: 'Andreas Mayer', activities: [{ date: '2026-11-23', user: 'Andreas Mayer', text: 'Notiz' }], kurzpruefung: null, bewertung: null, privat_besitzer: null },
      { id: 'o4', verantwortlich: 'Quirin Lutzenberger', activities: [{ date: '2026-11-23', user: 'Quirin Lutzenberger', text: 'privat' }], privat_besitzer: IMMO },
    ],
    abteilung_eintraege: [
      ...(einst ? [einst] : []),
      { id: 'z1', art: 'zeit', daten: { mitarbeiter: 'Quirin Lutzenberger', datum: '2026-11-23', dauerMin: 90 } },
      { id: 'z2', art: 'zeit', daten: { mitarbeiter: 'Quirin Lutzenberger', datum: '2026-11-23', dauerMin: 45 } },
      { id: 'z3', art: 'zeit', daten: { mitarbeiter: 'Quirin Lutzenberger', datum: '2026-11-22', dauerMin: 45 } },
      { id: 'Quirin Lutzenberger|2026-11-23', art: 'tagesplan', daten: { mitarbeiter: 'Quirin Lutzenberger', datum: '2026-11-23', zeilen: [{ was: 'A', erledigt: true }, { was: 'B' }, { was: '' }] } },
    ],
    nutzung_minuten: [
      { email: IMMO, minute: HEUTE('07:15') },
      { email: IMMO, minute: HEUTE('07:16') },
      { email: IMMO, minute: HEUTE('15:40') },
      { email: IMMO, minute: '2026-11-22T10:00:00Z' },
    ],
    ki_verbrauch: [
      { id: 1, person: IMMO, anlass: 'telegram', am: HEUTE('08:00') },
      { id: 2, person: IMMO, anlass: 'telegram', am: '2026-11-23T08:00:40Z' },
      { id: 3, person: IMMO, anlass: 'telegram', am: HEUTE('12:00') },
      { id: 4, person: IMMO, anlass: 'dokument_lesen', am: HEUTE('12:00') },
    ],
  })
}

Deno.test('Telegram-Anfragen: Aufrufe kurz hintereinander zählen einmal', () => {
  assertEquals(zaehleAnfragen([]), 0)
  assertEquals(zaehleAnfragen([0, 40_000, 80_000, 500_000]), 2)
})

Deno.test('Einstellung: Vorgaben und ungültige Einträge', () => {
  const e = normalisiereEinstellung({ an: true, eintraege: [{ mitarbeiter: 'IMMO@amayer-holding.com', empfaenger: HASAN }, { mitarbeiter: 'kaputt' }] })
  assertEquals(e, { an: true, stunde: 18, eintraege: [{ mitarbeiter: IMMO, empfaenger: HASAN, an: true }] })
  assertEquals(normalisiereEinstellung(null).an, false)
  assert(imFenster(e, JETZT))
  assert(!imFenster(e, new Date('2026-11-23T16:30:00Z'))) // 17:30 Uhr
  assert(!imFenster(e, new Date('2026-11-21T17:30:00Z'))) // Samstag
})

Deno.test('Zahlen des Tages', async () => {
  const d = await ladeKontrollDaten(aufbau(), { name: 'Quirin Lutzenberger', email: IMMO }, JETZT)
  assertEquals(d.postfaecher, [IMMO])
  assertEquals(d.mailsNeu, 1)
  assertEquals(d.mailsBeantwortet, 1)
  assertEquals(d.mailsOffen, 1)
  assertEquals(d.aeltesteOffenTage, 7)
  assertEquals(d.todosErledigt, 1)
  assertEquals(d.todosUeberfaellig, 2)
  assertEquals(d.objekte, { bearbeitet: 2, kurzpruefung: 1, bewertung: 1, expose: 1, verlauf: 1 })
  assertEquals(d.zeit, { eintraege: 2, minuten: 135 })
  assertEquals(d.tagesplan, { punkte: 2, erledigt: 1 })
  assertEquals(d.crmMinuten, 3)
  assertEquals([d.crmVon, d.crmBis], ['08:15', '16:40'])
  assertEquals(d.telegramAnfragen, 2)
  const t = kontrollText('Quirin Lutzenberger', d)
  assert(t.split('\n').length <= 10, t)
  assertStringIncludes(t, 'Tagesbericht Quirin Lutzenberger – Mo 23.11.')
  assertStringIncludes(t, 'Mails (immo@): 1 neu · 1 beantwortet · 1 offen > 2 Tage (älteste 7 Tage)')
  assertStringIncludes(t, 'Zeiterfassung: 2 Einträge, 2:15 Std.')
  assert(!/\$|€|kosten/i.test(t))
})

Deno.test('Minutentakt: werktags ab 18 Uhr einmal an Hasan über den Mayer-Bot', async () => {
  vergissEinstellung()
  vergissTag()
  const db = aufbau()
  const gesendet: { chat: number | string; text: string }[] = []
  const sende = (chat: number | string, text: string) => {
    gesendet.push({ chat, text })
    return Promise.resolve(true)
  }
  assertEquals((await pruefeKontrollberichte(db, sende, new Date('2026-11-23T16:30:00Z'))).gesendet, 0)
  vergissEinstellung()
  assertEquals((await pruefeKontrollberichte(db, sende, JETZT)).gesendet, 1)
  assertEquals(gesendet.length, 1)
  assertEquals(gesendet[0].chat, 111)
  assertStringIncludes(gesendet[0].text, 'Quirin Lutzenberger')
  // Zweiter Takt am selben Abend: nichts mehr.
  vergissTag()
  assertEquals((await pruefeKontrollberichte(db, sende, new Date('2026-11-23T17:45:00Z'))).gesendet, 0)
  assertEquals(gesendet.length, 1)
  const stand = db.tabellen.abteilung_eintraege.find((z) => z.id === 'kontrollbericht_stand')!.daten as Record<string, unknown>
  assertEquals(stand.zustand, 'gesendet')
})

Deno.test('Ohne Einstellung oder ausgeschaltet: keine Nachricht; Vorschau sendet nie', async () => {
  for (const einst of [null, einstellung({ an: false, eintraege: [{ mitarbeiter: IMMO, empfaenger: HASAN }] }), einstellung({ an: true, eintraege: [{ mitarbeiter: IMMO, empfaenger: HASAN, an: false }] })]) {
    vergissEinstellung()
    vergissTag()
    const db = aufbau(einst)
    let n = 0
    await pruefeKontrollberichte(db, () => Promise.resolve(++n > 0), JETZT)
    assertEquals(n, 0)
  }
  const db = aufbau()
  const v = await kontrollberichtTest(db, { jetzt: JETZT.toISOString() })
  assert(v.ok)
  if (v.ok) {
    assertEquals(v.berichte.length, 1)
    assertEquals(v.berichte[0].empfaenger, 'Hasan Süslü')
  }
  assertEquals(db.tabellen.abteilung_eintraege.some((z) => z.id === 'kontrollbericht_stand'), false)
})
