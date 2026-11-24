// Prüft den Kern „Entgangene Klienten“: Gründe lesen, Eintrag bauen/lesen, Auswertung je Grund/Phase/Vermittler/
// Bereich mit Zeitraum, „Droht zu entgehen“ und den Status beim Wieder-Aufnehmen. Namen sind erfunden.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  auswertungText,
  baueVerloren,
  drohGrundText,
  drohtZuEntgehen,
  type EntgangenEintrag,
  grundLabel,
  imZeitraum,
  letzteAktivitaet,
  leseGrund,
  leseVerloren,
  phaseStufe,
  statusNachWiederAufnahme,
  verlaufTextMarkiert,
  verlaufTextWiederAufgenommen,
  vermittlerName,
  wertAusChance,
  werteAus,
  zeitraumBeginn,
} from './entgangenKern.ts'

Deno.test('leseGrund: Kennung, Bezeichnung, freier Text', () => {
  assertEquals(leseGrund('zu_teuer'), 'zu_teuer')
  assertEquals(leseGrund('Bleibt beim eigenen Steuerberater'), 'eigener_steuerberater')
  assertEquals(leseGrund('kein bedarf kein interesse'), 'kein_bedarf')
  assertEquals(leseGrund('hat sich nicht mehr gemeldet'), 'keine_rueckmeldung')
  assertEquals(leseGrund('war ihm zu teuer'), 'zu_teuer')
  assertEquals(leseGrund('geht lieber zu einem anderen Berater'), 'konkurrenz')
  assertEquals(leseGrund('Grundgebühr nie bezahlt'), 'zahlt_nicht')
  assertEquals(leseGrund('erst nächstes Jahr'), 'zeitpunkt')
  assertEquals(leseGrund(''), undefined)
  assertEquals(leseGrund('xyz'), undefined)
  assertEquals(grundLabel('konkurrenz'), 'Hat sich für Konkurrenz entschieden')
  assertEquals(grundLabel('quatsch'), 'Sonstiges')
})

Deno.test('baueVerloren/leseVerloren: bereinigt, Unbekanntes wird Sonstiges, ohne Datum nichts', () => {
  const v = baueVerloren({ grund: 'zu_teuer', notiz: '  ', am: '2026-11-24', von: 'Test Mitarbeiter', phaseVorher: 'angebot', wertNetto: '4.500,50', vermittler: ' ' })
  assertEquals(v, { grund: 'zu_teuer', am: '2026-11-24', von: 'Test Mitarbeiter', phaseVorher: 'angebot', wertNetto: 4500.5 })
  assertEquals(leseVerloren({ grund: 'unbekannt', am: '2026-10-01', von: 'X', wertNetto: 0 }), { grund: 'sonstiges', am: '2026-10-01', von: 'X' })
  assertEquals(leseVerloren({ grund: 'zu_teuer' }), undefined)
  assertEquals(leseVerloren(null), undefined)
  assertEquals(baueVerloren({ grund: 'sonstiges', am: '2026-11-24', phaseVorher: 'verloren' }).phaseVorher, undefined)
  assertEquals(wertAusChance({ prozent: 30, bestaetigt: true, umsatzNetto: 8000 }), 8000)
  assertEquals(wertAusChance({ prozent: 30 }), undefined)
  assertEquals(vermittlerName({ name: 'Beispiel Partner' }), 'Beispiel Partner')
  assertEquals(vermittlerName(null), undefined)
})

const eintraege: EntgangenEintrag[] = [
  { id: 'a', name: 'Muster GmbH', bereich: 'beratung', verloren: { grund: 'zu_teuer', am: '2026-11-20', von: 'A', phaseVorher: 'angebot', wertNetto: 5000, vermittler: 'Partner Eins' } },
  { id: 'b', name: 'Beispiel KG', bereich: 'beratung', verloren: { grund: 'zu_teuer', am: '2026-10-01', von: 'A', phaseVorher: 'lead' } },
  { id: 'c', name: 'Test AG', bereich: 'erben', verloren: { grund: 'keine_rueckmeldung', am: '2026-11-01', von: 'B', phaseVorher: 'bedarfsanalyse', wertNetto: 1200, vermittler: 'partner eins' } },
  { id: 'd', name: 'Probe UG', bereich: 'immobilienkunden', verloren: { grund: 'konkurrenz', am: '2025-12-31', von: 'B', phaseVorher: 'wiedervorlage', wertNetto: 900 } },
]

Deno.test('werteAus: Summen je Grund, Phase, Vermittler, Bereich', () => {
  const a = werteAus(eintraege, { bereichName: (b) => (b === 'beratung' ? 'Unternehmensberatung' : b) })
  assertEquals(a.anzahl, 4)
  assertEquals(a.betrag, 7100)
  assertEquals(a.ohneBetrag, 1)
  assertEquals(a.jeGrund[0], { schluessel: 'zu_teuer', label: 'Zu teuer', anzahl: 2, betrag: 5000 })
  // Phasen in Reihenfolge des Ablaufs: Erstkontakt (lead), Gespräch geführt (bedarfsanalyse), Angebot, zurückgestellt.
  assertEquals(a.jePhase.map((z) => z.label), ['1. Erstkontakt', '2. Gespräch geführt', '3. Angebot / Konzept', 'Zurückgestellt (Wiedervorlage)'])
  // Vermittler ohne Rücksicht auf Groß-/Kleinschreibung zusammengefasst.
  assertEquals(a.jeVermittler[0], { schluessel: 'partner eins', label: 'Partner Eins', anzahl: 2, betrag: 6200 })
  assertEquals(a.jeVermittler[1].label, 'Ohne Vermittler')
  assertEquals(a.jeBereich[0], { schluessel: 'beratung', label: 'Unternehmensberatung', anzahl: 2, betrag: 5000 })
})

Deno.test('werteAus: Zeitraum', () => {
  const a = werteAus(eintraege, { von: '2026-10-15', bis: '2026-11-30' })
  assertEquals(a.anzahl, 2)
  assertEquals(a.betrag, 6200)
  assert(imZeitraum('2026-01-01'))
  assert(!imZeitraum('2026-01-01', '2026-01-02'))
  assertEquals(zeitraumBeginn('30', '2026-11-24'), '2026-10-25')
  assertEquals(zeitraumBeginn('jahr', '2026-11-24'), '2026-01-01')
  assertEquals(zeitraumBeginn('alle', '2026-11-24'), undefined)
  const text = auswertungText(werteAus(eintraege))
  assertStringIncludes(text, '4 entgangene Akten')
  assertStringIncludes(text, 'Zu teuer: 2 (5.000 €)')
  assertEquals(auswertungText(werteAus([])), 'Keine entgangenen Klienten in diesem Zeitraum.')
})

Deno.test('phaseStufe: unbekannt und Endstand', () => {
  assertEquals(phaseStufe('beratung', undefined).label, 'Unbekannt')
  assertEquals(phaseStufe('beratung', 'abgeschlossen').label, 'Unbekannt')
  assertEquals(phaseStufe('beratung', 'aktives_mandat').label, '4. Auftrag läuft')
})

Deno.test('drohtZuEntgehen: Funkstille, Chance, Rechnung; nie Endstand oder privat', () => {
  const heute = '2026-11-24'
  assertEquals(drohtZuEntgehen({ bereich: 'beratung', status: 'lead', letzteAktivitaet: '2026-10-10' }, [], heute), [])
  assertEquals(drohtZuEntgehen({ bereich: 'beratung', status: 'lead', letzteAktivitaet: '2026-10-09' }, [], heute), [{ art: 'funkstille', tage: 46 }])
  assertEquals(drohtZuEntgehen({ bereich: 'erben', status: 'erstkontakt', letzteAktivitaet: heute, chanceProzent: 15 }, [], heute), [{ art: 'chance', prozent: 15 }])
  assertEquals(drohtZuEntgehen({ bereich: 'erben', status: 'erstkontakt', letzteAktivitaet: heute, chanceProzent: 20 }, [], heute), [])
  const r = drohtZuEntgehen({ bereich: 'beratung', status: 'aktives_mandat', letzteAktivitaet: heute }, [
    { status: 'Versendet', zahlungsziel: '2026-10-20', betrag: 500, nummer: 'R-1' },
    { status: 'Überfällig', zahlungsziel: '2026-09-01', betrag: 300, nummer: 'R-2' },
    { status: 'Bezahlt', zahlungsziel: '2026-01-01', betrag: 999 },
    { status: 'Entwurf', zahlungsziel: '2026-01-01', betrag: 999 },
  ], heute)
  assertEquals(r, [{ art: 'rechnung', tage: 84, betrag: 300, nummer: 'R-2' }])
  assertEquals(drohGrundText(r[0]), 'Rechnung R-2 über 300 € seit 84 Tagen überfällig')
  assertEquals(drohtZuEntgehen({ bereich: 'beratung', status: 'verloren', letzteAktivitaet: '2020-01-01' }, [], heute), [])
  assertEquals(drohtZuEntgehen({ bereich: 'beratung', status: 'abgeschlossen', chanceProzent: 0 }, [], heute), [])
  assertEquals(drohtZuEntgehen({ bereich: 'privat', status: 'neu', letzteAktivitaet: '2020-01-01' }, [], heute), [])
  assertEquals(letzteAktivitaet('2026-01-01', [{ date: '2026-03-05T10:00:00Z' }, { date: 'kaputt' }]), '2026-03-05')
  assertEquals(letzteAktivitaet(null, []), undefined)
})

Deno.test('Wieder aufnehmen: voriger Stand, sonst Wiedervorlage; Verlaufstexte', () => {
  const v = baueVerloren({ grund: 'zeitpunkt', notiz: 'Erst im Frühjahr', am: '2026-11-01', von: 'A', phaseVorher: 'konzept', wertNetto: 2000 })
  assertEquals(statusNachWiederAufnahme(v, () => true), 'konzept')
  assertEquals(statusNachWiederAufnahme(v, (s) => s === 'wiedervorlage'), 'wiedervorlage')
  assertEquals(statusNachWiederAufnahme(undefined, () => false), undefined)
  assertEquals(statusNachWiederAufnahme({ ...v, phaseVorher: 'abgeschlossen' }, () => true), 'wiedervorlage')
  assertStringIncludes(verlaufTextMarkiert(v, 'Konzeptvorstellung'), 'Grund: Zeitpunkt passt nicht (aufgeschoben) · Notiz: Erst im Frühjahr · verloren in Phase: Konzeptvorstellung · entgangen: 2.000 € netto')
  assertStringIncludes(verlaufTextWiederAufgenommen(v, 'Konzeptvorstellung'), 'war entgangen seit 01.11.2026, Grund: Zeitpunkt passt nicht')
})
