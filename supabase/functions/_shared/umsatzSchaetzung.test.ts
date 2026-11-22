// Regel (c2) der Umsatzvorschau: geschätzter Umsatz einer Akte ohne Kostenvoranschlag zählt × Chance im
// erwarteten Monat — nicht doppelt neben einem Kostenvoranschlag mit Betrag, einer Rechnung oder bei Immobilien.
import { assertEquals } from 'jsr:@std/assert@1'
import { berechneUmsatzvorschau, summen } from './umsatzKern.ts'

const HEUTE = '2026-11-22'
const Z = { von: '2026-01', bis: '2027-12' }

Deno.test('Schätzung zählt wie ein offenes Angebot', () => {
  const v = berechneUmsatzvorschau({
    heute: HEUTE,
    rechnungen: [{ id: 'r1', nummer: 'R-1', kundeId: 'k_r', datum: '2026-11-01', netto: 1000, brutto: 1190, status: 'Versendet' }],
    angebote: [{ id: 'kv1', kundeId: 'k_kv', name: 'KV', status: 'offen', datum: '2026-11-10', betrag: 2000 }],
    akten: [
      { id: 'k_s', bereich: 'beratung', name: 'Schätzung', status: 'angebot', chance: 40, chanceBestaetigt: true, erwartetNetto: 5000, erwartetMonat: '2027-01' },
      { id: 'k_alt', bereich: 'erben', name: 'Alt', status: 'erstkontakt', chance: 10, erwartetNetto: 2500, erwartetMonat: '2025-03' },
      { id: 'k_kv', bereich: 'beratung', name: 'Mit KV', status: 'angebot', chance: 50, erwartetNetto: 99999 },
      { id: 'k_r', bereich: 'beratung', name: 'Mit Rechnung', status: 'aktives_mandat', chance: 90, erwartetNetto: 7777 },
      { id: 'k_i', bereich: 'immobilienkunden', name: 'Immo', status: 'interessent', chance: 20, erwartetNetto: 8888 },
      { id: 'k_x', bereich: 'beratung', name: 'Fertig', status: 'abgeschlossen', chance: 90, erwartetNetto: 6666 },
      { id: 'k_o', bereich: 'beratung', name: 'Ohne Umsatz', status: 'angebot', chance: 30 },
    ],
    objekte: [],
  })
  const schaetzungen = v.posten.filter((p) => p.id.startsWith('schaetzung:'))
  assertEquals(schaetzungen.map((p) => [p.verweis.id, p.monat, p.gewichtet]), [['k_s', '2027-01', 2000], ['k_alt', '2026-11', 250]])
  assertEquals(summen(v, Z).angebote, 2000 + 250 + 1000)
  // k_o, k_r und k_i: Chance ohne Kostenvoranschlag mit Betrag (wie bisher); die Schätzungen k_s/k_alt zählen nicht als Lücke.
  assertEquals(v.hinweise.aktenMitChanceOhneAngebot, 3)
})
