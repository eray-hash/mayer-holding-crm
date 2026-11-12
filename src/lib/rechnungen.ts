import { today } from './dates'
import type { Rechnung, RechnungStatus } from '../types'

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
