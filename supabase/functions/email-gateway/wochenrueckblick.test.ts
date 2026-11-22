// Tests für den Wochenrückblick (wochenrueckblick.ts) — mit einer Datenbank im Speicher, ohne Netz und ohne KI.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import {
  artDesWechsels,
  baueRueckblick,
  isoWoche,
  leseStatuswechsel,
  ladeRueckblickDaten,
  pruefeWochenrueckblick,
  rueckblickText,
  waehleAchtung,
  wochenrueckblickEinstellung,
  wochenrueckblickTest,
  zusammenfassung,
} from './wochenrueckblick.ts'

// Freitag, 20.11.2026, 16:05 Uhr in Berlin (Winterzeit = UTC+1)
const FREITAG = new Date('2026-11-20T15:05:00Z')
const ERAY = 'eray@example.de'
const HASAN = 'hasan@example.de'
const QUIRIN = 'quirin@example.de'

/** Die Testdatenbank kennt kein range/ilike — beides hier nachgebildet (eine Seite reicht). */
// deno-lint-ignore no-explicit-any
function db(tabellen: Record<string, Zeile[]>): any {
  const d = falscheDatenbank(tabellen)
  const from = d.from.bind(d)
  // deno-lint-ignore no-explicit-any
  ;(d as any).from = (t: string) => {
    // deno-lint-ignore no-explicit-any
    const q: any = from(t)
    q.range = (ab: number) => (ab === 0 ? q : q.limit(0))
    q.ilike = (s: string, w: string) => q.eq(s, w.replace(/\\(.)/g, '$1'))
    return q
  }
  return d
}

function grunddaten(): Record<string, Zeile[]> {
  return {
    mitarbeiter: [
      { id: '1', name: 'Eray Yesil', email: ERAY, aktiv: true, rolle: 'geschaeftsfuehrung', ist_admin: true, telegram_chat_id: 111 },
      { id: '2', name: 'Hasan Süslü', email: HASAN, aktiv: true, rolle: 'geschaeftsfuehrung', ist_admin: true, telegram_chat_id: 222 },
      { id: '3', name: 'Quirin Lutzenberger', email: QUIRIN, aktiv: true, rolle: 'mitarbeiter', ist_admin: false, telegram_chat_id: 333 },
      { id: '4', name: 'Mayer Holding', email: 'info@example.de', aktiv: true, rolle: 'geschaeftsfuehrung', ist_admin: true, telegram_chat_id: null },
    ],
    kunden: [
      // neu in dieser Woche, Abschluss
      {
        id: 'k1', bereich: 'beratung', firma: 'Geheime Firma GmbH', status: 'unterschrieben', verantwortlich: 'Hasan',
        activities: [
          { id: 'a1', date: '2026-11-17', text: 'Akte angelegt', user: 'Hasan Süslü' },
          { id: 'a2', date: '2026-11-19', text: 'Status: Angebot / Beratungsvertrag versendet → Beratungsvertrag unterschrieben am 2026-11-19 durch Hasan Süslü', user: 'Hasan Süslü' },
        ],
        follow_up: { date: '2026-11-10', note: 'nachfassen', done: false },
      },
      // alte Akte, heiß, ohne nächsten Schritt, offener KV
      { id: 'k2', bereich: 'immobilienkunden', firma: 'Kunde Zwei', status: 'verhandlung', verantwortlich: 'Quirin', activities: [{ date: '2026-10-01', text: 'angelegt' }], follow_up: null },
      // verloren per Telegram
      { id: 'k3', bereich: 'finanzierungen', firma: 'Kunde Drei', status: 'verloren', activities: [{ date: '2026-09-01', text: 'x' }, { date: '2026-11-18', text: 'Per Telegram geändert — Status: Verloren / Kein Interesse', user: 'Eray Yesil' }] },
      // privat: zählt nirgends
      { id: 'k4', bereich: 'privat', firma: 'Privatkontakt', status: 'neu', activities: [{ date: '2026-11-18', text: 'angelegt' }] },
      // heiß, aber mit Termin
      { id: 'k5', bereich: 'beratung', firma: 'Kunde Fünf', status: 'angebot', verantwortlich: 'Eray', activities: [{ date: '2026-08-01', text: 'x' }] },
    ],
    objekte: [
      { id: 'o1', bezeichnung: 'MFH Ulm', status: 'notartermin', verantwortlich: 'Quirin Lutzenberger', activities: [{ date: '2026-11-16', text: 'Objekt angelegt' }, { date: '2026-11-18', text: 'Per Telegram geändert — Status: Prüfung durch Käufer → Notartermin.' }], follow_up: null },
      { id: 'o2', bezeichnung: 'Privates Haus', status: 'akquise', privat_besitzer: ERAY, activities: [{ date: '2026-11-18', text: 'angelegt' }] },
    ],
    kostenvoranschlaege: [
      { id: 'kv1', kunde_id: 'k2', bereich: 'immobilienkunden', betrag: 12000, status: 'offen', erstellt_am: '2026-11-18T10:00:00Z', geaendert_am: '2026-11-18T10:00:00Z' },
      { id: 'kv2', kunde_id: 'k1', bereich: 'beratung', betrag: 5000, status: 'angenommen', erstellt_am: '2026-11-01T10:00:00Z', geaendert_am: '2026-11-19T10:00:00Z' },
      { id: 'kv3', kunde_id: 'k4', bereich: 'privat', betrag: 999, status: 'offen', erstellt_am: '2026-11-18T10:00:00Z' },
    ],
    rechnungen: [
      { id: 'r1', nummer: 'RE-2026-007', kunde_id: 'k1', datum: '2026-10-01', betrag_brutto: 4800, status: 'Versendet', zahlungsziel: '2026-10-15', zahlungen: [{ id: 'z1', datum: '2026-11-17', betrag: 800 }] },
      { id: 'r2', nummer: 'RE-2026-010', kunde_id: 'k1', datum: '2026-11-18', versendet_am: '2026-11-18', betrag_brutto: 1190, status: 'Versendet', zahlungsziel: '2026-12-02' },
      { id: 'r3', nummer: 'RE-2026-003', kunde_id: 'k2', datum: '2026-09-01', betrag_brutto: 500, status: 'Bezahlt', bezahlt_am: '2026-11-19' },
      { id: 'r4', nummer: 'RE-P-1', kunde_id: 'k4', datum: '2026-11-18', betrag_brutto: 77777, status: 'Versendet', zahlungsziel: '2026-11-01' },
    ],
    vorgeschlagene_leads: [
      { id: 'l1', status: 'uebernommen', erstellt_am: '2026-11-18T08:00:00Z' },
      { id: 'l2', status: 'neu', erstellt_am: '2026-11-19T08:00:00Z' },
      { id: 'l3', status: 'nicht_relevant', erstellt_am: '2026-11-19T08:00:00Z' },
    ],
    unterschrift_anfragen: [
      { id: 'u1', bereich: 'beratung', unterschrieben_am: '2026-11-19T09:00:00Z', abgelehnt_am: null },
      { id: 'u2', bereich: 'privat', unterschrieben_am: '2026-11-19T09:00:00Z', abgelehnt_am: null },
    ],
    objekt_freigaben: [
      { id: 'f1', objekt_id: 'o1', status: 'zugestimmt', zustimmung: { am: '2026-11-19T12:00:00Z' } },
      { id: 'f2', objekt_id: 'o2', status: 'zugestimmt', zustimmung: { am: '2026-11-19T12:00:00Z' } },
    ],
    besichtigungen: [
      { id: 'b1', objekt_id: 'o1', erstellt_am: '2026-11-19T12:00:00Z', freigabe_id: 'f1', beginn: '2026-11-25T10:00:00Z', status: 'geplant', kalender_termin_id: 't2' },
      { id: 'b2', objekt_id: 'o1', erstellt_am: '2026-11-19T13:00:00Z', freigabe_id: null, status: 'geplant' },
    ],
    objekt_anfragen: [
      { email_id: 'e1', status: 'angelegt', erstellt_am: '2026-11-18T12:00:00Z' },
      { email_id: 'e2', status: 'unklar', erstellt_am: '2026-11-18T12:00:00Z' },
      { email_id: 'e3', status: 'vor_start', erstellt_am: '2026-11-18T12:00:00Z' },
    ],
    todos: [
      { id: 'td1', aufgabe: 'Liste', zustaendig: 'Hasan', erledigen_bis: '2026-11-01', bereich: 'beratung', erledigt_am: null },
      { id: 'td2', aufgabe: 'Privat', zustaendig: 'Hasan', erledigen_bis: '2026-11-01', bereich: null, erledigt_am: null },
    ],
    termine: [
      { id: 't1', titel: 'Gespräch', beginn: '2026-11-24T09:00:00Z', ende: '2026-11-24T10:00:00Z', besitzer_email: ERAY, kunde_id: 'k5', quelle: 'crm' },
      { id: 't1b', titel: 'Gespräch', beginn: '2026-11-24T09:00:00Z', ende: '2026-11-24T10:00:00Z', besitzer_email: HASAN, kunde_id: 'k5', quelle: 'crm' },
      { id: 't2', titel: 'Besichtigung', beginn: '2026-11-25T10:00:00Z', ende: '2026-11-25T11:00:00Z', besitzer_email: QUIRIN, quelle: 'crm' },
      { id: 't3', titel: 'Zahnarzt', beginn: '2026-11-24T07:00:00Z', ende: '2026-11-24T08:00:00Z', besitzer_email: ERAY, quelle: 'outlook' },
      { id: 't4', titel: 'Privat', beginn: '2026-11-24T07:00:00Z', ende: '2026-11-24T08:00:00Z', besitzer_email: ERAY, kunde_id: 'k4', quelle: 'crm' },
    ],
    abteilung_eintraege: [],
  }
}

Deno.test('isoWoche: Kalenderwochen nach ISO', () => {
  assertEquals(isoWoche('2026-11-20'), '2026-W47')
  assertEquals(isoWoche('2026-11-16'), '2026-W47')
  assertEquals(isoWoche('2026-11-22'), '2026-W47')
  assertEquals(isoWoche('2027-01-01'), '2026-W53')
  assertEquals(isoWoche('2025-12-29'), '2026-W01')
})

Deno.test('leseStatuswechsel: Formen aus CRM und Assistent', () => {
  assertEquals(leseStatuswechsel('Status: Akquise → Objektaufnahme / Vorbereitung am 2026-11-13 durch Quirin Lutzenberger'), { von: 'Akquise', nach: 'Objektaufnahme / Vorbereitung' })
  assertEquals(leseStatuswechsel('Per Telegram geändert — verantwortlich: Hasan; Status: Interessent'), { von: null, nach: 'Interessent' })
  assertEquals(leseStatuswechsel('Per Telegram geändert — Kaufpreis: 1 € → 2 €; Status: Reserviert → Notartermin.'), { von: 'Reserviert', nach: 'Notartermin' })
  assertEquals(leseStatuswechsel('Gespräch über den Stand der Dinge'), null)
})

Deno.test('artDesWechsels: gewonnen nur beim ersten Abschluss-Stand, verloren einmal', () => {
  assertEquals(artDesWechsels('beratung', { von: 'Angebot', nach: 'Beratungsvertrag unterschrieben' }), 'gewonnen')
  assertEquals(artDesWechsels('beratung', { von: 'Aktives Mandat', nach: 'Abgeschlossen' }), null)
  assertEquals(artDesWechsels('Objekte', { von: 'Notartermin', nach: 'Beurkundet' }), 'gewonnen')
  assertEquals(artDesWechsels('Objekte', { von: 'Besitzübergang', nach: 'Verkauft (Grundbuch umgeschrieben)' }), null)
  assertEquals(artDesWechsels('erben', { von: null, nach: 'Verloren / Kein Interesse' }), 'verloren')
  assertEquals(artDesWechsels('Objekte', { von: 'Nicht zustande gekommen / Abgebrochen', nach: 'Archiv' }), null)
})

Deno.test('baueRueckblick: Zahlen aus den Daten, ohne Kundennamen und ohne Privates', async () => {
  const d = await ladeRueckblickDaten(db(grunddaten()), FREITAG)
  const text = rueckblickText(baueRueckblick(d, FREITAG))
  assertStringIncludes(text, 'Wochenrückblick 14.11.–20.11.')
  assertStringIncludes(text, 'Neue Akten: 1 (Unternehmensberatung 1)')
  assertStringIncludes(text, 'Anfragen aus E-Mails erkannt: 2, davon 1 als Akte übernommen')
  assertStringIncludes(text, 'Neue Objekte: 1')
  assertStringIncludes(text, 'Stufenwechsel: 3 (Finanzierungen 1, Objekte 1, Unternehmensberatung 1)')
  assertStringIncludes(text, 'Gewonnen: 1 — Unternehmensberatung „Beratungsvertrag unterschrieben“')
  assertStringIncludes(text, 'Verloren/abgesagt: 1 — Finanzierungen „Verloren / Kein Interesse“')
  assertStringIncludes(text, 'Neu erstellt: 1 über 12.000 €')
  assertStringIncludes(text, 'Angenommen: 1 über 5.000 €')
  assertStringIncludes(text, 'Versendet: 1 über 1.190 €')
  assertStringIncludes(text, 'Zahlungen eingegangen: 2 über 1.300 €')
  assertStringIncludes(text, 'Überfällig offen: 1 über 4.000 €')
  assertStringIncludes(text, 'Online-Unterschriften eingegangen: 1')
  assertStringIncludes(text, 'Zustimmungen im Interessenten-Portal: 1')
  assertStringIncludes(text, 'Besichtigungen eingetragen: 2, davon 1 im Portal gebucht')
  assertStringIncludes(text, '2 Mails geprüft: 1 neuer Interessent mit Portal-Zugang, 1 unklar')
  assertStringIncludes(text, 'Hasan Süslü: 1 Wiedervorlage, 1 Aufgabe')
  assertStringIncludes(text, 'Kundentermine: 2, davon 1 Besichtigungen')
  // Achtung: Rechnung, offener KV (k2), Objekt im Notartermin ohne Wiedervorlage; k5 hat einen Termin
  assertStringIncludes(text, '1. Rechnung RE-2026-007 (Unternehmensberatung) über 4.000 € seit 36 Tagen überfällig')
  assertStringIncludes(text, '2. Offener Kostenvoranschlag über 12.000 € (Immobilien, Stand „In Verhandlung“, Quirin)')
  assertStringIncludes(text, '3. Objekt „MFH Ulm“ im Stand „Notartermin“ (Quirin Lutzenberger) ohne Wiedervorlage')
  for (const verboten of ['Geheime Firma', 'Kunde Zwei', 'Kunde Drei', 'Privatkontakt', 'Privates Haus', '77.777', '999']) assert(!text.includes(verboten), `${verboten} gehört nicht in den Rückblick`)
})

Deno.test('baueRueckblick: leere Woche ergibt eine kurze Zeile', async () => {
  const leer = grunddaten()
  for (const t of ['kunden', 'objekte', 'kostenvoranschlaege', 'rechnungen', 'vorgeschlagene_leads', 'unterschrift_anfragen', 'objekt_freigaben', 'besichtigungen', 'objekt_anfragen', 'todos', 'termine']) leer[t] = []
  const r = baueRueckblick(await ladeRueckblickDaten(db(leer), FREITAG), FREITAG)
  assert(r.leer)
  assertStringIncludes(rueckblickText(r), 'Eine ruhige Woche')
})

Deno.test('waehleAchtung: höchstens drei, verschiedene Gruppen zuerst, Rest zusammengefasst', () => {
  const a = waehleAchtung([
    { gruppe: 0, gewicht: 100, text: 'R klein' },
    { gruppe: 0, gewicht: 900, text: 'R groß' },
    { gruppe: 3, gewicht: 0, text: 'Akte A' },
    { gruppe: 3, gewicht: 0, text: 'Akte B' },
  ])
  assertEquals(a, ['R groß', 'R klein', 'Akte A (+ 1 weitere)'])
})

Deno.test('zusammenfassung: nur Zahlen aus dem Text, sonst verworfen', async () => {
  const text = 'Wochenrückblick\n• Neue Akten: 3\n• Versendet: 2 über 1.190 €'
  assertEquals(await zusammenfassung(text, () => Promise.resolve('Drei neue Akten. Zwei Rechnungen über 1.190 € gingen raus.')), 'Drei neue Akten. Zwei Rechnungen über 1.190 € gingen raus.')
  assertEquals(await zusammenfassung(text, () => Promise.resolve('Es kamen 7 neue Akten.')), null)
  assertEquals(await zusammenfassung(text, () => Promise.reject(new Error('aus'))), null)
})

function mitEinstellung(daten: Record<string, unknown>): Record<string, Zeile[]> {
  const t = grunddaten()
  t.abteilung_eintraege = [{ id: 'wochenrueckblick_einstellung', art: 'wochenrueckblick_einstellung', daten }]
  return t
}

function sammler() {
  const gesendet: { chat: number | string; text: string }[] = []
  return { gesendet, sende: (chat: number | string, text: string) => (gesendet.push({ chat, text }), Promise.resolve(true)) }
}

Deno.test('pruefeWochenrueckblick: nur im Fenster, nur an eingetragene Geschäftsführer, einmal je Woche', async () => {
  const d = db(mitEinstellung({ an: true, berichtAn: [ERAY, QUIRIN], wochentag: 5, stunde: 16, zusammenfassung: false }))
  const s = sammler()
  // Donnerstag und Freitag 15:59: nichts
  assertEquals((await pruefeWochenrueckblick(d, s.sende, {}, new Date('2026-11-19T15:05:00Z'))).gesendet, 0)
  assertEquals((await pruefeWochenrueckblick(d, s.sende, {}, new Date('2026-11-20T14:59:00Z'))).gesendet, 0)
  // Freitag 16:05: nur Eray (Quirin ist keine Geschäftsführung)
  assertEquals((await pruefeWochenrueckblick(d, s.sende, {}, FREITAG)).gesendet, 1)
  assertEquals(s.gesendet.map((g) => g.chat), [111])
  assertStringIncludes(s.gesendet[0].text, 'Wochenrückblick')
  // Eine Minute später: schon gesendet
  assertEquals((await pruefeWochenrueckblick(d, s.sende, {}, new Date('2026-11-20T15:06:00Z'))).gesendet, 0)
  const stand = d.tabelle('abteilung_eintraege').find((z: Zeile) => z.id === 'wochenrueckblick_stand')
  assertEquals((stand.daten as Record<string, unknown>).woche, '2026-W47')
  assertEquals((stand.daten as Record<string, unknown>).zustand, 'gesendet')
  // Nächste Woche wieder
  assertEquals((await pruefeWochenrueckblick(d, s.sende, {}, new Date('2026-11-27T15:05:00Z'))).gesendet, 1)
})

Deno.test('pruefeWochenrueckblick: ohne Einstellungszeile, ausgeschaltet oder ohne Empfänger geht nichts raus', async () => {
  const s = sammler()
  assertEquals((await pruefeWochenrueckblick(db(grunddaten()), s.sende, {}, FREITAG)).gesendet, 0)
  assertEquals((await pruefeWochenrueckblick(db(mitEinstellung({ an: false, berichtAn: [ERAY] })), s.sende, {}, FREITAG)).gesendet, 0)
  assertEquals((await pruefeWochenrueckblick(db(mitEinstellung({ an: true, berichtAn: [] })), s.sende, {}, FREITAG)).gesendet, 0)
  assertEquals(s.gesendet.length, 0)
})

Deno.test('pruefeWochenrueckblick: zwei Takte gleichzeitig senden nur einmal', async () => {
  const d = db(mitEinstellung({ an: true, berichtAn: [ERAY, HASAN], zusammenfassung: false }))
  const s = sammler()
  const [a, b] = await Promise.all([pruefeWochenrueckblick(d, s.sende, {}, FREITAG), pruefeWochenrueckblick(d, s.sende, {}, FREITAG)])
  assertEquals(a.gesendet + b.gesendet, 2)
  assertEquals(s.gesendet.map((g) => g.chat).sort(), [111, 222])
})

Deno.test('pruefeWochenrueckblick: Zusammenfassung steht oben, wenn eingeschaltet', async () => {
  const d = db(mitEinstellung({ an: true, berichtAn: [ERAY], zusammenfassung: true }))
  const s = sammler()
  await pruefeWochenrueckblick(d, s.sende, { ki: () => Promise.resolve('Eine Akte wurde gewonnen. Eine Rechnung ist überfällig.') }, FREITAG)
  assert(s.gesendet[0].text.startsWith('Wochenrückblick 14.11.–20.11.\n\nEine Akte wurde gewonnen. Eine Rechnung ist überfällig.\n'))
})

Deno.test('wochenrueckblickTest: nur Geschäftsführung; senden nur an den Aufrufer', async () => {
  const d = db(mitEinstellung({ an: true, berichtAn: [ERAY, HASAN] }))
  const s = sammler()
  assertEquals((await wochenrueckblickTest(d, null, {}, s.sende)).status, 401)
  assertEquals((await wochenrueckblickTest(d, { email: QUIRIN, name: 'Quirin Lutzenberger', istGf: false }, {}, s.sende)).status, 403)
  const ohne = await wochenrueckblickTest(d, { email: HASAN, name: 'Hasan Süslü', istGf: true }, { ohneZusammenfassung: true }, s.sende, { jetzt: FREITAG })
  assertEquals(ohne.status, 200)
  assertEquals(s.gesendet.length, 0)
  assertEquals((ohne.daten as { empfaenger: string[] }).empfaenger, ['Eray Yesil', 'Hasan Süslü'])
  const mit = await wochenrueckblickTest(d, { email: HASAN, name: 'Hasan Süslü', istGf: true }, { senden: true, ohneZusammenfassung: true }, s.sende, { jetzt: FREITAG })
  assertEquals((mit.daten as { gesendet: boolean }).gesendet, true)
  assertEquals(s.gesendet.map((g) => g.chat), [222])
  // Buchhaltung bleibt unberührt
  assert(!d.tabelle('abteilung_eintraege').some((z: Zeile) => z.id === 'wochenrueckblick_stand'))
})

Deno.test('wochenrueckblickEinstellung: lesen, speichern, nur Geschäftsführung als Empfänger', async () => {
  const d = db(grunddaten())
  const gf = { email: ERAY, name: 'Eray Yesil', istGf: true }
  assertEquals((await wochenrueckblickEinstellung(d, { email: QUIRIN, name: 'Quirin', istGf: false }, {})).status, 403)
  const leer = await wochenrueckblickEinstellung(d, gf, {})
  assertEquals((leer.daten as { einstellung: { berichtAn: string[] } }).einstellung.berichtAn, [])
  assertEquals((leer.daten as { moeglicheEmpfaenger: { email: string }[] }).moeglicheEmpfaenger.map((m) => m.email), [ERAY, HASAN])
  assertEquals((await wochenrueckblickEinstellung(d, gf, { speichern: { berichtAn: [QUIRIN] } })).status, 400)
  assertEquals((await wochenrueckblickEinstellung(d, gf, { speichern: { stunde: 3 } })).status, 400)
  const ok = await wochenrueckblickEinstellung(d, gf, { speichern: { berichtAn: ['Eray@Example.de'], wochentag: 1, stunde: 8 } })
  assertEquals(ok.status, 200)
  const e = (ok.daten as { einstellung: Record<string, unknown> }).einstellung
  assertEquals([e.berichtAn, e.wochentag, e.stunde, e.an, e.geaendertVon], [[ERAY], 1, 8, true, 'Eray Yesil'])
  // Nur genannte Felder ändern sich
  const aus = await wochenrueckblickEinstellung(d, gf, { speichern: { an: false } })
  const e2 = (aus.daten as { einstellung: Record<string, unknown> }).einstellung
  assertEquals([e2.an, e2.wochentag, e2.berichtAn], [false, 1, [ERAY]])
})

Deno.test('pruefeWochenrueckblick: nach einem Fehler erst nach zehn Minuten erneut, höchstens dreimal', async () => {
  const d = db(mitEinstellung({ an: true, berichtAn: [ERAY], zusammenfassung: false }))
  let kaputt = true
  const from = d.from
  d.from = (t: string) => {
    const q = from(t)
    if (t === 'rechnungen' && kaputt) q.range = () => Promise.resolve({ data: null, error: { message: 'weg' } })
    return q
  }
  const s = sammler()
  const um = (min: number) => new Date(FREITAG.getTime() + min * 60_000)
  assertEquals((await pruefeWochenrueckblick(d, s.sende, {}, um(0))).grund, 'fehler')
  const stand = () => d.tabelle('abteilung_eintraege').find((z: Zeile) => z.id === 'wochenrueckblick_stand').daten as Record<string, unknown>
  assertEquals([stand().zustand, stand().versuche], ['fehler', 1])
  assertEquals((await pruefeWochenrueckblick(d, s.sende, {}, um(5))).grund, 'schon beansprucht')
  kaputt = false
  assertEquals((await pruefeWochenrueckblick(d, s.sende, {}, um(11))).gesendet, 1)
  assertEquals([stand().zustand, stand().versuche], ['gesendet', 2])
})
