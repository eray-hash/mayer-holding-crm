// Vorschläge für Chance und erwarteten Umsatz einer Akte (22.11.2026). Anlass: Keine der rund 140 Akten
// hatte eine Chance oder einen erwarteten Umsatz, deshalb zeigte die Umsatzvorschau (/auswertungen/umsatz,
// umsatzKern.ts) fast 0 €. Das CRM schlägt jetzt je Akte Chance, Umsatz netto und Monat vor; das Team
// bestätigt in der Wochenbesprechung („übernehmen“) oder ändert.
//
// Diese Datei rechnet ohne Netz und ohne Abhängigkeiten außer umsatzKern.ts — dieselben Regeln gelten im
// CRM (Wochenbesprechung, Checkliste), auf dem Server (email-gateway/chanceVorschlag.ts, dort zusätzlich
// verfeinert durch die KI) und im Assistenten (telegram-gateway/chanceWerkzeug.ts).
//
// ─── Wo was steht ────────────────────────────────────────────────────────────────────────────────
// kunden.chance_vorschlag (jsonb) = ChanceVorschlag: nur ein Vorschlag, zählt nirgends mit.
// kunden.auftrag_chance  (jsonb) = GespeicherteChance: { prozent, bestaetigt, begruendung, von, am } wie
//   bisher (Checkliste), dazu neu umsatzNetto und monat. Nur das zählt in der Umsatzvorschau. Vorschläge
//   werden NIE dorthin geschrieben — erst, wenn ein Mitarbeiter übernimmt.
//
// ─── Die Regeln (Stellschrauben unten) ───────────────────────────────────────────────────────────
// Chance: Grundwert nach Stand der Akte (fünf Stufen wie in der Wochenbesprechung, je Bereich), dann:
//   Kostenvoranschlag angenommen → mindestens 90 %; offen → mindestens 40 % (älter als 60 Tage −10);
//   Rechnung gestellt → mindestens 90 %; Unterschrift in der Akte +10 (höchstens 90); kommender
//   Termin +5; seit über 60 Tagen nichts passiert → halbiert, über 21 Tage −5. In 5er-Schritten, 5–100.
// Umsatz netto (erste Angabe, die da ist):
//   1. Kostenvoranschläge der Akte (offen + angenommen, netto);
//   2. Leistungen der Akte (Checkliste) mit Tagessatz aus der Preisliste: Mitte des Tagessatzes der
//      teuersten passenden Leistung × TAGE_JE_BEREICH;
//   3. Median der bisherigen Kostenvoranschläge desselben Bereichs (ab 3 Stück);
//   4. Annahme je Bereich (STANDARD_UMSATZ).
//   Immobilien-Kunden: kein Umsatz (die Provision zählt über das Objekt, sonst doppelt). Ist schon eine
//   Rechnung gestellt: kein Umsatz (zählt als Rechnung, sonst doppelt).
// Monat: Kostenvoranschlag angenommen = sein Monat + 1, offen = + 2 (wie umsatzKern); sonst laufender
//   Monat + Vorlauf nach Stufe (VORLAUF_JE_STUFE). Frühestens der laufende Monat.

import { ANGEBOT_VORLAUF_MONATE, AKTE_ENDSTAENDE, angebotNetto, euro, monatName, monatVon, plusMonate } from './umsatzKern.ts'
import { alleZeilen } from './alleZeilen.ts'

// ─── Stellschrauben ──────────────────────────────────────────────────────────────────────────────

/** Fünf gemeinsame Stufen (wie src/lib/checkliste.ts STUFEN / STUFE_JE_STATUS — dort für die Oberfläche, hier für den Server). */
export const STUFEN_NAMEN = ['Erstkontakt', 'Gespräch geführt', 'Angebot / Konzept', 'Auftrag läuft', 'Abrechnung'] as const
export const STUFE_ZURUECK = 5

const STUFE_JE_STATUS: Record<string, Record<string, number>> = {
  beratung: { lead: 0, erstkontakt: 0, termin: 0, durchgefuehrt: 1, konzept: 2, angebot: 2, unterschrieben: 3, aktives_mandat: 3, rechnung_gestellt: 4 },
  erben: { erstkontakt: 0, bedarfsanalyse: 1, unterlagen_angefordert: 1, konzept_erstellt: 2, beratungsgespraech: 3, umsetzung: 3 },
  betriebsuebergabe: { erstkontakt: 0, bedarfsanalyse: 1, unternehmensbewertung: 2, nachfolgekonzept: 2, nachfolgersuche: 3, verhandlung: 3, notartermin: 3 },
  betriebsformen: { erstkontakt: 0, bedarfsanalyse: 1, konzept_erstellt: 2, beratungsgespraech: 3, umsetzung: 3, handelsregister: 3 },
  akademie: { interessent: 0, anmeldung_eingegangen: 2, platz_bestaetigt: 3, kurs_laeuft: 3 },
  finanzierungen: { interessent: 0, risikoprofil_erstellt: 1, beratungsgespraech: 2, zeichnung_eingegangen: 3, kapital_eingezahlt: 4 },
  immobilienkunden: { interessent: 0, besichtigung: 1, angebot: 2, verhandlung: 2 },
}

/** Grundchance in Prozent je Stufe 0–4. */
const GRUND_JE_STUFE: Record<string, number[]> = {
  standard: [10, 25, 40, 90, 100],
  akademie: [15, 25, 60, 90, 100],
  finanzierungen: [10, 25, 40, 85, 100],
  immobilienkunden: [5, 15, 35, 60, 100],
}

/** Abweichende Grundchance für einzelne Stände. */
const GRUND_JE_STATUS: Record<string, Record<string, number>> = {
  beratung: { lead: 5, termin: 15 },
  erben: { unterlagen_angefordert: 30 },
  betriebsuebergabe: { verhandlung: 70, notartermin: 95 },
  betriebsformen: { handelsregister: 95 },
  immobilienkunden: { verhandlung: 50 },
}

/** Stände außerhalb des Hauptpfads (Wiedervorlage, zurückgestellt …). */
export const CHANCE_ZURUECKGESTELLT = 5

/** Monate vom laufenden Monat bis zum erwarteten Umsatz je Stufe 0–4; zurückgestellt eigener Wert. */
const VORLAUF_JE_STUFE = [3, 2, 2, 1, 0]
const VORLAUF_ZURUECK = 4

/** Arbeitstage je Auftrag für die Schätzung aus dem Tagessatz (Annahme, im Gespräch prüfen). */
export const TAGE_JE_BEREICH: Record<string, number> = { beratung: 2, erben: 2, betriebsuebergabe: 4, betriebsformen: 2, akademie: 1, finanzierungen: 1 }

/** Annahme je Bereich, wenn sonst nichts da ist (netto). beratung: der häufigste Betrag der bisherigen
 *  Kostenvoranschläge (3.850 €). null = keine Annahme möglich (Vergütung je Fall zu verschieden). */
export const STANDARD_UMSATZ: Record<string, number | null> = {
  beratung: 3850,
  erben: 2500,
  betriebsuebergabe: 7500,
  betriebsformen: 2500,
  akademie: 1500,
  finanzierungen: null,
  immobilienkunden: null,
}

const TAG_MS = 86_400_000

// ─── Typen ───────────────────────────────────────────────────────────────────────────────────────

/** objekt = Immobilien-Interessent (Provision zählt am Objekt), rechnung = schon in Rechnung gestellt — beides bewusst ohne Umsatz. */
export type UmsatzQuelle = 'kostenvoranschlag' | 'preisliste' | 'erfahrung' | 'annahme' | 'ki' | 'keine' | 'objekt' | 'rechnung'

/** Vorschlag in kunden.chance_vorschlag. */
export type ChanceVorschlag = {
  prozent: number
  /** Netto; null = kein Umsatz zu erwarten bzw. unbekannt. */
  umsatzNetto: number | null
  /** JJJJ-MM; null ohne Umsatz. */
  monat: string | null
  begruendung: string
  umsatzQuelle: UmsatzQuelle
  quelle: 'regel' | 'ki'
  /** ISO-Zeitpunkt der Berechnung. */
  am: string
  /** Bei KI-Verfeinerung: der Wert nach den festen Regeln. */
  regel?: { prozent: number; umsatzNetto: number | null; monat: string | null }
  /** Die Chance der Akte war bei der Berechnung schon bestätigt — dann gilt der Vorschlag nur für Umsatz und Monat. */
  chanceBestaetigt?: boolean
}

/** Inhalt von kunden.auftrag_chance (bisher prozent/bestaetigt/begruendung/von/am, neu umsatzNetto/monat). */
export type GespeicherteChance = {
  prozent: number
  bestaetigt: boolean
  begruendung?: string
  von?: string
  am?: string
  umsatzNetto?: number
  monat?: string
}

// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

export type AkteRoh = {
  id: string
  bereich: string | null
  status: string | null
  firma?: string | null
  ansprechpartner?: string | null
  activities?: unknown
  signaturen?: unknown
  dienstleistungen?: unknown
  auftrag_chance?: unknown
  chance_vorschlag?: unknown
  [k: string]: unknown
}

export type KvRoh = {
  id: string
  kunde_id?: string | null
  bereich?: string | null
  privat_besitzer?: string | null
  name?: string | null
  status?: string | null
  datum?: string | null
  erstellt_am?: string | null
  betrag?: number | string | null
  positionen?: { menge: number; einzelpreis: number }[] | null
  aufschlag_prozent?: number | string | null
  ust_satz?: number | string | null
}

export type PreisRoh = { bezeichnung: string; preis_tag_von?: number | string | null; preis_tag_bis?: number | string | null; preis_stunde_von?: number | string | null; preis_stunde_bis?: number | string | null }

/** Was je Akte für die Regel gebraucht wird. */
export type RegelKontext = {
  heute: string
  kvs: KvRoh[]
  /** Hat die Akte schon eine Rechnung (kein Entwurf)? */
  hatRechnung: boolean
  /** Kommende Termine (JJJJ-MM-TT), früheste zuerst. */
  termine: string[]
  preisliste: PreisRoh[]
  /** Median der Kostenvoranschläge je Bereich (Kundenakten-Schlüssel), nur ab 3 Stück. */
  medianJeBereich: Map<string, { median: number; anzahl: number }>
}

// ─── Hilfen ──────────────────────────────────────────────────────────────────────────────────────

const zahl = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function runde5(p: number): number {
  return Math.max(0, Math.min(100, Math.round(p / 5) * 5))
}

/** Umsatz sinnvoll runden: unter 1.000 € auf 10 €, sonst auf 50 €. */
export function rundeUmsatz(n: number): number {
  return n < 1000 ? Math.round(n / 10) * 10 : Math.round(n / 50) * 50
}

function tageZwischen(von: string, bis: string): number {
  return Math.round((Date.parse(`${bis.slice(0, 10)}T12:00:00Z`) - Date.parse(`${von.slice(0, 10)}T12:00:00Z`)) / TAG_MS)
}

const istTag = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)
const deKurz = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

export function istGueltigerMonat(m: unknown): m is string {
  return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)
}

/** Stufe 0–4, STUFE_ZURUECK oder undefined (Endstand: kein Vorschlag). */
export function stufeFuer(bereich: string, status: string): number | undefined {
  if (AKTE_ENDSTAENDE.includes(status) || status === 'archiv') return undefined
  const s = STUFE_JE_STATUS[bereich]?.[status]
  return s ?? STUFE_ZURUECK
}

/** Gespeicherte Chance lesen (unbekannte Form → undefined). */
export function leseGespeicherteChance(roh: unknown): GespeicherteChance | undefined {
  if (!roh || typeof roh !== 'object') return undefined
  const c = roh as Zeile
  const prozent = zahl(c.prozent)
  if (prozent === undefined) return undefined
  const umsatz = zahl(c.umsatzNetto)
  return {
    prozent,
    bestaetigt: c.bestaetigt === true,
    begruendung: typeof c.begruendung === 'string' ? c.begruendung : undefined,
    von: typeof c.von === 'string' ? c.von : undefined,
    am: typeof c.am === 'string' ? c.am : undefined,
    umsatzNetto: umsatz !== undefined && umsatz > 0 ? umsatz : undefined,
    monat: istGueltigerMonat(c.monat) ? c.monat : undefined,
  }
}

/** Gespeicherten Vorschlag lesen (unbekannte Form → undefined). */
export function leseVorschlag(roh: unknown): ChanceVorschlag | undefined {
  if (!roh || typeof roh !== 'object') return undefined
  const v = roh as Zeile
  const prozent = zahl(v.prozent)
  if (prozent === undefined) return undefined
  const umsatz = zahl(v.umsatzNetto)
  return {
    prozent: runde5(prozent),
    umsatzNetto: umsatz !== undefined && umsatz > 0 ? umsatz : null,
    monat: istGueltigerMonat(v.monat) ? v.monat : null,
    begruendung: String(v.begruendung ?? ''),
    umsatzQuelle: (['kostenvoranschlag', 'preisliste', 'erfahrung', 'annahme', 'ki', 'keine', 'objekt', 'rechnung'] as const).includes(v.umsatzQuelle) ? v.umsatzQuelle : 'keine',
    quelle: v.quelle === 'ki' ? 'ki' : 'regel',
    am: String(v.am ?? ''),
    regel: v.regel && typeof v.regel === 'object' ? v.regel : undefined,
    chanceBestaetigt: v.chanceBestaetigt === true ? true : undefined,
  }
}

/**
 * Was beim Übernehmen in auftrag_chance geschrieben wird: bestätigt, mit Umsatz und Monat. Eine schon
 * bestätigte Chance bleibt (der Vorschlag ergänzt dann nur Umsatz und Monat); Umsatz und Monat, die schon
 * eingetragen sind, bleiben ebenfalls, außer `ersetzen` ist gesetzt.
 */
export function chanceAusVorschlag(
  v: Pick<ChanceVorschlag, 'prozent' | 'umsatzNetto' | 'monat' | 'begruendung'>,
  alt: GespeicherteChance | undefined,
  wer: { name: string; am: string },
  ersetzen = false,
): GespeicherteChance {
  const chanceBleibt = !ersetzen && alt?.bestaetigt === true
  const neu: GespeicherteChance = chanceBleibt
    ? { ...alt! }
    : { prozent: runde5(v.prozent), bestaetigt: true, begruendung: v.begruendung?.trim() || undefined, von: wer.name, am: wer.am }
  const umsatz = !ersetzen && alt?.umsatzNetto ? alt.umsatzNetto : v.umsatzNetto ?? undefined
  const monat = !ersetzen && alt?.umsatzNetto && alt.monat ? alt.monat : v.monat ?? undefined
  if (umsatz && umsatz > 0) neu.umsatzNetto = umsatz
  else delete neu.umsatzNetto
  if (neu.umsatzNetto && monat) neu.monat = monat
  else delete neu.monat
  return neu
}

/** Braucht die Akte überhaupt einen Vorschlag? Nein bei Endstand, privat/intern und wenn Chance UND Umsatz schon bestätigt sind. */
export function brauchtVorschlag(a: AkteRoh, kvMitBetrag: boolean): { ja: boolean; grund?: 'endstand' | 'privat' | 'bestaetigt' } {
  const bereich = String(a.bereich ?? '')
  if (!bereich || bereich === 'privat' || bereich === 'intern' || a.id === 'k_eingang_ungeklaert' || a.id === 'k_intern_holding') return { ja: false, grund: 'privat' }
  if (stufeFuer(bereich, String(a.status ?? '')) === undefined) return { ja: false, grund: 'endstand' }
  const c = leseGespeicherteChance(a.auftrag_chance)
  if (c?.bestaetigt && (c.umsatzNetto || kvMitBetrag || bereich === 'immobilienkunden' || STANDARD_UMSATZ[bereich] === null)) return { ja: false, grund: 'bestaetigt' }
  return { ja: true }
}

/** Median der Netto-Beträge der Kostenvoranschläge je Bereich (abgelehnte und private zählen nicht; nur ab 3 Stück). */
export function medianJeBereich(kvs: KvRoh[], bereichVonAkte: Map<string, string>): Map<string, { median: number; anzahl: number }> {
  const werte = new Map<string, number[]>()
  for (const kv of kvs) {
    if (kv.privat_besitzer || kv.status === 'abgelehnt') continue
    const b = (kv.kunde_id ? bereichVonAkte.get(kv.kunde_id) : undefined) ?? kv.bereich ?? ''
    if (!b) continue
    const n = nettoVon(kv)
    if (n === undefined || n <= 0) continue
    werte.set(b, [...(werte.get(b) ?? []), n])
  }
  const aus = new Map<string, { median: number; anzahl: number }>()
  for (const [b, l] of werte) {
    if (l.length < 3) continue
    const s = [...l].sort((x, y) => x - y)
    const mitte = Math.floor(s.length / 2)
    aus.set(b, { median: s.length % 2 ? s[mitte] : (s[mitte - 1] + s[mitte]) / 2, anzahl: s.length })
  }
  return aus
}

export function nettoVon(kv: KvRoh): number | undefined {
  return angebotNetto({
    betrag: zahl(kv.betrag) ?? null,
    positionen: Array.isArray(kv.positionen) ? kv.positionen : null,
    aufschlagProzent: zahl(kv.aufschlag_prozent) ?? null,
    ustSatz: zahl(kv.ust_satz) ?? null,
  })
}

function dienstleistungenVon(roh: unknown): string[] {
  if (!Array.isArray(roh)) return []
  return roh.map((d) => (typeof d === 'string' ? d : d && typeof d === 'object' ? String((d as Zeile).name ?? (d as Zeile).bezeichnung ?? '') : '')).map((s) => s.trim()).filter(Boolean)
}

/** Tagessatz-Mitte einer Leistung aus der Preisliste (Stundensatz × 8, wenn nur der da ist). */
export function tagessatz(p: PreisRoh): number | undefined {
  const von = zahl(p.preis_tag_von)
  const bis = zahl(p.preis_tag_bis)
  if (von || bis) return ((von ?? bis!) + (bis ?? von!)) / 2
  const sv = zahl(p.preis_stunde_von)
  const sb = zahl(p.preis_stunde_bis)
  if (sv || sb) return (((sv ?? sb!) + (sb ?? sv!)) / 2) * 8
  return undefined
}

function letzteAktivitaet(roh: unknown): string | undefined {
  let neu: string | undefined
  for (const a of Array.isArray(roh) ? roh : []) {
    const d = String((a as Zeile)?.date ?? '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!neu || d > neu)) neu = d
  }
  return neu
}

// ─── Regel ───────────────────────────────────────────────────────────────────────────────────────

/** Vorschlag nach festen Regeln. `am` ist der Zeitpunkt der Berechnung (ISO). */
export function regelVorschlag(a: AkteRoh, k: RegelKontext, am: string): ChanceVorschlag {
  const bereich = String(a.bereich ?? '')
  const status = String(a.status ?? '')
  const aktuell = monatVon(k.heute)!
  const stufe = stufeFuer(bereich, status) ?? STUFE_ZURUECK
  const gruende: string[] = []

  // Chance
  let prozent: number
  const sonder = GRUND_JE_STATUS[bereich]?.[status]
  if (stufe === STUFE_ZURUECK) {
    prozent = CHANCE_ZURUECKGESTELLT
    gruende.push('Akte ist zurückgestellt')
  } else {
    prozent = sonder ?? (GRUND_JE_STUFE[bereich] ?? GRUND_JE_STUFE.standard)[stufe]
    gruende.push(bereich === 'beratung' && status === 'lead' ? 'Neuanfrage, noch kein Gespräch' : `Stand „${STUFEN_NAMEN[stufe]}“`)
  }
  const zaehlende = k.kvs.filter((kv) => !kv.privat_besitzer && (kv.status === 'offen' || kv.status === 'angenommen'))
  const angenommen = zaehlende.filter((kv) => kv.status === 'angenommen')
  const offene = zaehlende.filter((kv) => kv.status === 'offen')
  if (angenommen.length) {
    prozent = Math.max(prozent, 90)
    gruende.push('Kostenvoranschlag angenommen')
  } else if (offene.length) {
    prozent = Math.max(prozent, 40)
    const daten = offene.map((kv) => (istTag(kv.datum) ? kv.datum! : String(kv.erstellt_am ?? '')).slice(0, 10)).filter((d) => istTag(d)).sort()
    const juengstes = daten[daten.length - 1]
    if (juengstes && tageZwischen(juengstes, k.heute) > 60) {
      prozent -= 10
      gruende.push(`Angebot seit ${tageZwischen(juengstes, k.heute)} Tagen ohne Antwort`)
    } else gruende.push(juengstes ? `Angebot vom ${deKurz(juengstes)} liegt vor` : 'Angebot liegt vor')
  }
  if (k.hatRechnung) {
    prozent = Math.max(prozent, 90)
    gruende.push('Rechnung gestellt')
  }
  const signaturen = Array.isArray(a.signaturen) ? a.signaturen.length : 0
  if (signaturen > 0 && prozent < 90) {
    prozent = Math.min(90, prozent + 10)
    gruende.push('Unterschrift in der Akte')
  }
  if (k.termine.length && prozent < 90) {
    prozent += 5
    gruende.push(`Termin am ${deKurz(k.termine[0])}`)
  }
  const letzte = letzteAktivitaet(a.activities)
  if (letzte && !(bereich === 'beratung' && status === 'lead') && prozent < 90) {
    const tage = tageZwischen(letzte, k.heute)
    if (tage > 60) {
      prozent = Math.max(5, prozent / 2)
      gruende.push(`seit ${tage} Tagen nichts passiert`)
    } else if (tage > 21) {
      prozent -= 5
      gruende.push(`seit ${tage} Tagen nichts passiert`)
    }
  }
  prozent = Math.max(5, runde5(prozent))

  // Umsatz
  let umsatz: number | null = null
  let umsatzQuelle: UmsatzQuelle = 'keine'
  let umsatzText = ''
  const kvSumme = zaehlende.reduce((s, kv) => s + (nettoVon(kv) ?? 0), 0)
  if (bereich === 'immobilienkunden') {
    umsatzQuelle = 'objekt'
    umsatzText = 'kein Umsatz an der Akte — die Provision zählt über das Objekt'
  } else if (k.hatRechnung) {
    umsatzQuelle = 'rechnung'
    umsatzText = 'kein weiterer Umsatz angesetzt — die Rechnung zählt schon'
  } else if (kvSumme > 0) {
    umsatz = Math.round(kvSumme * 100) / 100
    umsatzQuelle = 'kostenvoranschlag'
    umsatzText = `${euro(umsatz)} aus ${zaehlende.length === 1 ? 'dem Kostenvoranschlag' : `${zaehlende.length} Kostenvoranschlägen`}`
  } else {
    const leistungen = dienstleistungenVon(a.dienstleistungen)
    const nachName = new Map(k.preisliste.map((p) => [p.bezeichnung.trim().toLowerCase(), p]))
    let bester: { name: string; satz: number } | undefined
    for (const l of leistungen) {
      const p = nachName.get(l.toLowerCase())
      const satz = p ? tagessatz(p) : undefined
      if (satz && (!bester || satz > bester.satz)) bester = { name: p!.bezeichnung, satz }
    }
    const tage = TAGE_JE_BEREICH[bereich] ?? 2
    const median = k.medianJeBereich.get(bereich)
    if (bester) {
      umsatz = rundeUmsatz(bester.satz * tage)
      umsatzQuelle = 'preisliste'
      umsatzText = `${euro(umsatz)} geschätzt: ${tage} ${tage === 1 ? 'Tag' : 'Tage'} „${bester.name}“ laut Preisliste`
    } else if (median) {
      umsatz = rundeUmsatz(median.median)
      umsatzQuelle = 'erfahrung'
      umsatzText = `${euro(umsatz)} = mittlerer Betrag aus ${median.anzahl} bisherigen Kostenvoranschlägen des Bereichs`
    } else if (STANDARD_UMSATZ[bereich]) {
      umsatz = STANDARD_UMSATZ[bereich]!
      umsatzQuelle = 'annahme'
      umsatzText = `${euro(umsatz)} als übliche Annahme für den Bereich (bitte prüfen)`
    } else {
      umsatzText = 'Umsatz unbekannt — bitte eintragen'
    }
  }

  // Monat
  let monat: string | null = null
  if (umsatz !== null) {
    if (umsatzQuelle === 'kostenvoranschlag') {
      const kv = angenommen[0] ?? offene[0]
      const basis = monatVon(kv?.datum) ?? monatVon(kv?.erstellt_am) ?? aktuell
      const vorlauf = ANGEBOT_VORLAUF_MONATE[angenommen.length ? 'angenommen' : 'offen']
      monat = plusMonate(basis, vorlauf)
    } else {
      monat = plusMonate(aktuell, stufe === STUFE_ZURUECK ? VORLAUF_ZURUECK : VORLAUF_JE_STUFE[stufe])
    }
    if (monat < aktuell) monat = aktuell
  }

  // Eine schon bestätigte Chance bleibt; der Vorschlag ergänzt dann nur Umsatz und Monat.
  const gespeichert = leseGespeicherteChance(a.auftrag_chance)
  if (gespeichert?.bestaetigt) {
    const begruendung = `Chance ${gespeichert.prozent} % ist schon bestätigt. ${umsatzText}${monat ? `, erwartet ${monatName(monat)}` : ''}.`
    return { prozent: runde5(gespeichert.prozent), umsatzNetto: umsatz, monat, begruendung, umsatzQuelle, quelle: 'regel', am, chanceBestaetigt: true }
  }
  const begruendung = `${prozent} %: ${gruende.join(', ')}. ${umsatzText}${monat ? `, erwartet ${monatName(monat)}` : ''}.`
  return { prozent, umsatzNetto: umsatz, monat, begruendung, umsatzQuelle, quelle: 'regel', am }
}

// ─── Daten laden und für viele Akten rechnen ─────────────────────────────────────────────────────

export const AKTEN_SPALTEN = 'id, firma, ansprechpartner, bereich, status, activities, signaturen, dienstleistungen, sachverhalt, branche, naechste_schritte, verantwortlich, verantwortlich_email, auftrag_chance, chance_vorschlag'

export type ChanceGrundlagen = {
  heute: string
  akten: AkteRoh[]
  kvsJeAkte: Map<string, KvRoh[]>
  mitRechnung: Set<string>
  termineJeAkte: Map<string, string[]>
  preisliste: PreisRoh[]
  median: Map<string, { median: number; anzahl: number }>
}

// deno-lint-ignore no-explicit-any
type Db = any

/** Liest alles, was die Regel braucht. Ohne kundeIds alle Akten (Rechte prüft der Aufrufer danach). */
export async function ladeChanceGrundlagen(db: Db, opt: { heute: string; kundeIds?: string[]; jetztIso?: string }): Promise<ChanceGrundlagen> {
  const akteAbfrage = () => {
    const q = db.from('kunden').select(AKTEN_SPALTEN)
    return opt.kundeIds?.length ? q.in('id', opt.kundeIds) : q
  }
  const jetzt = opt.jetztIso ?? new Date().toISOString()
  // Seitenweise: die Datenbank liefert höchstens 1000 Zeilen je Abfrage (ein limit(5000) hilft nicht).
  const [akten, kvs, rechnungen, termine, preise, alleBereiche] = await Promise.all([
    alleZeilen(akteAbfrage),
    alleZeilen(() => db.from('kostenvoranschlaege').select('id, kunde_id, bereich, privat_besitzer, name, status, datum, erstellt_am, betrag, positionen, aufschlag_prozent, ust_satz')),
    alleZeilen(() => db.from('rechnungen').select('kunde_id, status')),
    alleZeilen(() => db.from('termine').select('kunde_id, beginn').gte('beginn', jetzt)),
    db.from('leistungen_preisliste').select('bezeichnung, preis_tag_von, preis_tag_bis, preis_stunde_von, preis_stunde_bis').limit(500),
    // Für den Median je Bereich braucht es den Bereich aller Akten, nicht nur der gefragten.
    alleZeilen(() => db.from('kunden').select('id, bereich')),
  ])
  for (const [name, r] of [['Akten', akten], ['Kostenvoranschläge', kvs], ['Rechnungen', rechnungen], ['Termine', termine], ['Preisliste', preise], ['Akten', alleBereiche]] as const) {
    if (r.error) throw new Error(`${name} nicht lesbar (${r.error.message})`)
  }
  const bereichVon = new Map<string, string>(((alleBereiche.data ?? []) as Zeile[]).map((z) => [String(z.id), String(z.bereich ?? '')]))
  const kvsJeAkte = new Map<string, KvRoh[]>()
  for (const kv of (kvs.data ?? []) as KvRoh[]) if (kv.kunde_id) kvsJeAkte.set(kv.kunde_id, [...(kvsJeAkte.get(kv.kunde_id) ?? []), kv])
  const mitRechnung = new Set<string>(((rechnungen.data ?? []) as Zeile[]).filter((r) => r.kunde_id && r.status !== 'Entwurf').map((r) => String(r.kunde_id)))
  const termineJeAkte = new Map<string, string[]>()
  for (const t of (termine.data ?? []) as Zeile[]) {
    if (!t.kunde_id || !istTag(t.beginn)) continue
    termineJeAkte.set(t.kunde_id, [...(termineJeAkte.get(t.kunde_id) ?? []), String(t.beginn).slice(0, 10)].sort())
  }
  return {
    heute: opt.heute,
    akten: (akten.data ?? []) as AkteRoh[],
    kvsJeAkte,
    mitRechnung,
    termineJeAkte,
    preisliste: ((preise.data ?? []) as PreisRoh[]).filter((p) => String(p.bezeichnung ?? '').trim()),
    median: medianJeBereich((kvs.data ?? []) as KvRoh[], bereichVon),
  }
}

export type RegelErgebnis = {
  vorschlaege: Map<string, ChanceVorschlag>
  uebersprungen: { endstand: number; privat: number; bestaetigt: number; keinRecht: number }
}

/** Regel-Vorschläge für alle geladenen Akten, die der Aufrufer sehen darf (`darf` mit dem Kundenakten-Schlüssel). */
export function regelVorschlaegeFuer(g: ChanceGrundlagen, darf: (bereich: string) => boolean, am: string): RegelErgebnis {
  const vorschlaege = new Map<string, ChanceVorschlag>()
  const uebersprungen = { endstand: 0, privat: 0, bestaetigt: 0, keinRecht: 0 }
  for (const a of g.akten) {
    const kvs = g.kvsJeAkte.get(a.id) ?? []
    const kvMitBetrag = kvs.some((kv) => (kv.status === 'offen' || kv.status === 'angenommen') && (nettoVon(kv) ?? 0) > 0)
    const b = brauchtVorschlag(a, kvMitBetrag)
    if (!b.ja) {
      uebersprungen[b.grund!]++
      continue
    }
    if (!darf(String(a.bereich ?? ''))) {
      uebersprungen.keinRecht++
      continue
    }
    vorschlaege.set(a.id, regelVorschlag(a, {
      heute: g.heute,
      kvs,
      hatRechnung: g.mitRechnung.has(a.id),
      termine: g.termineJeAkte.get(a.id) ?? [],
      preisliste: g.preisliste,
      medianJeBereich: g.median,
    }, am))
  }
  return { vorschlaege, uebersprungen }
}

/** Kurzer Text eines Vorschlags für Listen und den Assistenten. */
export function vorschlagKurz(v: Pick<ChanceVorschlag, 'prozent' | 'umsatzNetto' | 'monat'>): string {
  return `${v.prozent} %${v.umsatzNetto ? ` · ${euro(v.umsatzNetto)}` : ' · ohne Umsatz'}${v.monat ? ` · ${monatName(v.monat)}` : ''}`
}
