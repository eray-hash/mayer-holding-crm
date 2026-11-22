// deno test src/components/tagesplan/tests/excelLesen.test.ts
// Prüft das Lesen von Quirins Excel-Blättern mit Zeilen, wie sie die echte Datei liefert (gekürzt): Datumswerte,
// Umsatz-Texte, Kürzel der Zuständigen, die drei Anordnungen im Reiter „erledigte Aufgaben“, stabile Kennungen und
// den Tagesablauf mit seinen Blöcken.
import { excelDatum, leseErledigtBlatt, leseTagesablauf, leseToDoBlatt, stabileId, umsatzAusText, zustaendigName } from '../excelLesen.ts'

type DenoTest = { test: (name: string, f: () => void) => void }
const test = (name: string, f: () => void): void => {
  const d = (globalThis as unknown as { Deno?: DenoTest }).Deno
  if (d) d.test(name, f)
}
function gleich<T>(ist: T, soll: T, text = ''): void {
  const a = JSON.stringify(ist)
  const b = JSON.stringify(soll)
  if (a !== b) throw new Error(`${text ? text + ': ' : ''}erwartet ${b}, bekommen ${a}`)
}

const STAND = '2026-11-18'

test('Datum: Excel-Seriennummer, Text ohne Jahr, ungültige Tage', () => {
  gleich(excelDatum(46204, STAND), '2026-07-01')
  gleich(excelDatum(46344, STAND), '2026-11-18')
  gleich(excelDatum('17.9.', STAND), '2026-09-17')
  gleich(excelDatum('24.12.', STAND), '2025-12-24') // ohne Jahr: der letzte 24.12. vor dem Stand der Liste
  gleich(excelDatum('17.11.26', STAND), '2026-11-17')
  gleich(excelDatum('30.02', STAND), null)
  gleich(excelDatum('1.9 wird gemacht', STAND), null)
})

test('Umsatz: „25k“, Bereiche vorsichtig, „?“ leer', () => {
  gleich(umsatzAusText('25k '), { wert: 25000, eindeutig: true })
  gleich(umsatzAusText('5k-45k'), { wert: 5000, eindeutig: false })
  gleich(umsatzAusText('50-70k'), { wert: 50000, eindeutig: false })
  gleich(umsatzAusText(' mind.50k'), { wert: 50000, eindeutig: false })
  gleich(umsatzAusText('evtl 100k'), { wert: 100000, eindeutig: false })
  gleich(umsatzAusText('?'), { wert: null, eindeutig: true })
  gleich(umsatzAusText('fraglich'), { wert: null, eindeutig: false })
  gleich(umsatzAusText(0), { wert: 0, eindeutig: true })
})

test('Zuständig: Kürzel → volle Namen', () => {
  gleich(zustaendigName('QL'), 'Quirin Lutzenberger')
  gleich(zustaendigName('Q.L '), 'Quirin Lutzenberger')
  gleich(zustaendigName('HS.'), 'Hasan Süslü')
  gleich(zustaendigName('A.M'), 'Andreas Mayer')
  gleich(zustaendigName('M.G'), 'Markus Gröber')
  gleich(zustaendigName('QL HS'), 'Quirin Lutzenberger, Hasan Süslü')
  gleich(zustaendigName(null), null)
})

const KOPF: unknown[][] = [
  [' ', null, null, null, 'Lutzenberger              18.11.26', null, 'ToDo Liste', null, 'Formular vom 08-09-2026'],
  ['Start', 'Pri', 'Unter', 'Kunde/ ', 'Aufgabe', 'Abt.', null, null, 'Was ist als nächstes zu Tun', 'zuständig', 'geplante', '( ist)', 'Umsatz ', 'geplant', 'Erledigt'],
  ['DAtum', null, 'Pri', 'Projekt', null, null, 'aktueller Stand / Info', 'welche Fragen', null, null, 'Zeit', 'Zeit', 'Wert', 'Wiedervor', 'am '],
  ['Datum', null, null, 'Firma', 'Aufgabe', null, null, null, null, 'zuständig', 'min', null, 'Euro', 'Datum'],
]

test('Reiter „to Do“: Spalten, Umsatz-Vermerk, fehlende Aufgabe, Kopfzeilen übersprungen', () => {
  const zeilen = leseToDoBlatt(
    [
      ...KOPF,
      [46204, 'A', 5, 'Elmali MFH Aislingen 350k', 'Ebay Anzeige ändern ', 'Immo', '18.11 Vermarktung eingestellt', '1.9 kein Käufer', '18.11 weiteres Vermarktungskonzept', 'QL', null, 200, '25k '],
      ['17.9.', 'B', 1, 'Immoabt. Verbessern', 'Liste wo QL hilfe braucht erstellen', null, null, null, null, 'QL', null, null, 0],
      [46175, 'B', 4, 'Stechem. Umsatz', 'Objekte in Bayreuth suchen', 'Immo', 'Plan', 'Plan', 'Auslastung erhöhen', 'QL', null, null, '5k-45k'],
      [46331, 'A', 11, 'Orhan Degermenci', null, null, '1. Plauen\t2-Zimmer-Wohnungen \r\n2. Heimsheim', null, '5.11 Weitere Objektdaten anfordern'],
      [46174, 'B', 2, 'Mives', 'Illerkirchberg Hasan Immo ', 'Immo', 'Einwertung', 'Einwertung', 'Exposé', 'Q.L ', 120, null, '10k'],
    ],
    STAND,
  )
  gleich(zeilen.length, 5)
  const [elmali, liste, stechem, orhan, mives] = zeilen
  gleich(
    [elmali.start_datum, elmali.prio, elmali.unter_prio, elmali.kunde_projekt, elmali.aufgabe, elmali.abteilung, elmali.welche_fragen, elmali.naechste_schritte, elmali.zustaendig, elmali.ist_zeit, elmali.umsatz_wert, elmali.erledigt_am],
    ['2026-07-01', 'A', 5, 'Elmali MFH Aislingen 350k', 'Ebay Anzeige ändern', 'Immo', '1.9 kein Käufer', '18.11 weiteres Vermarktungskonzept', 'Quirin Lutzenberger', 200, 25000, null],
  )
  gleich(liste.start_datum, '2026-09-17')
  gleich(liste.umsatz_wert, 0)
  gleich([stechem.umsatz_wert, stechem.umsatz_text, stechem.aktueller_stand], [5000, '5k-45k', 'Plan\nUmsatz laut Liste: 5k-45k'])
  gleich(orhan.aufgabe, '5.11 Weitere Objektdaten anfordern')
  gleich(orhan.aktueller_stand, '1. Plauen 2-Zimmer-Wohnungen\n2. Heimsheim')
  gleich(mives.geplante_zeit, '120')
  // Stabil: gleiche Zeile → gleiche Kennung, Stand ändert sie nicht.
  const nochmal = leseToDoBlatt([[46204, 'A', 5, 'Elmali MFH Aislingen 350k', 'Ebay Anzeige ändern', 'Immo', 'ganz neuer Stand']], STAND)[0]
  gleich(nochmal.id, elmali.id)
  gleich(elmali.id.startsWith('todo_ql_'), true)
  gleich(stabileId(['a', 'b']) === stabileId(['a', 'c']), false)
})

test('Reiter „erledigte Aufgaben“: drei Anordnungen, Erledigt-Datum, Texte in den Stand', () => {
  const zeilen = leseErledigtBlatt(
    [
      ['ToDo Liste ', null, null, null, 'Lutzenberger                               10.4.26'],
      // Anordnung wie „to Do“ (Kürzel in Spalte 9), Erledigt in Spalte 14.
      [46122, 'D', 2, 'Büro', 'Sumup Kartenzahlung ', 'Immo', '20.8 habe es Markus gesagt ', '20.8 habe es Markus gesagt ', 'wieder aktivieren', 'MG', 30, null, 0, null, 46305],
      // Ältere Fassung (Kürzel in Spalte 8), Datum in Spalte 12.
      [46132, 'D', 3, 'Maklerin', 'Sandra Walter Maklerin nachhaken', 'Immo', '20.7 nicht interessiert', 'Markus fragen', 'M.G', 10, null, null, 46254],
      // Überschriften-Anordnung, Kürzel in Spalte 7.
      [46114, 'C', null, 'Ingolstadt MFH', '16 Whg / 1600qm', 'Immo', 'Einwerten, nicht machen', 'QL'],
      // Text statt Datum in „Erledigt“, Datum in Spalte 12.
      [46175, 'D', 13, 'Büro / IT', 'Email für Steche', null, null, '20.7 Markus erstellt neues Email', null, null, null, null, 46264, null, '1.9 wird gemacht'],
      // Erledigt-Datum vor dem Start → nicht glaubhaft → Stand der Liste.
      [46121, 'B', 1, 'Kissing Immo', 'kontrollieren wann Mieterin ausziehen kann', null, 'abklären', null, null, null, null, null, 46093],
    ],
    STAND,
  )
  gleich(zeilen.length, 5)
  const [sumup, walter, ingolstadt, mail, kissing] = zeilen
  gleich([sumup.zustaendig, sumup.geplante_zeit, sumup.erledigt_am, sumup.erledigt_geschaetzt, sumup.welche_fragen], ['Markus Gröber', '30', '2026-10-10', false, '20.8 habe es Markus gesagt'])
  gleich([walter.zustaendig, walter.naechste_schritte, walter.geplante_zeit, walter.erledigt_am], ['Markus Gröber', 'Markus fragen', '10', '2026-08-20'])
  gleich([ingolstadt.zustaendig, ingolstadt.erledigt_am, ingolstadt.erledigt_geschaetzt], ['Quirin Lutzenberger', STAND, true])
  gleich([mail.erledigt_am, mail.aktueller_stand, mail.naechste_schritte], ['2026-08-30', '1.9 wird gemacht', '20.7 Markus erstellt neues Email'])
  gleich([kissing.erledigt_am, kissing.erledigt_geschaetzt], [STAND, true])
  gleich(zeilen.every((t) => t.blatt === 'erledigt' && t.id.startsWith('todo_ql_')), true)
})

test('Tagesablauf: Kopf, Blöcke, Zeit ohne Text gehört zur Zeile darüber, Anrufe', () => {
  const tag = leseTagesablauf(
    [
      ['Tagesablauf', null, null, 'klar definieren', null, null, 'Datum 17.11.2026'],
      ['Ort___ULM___________', null, null, null, 'Bearbeiter____Lutzenberger____________________________', null, '3 x Lösung Vorschläge'],
      [null, 'ca Min.', 'bis Uhrzeit', null, 'was ist heute in welcher Reihenfolge zu tun ', 'Gewinn/Verlust', 'Infos', 'Anrufe '],
      ['Orginatori.', 20, null, null, 'ToDo-Liste überarbeiten,       _____________________'],
      ['wiederholte', null, null, null, 'Objektliste aktualisieren'],
      ['Fristsachen', null, null, 1],
      ['A ', null, null, 'A1', 'Objekte priorisieren', null, null, 'Stechem'],
      [null, null, null, 'A3 ', 'Alle Kontaktdaten jedes Kunden'],
      [null, 30, 1130],
      ['B ', null, null, 'B1'],
      [null, 35, 1800, 'B4 ', 'Tinyhäuser vertiefte Recherche'],
      ['C ', null, null, 'C1  '],
      ['Aufgaben ', null, null, null, 'Harite Whg finden'],
      ['viele 3-7 Min ', null, null, 1, ' '],
      [null, null, null, 6, 'Fond Berlin zusammenstellen'],
      ['Unvorher-', null, null, 1],
      ['Gesamtzeit', 85, null, null, 'Fokus liegt auf Umsatz '],
    ],
    (block, nr) => `${block}-${nr}`,
  )
  gleich([tag.datum, tag.ort, tag.bearbeiter, tag.gesamtMin, tag.anrufe], ['2026-11-17', 'Ulm', 'Lutzenberger', 85, 'Stechem'])
  gleich(
    tag.zeilen.map((z) => [z.block, z.was, z.dauerMin ?? null, z.bisUhr ?? null]),
    [
      ['organisation', 'ToDo-Liste überarbeiten', 20, null],
      ['organisation', 'Objektliste aktualisieren', null, null],
      ['A', 'Objekte priorisieren', null, null],
      ['A', 'Alle Kontaktdaten jedes Kunden', 30, '11:30'],
      ['B', 'Tinyhäuser vertiefte Recherche', 35, '18:00'],
      ['C', 'Harite Whg finden', null, null],
      ['kurz', 'Fond Berlin zusammenstellen', null, null],
    ],
  )
  gleich(tag.zeilen[2].stand, 'Anrufe: Stechem')
})
