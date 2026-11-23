// XRechnung erzeugen (Modul „E-Rechnung“, 23.11.2026): eigene Ausgangsrechnungen als XRechnung 3.0 in der
// CII-Schreibweise (UN/CEFACT CrossIndustryInvoice) — das ist eine vollwertige E-Rechnung nach § 14 UStG.
// Reihenfolge der Elemente folgt dem CII-Schema, Pflichtangaben nach XRechnung (BR-DE-…) werden vorab mit
// pruefeXRechnung als deutsche Meldungen geprüft. Läuft gleich im Browser und auf dem Server.
import { maske } from './xml.ts'
import type { ERechnungPartei } from './lesen.ts'

export type XRechnungVerkaeufer = ERechnungPartei & {
  /** Ansprechpartner (BR-DE-5), Telefon (BR-DE-6), E-Mail (BR-DE-7) */
  kontaktName: string
  telefon: string
  email: string
  registernummer?: string
}

export type XRechnungEingabe = {
  nummer: string
  /** JJJJ-MM-TT */
  datum: string
  faellig?: string
  leistungsdatum?: string
  /** Freitext wie „01.–31.10.2026“ (erscheint als Hinweis) */
  leistungszeitraum?: string
  verkaeufer: XRechnungVerkaeufer
  kaeufer: ERechnungPartei
  /** Käuferreferenz (BT-10, Pflicht in XRechnung): Leitweg-ID bei Behörden, sonst z. B. Kundennummer. */
  kaeuferReferenz: string
  iban?: string
  positionen: { bezeichnung: string; menge: number; einheit: string; einzelpreis: number }[]
  /** Prozent, z. B. 19 oder 0 */
  ustSatz: number
  /** Pflicht bei 0 %: Grund der Steuerbefreiung (z. B. „Kleinunternehmer gemäß § 19 UStG“). */
  steuerbefreiungGrund?: string
  hinweise?: string[]
  zahlungsbedingungen?: string
}

const ct = (n: number) => Math.round(n * 100) / 100
const betrag = (n: number) => ct(n).toFixed(2)
const menge = (n: number) => String(Math.round(n * 10000) / 10000)
const datum102 = (iso: string) => iso.slice(0, 10).replace(/-/g, '')
const deDatum = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.')

/** Deutsche Einheit → UN/ECE-Einheitencode (Rec. 20). Unbekanntes zählt als Stück. */
export function einheitCode(einheit: string): string {
  const e = einheit.trim().toLowerCase()
  if (/^(std|stunde|stunden|h)\.?$/.test(e)) return 'HUR'
  if (/^(tag|tage|tg)\.?$/.test(e)) return 'DAY'
  if (/^(monat|monate|mon)\.?$/.test(e)) return 'MON'
  if (/^(woche|wochen)$/.test(e)) return 'WEE'
  if (/^(jahr|jahre)$/.test(e)) return 'ANN'
  if (/^(min|minute|minuten)\.?$/.test(e)) return 'MIN'
  if (/^km$/.test(e)) return 'KMT'
  if (/^(pauschal|pauschale|psch|pausch)\.?$/.test(e)) return 'LS'
  return 'C62'
}

export function summen(e: Pick<XRechnungEingabe, 'positionen' | 'ustSatz'>) {
  const zeilen = e.positionen.map((p) => ct(p.menge * p.einzelpreis))
  const netto = ct(zeilen.reduce((a, b) => a + b, 0))
  const steuer = ct((netto * e.ustSatz) / 100)
  return { zeilen, netto, steuer, brutto: ct(netto + steuer) }
}

const ADRESSE = /^\s*(\d{5})\s+(.+)$/

/** Fehlende Pflichtangaben als deutsche Sätze; leer = die XRechnung kann erzeugt werden. */
export function pruefeXRechnung(e: XRechnungEingabe): string[] {
  const f: string[] = []
  if (!e.nummer.trim()) f.push('Rechnungsnummer fehlt.')
  if (!/^\d{4}-\d{2}-\d{2}/.test(e.datum)) f.push('Rechnungsdatum fehlt.')
  if (!e.verkaeufer.name.trim()) f.push('Name des Absenders fehlt.')
  if (!e.verkaeufer.plz || !e.verkaeufer.ort || !e.verkaeufer.strasse) f.push('Anschrift des Absenders ist unvollständig.')
  if (!e.verkaeufer.ustId && !e.verkaeufer.steuernummer) f.push('Steuernummer oder USt-IdNr. des Absenders fehlt.')
  if (!e.verkaeufer.kontaktName.trim()) f.push('Ansprechpartner des Absenders fehlt.')
  if (!e.verkaeufer.telefon.trim()) f.push('Telefonnummer des Absenders fehlt.')
  if (!/@/.test(e.verkaeufer.email)) f.push('E-Mail-Adresse des Absenders fehlt.')
  if (!e.kaeufer.name.trim()) f.push('Name des Empfängers fehlt.')
  if (!e.kaeufer.plz || !e.kaeufer.ort) f.push('Postleitzahl und Ort des Empfängers fehlen (letzte Zeile der Anschrift, z. B. „89075 Ulm“).')
  if (!e.kaeufer.email || !/@/.test(e.kaeufer.email)) f.push('E-Mail-Adresse des Empfängers fehlt (in der Akte eintragen).')
  if (!e.kaeuferReferenz.trim()) f.push('Käuferreferenz fehlt.')
  if (!e.iban) f.push('IBAN für die Zahlung fehlt.')
  if (e.positionen.length === 0) f.push('Die Rechnung hat keine Positionen.')
  if (e.positionen.some((p) => !p.bezeichnung.trim())) f.push('Eine Position hat keine Bezeichnung.')
  if (e.ustSatz === 0 && !e.steuerbefreiungGrund?.trim()) f.push('Bei 0 % Umsatzsteuer muss der Grund im Hinweis stehen (z. B. „Kleinunternehmer gemäß § 19 UStG“).')
  return f
}

function partei(tag: 'SellerTradeParty' | 'BuyerTradeParty', p: ERechnungPartei, extra: { kontakt?: XRechnungVerkaeufer; register?: string }): string {
  const z: string[] = [`<ram:${tag}>`, `<ram:Name>${maske(p.name)}</ram:Name>`]
  if (extra.register) z.push(`<ram:SpecifiedLegalOrganization><ram:ID>${maske(extra.register)}</ram:ID></ram:SpecifiedLegalOrganization>`)
  if (extra.kontakt) {
    z.push(
      '<ram:DefinedTradeContact>',
      `<ram:PersonName>${maske(extra.kontakt.kontaktName)}</ram:PersonName>`,
      `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${maske(extra.kontakt.telefon)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>`,
      `<ram:EmailURIUniversalCommunication><ram:URIID>${maske(extra.kontakt.email)}</ram:URIID></ram:EmailURIUniversalCommunication>`,
      '</ram:DefinedTradeContact>',
    )
  }
  z.push('<ram:PostalTradeAddress>')
  if (p.plz) z.push(`<ram:PostcodeCode>${maske(p.plz)}</ram:PostcodeCode>`)
  if (p.strasse) z.push(`<ram:LineOne>${maske(p.strasse)}</ram:LineOne>`)
  if (p.ort) z.push(`<ram:CityName>${maske(p.ort)}</ram:CityName>`)
  z.push(`<ram:CountryID>${maske(p.land || 'DE')}</ram:CountryID>`, '</ram:PostalTradeAddress>')
  if (p.email) z.push(`<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${maske(p.email)}</ram:URIID></ram:URIUniversalCommunication>`)
  if (p.ustId) z.push(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${maske(p.ustId)}</ram:ID></ram:SpecifiedTaxRegistration>`)
  if (p.steuernummer) z.push(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${maske(p.steuernummer)}</ram:ID></ram:SpecifiedTaxRegistration>`)
  z.push(`</ram:${tag}>`)
  return z.join('')
}

/** Erzeugt die XRechnung (CII) als XML-Text. Vorher pruefeXRechnung aufrufen; wirft bei fehlenden Angaben. */
export function erzeugeXRechnung(e: XRechnungEingabe): string {
  const fehler = pruefeXRechnung(e)
  if (fehler.length) throw new Error(`XRechnung nicht möglich: ${fehler.join(' ')}`)
  const { zeilen, netto, steuer, brutto } = summen(e)
  const kategorie = e.ustSatz > 0 ? 'S' : 'E'
  const steuerZeile = (mitBetrag: boolean) =>
    [
      '<ram:ApplicableTradeTax>',
      mitBetrag ? `<ram:CalculatedAmount>${betrag(steuer)}</ram:CalculatedAmount>` : '',
      '<ram:TypeCode>VAT</ram:TypeCode>',
      mitBetrag && kategorie === 'E' ? `<ram:ExemptionReason>${maske(e.steuerbefreiungGrund ?? '')}</ram:ExemptionReason>` : '',
      mitBetrag ? `<ram:BasisAmount>${betrag(netto)}</ram:BasisAmount>` : '',
      `<ram:CategoryCode>${kategorie}</ram:CategoryCode>`,
      `<ram:RateApplicablePercent>${menge(e.ustSatz)}</ram:RateApplicablePercent>`,
      '</ram:ApplicableTradeTax>',
    ].join('')
  const hinweise = [...(e.hinweise ?? []), ...(e.leistungszeitraum ? [`Leistungszeitraum: ${e.leistungszeitraum}`] : [])].filter((h) => h.trim())
  const faellig = e.faellig && /^\d{4}-\d{2}-\d{2}/.test(e.faellig) ? e.faellig : ''
  const bedingungen = e.zahlungsbedingungen || (faellig ? `Zahlbar ohne Abzug bis ${deDatum(faellig)}.` : '')

  const x: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">',
    '<rsm:ExchangedDocumentContext>',
    '<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>',
    '<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>',
    '</rsm:ExchangedDocumentContext>',
    '<rsm:ExchangedDocument>',
    `<ram:ID>${maske(e.nummer)}</ram:ID>`,
    '<ram:TypeCode>380</ram:TypeCode>',
    `<ram:IssueDateTime><udt:DateTimeString format="102">${datum102(e.datum)}</udt:DateTimeString></ram:IssueDateTime>`,
    ...hinweise.map((h) => `<ram:IncludedNote><ram:Content>${maske(h)}</ram:Content></ram:IncludedNote>`),
    '</rsm:ExchangedDocument>',
    '<rsm:SupplyChainTradeTransaction>',
  ]
  e.positionen.forEach((p, i) => {
    x.push(
      '<ram:IncludedSupplyChainTradeLineItem>',
      `<ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>`,
      `<ram:SpecifiedTradeProduct><ram:Name>${maske(p.bezeichnung)}</ram:Name></ram:SpecifiedTradeProduct>`,
      `<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${betrag(p.einzelpreis)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>`,
      `<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${einheitCode(p.einheit)}">${menge(p.menge)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>`,
      '<ram:SpecifiedLineTradeSettlement>',
      steuerZeile(false),
      `<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${betrag(zeilen[i])}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>`,
      '</ram:SpecifiedLineTradeSettlement>',
      '</ram:IncludedSupplyChainTradeLineItem>',
    )
  })
  x.push(
    '<ram:ApplicableHeaderTradeAgreement>',
    `<ram:BuyerReference>${maske(e.kaeuferReferenz)}</ram:BuyerReference>`,
    partei('SellerTradeParty', e.verkaeufer, { kontakt: e.verkaeufer, register: e.verkaeufer.registernummer }),
    partei('BuyerTradeParty', e.kaeufer, {}),
    '</ram:ApplicableHeaderTradeAgreement>',
    '<ram:ApplicableHeaderTradeDelivery>',
    `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${datum102(e.leistungsdatum && /^\d{4}-\d{2}-\d{2}/.test(e.leistungsdatum) ? e.leistungsdatum : e.datum)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>`,
    '</ram:ApplicableHeaderTradeDelivery>',
    '<ram:ApplicableHeaderTradeSettlement>',
    '<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>',
    `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${maske((e.iban ?? '').replace(/\s/g, ''))}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>`,
    steuerZeile(true),
    bedingungen || faellig
      ? `<ram:SpecifiedTradePaymentTerms>${bedingungen ? `<ram:Description>${maske(bedingungen)}</ram:Description>` : ''}${faellig ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${datum102(faellig)}</udt:DateTimeString></ram:DueDateDateTime>` : ''}</ram:SpecifiedTradePaymentTerms>`
      : '',
    '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    `<ram:LineTotalAmount>${betrag(netto)}</ram:LineTotalAmount>`,
    `<ram:TaxBasisTotalAmount>${betrag(netto)}</ram:TaxBasisTotalAmount>`,
    `<ram:TaxTotalAmount currencyID="EUR">${betrag(steuer)}</ram:TaxTotalAmount>`,
    `<ram:GrandTotalAmount>${betrag(brutto)}</ram:GrandTotalAmount>`,
    `<ram:DuePayableAmount>${betrag(brutto)}</ram:DuePayableAmount>`,
    '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    '</ram:ApplicableHeaderTradeSettlement>',
    '</rsm:SupplyChainTradeTransaction>',
    '</rsm:CrossIndustryInvoice>',
  )
  return x.filter(Boolean).join('\n')
}

// ---------- Angaben aus dem Briefkopf und der Rechnungsanschrift ----------

/**
 * Verkäuferangaben aus den Fußzeilen des Briefkopfs (Tabelle vorlagen, id „briefkopf“): IBAN, Steuernummer,
 * USt-IdNr., Handelsregister, Telefon, Geschäftsführer. Anschrift aus der ersten Fußzeile („… · Straße · PLZ Ort · …“).
 */
export function verkaeuferAusBriefkopf(b: { name: string; fusszeilen: string[]; unterzeilen?: string[] }, email: string): { verkaeufer: XRechnungVerkaeufer; iban?: string } {
  const alles = [...b.fusszeilen, ...(b.unterzeilen ?? [])].join(' · ')
  const teile = alles.split(/\s*[·|]\s*/).map((t) => t.trim()).filter(Boolean)
  const plzOrt = teile.map((t) => t.match(/^(\d{5})\s+(.+)$/)).find(Boolean)
  const strasse = teile.find((t) => /(stra(ss|ß)e|str\.|weg|platz|allee|gasse)\s*\d/i.test(t))?.replace(/,\s*\d{5}.*$/, '')
  const plzAusStrasse = teile.map((t) => t.match(/,\s*(\d{5})\s+(.+)$/)).find(Boolean)
  const ort = plzOrt ?? plzAusStrasse
  const firma = teile.find((t) => /\b(UG|GmbH|AG|KG|e\.K\.|OHG|GbR)\b/.test(t)) ?? b.name
  const iban = alles.match(/IBAN:?\s*([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?)/)?.[1]?.replace(/\s/g, '')
  return {
    iban,
    verkaeufer: {
      name: firma,
      strasse: strasse || undefined,
      plz: ort?.[1],
      ort: ort?.[2]?.trim(),
      land: 'DE',
      steuernummer: alles.match(/Steuer(?:nummer|-Nr\.?|nr\.?):?\s*([\d/ ]{8,20}\d)/i)?.[1]?.trim(),
      ustId: alles.match(/\b(DE\s?\d{9})\b/)?.[1]?.replace(/\s/g, ''),
      registernummer: alles.match(/\b(Amtsgericht\s+[^,·]+,\s*HR[AB]\s*\d+|HR[AB]\s*\d+)/)?.[1]?.trim(),
      telefon: alles.match(/Tel(?:efon|\.)?:?\s*(\+?[\d /()-]{6,}\d)/i)?.[1]?.trim() ?? '',
      kontaktName: alles.match(/(?:GF|Geschäftsführer(?:in)?):?\s*([^,·]+)/)?.[1]?.trim() ?? '',
      email,
    },
  }
}

/** Empfänger aus der Rechnungsanschrift (eine Angabe je Zeile: Name, …, Straße, PLZ Ort). */
export function kaeuferAusAnschrift(anschrift: string, ersatzName: string, email?: string): ERechnungPartei {
  const zeilen = anschrift.split(/\n/).map((z) => z.trim()).filter(Boolean)
  const idxOrt = zeilen.findIndex((z) => ADRESSE.test(z))
  const ortZeile = idxOrt >= 0 ? zeilen[idxOrt].match(ADRESSE) : null
  const vorOrt = idxOrt >= 0 ? zeilen.slice(0, idxOrt) : zeilen
  return {
    name: vorOrt[0] || ersatzName,
    strasse: vorOrt.length > 1 ? vorOrt[vorOrt.length - 1] : undefined,
    plz: ortZeile?.[1],
    ort: ortZeile?.[2],
    land: zeilen.some((z) => /^(österreich|austria)$/i.test(z)) ? 'AT' : zeilen.some((z) => /^(schweiz|switzerland)$/i.test(z)) ? 'CH' : 'DE',
    email: email || undefined,
  }
}
