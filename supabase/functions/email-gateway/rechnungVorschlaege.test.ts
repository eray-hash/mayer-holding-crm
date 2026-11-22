// Rechnungsvorschläge im Minutentakt und Wochenhinweis mit der Testdatenbank (ohne Netz, ohne Telegram).
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { imWochenFenster, pruefeRechnungVorschlagHinweis, pruefeRechnungVorschlaege, siehtVorschlag } from './rechnungVorschlaege.ts'

// 23.11.2026 ist ein Montag; Berlin = UTC+1 im November.
const MONTAG_0930 = new Date('2026-11-23T08:30:00Z')
const MONTAG_0859 = new Date('2026-11-23T07:59:00Z')
const MONTAG_1200 = new Date('2026-11-23T11:00:00Z')
const DIENSTAG_1000 = new Date('2026-11-24T09:00:00Z')
const NAECHSTER_MONTAG = new Date('2026-11-30T09:00:00Z')
const TAKT = new Date('2026-11-22T10:05:00Z')

function daten() {
  return falscheDatenbank({
    kostenvoranschlaege: [
      { id: 'kv1', kunde_id: 'k_bera', bereich: 'beratung', privat_besitzer: null, name: 'Strategie', beschreibung: '', betrag: null, status: 'angenommen', positionen: [{ bezeichnung: 'Workshop', menge: 2, einheit: 'Tag', einzelpreis: 1500 }], aufschlag_prozent: 0, ust_satz: 19 },
      { id: 'kv2', kunde_id: 'k_bera', bereich: 'beratung', privat_besitzer: null, name: 'Schon berechnet', betrag: 100, status: 'angenommen', positionen: [], aufschlag_prozent: null, ust_satz: null },
      { id: 'kv3', kunde_id: null, bereich: null, privat_besitzer: 'hasan@mayer.de', name: 'Privat', betrag: 100, status: 'angenommen', positionen: [], aufschlag_prozent: null, ust_satz: null },
    ],
    kunden: [
      { id: 'k_bera', bereich: 'beratung', firma: 'Bäckerei Brot', ansprechpartner: 'Herr Brot', status: 'umsetzung', dienstleistungen: [], auftrag_chance: null },
      { id: 'k_fertig', bereich: 'erben', firma: '', ansprechpartner: 'Familie Erbe', status: 'abgeschlossen', dienstleistungen: ['Reguläres Beratungshonorar (Basis)'], auftrag_chance: null },
      { id: 'k_invest', bereich: 'finanzierungen', firma: '', ansprechpartner: 'Investor', status: 'abgeschlossen', dienstleistungen: [], auftrag_chance: null },
      { id: 'k_semi', bereich: 'akademie', firma: 'Muster GmbH', ansprechpartner: 'Erika Muster', status: 'interessent', dienstleistungen: [], auftrag_chance: null },
      { id: 'k_kaeufer', bereich: 'immobilienkunden', firma: '', ansprechpartner: 'Käufer Klaus', status: 'abgeschlossen', dienstleistungen: [], auftrag_chance: null },
    ],
    rechnungen: [{ id: 'r_kv2', kunde_id: 'k_bera', kv_id: 'kv2' }],
    seminar_anmeldungen: [
      { id: '11111111-1111-1111-1111-111111111111', termin_id: 't1', kunde_id: 'k_semi', name: 'Erika Muster', firma: 'Muster GmbH', status: 'teilgenommen', rechnung_id: null },
      { id: '22222222-2222-2222-2222-222222222222', termin_id: 't1', kunde_id: null, name: 'Gast', firma: '', status: 'angemeldet', rechnung_id: null },
    ],
    seminar_termine: [{ id: 't1', seminar_id: 'sem_rhet', beginn: '2026-11-03T08:00:00Z', preis: null }],
    seminare: [{ id: 'sem_rhet', titel: 'Rhetorik', preis_netto: 490 }],
    objekte: [
      { id: 'o_lorch', bezeichnung: 'MFH Lorch', adresse: '', kaufpreis: 1_000_000, status: 'beurkundet', verkaufsdaten: null, kurzpruefung: null, privat_besitzer: null, zugewiesener_kunde: null },
      { id: 'o_ohne', bezeichnung: 'Ohne Provision', adresse: '', kaufpreis: 400_000, status: 'beurkundet', verkaufsdaten: null, kurzpruefung: null, privat_besitzer: null, zugewiesener_kunde: null },
    ],
    objekt_freigaben: [{ objekt_id: 'o_lorch', provision: '3,57 % inkl. MwSt.', status: 'zugestimmt', erstellt_am: '2026-10-01', kunde_id: 'k_kaeufer', kunde_bereich: 'immobilienkunden' }],
    abteilung_eintraege: [],
    leistungen_preisliste: [{ id: 'l1', bezeichnung: 'Reguläres Beratungshonorar (Basis)', preis_stunde_von: 700, preis_tag_von: null }],
    rechnung_vorschlaege: [],
    mitarbeiter: [
      { id: 'm1', email: 'andreas@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: true, aktiv: true, bereiche: [], telegram_chat_id: 111 },
      { id: 'm2', email: 'quirin@mayer.de', rolle: 'mitarbeiter', ist_admin: false, aktiv: true, bereiche: ['immobilien', 'beratung'], telegram_chat_id: 222 },
      { id: 'm3', email: 'markus@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: false, aktiv: true, bereiche: [], telegram_chat_id: 333 },
      { id: 'm4', email: 'petra@mayer.de', rolle: 'mitarbeiter', ist_admin: false, aktiv: true, bereiche: ['beratung'], telegram_chat_id: 444 },
    ],
    rechnung_vorschlag_hinweis: [
      { email: 'markus@mayer.de', aktiv: false, letzte_woche: null },
      { email: 'petra@mayer.de', aktiv: true, letzte_woche: null },
    ],
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.example/' }],
  })
}

const ids = (db: ReturnType<typeof daten>) => db.tabelle('rechnung_vorschlaege').map((z) => `${z.id}:${z.status}`).sort()

Deno.test('Takt läuft nur alle fünf Minuten', async () => {
  const db = daten()
  const r = await pruefeRechnungVorschlaege(db, new Date('2026-11-22T10:03:00Z'))
  assertEquals(r.gelaufen, false)
  assertEquals(db.protokoll.length, 0)
})

Deno.test('legt Vorschläge an und ist beim zweiten Lauf idempotent', async () => {
  const db = daten()
  const r = await pruefeRechnungVorschlaege(db, TAKT)
  assertEquals(r.fehler, [])
  assertEquals(r.neu, 4)
  assertEquals(ids(db), ['akte:k_fertig:offen', 'kv:kv1:offen', 'provision:o_lorch:offen', 'seminar:11111111-1111-1111-1111-111111111111:offen'])
  const kv = db.tabelle('rechnung_vorschlaege').find((z) => z.id === 'kv:kv1')!
  assertEquals(kv.betrag_netto, 3000)
  assertEquals(kv.kunde_bereich, 'beratung')
  const semi = db.tabelle('rechnung_vorschlaege').find((z) => z.art === 'seminar')!
  assertEquals(semi.betrag_netto, 490)
  const prov = db.tabelle('rechnung_vorschlaege').find((z) => z.art === 'provision')!
  assertEquals(prov.betrag_netto, 30000)
  assertEquals(prov.kunde_id, 'k_kaeufer')
  const akte = db.tabelle('rechnung_vorschlaege').find((z) => z.art === 'akte')!
  assertEquals(akte.betrag_netto, 700)

  const zweiter = await pruefeRechnungVorschlaege(db, TAKT)
  assertEquals([zweiter.neu, zweiter.geaendert, zweiter.erledigt, zweiter.entfernt], [0, 0, 0, 0])
  assertEquals(db.tabelle('rechnung_vorschlaege').length, 4)
})

Deno.test('Rechnung erkannt → erstellt; Anlass weg → gelöscht; verworfen kommt nie wieder; Betrag angepasst', async () => {
  const db = daten()
  await pruefeRechnungVorschlaege(db, TAKT)
  // Rechnung aus kv1 im CRM angelegt, Akte k_fertig wieder geöffnet, Seminar-Vorschlag verworfen, Positionen geändert.
  db.tabelle('rechnungen').push({ id: 'r_neu', kunde_id: 'k_bera', kv_id: 'kv1' })
  db.tabelle('kunden').find((k) => k.id === 'k_fertig')!.status = 'umsetzung'
  db.tabelle('rechnung_vorschlaege').find((z) => z.art === 'seminar')!.status = 'verworfen'
  db.tabelle('objekt_freigaben')[0].provision = '5,95 % inkl. MwSt.'
  const r = await pruefeRechnungVorschlaege(db, TAKT)
  assertEquals(r.fehler, [])
  assertEquals([r.neu, r.geaendert, r.erledigt, r.entfernt], [0, 1, 1, 1])
  assertEquals(ids(db), ['kv:kv1:erstellt', 'provision:o_lorch:offen', 'seminar:11111111-1111-1111-1111-111111111111:verworfen'])
  assertEquals(db.tabelle('rechnung_vorschlaege').find((z) => z.id === 'kv:kv1')!.rechnung_id, 'r_neu')
  assertEquals(db.tabelle('rechnung_vorschlaege').find((z) => z.art === 'provision')!.betrag_netto, 50000)
})

Deno.test('im CRM erstellte Seminar-Rechnung wird an der Anmeldung nachgetragen, sobald es sie gibt', async () => {
  const db = daten()
  await pruefeRechnungVorschlaege(db, TAKT)
  const semi = db.tabelle('rechnung_vorschlaege').find((z) => z.art === 'seminar')!
  semi.status = 'erstellt'
  semi.rechnung_id = 'r_semi'
  let r = await pruefeRechnungVorschlaege(db, TAKT)
  assertEquals(r.verknuepft, 0) // Rechnung noch nicht gespeichert
  db.tabelle('rechnungen').push({ id: 'r_semi', kunde_id: 'k_semi', kv_id: null })
  r = await pruefeRechnungVorschlaege(db, TAKT)
  assertEquals(r.verknuepft, 1)
  assertEquals(db.tabelle('seminar_anmeldungen')[0].rechnung_id, 'r_semi')
})

Deno.test('Wochenfenster: montags 9 bis 11:59 Uhr', () => {
  assert(imWochenFenster(MONTAG_0930))
  assert(!imWochenFenster(MONTAG_0859))
  assert(!imWochenFenster(MONTAG_1200))
  assert(!imWochenFenster(DIENSTAG_1000))
})

Deno.test('Wochenhinweis: GF ohne Zeile an, abgeschaltete GF nicht, Mitarbeiter nur mit Zeile, höchstens einmal pro Woche', async () => {
  const db = daten()
  await pruefeRechnungVorschlaege(db, TAKT)
  const gesendet: { chat: number | string; text: string }[] = []
  const sende = (chat: number | string, text: string) => (gesendet.push({ chat, text }), Promise.resolve(true))

  const aussen = await pruefeRechnungVorschlagHinweis(db, sende, DIENSTAG_1000)
  assertEquals(aussen.gelaufen, false)

  const r = await pruefeRechnungVorschlagHinweis(db, sende, MONTAG_0930)
  assertEquals(r.gesendet, 2)
  assertEquals(gesendet.map((g) => g.chat).sort(), [111, 444])
  const andreas = gesendet.find((g) => g.chat === 111)!.text
  assertStringIncludes(andreas, '4 Rechnungen sind fällig zu stellen')
  assertStringIncludes(andreas, 'https://crm.example/#/beratung/rechnungen')
  // Petra (nur Beratung): keine Provision, kein Seminar der Akademie, keine Erben-Akte → nur der Kostenvoranschlag.
  const petra = gesendet.find((g) => g.chat === 444)!.text
  assertStringIncludes(petra, '1 Rechnung ist fällig zu stellen')
  assert(!petra.includes('Provision'))

  const nochmal = await pruefeRechnungVorschlagHinweis(db, sende, new Date('2026-11-23T10:30:00Z'))
  assertEquals(nochmal.gesendet, 0)
  const naechste = await pruefeRechnungVorschlagHinweis(db, sende, NAECHSTER_MONTAG)
  assertEquals(naechste.gesendet, 2)
})

Deno.test('Wochenhinweis: ohne offene Vorschläge keine Nachricht', async () => {
  const db = daten()
  const gesendet: unknown[] = []
  const r = await pruefeRechnungVorschlagHinweis(db, (c, t) => (gesendet.push([c, t]), Promise.resolve(true)), MONTAG_0930)
  assertEquals(r.gesendet, 0)
  assertEquals(gesendet.length, 0)
})

Deno.test('Sichtbarkeit wie die Zeilenregel', () => {
  const nurBeratung = { alles: false, bereiche: ['beratung'] }
  assert(siehtVorschlag(nurBeratung, { art: 'kv', kunde_bereich: 'beratung' }))
  assert(siehtVorschlag(nurBeratung, { art: 'kv', kunde_bereich: null }))
  assert(!siehtVorschlag(nurBeratung, { art: 'akte', kunde_bereich: 'erben' }))
  assert(!siehtVorschlag(nurBeratung, { art: 'provision', kunde_bereich: null }))
  assert(!siehtVorschlag({ alles: false, bereiche: ['immobilien'] }, { art: 'provision', kunde_bereich: 'immobilienkunden' }))
  assert(siehtVorschlag({ alles: false, bereiche: ['immobilien', 'beratung'] }, { art: 'provision', kunde_bereich: 'immobilienkunden' }))
})
