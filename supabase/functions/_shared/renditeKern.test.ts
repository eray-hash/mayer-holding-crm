// Prüft den Rendite-Kern am Beispiel „Boarding House Remstal“ (Lorch, 1.200.000 €, 590 m², 15 Appartements,
// 3,57 % Käuferprovision) mit von Hand nachgerechneten Werten, dazu Zahlen lesen, Vorbefüllen aus der Akte,
// Empfindlichkeit, Marktvergleich und das Zusammenführen des gespeicherten Stands.
import { assert, assertAlmostEquals, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  berechneRendite,
  bundeslandAusAdresse,
  empfindlichkeit,
  findeEinheiten,
  findeFlaeche,
  findeProvision,
  jahresmiete,
  leseRenditeStand,
  leseZahl,
  mischeRenditeStand,
  type RenditeEingaben,
  renditeBericht,
  renditeKurzfassung,
  vergleicheMitMarkt,
  vorschlagAusObjekt,
} from './renditeKern.ts'

const REMSTAL: RenditeEingaben = { kaufpreis: 1_200_000, flaeche: 590, einheiten: 15, miete: 12.5, mieteArt: 'qm_monat', pacht: true, maklerProzent: 3.57 }

Deno.test('Zahlen lesen: deutsche Schreibweisen, Mio, Flächen', () => {
  assertEquals(leseZahl('1.200.000'), 1_200_000)
  assertEquals(leseZahl('1.200.000 €'), 1_200_000)
  assertEquals(leseZahl('12,50'), 12.5)
  assertEquals(leseZahl('1,2 Mio'), 1_200_000)
  assertEquals(leseZahl('590 m²'), 590)
  assertEquals(leseZahl('ca. 2.033 €/m²'), 2033)
  assertEquals(leseZahl('3.57'), 3.57)
  assertEquals(leseZahl('1.234,56'), 1234.56)
  assertEquals(leseZahl('1,234.56'), 1234.56)
  assertEquals(leseZahl(''), undefined)
  assertEquals(leseZahl('keine Angabe'), undefined)
  assertEquals(leseZahl(88_500), 88_500)
})

Deno.test('Provision, Fläche und Einheiten aus dem Verlauf', () => {
  const text = 'Laut Exposé 15 Appartements, ca. 590 m² Hotelfläche (Teilungserklärung 590,34 m²), Baujahr 2005, Kaufpreis 1.200.000 € zzgl. 3,57 % Käuferprovision (rund 2.033 €/m²).'
  assertEquals(findeProvision(text), 3.57)
  assertEquals(findeFlaeche(text), 590)
  assertEquals(findeEinheiten(text), 15)
  assertEquals(findeProvision('Maklerprovision: 5,95 % inkl. MwSt.'), 5.95)
  assertEquals(findeProvision('Provision 3 % inkl. MwSt.'), 3)
  // Preise je m² und Grundstücke sind keine Fläche des Gebäudes.
  assertEquals(findeFlaeche('liegen bei 2.800 € bis 3.000 €/m²'), undefined)
  assertEquals(findeFlaeche('Grundstück 1.200 m², Wohnfläche 240 qm'), 240)
  assertEquals(findeFlaeche('1.200 m² Grundstück'), undefined)
})

Deno.test('Bundesland nur aus eindeutigen Postleitzahlen', () => {
  assertEquals(bundeslandAusAdresse('Teckstraße 62, 73547 Lorch-Weitmars'), 'BW')
  assertEquals(bundeslandAusAdresse('80331 München'), 'BY')
  assertEquals(bundeslandAusAdresse('89075 Ulm'), undefined)
  assertEquals(bundeslandAusAdresse('Vöhringen'), undefined)
})

Deno.test('Jahresmiete aus €/m², € im Monat, € im Jahr', () => {
  assertEquals(jahresmiete(12.5, 'qm_monat', 590), 88_500)
  assertEquals(jahresmiete(7_375, 'monat', undefined), 88_500)
  assertEquals(jahresmiete(88_500, 'jahr', undefined), 88_500)
  assertEquals(jahresmiete(12.5, 'qm_monat', undefined), null)
  assertEquals(jahresmiete(undefined, 'jahr', 590), null)
})

Deno.test('Boarding House Remstal ohne Darlehen: Nebenkosten, Preis je m², Faktor, Renditen', () => {
  const r = berechneRendite(REMSTAL)
  assertEquals(r.grunderwerbsteuer, 60_000)
  assertEquals(r.notarGrundbuch, 24_000)
  assertAlmostEquals(r.makler, 42_840, 1e-6)
  assertAlmostEquals(r.nebenkosten, 126_840, 1e-6)
  assertAlmostEquals(r.nebenkostenProzent, 10.57, 1e-9)
  assertAlmostEquals(r.gesamtinvestition, 1_326_840, 1e-6)
  assertAlmostEquals(r.kaufpreisJeQm!, 2033.898, 1e-3)
  assertEquals(r.kaufpreisJeEinheit, 80_000)
  assertEquals(r.jahresmieteSoll, 88_500)
  assertAlmostEquals(r.faktor!, 13.559, 1e-3)
  assertAlmostEquals(r.bruttorendite!, 7.375, 1e-9)
  // Kosten: 2 % Ausfall (1.770) + 3 % Verwaltung (2.655) + 10 €/m² Instandhaltung (5.900) = 10.325
  assertAlmostEquals(r.kostenJahr!, 10_325, 1e-6)
  assertAlmostEquals(r.reinertrag!, 78_175, 1e-6)
  assertAlmostEquals(r.nettorendite!, 5.8918, 1e-4)
  assertEquals(r.finanziert, false)
  assertEquals(r.darlehen, 0)
  assertAlmostEquals(r.cashflowJahr!, 78_175, 1e-6)
  assertAlmostEquals(r.ekRendite!, r.nettorendite!, 1e-9)
  // Break-even ohne Darlehen: nur Instandhaltung muss gedeckt sein: 5.900 ÷ 0,95 ÷ 12 ÷ 590
  assertAlmostEquals(r.breakEvenMieteJeQmMonat!, 0.8772, 1e-4)
  assert(r.annahmen.some((a) => a.includes('Grunderwerbsteuer 5,0 %') && a.includes('Bundesland angenommen')))
  assert(r.annahmen.some((a) => a.includes('Instandhaltung 10 €')))
  assertEquals(r.fehlt, [])
})

Deno.test('Obere Pachtspanne 15,50 €/m² ergibt rund 9 % brutto (wie die eingefügte Einschätzung)', () => {
  const r = berechneRendite({ ...REMSTAL, miete: 15.5 })
  assertEquals(r.jahresmieteSoll, 109_740)
  assertAlmostEquals(r.bruttorendite!, 9.145, 1e-9)
})

Deno.test('Mit Darlehen: Kapitaldienst, Cashflow, Eigenkapitalrendite, Break-even, Deckung', () => {
  const r = berechneRendite({ ...REMSTAL, bundesland: 'BW', eigenkapital: 366_840, zinsProzent: 3.8, tilgungProzent: 2 })
  assertEquals(r.finanziert, true)
  assertAlmostEquals(r.darlehen, 960_000, 1e-6)
  assertAlmostEquals(r.zinsJahr, 36_480, 1e-6)
  assertAlmostEquals(r.tilgungJahr, 19_200, 1e-6)
  assertAlmostEquals(r.kapitaldienstJahr, 55_680, 1e-6)
  assertAlmostEquals(r.cashflowJahr!, 22_495, 1e-6)
  assertAlmostEquals(r.cashflowMonat!, 1874.583, 1e-3)
  assertAlmostEquals(r.ekRendite!, 11.3660, 1e-4)
  assertAlmostEquals(r.cashflowRendite!, 6.1321, 1e-4)
  assertAlmostEquals(r.schuldendienstdeckung!, 1.404, 1e-3)
  assertAlmostEquals(r.breakEvenMieteJeQmMonat!, 9.1555, 1e-4)
  assertAlmostEquals(r.breakEvenAnteil!, 73.244, 1e-3)
  // Bundesland angegeben → keine Annahme dazu.
  assert(!r.annahmen.some((a) => a.includes('Bundesland angenommen')))
})

Deno.test('Nur Zins angegeben: Eigenkapital und Tilgung nach Vorgabe, als Annahme genannt', () => {
  const r = berechneRendite({ ...REMSTAL, zinsProzent: 4 })
  // Eigenkapital = 126.840 Nebenkosten + 20 % von 1.200.000
  assertAlmostEquals(r.eigenkapital, 366_840, 1e-6)
  assertEquals(r.tilgungProzent, 2)
  assert(r.annahmen.some((a) => a.startsWith('Eigenkapital =')))
  assert(r.annahmen.some((a) => a.includes('Tilgung')))
})

Deno.test('Fehlende Angaben: keine Miete → keine Renditen, aber Preis je m²', () => {
  const r = berechneRendite({ kaufpreis: 1_200_000, flaeche: 590 })
  assertEquals(r.bruttorendite, null)
  assertEquals(r.cashflowMonat, null)
  assertAlmostEquals(r.kaufpreisJeQm!, 2033.898, 1e-3)
  assertEquals(r.fehlt, ['Miete oder Pacht'])
  const ohneFlaeche = berechneRendite({ kaufpreis: 1_200_000, miete: 12.5, mieteArt: 'qm_monat' })
  assert(ohneFlaeche.fehlt.includes('Fläche'))
  assert(ohneFlaeche.fehlt.includes('Fläche für die Miete je m²'))
})

Deno.test('Empfindlichkeit: Miete ±10 %, Zins ±1 Punkt, Raster', () => {
  const ohne = empfindlichkeit(REMSTAL)
  assertEquals(ohne.miete.map((z) => z.aenderung), [-10, 0, 10])
  assertEquals(ohne.zins, [])
  assertEquals(ohne.raster, [])
  const e = empfindlichkeit({ ...REMSTAL, eigenkapital: 366_840, zinsProzent: 3.8, tilgungProzent: 2 })
  assertAlmostEquals(e.miete[0].cashflowMonat!, 14_087.5 / 12, 1e-6)
  assertAlmostEquals(e.miete[0].bruttorendite!, 6.6375, 1e-9)
  assertAlmostEquals(e.zins[2].zinsProzent, 4.8, 1e-9)
  assertAlmostEquals(e.zins[2].cashflowMonat!, 12_895 / 12, 1e-6)
  assertEquals(e.raster.length, 9)
  // Zins nie unter 0
  const niedrig = empfindlichkeit({ ...REMSTAL, eigenkapital: 400_000, zinsProzent: 0.5 })
  assertEquals(niedrig.zins[0].zinsProzent, 0)
})

Deno.test('Marktvergleich: günstiger Preis, Pacht im Rahmen, Rendite bei Marktmiete', () => {
  const r = berechneRendite(REMSTAL)
  const markt = { status: 'fertig' as const, preisJeQmVon: 2800, preisJeQmBis: 3000, mieteJeQmVon: 12.5, mieteJeQmBis: 15.5, stand: '2026-11-22', quellen: [] }
  const v = vergleicheMitMarkt({ ...r, flaeche: 590 }, markt)
  assertEquals(v.preis?.urteil, 'guenstig')
  assertAlmostEquals(v.preis!.abweichungProzent, ((2033.898 - 2900) / 2900) * 100, 1e-2)
  assertEquals(v.miete?.urteil, 'im_rahmen')
  assertAlmostEquals(v.renditeBeiMarktmiete!.von!, 7.375, 1e-9)
  assertAlmostEquals(v.renditeBeiMarktmiete!.bis!, 9.145, 1e-9)
  assertEquals(vergleicheMitMarkt(r, { status: 'laeuft' }), {})
  const kurz = renditeKurzfassung(r, markt, REMSTAL)
  assertStringIncludes(kurz, 'Bruttorendite 7,38 %')
  assertStringIncludes(kurz, 'Preis günstig')
  assertStringIncludes(kurz, 'Pacht')
})

Deno.test('Vorbefüllen aus der Objektakte: Verlauf, Kurzprüfung, Verkaufsdatenblatt', () => {
  const ausVerlauf = vorschlagAusObjekt({
    kaufpreis: '1200000',
    adresse: 'Teckstraße 62, 73547 Lorch-Weitmars',
    activities: [
      { text: 'Einschätzung: 2.100 € je m² sind günstig, vor Ort 2.800 € bis 3.000 €/m²; Pacht 12,50 € bis 15,50 € pro Quadratmeter.' },
      { text: 'Laut Exposé 15 Appartements, ca. 590 m² Hotelfläche, Kaufpreis 1.200.000 € zzgl. 3,57 % Käuferprovision.' },
    ],
  })
  assertEquals(ausVerlauf.eingaben, { kaufpreis: 1_200_000, flaeche: 590, einheiten: 15, maklerProzent: 3.57, bundesland: 'BW' })
  assertEquals(ausVerlauf.herkunft.flaeche, 'Verlauf der Objektakte')
  // Die Pacht aus einer Einschätzung ist keine echte Miete.
  assertEquals(ausVerlauf.eingaben.miete, undefined)

  const ausBlatt = vorschlagAusObjekt({
    kaufpreis: 0,
    verkaufsdaten: { kennzahlen: { wohnflaeche: '400', nutzflaeche: '190 m²', einheiten: '15', jahresnettokaltmiete: 88_500, kaufpreisvorstellung: 1_250_000 } },
    kurzpruefung: { zeilen: { mieteProQm: { ist: '11 €' } }, provisionProzent: '3,57' },
  })
  assertEquals(ausBlatt.eingaben.kaufpreis, 1_250_000)
  assertEquals(ausBlatt.eingaben.flaeche, 590)
  assertEquals(ausBlatt.eingaben.miete, 88_500)
  assertEquals(ausBlatt.eingaben.mieteArt, 'jahr')
  assertEquals(ausBlatt.herkunft.maklerProzent, 'Kurzprüfung (Provision)')
})

Deno.test('Gespeicherter Stand: tolerant lesen, Prüfsteine je Eintrag zusammenführen, Markt bleibt', () => {
  const roh = { version: 1, eingaben: { kaufpreis: 1_200_000, mieteArt: 'quatsch', bundesland: 'XX', flaeche: '590' }, markt: { status: 'fertig', preisJeQmVon: 2800 }, pruefsteine: { brandschutz: { erledigt: true, von: 'Quirin' } } }
  const s = leseRenditeStand(roh)
  assertEquals(s.eingaben, { kaufpreis: 1_200_000 })
  const neu = mischeRenditeStand(roh, { eingaben: REMSTAL, pruefsteine: { genehmigung: { erledigt: true } } })
  assertEquals(neu.markt?.preisJeQmVon, 2800)
  assertEquals(neu.pruefsteine?.brandschutz.erledigt, true)
  assertEquals(neu.pruefsteine?.genehmigung.erledigt, true)
  assertEquals(neu.eingaben?.kaufpreis, 1_200_000)
  assertEquals(leseRenditeStand(null).pruefsteine, {})
})

Deno.test('Bericht für das PDF enthält Tabellen, Empfindlichkeit und Prüfsteine', () => {
  const e = { ...REMSTAL, zinsProzent: 3.8 }
  const t = renditeBericht('Boarding House Remstal', e, berechneRendite(e), null, { genehmigung: { erledigt: true, notiz: 'liegt vor' } })
  assertStringIncludes(t, '## Kaufpreis und Nebenkosten')
  assertStringIncludes(t, '| Grunderwerbsteuer (5,0 %) | 60.000 € |')
  assertStringIncludes(t, '## Empfindlichkeit')
  assertStringIncludes(t, '[geklärt] Genehmigung der Nutzung: liegt vor')
  assertStringIncludes(t, '[offen] Brandschutz')
})
