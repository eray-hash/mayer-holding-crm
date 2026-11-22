// Tests für den Dubletten-Kern: Namen (Rechtsform, Umlaute, Wortfolge, Tippfehler), E-Mail, Telefon (auch
// abgeschnittene Nummern), Anschrift, Gruppen, Bereiche, Ausnahmen, Objekte.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  abstand,
  type AkteFuerDubletten,
  allePaare,
  emailAdressen,
  findeAktenDubletten,
  findeObjektDubletten,
  namensWoerter,
  paarSchluessel,
  strassenSchluessel,
  telefonnummern,
  vergleicheAkten,
  vergleicheNamen,
} from './dublettenKern.ts'

const akte = (id: string, felder: Partial<AkteFuerDubletten> = {}): AkteFuerDubletten => ({ id, bereich: 'beratung', ...felder })

Deno.test('Namen: Rechtsform, Umlaute, Wortfolge und Anrede zählen nicht', () => {
  assertEquals(namensWoerter('Müller Bau GmbH & Co. KG'), ['bau', 'mueller'])
  assertEquals(namensWoerter('Mueller-Bau UG (haftungsbeschränkt)'), ['bau', 'mueller'])
  assertEquals(namensWoerter('Herr Dr. Max Mustermann'), ['max', 'mustermann'])
  const r = vergleicheNamen('Müller Bau GmbH & Co. KG', 'Mueller Bau')
  assertEquals(r?.punkte, 60)
  assertEquals(r?.grund, 'gleicher Name, nur anders geschrieben (Rechtsform, Umlaute oder Wortfolge)')
  assertEquals(vergleicheNamen('Mustermann Max', 'Max Mustermann')?.punkte, 60)
  assertEquals(vergleicheNamen('Stadt Senden', 'Stadt Senden')?.grund, 'gleicher Name')
  assertEquals(vergleicheNamen('Lachermaier', 'Lachermeier')?.grund, 'Name fast gleich geschrieben')
  assertEquals(vergleicheNamen('Bäckerei Sonne', 'Metzgerei Mond'), null)
  assertEquals(abstand('abcdef', 'abcxef'), 1)
  assertEquals(abstand('abc', 'abcdefgh'), 3)
})

Deno.test('Telefon: Landesvorwahl, (0), mehrere Nummern, abgeschnittene Endziffern', () => {
  assertEquals(telefonnummern('+49 (0) 731 / 123456'), ['0731123456'])
  assertEquals(telefonnummern('0049-163-6058'), ['01636058'])
  assertEquals(telefonnummern('Tel.: 0731 12345, Mobil 0171 9876543'), ['073112345', '01719876543'])
  const gleich = vergleicheAkten(akte('a', { telefon: '+49 731 123456' }), akte('b', { telefon: '0731/123456' }))
  assertEquals(gleich.gruende, ['gleiche Telefonnummer'])
  assertEquals(gleich.punkte, 45)
  const abgeschnitten = vergleicheAkten(akte('a', { telefon: '0049-163-6058' }), akte('b', { telefon: '0049-163-6058100' }))
  assertEquals(abgeschnitten.gruende, ['Telefonnummer gleich bis auf fehlende Endziffern'])
  assert(abgeschnitten.punkte >= 40)
  // Zu kurz für „abgeschnitten“: keine Meldung
  assertEquals(vergleicheAkten(akte('a', { telefon: '07311' }), akte('b', { telefon: '0731123456' })).punkte, 0)
})

Deno.test('E-Mail: gleiche Adresse, gleiche Firmen-Mailendung, nicht bei freien Anbietern und eigenen', () => {
  assertEquals(emailAdressen('Info <INFO@Firma.de>; buero@firma.de.'), ['info@firma.de', 'buero@firma.de'])
  assertEquals(vergleicheAkten(akte('a', { email: 'x@firma.de' }), akte('b', { email: 'X@firma.de' })).gruende, ['gleiche E-Mail-Adresse'])
  assertEquals(vergleicheAkten(akte('a', { email: 'x@firma.de' }), akte('b', { email: 'y@firma.de' })).gruende, ['gleiche Firmen-Mailendung (@firma.de)'])
  assertEquals(vergleicheAkten(akte('a', { email: 'x@gmx.de' }), akte('b', { email: 'y@gmx.de' })).punkte, 0)
  assertEquals(vergleicheAkten(akte('a', { email: 'x@amayer-holding.com' }), akte('b', { email: 'y@amayer-holding.com' })).punkte, 0)
})

Deno.test('Anschrift: Straße mit Hausnummer, Schreibweise egal, PLZ muss passen', () => {
  assertEquals(strassenSchluessel('Hauptstraße 12a, 89073 Ulm'), 'hauptstr12a')
  assertEquals(strassenSchluessel('89073 Ulm, Hauptstr. 12 a'), 'hauptstr12a')
  assertEquals(vergleicheAkten(akte('a', { anschrift: 'Hauptstraße 12, 89073 Ulm' }), akte('b', { anschrift: 'Hauptstr. 12 89073 Ulm' })).gruende, ['gleiche Anschrift'])
  assertEquals(vergleicheAkten(akte('a', { anschrift: 'Hauptstraße 12, 89073 Ulm' }), akte('b', { anschrift: 'Hauptstr. 12, 70173 Stuttgart' })).punkte, 0)
})

Deno.test('Gruppen: verbundene Paare, Stufe, Gründe; verschiedene Bereiche eigens markiert', () => {
  const akten = [
    akte('k1', { firma: 'Muster GmbH', telefon: '0731 1111111' }),
    akte('k2', { firma: 'Muster', email: 'info@muster.de', telefon: '0731/1111111' }),
    akte('k3', { firma: 'Ganz Anders AG', email: 'Info@Muster.de', bereich: 'erben' }),
    akte('k4', { firma: 'Niemand Sonst' }),
  ]
  const g = findeAktenDubletten(akten)
  assertEquals(g.length, 1)
  assertEquals(g[0].ids, ['k1', 'k2', 'k3'])
  assertEquals(g[0].punkte, 90)
  assertEquals(g[0].stufe, 'sicher')
  assert(g[0].bereichsuebergreifend)
  assertEquals(g[0].bereiche, ['beratung', 'erben'])
  assert(g[0].gruende.includes('gleiche Telefonnummer'))
})

Deno.test('Nie gemeldet: Ausnahmen, verknüpfte Akten, private Kontakte, Sammelakten', () => {
  const a = akte('a', { firma: 'Muster GmbH', email: 'x@muster.de' })
  const b = akte('b', { firma: 'Muster GmbH', email: 'x@muster.de' })
  assertEquals(findeAktenDubletten([a, b]).length, 1)
  assertEquals(findeAktenDubletten([a, b], { ausnahmen: [paarSchluessel('b', 'a')] }).length, 0)
  assertEquals(findeAktenDubletten([{ ...a, verknuepft: ['b'] }, { ...b, bereich: 'erben' }]).length, 0)
  assertEquals(findeAktenDubletten([a, { ...b, bereich: 'privat' }]).length, 0)
  assertEquals(findeAktenDubletten([a, { ...b, id: 'k_eingang_ungeklaert' }]).length, 0)
  assertEquals(allePaare(['c', 'a', 'b', 'a']), ['a|c', 'b|c', 'a|b'])
})

Deno.test('Gleiche Firma, aber andere Ansprechpartner: schwächer; gleicher Ansprechpartner: stärker', () => {
  const x = akte('a', { firma: 'Stadt Senden', ansprechpartner: 'Andreas Sundarp', email: 'a@stadt-senden.de' })
  const y = akte('b', { firma: 'Stadt Senden', ansprechpartner: 'Valentin Funke', email: 'v@stadt-senden.de' })
  const p = vergleicheAkten(x, y)
  assertEquals(p.punkte, 60)
  assert(p.gruende.includes('aber verschiedene Ansprechpartner'))
  const q = vergleicheAkten(akte('a', { firma: 'Muster GmbH', ansprechpartner: 'Max Muster' }), akte('b', { firma: 'Muster', ansprechpartner: 'Muster, Max' }))
  assertEquals(q.punkte, 55)
  assert(q.gruende.includes('gleicher Ansprechpartner'))
  // Person in der einen Akte als Firma, in der anderen als Ansprechpartner
  const r = vergleicheAkten(akte('a', { firma: 'Max Muster' }), akte('b', { firma: 'Muster Handel GmbH (Max Muster)' }))
  assert(r.gruende.includes('der Name der einen Akte ist Ansprechpartner der anderen'))
  // Platzhalter zählen nicht als gleicher Ansprechpartner
  const s = vergleicheAkten(
    akte('a', { firma: 'Gesuch MFH Ulm (Absender noch eintragen)', ansprechpartner: 'Gesuch MFH Ulm (Absender noch eintragen)' }),
    akte('b', { firma: 'Ankauf-Anfrage (Absender noch eintragen)', ansprechpartner: 'Ankauf-Anfrage (Absender noch eintragen)' }),
  )
  assertEquals(s.punkte, 0)
})

Deno.test('Objekte: gleiche Adresse auch mit anderer Bezeichnung, ähnliche Adresse, private außen vor', () => {
  const o = findeObjektDubletten([
    { id: 'o1', bezeichnung: 'MFH Ulm Weststadt', adresse: 'Söflinger Straße 100, 89077 Ulm' },
    { id: 'o2', bezeichnung: 'Mehrfamilienhaus', adresse: 'Söflinger Str. 100, 89077 Ulm' },
    { id: 'o3', bezeichnung: 'Hotel Hirsch', adresse: 'Hauptstraße 5, 73553 Alfdorf' },
    { id: 'o4', bezeichnung: 'Gasthof Hirsch', adresse: 'Hauptstr 5 73553 Alfdorf', privat_besitzer: 'anna@firma.de' },
    { id: 'o5', bezeichnung: 'Wohnhaus', adresse: 'Lindenweg 3', weitereAdressen: ['Lindenwg. 3 88400 Biberach'] },
    { id: 'o6', bezeichnung: 'Haus am Lindenweg', adresse: 'Lindenweg 3, 88400 Biberach' },
  ])
  assertEquals(o.map((g) => g.ids), [['o1', 'o2'], ['o5', 'o6']])
  assertEquals(o[0].gruende, ['gleiche Adresse'])
  assert(!o[0].bereichsuebergreifend)
  const nurName = findeObjektDubletten([
    { id: 'a', bezeichnung: 'Boarding House Remstal' },
    { id: 'b', bezeichnung: 'Boarding-House Remstal' },
  ])
  assertEquals(nurName[0].gruende, ['gleiche Bezeichnung'])
})
