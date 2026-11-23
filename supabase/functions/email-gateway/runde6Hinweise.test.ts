// Prüft die neuen automatischen Nachfragen aus Runde 6 mit der Testdatenbank (ohne Netz, ohne Telegram):
// Kontakt-Nachfrage (werktags 10:30–12, höchstens 3 Akten, je Akte alle 30 Tage) und Wochenhinweis Kurzprüfung
// (montags 9–11). Beide: Schalter aus = nichts, superuser = Probelauf nur an Eray, alle = an die Verantwortlichen;
// je Person abschaltbar; höchstens einmal am Tag bzw. in der Woche.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { frageNachKontakten, imNachfrageFenster } from './kontaktNachfrage.ts'
import { imKurzpruefungFenster, kurzpruefungHinweisText, pruefeKurzpruefungHinweis } from './kurzpruefungHinweis.ts'

// 23.11.2026 ist ein Montag; Berlin = UTC+1 im November.
const MONTAG_1035 = new Date('2026-11-23T09:35:00Z')
const MONTAG_1025 = new Date('2026-11-23T09:25:00Z')
const MONTAG_0905 = new Date('2026-11-23T08:05:00Z')
const DIENSTAG_1040 = new Date('2026-11-24T09:40:00Z')
const SAMSTAG_1040 = new Date('2026-11-28T09:40:00Z')

const TEAM = [
  { id: 'm_q', name: 'Quirin Lutzenberger', email: 'q@x.de', rolle: 'mitarbeiter', ist_admin: false, ist_superuser: false, aktiv: true, bereiche: ['immobilien', 'finanzierungen'], telegram_chat_id: 111 },
  { id: 'm_h', name: 'Hasan Süslü', email: 'h@x.de', rolle: 'mitarbeiter', ist_admin: false, ist_superuser: false, aktiv: true, bereiche: ['beratung'], telegram_chat_id: 222 },
  { id: 'm_e', name: 'Eray Yesil', email: 'e@x.de', rolle: 'mitarbeiter', ist_admin: true, ist_superuser: true, aktiv: true, bereiche: [], telegram_chat_id: 333 },
]

function welt(modus: { kontakt?: string; kurz?: string } = {}, extra: Record<string, Record<string, unknown>[]> = {}) {
  return falscheDatenbank({
    mitarbeiter: TEAM,
    assistent_hinweis_einstellung: [{ id: 1, kontakt_nachfrage: modus.kontakt ?? 'aus', kurzpruefung_hinweis: modus.kurz ?? 'aus' }],
    assistent_hinweise: [],
    kontakt_nachfragen: [],
    kunden: [
      { id: 'k1', bereich: 'finanzierungen', firma: 'Anna Alt', email: '', telefon: '', status: 'interessent', verantwortlich: 'Quirin Lutzenberger' },
      { id: 'k2', bereich: 'finanzierungen', firma: 'Bert Bunt', email: '', telefon: '', status: 'interessent', verantwortlich: 'Quirin' },
      { id: 'k3', bereich: 'finanzierungen', firma: 'Cora Cyan', email: null, telefon: null, status: 'interessent', verantwortlich: 'Quirin Lutzenberger' },
      { id: 'k4', bereich: 'finanzierungen', firma: 'Dirk Dunkel', email: '', telefon: '', status: 'interessent', verantwortlich: 'Quirin Lutzenberger' },
      { id: 'k5', bereich: 'beratung', firma: 'Eva Eck', email: '', telefon: '', status: 'lead', verantwortlich: 'Hasan Süslü' },
      { id: 'k6', bereich: 'beratung', firma: 'Fritz Fern', email: 'f@f.de', telefon: '', status: 'lead', verantwortlich: 'Hasan Süslü' },
      { id: 'k7', bereich: 'beratung', firma: 'Gerd Gut', email: '', telefon: '', status: 'lead', verantwortlich: 'Quirin Lutzenberger' },
    ],
    objekte: [
      { id: 'o1', bezeichnung: 'Geislingen', status: 'akquise', verantwortlich: 'Quirin Lutzenberger', privat_besitzer: null, kurzpruefung: null },
      { id: 'o2', bezeichnung: 'Aalen', status: 'akquise', verantwortlich: 'Quirin Lutzenberger', privat_besitzer: null, kurzpruefung: { zeilen: { baujahr: { ist: '1970', marktwert: '', ergebnis: '' } } } },
      { id: 'o3', bezeichnung: 'Lorch', status: 'vermarktung', verantwortlich: 'Quirin Lutzenberger', privat_besitzer: null, kurzpruefung: null },
      { id: 'o4', bezeichnung: 'Privat Hasan', status: 'akquise', verantwortlich: 'Quirin', privat_besitzer: 'h@x.de', kurzpruefung: null },
    ],
    ...extra,
  })
}

function frager() {
  const fragen: { id: string; text: string; von: string }[] = []
  return { fragen, frage: (id: string, text: string, von: string) => (fragen.push({ id, text, von }), Promise.resolve(true)) }
}

Deno.test('Kontakt-Nachfrage: Fenster werktags 10:30–11:59', () => {
  assert(imNachfrageFenster(MONTAG_1035))
  assert(!imNachfrageFenster(MONTAG_1025))
  assert(!imNachfrageFenster(SAMSTAG_1040))
  assert(imKurzpruefungFenster(MONTAG_0905))
  assert(!imKurzpruefungFenster(DIENSTAG_1040))
})

Deno.test('Kontakt-Nachfrage: Schalter aus → nichts; außerhalb des Fensters kein Datenbankzugriff', async () => {
  const db = welt()
  const f = frager()
  assertEquals((await frageNachKontakten(db, { frage: f.frage, jetzt: MONTAG_1035 })).gefragt, 0)
  assertEquals(f.fragen.length, 0)
  const db2 = welt({ kontakt: 'alle' })
  await frageNachKontakten(db2, { frage: f.frage, jetzt: SAMSTAG_1040 })
  assertEquals(db2.protokoll.length, 0)
})

Deno.test('Kontakt-Nachfrage alle: je Verantwortlichem höchstens 3 Akten, nur eigener Bereich, einmal am Tag, 30 Tage Pause je Akte', async () => {
  const db = welt({ kontakt: 'alle' })
  const f = frager()
  const r = await frageNachKontakten(db, { frage: f.frage, jetzt: MONTAG_1035 })
  assertEquals(r.fehler, [])
  assertEquals(r.gefragt, 2)
  const quirin = f.fragen.find((x) => x.id === 'm_q')!
  assertEquals((quirin.text.match(/^• /gm) ?? []).length, 3)
  assert(!quirin.text.includes('Gerd Gut'), 'Akte aus fremdem Bereich (Beratung) an Quirin')
  assertStringIncludes(quirin.von, 'Kontakt-Nachfrage k1 k2 k3')
  const hasan = f.fragen.find((x) => x.id === 'm_h')!
  assertStringIncludes(hasan.text, 'Zu Akte Eva Eck (Unternehmensberatung) fehlen Telefon und E-Mail – weißt du sie?')
  assert(!hasan.text.includes('Fritz'), 'Akte mit E-Mail gefragt')
  assert(!f.fragen.some((x) => x.id === 'm_e'), 'Eray hat keine Akten')
  assertEquals(db.tabelle('kontakt_nachfragen').length, 4)
  // Zweiter Takt am selben Tag: nichts.
  assertEquals((await frageNachKontakten(db, { frage: f.frage, jetzt: new Date('2026-11-23T10:30:00Z') })).gefragt, 0)
  // Nächster Tag: nur die noch nicht gefragte Akte k4.
  const g = frager()
  await frageNachKontakten(db, { frage: g.frage, jetzt: DIENSTAG_1040 })
  assertEquals(g.fragen.length, 1)
  assertStringIncludes(g.fragen[0].text, 'Dirk Dunkel')
})

Deno.test('Kontakt-Nachfrage Probelauf: nur Superuser, Akten reihum mit „ginge an“, zählt im echten Betrieb nicht', async () => {
  const db = welt({ kontakt: 'superuser' })
  const f = frager()
  await frageNachKontakten(db, { frage: f.frage, jetzt: MONTAG_1035 })
  assertEquals(f.fragen.map((x) => x.id), ['m_e'])
  assertStringIncludes(f.fragen[0].text, 'Probelauf')
  assertStringIncludes(f.fragen[0].text, 'ginge an Hasan Süslü')
  assertStringIncludes(f.fragen[0].text, 'ginge an Quirin Lutzenberger')
  assert(db.tabelle('kontakt_nachfragen').every((z) => z.probe === true))
  // Umschalten auf „alle“ am nächsten Tag: Probelauf-Akten werden trotzdem gefragt.
  db.tabelle('assistent_hinweis_einstellung')[0].kontakt_nachfrage = 'alle'
  const g = frager()
  await frageNachKontakten(db, { frage: g.frage, jetzt: DIENSTAG_1040 })
  assertStringIncludes(g.fragen.find((x) => x.id === 'm_h')!.text, 'Eva Eck')
})

Deno.test('Kontakt-Nachfrage: wer abgeschaltet hat, bekommt nichts; Schalter-Tabelle fehlt → nichts', async () => {
  const db = welt({ kontakt: 'alle' }, { assistent_hinweise: [{ email: 'q@x.de', kontakt_nachfrage: false, kurzpruefung_hinweis: true }] })
  const f = frager()
  await frageNachKontakten(db, { frage: f.frage, jetzt: MONTAG_1035 })
  assertEquals(f.fragen.map((x) => x.id), ['m_h'])
  const ohne = welt({ kontakt: 'alle' })
  ohne.tabellen.assistent_hinweis_einstellung = []
  const g = frager()
  await frageNachKontakten(ohne, { frage: g.frage, jetzt: MONTAG_1035 })
  assertEquals(g.fragen.length, 0)
})

Deno.test('Kurzprüfung-Hinweis alle: nur Akquise ohne begonnene Prüfung, private nur an Besitzer, einmal pro Woche', async () => {
  const db = welt({ kurz: 'alle' })
  const f = frager()
  const r = await pruefeKurzpruefungHinweis(db, { frage: f.frage, jetzt: MONTAG_0905 })
  assertEquals(r.fehler, [])
  const quirin = f.fragen.find((x) => x.id === 'm_q')!
  assertStringIncludes(quirin.text, '• Geislingen')
  assert(!quirin.text.includes('Aalen') && !quirin.text.includes('Lorch') && !quirin.text.includes('Privat Hasan'))
  assertEquals(quirin.von, 'Wochenhinweis Kurzprüfung')
  // Hasan hat keine Immobilien-Rechte, bekommt aber sein privates Objekt.
  assertStringIncludes(f.fragen.find((x) => x.id === 'm_h')!.text, 'Privat Hasan')
  const g = frager()
  await pruefeKurzpruefungHinweis(db, { frage: g.frage, jetzt: new Date('2026-11-23T09:30:00Z') })
  assertEquals(g.fragen.length, 0)
})

Deno.test('Kurzprüfung-Hinweis Probelauf: eine Nachricht an Eray, ohne private Objekte der Kollegen', async () => {
  const db = welt({ kurz: 'superuser' })
  const f = frager()
  await pruefeKurzpruefungHinweis(db, { frage: f.frage, jetzt: MONTAG_0905 })
  assertEquals(f.fragen.map((x) => x.id), ['m_e'])
  assertStringIncludes(f.fragen[0].text, 'ginge an Quirin Lutzenberger')
  assert(!f.fragen[0].text.includes('Privat Hasan'))
})

Deno.test('Kurzprüfung-Hinweistext: höchstens 8 Objekte, Rest gezählt, kein Englisch', () => {
  const t = kurzpruefungHinweisText(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])
  assertStringIncludes(t, 'bei 10 deiner Objekte in der Akquise')
  assertStringIncludes(t, '… und 2 weitere.')
  assertStringIncludes(t, '„Kurzprüfung für A“')
  assert(!t.includes('\n\n\n'))
})
