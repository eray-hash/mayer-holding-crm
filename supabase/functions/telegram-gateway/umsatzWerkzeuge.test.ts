// Prüft den Rechenkern der Umsatzvorschau (_shared/umsatzKern.ts) und das Werkzeug umsatz_vorschau mit
// einer nachgebauten Datenbank (ohne Netz): Provisionstexte, Regeln (a)–(d), Zeiträume und Rechte.
import { assert, assertAlmostEquals, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  angebotNetto, berechneUmsatzvorschau, groesstePosten, istBruttoSatz, jeMonat, kurzbericht, leseDeutscheZahl, leseProvision,
  offeneSumme, plusMonate, provisionFuerObjekt, summen, summenJeBereich, zeitraum, type UmsatzEingabe,
} from '../_shared/umsatzKern.ts'
import { bereichAusEingabe, fuehreUmsatzWerkzeugAus, type UmsatzKontext } from './umsatzWerkzeuge.ts'

// ─── Zahlen und Provisionstexte ─────────────────────────────────────────────────────────────────

Deno.test('deutsche Zahlen', () => {
  assertEquals(leseDeutscheZahl('3,57'), 3.57)
  assertEquals(leseDeutscheZahl('1.200.000'), 1_200_000)
  assertEquals(leseDeutscheZahl('5.000,50'), 5000.5)
  assertEquals(leseDeutscheZahl('2.5'), 2.5)
  assertEquals(leseDeutscheZahl(''), undefined)
})

Deno.test('Bruttosatz erkennen', () => {
  assert(istBruttoSatz(3.57))
  assert(istBruttoSatz(5.95))
  assert(istBruttoSatz(7.14))
  assert(!istBruttoSatz(3))
  assert(!istBruttoSatz(3.5))
  assert(!istBruttoSatz(2.5))
})

Deno.test('Provisionstexte lesen', () => {
  const p1 = leseProvision('3,57 % inkl. MwSt', 'frei')
  assert(p1?.art === 'prozent')
  assertAlmostEquals(p1.prozentNetto, 3, 0.001)
  const p2 = leseProvision('3 % zzgl. USt', 'frei')
  assert(p2?.art === 'prozent' && p2.prozentNetto === 3)
  const p3 = leseProvision('3 % des beurkundeten Kaufpreises zzgl. gesetzlicher Umsatzsteuer', 'frei')
  assert(p3?.art === 'prozent' && p3.prozentNetto === 3)
  const p4 = leseProvision('3,57 % inkl. USt.', 'frei')
  assert(p4?.art === 'prozent')
  assertAlmostEquals(p4.prozentNetto, 3, 0.001)
  const p5 = leseProvision('pauschal 5.000 € inkl. MwSt.', 'frei')
  assert(p5?.art === 'betrag')
  assertAlmostEquals(p5.nettoBetrag, 4201.68, 0.01)
  const p6 = leseProvision('3,57', 'prozent')
  assert(p6?.art === 'prozent')
  assertAlmostEquals(p6.prozentNetto, 3, 0.001)
  assertStringIncludes(p6.erklaerung, 'sieht nach inkl. USt. aus')
  const p7 = leseProvision('3', 'prozent')
  assert(p7?.art === 'prozent' && p7.prozentNetto === 3)
  const p8 = leseProvision('10 Tsd', 'betrag')
  assert(p8?.art === 'betrag' && p8.nettoBetrag === 10_000)
  const p9 = leseProvision('1,5 Mio', 'betrag')
  assert(p9?.art === 'betrag' && p9.nettoBetrag === 1_500_000)
  const p10 = leseProvision('Pauschale 12.500 EUR netto', 'frei')
  assert(p10?.art === 'betrag' && p10.nettoBetrag === 12_500)
  assertEquals(leseProvision('', 'frei'), undefined)
  assertEquals(leseProvision('nach Vereinbarung', 'frei'), undefined)
  assertEquals(leseProvision('150', 'prozent'), undefined)
})

Deno.test('Provision je Objekt: Reihenfolge der Quellen', () => {
  const basis = { id: 'o1', name: 'MFH Ulm', status: 'reserviert', kaufpreis: 1_000_000 }
  assertEquals(provisionFuerObjekt({ ...basis, abrechnungProvision: 40_000, kurzpruefungProzent: '5' }).betrag, 40_000)
  assertEquals(provisionFuerObjekt({ ...basis, kurzpruefungBetrag: '25.000', kurzpruefungProzent: '5' }).betrag, 25_000)
  assertEquals(provisionFuerObjekt({ ...basis, kurzpruefungProzent: '5,95' }).betrag, 50_000)
  // Zugestimmte Freigabe geht vor der neueren nicht zugestimmten.
  const f = provisionFuerObjekt({
    ...basis,
    freigaben: [
      { provision: '2 % zzgl. USt.', status: 'eingeladen', erstelltAm: '2026-11-20' },
      { provision: '3,57 % inkl. MwSt.', status: 'zugestimmt', erstelltAm: '2026-11-01' },
      { provision: '9 %', status: 'widerrufen', erstelltAm: '2026-11-21' },
    ],
  })
  assertEquals(f.betrag, 30_000)
  assertStringIncludes(f.quelle, 'zugestimmt')
  const std = provisionFuerObjekt(basis)
  assertEquals(std.betrag, 30_000)
  assert(std.annahme)
  const ohnePreis = provisionFuerObjekt({ ...basis, kaufpreis: 0 })
  assertEquals(ohnePreis.betrag, undefined)
  assertEquals(provisionFuerObjekt({ ...basis, kaufpreis: 0, zielpreis: 500_000 }).betrag, 15_000)
})

Deno.test('Netto eines Kostenvoranschlags wie kvNetto', () => {
  assertEquals(angebotNetto({ betrag: 1190, ustSatz: 19 }), 1000)
  assertEquals(angebotNetto({ betrag: 800 }), 800)
  assertEquals(angebotNetto({ positionen: [{ menge: 2, einzelpreis: 100 }], aufschlagProzent: 10, ustSatz: 19, betrag: 999 }), 220)
  assertEquals(angebotNetto({ betrag: null }), undefined)
})

Deno.test('Monate und Zeiträume', () => {
  assertEquals(plusMonate('2026-11', 2), '2027-01')
  assertEquals(plusMonate('2026-01', -1), '2025-12')
  assertEquals(zeitraum('monat', '2026-11-22'), { art: 'monat', von: '2026-11', bis: '2026-11', label: 'November 2026' })
  assertEquals(zeitraum('quartal', '2026-11-22'), { art: 'quartal', von: '2026-10', bis: '2026-12', label: '4. Quartal 2026' })
  assertEquals(zeitraum('jahr', '2026-11-22').von, '2026-01')
})

// ─── Regeln (a)–(d) ──────────────────────────────────────────────────────────────────────────────

function beispiel(): UmsatzEingabe {
  return {
    heute: '2026-11-22',
    akten: [
      { id: 'k1', bereich: 'beratung', name: 'Bäckerei Brot', status: 'angebot', chance: 50, chanceBestaetigt: true },
      { id: 'k2', bereich: 'erben', name: 'Familie Muster', status: 'konzept_erstellt' },
      { id: 'k3', bereich: 'beratung', name: 'Verloren GmbH', status: 'verloren', chance: 90 },
      { id: 'k4', bereich: 'immobilienkunden', name: 'Käufer Klein', status: 'angebot', chance: 40 },
    ],
    rechnungen: [
      { id: 'r1', nummer: 'RE-2026-001', kundeId: 'k1', bereich: 'beratung', akteName: 'Bäckerei Brot', datum: '2026-11-03', netto: 1000, brutto: 1190, status: 'Versendet', zahlungsziel: '2026-11-17', zahlungen: [{ datum: '2026-11-10', betrag: 595 }] },
      { id: 'r2', nummer: 'RE-2026-002', kundeId: 'k1', bereich: 'beratung', akteName: 'Bäckerei Brot', datum: '2026-08-01', netto: 2000, brutto: 2380, status: 'Bezahlt', bezahltAm: '2026-08-15' },
      { id: 'r3', nummer: 'RE-2026-003', kundeId: 'k2', bereich: 'erben', akteName: 'Familie Muster', datum: '2026-10-01', netto: 500, brutto: 595, status: 'Entwurf' },
      { id: 'r4', nummer: 'RE-2026-004', kundeId: 'k1', bereich: 'beratung', akteName: 'Bäckerei Brot', datum: '2026-11-20', netto: 300, brutto: 357, status: 'Versendet', zahlungsziel: '2026-12-04', kvId: 'kv5' },
    ],
    angebote: [
      { id: 'kv1', kundeId: 'k1', bereich: 'beratung', name: 'Beratung', status: 'offen', datum: '2026-11-01', betrag: 10_000 }, // 50 % → Jan 27
      { id: 'kv2', kundeId: 'k1', bereich: 'beratung', name: 'Zusatz', status: 'angenommen', datum: '2026-11-05', betrag: 1190, ustSatz: 19 }, // 1000 voll → Dez 26
      { id: 'kv3', kundeId: 'k2', bereich: 'erben', name: 'Testament', status: 'offen', datum: '2026-06-01', betrag: 4000 }, // ohne Chance → 0, Nov
      { id: 'kv4', kundeId: 'k3', bereich: 'beratung', name: 'Alt', status: 'offen', betrag: 9999 }, // Akte verloren → zählt nicht
      { id: 'kv5', kundeId: 'k1', bereich: 'beratung', name: 'Schon berechnet', status: 'angenommen', betrag: 300 }, // in Rechnung r4
      { id: 'kv6', kundeId: 'k1', bereich: 'beratung', name: 'Abgelehnt', status: 'abgelehnt', betrag: 5000 },
      { id: 'kv7', bereich: 'privat', privat: true, name: 'Privat', status: 'angenommen', betrag: 7777 },
    ],
    objekte: [
      { id: 'o1', name: 'MFH Ulm', status: 'reserviert', kaufpreis: 1_000_000, freigaben: [{ provision: '3,57 % inkl. MwSt.', status: 'zugestimmt' }] }, // 30.000 × 50 % → Jan 27
      { id: 'o2', name: 'ETW Neu-Ulm', status: 'beurkundet', kaufpreis: 400_000, kurzpruefungProzent: '6' }, // 24.000 × 95 % → Nov
      { id: 'o3', name: 'Acker', status: 'akquise', kaufpreis: 100_000 }, // zählt nicht
      { id: 'o4', name: 'Verkauft', status: 'verkauft', kaufpreis: 100_000 }, // zählt nicht mehr
      { id: 'o5', name: 'Ohne Preis', status: 'notartermin', kaufpreis: 0 },
      { id: 'o6', name: 'Privat', status: 'beurkundet', kaufpreis: 100_000, privat: true },
    ],
  }
}

Deno.test('Regeln (a)–(d) im Monat, Quartal und Jahr', () => {
  const v = berechneUmsatzvorschau(beispiel())
  const nov = summen(v, zeitraum('monat', v.heute))
  assertEquals(nov.berechnet, 1300) // r1 + r4
  assertEquals(nov.eingegangen, 500) // 595 brutto von r1 → 500 netto
  assertEquals(nov.entwuerfe, 500) // r3 (Oktober-Datum → frühestens jetzt)
  assertEquals(nov.angebote, 0) // kv3 ohne Chance
  assertEquals(nov.angeboteUngewichtet, 4000)
  assertEquals(nov.provision, 22_800) // o2: 24.000 × 95 %; o5 ohne Preis
  assertEquals(nov.erwartet, 1300 + 500 + 22_800)

  const q4 = summen(v, zeitraum('quartal', v.heute))
  assertEquals(q4.angebote, 1000) // kv2 im Dezember
  assertEquals(q4.provision, 22_800) // o1 erst im Januar

  const jahr = summen(v, zeitraum('jahr', v.heute))
  assertEquals(jahr.berechnet, 3300) // mit r2 aus August
  assertEquals(jahr.eingegangen, 2500)

  const jan = summen(v, { von: '2027-01', bis: '2027-01' })
  assertEquals(jan.angebote, 5000)
  assertEquals(jan.provision, 15_000)

  // Nicht dabei: verlorene Akte, schon berechnetes und abgelehntes Angebot, private Einträge, Akquise, Verkauft.
  const ids = v.posten.map((p) => p.id)
  for (const weg of ['kv4', 'kv5', 'kv6', 'kv7', 'o3', 'o4', 'o6']) assert(!ids.includes(weg), weg)

  // (b) offene Rechnungen: r1 Rest 595 brutto, Frist vorbei → überfällig; r4 noch nicht fällig.
  const o = offeneSumme(v)
  assertEquals(o.anzahl, 2)
  assertEquals(o.ueberfaelligNetto, 500)
  assertEquals(o.anzahlUeberfaellig, 1)
  assertEquals(v.offene.find((x) => x.id === 'r1')?.tageUeberfaellig, 5)

  assertEquals(v.hinweise.angeboteOhneChance, 1)
  assertEquals(v.hinweise.objekteOhnePreis, 1)
  assertEquals(v.hinweise.aktenMitChanceOhneAngebot, 1) // k4: Chance, aber kein Angebot (k3 ist verloren)

  const jb = summenJeBereich(v, zeitraum('jahr', v.heute)).map((x) => x.bereich)
  assertEquals(jb, ['beratung', 'immobilien', 'erben'])

  const top = groesstePosten(v, zeitraum('jahr', v.heute), ['provision'])
  assertEquals(top[0].id, 'o2')
  assertStringIncludes(top[0].warum, 'Beurkundet: 95 %')
  assertStringIncludes(top[0].warum, 'Kurzprüfung')

  const monate = jeMonat(v, '2026-10', '2027-01')
  assertEquals(monate.map((m) => m.monat), ['2026-10', '2026-11', '2026-12', '2027-01'])
  assertEquals(monate[3].erwartet, 20_000)
})

Deno.test('Rechte: nur freigegebene Bereiche', () => {
  const v = berechneUmsatzvorschau(beispiel(), { darf: (b) => b === 'erben' })
  assert(v.posten.every((p) => p.bereich === 'erben'))
  assertEquals(v.offene.length, 0)
  assertEquals(summen(v, zeitraum('jahr', v.heute)).provision, 0)
})

Deno.test('Kurzbericht nennt Summen, Posten und Lücken', () => {
  const v = berechneUmsatzvorschau(beispiel())
  const t = kurzbericht(v, 'monat')
  assertStringIncludes(t, 'Umsatzvorschau November 2026')
  assertStringIncludes(t, 'Erwartet gesamt: 24.600 €')
  assertStringIncludes(t, 'ETW Neu-Ulm')
  assertStringIncludes(t, 'ohne Chance zählen nicht mit')
  const nurErben = kurzbericht(v, 'jahr', 'erben')
  assert(!nurErben.includes('Immobilien-Provision'))
})

// ─── Werkzeug mit nachgebauter Datenbank ─────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

function falscheDb(tabellen: Record<string, Zeile[]>) {
  const abgefragt: string[] = []
  function abfrage(tabelle: string) {
    abgefragt.push(tabelle)
    const filter: ((z: Zeile) => boolean)[] = []
    const q = {
      select: () => q,
      eq: (s: string, w: unknown) => (filter.push((z) => z[s] === w), q),
      neq: (s: string, w: unknown) => (filter.push((z) => z[s] !== w), q),
      in: (s: string, w: unknown[]) => (filter.push((z) => w.includes(z[s])), q),
      // deno-lint-ignore no-explicit-any
      then: (ok: (r: any) => unknown, nein?: (e: unknown) => unknown) =>
        Promise.resolve({ data: (tabellen[tabelle] ?? []).filter((z) => filter.every((f) => f(z))).map((z) => ({ ...z })), error: null }).then(ok, nein),
    }
    return q
  }
  return { supabase: { from: abfrage }, abgefragt }
}

function db() {
  return falscheDb({
    kunden: [
      { id: 'k1', bereich: 'beratung', firma: 'Bäckerei Brot', ansprechpartner: '', status: 'angebot', auftrag_chance: { prozent: 50, bestaetigt: true }, verantwortlich_email: null },
      { id: 'k2', bereich: 'erben', firma: 'Familie Muster', ansprechpartner: '', status: 'konzept_erstellt', auftrag_chance: { prozent: 80, bestaetigt: false }, verantwortlich_email: null },
      { id: 'kp', bereich: 'privat', firma: 'Privatkontakt', ansprechpartner: '', status: 'neu', auftrag_chance: null, verantwortlich_email: 'x@y.de' },
    ],
    kostenvoranschlaege: [
      { id: 'kv1', kunde_id: 'k1', bereich: 'beratung', privat_besitzer: null, name: 'Beratung', beschreibung: '', betrag: 10000, status: 'offen', datum: '2026-10-01', positionen: null, aufschlag_prozent: null, ust_satz: null, erstellt_am: '2026-10-01' },
      { id: 'kv2', kunde_id: 'k2', bereich: 'erben', privat_besitzer: null, name: 'Testament', beschreibung: '', betrag: 2000, status: 'offen', datum: '2026-10-01', positionen: null, aufschlag_prozent: null, ust_satz: null, erstellt_am: '2026-10-01' },
      { id: 'kv3', kunde_id: 'kp', bereich: 'privat', privat_besitzer: 'x@y.de', name: 'Privat', beschreibung: '', betrag: 99999, status: 'angenommen', datum: '2026-11-01', positionen: null, aufschlag_prozent: null, ust_satz: null, erstellt_am: '2026-11-01' },
    ],
    rechnungen: [
      { id: 'r1', nummer: 'RE-2026-001', kunde_id: 'k1', datum: '2026-11-03', betrag_netto: 1000, betrag_brutto: 1190, status: 'Versendet', zahlungsziel: '2026-12-03', mahnstufe: null, zahlungen: [], mahnungen: [], bezahlt_am: null, kv_id: null },
      { id: 'r2', nummer: 'RE-2026-002', kunde_id: 'kp', datum: '2026-11-03', betrag_netto: 5000, betrag_brutto: 5950, status: 'Versendet', zahlungsziel: '2026-12-03', mahnstufe: null, zahlungen: [], mahnungen: [], bezahlt_am: null, kv_id: null },
    ],
    objekte: [
      { id: 'o1', bezeichnung: 'ETW', adresse: 'Ulm', kaufpreis: 400000, status: 'beurkundet', verkaufsdaten: null, kurzpruefung: null, privat_besitzer: null },
      { id: 'o2', bezeichnung: 'Privat-ETW', adresse: 'Ulm', kaufpreis: 400000, status: 'beurkundet', verkaufsdaten: null, kurzpruefung: null, privat_besitzer: 'x@y.de' },
    ],
    abteilung_eintraege: [{ art: 'abrechnung', daten: { objektId: 'o1', provision: 20000 } }],
    objekt_freigaben: [],
  })
}

function kontext(supabase: unknown, mitarbeiter: UmsatzKontext['mitarbeiter']): UmsatzKontext {
  return { supabase, mitarbeiter, protokolliere: () => {}, heute: '2026-11-22' }
}

const GF = { name: 'Andreas', email: 'a@m.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }
const ERBEN = { name: 'Erna', email: 'e@m.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['erben'] }

Deno.test('Werkzeug: Geschäftsführung sieht alles außer Privatem', async () => {
  const { supabase } = db()
  const t = await fuehreUmsatzWerkzeugAus('umsatz_vorschau', { zeitraum: 'monat' }, kontext(supabase, GF))
  // Rechnung r1 1.000 + Provision o1 20.000 × 95 % = 19.000 (Abrechnung); private Rechnung/Objekt/Angebot nicht.
  assertStringIncludes(t, 'schon in Rechnung gestellt: 1.000 €')
  assertStringIncludes(t, 'Immobilien-Provision nach Stand: 19.000 €')
  assertStringIncludes(t, 'Erwartet gesamt: 20.000 €')
  assert(!t.includes('Privat'))
  const q = await fuehreUmsatzWerkzeugAus('umsatz_vorschau', { zeitraum: 'quartal' }, kontext(supabase, GF))
  // kv1 10.000 × 50 % und kv2 2.000 × 80 % im Dezember
  assertStringIncludes(q, 'Angebote nach Chance: 6.600 €')
  assertStringIncludes(q, '(Vorschlag, noch nicht bestätigt)')
})

Deno.test('Werkzeug: eingeschränkter Mitarbeiter sieht nur seinen Bereich', async () => {
  const { supabase, abgefragt } = db()
  const t = await fuehreUmsatzWerkzeugAus('umsatz_vorschau', { zeitraum: 'quartal' }, kontext(supabase, ERBEN))
  assertStringIncludes(t, 'Angebote nach Chance: 1.600 €')
  assertStringIncludes(t, 'schon in Rechnung gestellt: 0 €')
  assert(!t.includes('Bäckerei'))
  assert(!abgefragt.includes('rechnungen'))
  assert(!abgefragt.includes('objekte'))
  const nein = await fuehreUmsatzWerkzeugAus('umsatz_vorschau', { bereich: 'Immobilien' }, kontext(supabase, ERBEN))
  assertStringIncludes(nein, 'Nicht freigegeben')
})

Deno.test('Werkzeug: Bereich nach Name, unbekannter Bereich, privater Assistent', async () => {
  assertEquals(bereichAusEingabe('Unternehmensberatung'), 'beratung')
  assertEquals(bereichAusEingabe('immobilienkunden'), 'immobilien')
  assertEquals(bereichAusEingabe('Immobilien'), 'immobilien')
  assertEquals(bereichAusEingabe('Betriebsübergabe'), 'betriebsuebergabe')
  assertEquals(bereichAusEingabe('Mond'), undefined)
  const { supabase } = db()
  assertStringIncludes(await fuehreUmsatzWerkzeugAus('umsatz_vorschau', { bereich: 'Mond' }, kontext(supabase, GF)), 'kenne ich nicht')
  assertStringIncludes(await fuehreUmsatzWerkzeugAus('umsatz_vorschau', {}, kontext(supabase, { ...GF, nurPrivat: true })), 'privaten Assistenten')
  const nurImmo = await fuehreUmsatzWerkzeugAus('umsatz_vorschau', { zeitraum: 'jahr', bereich: 'immobilien' }, kontext(supabase, GF))
  assertStringIncludes(nurImmo, '(Immobilien)')
  assertStringIncludes(nurImmo, 'Provision aus der Abrechnung')
})
