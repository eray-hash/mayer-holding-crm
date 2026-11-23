import { assert, assertEquals, assertMatch, assertRejects, assertThrows } from 'jsr:@std/assert@1'
import { einheitCode, erzeugeXRechnung, kaeuferAusAnschrift, pruefeXRechnung, verkaeuferAusBriefkopf, type XRechnungEingabe } from './erzeugen.ts'
import { eRechnungKurz, istERechnungXml, leseERechnung } from './lesen.ts'
import { eRechnungsXmlAusDatei, xmlAusPdf } from './pdfXml.ts'

const BRIEFKOPF = {
  name: 'Beispiel Holding',
  fusszeilen: [
    'Beispiel Holding UG · Musterstraße 3 · 89075 Ulm · Amtsgericht Ulm, HRB 123456',
    'Sparkasse · IBAN: DE02 1203 0000 0000 2020 51 · Steuernummer 88 123 456 789',
    'Tel.: 0731 123 456 · www.beispiel.de · GF: Erika Muster, Dipl.-Kffr.',
  ],
}

function eingabe(): XRechnungEingabe {
  const { verkaeufer, iban } = verkaeuferAusBriefkopf(BRIEFKOPF, 'info@beispiel.de')
  return {
    nummer: 'RE-2026-007',
    datum: '2026-11-23',
    faellig: '2026-12-07',
    leistungszeitraum: '01.–31.10.2026',
    verkaeufer,
    iban,
    kaeufer: kaeuferAusAnschrift('Muster GmbH\nz. Hd. Herrn Beispiel\nHauptstraße 1\n70173 Stuttgart', 'Muster GmbH', 'buchhaltung@muster.de'),
    kaeuferReferenz: 'k_123',
    positionen: [
      { bezeichnung: 'Beratung Nachfolge & Übergabe', menge: 2.5, einheit: 'Stunde', einzelpreis: 120 },
      { bezeichnung: 'Reisekosten', menge: 1, einheit: 'Pauschale', einzelpreis: 49.9 },
    ],
    ustSatz: 19,
  }
}

Deno.test('Briefkopf: Verkäuferangaben werden aus den Fußzeilen gelesen', () => {
  const { verkaeufer, iban } = verkaeuferAusBriefkopf(BRIEFKOPF, 'info@beispiel.de')
  assertEquals(iban, 'DE02120300000000202051')
  assertEquals(verkaeufer.name, 'Beispiel Holding UG')
  assertEquals([verkaeufer.strasse, verkaeufer.plz, verkaeufer.ort], ['Musterstraße 3', '89075', 'Ulm'])
  assertEquals(verkaeufer.steuernummer, '88 123 456 789')
  assertEquals(verkaeufer.registernummer, 'Amtsgericht Ulm, HRB 123456')
  assertEquals(verkaeufer.telefon, '0731 123 456')
  assertEquals(verkaeufer.kontaktName, 'Erika Muster')
})

Deno.test('Anschrift: Name, Straße, PLZ und Ort', () => {
  const k = kaeuferAusAnschrift('Muster GmbH\nz. Hd. Herrn Beispiel\nHauptstraße 1\n70173 Stuttgart', 'Ersatz', 'a@b.de')
  assertEquals([k.name, k.strasse, k.plz, k.ort, k.land], ['Muster GmbH', 'Hauptstraße 1', '70173', 'Stuttgart', 'DE'])
  assertEquals(kaeuferAusAnschrift('', 'Ersatz').name, 'Ersatz')
})

Deno.test('XRechnung: erzeugen und wieder lesen ergibt dieselben Angaben', () => {
  const xml = erzeugeXRechnung(eingabe())
  assert(istERechnungXml(xml))
  assertMatch(xml, /xrechnung_3\.0/)
  assertMatch(xml, /Nachfolge &amp; Übergabe/)
  assertMatch(xml, /unitCode="HUR">2\.5</)
  assertMatch(xml, /unitCode="LS">1</)
  const d = leseERechnung(xml)
  assertEquals(d.format, 'CII')
  assertEquals(d.nummer, 'RE-2026-007')
  assertEquals(d.datum, '2026-11-23')
  assertEquals(d.faellig, '2026-12-07')
  assertEquals(d.netto, 349.9)
  assertEquals(d.steuer, 66.48)
  assertEquals(d.brutto, 416.38)
  assertEquals(d.zahlbetrag, 416.38)
  assertEquals(d.iban, 'DE02120300000000202051')
  assertEquals(d.verkaeufer.steuernummer, '88 123 456 789')
  assertEquals(d.verkaeufer.email, 'info@beispiel.de')
  assertEquals(d.kaeufer.name, 'Muster GmbH')
  assertEquals(d.positionen.map((p) => [p.bezeichnung, p.menge, p.einheit, p.netto]), [
    ['Beratung Nachfolge & Übergabe', 2.5, 'Stunde', 300],
    ['Reisekosten', 1, 'Pauschale', 49.9],
  ])
  assert(d.hinweise.some((h) => h.includes('Leistungszeitraum')))
  assertMatch(eRechnungKurz(d), /IBAN DE02/)
})

Deno.test('XRechnung: fehlende Pflichtangaben als deutsche Meldungen, 0 % braucht einen Grund', () => {
  const e = eingabe()
  e.kaeufer.email = undefined
  e.ustSatz = 0
  const f = pruefeXRechnung(e)
  assert(f.some((m) => m.includes('E-Mail-Adresse des Empfängers')))
  assert(f.some((m) => m.includes('0 % Umsatzsteuer')))
  assertThrows(() => erzeugeXRechnung(e), Error, 'XRechnung nicht möglich')
  e.kaeufer.email = 'x@y.de'
  e.steuerbefreiungGrund = 'Kleinunternehmer gemäß § 19 UStG'
  const xml = erzeugeXRechnung(e)
  assertMatch(xml, /<ram:CategoryCode>E<\/ram:CategoryCode>/)
  assertMatch(xml, /<ram:ExemptionReason>Kleinunternehmer/)
  assertEquals(leseERechnung(xml).steuer, 0)
})

Deno.test('Einheiten-Codes', () => {
  assertEquals(['Std.', 'Tag', 'Monat', 'pauschal', 'Stück', 'km'].map(einheitCode), ['HUR', 'DAY', 'MON', 'LS', 'C62', 'KMT'])
})

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ID>4711</cbc:ID>
  <cbc:IssueDate>2026-11-02</cbc:IssueDate>
  <cbc:DueDate>2026-11-16</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:Note>Vielen Dank für Ihren Auftrag</cbc:Note>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cbc:EndpointID schemeID="EM">rechnung@lieferant.de</cbc:EndpointID>
    <cac:PostalAddress><cbc:StreetName>Werkstr. 5</cbc:StreetName><cbc:CityName>Augsburg</cbc:CityName><cbc:PostalZone>86150</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>DE123456789</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Lieferant &amp; Söhne GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
    <cac:Contact><cbc:Telephone>0821 99</cbc:Telephone><cbc:ElectronicMail>buero@lieferant.de</cbc:ElectronicMail></cac:Contact>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Beispiel Holding UG</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>DE89370400440532013000</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:PaymentTerms><cbc:Note>14 Tage netto</cbc:Note></cac:PaymentTerms>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">119.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">4</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Druckerpatrone</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">25.00</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
</Invoice>`

Deno.test('UBL-XRechnung lesen', () => {
  const d = leseERechnung(UBL)
  assertEquals(d.format, 'UBL')
  assertEquals([d.nummer, d.datum, d.faellig], ['4711', '2026-11-02', '2026-11-16'])
  assertEquals(d.verkaeufer.name, 'Lieferant & Söhne GmbH')
  assertEquals(d.verkaeufer.ustId, 'DE123456789')
  assertEquals(d.verkaeufer.email, 'buero@lieferant.de')
  assertEquals([d.netto, d.steuer, d.brutto], [100, 19, 119])
  assertEquals(d.iban, 'DE89370400440532013000')
  assertEquals(d.positionen[0], { bezeichnung: 'Druckerpatrone', menge: 4, einheit: 'Stück', einzelpreis: 25, netto: 100 })
  assertEquals(d.zahlungsbedingungen, '14 Tage netto')
})

Deno.test('Keine E-Rechnung: verständliche Meldung', () => {
  assertThrows(() => leseERechnung('<html><body>Hallo</body></html>'), Error, 'keine E-Rechnung')
  assertThrows(() => leseERechnung('kein xml'), Error)
  assert(!istERechnungXml('<note>x</note>'))
})

async function packe(text: string): Promise<Uint8Array> {
  const strom = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(strom).arrayBuffer())
}

Deno.test('ZUGFeRD-PDF: eingebettete XML wird gefunden (gepackt und ungepackt)', async () => {
  const xml = erzeugeXRechnung(eingabe())
  const gepackt = await packe(xml)
  const kopf = new TextEncoder().encode(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n5 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml /Filter /FlateDecode /Length ${gepackt.length} >>\nstream\n`)
  const fuss = new TextEncoder().encode('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
  const pdf = new Uint8Array([...kopf, ...gepackt, ...fuss])
  const gefunden = await xmlAusPdf(pdf)
  assertEquals(gefunden, xml)
  assertEquals(leseERechnung(gefunden!).nummer, 'RE-2026-007')
  // Ungepackt, Länge als Verweis (wie viele Programme schreiben)
  const roh = new TextEncoder().encode(`%PDF-1.4\n7 0 obj\n<< /Length 8 0 R /Type /EmbeddedFile >>\nstream\n${xml}\nendstream\nendobj\n%%EOF`)
  assertEquals((await eRechnungsXmlAusDatei(roh, 'rechnung.pdf'))?.trim(), xml)
  // Gewöhnliche PDF ohne Anhang
  assertEquals(await xmlAusPdf(new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF')), null)
  // XML-Datei direkt
  assertEquals(await eRechnungsXmlAusDatei(new TextEncoder().encode(UBL), 'r.xml'), UBL)
  await assertRejects(async () => {
    const d = await eRechnungsXmlAusDatei(new TextEncoder().encode('<a/>'), 'a.xml')
    if (!d) throw new Error('keine')
  })
})
