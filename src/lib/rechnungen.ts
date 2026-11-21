import { today } from './dates'
import type { Rechnung, RechnungPosition, RechnungStatus } from '../types'

// Eine Stelle für die Frage "offen oder schon ein Fall fürs Mahnwesen?" — Rechnungsübersicht,
// Mahnwesen und der Status-Badge müssen dieselbe Antwort geben.
export function istUnbezahlt(r: Rechnung): boolean {
  return r.status === 'Versendet' || r.status === 'Überfällig'
}

export function istUeberfaellig(r: Rechnung): boolean {
  if (!istUnbezahlt(r)) return false
  return r.status === 'Überfällig' || !!r.mahnstufe || (!!r.zahlungsziel && r.zahlungsziel < today())
}

// Der gespeicherte Status bleibt "Versendet", bis jemand mahnt — angezeigt wird trotzdem
// "Überfällig", sobald das Zahlungsziel verstrichen ist.
export function angezeigterStatus(r: Rechnung): RechnungStatus {
  return istUeberfaellig(r) ? 'Überfällig' : r.status
}

export function rundeCent(betrag: number): number {
  return Math.round(betrag * 100) / 100
}

// ---------------------------------------------------------------------------------------------
// Seit 21.11.2026: Zahlungen, Mahnungen, Positionen (Rechnungen zum Anklicken).

/** Summe der erfassten (Teil-)Zahlungen. */
export function bezahlteSumme(r: Rechnung): number {
  return rundeCent((r.zahlungen ?? []).reduce((s, z) => s + (Number(z.betrag) || 0), 0))
}

/** Summe der Mahngebühren aus allen Mahnschreiben. */
export function mahngebuehren(r: Rechnung): number {
  return rundeCent((r.mahnungen ?? []).reduce((s, m) => s + (Number(m.gebuehr) || 0), 0))
}

/** Noch offener Rechnungsbetrag (ohne Mahngebühren); 0 bei bezahlten Rechnungen. */
export function offenerBetrag(r: Rechnung): number {
  if (r.status === 'Bezahlt') return 0
  return Math.max(0, rundeCent(r.betragBrutto - bezahlteSumme(r)))
}

/** Gilt als vollständig bezahlt, sobald die Zahlungen den Bruttobetrag erreichen. */
export function vollstaendigBezahlt(r: Pick<Rechnung, 'betragBrutto'>, zahlungenSumme: number): boolean {
  return zahlungenSumme >= r.betragBrutto - 0.005
}

/** Gültige Frist: die neue Frist aus dem letzten Mahnschreiben, sonst das Zahlungsziel. */
export function aktuelleFrist(r: Rechnung): string {
  const letzte = [...(r.mahnungen ?? [])].reverse().find((m) => m.neueFrist)
  return letzte?.neueFrist ?? r.zahlungsziel
}

/** Tage bis zur Frist (negativ = so viele Tage überfällig); null ohne gültiges Datum. */
export function tageBisFrist(r: Rechnung): number | null {
  const frist = aktuelleFrist(r)
  if (!frist || !/^\d{4}-\d{2}-\d{2}/.test(frist)) return null
  const a = new Date(`${today()}T00:00:00`)
  const b = new Date(`${frist.slice(0, 10)}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** Kurzer Text zur Fälligkeit, z. B. "seit 5 Tagen überfällig" oder "fällig in 3 Tagen". */
export function faelligkeitText(r: Rechnung): string {
  if (r.status === 'Bezahlt') return r.bezahltAm ? `bezahlt am ${r.bezahltAm.split('-').reverse().join('.')}` : 'bezahlt'
  if (r.status === 'Entwurf') return 'noch nicht versendet'
  const t = tageBisFrist(r)
  if (t === null) return ''
  if (t < 0) return `seit ${-t} ${t === -1 ? 'Tag' : 'Tagen'} überfällig`
  if (t === 0) return 'heute fällig'
  return `fällig in ${t} ${t === 1 ? 'Tag' : 'Tagen'}`
}

/** Netto-, Steuer- und Bruttobetrag aus Positionen (Einzelpreise netto). */
export function summeAusPositionen(positionen: { menge: number; einzelpreis: number }[], ustSatz: number): { netto: number; ust: number; brutto: number } {
  const netto = rundeCent(positionen.reduce((s, p) => s + rundeCent((Number(p.menge) || 0) * (Number(p.einzelpreis) || 0)), 0))
  const ust = rundeCent((netto * (ustSatz || 0)) / 100)
  return { netto, ust, brutto: rundeCent(netto + ust) }
}

/** Umsatzsteuersatz einer Rechnung: gespeichert oder aus netto/brutto erkannt (19, 7 oder 0). */
export function ustSatzVon(r: Pick<Rechnung, 'ustSatz' | 'betragNetto' | 'betragBrutto'>): number {
  if (r.ustSatz != null) return r.ustSatz
  for (const s of [19, 7, 0]) if (Math.abs(rundeCent(r.betragNetto * (1 + s / 100)) - r.betragBrutto) < 0.011) return s
  return r.betragNetto > 0 ? rundeCent(((r.betragBrutto - r.betragNetto) / r.betragNetto) * 100) : 0
}

/** Positionen fürs PDF: die gespeicherten oder — bei älteren Rechnungen — eine Zeile aus Leistung und Nettobetrag. */
export function positionenFuerAnzeige(r: Rechnung): RechnungPosition[] {
  if (r.positionen?.length) return r.positionen
  const menge = r.leistungMenge && r.leistungMenge > 0 ? r.leistungMenge : 1
  return [
    {
      id: 'p_alt',
      bezeichnung: r.leistungBezeichnung || 'Leistung laut Vereinbarung',
      menge,
      einheit: r.leistungMenge ? (r.leistungEinheit ?? 'Pauschal') : 'Pauschal',
      einzelpreis: rundeCent(r.betragNetto / menge),
    },
  ]
}

/** Nächste freie Rechnungsnummer im Muster RE-JJJJ-NNN (höchste vergebene Nummer des Jahres + 1). */
export function naechsteRechnungsnummer(rechnungen: Rechnung[], datum = today()): string {
  const jahr = datum.slice(0, 4)
  const vergeben = new Set(rechnungen.map((r) => r.nummer.trim().toLowerCase()))
  let max = 0
  for (const r of rechnungen) {
    const m = r.nummer.trim().match(new RegExp(`^RE-${jahr}-(\\d+)$`, 'i'))
    if (m) max = Math.max(max, Number(m[1]))
  }
  let n = Math.max(max, rechnungen.filter((r) => r.datum.startsWith(jahr)).length) + 1
  let vorschlag = `RE-${jahr}-${String(n).padStart(3, '0')}`
  while (vergeben.has(vorschlag.toLowerCase())) {
    n++
    vorschlag = `RE-${jahr}-${String(n).padStart(3, '0')}`
  }
  return vorschlag
}
