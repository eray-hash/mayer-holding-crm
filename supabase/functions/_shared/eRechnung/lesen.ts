// E-Rechnungen lesen (Modul „E-Rechnung“, 23.11.2026): XRechnung/ZUGFeRD/Factur-X in beiden Schreibweisen —
// UN/CEFACT CII (CrossIndustryInvoice, auch die XML in ZUGFeRD-PDFs) und OASIS UBL (Invoice/CreditNote).
// Ergebnis ist ein einheitliches Objekt, aus dem das CRM eine Verbindlichkeit macht. Ohne KI: Die Angaben
// stehen in der Datei maschinenlesbar und werden genau übernommen.
import { kind, kinder, leseXml, text, type XmlKnoten } from './xml.ts'

export type ERechnungPartei = {
  name: string
  strasse?: string
  plz?: string
  ort?: string
  land?: string
  ustId?: string
  steuernummer?: string
  email?: string
  telefon?: string
}

export type ERechnungPosition = { bezeichnung: string; menge: number; einheit: string; einzelpreis: number; netto: number }

export type ERechnungDaten = {
  format: 'CII' | 'UBL'
  art: 'Rechnung' | 'Gutschrift'
  nummer: string
  /** JJJJ-MM-TT */
  datum: string
  faellig?: string
  leistungsdatum?: string
  waehrung: string
  verkaeufer: ERechnungPartei
  kaeufer: ERechnungPartei
  iban?: string
  zahlungsbedingungen?: string
  netto: number
  steuer: number
  brutto: number
  zahlbetrag: number
  positionen: ERechnungPosition[]
  hinweise: string[]
}

const zahl = (s: string): number => {
  const n = Number(String(s ?? '').trim())
  return Number.isFinite(n) ? n : 0
}

/** CII-Datum (Format 102 = JJJJMMTT) oder UBL-Datum (JJJJ-MM-TT) → JJJJ-MM-TT, sonst ''. */
function datumAus(s: string): string {
  const t = String(s ?? '').trim()
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  return ''
}

const EINHEITEN: Record<string, string> = { HUR: 'Stunde', DAY: 'Tag', MON: 'Monat', C62: 'Stück', H87: 'Stück', LS: 'Pauschale', KMT: 'km', XPP: 'Stück', MIN: 'Minute', WEE: 'Woche', ANN: 'Jahr' }
const einheitName = (code: string) => EINHEITEN[code] ?? code ?? ''

// ---------- CII ----------

function ciiPartei(p: XmlKnoten | undefined): ERechnungPartei {
  const adr = kind(p, 'PostalTradeAddress')
  const steuer = kinder(p, 'SpecifiedTaxRegistration').map((r) => kind(r, 'ID')).filter(Boolean) as XmlKnoten[]
  const kontakt = kind(p, 'DefinedTradeContact')
  return {
    name: text(p, 'Name') || text(p, 'SpecifiedLegalOrganization/TradingBusinessName'),
    strasse: [text(adr, 'LineOne'), text(adr, 'LineTwo')].filter(Boolean).join(', ') || undefined,
    plz: text(adr, 'PostcodeCode') || undefined,
    ort: text(adr, 'CityName') || undefined,
    land: text(adr, 'CountryID') || undefined,
    ustId: steuer.find((s) => s.attr.schemeID === 'VA')?.text.trim() || undefined,
    steuernummer: steuer.find((s) => s.attr.schemeID === 'FC')?.text.trim() || undefined,
    email: text(kontakt, 'EmailURIUniversalCommunication/URIID') || text(p, 'URIUniversalCommunication/URIID') || undefined,
    telefon: text(kontakt, 'TelephoneUniversalCommunication/CompleteNumber') || undefined,
  }
}

function leseCii(w: XmlKnoten): ERechnungDaten {
  const dok = kind(w, 'ExchangedDocument')
  const tx = kind(w, 'SupplyChainTradeTransaction')
  const vereinbarung = kind(tx, 'ApplicableHeaderTradeAgreement')
  const abrechnung = kind(tx, 'ApplicableHeaderTradeSettlement')
  const summen = kind(abrechnung, 'SpecifiedTradeSettlementHeaderMonetarySummation')
  const typ = text(dok, 'TypeCode')
  const steuerGesamt = kinder(summen, 'TaxTotalAmount')
  const waehrung = text(abrechnung, 'InvoiceCurrencyCode') || 'EUR'
  const steuer = zahl((steuerGesamt.find((t) => !t.attr.currencyID || t.attr.currencyID === waehrung) ?? steuerGesamt[0])?.text ?? '')
  const netto = zahl(text(summen, 'TaxBasisTotalAmount') || text(summen, 'LineTotalAmount'))
  const brutto = zahl(text(summen, 'GrandTotalAmount')) || netto + steuer
  const bedingungen = kind(abrechnung, 'SpecifiedTradePaymentTerms')
  const positionen = kinder(tx, 'IncludedSupplyChainTradeLineItem').map((z) => {
    const menge = kind(z, 'SpecifiedLineTradeDelivery/BilledQuantity')
    return {
      bezeichnung: text(z, 'SpecifiedTradeProduct/Name'),
      menge: zahl(menge?.text ?? ''),
      einheit: einheitName(menge?.attr.unitCode ?? ''),
      einzelpreis: zahl(text(z, 'SpecifiedLineTradeAgreement/NetPriceProductTradePrice/ChargeAmount')),
      netto: zahl(text(z, 'SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount')),
    }
  })
  return {
    format: 'CII',
    art: typ === '381' ? 'Gutschrift' : 'Rechnung',
    nummer: text(dok, 'ID'),
    datum: datumAus(text(dok, 'IssueDateTime/DateTimeString')),
    faellig: datumAus(text(bedingungen, 'DueDateDateTime/DateTimeString')) || undefined,
    leistungsdatum: datumAus(text(tx, 'ApplicableHeaderTradeDelivery/ActualDeliverySupplyChainEvent/OccurrenceDateTime/DateTimeString')) || undefined,
    waehrung,
    verkaeufer: ciiPartei(kind(vereinbarung, 'SellerTradeParty')),
    kaeufer: ciiPartei(kind(vereinbarung, 'BuyerTradeParty')),
    iban: kinder(abrechnung, 'SpecifiedTradeSettlementPaymentMeans').map((m) => text(m, 'PayeePartyCreditorFinancialAccount/IBANID')).find(Boolean) || undefined,
    zahlungsbedingungen: text(bedingungen, 'Description') || undefined,
    netto,
    steuer,
    brutto,
    zahlbetrag: zahl(text(summen, 'DuePayableAmount')) || brutto,
    positionen,
    hinweise: kinder(dok, 'IncludedNote').map((n) => text(n, 'Content')).filter(Boolean),
  }
}

// ---------- UBL ----------

function ublPartei(p: XmlKnoten | undefined): ERechnungPartei {
  const partei = kind(p, 'Party')
  const adr = kind(partei, 'PostalAddress')
  const steuer = kinder(partei, 'PartyTaxScheme')
  const ustId = steuer.find((s) => text(s, 'TaxScheme/ID') === 'VAT')
  const andere = steuer.find((s) => s !== ustId)
  return {
    name: text(partei, 'PartyName/Name') || text(partei, 'PartyLegalEntity/RegistrationName'),
    strasse: [text(adr, 'StreetName'), text(adr, 'AdditionalStreetName')].filter(Boolean).join(', ') || undefined,
    plz: text(adr, 'PostalZone') || undefined,
    ort: text(adr, 'CityName') || undefined,
    land: text(adr, 'Country/IdentificationCode') || undefined,
    ustId: text(ustId, 'CompanyID') || undefined,
    steuernummer: text(andere, 'CompanyID') || undefined,
    email: text(partei, 'Contact/ElectronicMail') || text(partei, 'EndpointID') || undefined,
    telefon: text(partei, 'Contact/Telephone') || undefined,
  }
}

function leseUbl(w: XmlKnoten): ERechnungDaten {
  const gutschrift = w.lokal === 'CreditNote'
  const summen = kind(w, 'LegalMonetaryTotal')
  const steuer = zahl(text(kind(w, 'TaxTotal'), 'TaxAmount'))
  const netto = zahl(text(summen, 'TaxExclusiveAmount') || text(summen, 'LineExtensionAmount'))
  const brutto = zahl(text(summen, 'TaxInclusiveAmount')) || netto + steuer
  const zeilen = kinder(w, gutschrift ? 'CreditNoteLine' : 'InvoiceLine')
  const positionen = zeilen.map((z) => {
    const menge = kind(z, gutschrift ? 'CreditedQuantity' : 'InvoicedQuantity')
    return {
      bezeichnung: text(z, 'Item/Name'),
      menge: zahl(menge?.text ?? ''),
      einheit: einheitName(menge?.attr.unitCode ?? ''),
      einzelpreis: zahl(text(z, 'Price/PriceAmount')),
      netto: zahl(text(z, 'LineExtensionAmount')),
    }
  })
  return {
    format: 'UBL',
    art: gutschrift ? 'Gutschrift' : 'Rechnung',
    nummer: text(w, 'ID'),
    datum: datumAus(text(w, 'IssueDate')),
    faellig: datumAus(text(w, 'DueDate') || text(w, 'PaymentMeans/PaymentDueDate')) || undefined,
    leistungsdatum: datumAus(text(w, 'Delivery/ActualDeliveryDate')) || undefined,
    waehrung: text(w, 'DocumentCurrencyCode') || 'EUR',
    verkaeufer: ublPartei(kind(w, 'AccountingSupplierParty')),
    kaeufer: ublPartei(kind(w, 'AccountingCustomerParty')),
    iban: kinder(w, 'PaymentMeans').map((m) => text(m, 'PayeeFinancialAccount/ID')).find(Boolean) || undefined,
    zahlungsbedingungen: text(w, 'PaymentTerms/Note') || undefined,
    netto,
    steuer,
    brutto,
    zahlbetrag: zahl(text(summen, 'PayableAmount')) || brutto,
    positionen,
    hinweise: kinder(w, 'Note').map((n) => text(n)).filter(Boolean),
  }
}

/** Ist dieser Text eine E-Rechnung (CII oder UBL)? Schnelle Prüfung ohne vollständiges Lesen. */
export function istERechnungXml(xml: string): boolean {
  return /<(\w+:)?(CrossIndustryInvoice|Invoice|CreditNote)[\s>]/.test(xml.slice(0, 5000)) && /urn:(un:unece:uncefact|oasis:names:specification:ubl)/.test(xml.slice(0, 5000))
}

/** Liest eine E-Rechnung; wirft mit verständlicher Meldung, wenn es keine ist. */
export function leseERechnung(xml: string): ERechnungDaten {
  let w: XmlKnoten
  try {
    w = leseXml(xml)
  } catch {
    throw new Error('Die Datei ist keine lesbare XML-Datei.')
  }
  const daten = w.lokal === 'CrossIndustryInvoice' ? leseCii(w) : w.lokal === 'Invoice' || w.lokal === 'CreditNote' ? leseUbl(w) : null
  if (!daten) throw new Error('Die Datei ist keine E-Rechnung (weder XRechnung noch ZUGFeRD).')
  if (!daten.nummer && !daten.verkaeufer.name && !daten.brutto) throw new Error('In der E-Rechnung fehlen Rechnungsnummer, Absender und Betrag.')
  return daten
}

/** Kurzbeschreibung für Notizen, z. B. „E-Rechnung (XRechnung, CII) · IBAN DE… · 3 Positionen“. */
export function eRechnungKurz(d: ERechnungDaten): string {
  const teile = [`E-Rechnung (${d.format === 'CII' ? 'XRechnung/ZUGFeRD' : 'XRechnung UBL'}) genau übernommen`]
  if (d.art === 'Gutschrift') teile.push('Gutschrift')
  if (d.iban) teile.push(`IBAN ${d.iban}`)
  if (d.positionen.length) teile.push(`${d.positionen.length} ${d.positionen.length === 1 ? 'Position' : 'Positionen'}`)
  if (d.zahlungsbedingungen) teile.push(d.zahlungsbedingungen)
  return teile.join(' · ')
}
