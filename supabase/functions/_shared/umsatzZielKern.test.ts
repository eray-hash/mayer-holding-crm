// Umsatzziele: Sparten-Zuordnung, Ist je Sparte und Monat, Soll bis heute, Trichter und nötige Leads.
import { assertEquals, assert } from 'jsr:@std/assert@1'
import {
  berechneTrichter, berechneZielStand, bereicheDerSparte, enthaeltStichwort, fehlendeSollZeilen, kurzMeldung, leseStatuswechsel,
  sollImMonat, sparteDesBereichs, sparteFuer, spartenAusZeilen, VORGABE_SPARTEN, verlorenMonat, werktageAb, zeitlage,
  type SparteRegel, type TrichterDaten, type ZielEingabe,
} from './umsatzZielKern.ts'

const HEUTE = '2026-11-24'
const S = VORGABE_SPARTEN

Deno.test('Stichwort nur als eigenes Wort', () => {
  assertEquals(enthaeltStichwort('Seminar KI-Manager (2 Tage)', ['KI']), 'KI')
  assertEquals(enthaeltStichwort('Beratung ki', ['KI']), 'KI')
  assertEquals(enthaeltStichwort('Kiste und Kissen', ['KI']), undefined)
  assertEquals(enthaeltStichwort('Workshop Künstliche  Intelligenz', ['künstliche Intelligenz']), 'künstliche Intelligenz')
})

Deno.test('Zuordnung: KI über Bereich, Stichwort nur wenn eingeschaltet', () => {
  assertEquals(sparteFuer(S, { art: 'rechnung', bereich: 'akademie', text: 'KI-Manager Seminar' }), 'beratung')
  assertEquals(sparteFuer(S, { art: 'rechnung', bereich: 'ki' }), 'ki')
  const mitStichwort: SparteRegel[] = S.map((s) => (s.id === 'ki' ? { ...s, stichwortAktiv: true } : s))
  assertEquals(sparteFuer(mitStichwort, { art: 'rechnung', bereich: 'akademie', text: 'KI-Manager Seminar' }), 'ki')
  assertEquals(sparteFuer(S, { art: 'provision', bereich: 'immobilien' }), 'immobilien')
  assertEquals(sparteFuer(S, { art: 'rechnung', bereich: 'immobilien' }), 'immobilien') // Kennung aus der Umsatzvorschau
  assertEquals(sparteFuer(S, { art: 'rechnung', bereich: 'ohne' }), 'beratung')
  assertEquals(sparteFuer(S.filter((s) => !s.rest), { art: 'rechnung', bereich: 'erben' }), undefined)
})

Deno.test('Sparten aus Zeilen, sonst Vorgabe; Soll je Monat', () => {
  assertEquals(spartenAusZeilen(null).map((s) => s.id), ['ki', 'immobilien', 'beratung', 'fahrschule'])
  const z = spartenAusZeilen([{ id: 'x', name: 'X', reihenfolge: 2, soll_vorgabe: 5, bereiche: ['erben'], rest: true }, { id: 'a', name: 'A', reihenfolge: 1, soll_vorgabe: '7' }])
  assertEquals(z.map((s) => [s.id, s.sollVorgabe, s.rest]), [['a', 7, false], ['x', 5, true]])
  const soll = sollImMonat(S, [{ monat: '2026-11', sparte: 'ki', sollNetto: 0 }], '2026-11')
  assertEquals([soll.ki.soll, soll.ki.ausVorgabe, soll.immobilien.soll, soll.immobilien.ausVorgabe], [0, false, 15000, true])
  assertEquals(fehlendeSollZeilen(S, [{ monat: '2026-11', sparte: 'ki', sollNetto: 0 }], '2026-11').map((x) => [x.sparte, x.sollNetto]), [['immobilien', 15000], ['beratung', 25000], ['fahrschule', 5000]])
})

Deno.test('Zeit: Werktage und Lage', () => {
  assertEquals(werktageAb('2026-11', 24), 5) // Di 24. bis Mo 30.: Di, Mi, Do, Fr, Mo
  assertEquals(zeitlage('2026-11', HEUTE), { lage: 'laufend', vergangeneTage: 24, verbleibendeWerktage: 5, tage: 30 })
  assertEquals(zeitlage('2026-10', HEUTE).lage, 'vorbei')
  assertEquals(zeitlage('2026-12', HEUTE).vergangeneTage, 0)
})

function eingabe(): ZielEingabe {
  return {
    heute: HEUTE,
    sparten: S,
    soll: [],
    vorhandeneBereiche: ['beratung', 'immobilienkunden', 'akademie'],
    texte: { r3: 'R-3 KI-Manager Seminar' },
    umsatz: {
      heute: HEUTE,
      rechnungen: [
        // bezahlt im November (Teilzahlung 1190 brutto = 1000 netto), Rest 1190 brutto offen
        { id: 'r1', nummer: 'R-1', kundeId: 'k1', bereich: 'beratung', datum: '2026-11-03', netto: 2000, brutto: 2380, status: 'Versendet', zahlungen: [{ datum: '2026-11-10', betrag: 1190 }] },
        // Oktober-Rechnung, im November bezahlt → bezahlt November, nicht offen
        { id: 'r2', nummer: 'R-2', kundeId: 'k2', bereich: 'immobilienkunden', datum: '2026-10-20', netto: 5000, brutto: 5950, status: 'Bezahlt', bezahltAm: '2026-11-05' },
        // Akademie mit KI im Text: zählt zu Beratung (Stichwort aus)
        { id: 'r3', nummer: 'R-3', kundeId: 'k3', bereich: 'akademie', datum: '2026-11-12', netto: 800, brutto: 952, status: 'Bezahlt', bezahltAm: '2026-11-12' },
        // Entwurf → erwartet
        { id: 'r4', nummer: 'E-1', kundeId: 'k1', bereich: 'beratung', datum: '2026-11-20', netto: 300, brutto: 357, status: 'Entwurf' },
      ],
      angebote: [],
      akten: [{ id: 'k5', bereich: 'erben', name: 'Schätzung', status: 'konzept_erstellt', chance: 50, erwartetNetto: 4000, erwartetMonat: '2026-11' }],
      objekte: [{ id: 'o1', name: 'Haus', status: 'notartermin', kaufpreis: 500000, kurzpruefungProzent: '3' }],
    },
  }
}

Deno.test('Ist je Sparte: bezahlt, offen, erwartet, Soll bis heute', () => {
  const z = berechneZielStand(eingabe(), '2026-11')
  const b = z.sparten.find((s) => s.sparte === 'beratung')!
  const i = z.sparten.find((s) => s.sparte === 'immobilien')!
  const k = z.sparten.find((s) => s.sparte === 'ki')!
  assertEquals([b.bezahlt, b.offen, b.erwartet], [1800, 1000, 2300]) // 1000 + 800; Rest r1; Entwurf 300 + Schätzung 2000
  assertEquals([i.bezahlt, i.offen, i.erwartet], [5000, 0, 12000]) // Provision 15.000 × 80 %
  assertEquals([k.bezahlt, k.soll], [0, 10000])
  assert(k.hinweis?.includes('Bereich KI wird noch eingerichtet'))
  assertEquals(z.gesamt.soll, 55000)
  assertEquals(z.gesamt.bezahlt, 6800)
  assertEquals(z.gesamt.sollBisHeute, 44000) // 55.000 × 24/30
  assertEquals(z.gesamt.abstand, -37200)
  assertEquals(z.gesamt.prozent, 12)
  assertEquals(z.gesamt.hochrechnung, 6800 + 1000 + 14300)
  assertEquals(z.gesamt.noetigProWerktag, Math.round(((55000 - 7800) / 5) * 100) / 100)
  assertEquals(kurzMeldung(z), 'Umsatzziel November: 6.800 von 55.000 € (12 %), Soll bis heute 44.000 € — Rückstand 37.200 €. KI 0/10.000, Immobilien 5.000/15.000, Beratung 1.800/25.000, Fahrschule 0/5.000.')
  // Oktober: nur was im Oktober eingegangen ist (nichts), r2 ist nicht mehr offen
  const okt = berechneZielStand(eingabe(), '2026-10')
  assertEquals([okt.gesamt.bezahlt, okt.gesamt.offen, okt.gesamt.erwartet, okt.gesamt.sollBisHeute], [0, 0, 0, 55000])
})

Deno.test('KI-Stichwort eingeschaltet: Akademie-Rechnung zählt bei KI', () => {
  const e = eingabe()
  e.sparten = S.map((s) => (s.id === 'ki' ? { ...s, stichwortAktiv: true } : s))
  const z = berechneZielStand(e, '2026-11')
  assertEquals(z.sparten.find((s) => s.sparte === 'ki')!.bezahlt, 800)
  assertEquals(z.sparten.find((s) => s.sparte === 'ki')!.hinweis, undefined)
})

Deno.test('Statuswechsel und Verloren-Monat', () => {
  assertEquals(leseStatuswechsel('Status: Lead / Neuanfrage → Erstgespräch terminiert am 2026-11-13 durch X'), { von: 'Lead / Neuanfrage', nach: 'Erstgespräch terminiert' })
  assertEquals(verlorenMonat({ id: 'a', bereich: 'beratung', status: 'verloren', verlorenAm: '2026-10-02' }), '2026-10')
  assertEquals(verlorenMonat({ id: 'a', bereich: 'beratung', status: 'verloren', activities: [{ date: '2026-11-03', text: 'Status: Lead / Neuanfrage → Verloren / Kein Interesse am 2026-11-03 durch X' }, { date: '2026-11-20', text: 'Notiz' }] }), '2026-11')
  assertEquals(verlorenMonat({ id: 'a', bereich: 'beratung', status: 'verloren', activities: [{ date: '2026-09-01', text: 'angelegt' }] }), '2026-09')
  assertEquals(verlorenMonat({ id: 'a', bereich: 'beratung', status: 'lead', activities: [{ date: '2026-11-03', text: 'Status: Lead → Verloren / Kein Interesse' }] }), undefined)
})

function trichterDaten(): TrichterDaten {
  const akten = []
  // 10 Leads im November in der Beratung, 6 davon mit Auftrag (erste Rechnung im November), 1 verloren
  for (let n = 1; n <= 10; n++) {
    akten.push({ id: `b${n}`, bereich: 'beratung', status: n === 10 ? 'verloren' : 'lead', activities: [{ date: '2026-11-02', text: 'Akte angelegt' }, ...(n === 10 ? [{ date: '2026-11-15', text: 'Status: Lead / Neuanfrage → Verloren / Kein Interesse am 2026-11-15 durch X' }] : [])] })
  }
  akten.push({ id: 'k_intern_holding', bereich: 'beratung', status: 'lead', activities: [{ date: '2026-11-02', text: 'x' }] })
  akten.push({ id: 'i1', bereich: 'immobilienkunden', status: 'interessent', activities: [{ date: '2026-11-04', text: 'angelegt' }] })
  akten.push({ id: 'f1', bereich: 'finanzierungen', status: 'interessent', activities: [{ date: '2026-11-04', text: 'angelegt' }] })
  return {
    akten,
    termine: [{ kundeId: 'b1', beginn: '2026-11-05T10:00:00Z' }, { kundeId: 'b1', beginn: '2026-11-06T10:00:00Z' }, { kundeId: 'b2', beginn: '2026-11-07T10:00:00Z' }],
    besichtigungen: [{ kundeId: 'i1', kundeBereich: 'immobilienkunden', beginn: '2026-11-08T10:00:00Z', status: 'durchgefuehrt' }, { kundeId: 'i1', beginn: '2026-11-09T10:00:00Z', status: 'abgesagt' }],
    angebote: [{ id: 'kv1', kundeId: 'b3', status: 'offen', datum: '2026-11-10' }, { id: 'kv2', kundeId: 'b4', status: 'angenommen', datum: '2026-11-11' }, { id: 'kv3', kundeId: 'b4', status: 'offen', datum: '2026-10-11' }],
    rechnungen: [1, 2, 3, 5, 6].map((n) => ({ id: `r${n}`, kundeId: `b${n}`, datum: '2026-11-20', status: 'Versendet', netto: 2000 })).concat([{ id: 'rx', kundeId: 'b1', datum: '2026-11-25', status: 'Versendet', netto: 1000 }]),
    objekte: [{ id: 'o1', activities: [{ date: '2026-11-12', text: 'Status: Aktiv in Vermarktung → Reserviert am 2026-11-12 durch X' }, { date: '2026-11-20', text: 'Status: Notartermin → Beurkundet am 2026-11-20 durch X' }] }],
    investoren: [{ id: 'inv1', seit: '2026-11-01' }],
  }
}

Deno.test('Trichter Beratung: Stufen, Quoten, Ø Auftragswert, nötige Leads', () => {
  const t = berechneTrichter(trichterDaten(), '2026-11', ['beratung'], { soll: 25000 })
  assertEquals(t.art, 'beratung')
  assertEquals(t.monatZahlen.stufen.map((s) => s.anzahl), [10, 2, 2, 6]) // Aufträge: b1,b2,b3,b5,b6 (Rechnung) + b4 (KV angenommen)
  assertEquals(t.monatZahlen.verloren, 1)
  assertEquals(t.basis.durchschnittAuftrag, 2200) // (3000 + 4 × 2000) / 5
  assertEquals(t.basis.abschlussquote, 0.6)
  assertEquals(t.leadsNoetig, Math.ceil(25000 / (2200 * 0.6)))
  assertEquals(t.basis.verlustquote, 1 / 7)
  assertEquals(t.hinweis, undefined)
})

Deno.test('Trichter Immobilien und zu wenig Daten', () => {
  const t = berechneTrichter(trichterDaten(), '2026-11', ['immobilien'], { soll: 15000 })
  assertEquals(t.art, 'immobilien')
  assertEquals(t.monatZahlen.stufen.map((s) => [s.id, s.anzahl]), [['leads', 1], ['besichtigungen', 1], ['reserviert', 1], ['auftraege', 1]])
  assertEquals(t.leadsNoetig, undefined)
  assert(t.hinweis?.startsWith('Zu wenig Daten'))
  const f = berechneTrichter(trichterDaten(), '2026-11', ['finanzierungen'])
  assertEquals(f.monatZahlen.neueInvestoren, 2)
})

Deno.test('Bereiche der Sparten und Sparte einer Abteilung', () => {
  assertEquals(bereicheDerSparte(S, 'immobilien'), ['immobilienkunden'])
  assert(bereicheDerSparte(S, 'beratung').includes('erben'))
  assert(!bereicheDerSparte(S, 'beratung').includes('ki'))
  assertEquals(sparteDesBereichs(S, 'immobilien'), 'immobilien')
  assertEquals(sparteDesBereichs(S, 'erben'), 'beratung')
  assertEquals(sparteDesBereichs(S, 'ki'), 'ki')
})
