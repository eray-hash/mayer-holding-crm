// Modul E-Rechnung: aus einer Ausgangsrechnung des CRM die Angaben für die XRechnung zusammenstellen —
// Rechnung (Positionen, Steuersatz, Hinweis, Leistungszeitraum, Zahlungsziel, Anschrift), Akte des Kunden
// (E-Mail, Firma, Kunden-ID als Käuferreferenz) und Briefkopf (Anschrift, Steuernummer, IBAN, Telefon, GF).
import { useMemo } from 'react'
import type { Rechnung } from '../../types'
import type { Briefkopf } from '../../data/briefkopf'
import { findeAkte, type KvAkte } from '../../components/KostenvoranschlaegeSection'
import { empfaengerZeilen, useRechnungAktionen } from '../../components/rechnungen/aktionen'
import type { MailAnhang } from '../../lib/emailGateway'
import { positionenFuerAnzeige, rundeCent, ustSatzVon } from '../../lib/rechnungen'
import { useModulAktiv } from '../modulSchalter'
import { erzeugeXRechnung, kaeuferAusAnschrift, MODUL_E_RECHNUNG, pruefeXRechnung, summen, verkaeuferAusBriefkopf, type XRechnungEingabe } from './kern'

/** Absender-Adresse der Firma (gemeinsames Postfach), erscheint als Kontakt in der XRechnung. */
export const ABSENDER_EMAIL = 'info@amayer-holding.com'

const euro = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

export function xRechnungDateiname(r: Pick<Rechnung, 'nummer'>): string {
  return `${r.nummer.trim().replace(/[\\/:*?"<>|\s]+/g, '-') || 'Rechnung'}_XRechnung.xml`
}

export function xRechnungEingabe(r: Rechnung, akte: KvAkte | undefined, briefkopf: Briefkopf, nutzerName: string): XRechnungEingabe {
  const { verkaeufer, iban } = verkaeuferAusBriefkopf(briefkopf, ABSENDER_EMAIL)
  // Ohne Geschäftsführer im Briefkopf gilt der Mitarbeiter, der die Rechnung erstellt, als Ansprechpartner.
  if (!verkaeufer.kontaktName.trim()) verkaeufer.kontaktName = nutzerName
  const ust = ustSatzVon(r)
  const hinweis = r.hinweis?.trim() ?? ''
  return {
    nummer: r.nummer,
    datum: r.datum,
    faellig: r.zahlungsziel || undefined,
    leistungszeitraum: r.leistungszeitraum?.trim() || undefined,
    verkaeufer,
    kaeufer: kaeuferAusAnschrift(empfaengerZeilen(r, akte).join('\n'), akte?.kunde.firma?.trim() ?? '', akte?.kunde.email?.trim() || undefined),
    kaeuferReferenz: akte?.kunde.id ?? r.kundeId,
    iban,
    positionen: positionenFuerAnzeige(r).map((p) => ({ bezeichnung: p.bezeichnung, menge: Number(p.menge) || 0, einheit: p.einheit, einzelpreis: Number(p.einzelpreis) || 0 })),
    ustSatz: ust,
    steuerbefreiungGrund: ust === 0 ? hinweis || undefined : undefined,
    hinweise: ust !== 0 && hinweis ? [hinweis] : undefined,
  }
}

export type XRechnungErgebnis = { ok: true; xml: string; dateiname: string } | { ok: false; fehler: string[] }

/** Prüft die Angaben und erzeugt die XRechnung — oder liefert die fehlenden Angaben als deutsche Sätze. */
export function xRechnungFuer(r: Rechnung, akte: KvAkte | undefined, briefkopf: Briefkopf, nutzerName: string): XRechnungErgebnis {
  if (!akte) return { ok: false, fehler: ['Die Akte des Kunden wurde nicht gefunden.'] }
  const e = xRechnungEingabe(r, akte, briefkopf, nutzerName)
  const fehler = pruefeXRechnung(e)
  // Die E-Rechnung muss denselben Betrag zeigen wie das PDF.
  const brutto = summen(e).brutto
  if (e.positionen.length && Math.abs(brutto - rundeCent(r.betragBrutto)) > 0.01) {
    fehler.push(`Die Summe der Positionen (${euro(brutto)}) passt nicht zum Rechnungsbetrag (${euro(r.betragBrutto)}). Bitte die Rechnung bearbeiten.`)
  }
  if (fehler.length) return { ok: false, fehler }
  try {
    return { ok: true, xml: erzeugeXRechnung(e), dateiname: xRechnungDateiname(r) }
  } catch (err) {
    return { ok: false, fehler: [err instanceof Error ? err.message : 'Die E-Rechnung ließ sich nicht erzeugen.'] }
  }
}

function textZuBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function xRechnungAlsAnhang(x: { xml: string; dateiname: string }): MailAnhang {
  return { filename: x.dateiname, contentBase64: textZuBase64(x.xml), contentType: 'application/xml' }
}

/**
 * Für den Rechnungsversand: null, wenn das Modul aus ist; sonst das Ergebnis (XML oder fehlende Angaben).
 */
export function useXRechnungFuerVersand(r: Rechnung): XRechnungErgebnis | null {
  const aktiv = useModulAktiv(MODUL_E_RECHNUNG)
  const { state, briefkopf, nutzer } = useRechnungAktionen()
  const akte = findeAkte(state, r.kundeId)
  return useMemo(() => (aktiv ? xRechnungFuer(r, akte, briefkopf, nutzer.name) : null), [aktiv, r, akte, briefkopf, nutzer.name])
}
