// Mahnvorschläge im Tageslauf mit der Testdatenbank (ohne Netz, ohne Telegram).
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { einstellungAus, naechsteStufe, planeMahnVorschlaege, pruefeRechnung, STANDARD_EINSTELLUNG, type MahnRechnung } from '../_shared/mahnVorschlagKern.ts'
import { empfaengerFuer, pruefeMahnVorschlaege, vergiss } from './mahnVorschlag.ts'

// 23.11.2026, Berlin = UTC+1 im November.
const MO_0930 = new Date('2026-11-23T08:30:00Z')
const MO_0855 = new Date('2026-11-23T07:55:00Z')
const MO_1000 = new Date('2026-11-23T09:00:00Z')
const DI_0930 = new Date('2026-11-24T08:30:00Z')
const HEUTE = '2026-11-23'

function rechnung(id: string, ziel: string, mehr: Partial<MahnRechnung> = {}): MahnRechnung {
  return { id, nummer: `RE-2026-${id}`, kunde_id: 'k_brot', datum: '2026-10-01', status: 'Versendet', zahlungsziel: ziel, mahnstufe: null, betrag_brutto: 1190, zahlungen: [], mahnungen: [], ...mehr }
}

function daten(extra: Record<string, unknown[]> = {}) {
  return falscheDatenbank({
    mahn_einstellung: [{ id: 1, aktiv: true, tage_erinnerung: 3, tage_mahnung1: 14, tage_mahnung2: 28, ruhe_tage_zahlung: 3, letzter_lauf: null }],
    rechnungen: [
      rechnung('001', '2026-11-18'), // 5 Tage → Zahlungserinnerung
      rechnung('002', '2026-11-03', { kunde_id: 'k_ohne', mahnstufe: 'erinnerung', mahnungen: [{ datum: '2026-11-08', stufe: 'erinnerung', neueFrist: '2026-11-20' }] }), // 20 Tage, Frist vorbei → 1. Mahnung
      rechnung('003', '2026-11-21'), // 2 Tage → noch warten
      rechnung('004', '2026-11-10', { zahlungen: [{ datum: '2026-11-21', betrag: 500 }] }), // Teilzahlung vor 2 Tagen → übersprungen
      rechnung('005', '2026-11-01', { status: 'Bezahlt' }),
      rechnung('006', '2026-11-05', { mahnstufe: 'erinnerung', mahnungen: [{ datum: '2026-11-20', stufe: 'erinnerung', neueFrist: '2026-11-27' }] }), // neue Frist läuft
      rechnung('007', '2026-11-12', { kunde_id: 'k_kontoauszug', betrag_brutto: 2380 }), // Kontoauszug-Treffer offen
      rechnung('008', '2026-10-01', { mahnstufe: 'mahnung2', mahnungen: [{ datum: '2026-11-01', stufe: 'mahnung2', neueFrist: '2026-11-10' }] }), // nach 2. Mahnung nichts mehr
      rechnung('009', '2026-11-15', { status: 'Entwurf' }),
    ],
    kunden: [
      { id: 'k_brot', bereich: 'beratung', firma: 'Bäckerei Brot', ansprechpartner: 'Herr Brot', verantwortlich_email: 'petra@mayer.de' },
      { id: 'k_ohne', bereich: 'erben', firma: '', ansprechpartner: 'Familie Erbe', verantwortlich_email: null },
      { id: 'k_kontoauszug', bereich: 'beratung', firma: 'Zahler GmbH', ansprechpartner: '', verantwortlich_email: 'petra@mayer.de' },
    ],
    mahn_vorschlaege: [],
    mahn_vorschlag_hinweis: [{ email: 'markus@mayer.de', aktiv: false }],
    mitarbeiter: [
      { email: 'andreas@mayer.de', name: 'Andreas', rolle: 'geschaeftsfuehrung', ist_admin: true, aktiv: true, bereiche: [], telegram_chat_id: 111 },
      { email: 'markus@mayer.de', name: 'Markus', rolle: 'geschaeftsfuehrung', ist_admin: false, aktiv: true, bereiche: [], telegram_chat_id: 333 },
      { email: 'petra@mayer.de', name: 'Petra', rolle: 'mitarbeiter', ist_admin: false, aktiv: true, bereiche: ['beratung'], telegram_chat_id: 444 },
    ],
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.example/' }],
    ...extra,
  })
}

// Kontoauszug des Assistenten mit einer Buchung über den vollen Betrag und der Rechnungsnummer von 007.
const auszug = async () => [[{ id: 'b1', datum: '2026-11-22', betrag: 2380, verwendungszweck: 'RE-2026-007 Danke', gegenName: 'Zahler GmbH' }]]
const keinAuszug = async () => []

function sammler() {
  const gesendet: { chat: number | string; text: string }[] = []
  return { gesendet, sende: async (chat: number | string, text: string) => (gesendet.push({ chat, text }), true) }
}

const status = (db: ReturnType<typeof daten>) => db.tabelle('mahn_vorschlaege').map((z) => `${z.id}:${z.status}`).sort()

Deno.test('Regeln: Stufenfolge, Einstellung, Fälligkeit', () => {
  assertEquals(naechsteStufe(null), 'erinnerung')
  assertEquals(naechsteStufe('erinnerung'), 'mahnung1')
  assertEquals(naechsteStufe('mahnung2'), null)
  assertEquals(naechsteStufe('inkasso'), null)
  assertEquals(einstellungAus({ tage_erinnerung: 5, tage_mahnung1: 2, tage_mahnung2: 'x' }).tage, { erinnerung: 5, mahnung1: 5, mahnung2: 28 })
  assertEquals(pruefeRechnung(rechnung('a', '2026-11-20'), HEUTE, STANDARD_EINSTELLUNG).ergebnis, 'faellig')
  assertEquals(pruefeRechnung(rechnung('a', '2026-11-21'), HEUTE, STANDARD_EINSTELLUNG), { ergebnis: 'warten', stufe: 'erinnerung', tage: 2, ab: '2026-11-24' })
  // Zahlung vor genau 3 Tagen zählt noch, vor 4 Tagen nicht mehr.
  assertEquals(pruefeRechnung(rechnung('a', '2026-11-01', { zahlungen: [{ datum: '2026-11-20', betrag: 1 }] }), HEUTE, STANDARD_EINSTELLUNG).ergebnis, 'uebersprungen')
  assertEquals(pruefeRechnung(rechnung('a', '2026-11-01', { zahlungen: [{ datum: '2026-11-19', betrag: 1 }] }), HEUTE, STANDARD_EINSTELLUNG).ergebnis, 'faellig')
  // Voll bezahlt über Teilzahlungen → nichts.
  assertEquals(pruefeRechnung(rechnung('a', '2026-11-01', { zahlungen: [{ datum: '2026-11-02', betrag: 1190 }] }), HEUTE, STANDARD_EINSTELLUNG).ergebnis, 'nichts')
})

Deno.test('vor 9 Uhr und außerhalb jeder fünften Minute ohne Datenbankzugriff', async () => {
  vergiss()
  const db = daten()
  const s = sammler()
  assertEquals((await pruefeMahnVorschlaege(db, s.sende, MO_0855)).gelaufen, false)
  assertEquals((await pruefeMahnVorschlaege(db, s.sende, new Date('2026-11-23T08:31:00Z'))).gelaufen, false)
  assertEquals(db.protokoll.length, 0)
})

Deno.test('legt Vorschläge an, überspringt Zahlung und Kontoauszug, benachrichtigt je Empfänger einmal', async () => {
  vergiss()
  const db = daten()
  const s = sammler()
  const r = await pruefeMahnVorschlaege(db, s.sende, MO_0930, { ladeAuszuege: auszug })
  assertEquals(r.fehler, [])
  assert(r.gelaufen)
  assertEquals(r.neu, 2)
  assertEquals(r.uebersprungen, 2)
  assertEquals(status(db), ['002:mahnung1:offen', '001:erinnerung:offen'].sort())
  const v1 = db.tabelle('mahn_vorschlaege').find((z) => z.id === '001:erinnerung')!
  assertEquals(v1.tage_ueberfaellig, 5)
  assertEquals(v1.offen, 1190)
  assertEquals(v1.kunde_bereich, 'beratung')
  assertEquals(v1.empfaenger, 'petra@mayer.de')
  // Petra (verantwortlich) bekommt 001; Andreas (Geschäftsführung) 002, weil die Akte keinen Verantwortlichen hat; Markus hat abgeschaltet.
  assertEquals(s.gesendet.map((g) => g.chat).sort(), [111, 444])
  const petra = s.gesendet.find((g) => g.chat === 444)!.text
  assertStringIncludes(petra, 'Rechnung RE-2026-001 (Bäckerei Brot (Herr Brot)) ist 5 Tage überfällig — Zahlungserinnerung vorbereitet, bitte prüfen und senden')
  assertStringIncludes(petra, 'https://crm.example/#/beratung/mahnwesen?vorschlag=001%3Aerinnerung')
  const andreas = s.gesendet.find((g) => g.chat === 111)!.text
  assertStringIncludes(andreas, 'RE-2026-002 (Familie Erbe) ist 20 Tage überfällig — 1. Mahnung vorbereitet')

  // Zweiter Takt am selben Tag: läuft nicht (auch nicht mit frischem Arbeiter — der Tag ist beansprucht).
  vergiss()
  const r2 = await pruefeMahnVorschlaege(db, s.sende, MO_1000, { ladeAuszuege: auszug })
  assertEquals(r2.gelaufen, false)
  assertEquals(s.gesendet.length, 2)
})

Deno.test('nächster Tag: keine Doppelten; Bezahltes und Gesendetes werden abgehakt', async () => {
  vergiss()
  const db = daten()
  const s = sammler()
  await pruefeMahnVorschlaege(db, s.sende, MO_0930, { ladeAuszuege: keinAuszug })
  // ohne offenen Kontoauszug kommt 007 gleich mit dazu
  assertEquals(status(db), ['001:erinnerung:offen', '002:mahnung1:offen', '007:erinnerung:offen'])
  // 001 ist bezahlt, für 002 wurde die 1. Mahnung im CRM erstellt.
  const re = db.tabelle('rechnungen')
  Object.assign(re.find((z) => z.id === '001')!, { status: 'Bezahlt' })
  Object.assign(re.find((z) => z.id === '002')!, { mahnstufe: 'mahnung1', status: 'Überfällig', mahnungen: [{ datum: '2026-11-23', stufe: 'mahnung1', neueFrist: '2026-12-07' }] })
  const vorher = s.gesendet.length
  const r = await pruefeMahnVorschlaege(db, s.sende, DI_0930, { ladeAuszuege: keinAuszug })
  assertEquals(r.fehler, [])
  // Neu ist nur 003 (jetzt 3 Tage überfällig); 001, 002 und 007 kommen nicht noch einmal.
  assertEquals(r.neu, 1)
  assertEquals(r.erledigt, 1)
  assertEquals(r.gesendet, 1)
  assertEquals(status(db), ['001:erinnerung:erledigt', '002:mahnung1:gesendet', '003:erinnerung:offen', '007:erinnerung:offen'])
  assertEquals(s.gesendet.length, vorher + 1)
  assertStringIncludes(s.gesendet[vorher].text, 'Rechnung RE-2026-003')
})

Deno.test('zurückgestellt: bis zum Datum ruhig, danach wieder offen mit einer Nachricht', async () => {
  vergiss()
  const db = daten({
    mahn_vorschlaege: [
      { id: '001:erinnerung', rechnung_id: '001', stufe: 'erinnerung', kunde_id: 'k_brot', kunde_bereich: 'beratung', status: 'zurueckgestellt', zurueckgestellt_bis: '2026-11-23', notiz: 'Ratenzahlung' },
    ],
  })
  const s = sammler()
  const r = await pruefeMahnVorschlaege(db, s.sende, MO_0930, { ladeAuszuege: auszug })
  assertEquals(r.wieder, 0)
  assert(!s.gesendet.some((g) => g.text.includes('RE-2026-001')))
  assertEquals(db.tabelle('mahn_vorschlaege').find((z) => z.id === '001:erinnerung')!.status, 'zurueckgestellt')

  const r2 = await pruefeMahnVorschlaege(db, s.sende, DI_0930, { ladeAuszuege: auszug })
  assertEquals(r2.fehler, [])
  assertEquals(r2.wieder, 1)
  assertEquals(db.tabelle('mahn_vorschlaege').find((z) => z.id === '001:erinnerung')!.status, 'offen')
  const petra = s.gesendet.filter((g) => g.chat === 444).map((g) => g.text).join('\n')
  // Am Dienstag zusammen mit 003 (jetzt fällig) in einer Nachricht.
  assertStringIncludes(petra, 'RE-2026-001 (Bäckerei Brot (Herr Brot)): 6 Tage überfällig — Zahlungserinnerung, offen 1.190,00 € (Zurückstellung abgelaufen)')
  assertEquals(s.gesendet.filter((g) => g.chat === 444 && g.text.includes('RE-2026-001')).length, 1)
})

Deno.test('Einstellung aus: kein Lauf', async () => {
  vergiss()
  const db = daten({ mahn_einstellung: [{ id: 1, aktiv: false, letzter_lauf: null }] })
  const s = sammler()
  const r = await pruefeMahnVorschlaege(db, s.sende, MO_0930, { ladeAuszuege: auszug })
  assertEquals(r.gelaufen, false)
  assertEquals(db.tabelle('mahn_vorschlaege').length, 0)
  assertEquals(s.gesendet.length, 0)
})

Deno.test('Empfänger: Verantwortlicher ohne Rechte → Geschäftsführung; private Akte nur der Besitzer', () => {
  const team = [
    { email: 'andreas@mayer.de', chat: 1, rolle: 'geschaeftsfuehrung', bereiche: [] },
    { email: 'quirin@mayer.de', chat: 2, rolle: 'mitarbeiter', bereiche: ['immobilien'] },
    { email: 'hasan@mayer.de', chat: 3, rolle: 'mitarbeiter', bereiche: ['beratung'] },
  ]
  assertEquals(empfaengerFuer({ id: 'k', bereich: 'beratung', firma: '', ansprechpartner: '', verantwortlich_email: 'quirin@mayer.de' }, team).map((p) => p.email), ['andreas@mayer.de'])
  assertEquals(empfaengerFuer({ id: 'k', bereich: 'beratung', firma: '', ansprechpartner: '', verantwortlich_email: 'HASAN@mayer.de' }, team).map((p) => p.email), ['hasan@mayer.de'])
  assertEquals(empfaengerFuer({ id: 'k', bereich: 'privat', firma: '', ansprechpartner: '', verantwortlich_email: 'andreas@mayer.de' }, team).map((p) => p.email), ['andreas@mayer.de'])
  assertEquals(empfaengerFuer({ id: 'k', bereich: 'privat', firma: '', ansprechpartner: '', verantwortlich_email: 'niemand@mayer.de' }, team), [])
})

Deno.test('Plan: für eine Stufe mit vorhandener Zeile (gesendet) kein neuer Vorschlag', () => {
  const r = rechnung('x', '2026-11-01')
  const p = planeMahnVorschlaege([r], [{ id: 'x:erinnerung', rechnung_id: 'x', stufe: 'erinnerung', status: 'gesendet' } as never], HEUTE, STANDARD_EINSTELLUNG)
  assertEquals(p.neu.length, 0)
})
