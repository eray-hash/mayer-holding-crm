import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  type AbgleichBuchung,
  type AbgleichRechnung,
  type AbgleichVerbindlichkeit,
  findeNummer,
  fingerabdruecke,
  gleicheAb,
  kennungenAusText,
  namensNaehe,
  verbindlichkeitNotiz,
  zahlungsVermerk,
} from './zahlungsAbgleich.ts'
import { dekodiereText, leseKontoCsv, zahlAusCsv } from './kontoauszugCsv.ts'

const b = (id: string, datum: string, betrag: number, zweck: string, name?: string): AbgleichBuchung => ({ id, datum, betrag, verwendungszweck: zweck, gegenName: name ?? null })
const r = (id: string, nummer: string, offen: number, namen: string[], datum = '2026-10-01', brutto = offen): AbgleichRechnung => ({ id, nummer, datum, brutto, offen, kundeId: `k_${namen[0]}`, namen })

Deno.test('Nummer im Verwendungszweck: verschiedene Schreibweisen, keine Teiltreffer', () => {
  assertEquals(findeNummer('RE-2026-012', 'Rechnung RE-2026-012 vielen Dank'), 'voll')
  assertEquals(findeNummer('RE-2026-012', 'RE 2026 012'), 'voll')
  assertEquals(findeNummer('RE-2026-012', 're2026012'), 'voll')
  assertEquals(findeNummer('RE-2026-012', 'RE-2026-12'), 'voll')
  assertEquals(findeNummer('RE-2026-012', 'Rg. 2026-012'), 'ziffern')
  assertEquals(findeNummer('RE-2026-01', 'RE-2026-012'), null)
  assertEquals(findeNummer('RE-2026-012', 'RE-2026-0123'), null)
  assertEquals(findeNummer('12', 'Rechnung 12'), null)
})

Deno.test('Namensnähe ohne Rechtsform und Umlaute', () => {
  assertEquals(namensNaehe('Müller Bau GmbH', 'MUELLER BAU GMBH & CO KG'), 1)
  assertEquals(namensNaehe('Hans Müller', 'Mueller, Hans'), 1)
  assert(namensNaehe('Müller Bau GmbH', 'Schmidt Elektro') === 0)
})

Deno.test('Nummer + genauer Betrag = sicher und vorausgewählt', () => {
  const e = gleicheAb([b('1', '2026-11-10', 1190, 'RE-2026-012', 'Müller Bau GmbH')], [r('r1', 'RE-2026-012', 1190, ['Müller Bau GmbH'])], [])
  assertEquals(e.vorschlaege.length, 1)
  const v = e.vorschlaege[0]
  assertEquals(v.sicherheit, 'sicher')
  assert(v.vorausgewaehlt)
  assertEquals(v.ziele[0].betrag, 1190)
  assert(v.ziele[0].vollstaendig)
  assert(v.grund.includes('Betrag stimmt genau'))
  assertEquals(v.fingerabdruck, 'kontoauszug:2026-11-10:+119000:1')
})

Deno.test('Teilzahlung mit Nummer = wahrscheinlich, nicht vollständig', () => {
  const e = gleicheAb([b('1', '2026-11-10', 500, 'Abschlag RE-2026-012')], [r('r1', 'RE-2026-012', 1190, ['Müller Bau GmbH'])], [])
  const v = e.vorschlaege[0]
  assertEquals(v.sicherheit, 'wahrscheinlich')
  assertEquals(v.ziele[0].betrag, 500)
  assertEquals(v.ziele[0].vollstaendig, false)
  assert(v.grund.includes('Teilzahlung'))
  assert(!v.vorausgewaehlt)
})

Deno.test('Skonto bis 3 % wird gekennzeichnet und nicht vorausgewählt; mehr als 3 % ist Teilzahlung', () => {
  const e = gleicheAb([b('1', '2026-11-10', 980, 'RE-2026-012 abzgl. 2% Skonto')], [r('r1', 'RE-2026-012', 1000, ['X'])], [])
  const v = e.vorschlaege[0]
  assertEquals(v.skonto, { betrag: 20, prozent: 2 })
  assert(v.ziele[0].vollstaendig)
  assertEquals(v.sicherheit, 'wahrscheinlich')
  assert(!v.vorausgewaehlt)
  const e2 = gleicheAb([b('1', '2026-11-10', 950, 'RE-2026-012')], [r('r1', 'RE-2026-012', 1000, ['X'])], [])
  assertEquals(e2.vorschlaege[0].skonto, undefined)
  assertEquals(e2.vorschlaege[0].ziele[0].vollstaendig, false)
})

Deno.test('Sammelüberweisung für zwei Rechnungen (Summe)', () => {
  const e = gleicheAb(
    [b('1', '2026-11-10', 1500, 'RE-2026-010 und RE-2026-011', 'Kunz AG')],
    [r('r1', 'RE-2026-010', 1000, ['Kunz AG'], '2026-09-01'), r('r2', 'RE-2026-011', 500, ['Kunz AG'], '2026-10-01'), r('r3', 'RE-2026-099', 1500, ['Kunz AG'])],
    [],
  )
  const v = e.vorschlaege[0]
  assertEquals(v.sicherheit, 'sicher')
  assertEquals(v.ziele.map((z) => [z.id, z.betrag, z.vollstaendig]), [['r1', 1000, true], ['r2', 500, true]])
})

Deno.test('Summe ohne Nummern über den Namen = wahrscheinlich', () => {
  const e = gleicheAb(
    [b('1', '2026-11-10', 1500, 'Zahlung Oktober', 'Kunz AG')],
    [r('r1', 'RE-2026-010', 1000, ['Kunz AG']), r('r2', 'RE-2026-011', 500, ['Kunz AG']), r('r3', 'RE-2026-012', 300, ['Kunz AG'])],
    [],
  )
  const v = e.vorschlaege[0]
  assertEquals(v.sicherheit, 'wahrscheinlich')
  assertEquals(v.ziele.map((z) => z.id).sort(), ['r1', 'r2'])
})

Deno.test('Betrag + voller Name ohne Nummer = sicher; nur Betrag = unklar', () => {
  const rech = [r('r1', 'RE-2026-010', 714, ['Schmidt Elektro GmbH']), r('r2', 'RE-2026-011', 333, ['Weber'])]
  const e = gleicheAb([b('1', '2026-11-10', 714, 'Danke', 'SCHMIDT ELEKTRO'), b('2', '2026-11-11', 333, 'Zahlung', 'Fremde Person')], rech, [])
  assertEquals(e.vorschlaege[0].sicherheit, 'sicher')
  assertEquals(e.vorschlaege[1].sicherheit, 'unklar')
  assert(e.vorschlaege[1].grund.startsWith('Nur der Betrag passt'))
})

Deno.test('Zahlung vor dem Rechnungsdatum wird abgestuft', () => {
  const e = gleicheAb([b('1', '2026-09-01', 100, 'RE-2026-012')], [r('r1', 'RE-2026-012', 100, ['X'], '2026-10-01')], [])
  assertEquals(e.vorschlaege[0].sicherheit, 'wahrscheinlich')
  assert(e.vorschlaege[0].grund.includes('vor dem Datum'))
})

Deno.test('Überzahlung = unklar mit Betrag', () => {
  const e = gleicheAb([b('1', '2026-11-10', 1200, 'RE-2026-012')], [r('r1', 'RE-2026-012', 1190, ['X'])], [])
  assertEquals(e.vorschlaege[0].sicherheit, 'unklar')
  assertEquals(e.vorschlaege[0].ueberzahlung, 10)
})

Deno.test('Ein offener Rest wird nur einmal verteilt', () => {
  const e = gleicheAb([b('1', '2026-11-10', 100, 'RE-2026-012'), b('2', '2026-11-11', 100, 'Zahlung', 'X GmbH')], [r('r1', 'RE-2026-012', 100, ['X GmbH'])], [])
  assertEquals(e.vorschlaege.length, 1)
  assertEquals(e.ohneTreffer.length, 1)
})

Deno.test('Schon gebuchte Buchung (Fingerabdruck) und von Hand erfasste Zahlung', () => {
  const buchungen = [b('1', '2026-11-10', 1190, 'RE-2026-012'), b('2', '2026-11-12', 50, 'RE-2026-013')]
  const fp = fingerabdruecke(buchungen)
  const e = gleicheAb(buchungen, [r('r1', 'RE-2026-012', 1190, ['X']), r('r2', 'RE-2026-013', 50, ['Y'])], [], [
    { art: 'rechnung', zielId: 'r9', bezeichnung: 'Rechnung RE-2026-001', datum: '2026-11-01', betrag: 1190, quellen: [fp.get('1')!] },
    { art: 'rechnung', zielId: 'r2', bezeichnung: 'Rechnung RE-2026-013', datum: '2026-11-12', betrag: 50 },
  ])
  assertEquals(e.schonGebucht.length, 1)
  assertEquals(e.vorschlaege.length, 1)
  assertEquals(e.vorschlaege[0].sicherheit, 'unklar')
  assert(e.vorschlaege[0].hinweis?.includes('womöglich doppelt'))
  assert(!e.vorschlaege[0].vorausgewaehlt)
})

Deno.test('Gleiche Buchungen am selben Tag bekommen verschiedene Fingerabdrücke', () => {
  const fp = fingerabdruecke([b('a', '2026-11-10', -9.99, 'x'), b('b', '2026-11-10', -9.99, 'y')])
  assertEquals([...fp.values()], ['kontoauszug:2026-11-10:-999:1', 'kontoauszug:2026-11-10:-999:2'])
})

Deno.test('Ausgänge gegen Verbindlichkeiten', () => {
  const v: AbgleichVerbindlichkeit[] = [
    { id: 'v1', lieferant: 'Telekom Deutschland GmbH', rechnungsnummer: '4711-0815', datum: '2026-11-01', betrag: 59.9 },
    { id: 'v2', lieferant: 'Büro Meier', datum: '2026-11-02', betrag: null },
    { id: 'v3', lieferant: 'Stadtwerke Ulm', datum: '2026-11-03', betrag: 120 },
  ]
  const e = gleicheAb(
    [b('1', '2026-11-05', -59.9, 'Rechnung 4711-0815', 'Telekom'), b('2', '2026-11-06', -80, 'Bueromaterial', 'Buero Meier'), b('3', '2026-11-07', 120, 'Gutschrift', 'Stadtwerke Ulm')],
    [],
    v,
  )
  assertEquals(e.vorschlaege.length, 2)
  assertEquals(e.vorschlaege[0].art, 'verbindlichkeit')
  assertEquals(e.vorschlaege[0].sicherheit, 'sicher')
  assertEquals(e.vorschlaege[1].ziele[0].id, 'v2')
  assertEquals(e.vorschlaege[1].sicherheit, 'unklar')
  // Eingang von den Stadtwerken passt zu keiner Rechnung
  assertEquals(e.ohneTreffer.length, 1)
})

Deno.test('Vorschlags-ID bleibt bei gleichem Stand gleich', () => {
  const lauf = () => gleicheAb([b('1', '2026-11-10', 1190, 'RE-2026-012')], [r('r1', 'RE-2026-012', 1190, ['X'])], [])
  assertEquals(lauf().vorschlaege[0].id, lauf().vorschlaege[0].id)
})

Deno.test('Texte: Vermerk, Notiz mit Kennung', () => {
  assertEquals(zahlungsVermerk({ nummer: 'RE-1', betrag: 980, vollstaendig: true, offenNachher: 0, skonto: { betrag: 20, prozent: 2 } }), 'Zahlung über 980,00 € zu Rechnung RE-1 erfasst (aus dem Kontoauszug, 2 % Skonto (20,00 €) abgezogen) — Rechnung vollständig bezahlt')
  const notiz = verbindlichkeitNotiz('alt', { buchung: b('1', '2026-11-05', -59.9, ''), fingerabdruck: 'kontoauszug:2026-11-05:-5990:1' })
  assert(notiz.startsWith('alt\nBezahlt laut Kontoauszug am 05.11.2026 über 59,90 €'))
  assertEquals(kennungenAusText(notiz), ['kontoauszug:2026-11-05:-5990:1'])
})

Deno.test('CSV: Sparkasse (CAMT, Windows-1252, Semikolon)', () => {
  const text = [
    '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
    '"DE001";"12.11.26";"12.11.26";"GUTSCHR. UEBERWEISUNG";"Rechnung RE-2026-012";"";"";"NOTPROVIDED";"";"";"";"Müller Bau GmbH";"DE89370400440532013000";"COBADEFFXXX";"1.190,00";"EUR";"Umsatz gebucht"',
    '"DE001";"13.11.26";"13.11.26";"FOLGELASTSCHRIFT";"Telekom Rechnung 4711";"DE123";"M1";"";"";"";"";"Telekom Deutschland GmbH";"DE02120300000000202051";"";"-59,90";"EUR";"Umsatz gebucht"',
  ].join('\r\n')
  const bytes = new Uint8Array([...text].map((c) => (c === 'ü' ? 0xfc : c.charCodeAt(0))))
  const e = leseKontoCsv(dekodiereText(bytes))
  assertEquals(e.fehler, undefined)
  assertEquals(e.buchungen.length, 2)
  assertEquals(e.buchungen[0].datum, '2026-11-12')
  assertEquals(e.buchungen[0].betrag, 1190)
  assertEquals(e.buchungen[0].gegenName, 'Müller Bau GmbH')
  assertEquals(e.buchungen[0].gegenIban, 'DE89370400440532013000')
  assert(e.buchungen[0].verwendungszweck.includes('RE-2026-012'))
  assertEquals(e.buchungen[1].betrag, -59.9)
})

Deno.test('CSV: Volksbank mit Soll/Haben-Kennzeichen und Vorspann', () => {
  const text = [
    'Umsatzanzeige;;',
    'Kontonummer:;DE12 6009 0100 0123 4567 89;',
    '',
    'Buchungstag;Valuta;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;Verwendungszweck;Umsatz;Soll/Haben',
    '10.11.2026;10.11.2026;Kunz AG;DE11;RE-2026-010 RE-2026-011;1.500,00;H',
    '11.11.2026;11.11.2026;Stadtwerke;DE22;Abschlag;120,00;S',
  ].join('\n')
  const e = leseKontoCsv(text)
  assertEquals(e.buchungen.map((x) => x.betrag), [1500, -120])
  assertEquals(e.buchungen[0].gegenName, 'Kunz AG')
  assertEquals(e.iban, 'DE12600901000123456789')
})

Deno.test('CSV: DKB mit getrennten Spalten für Zahler und Empfänger', () => {
  const text = [
    '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)"',
    '"10.11.26";"10.11.26";"Gebucht";"Kunz AG";"Mayer Holding";"RE-2026-010";"Eingang";"DE11";"1.000,00"',
    '"11.11.26";"11.11.26";"Gebucht";"Mayer Holding";"Büro Meier";"Material";"Ausgang";"DE22";"-80,00"',
  ].join('\n')
  const e = leseKontoCsv(text)
  assertEquals(e.buchungen.map((x) => x.gegenName), ['Kunz AG', 'Büro Meier'])
})

Deno.test('CSV: Zahlen und unbekanntes Format', () => {
  assertEquals(zahlAusCsv('1.234,56'), 1234.56)
  assertEquals(zahlAusCsv('1.234,56-'), -1234.56)
  assertEquals(zahlAusCsv('99.90'), 99.9)
  assert(leseKontoCsv('a;b\n1;2').fehler)
})
