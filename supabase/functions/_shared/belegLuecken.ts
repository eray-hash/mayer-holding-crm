// Was fehlt einer Verbindlichkeit (Eingangsrechnung) für die Buchhaltung? (22.11.2026)
// Gemeinsamer Kern für die Liste im CRM (Filter „Unvollständig“, Hinweis je Zeile), das Assistent-Werkzeug
// verbindlichkeiten_pruefen und den Server-Ablauf email-gateway/belegErgaenzen.ts. Ohne Abhängigkeiten,
// der Browser importiert diese Datei direkt.
//
// „fehlt“ = macht die Verbindlichkeit unvollständig (Beleg, Betrag, Rechnungsnummer, wohl keine Rechnung);
// „hinweis“ = zur Kenntnis (Betrag 0 €, nur Bruttobetrag bekannt, automatisch ergänzt → bitte prüfen).
// Die Bestätigung „Angaben stimmen“ (geprueft) bleibt Handarbeit und wird hier nicht gewertet.

export type BelegLueckeArt = 'beleg' | 'betrag' | 'nummer' | 'keine_rechnung' | 'betrag_null' | 'netto' | 'automatisch'

export type BelegLuecke = { art: BelegLueckeArt; schwere: 'fehlt' | 'hinweis'; text: string }

/** Was der Server erkannt hat (Spalte verbindlichkeiten.automatisch_erkannt). */
export type ErkanntInfo = {
  stand?: 'fertig' | 'fehler'
  am?: string
  /** rechnung | zahlungsbeleg | nur_im_kundenkonto | keine_rechnung | unklar */
  art?: string
  /** Datenbank-Spalten, die automatisch gefüllt wurden */
  felder?: string[]
  beleg?: 'mail_anhang' | 'mail_text' | null
  versuche?: number
  fehler?: string
}

/** Die Angaben, auf die es ankommt — neutral benannt, damit Browser (camelCase) und Server (Spalten) sie füllen können. */
export type BelegAngaben = {
  beleg?: { url?: unknown } | null
  brutto?: number | null
  netto?: number | null
  rechnungsnummer?: string | null
}

export const FELD_NAMEN: Record<string, string> = {
  beleg: 'Beleg',
  betrag_brutto: 'Bruttobetrag',
  betrag_netto: 'Nettobetrag',
  rechnungsnummer: 'Rechnungsnummer',
  datum: 'Rechnungsdatum',
  zahlungsziel: 'Zahlungsziel',
  kategorie: 'Kategorie',
  lieferant: 'Lieferant',
}

function zahl(x: unknown): number | null {
  if (x === null || x === undefined || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

/** Spalte automatisch_erkannt lesen (unbekannte Formen → null). */
export function erkanntAus(roh: unknown): ErkanntInfo | null {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return null
  const r = roh as Record<string, unknown>
  return {
    stand: r.stand === 'fertig' || r.stand === 'fehler' ? r.stand : undefined,
    am: typeof r.am === 'string' ? r.am : undefined,
    art: typeof r.art === 'string' ? r.art : undefined,
    felder: Array.isArray(r.felder) ? r.felder.filter((f): f is string => typeof f === 'string') : [],
    beleg: r.beleg === 'mail_anhang' || r.beleg === 'mail_text' ? r.beleg : null,
    versuche: typeof r.versuche === 'number' ? r.versuche : undefined,
    fehler: typeof r.fehler === 'string' ? r.fehler : undefined,
  }
}

/** Zeile aus verbindlichkeiten (Spalten wie in der Datenbank) → Angaben. */
export function angabenAusZeile(z: Record<string, unknown>): BelegAngaben {
  return {
    beleg: (z.beleg as BelegAngaben['beleg']) ?? null,
    brutto: zahl(z.betrag_brutto),
    netto: zahl(z.betrag_netto),
    rechnungsnummer: typeof z.rechnungsnummer === 'string' ? z.rechnungsnummer : null,
  }
}

export function hatBeleg(v: Pick<BelegAngaben, 'beleg'>): boolean {
  return !!v.beleg && typeof v.beleg === 'object' && !!String(v.beleg.url ?? '').trim()
}

/** Alle Lücken einer Verbindlichkeit, die wichtigsten zuerst. */
export function belegLuecken(v: BelegAngaben, erkannt?: ErkanntInfo | null): BelegLuecke[] {
  const l: BelegLuecke[] = []
  if (erkannt?.art === 'keine_rechnung') {
    l.push({ art: 'keine_rechnung', schwere: 'fehlt', text: 'Wohl keine echte Rechnung (Werbung oder Betrugsversuch?) — bitte prüfen und ggf. löschen' })
  }
  if (!hatBeleg(v)) {
    l.push({
      art: 'beleg',
      schwere: 'fehlt',
      text: erkannt?.art === 'nur_im_kundenkonto' ? 'Beleg fehlt — die Rechnung liegt nur im Kundenkonto des Anbieters' : 'Beleg fehlt',
    })
  }
  const brutto = zahl(v.brutto)
  const netto = zahl(v.netto)
  if (brutto === null && netto === null) l.push({ art: 'betrag', schwere: 'fehlt', text: 'Betrag fehlt' })
  else if (!brutto && !netto) l.push({ art: 'betrag_null', schwere: 'hinweis', text: 'Betrag ist 0 €' })
  else if (brutto && netto === null) l.push({ art: 'netto', schwere: 'hinweis', text: 'Nur Bruttobetrag bekannt (Vorsteuer offen)' })
  if (!String(v.rechnungsnummer ?? '').trim()) l.push({ art: 'nummer', schwere: 'fehlt', text: 'Rechnungsnummer fehlt' })
  const felder = (erkannt?.felder ?? []).filter((f) => FELD_NAMEN[f])
  if (felder.length) {
    l.push({ art: 'automatisch', schwere: 'hinweis', text: `Automatisch ergänzt: ${felder.map((f) => FELD_NAMEN[f]).join(', ')} — bitte prüfen` })
  }
  return l
}

/** Unvollständig = mindestens eine Lücke der Schwere „fehlt“. */
export function istUnvollstaendig(v: BelegAngaben, erkannt?: ErkanntInfo | null): boolean {
  return belegLuecken(v, erkannt).some((x) => x.schwere === 'fehlt')
}

/** Kurztext der fehlenden Punkte, z. B. „Beleg, Betrag“ (für Listenzeilen). */
export function fehltKurz(v: BelegAngaben, erkannt?: ErkanntInfo | null): string {
  const namen: Record<BelegLueckeArt, string> = {
    keine_rechnung: 'wohl keine Rechnung',
    beleg: 'Beleg',
    betrag: 'Betrag',
    nummer: 'Rechnungsnummer',
    betrag_null: 'Betrag 0 €',
    netto: 'Nettobetrag',
    automatisch: 'automatisch ergänzt',
  }
  return belegLuecken(v, erkannt).filter((x) => x.schwere === 'fehlt').map((x) => namen[x.art]).join(', ')
}
