// Prüft die Zahlungs-Werkzeuge mit einer nachgebauten Datenbank (ohne Netz): Rechenregeln wie im CRM
// (Teilzahlung, volle Zahlung, Cent-Rundung, Überzahlung nur mit Bestätigung), Rechte (Zeilenregel
// darf_bereich('beratung') plus Akte), Vermerk im Verlauf, Liste der offenen Rechnungen.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { berechneZahlung, darfRechnungen, fuehreRechnungZahlungWerkzeugAus, offenerBetrag, type ZahlungsErgebnis } from './rechnungZahlungWerkzeuge.ts'

const gf = { name: 'Andreas Mayer', email: 'gf@x.de', rolle: 'geschaeftsfuehrung', bereiche: [] as string[] }
const berater = { name: 'Bernd Berater', email: 'b@x.de', rolle: 'mitarbeiter', bereiche: ['beratung'] }
const quirin = { name: 'Quirin Lang', email: 'q@x.de', rolle: 'mitarbeiter', bereiche: ['immobilien'] }

function rechnung(z: Partial<Zeile> = {}): Zeile {
  return {
    id: 'r_1', nummer: 'RE-2026-010', kunde_id: 'k_1', datum: '2026-11-01', betrag_netto: 1000, betrag_brutto: 1190, status: 'Versendet',
    zahlungsziel: '2026-11-15', mahnstufe: null, zahlungen: null, mahnungen: null, versendet_am: '2026-11-01', bezahlt_am: null,
    ...z,
  }
}

const grunddaten = () => ({
  rechnungen: [
    rechnung(),
    rechnung({ id: 'r_2', nummer: 'RE-2026-011', zahlungsziel: '2026-12-01', betrag_brutto: 500, zahlungen: [{ id: 'zahl_a', datum: '2026-11-10', betrag: 200 }] }),
    rechnung({ id: 'r_3', nummer: 'RE-2026-012', mahnstufe: 'mahnung1', status: 'Überfällig', zahlungsziel: '2026-10-01', mahnungen: [{ id: 'm1', datum: '2026-11-05', stufe: 'mahnung1', gebuehr: 5, neueFrist: '2026-11-19' }] }),
    rechnung({ id: 'r_bez', nummer: 'RE-2026-001', status: 'Bezahlt', bezahlt_am: '2026-10-10' }),
    rechnung({ id: 'r_entw', nummer: 'RE-2026-013', status: 'Entwurf' }),
    rechnung({ id: 'r_erben', nummer: 'RE-2026-020', kunde_id: 'k_erben' }),
    rechnung({ id: 'r_priv', nummer: 'RE-2026-030', kunde_id: 'k_priv' }),
  ],
  kunden: [
    { id: 'k_1', bereich: 'beratung', firma: 'Bäckerei Brot GmbH', ansprechpartner: 'Herr Brot', verantwortlich_email: null, activities: [{ id: 'act_alt', date: '2026-11-01', text: 'alt', user: 'x' }] },
    { id: 'k_erben', bereich: 'erben', firma: 'Erbengemeinschaft Huber', ansprechpartner: null, verantwortlich_email: null, activities: [] },
    { id: 'k_priv', bereich: 'privat', firma: 'Hasans Nachbar', ansprechpartner: null, verantwortlich_email: 'h@x.de', activities: [] },
  ],
})

function umgebung(tabellen: Record<string, Zeile[]>, mitarbeiter: Zeile = gf) {
  const db = falscheDatenbank(tabellen)
  const geschrieben: { tabelle: string; werte: Zeile }[] = []
  const supabase = {
    from(t: string) {
      const q = db.from(t)
      const upd = q.update.bind(q)
      q.update = (w: Zeile) => (geschrieben.push({ tabelle: t, werte: structuredClone(w) }), upd(w))
      return q
    },
  }
  const protokoll: string[] = []
  // deno-lint-ignore no-explicit-any
  const ctx = { supabase, mitarbeiter: mitarbeiter as any, protokolliere: (s: string) => protokoll.push(s), heute: '2026-11-22' }
  return { db, geschrieben, protokoll, ctx }
}

// ---------------------------------------------------------------------------------------------
// Rechenregeln

const r0 = { nummer: 'RE-1', status: 'Versendet', betrag_brutto: 1190, zahlungen: null }

Deno.test('Zahlung: Teilzahlung hängt an, Status bleibt, offener Rest stimmt', () => {
  const e = berechneZahlung(r0, { betrag: 500, datum: '2026-11-20', von: 'A', id: 'zahl_x' }) as ZahlungsErgebnis
  assertEquals(e.vollstaendig, false)
  assertEquals(e.offenVorher, 1190)
  assertEquals(e.offenNachher, 690)
  assertEquals(e.aenderung, { zahlungen: [{ id: 'zahl_x', datum: '2026-11-20', betrag: 500, erfasstVon: 'A' }] })
  assertEquals(e.vermerk, 'Teilzahlung über 500,00 € zu Rechnung RE-1 erfasst (noch offen: 690,00 €)')
})

Deno.test('Zahlung: volle Zahlung → Bezahlt, bezahlt_am, Mahnstufe weg', () => {
  const r = { ...r0, zahlungen: [{ id: 'z1', datum: '2026-11-10', betrag: 690 }] }
  const e = berechneZahlung(r, { betrag: 500, datum: '2026-11-21', notiz: ' Überweisung ', von: 'A', id: 'zahl_y' }) as ZahlungsErgebnis
  assertEquals(e.vollstaendig, true)
  assertEquals(e.offenNachher, 0)
  assertEquals(e.aenderung.status, 'Bezahlt')
  assertEquals(e.aenderung.bezahlt_am, '2026-11-21')
  assertEquals(e.aenderung.mahnstufe, null)
  assertEquals((e.aenderung.zahlungen as Zeile[]).length, 2)
  assertEquals((e.aenderung.zahlungen as Zeile[])[1], { id: 'zahl_y', datum: '2026-11-21', betrag: 500, notiz: 'Überweisung', erfasstVon: 'A' })
  assertEquals(e.vermerk, 'Zahlung über 500,00 € zu Rechnung RE-1 erfasst — Rechnung vollständig bezahlt')
})

Deno.test('Zahlung: Cent-Rundung — 3 × 33,33 € auf 100 € ist nicht voll, Rest 0,01 €; halber Cent Toleranz', () => {
  const r = { ...r0, betrag_brutto: 100, zahlungen: [{ id: 'a', datum: 'x', betrag: 33.33 }, { id: 'b', datum: 'x', betrag: 33.33 }] }
  const e = berechneZahlung(r, { betrag: 33.33, datum: '2026-11-21', von: 'A' }) as ZahlungsErgebnis
  assertEquals(e.vollstaendig, false)
  assertEquals(e.offenNachher, 0.01)
  const f = berechneZahlung({ ...r0, betrag_brutto: '0.30', zahlungen: [{ id: 'a', datum: 'x', betrag: 0.1 }] }, { betrag: 0.2, datum: '2026-11-21', von: 'A' }) as ZahlungsErgebnis
  assertEquals(f.vollstaendig, true, '0,1 + 0,2 = 0,30 trotz Gleitkomma')
})

Deno.test('Zahlung: Überzahlung ohne Bestätigung abgelehnt, mit Bestätigung erfasst und genannt', () => {
  const nein = berechneZahlung(r0, { betrag: 1200, datum: '2026-11-21', von: 'A' })
  assert(typeof nein === 'string' && nein.startsWith('Fehler: Der Betrag 1.200,00 € ist höher als der noch offene Rest von 1.190,00 €'), String(nein))
  const ja = berechneZahlung(r0, { betrag: 1200, datum: '2026-11-21', von: 'A', ueberzahlungBestaetigt: true }) as ZahlungsErgebnis
  assertEquals(ja.vollstaendig, true)
  assertEquals(ja.ueberzahlung, 10)
})

Deno.test('Zahlung: bezahlte Rechnung und Betrag ≤ 0 abgelehnt; Entwurf wird bei Teilzahlung „Versendet“', () => {
  assert(String(berechneZahlung({ ...r0, status: 'Bezahlt' }, { betrag: 10, datum: 'd', von: 'A' })).includes('schon als bezahlt'))
  assert(String(berechneZahlung(r0, { betrag: 0, datum: 'd', von: 'A' })).startsWith('Fehler'))
  assert(String(berechneZahlung(r0, { betrag: NaN, datum: 'd', von: 'A' })).startsWith('Fehler'))
  const e = berechneZahlung({ ...r0, status: 'Entwurf' }, { betrag: 100, datum: 'd', von: 'A' }) as ZahlungsErgebnis
  assertEquals(e.aenderung.status, 'Versendet')
  assertEquals(offenerBetrag({ status: 'Bezahlt', betrag_brutto: 100, zahlungen: null }), 0)
})

// ---------------------------------------------------------------------------------------------
// Rechte

Deno.test('Rechte: ohne Unternehmensberatung keine Rechnungen (Zeilenregel), privater Assistent auch nicht', async () => {
  assertEquals(darfRechnungen(gf), true)
  assertEquals(darfRechnungen(berater), true)
  assertEquals(darfRechnungen(quirin), false)
  assertEquals(darfRechnungen({ ...gf, nurPrivat: true }), false)
  const u = umgebung(grunddaten(), quirin)
  for (const name of ['rechnungen_offen', 'rechnung_zahlung_erfassen']) {
    const r = await fuehreRechnungZahlungWerkzeugAus(name, { nummer: 'RE-2026-010', betrag: 10 }, u.ctx)
    assert(r.startsWith('Nicht freigegeben'), r)
    assertStringIncludes(r, 'Unternehmensberatung')
  }
  assertEquals(u.db.protokoll.length, 0)
})

Deno.test('Rechte: Akte aus fremdem Bereich „nicht freigegeben“, private Akte eines anderen „gibt es nicht“', async () => {
  const u = umgebung(grunddaten(), berater)
  const fremd = await fuehreRechnungZahlungWerkzeugAus('rechnung_zahlung_erfassen', { nummer: 'RE-2026-020', betrag: 10 }, u.ctx)
  assert(fremd.startsWith('Nicht freigegeben'), fremd)
  assertStringIncludes(fremd, 'Erben')
  const g = umgebung(grunddaten(), gf)
  const priv = await fuehreRechnungZahlungWerkzeugAus('rechnung_zahlung_erfassen', { nummer: 'RE-2026-030', betrag: 10 }, g.ctx)
  assertEquals(priv, 'Fehler: Es gibt keine erfasste Rechnung mit der Nummer RE-2026-030. Offene Rechnungen zeigt rechnungen_offen.')
  assertEquals([...u.geschrieben, ...g.geschrieben].length, 0)
})

// ---------------------------------------------------------------------------------------------
// Erfassen über das Werkzeug

Deno.test('rechnung_zahlung_erfassen: Teilzahlung über Nummer schreibt nur zahlungen, Vermerk in der Akte', async () => {
  const u = umgebung(grunddaten(), berater)
  const r = await fuehreRechnungZahlungWerkzeugAus('rechnung_zahlung_erfassen', { nummer: 're-2026-010', betrag: 190, notiz: 'Überweisung' }, u.ctx)
  assertStringIncludes(r, 'Erfasst: Zahlung über 190,00 € am 22.11.2026 zu Rechnung RE-2026-010 (Bäckerei Brot GmbH (Herr Brot), Rechnungsbetrag 1.190,00 €)')
  assertStringIncludes(r, 'Noch offen: 1.000,00 €')
  const rech = u.geschrieben.find((g) => g.tabelle === 'rechnungen')!.werte
  assertEquals(Object.keys(rech), ['zahlungen'])
  const z = (rech.zahlungen as Zeile[])[0]
  assert(String(z.id).startsWith('zahl_'))
  assertEquals([z.datum, z.betrag, z.notiz, z.erfasstVon], ['2026-11-22', 190, 'Überweisung', 'Bernd Berater'])
  const akte = u.db.tabellen.kunden[0]
  const eintrag = (akte.activities as Zeile[])[0]
  assertEquals(eintrag.text, 'Teilzahlung über 190,00 € zu Rechnung RE-2026-010 erfasst (noch offen: 1.000,00 €)')
  assertEquals(eintrag.user, 'Bernd Berater')
  assertEquals((akte.activities as Zeile[])[1].id, 'act_alt')
  assertEquals(akte.letzte_aktivitaet, '2026-11-22')
  assertEquals(u.db.tabellen.rechnungen[0].status, 'Versendet')
  assertEquals(u.protokoll.length, 1)
})

Deno.test('rechnung_zahlung_erfassen: ohne Betrag = offener Rest → Bezahlt, Mahnstufe erledigt, Mahngebühren-Hinweis', async () => {
  const u = umgebung(grunddaten())
  const r = await fuehreRechnungZahlungWerkzeugAus('rechnung_zahlung_erfassen', { rechnung_id: 'r_3', datum: '20.11.2026' }, u.ctx)
  assertStringIncludes(r, 'vollständig bezahlt und steht auf Bezahlt (bezahlt am 20.11.2026)')
  assertStringIncludes(r, 'Die Mahnstufe (1. Mahnung) ist damit erledigt')
  assertStringIncludes(r, 'Mahngebühren von 5,00 €')
  const rech = u.db.tabellen.rechnungen.find((x) => x.id === 'r_3')!
  assertEquals([rech.status, rech.bezahlt_am, rech.mahnstufe], ['Bezahlt', '2026-11-20', null])
  assertEquals((rech.zahlungen as Zeile[])[0].betrag, 1190)
})

Deno.test('rechnung_zahlung_erfassen: Überzahlung, Zukunftsdatum, bezahlte und unbekannte Rechnung', async () => {
  const u = umgebung(grunddaten())
  const ueber = await fuehreRechnungZahlungWerkzeugAus('rechnung_zahlung_erfassen', { rechnung_id: 'r_2', betrag: 400 }, u.ctx)
  assertStringIncludes(ueber, 'höher als der noch offene Rest von 300,00 €')
  assertEquals(u.geschrieben.length, 0)
  const bestaetigt = await fuehreRechnungZahlungWerkzeugAus('rechnung_zahlung_erfassen', { rechnung_id: 'r_2', betrag: 400, ueberzahlung_bestaetigt: true }, u.ctx)
  assertStringIncludes(bestaetigt, 'Achtung: Überzahlung von 100,00 €')
  assertStringIncludes(await fuehreRechnungZahlungWerkzeugAus('rechnung_zahlung_erfassen', { rechnung_id: 'r_1', betrag: 10, datum: '2026-12-01' }, u.ctx), 'liegt in der Zukunft')
  assertStringIncludes(await fuehreRechnungZahlungWerkzeugAus('rechnung_zahlung_erfassen', { nummer: 'RE-2026-001', betrag: 10 }, u.ctx), 'schon als bezahlt')
  assertStringIncludes(await fuehreRechnungZahlungWerkzeugAus('rechnung_zahlung_erfassen', { nummer: 'RE-9999' }, u.ctx), 'Fehler: Es gibt keine erfasste Rechnung')
  assertStringIncludes(await fuehreRechnungZahlungWerkzeugAus('rechnung_zahlung_erfassen', {}, u.ctx), 'Fehler: rechnung_id oder nummer angeben')
})

// ---------------------------------------------------------------------------------------------
// Offene Rechnungen

Deno.test('rechnungen_offen: offene mit gezahlt/offen/Frist/Mahnstufe, Summe, ohne Entwurf/Bezahlt/fremde Akten', async () => {
  const u = umgebung(grunddaten(), berater)
  const r = await fuehreRechnungZahlungWerkzeugAus('rechnungen_offen', {}, u.ctx)
  assertStringIncludes(r, 'Offene Rechnungen (Stand 22.11.2026): 3, zusammen offen 2.680,00 €')
  assertStringIncludes(r, 'RE-2026-011 | Bäckerei Brot GmbH (Herr Brot) | vom 01.11.2026 | Betrag 500,00 € | gezahlt 200,00 € | offen 300,00 € | Frist 01.12.2026 (fällig in 9 Tagen)')
  assertStringIncludes(r, 'Frist 19.11.2026 (seit 3 Tagen überfällig) | Mahnstufe: 1. Mahnung | Mahngebühren 5,00 €')
  assertStringIncludes(r, 'Frist 15.11.2026 (seit 7 Tagen überfällig)')
  for (const n of ['RE-2026-001', 'RE-2026-013', 'RE-2026-020', 'RE-2026-030']) assert(!r.includes(n), n)
  assert(r.indexOf('RE-2026-010') < r.indexOf('RE-2026-012') && r.indexOf('RE-2026-012') < r.indexOf('RE-2026-011'), 'älteste Frist zuerst')

  const ueber = await fuehreRechnungZahlungWerkzeugAus('rechnungen_offen', { nur_ueberfaellig: true }, u.ctx)
  assertStringIncludes(ueber, 'Überfällige Rechnungen (Stand 22.11.2026): 2')
  assert(!ueber.includes('RE-2026-011'))

  const g = umgebung(grunddaten(), gf)
  assertStringIncludes(await fuehreRechnungZahlungWerkzeugAus('rechnungen_offen', {}, g.ctx), ': 4,')
  assertStringIncludes(await fuehreRechnungZahlungWerkzeugAus('rechnungen_offen', { kunde_id: 'k_priv' }, g.ctx), 'Fehler: Es gibt keine Akte')
  assertStringIncludes(await fuehreRechnungZahlungWerkzeugAus('rechnungen_offen', { kunde_id: 'k_erben' }, u.ctx), 'Nicht freigegeben')
  assertStringIncludes(await fuehreRechnungZahlungWerkzeugAus('rechnungen_offen', { kunde_id: 'k_erben' }, g.ctx), 'Offene Rechnungen von Erbengemeinschaft Huber')
})
