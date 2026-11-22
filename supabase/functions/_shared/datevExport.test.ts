// Prüft den Rechenkern des Steuerberater-Exports (datevExport.ts) und den ZIP-Schreiber (zipSchreiber.ts).
import { assert, assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1'
import {
  alsUtf8MitKennung, alsWindows1252, aufwandskontoFuer, ausRechnungZeile, ausVerbindlichkeitZeile, DATEV_SPALTEN, datevBelegfeld,
  datevBetrag, datevBuchungstext, datevKopfzeile, eindeutigerPfad, eingangsbelegPfad, einstellungAusZeile, einstellungAlsZeile,
  erloeskontoFuer, erstelleBuchungen, erstelleExportDateien, leseZeitraum, monatsZeitraum, ordnePersonenkontenZu, pruefeEinstellung,
  pruefeExport, quartalsZeitraum, satzAusBetraegen, statusText, STANDARD_EINSTELLUNG, wjBeginn,
  type AusgangsRechnung, type Eingangsbeleg, type SteuerberaterEinstellung,
} from './datevExport.ts'
import { crc32, erstelleZip, leseZip } from './zipSchreiber.ts'

const HEUTE = '2026-11-22'

function rechnung(x: Partial<AusgangsRechnung> = {}): AusgangsRechnung {
  return { id: 'r1', nummer: 'RE-2026-001', datum: '2026-10-05', kundeId: 'k_a', kundeName: 'Müller GmbH', netto: 1000, brutto: 1190, status: 'Versendet', hatPdf: true, ...x }
}

function beleg(x: Partial<Eingangsbeleg> = {}): Eingangsbeleg {
  return { id: 'verb_abc12345', lieferant: 'IONOS', rechnungsnummer: 'R-77', datum: '2026-10-10', netto: 100, brutto: 119, kategorie: 'Software & Hosting', status: 'offen', quelle: 'manuell', hatBeleg: true, ...x }
}

const EIN: SteuerberaterEinstellung = { ...STANDARD_EINSTELLUNG, beraterNr: '29098', mandantenNr: '55003', kontenBestaetigt: true }

// ─── Zeitraum ───────────────────────────────────────────────────────────────────────────────────

Deno.test('Zeitraum lesen', () => {
  assertEquals(leseZeitraum('', HEUTE)?.kurz, '2026-10')
  assertEquals(leseZeitraum('Vormonat', HEUTE)?.kurz, '2026-10')
  assertEquals(leseZeitraum('vormonat', '2026-01-15')?.kurz, '2025-12')
  assertEquals(leseZeitraum('2026-11', HEUTE)?.bis, '2026-11-30')
  assertEquals(leseZeitraum('02/2028', HEUTE)?.bis, '2028-02-29')
  assertEquals(leseZeitraum('11.2026', HEUTE)?.kurz, '2026-11')
  assertEquals(leseZeitraum('November', HEUTE)?.kurz, '2026-11')
  assertEquals(leseZeitraum('Dezember', HEUTE)?.kurz, '2025-12') // liegt sonst in der Zukunft
  assertEquals(leseZeitraum('März 2026', HEUTE)?.von, '2026-03-01')
  assertEquals(leseZeitraum('maerz 2026', HEUTE)?.von, '2026-03-01')
  assertEquals(leseZeitraum('Q4 2026', HEUTE)?.von, '2026-10-01')
  assertEquals(leseZeitraum('2026-Q3', HEUTE)?.bis, '2026-09-30')
  assertEquals(leseZeitraum('3. Quartal', HEUTE)?.kurz, '2026-Q3')
  assertEquals(leseZeitraum('letztes Quartal', HEUTE)?.kurz, '2026-Q3')
  assertEquals(leseZeitraum('dieser Monat', HEUTE)?.kurz, '2026-11')
  assertEquals(leseZeitraum('Quatsch', HEUTE), null)
  assertEquals(leseZeitraum('13/2026', HEUTE), null)
  assertEquals(quartalsZeitraum(2026, 1).bezeichnung, '1. Quartal 2026')
  assertEquals(monatsZeitraum(2026, 2).bezeichnung, 'Februar 2026')
})

Deno.test('Wirtschaftsjahr', () => {
  assertEquals(wjBeginn('2026-11-05', 1), '2026-01-01')
  assertEquals(wjBeginn('2026-03-05', 7), '2025-07-01')
  assertEquals(wjBeginn('2026-07-01', 7), '2026-07-01')
})

// ─── Einstellung ─────────────────────────────────────────────────────────────────────────────────

Deno.test('Einstellung aus der Datenbank und zurück', () => {
  const e = einstellungAusZeile({ berater_nr: ' 29098 ', mandanten_nr: '', kontenrahmen: 'SKR04', wj_beginn_monat: 13, erloeskonten: { '19': '4401', x: '' }, aufwandskonten: null, beleg_info: false })
  assertEquals(e.beraterNr, '29098')
  assertEquals(e.mandantenNr, undefined)
  assertEquals(e.kontenrahmen, 'SKR04')
  assertEquals(e.wjBeginnMonat, 1)
  assertEquals(e.erloeskonten, { '19': '4401' })
  assertEquals(e.belegInfo, false)
  assertEquals(erloeskontoFuer(e, 19), '4401')
  assertEquals(erloeskontoFuer(e, 7), '4300')
  assertEquals(einstellungAlsZeile(e).mandanten_nr, null)
  assertEquals(einstellungAusZeile(null).kontenrahmen, 'SKR03')
  assertEquals(pruefeEinstellung({ ...STANDARD_EINSTELLUNG, beraterNr: '12', mandantenNr: '123456', aufwandskonten: { Miete: '42100' } }).length, 3)
  assertEquals(pruefeEinstellung(EIN), [])
})

Deno.test('Kontenzuordnung SKR03', () => {
  assertEquals(erloeskontoFuer(EIN, 19), '8400')
  assertEquals(erloeskontoFuer(EIN, 7), '8300')
  assertEquals(erloeskontoFuer(EIN, 0), '8100')
  assertEquals(erloeskontoFuer(EIN, 16), '8200')
  assertEquals(erloeskontoFuer(EIN, null), '8200')
  assertEquals(aufwandskontoFuer(EIN, 'miete'), '4210')
  assertEquals(aufwandskontoFuer(EIN, 'Bürobedarf'), '4930')
  assertEquals(aufwandskontoFuer(EIN, 'Gibt es nicht'), '4900')
  assertEquals(aufwandskontoFuer(EIN, undefined), '4900')
  assertEquals(aufwandskontoFuer({ ...EIN, aufwandskonten: { Fortbildung: '4945' } }, 'fortbildung'), '4945')
})

// ─── Steuersatz ──────────────────────────────────────────────────────────────────────────────────

Deno.test('Steuersatz aus netto/brutto', () => {
  assertEquals(satzAusBetraegen(41.47, 49.35), 19)
  assertEquals(satzAusBetraegen(3250, 3867.5), 19)
  assertEquals(satzAusBetraegen(100, 107), 7)
  assertEquals(satzAusBetraegen(50, 50), 0)
  assertEquals(satzAusBetraegen(100, 113), null) // gemischt
  assertEquals(satzAusBetraegen(null, 119), null)
  assertEquals(satzAusBetraegen(0, 0), null)
})

Deno.test('Zeilen aus der Datenbank', () => {
  const r = ausRechnungZeile({ id: 'x', nummer: 'CL-001', datum: '2026-11-05', kunde_id: 'k_1', betrag_netto: '3250', betrag_brutto: '3867.5', ust_satz: null, status: 'Bezahlt', zahlungen: [{ betrag: 3867.5 }], dokument: null }, 'Kunde')
  assertEquals(r.netto, 3250)
  assertEquals(r.ustSatz, null)
  assertEquals(r.gezahlt, 3867.5)
  assertEquals(r.hatPdf, false)
  const v = ausVerbindlichkeitZeile({ id: 'v', lieferant: ' IONOS ', datum: '2026-11-10', betrag_netto: null, betrag_brutto: '0', status: 'offen', quelle: 'email-automatisch', geprueft: null, beleg: null }, true)
  assertEquals(v.lieferant, 'IONOS')
  assertEquals(v.brutto, 0)
  assertEquals(v.netto, null)
  assertEquals(v.geprueft, false)
  assertEquals(v.hatBeleg, false)
  assertEquals(v.hatMailAnhang, true)
})

// ─── Prüfung ─────────────────────────────────────────────────────────────────────────────────────

Deno.test('Prüfung: Zeitraum, Entwürfe, Warnungen, Summen', () => {
  const z = monatsZeitraum(2026, 10)
  const p = pruefeExport(
    [
      rechnung(),
      rechnung({ id: 'r2', nummer: 'RE-2026-002', hatPdf: false, netto: 500, brutto: 535 }),
      rechnung({ id: 'r3', nummer: 'RE-2026-003', status: 'Entwurf' }),
      rechnung({ id: 'r4', nummer: 'RE-2026-004', datum: '2026-11-01' }),
      rechnung({ id: 'r5', nummer: 'RE-2026-005', netto: 100, brutto: 113 }),
    ],
    [
      beleg(),
      beleg({ id: 'v2', lieferant: 'PayPal', hatBeleg: false, quelle: 'email-automatisch', geprueft: false, netto: null, brutto: null, rechnungsnummer: undefined }),
      beleg({ id: 'v3', lieferant: 'Europcar', hatBeleg: false, hatMailAnhang: true, netto: null, brutto: 59.5, kategorie: undefined }),
      beleg({ id: 'v4', datum: '2026-09-30' }),
    ],
    { ...STANDARD_EINSTELLUNG },
    z,
  )
  assertEquals(p.rechnungen.map((r) => r.id), ['r1', 'r2', 'r5'])
  assertEquals(p.entwuerfe.map((r) => r.id), ['r3'])
  assertEquals(p.belege.map((b) => b.id), ['v3', 'verb_abc12345', 'v2'])
  assertEquals(p.summen.rechnungen, { anzahl: 3, netto: 1600, ust: 238, brutto: 1838 })
  assertEquals(p.summen.belege.anzahl, 3)
  assertEquals(p.summen.belege.imStapel, 2)
  assertEquals(p.summen.belege.brutto, 178.5)
  assertEquals(p.summen.belege.vorsteuer, 19)
  const arten = p.warnungen.map((w) => `${w.art}:${w.id ?? ''}`)
  assert(arten.includes('einstellung:'))
  assert(arten.includes('rechnung_ohne_pdf:r2'))
  assert(arten.includes('rechnung_satz_unklar:r5'))
  assert(arten.includes('rechnung_entwurf:'))
  assert(arten.includes('beleg_fehlt:v2'))
  assert(arten.includes('ungeprueft:v2'))
  assert(arten.includes('ohne_betrag:v2'))
  assert(arten.includes('ohne_nummer:v2'))
  assert(arten.includes('beleg_nur_mail:v3'))
  assert(arten.includes('vorsteuer_unklar:v3'))
  assert(arten.includes('ohne_kategorie:v3'))
  assert(!arten.includes('beleg_fehlt:v3'))
  const text = statusText(p)
  assertStringIncludes(text, 'Oktober 2026')
  assertStringIncludes(text, 'Ausgangsrechnungen: 3')
  assertStringIncludes(text, 'Rechnung id=r2')
  assertStringIncludes(text, 'Verbindlichkeit id=v2')
})

Deno.test('Prüfung: Quartal über zwei Wirtschaftsjahre', () => {
  const p = pruefeExport([], [], { ...EIN, wjBeginnMonat: 8 }, quartalsZeitraum(2026, 3))
  assert(p.warnungen.some((w) => w.schwere === 'fehlt' && w.text.includes('zwei Wirtschaftsjahre')))
  const ok = pruefeExport([], [], EIN, quartalsZeitraum(2026, 3))
  assertEquals(ok.warnungen.filter((w) => w.schwere === 'fehlt'), [])
  assertStringIncludes(statusText(ok), 'Es fehlt nichts')
})

// ─── Personenkonten ──────────────────────────────────────────────────────────────────────────────

Deno.test('Personenkonten: feste Nummern, nächste freie', () => {
  const bestand = [
    { art: 'debitor' as const, schluessel: 'k_a', nummer: 10000 },
    { art: 'debitor' as const, schluessel: 'k_alt', nummer: 10004 },
    { art: 'kreditor' as const, schluessel: 'ionos', nummer: 70000 },
  ]
  const { neu, alle } = ordnePersonenkontenZu(
    bestand,
    [{ kundeId: 'k_a', kundeName: 'A' }, { kundeId: 'k_b', kundeName: 'B' }, { kundeId: 'k_b', kundeName: 'B' }, { kundeId: 'k_c', kundeName: 'C' }],
    [{ lieferant: 'IONOS ' }, { lieferant: 'Pay  Pal' }, { lieferant: 'pay pal' }],
  )
  assertEquals(neu.map((k) => `${k.art}:${k.schluessel}:${k.nummer}`), ['debitor:k_b:10005', 'debitor:k_c:10006', 'kreditor:pay pal:70001'])
  assertEquals(alle.length, 6)
  // Bestand bleibt unverändert
  assertEquals(bestand.length, 3)
  assertThrows(() => ordnePersonenkontenZu([{ art: 'debitor', schluessel: 'x', nummer: 69999 }], [{ kundeId: 'y', kundeName: '' }], []))
})

// ─── DATEV ───────────────────────────────────────────────────────────────────────────────────────

Deno.test('DATEV-Felder', () => {
  assertEquals(datevBetrag(1234.5), '1234,50')
  assertEquals(datevBetrag(-19.999), '20,00')
  assertEquals(datevBelegfeld('RE 2026/001_ä'), 'RE-2026/001-ae')
  assertEquals(datevBelegfeld('x'.repeat(50)).length, 36)
  assertEquals(datevBelegfeld('Rechnung_2026-11-10_100195514449'), 'Rechnung-2026-11-10-100195514449')
  assertEquals(datevBuchungstext('a\nb  c'), 'a b c')
  assertEquals(datevBuchungstext('y'.repeat(80)).length, 60)
  assertEquals(DATEV_SPALTEN.length, 125)
  assertEquals(new Set(DATEV_SPALTEN).size, 125)
})

Deno.test('DATEV-Kopfzeile', () => {
  const k = datevKopfzeile(EIN, monatsZeitraum(2026, 10), new Date(2026, 10, 22, 14, 4, 40, 439), 'Eray')
  const f = k.split(';')
  assertEquals(f.length, 31)
  assertEquals(f.slice(0, 5), ['"EXTF"', '700', '21', '"Buchungsstapel"', '13'])
  assertEquals(f[5], '20261122140440439')
  assertEquals(f[10], '29098')
  assertEquals(f[11], '55003')
  assertEquals(f[12], '20260101')
  assertEquals(f[13], '4')
  assertEquals(f[14], '20261001')
  assertEquals(f[15], '20261031')
  assertEquals(f[20], '0') // nicht festgeschrieben
  assertEquals(f[21], '"EUR"')
  assertEquals(f[26], '"03"')
  // Platzhalter ohne Nummern
  const p = datevKopfzeile(STANDARD_EINSTELLUNG, monatsZeitraum(2026, 10), new Date()).split(';')
  assertEquals([p[10], p[11]], ['1001', '1'])
})

Deno.test('Buchungen: Ausgang und Eingang', () => {
  const z = monatsZeitraum(2026, 10)
  const p = pruefeExport(
    [rechnung(), rechnung({ id: 'r7', nummer: 'RE-7', kundeId: 'k_b', kundeName: 'Gutschrift AG', netto: -100, brutto: -107 })],
    [beleg(), beleg({ id: 'v8', lieferant: 'Amazon', netto: null, brutto: 49.35, kategorie: 'Bürobedarf', rechnungsnummer: undefined }), beleg({ id: 'v9', netto: null, brutto: null })],
    EIN,
    z,
  )
  const { alle } = ordnePersonenkontenZu([], p.rechnungen, p.belege)
  const b = erstelleBuchungen(p, EIN, alle, { rechnungen: { r1: ['Ausgangsrechnungen/x.pdf'] } })
  assertEquals(b.length, 4) // v9 ohne Betrag fehlt
  assertEquals(b[0], { umsatz: 1190, sollHaben: 'S', konto: 10000, gegenkonto: '8400', belegdatum: '2026-10-05', belegfeld1: 'RE-2026-001', buchungstext: 'RE-2026-001 Müller GmbH', belegDatei: 'Ausgangsrechnungen/x.pdf' })
  assertEquals(b[1].sollHaben, 'H')
  assertEquals(b[1].gegenkonto, '8300')
  const ionos = b.find((x) => x.belegfeld1 === 'R-77')!
  assertEquals([ionos.sollHaben, ionos.gegenkonto, ionos.buSchluessel, ionos.umsatz], ['H', '4806', '9', 119])
  const amazon = b.find((x) => x.buchungstext === 'Amazon')!
  assertEquals(amazon.buSchluessel, undefined)
  assertEquals(amazon.gegenkonto, '4930')
  assertEquals(amazon.belegfeld1, 'ER-v8')
  assertThrows(() => erstelleBuchungen(p, EIN, []))
})

Deno.test('Gesamte Übergabe: Dateien, Zeichensatz, Spalten', () => {
  const z = monatsZeitraum(2026, 10)
  const p = pruefeExport([rechnung({ kundeName: 'Müller „Bau“ GmbH; Ulm' })], [beleg()], EIN, z)
  const { alle } = ordnePersonenkontenZu([], p.rechnungen, p.belege)
  const pfadR = 'Ausgangsrechnungen/2026-10-05 RE-2026-001.pdf'
  const pfadB = eingangsbelegPfad(p.belege[0], 'rechnung.PDF')
  assertEquals(pfadB, 'Eingangsbelege/2026-10-10 IONOS R-77.pdf')
  const erg = erstelleExportDateien(p, EIN, alle, {
    erzeugtAm: new Date(2026, 10, 22, 10, 0, 0),
    erstelltVon: 'Eray',
    dateien: { rechnungen: { r1: [pfadR] }, belege: { [p.belege[0].id]: [pfadB] } },
    belegPfade: [pfadR, pfadB],
  })
  assertEquals(erg.dateien.map((d) => d.name), ['EXTF_Buchungsstapel_2026-10.csv', 'Rechnungsausgangsbuch_2026-10.csv', 'Rechnungseingangsbuch_2026-10.csv', 'Personenkonten.csv', 'Hinweise.txt'])
  const datev = erg.dateien[0].inhalt
  // Windows-1252: „ = 0x84, ü = 0xFC, kein UTF-8
  assert(datev.includes(0x84))
  assert(datev.includes(0xfc))
  const text = new TextDecoder('windows-1252').decode(datev)
  const zeilen = text.split('\r\n').filter(Boolean)
  assertEquals(zeilen.length, 4)
  assertEquals(zeilen[1].split(';').length, 125)
  assertEquals(zeilen[2].split(';').length, 125 + 1) // ein Semikolon im (in Anführungszeichen stehenden) Buchungstext
  assert(zeilen[2].startsWith('1190,00;"S";"EUR";;;;10000;8400;;0510;"RE-2026-001";;;"RE-2026-001 Müller „Bau“ GmbH; Ulm";'))
  assertStringIncludes(zeilen[2], `"Dateiname";"${pfadR}"`)
  assert(zeilen[3].startsWith('119,00;"H";"EUR";;;;70000;4806;"9";1010;"R-77";;;"IONOS R-77";'))
  const ausgang = new TextDecoder('utf-8', { ignoreBOM: true }).decode(erg.dateien[1].inhalt)
  assert(ausgang.startsWith('\ufeffRechnungsnummer;'))
  assertStringIncludes(ausgang, 'RE-2026-001;05.10.2026;"Müller „Bau“ GmbH; Ulm";10000;;1000,00;19 %;190,00;1190,00;8400;Versendet;;0,00;1190,00;Ausgangsrechnungen/2026-10-05 RE-2026-001.pdf')
  const eingang = new TextDecoder().decode(erg.dateien[2].inhalt)
  assertStringIncludes(eingang, '10.10.2026;IONOS;R-77;Software & Hosting;70000;4806;100,00;19 %;19,00;119,00;ja;offen;;ja;Eingangsbelege/2026-10-10 IONOS R-77.pdf')
  const konten = new TextDecoder().decode(erg.dateien[3].inhalt)
  assertStringIncludes(konten, '10000;Debitor (Kunde);')
  assertStringIncludes(konten, '70000;Kreditor (Lieferant);IONOS')
  const hinweise = new TextDecoder().decode(erg.dateien[4].inhalt)
  assertStringIncludes(hinweise, 'Oktober 2026')
  assertStringIncludes(hinweise, 'vom Steuerberater bestätigt')
  assertStringIncludes(hinweise, 'Eingangsbelege/ — 1 Datei(en)')
  // ohne Beleginfo
  const ohne = erstelleExportDateien(p, { ...EIN, belegInfo: false }, alle, { erzeugtAm: new Date(), dateien: { rechnungen: { r1: [pfadR] } } })
  assert(!new TextDecoder('windows-1252').decode(ohne.dateien[0].inhalt).includes('Dateiname'))
})

Deno.test('Zeichensätze', () => {
  assertEquals([...alsWindows1252('€äß–✓')], [0x80, 0xe4, 0xdf, 0x96, 0x3f])
  assertEquals([...alsUtf8MitKennung('a')], [0xef, 0xbb, 0xbf, 0x61])
})

Deno.test('Pfade eindeutig', () => {
  const v = new Set<string>()
  assertEquals(eindeutigerPfad('A/x.pdf', v), 'A/x.pdf')
  assertEquals(eindeutigerPfad('A/X.pdf', v), 'A/X (2).pdf')
  assertEquals(eindeutigerPfad('A/x.pdf', v), 'A/x (3).pdf')
  assertEquals(eingangsbelegPfad({ datum: '2026-11-20', lieferant: 'Euro/car', rechnungsnummer: undefined }, 'a.jpeg', undefined, 2, 3), 'Eingangsbelege/2026-11-20 Euro-car (2).jpeg')
  assertEquals(eingangsbelegPfad({ datum: '2026-11-20', lieferant: '', rechnungsnummer: 'x' }, 'ohne', 'image/png'), 'Eingangsbelege/2026-11-20 Ohne Lieferant x.png')
})

// ─── ZIP ─────────────────────────────────────────────────────────────────────────────────────────

Deno.test('ZIP: CRC und Rücklesen', async () => {
  assertEquals(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  const a = new TextEncoder().encode('Hallo Steuerberater')
  const b = new Uint8Array(70000).map((_, i) => i % 251)
  const zip = erstelleZip([{ name: 'Hinweise.txt', inhalt: a }, { name: 'Eingangsbelege/Müller Ä.pdf', inhalt: b }, { name: '/../leer.txt', inhalt: new Uint8Array(0) }])
  const zurueck = leseZip(zip)
  assertEquals(zurueck.map((x) => x.name), ['Hinweise.txt', 'Eingangsbelege/Müller Ä.pdf', 'leer.txt'])
  assert(zurueck.every((x) => x.crcStimmt))
  assertEquals(zurueck[1].inhalt.length, 70000)
  assertThrows(() => erstelleZip([{ name: 'a', inhalt: a }, { name: 'a', inhalt: a }]))
  // Gegenprobe mit dem Systemprogramm „unzip“, falls vorhanden
  try {
    const datei = await Deno.makeTempFile({ suffix: '.zip' })
    await Deno.writeFile(datei, zip)
    const aus = await new Deno.Command('unzip', { args: ['-t', datei], stdout: 'piped', stderr: 'piped' }).output()
    await Deno.remove(datei)
    assert(aus.success, new TextDecoder().decode(aus.stdout) + new TextDecoder().decode(aus.stderr))
    assertStringIncludes(new TextDecoder().decode(aus.stdout), 'No errors detected')
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return
    throw e
  }
})
