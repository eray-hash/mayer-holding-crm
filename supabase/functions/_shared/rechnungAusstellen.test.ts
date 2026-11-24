// Rechnung ausstellen: Beträge und Rundung wie im CRM, Positionen, Anschrift, PDF auf dem Holding-Briefbogen
// (keine Ausnahme, kein Text in der Team-Spalte oder der Fußzeile, mehrere Seiten). Erfundene Namen, kein Netz.
//
//   npx -y deno test --allow-all _shared/rechnungAusstellen.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { anschriftFuer, empfaengerZeilen, hatPlzOrt, leistungBeschriftung, leistungText, lesePositionen, plusTage, rechnungDateiname, summeAusPositionen, xRechnungEingabe, zahlAus } from './rechnungAusstellenKern.ts'
import { erzeugeHoldingRechnungPdf, type Platzierung, RECHNUNG_SATZSPIEGEL } from './rechnungHoldingPdf.ts'
import { erzeugeXRechnung, pruefeXRechnung } from './eRechnung/erzeugen.ts'

Deno.test('Beträge: 10 × 500 € netto, 19 % → 5.000 / 950 / 5.950', () => {
  assertEquals(summeAusPositionen([{ menge: 10, einzelpreis: 500 }], 19), { netto: 5000, ust: 950, brutto: 5950 })
  assertEquals(summeAusPositionen([{ menge: 1, einzelpreis: 5000 }], 19), { netto: 5000, ust: 950, brutto: 5950 })
})

Deno.test('Beträge: je Position auf Cent gerundet, Steuer auf den Nettobetrag (wie src/lib/rechnungen.ts)', () => {
  // 3 × 33,333 → 99,999 → 100,00; 1,5 × 0,07 → 0,105 → 0,11 (kaufmännisch); Summe 100,11
  const s = summeAusPositionen([{ menge: 3, einzelpreis: 33.333 }, { menge: 1.5, einzelpreis: 0.07 }], 19)
  assertEquals(s.netto, 100.11)
  assertEquals(s.ust, 19.02)
  assertEquals(s.brutto, 119.13)
  assertEquals(summeAusPositionen([{ menge: 1, einzelpreis: 100 }], 7), { netto: 100, ust: 7, brutto: 107 })
  assertEquals(summeAusPositionen([{ menge: 2, einzelpreis: 250 }], 0), { netto: 500, ust: 0, brutto: 500 })
})

Deno.test('Positionen: Vorgaben, deutsche Zahlen, Fehler', () => {
  const p = lesePositionen([{ bezeichnung: ' Beratung  laut Vereinbarung ', einzelpreis: '5.000,00' }, { bezeichnung: 'Workshop', menge: 2, einheit: 'Std.', einzelpreis: 150.005 }])
  assert(Array.isArray(p))
  assertEquals(p.map((x) => [x.bezeichnung, x.menge, x.einheit, x.einzelpreis]), [['Beratung laut Vereinbarung', 1, 'Pauschal', 5000], ['Workshop', 2, 'Stunde', 150.01]])
  assertEquals(typeof lesePositionen([]), 'string')
  assertEquals(typeof lesePositionen([{ bezeichnung: '', einzelpreis: 1 }]), 'string')
  assertEquals(typeof lesePositionen([{ bezeichnung: 'x', menge: 0, einzelpreis: 1 }]), 'string')
  assertEquals(typeof lesePositionen([{ bezeichnung: 'x', einzelpreis: 'viel' }]), 'string')
  assertEquals(zahlAus('1.234,5'), 1234.5)
  assertEquals(zahlAus('5000 €'), 5000)
})

Deno.test('Anschrift, Leistung, Datum, Dateiname', () => {
  const akte = { id: 'k_1', firma: 'Muster GmbH', ansprechpartner: 'Max Muster', anschrift: 'Musterstraße 1, 12345 Musterstadt', email: 'max@muster.example' }
  const a = anschriftFuer('', akte)
  assertEquals(a, ['Musterstraße 1', '12345 Musterstadt'])
  assert(hatPlzOrt(a))
  assert(!hatPlzOrt(['Musterstraße 1']))
  assertEquals(empfaengerZeilen(akte, a), ['Muster GmbH', 'Max Muster', 'Musterstraße 1', '12345 Musterstadt'])
  assertEquals(empfaengerZeilen({ id: 'k', firma: 'Max Muster', ansprechpartner: 'Max Muster' }, a), ['Max Muster', 'Musterstraße 1', '12345 Musterstadt'])
  assertEquals(anschriftFuer('', { id: 'k', immo_stammdaten: { adresse: 'Weg 2, 89073 Ulm' } }), ['Weg 2', '89073 Ulm'])
  assertEquals(leistungText('2026-11-20', ''), '20.11.2026')
  assertEquals(leistungBeschriftung('20.11.2026'), 'Leistungsdatum')
  assertEquals(leistungBeschriftung('01.11.–20.11.2026'), 'Leistungszeitraum')
  assertEquals(plusTage('2026-11-24', 14), '2026-12-08')
  assertEquals(plusTage('2026-12-20', 14), '2027-01-03')
  assertEquals(rechnungDateiname('LSA-001', '2026-11-24'), 'Rechnung LSA-001 (24.11.2026).pdf')
})

Deno.test('E-Rechnung: Angaben des Holding-Briefbogens reichen für die XRechnung', () => {
  const akte = { id: 'k_1', firma: 'Muster GmbH', ansprechpartner: 'Max Muster', anschrift: 'Musterstraße 1\n12345 Musterstadt', email: 'max@muster.example' }
  const e = xRechnungEingabe(
    { nummer: 'MGA-001', datum: '2026-11-24', zahlungsziel: '2026-12-08', positionen: [{ bezeichnung: 'Beratung', menge: 10, einheit: 'Pauschal', einzelpreis: 500 }], ust_satz: 19 },
    akte,
    empfaengerZeilen(akte, anschriftFuer('', akte)),
  )
  assertEquals(pruefeXRechnung(e), [])
  const xml = erzeugeXRechnung(e)
  assert(xml.includes('MGA-001') && xml.includes('5950.00'))
})

const BEISPIEL = {
  nummer: 'MGA-001',
  datum: '2026-11-24',
  zahlungsziel: '2026-12-08',
  empfaenger: ['Muster GmbH', 'Max Muster', 'Musterstraße 1', '12345 Musterstadt'],
  positionen: [{ bezeichnung: 'Beratungsleistung', menge: 10, einheit: 'Pauschal', einzelpreis: 500 }],
  ustSatz: 19,
  absender: 'Erika Beispiel',
}

function imSatzspiegel(p: Platzierung[]) {
  const { links, rechts, unten } = RECHNUNG_SATZSPIEGEL
  for (const x of p) {
    // Seite 1: rechts beginnt bei 153,9 mm die Team-Spalte des Briefbogens.
    if (x.seite === 1) assert(x.x2 <= rechts + 0.01 && x.x2 < 153.9, `Seite 1, „${x.text}“ ragt bis ${x.x2.toFixed(1)} mm (Team-Spalte)`)
    assert(x.x1 >= links - 0.01, `„${x.text}“ beginnt links außerhalb (${x.x1.toFixed(1)} mm)`)
    assert(x.y <= unten + 3, `„${x.text}“ steht in der Fußzeile (y ${x.y.toFixed(1)} mm)`)
  }
}

Deno.test('PDF: eine Seite, Briefbogen eingebettet, nichts in der Team-Spalte', async () => {
  const p: Platzierung[] = []
  const r = await erzeugeHoldingRechnungPdf(BEISPIEL, { protokoll: p })
  assertEquals(r.seiten, 1)
  assertEquals(r.summen, { netto: 5000, ust: 950, brutto: 5950 })
  const doc = await PDFDocument.load(r.bytes)
  assertEquals(doc.getPageCount(), 1)
  assertEquals(doc.getTitle(), 'Rechnung MGA-001')
  imSatzspiegel(p)
  const texte = p.map((x) => x.text)
  for (const muss of ['Muster GmbH', '12345 Musterstadt', 'Rechnung', 'MGA-001', '24.11.2026', '08.12.2026', '5.000,00 €', '950,00 €', '5.950,00 €', 'DE92 6115 0020 0007 0219 58', 'Erika Beispiel']) {
    assert(texte.some((t) => t.includes(muss)), `fehlt: ${muss}`)
  }
})

Deno.test('PDF: viele lange Positionen → mehrere Seiten, Kopf wiederholt, alles im Satzspiegel; Sonderzeichen werfen nicht', async () => {
  const p: Platzierung[] = []
  const positionen = Array.from({ length: 40 }, (_, i) => ({
    bezeichnung: `Leistung ${i + 1}: Begleitung → Umsetzung mit sehr langer Beschreibung, die umbrochen werden muss 😀 ${'X'.repeat(i % 3 ? 5 : 80)}`,
    menge: 1.5,
    einheit: i % 2 ? 'Stunde' : 'Tag',
    einzelpreis: 1234567.89,
  }))
  const r = await erzeugeHoldingRechnungPdf({ ...BEISPIEL, positionen, hinweis: 'Hinweis mit geschütztem Leerzeichen', anschreiben: 'Eigener Text vor der Aufstellung.' }, { protokoll: p })
  assert(r.seiten >= 3, `nur ${r.seiten} Seiten`)
  imSatzspiegel(p.filter((x) => !x.text.startsWith('Rechnung MGA-001 · Seite')))
  assert(p.filter((x) => x.text === 'Einzelpreis').length >= 2, 'Tabellenkopf auf der Folgeseite fehlt')
  assert(p.some((x) => x.text === `Seite 1 von ${r.seiten}`))
})
