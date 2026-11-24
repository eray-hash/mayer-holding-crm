// Rechnungsnummern nach Vorgabe der Geschäftsführung: Initialen, fester Unterscheidungsbuchstabe je Kunde,
// laufende Nummer je Kürzel. Erfundene Namen. Kein Netz, keine Datenbank.
//
//   npx -y deno test _shared/rechnungsnummerKern.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { anfangsbuchstabe, initialenVon, kuerzelFuer, naechsteNummerFuerKuerzel, praefixVon, rechnungsnummerVorschlag, unterscheidung } from './rechnungsnummerKern.ts'

Deno.test('Initialen: Personenname, Umlaute, Anrede, Firma ohne Rechtsform, Klammern', () => {
  assertEquals(initialenVon({ id: 'k', firma: 'Lukas Sommerfeld' }), 'LS')
  assertEquals(initialenVon({ id: 'k', firma: 'Özlem Ärmel' }), 'OA')
  assertEquals(initialenVon({ id: 'k', firma: 'Herr Dr. Max Peter Mustermann' }), 'MM')
  assertEquals(initialenVon({ id: 'k', firma: 'Bäckerei Brot GmbH', ansprechpartner: 'Herr Brot' }), 'BB')
  assertEquals(initialenVon({ id: 'k', firma: 'Muster Bau GmbH & Co. KG' }), 'MB')
  assertEquals(initialenVon({ id: 'k', firma: 'Muster Bau GmbH', ansprechpartner: 'Hans Meier' }), 'HM')
  // Akte, in der zwei Vornamen mit „und“ stehen: der Personenname im anderen Feld zählt.
  assertEquals(initialenVon({ id: 'k', firma: 'Lukas und Stefan (Genossenschaft)', ansprechpartner: 'Lukas Sommerfeld' }), 'LS')
  assertEquals(initialenVon({ id: 'k', firma: 'Lukas Sommerfeld', ansprechpartner: 'Lukas und Stefan' }), 'LS')
  assertEquals(initialenVon({ id: 'k', firma: 'Genossenschaft Nord eG (Ulm)' }), 'GN')
  assertEquals(initialenVon({ id: 'k', firma: 'Siemens AG' }), 'SI')
  // Vor-/Nachname-Felder haben Vorrang.
  assertEquals(initialenVon({ id: 'k', vorname: 'Ute', nachname: 'Zeller', firma: 'Muster Bau GmbH' }), 'UZ')
  assertEquals(initialenVon({ id: 'k' }), 'XX')
  assertEquals(anfangsbuchstabe('ßtraße'), 'S')
})

Deno.test('Unterscheidung: A … Z, dann AA, AB', () => {
  assertEquals([0, 1, 25, 26, 27, 51, 52].map(unterscheidung), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA'])
})

Deno.test('Kürzel: erster Kunde A, zweiter mit gleichen Initialen B, gespeichertes bleibt', () => {
  const lukas = { id: 'k_1', firma: 'Lukas Sommerfeld' }
  const lea = { id: 'k_2', firma: 'Lea Sander' }
  assertEquals(kuerzelFuer({ kunde: lukas, kuerzel: [], rechnungen: [] }), { kuerzel: 'LSA', neu: true })
  assertEquals(kuerzelFuer({ kunde: lea, kuerzel: [{ kunde_id: 'k_1', kuerzel: 'LSA' }], rechnungen: [] }), { kuerzel: 'LSB', neu: true })
  assertEquals(kuerzelFuer({ kunde: { ...lukas, rechnungs_kuerzel: 'LSA' }, kuerzel: [{ kunde_id: 'k_1', kuerzel: 'LSA' }], rechnungen: [] }), { kuerzel: 'LSA', neu: false })
  // Nach Z kommt AA.
  const voll = Array.from({ length: 26 }, (_, i) => ({ kunde_id: `k_x${i}`, kuerzel: `LS${unterscheidung(i)}` }))
  assertEquals(kuerzelFuer({ kunde: lea, kuerzel: voll, rechnungen: [] }).kuerzel, 'LSAA')
})

Deno.test('Kürzel: alte Nummern zählen mit, ohne doppelt zu vergeben', () => {
  const neu = { id: 'k_neu', firma: 'Clara Lenz' }
  // Ein anderer Kunde hat alte Rechnungen „CL-001“ (ohne Unterscheidung) → belegt einen Platz → B.
  assertEquals(kuerzelFuer({ kunde: neu, kuerzel: [], rechnungen: [{ kunde_id: 'k_alt', nummer: 'CL-001' }] }).kuerzel, 'CLB')
  // Der Kunde mit den alten CL-Rechnungen selbst bekommt A.
  assertEquals(kuerzelFuer({ kunde: { id: 'k_alt', firma: 'Carl Lohmann' }, kuerzel: [], rechnungen: [{ kunde_id: 'k_alt', nummer: 'CL-001' }] }).kuerzel, 'CLA')
  // Alte Nummer eines anderen mit Unterscheidung (CLA-004) belegt genau CLA.
  assertEquals(kuerzelFuer({ kunde: neu, kuerzel: [], rechnungen: [{ kunde_id: 'k_x', nummer: 'CLA-004' }] }).kuerzel, 'CLB')
  // Eigene alte Nummer mit Unterscheidung wird übernommen.
  assertEquals(kuerzelFuer({ kunde: neu, kuerzel: [], rechnungen: [{ kunde_id: 'k_neu', nummer: 'CLC-002' }] }), { kuerzel: 'CLC', neu: true })
  // Ganz andere Muster (RE-2026-001) stören nicht.
  assertEquals(praefixVon('RE-2026-001'), '')
  assertEquals(kuerzelFuer({ kunde: neu, kuerzel: [], rechnungen: [{ kunde_id: 'k_x', nummer: 'RE-2026-001' }] }).kuerzel, 'CLA')
})

Deno.test('Laufende Nummer je Kürzel: höchste + 1, dreistellig, andere Kürzel zählen nicht', () => {
  assertEquals(naechsteNummerFuerKuerzel('LSA', []), 'LSA-001')
  assertEquals(naechsteNummerFuerKuerzel('LSA', ['LSA-001', 'lsa-002', 'LSB-007', 'CL-001']), 'LSA-003')
  assertEquals(naechsteNummerFuerKuerzel('LSB', ['LSA-001', 'LSB-007']), 'LSB-008')
  assertEquals(naechsteNummerFuerKuerzel('LSA', ['LSA-999']), 'LSA-1000')
  assertEquals(rechnungsnummerVorschlag({ kunde: { id: 'k_1', firma: 'Lukas Sommerfeld' }, kuerzel: [], rechnungen: [{ kunde_id: 'k_c', nummer: 'CL-001' }] }), { kuerzel: 'LSA', neu: true, nummer: 'LSA-001' })
})
