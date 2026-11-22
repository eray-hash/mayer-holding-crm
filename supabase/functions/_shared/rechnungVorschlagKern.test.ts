// Regeln der Rechnungsvorschläge (rechnungVorschlagKern.ts) ohne Datenbank.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { faelligSatz, gleicheAb, positionenAusKv, positionenFuerAkte, sollVorschlaege, summeNetto, vorschlagLink, type VorschlagEingabe } from './rechnungVorschlagKern.ts'

function eingabe(teil: Partial<VorschlagEingabe> = {}): VorschlagEingabe {
  return { akten: [], angebote: [], anmeldungen: [], objekte: [], rechnungen: [], preisliste: [], ...teil }
}

Deno.test('angenommener Kostenvoranschlag ohne Rechnung → Vorschlag mit Positionen samt Aufschlag', () => {
  const soll = sollVorschlaege(eingabe({
    angebote: [
      { id: 'kv1', kundeId: 'k1', bereich: 'beratung', privat: false, name: 'KV 1', beschreibung: 'Strategie', status: 'angenommen', aufschlagProzent: 10, ustSatz: 19, positionen: [{ bezeichnung: 'Beratung', menge: 2, einheit: 'Stunde', einzelpreis: 100 }] },
      { id: 'kv2', kundeId: 'k1', bereich: 'beratung', privat: false, name: 'KV 2', status: 'offen', betrag: 500 },
      { id: 'kv3', kundeId: 'k1', bereich: 'beratung', privat: false, name: 'KV 3', status: 'angenommen', betrag: 500 },
      { id: 'kv4', kundeId: null, bereich: null, privat: true, name: 'privat', status: 'angenommen', betrag: 500 },
    ],
    rechnungen: [{ id: 'r1', kundeId: 'k1', kvId: 'kv3' }],
    aktenNamen: new Map([['k1', { name: 'Bäckerei Brot', bereich: 'beratung' }]]),
  }))
  assertEquals(soll.map((s) => s.id), ['kv:kv1'])
  assertEquals(soll[0].positionen[0].einzelpreis, 110)
  assertEquals(soll[0].betrag_netto, 220)
  assertEquals(soll[0].kunde_bereich, 'beratung')
  assertStringIncludes(soll[0].grund, 'Bäckerei Brot')
})

Deno.test('Kostenvoranschlag ohne Positionen: Betrag mit Steuersatz gilt als brutto', () => {
  const p = positionenAusKv({ id: 'x', kundeId: null, bereich: null, privat: false, name: 'Pauschal', status: 'angenommen', betrag: 1190, ustSatz: 19 })
  assertEquals(p, [{ bezeichnung: 'Pauschal', menge: 1, einheit: 'Pauschal', einzelpreis: 1000 }])
})

Deno.test('erledigte Akte ohne Rechnung: nur passende Bereiche und Stände, nicht mit Kostenvoranschlag, Seminar oder Rechnung', () => {
  const soll = sollVorschlaege(eingabe({
    akten: [
      { id: 'a1', bereich: 'beratung', name: 'A1', status: 'rechnung_gestellt', umsatzNetto: 4000, dienstleistungen: ['Strategie'] },
      { id: 'a2', bereich: 'erben', name: 'A2', status: 'abgeschlossen', dienstleistungen: ['Reguläres Beratungshonorar (Basis)', 'Frei'] },
      { id: 'a3', bereich: 'finanzierungen', name: 'Investor', status: 'abgeschlossen' },
      { id: 'a4', bereich: 'immobilienkunden', name: 'Käufer', status: 'abgeschlossen' },
      { id: 'a5', bereich: 'beratung', name: 'mit Rechnung', status: 'abgeschlossen' },
      { id: 'a6', bereich: 'beratung', name: 'mit KV', status: 'abgeschlossen' },
      { id: 'a7', bereich: 'akademie', name: 'mit Seminar', status: 'abgeschlossen' },
      { id: 'a8', bereich: 'beratung', name: 'läuft', status: 'umsetzung' },
      { id: 'k_intern_holding', bereich: 'beratung', name: 'Holding', status: 'abgeschlossen' },
    ],
    angebote: [{ id: 'kvb', kundeId: 'a6', bereich: 'beratung', privat: false, name: 'bezahlt', status: 'bezahlt', betrag: 100 }],
    anmeldungen: [{ id: 'an', kundeId: 'a7', name: 'X', status: 'teilgenommen', rechnungId: 'r9', seminarTitel: 'S' }],
    rechnungen: [{ id: 'r5', kundeId: 'a5', kvId: null }],
    preisliste: [{ id: 'l1', bezeichnung: 'Reguläres Beratungshonorar (Basis)', preis_stunde_von: 700, preis_tag_von: null }],
  }))
  assertEquals(soll.map((s) => s.id), ['akte:a1', 'akte:a2'])
  assertEquals(soll[0].betrag_netto, 4000)
  assertEquals(soll[0].positionen[0].bezeichnung, 'Strategie')
  assertEquals(soll[1].positionen, [
    { bezeichnung: 'Reguläres Beratungshonorar (Basis)', menge: 1, einheit: 'Stunde', einzelpreis: 700, leistungId: 'l1' },
    { bezeichnung: 'Frei', menge: 1, einheit: 'Pauschal', einzelpreis: 0 },
  ])
  assertStringIncludes(soll[1].grund, 'Preisliste')
})

Deno.test('Akte ohne Betrag: leere Position, Betrag offen', () => {
  const r = positionenFuerAkte({ id: 'a', bereich: 'beratung', name: 'A', status: 'abgeschlossen' }, [])
  assertEquals(summeNetto(r.positionen), 0)
  const soll = sollVorschlaege(eingabe({ akten: [{ id: 'a', bereich: 'beratung', name: 'A', status: 'abgeschlossen' }] }))
  assertEquals(soll[0].betrag_netto, null)
})

Deno.test('Seminarteilnahme ohne Rechnung → Vorschlag mit Preis; mit Rechnung oder anderem Stand nicht', () => {
  const soll = sollVorschlaege(eingabe({
    anmeldungen: [
      { id: 'u1', kundeId: 'k1', name: 'Erika Muster', firma: 'Muster GmbH', status: 'teilgenommen', rechnungId: null, seminarTitel: 'Rhetorik', preisNetto: 490, beginn: '2026-11-03T08:00:00Z' },
      { id: 'u2', kundeId: null, name: 'Ohne Akte', status: 'teilgenommen', rechnungId: null, seminarTitel: 'Rhetorik', preisNetto: null },
      { id: 'u3', kundeId: 'k1', name: 'Mit Rechnung', status: 'teilgenommen', rechnungId: 'r1', seminarTitel: 'Rhetorik', preisNetto: 490 },
      { id: 'u4', kundeId: 'k1', name: 'Angemeldet', status: 'angemeldet', rechnungId: null, seminarTitel: 'Rhetorik', preisNetto: 490 },
    ],
  }))
  assertEquals(soll.map((s) => s.id), ['seminar:u1', 'seminar:u2'])
  assertEquals(soll[0].betrag_netto, 490)
  assertEquals(soll[0].kunde_bereich, 'akademie')
  assertStringIncludes(soll[0].titel, '03.11.2026')
  assertEquals(soll[1].betrag_netto, null)
  assertStringIncludes(soll[1].grund, 'Ohne Akte')
})

Deno.test('Provision: erst ab beurkundet und nur mit bekannter Provision (keine Annahme)', () => {
  const soll = sollVorschlaege(eingabe({
    objekte: [
      { id: 'o1', name: 'MFH Lorch', status: 'beurkundet', kaufpreis: 1_000_000, freigaben: [{ provision: '3,57 % inkl. MwSt.', status: 'zugestimmt' }], zugestimmteKunden: [{ id: 'kk', bereich: 'immobilienkunden' }] },
      { id: 'o2', name: 'Ohne Provision', status: 'beurkundet', kaufpreis: 500_000 },
      { id: 'o3', name: 'Noch nicht', status: 'notartermin', kaufpreis: 500_000, abrechnungProvision: 15000 },
      { id: 'o4', name: 'Privat', status: 'verkauft', kaufpreis: 500_000, abrechnungProvision: 15000, privatBesitzer: 'x@y.de' },
      { id: 'o5', name: 'Abrechnung', status: 'verkauft', kaufpreis: 0, abrechnungProvision: 12000, kunde: { id: 'kz', bereich: 'immobilienkunden' } },
    ],
  }))
  assertEquals(soll.map((s) => s.id), ['provision:o1', 'provision:o5'])
  assertEquals(soll[0].betrag_netto, 30000)
  assertEquals(soll[0].kunde_id, 'kk')
  assertEquals(soll[1].betrag_netto, 12000)
  assertEquals(soll[1].kunde_id, 'kz')
})

Deno.test('Abgleich: neu, ändern, erledigt durch Rechnung, entfernen; erstellt/verworfen bleiben', () => {
  const soll = sollVorschlaege(eingabe({
    angebote: [
      { id: 'kv1', kundeId: 'k1', bereich: 'beratung', privat: false, name: 'KV 1', status: 'angenommen', betrag: 100 },
      { id: 'kv2', kundeId: 'k1', bereich: 'beratung', privat: false, name: 'KV 2', status: 'angenommen', betrag: 200 },
      { id: 'kv3', kundeId: 'k1', bereich: 'beratung', privat: false, name: 'KV 3', status: 'angenommen', betrag: 300 },
    ],
  }))
  const alt = { ...soll[1], status: 'offen' as const, betrag_netto: 150 }
  const vorhanden = [
    alt,
    { ...soll[2], status: 'verworfen' as const },
    { ...soll[0], id: 'kv:weg', kv_id: 'weg', status: 'offen' as const },
    { ...soll[0], id: 'kv:fertig', kv_id: 'fertig', status: 'offen' as const },
  ]
  const a = gleicheAb(soll, vorhanden, (z) => (z.kv_id === 'fertig' ? 'r77' : undefined))
  assertEquals(a.neu.map((s) => s.id), ['kv:kv1'])
  assertEquals(a.aendern.map((x) => x.id), ['kv:kv2'])
  assertEquals(a.aendern[0].felder.betrag_netto, 200)
  assert(!('titel' in a.aendern[0].felder))
  assertEquals(a.erledigt, [{ id: 'kv:fertig', rechnungId: 'r77' }])
  assertEquals(a.entfernen, ['kv:weg'])
})

Deno.test('Texte', () => {
  assertEquals(faelligSatz(1), '1 Rechnung ist fällig zu stellen')
  assertEquals(faelligSatz(3), '3 Rechnungen sind fällig zu stellen')
  assertEquals(vorschlagLink('https://crm.test', 'kv:a b'), 'https://crm.test/#/beratung/rechnungen?vorschlag=kv%3Aa%20b')
})
