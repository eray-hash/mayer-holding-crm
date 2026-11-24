// Umsatzziele (24.11.2026, Wunsch der Geschäftsführung): Monatsziel 50.000 € netto — KI 10.000 €, Immobilien
// 15.000 €, Beratung & Privat 25.000 €. Am Monatsanfang gilt ein Soll, täglich der Abgleich mit dem Ist; dazu der
// Trichter je Abteilung (wie viele Leads braucht es für das Soll?). Reines Rechnen ohne Datenbank — dieselbe
// Datei rechnet für die Seite /ziele, die Karte „Unser Ziel“ der Abteilungen (beide über den Server,
// email-gateway/umsatzZiel.ts), den Abschnitt in der Morgen-Übersicht und das Assistent-Werkzeug umsatzziel_stand.
//
// Alle Beträge NETTO. Monate als „JJJJ-MM“. Die Umsatz-Regeln selbst (Rechnungen, Zahlungen, Angebote × Chance,
// geschätzter Umsatz der Akten, Immobilien-Provision nach Stand des Objekts) kommen unverändert aus
// _shared/umsatzKern.ts (Umsatzvorschau) — hier wird nur nach Sparten und Monat aufgeteilt.
//
// ─── Ist je Sparte und Monat ─────────────────────────────────────────────────────────────────────────────────
//  bezahlt   = Zahlungseingang im Monat (erfasste Teilzahlungen netto anteilig; ältere bezahlte Rechnungen ohne
//              Zahlungen am „bezahlt am“-Tag) — das ist das „Ist“.
//  offen     = Rechnungen mit Rechnungsdatum im Monat, versendet und noch nicht (ganz) bezahlt (Rest netto).
//  erwartet  = was laut Umsatzvorschau im Monat noch kommt: Rechnungsentwürfe, Angebote × Chance der Akte,
//              geschätzter Umsatz der Akten (auftrag_chance: umsatzNetto × Prozent im Monat auftrag_chance.monat),
//              Immobilien-Provision × Anteil nach Stand des Objekts.
//  Hochrechnung = bezahlt + offen + erwartet.
//  Soll bis heute = Soll × vergangene Tage ÷ Tage im Monat (heute mitgezählt); Abstand = Ist − Soll bis heute
//  (negativ = Rückstand). Nötig je Werktag = (Soll − bezahlt − offen) ÷ verbleibende Werktage (Mo–Fr ab heute).
//
// ─── Welche Umsätze zählen zu welcher Sparte (umsatz_sparten) ─────────────────────────────────────────────────
//  1. Stichwort: Hat eine Sparte die Stichwort-Erkennung eingeschaltet (Vorgabe AUS) und steht eines ihrer
//     Stichwörter (als eigenes Wort, z. B. „KI“, „KI-Manager“) in Rechnungsnummer/-positionen bzw. Name/
//     Beschreibung/Positionen des Angebots, zählt der Posten dorthin — aus jedem Bereich.
//  2. Provision aus Objekten → die Sparte mit „Objekt-Provision“ (Immobilien).
//  3. Bereich der Akte (kunden.bereich) steht in der Liste der Sparte.
//  4. Sonst die Sparte „Rest“ (Beratung & Privat) — auch Rechnungen ohne Akte.
//  KI ist ein eigener Geschäftsbereich (Bereich-Schlüssel 'ki'), der erst noch ins CRM kommt: Solange es keine
//  Akte mit diesem Bereich gibt, ist das Ist 0 und es steht der Hinweis „Bereich KI wird noch eingerichtet“ dabei.
//
// ─── Trichter ───────────────────────────────────────────────────────────────────────────────────────────────
//  Beratung & Co.: Leads (neue Akten) → Erstgespräche (Akten mit Kundentermin oder Wechsel auf „Erstgespräch“)
//    → Angebote (Kostenvoranschläge mit Datum im Monat) → Aufträge (Akten mit Wechsel auf den Auftragsstand,
//    angenommenem Kostenvoranschlag oder erster Rechnung im Monat).
//  Immobilien: Interessenten (neue Akten) → Besichtigungen (nicht abgesagt) → Reservierung/Notar (Objekte, die im
//    Monat reserviert oder zum Notar gehen) → Abschlüsse (Objekte, die im Monat beurkundet/verkauft werden).
//  Verloren: Akten, die im Monat auf „Verloren / Kein Interesse“ (oder nicht qualifiziert) gingen — Datum aus
//    kunden.verloren.am (Seite „Entgangene Klienten“), sonst aus dem Statuswechsel im Verlauf, sonst die letzte
//    Aktivität. Akten haben kein Anlegedatum: als Anlage gilt der erste Verlaufseintrag (wie superuser.ts).
//  „Für das Soll brauchen wir rund N Leads“ = Soll ÷ (Ø Auftragswert × Abschlussquote), beides aus den letzten
//    12 Monaten — erst ab MIN_ABSCHLUESSE Aufträgen, sonst nur Zählen.

import { berechneUmsatzvorschau, bereichKennung, euro, monatName, monatVon, plusMonate, runde2, type UmsatzEingabe, type UmsatzVorschau } from './umsatzKern.ts'

// ─── Stellschrauben ──────────────────────────────────────────────────────────────────────────────────────────

/** Ab so vielen Aufträgen in 12 Monaten wird „so viele Leads braucht es“ hochgerechnet. */
export const MIN_ABSCHLUESSE = 5
/** Zeitraum für Ø Auftragswert und Quoten (Monate bis einschließlich des gewählten). */
export const BASIS_MONATE = 12

export type SparteRegel = {
  id: string
  name: string
  reihenfolge: number
  sollVorgabe: number
  /** Akten-Bereiche (kunden.bereich, z. B. 'immobilienkunden', 'beratung', 'ki'). */
  bereiche: string[]
  stichwoerter: string[]
  stichwortAktiv: boolean
  objektProvision: boolean
  rest: boolean
}

/** Vorbelegung — gleich wie in supabase/sql/2026-11-24_umsatzziele.sql; gilt, solange die Tabelle fehlt oder leer ist. */
export const VORGABE_SPARTEN: SparteRegel[] = [
  { id: 'ki', name: 'KI', reihenfolge: 1, sollVorgabe: 10000, bereiche: ['ki'], stichwoerter: ['KI', 'künstliche Intelligenz'], stichwortAktiv: false, objektProvision: false, rest: false },
  { id: 'immobilien', name: 'Immobilien', reihenfolge: 2, sollVorgabe: 15000, bereiche: ['immobilienkunden'], stichwoerter: [], stichwortAktiv: false, objektProvision: true, rest: false },
  { id: 'beratung', name: 'Beratung & Privat', reihenfolge: 3, sollVorgabe: 25000, bereiche: ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen', 'buecher'], stichwoerter: [], stichwortAktiv: false, objektProvision: false, rest: true },
  { id: 'fahrschule', name: 'Fahrschule', reihenfolge: 4, sollVorgabe: 5000, bereiche: ['fahrschule'], stichwoerter: [], stichwortAktiv: false, objektProvision: false, rest: false },
]

/** Bereiche, die es als Akten-Bereich gibt (für „Rest“-Trichter und Abteilungs-Zuordnung). */
export const AKTEN_BEREICHE: readonly string[] = ['beratung', 'immobilienkunden', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen', 'buecher', 'ki', 'fahrschule']

export const AKTEN_BEREICH_NAME: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilienkunden: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  buecher: 'Bücher & Verlag',
  ki: 'KI',
}

// ─── Kleine Helfer ───────────────────────────────────────────────────────────────────────────────────────────

function text(w: unknown): string {
  return typeof w === 'string' ? w : w == null ? '' : String(w)
}

function zahl(w: unknown): number {
  const n = Number(w)
  return Number.isFinite(n) ? n : 0
}

export function istMonat(m: unknown): m is string {
  return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)
}

/** Seiten-Bereich ('immobilien') oder Akten-Bereich ('immobilienkunden') → Akten-Bereich. */
export function aktenBereich(b: string | null | undefined): string {
  const s = text(b).trim()
  return s === 'immobilien' ? 'immobilienkunden' : s
}

export function tageImMonat(monat: string): number {
  const [j, m] = monat.split('-').map(Number)
  return new Date(Date.UTC(j, m, 0)).getUTCDate()
}

function wochentag(datum: string): number {
  const [j, m, d] = datum.split('-').map(Number)
  return new Date(Date.UTC(j, m - 1, d)).getUTCDay()
}

/** Werktage (Mo–Fr, ohne Feiertage) von `abTag` (einschließlich) bis Monatsende. */
export function werktageAb(monat: string, abTag: number): number {
  let n = 0
  for (let t = Math.max(1, abTag); t <= tageImMonat(monat); t++) {
    const w = wochentag(`${monat}-${String(t).padStart(2, '0')}`)
    if (w !== 0 && w !== 6) n++
  }
  return n
}

function prozentGanz(anteil: number): number {
  return Number.isFinite(anteil) ? Math.round(anteil * 100) : 0
}

/** Stichwort als eigenes Wort (Bindestrich zählt als Grenze: „KI-Manager“ ja, „Kiste“ nein). Groß/klein egal. */
export function enthaeltStichwort(t: string, stichwoerter: string[]): string | undefined {
  const quelle = text(t)
  if (!quelle) return undefined
  for (const roh of stichwoerter) {
    const w = text(roh).trim()
    if (!w) continue
    const muster = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${muster}($|[^\\p{L}\\p{N}])`, 'iu').test(quelle)) return w
  }
  return undefined
}

// ─── Sparten und Soll ────────────────────────────────────────────────────────────────────────────────────────

/** Zeilen aus umsatz_sparten → Regeln; leer/fehlend → Vorgabe. */
export function spartenAusZeilen(zeilen: Record<string, unknown>[] | null | undefined): SparteRegel[] {
  const liste = (zeilen ?? [])
    .filter((z) => text(z?.id).trim())
    .map((z) => ({
      id: text(z.id).trim(),
      name: text(z.name).trim() || text(z.id),
      reihenfolge: zahl(z.reihenfolge),
      sollVorgabe: Math.max(0, zahl(z.soll_vorgabe)),
      bereiche: Array.isArray(z.bereiche) ? z.bereiche.map((b) => text(b).trim()).filter(Boolean) : [],
      stichwoerter: Array.isArray(z.stichwoerter) ? z.stichwoerter.map((b) => text(b).trim()).filter(Boolean) : [],
      stichwortAktiv: z.stichwort_aktiv === true,
      objektProvision: z.objekt_provision === true,
      rest: z.rest === true,
    }))
  return (liste.length ? liste : VORGABE_SPARTEN.map((s) => ({ ...s }))).sort((a, b) => a.reihenfolge - b.reihenfolge || a.id.localeCompare(b.id))
}

export type SollZeile = { monat: string; sparte: string; sollNetto: number; geaendertVon?: string; geaendertAm?: string }

export function sollAusZeilen(zeilen: Record<string, unknown>[] | null | undefined): SollZeile[] {
  return (zeilen ?? [])
    .filter((z) => istMonat(z?.monat) && text(z?.sparte))
    .map((z) => ({ monat: text(z.monat), sparte: text(z.sparte), sollNetto: Math.max(0, zahl(z.soll_netto)), geaendertVon: text(z.geaendert_von) || undefined, geaendertAm: text(z.geaendert_am) || undefined }))
}

/** Soll je Sparte im Monat: eingetragener Wert, sonst die Vorgabe der Sparte. */
export function sollImMonat(sparten: SparteRegel[], soll: SollZeile[], monat: string): Record<string, { soll: number; ausVorgabe: boolean; geaendertVon?: string; geaendertAm?: string }> {
  const aus: Record<string, { soll: number; ausVorgabe: boolean; geaendertVon?: string; geaendertAm?: string }> = {}
  for (const s of sparten) {
    const z = soll.find((x) => x.monat === monat && x.sparte === s.id)
    aus[s.id] = z ? { soll: z.sollNetto, ausVorgabe: false, geaendertVon: z.geaendertVon, geaendertAm: z.geaendertAm } : { soll: s.sollVorgabe, ausVorgabe: true }
  }
  return aus
}

/** Fehlende Soll-Zeilen eines Monats (zum Festschreiben am Monatsanfang). */
export function fehlendeSollZeilen(sparten: SparteRegel[], soll: SollZeile[], monat: string): SollZeile[] {
  return sparten.filter((s) => !soll.some((z) => z.monat === monat && z.sparte === s.id)).map((s) => ({ monat, sparte: s.id, sollNetto: s.sollVorgabe }))
}

export type PostenQuelle = { art: 'rechnung' | 'entwurf' | 'angebot' | 'provision'; bereich?: string; text?: string }

/** Zu welcher Sparte gehört ein Posten? undefined = keine (nur ohne „Rest“-Sparte möglich). */
export function sparteFuer(sparten: SparteRegel[], q: PostenQuelle): string | undefined {
  for (const s of sparten) if (s.stichwortAktiv && q.text && enthaeltStichwort(q.text, s.stichwoerter)) return s.id
  if (q.art === 'provision') {
    const p = sparten.find((s) => s.objektProvision)
    if (p) return p.id
  }
  const b = bereichKennung(q.bereich)
  for (const s of sparten) if (s.bereiche.some((x) => bereichKennung(x) === b)) return s.id
  return sparten.find((s) => s.rest)?.id
}

// ─── Ist je Sparte ───────────────────────────────────────────────────────────────────────────────────────────

export type ZielEingabe = {
  heute: string
  umsatz: UmsatzEingabe
  /** Suchtext je Posten für die Stichwort-Erkennung: Schlüssel = Rechnungs-ID, Angebots-ID oder 'schaetzung:<Akten-ID>'. */
  texte?: Record<string, string>
  sparten: SparteRegel[]
  soll: SollZeile[]
  /** Akten-Bereiche, in denen es mindestens eine Akte gibt (für den Hinweis „wird noch eingerichtet“). */
  vorhandeneBereiche?: string[]
}

export type Werte = { soll: number; bezahlt: number; offen: number; erwartet: number; istPlusOffen: number; hochrechnung: number; prozent: number; prozentHochrechnung: number; sollBisHeute: number; abstand: number; noetigProWerktag: number }

export type SpartenStand = Werte & { sparte: string; name: string; sollAusVorgabe: boolean; geaendertVon?: string; geaendertAm?: string; hinweis?: string }

export type ZielStand = {
  monat: string
  monatName: string
  heute: string
  /** 'laufend' | 'vorbei' | 'kommend' */
  lage: 'laufend' | 'vorbei' | 'kommend'
  tageImMonat: number
  vergangeneTage: number
  verbleibendeWerktage: number
  gesamt: Werte
  sparten: SpartenStand[]
  /** Umsatz, den keine Sparte nimmt (nur ohne „Rest“-Sparte). */
  ohneSparte: number
}

function werte(soll: number, bezahlt: number, offen: number, erwartet: number, anteilVergangen: number, werktage: number): Werte {
  const istPlusOffen = runde2(bezahlt + offen)
  const hochrechnung = runde2(istPlusOffen + erwartet)
  const sollBisHeute = runde2(soll * anteilVergangen)
  return {
    soll: runde2(soll), bezahlt: runde2(bezahlt), offen: runde2(offen), erwartet: runde2(erwartet), istPlusOffen, hochrechnung,
    prozent: soll > 0 ? prozentGanz(bezahlt / soll) : 0,
    prozentHochrechnung: soll > 0 ? prozentGanz(hochrechnung / soll) : 0,
    sollBisHeute,
    abstand: runde2(bezahlt - sollBisHeute),
    noetigProWerktag: werktage > 0 ? runde2(Math.max(0, soll - istPlusOffen) / werktage) : 0,
  }
}

/** Zeitlage eines Monats gegenüber heute. */
export function zeitlage(monat: string, heute: string): { lage: ZielStand['lage']; vergangeneTage: number; verbleibendeWerktage: number; tage: number } {
  const tage = tageImMonat(monat)
  const aktuell = monatVon(heute)!
  if (monat < aktuell) return { lage: 'vorbei', vergangeneTage: tage, verbleibendeWerktage: 0, tage }
  if (monat > aktuell) return { lage: 'kommend', vergangeneTage: 0, verbleibendeWerktage: werktageAb(monat, 1), tage }
  const tag = Number(heute.slice(8, 10))
  return { lage: 'laufend', vergangeneTage: tag, verbleibendeWerktage: werktageAb(monat, tag), tage }
}

export function berechneZielStand(e: ZielEingabe, monat: string, vorschau?: UmsatzVorschau): ZielStand {
  const v = vorschau ?? berechneUmsatzvorschau(e.umsatz)
  const texte = e.texte ?? {}
  const zeit = zeitlage(monat, e.heute)
  const anteil = zeit.tage > 0 ? zeit.vergangeneTage / zeit.tage : 0
  const summe: Record<string, { bezahlt: number; offen: number; erwartet: number }> = {}
  const leer = () => ({ bezahlt: 0, offen: 0, erwartet: 0 })
  for (const s of e.sparten) summe[s.id] = leer()
  const ohne = leer()
  const ziel = (id: string | undefined) => (id && summe[id]) || ohne

  // bezahlt: Zahlungseingang im Monat
  for (const g of v.eingaenge) {
    if (g.monat !== monat) continue
    ziel(sparteFuer(e.sparten, { art: 'rechnung', bereich: g.bereich, text: texte[g.rechnungId] })).bezahlt += g.netto
  }
  // offen: versendete Rechnungen mit Rechnungsdatum im Monat, Rest netto (Stand heute)
  const rechnungJeId = new Map(e.umsatz.rechnungen.map((r) => [r.id, r]))
  for (const o of v.offene) {
    if (monatVon(rechnungJeId.get(o.id)?.datum) !== monat) continue
    ziel(sparteFuer(e.sparten, { art: 'rechnung', bereich: o.bereich, text: texte[o.id] })).offen += o.offenNetto
  }
  // erwartet: Entwürfe, Angebote × Chance, Schätzungen, Provision — im Monat
  for (const p of v.posten) {
    if (p.monat !== monat || p.art === 'rechnung') continue
    ziel(sparteFuer(e.sparten, { art: p.art, bereich: p.bereich, text: texte[p.id] })).erwartet += p.gewichtet
  }

  const sollJe = sollImMonat(e.sparten, e.soll, monat)
  const vorhanden = e.vorhandeneBereiche ? new Set(e.vorhandeneBereiche.map(bereichKennung)) : undefined
  const sparten: SpartenStand[] = e.sparten.map((s) => {
    const x = summe[s.id]
    const so = sollJe[s.id]
    let hinweis: string | undefined
    if (vorhanden && !s.rest && !s.objektProvision && s.bereiche.length > 0 && !s.bereiche.some((b) => vorhanden.has(bereichKennung(b))) && !s.stichwortAktiv) {
      hinweis = `Bereich ${s.name} wird noch eingerichtet — bis dahin zählt hier nichts.`
    }
    return { sparte: s.id, name: s.name, sollAusVorgabe: so.ausVorgabe, geaendertVon: so.geaendertVon, geaendertAm: so.geaendertAm, ...(hinweis ? { hinweis } : {}), ...werte(so.soll, x.bezahlt, x.offen, x.erwartet, anteil, zeit.verbleibendeWerktage) }
  })
  const t = sparten.reduce((a, s) => ({ soll: a.soll + s.soll, bezahlt: a.bezahlt + s.bezahlt, offen: a.offen + s.offen, erwartet: a.erwartet + s.erwartet }), { soll: 0, bezahlt: 0, offen: 0, erwartet: 0 })
  return {
    monat, monatName: monatName(monat), heute: e.heute, lage: zeit.lage, tageImMonat: zeit.tage, vergangeneTage: zeit.vergangeneTage, verbleibendeWerktage: zeit.verbleibendeWerktage,
    gesamt: werte(t.soll, t.bezahlt, t.offen, t.erwartet, anteil, zeit.verbleibendeWerktage),
    sparten,
    ohneSparte: runde2(ohne.bezahlt + ohne.offen + ohne.erwartet),
  }
}

// ─── Trichter ────────────────────────────────────────────────────────────────────────────────────────────────

export type Verlaufseintrag = { date?: unknown; text?: unknown }
export type TrichterAkte = { id: string; bereich: string; status?: string | null; activities?: Verlaufseintrag[] | null; verlorenAm?: string | null }
export type TrichterTermin = { kundeId: string; beginn: string }
export type TrichterBesichtigung = { kundeId?: string | null; kundeBereich?: string | null; beginn: string; status?: string | null }
export type TrichterAngebot = { id: string; kundeId?: string | null; bereich?: string | null; status: string; datum?: string | null; erstelltAm?: string | null; privat?: boolean }
export type TrichterRechnung = { id: string; kundeId?: string | null; datum: string; status: string; netto: number }
export type TrichterObjekt = { id: string; privat?: boolean; activities?: Verlaufseintrag[] | null }
export type TrichterInvestor = { id: string; seit?: string | null }

export type TrichterDaten = {
  akten: TrichterAkte[]
  termine: TrichterTermin[]
  besichtigungen: TrichterBesichtigung[]
  angebote: TrichterAngebot[]
  rechnungen: TrichterRechnung[]
  objekte: TrichterObjekt[]
  investoren: TrichterInvestor[]
}

export type TrichterArt = 'beratung' | 'immobilien'
export type TrichterStufe = { id: string; name: string; anzahl: number; /** Anteil der vorigen Stufe (0–1), wenn die vorige > 0 ist. */ quote?: number }

export type TrichterZahlen = { stufen: TrichterStufe[]; verloren: number; neueInvestoren?: number }

export type Trichter = {
  monat: string
  art: TrichterArt
  bereiche: string[]
  name: string
  monatZahlen: TrichterZahlen
  /** Summe der letzten BASIS_MONATE Monate (bis einschließlich `monat`). */
  basis: TrichterZahlen & {
    monate: number
    auftraege: number
    leads: number
    abschlussquote?: number
    /** verloren ÷ (verloren + Aufträge) */
    verlustquote?: number
    /** Ø Rechnungsbetrag netto je Akte mit Rechnung in der Basis-Zeit. */
    durchschnittAuftrag?: number
    aktenMitRechnung: number
  }
  soll?: number
  /** Leads, die es für das Soll braucht — nur mit genug Daten. */
  leadsNoetig?: number
  hinweis?: string
}

// Wie email-gateway/wochenrueckblick.ts (leseStatuswechsel / GEWONNEN / VERLOREN) — hier als reine Kopie,
// damit der Kern ohne Abhängigkeiten bleibt.
const STATUS_WECHSEL = /(?:^|[\s—;(])Status:\s*(?:(.+?)\s*→\s*)?(.+?)(?=\s+am\s+\d{4}-\d{2}-\d{2}|;|\.\s|\.$|$)/
export const GEWONNEN: Record<string, RegExp> = {
  beratung: /beratungsvertrag unterschrieben|aktives mandat/i,
  immobilienkunden: /^abgeschlossen/i,
  erben: /^umsetzung|^abgeschlossen/i,
  betriebsuebergabe: /^abgeschlossen|übergabe vollzogen/i,
  betriebsformen: /^umsetzung|^abgeschlossen/i,
  akademie: /anmeldung eingegangen/i,
  finanzierungen: /zeichnung(sschein)? eingegangen/i,
  ki: /auftrag|^abgeschlossen/i,
}
const VERLOREN_TEXT = /verloren|kein interesse|abgebrochen|nicht zustande|nicht qualifiziert|nicht passend|nicht weiter verfolgt/i
const VERLOREN_STATUS = new Set(['verloren', 'nicht_qualifiziert', 'abgebrochen'])
const ERSTGESPRAECH = /erstgespräch|erstgespraech|bedarfsanalyse|ist-analyse/i
const OBJEKT_RESERVIERT = /reserviert|notarauftrag|vertragsentwurf|prüfung durch|änderungswünsche|notartermin/i
const OBJEKT_ABSCHLUSS = /beurkundet|fälligkeitsmitteilung|kaufpreis gezahlt|besitzübergang|verkauft/i

export function leseStatuswechsel(eintrag: string): { von: string | null; nach: string } | null {
  const m = STATUS_WECHSEL.exec(eintrag)
  if (!m) return null
  const nach = m[2].trim()
  if (!nach || nach.length > 80) return null
  return { von: m[1]?.trim() || null, nach }
}

function tagVon(w: unknown): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(text(w))
  return m ? m[1] : ''
}

function ersterTag(activities: Verlaufseintrag[] | null | undefined): string {
  let erst = ''
  for (const a of activities ?? []) {
    const d = tagVon(a?.date)
    if (d && (!erst || d < erst)) erst = d
  }
  return erst
}

function letzterTag(activities: Verlaufseintrag[] | null | undefined): string {
  let letzt = ''
  for (const a of activities ?? []) {
    const d = tagVon(a?.date)
    if (d > letzt) letzt = d
  }
  return letzt
}

/** Tage, an denen der Verlauf einen Wechsel auf einen passenden Stand zeigt (nicht von einem schon passenden). */
function wechselTage(activities: Verlaufseintrag[] | null | undefined, re: RegExp): string[] {
  const tage: string[] = []
  for (const a of activities ?? []) {
    const w = leseStatuswechsel(text(a?.text))
    if (!w || !re.test(w.nach) || (w.von && re.test(w.von))) continue
    const d = tagVon(a?.date) || tagVon(/am (\d{4}-\d{2}-\d{2})/.exec(text(a?.text))?.[1])
    if (d) tage.push(d)
  }
  return tage
}

function istSammelakte(id: string): boolean {
  return id.startsWith('k_intern') || id.startsWith('k_eingang')
}

/** Monat, in dem eine Akte verloren ging — oder undefined. */
export function verlorenMonat(a: TrichterAkte): string | undefined {
  if (monatVon(a.verlorenAm)) return monatVon(a.verlorenAm)
  const tage = wechselTage(a.activities, VERLOREN_TEXT)
  if (VERLOREN_STATUS.has(text(a.status))) {
    if (tage.length) return monatVon(tage.sort()[tage.length - 1])
    return monatVon(letzterTag(a.activities)) // ohne Wechsel im Verlauf: letzte Aktivität
  }
  return undefined
}

function zaehleMonat(d: TrichterDaten, monat: string, bereiche: Set<string>, art: TrichterArt): TrichterZahlen & { auftragsAkten: Set<string> } {
  const imMonat = (iso: string | null | undefined) => monatVon(iso) === monat
  const akten = d.akten.filter((a) => bereiche.has(text(a.bereich)) && !istSammelakte(a.id))
  const aktenIds = new Set(akten.map((a) => a.id))
  const aktenBereichJeId = new Map(d.akten.map((a) => [a.id, text(a.bereich)]))

  const leads = akten.filter((a) => imMonat(ersterTag(a.activities))).length
  const verloren = akten.filter((a) => verlorenMonat(a) === monat).length
  const stufen: TrichterStufe[] = []
  const auftragsAkten = new Set<string>()

  if (art === 'immobilien') {
    const besichtigungen = d.besichtigungen.filter((b) => imMonat(b.beginn) && text(b.status) !== 'abgesagt' && (b.kundeId ? aktenIds.has(b.kundeId) || bereiche.has(aktenBereich(b.kundeBereich)) : true)).length
    const objekte = d.objekte.filter((o) => !o.privat)
    const reserviert = objekte.filter((o) => wechselTage(o.activities, OBJEKT_RESERVIERT).some((t) => imMonat(t))).length
    const abschluss = objekte.filter((o) => wechselTage(o.activities, OBJEKT_ABSCHLUSS).some((t) => imMonat(t)))
    for (const o of abschluss) auftragsAkten.add(`o:${o.id}`)
    stufen.push(
      { id: 'leads', name: 'Interessenten', anzahl: leads },
      { id: 'besichtigungen', name: 'Besichtigungen', anzahl: besichtigungen },
      { id: 'reserviert', name: 'Reservierung / Notar', anzahl: reserviert },
      { id: 'auftraege', name: 'Abschlüsse', anzahl: abschluss.length },
    )
  } else {
    const gespraech = new Set<string>()
    for (const t of d.termine) if (aktenIds.has(t.kundeId) && imMonat(t.beginn)) gespraech.add(t.kundeId)
    for (const a of akten) if (wechselTage(a.activities, ERSTGESPRAECH).some((t) => imMonat(t))) gespraech.add(a.id)
    const angebote = d.angebote.filter((kv) => {
      if (kv.privat || text(kv.bereich) === 'privat') return false
      const b = kv.kundeId ? aktenBereichJeId.get(kv.kundeId) : aktenBereich(kv.bereich)
      return !!b && bereiche.has(b) && imMonat(kv.datum || kv.erstelltAm)
    })
    for (const a of akten) {
      const re = GEWONNEN[text(a.bereich)]
      if (re && wechselTage(a.activities, re).some((t) => imMonat(t))) auftragsAkten.add(a.id)
    }
    for (const kv of d.angebote) if (kv.status === 'angenommen' && kv.kundeId && aktenIds.has(kv.kundeId) && imMonat(kv.datum || kv.erstelltAm)) auftragsAkten.add(kv.kundeId)
    // Erste Rechnung einer Akte im Monat = Auftrag (frühere Rechnungen derselben Akte: kein neuer Auftrag).
    const ersteRechnung = new Map<string, string>()
    for (const r of d.rechnungen) {
      if (!r.kundeId || r.status === 'Entwurf' || !monatVon(r.datum)) continue
      const alt = ersteRechnung.get(r.kundeId)
      if (!alt || r.datum < alt) ersteRechnung.set(r.kundeId, r.datum)
    }
    for (const [k, datum] of ersteRechnung) if (aktenIds.has(k) && imMonat(datum)) auftragsAkten.add(k)
    stufen.push(
      { id: 'leads', name: 'Leads (neue Akten)', anzahl: leads },
      { id: 'erstgespraeche', name: 'Erstgespräche', anzahl: gespraech.size },
      { id: 'angebote', name: 'Angebote', anzahl: angebote.length },
      { id: 'auftraege', name: 'Aufträge', anzahl: auftragsAkten.size },
    )
  }
  for (let i = 1; i < stufen.length; i++) if (stufen[i - 1].anzahl > 0) stufen[i].quote = stufen[i].anzahl / stufen[i - 1].anzahl
  const zahlen: TrichterZahlen & { auftragsAkten: Set<string> } = { stufen, verloren, auftragsAkten }
  if (bereiche.has('finanzierungen')) {
    const neueAkten = akten.filter((a) => a.bereich === 'finanzierungen' && imMonat(ersterTag(a.activities))).length
    zahlen.neueInvestoren = neueAkten + d.investoren.filter((i) => imMonat(i.seit)).length
  }
  return zahlen
}

/** Trichter für Akten-Bereiche (kunden.bereich) im Monat, dazu die 12-Monats-Basis und — mit genug Daten — die nötigen Leads. */
export function berechneTrichter(d: TrichterDaten, monat: string, bereicheRoh: string[], optionen: { art?: TrichterArt; soll?: number; name?: string } = {}): Trichter {
  const bereiche = new Set(bereicheRoh.map(aktenBereich))
  const art: TrichterArt = optionen.art ?? (bereiche.has('immobilienkunden') && bereiche.size === 1 ? 'immobilien' : 'beratung')
  const monatZ = zaehleMonat(d, monat, bereiche, art)
  const monatZahlen: TrichterZahlen = { stufen: monatZ.stufen, verloren: monatZ.verloren, ...(monatZ.neueInvestoren !== undefined ? { neueInvestoren: monatZ.neueInvestoren } : {}) }

  const summeStufen = new Map<string, TrichterStufe>()
  let verloren = 0
  let neueInvestoren: number | undefined
  const von = plusMonate(monat, -(BASIS_MONATE - 1))
  for (let m = von, i = 0; m <= monat && i < BASIS_MONATE; m = plusMonate(m, 1), i++) {
    const z = m === monat ? monatZ : zaehleMonat(d, m, bereiche, art)
    for (const s of z.stufen) {
      const alt = summeStufen.get(s.id)
      summeStufen.set(s.id, { id: s.id, name: s.name, anzahl: (alt?.anzahl ?? 0) + s.anzahl })
    }
    verloren += z.verloren
    if (z.neueInvestoren !== undefined) neueInvestoren = (neueInvestoren ?? 0) + z.neueInvestoren
  }
  const stufen = [...summeStufen.values()]
  for (let i = 1; i < stufen.length; i++) if (stufen[i - 1].anzahl > 0) stufen[i].quote = stufen[i].anzahl / stufen[i - 1].anzahl
  const leads = stufen.find((s) => s.id === 'leads')?.anzahl ?? 0
  const auftraege = stufen.find((s) => s.id === 'auftraege')?.anzahl ?? 0

  // Ø Auftragswert: Rechnungen (ohne Entwürfe) der Basis-Zeit je Akte in diesen Bereichen.
  const aktenIds = new Set(d.akten.filter((a) => bereiche.has(text(a.bereich))).map((a) => a.id))
  const jeAkte = new Map<string, number>()
  for (const r of d.rechnungen) {
    const m = monatVon(r.datum)
    if (!r.kundeId || r.status === 'Entwurf' || !m || m < von || m > monat || !aktenIds.has(r.kundeId)) continue
    jeAkte.set(r.kundeId, (jeAkte.get(r.kundeId) ?? 0) + zahl(r.netto))
  }
  const summeRechnungen = [...jeAkte.values()].reduce((s, x) => s + x, 0)
  const durchschnittAuftrag = jeAkte.size > 0 ? runde2(summeRechnungen / jeAkte.size) : undefined
  const abschlussquote = leads > 0 ? auftraege / leads : undefined
  const verlustquote = verloren + auftraege > 0 ? verloren / (verloren + auftraege) : undefined

  const t: Trichter = {
    monat, art, bereiche: [...bereiche],
    name: optionen.name ?? [...bereiche].map((b) => AKTEN_BEREICH_NAME[b] ?? b).join(', '),
    monatZahlen,
    basis: { monate: BASIS_MONATE, stufen, verloren, ...(neueInvestoren !== undefined ? { neueInvestoren } : {}), auftraege, leads, abschlussquote, verlustquote, durchschnittAuftrag, aktenMitRechnung: jeAkte.size },
    soll: optionen.soll,
  }
  if (auftraege < MIN_ABSCHLUESSE) {
    t.hinweis = `Zu wenig Daten für eine Hochrechnung: ${auftraege} ${auftraege === 1 ? 'Abschluss' : 'Abschlüsse'} in ${BASIS_MONATE} Monaten (ab ${MIN_ABSCHLUESSE} rechnen wir hoch). Bis dahin wird nur gezählt.`
  } else if (!durchschnittAuftrag || !abschlussquote) {
    t.hinweis = 'Für die Hochrechnung fehlen Rechnungen mit Betrag (Ø Auftragswert unbekannt).'
  } else if (optionen.soll !== undefined && optionen.soll > 0) {
    t.leadsNoetig = Math.ceil(optionen.soll / (durchschnittAuftrag * abschlussquote))
  }
  return t
}

/** Akten-Bereiche einer Sparte; die „Rest“-Sparte bekommt alle Bereiche, die keine andere Sparte nennt. */
export function bereicheDerSparte(sparten: SparteRegel[], id: string): string[] {
  const s = sparten.find((x) => x.id === id)
  if (!s) return []
  const eigene = s.bereiche.map(aktenBereich)
  if (!s.rest) return eigene
  const andere = new Set(sparten.filter((x) => x.id !== id).flatMap((x) => x.bereiche.map(aktenBereich)))
  return [...new Set([...eigene, ...AKTEN_BEREICHE.filter((b) => !andere.has(b))])]
}

/** Sparte einer Abteilung (Seiten-Bereich wie 'immobilien', 'erben' …). */
export function sparteDesBereichs(sparten: SparteRegel[], bereich: string): string | undefined {
  const b = aktenBereich(bereich)
  return sparten.find((s) => s.bereiche.map(aktenBereich).includes(b))?.id ?? sparten.find((s) => s.rest)?.id
}

// ─── Texte ───────────────────────────────────────────────────────────────────────────────────────────────────

const kurzerName = (name: string) => name.split(/\s*&\s*/)[0]

function zahlOhneEuro(n: number): string {
  return Math.round(n).toLocaleString('de-DE')
}

/** Die kurze Tagesmeldung, z. B. „Umsatzziel November: 12.300 von 50.000 € (25 %), Soll bis heute 33.000 € — Rückstand 20.700 €. KI 0/10.000, …“ */
export function kurzMeldung(z: ZielStand): string {
  const g = z.gesamt
  const monat = z.monatName.split(' ')[0]
  const abstand = g.abstand < 0 ? `Rückstand ${euro(-g.abstand)}` : `Vorsprung ${euro(g.abstand)}`
  const teile = z.sparten.map((s) => `${kurzerName(s.name)} ${zahlOhneEuro(s.bezahlt)}/${zahlOhneEuro(s.soll)}`).join(', ')
  return `Umsatzziel ${monat}: ${zahlOhneEuro(g.bezahlt)} von ${euro(g.soll)} (${g.prozent} %), Soll bis heute ${euro(g.sollBisHeute)} — ${abstand}. ${teile}.`
}

/** Zeilen für den Abschnitt in der Morgen-Übersicht (Titel = kurzMeldung bis zum ersten Punkt). */
export function morgenZeilen(z: ZielStand): { titel: string; zeilen: string[] } {
  const g = z.gesamt
  const monat = z.monatName.split(' ')[0]
  const zeilen = z.sparten.map((s) => `${s.name}: ${euro(s.bezahlt)} von ${euro(s.soll)} (${s.prozent} %)${s.offen > 0 ? `, offen ${euro(s.offen)}` : ''}${s.hinweis ? ' — wird noch eingerichtet' : ''}`)
  zeilen.push(`Soll bis heute ${euro(g.sollBisHeute)} — ${g.abstand < 0 ? `Rückstand ${euro(-g.abstand)}` : `Vorsprung ${euro(g.abstand)}`}`)
  zeilen.push(`Hochrechnung (mit offenen Rechnungen und Erwartetem): ${euro(g.hochrechnung)}`)
  if (z.verbleibendeWerktage > 0 && g.noetigProWerktag > 0) zeilen.push(`Nötig: ${euro(g.noetigProWerktag)} je Werktag (${z.verbleibendeWerktage} Werktage übrig)`)
  return { titel: `Umsatzziel ${monat}: ${euro(g.bezahlt)} von ${euro(g.soll)} (${g.prozent} %)`, zeilen }
}

function quoteText(q: number | undefined): string {
  return q === undefined ? '–' : `${Math.round(q * 100)} %`
}

export function trichterText(t: Trichter): string[] {
  const z: string[] = []
  z.push(`Trichter ${t.name} — ${monatName(t.monat)}: ${t.monatZahlen.stufen.map((s) => `${s.name} ${s.anzahl}`).join(' → ')}; verloren ${t.monatZahlen.verloren}${t.monatZahlen.neueInvestoren !== undefined ? `; neue Investoren ${t.monatZahlen.neueInvestoren}` : ''}.`)
  const b = t.basis
  z.push(`Letzte ${b.monate} Monate: ${b.stufen.map((s, i) => `${s.name} ${s.anzahl}${i > 0 ? ` (${quoteText(s.quote)})` : ''}`).join(' → ')}; verloren ${b.verloren}${b.verlustquote !== undefined ? ` (Verlustquote ${quoteText(b.verlustquote)})` : ''}.`)
  if (b.durchschnittAuftrag) z.push(`Ø Auftragswert ${euro(b.durchschnittAuftrag)} (aus ${b.aktenMitRechnung} ${b.aktenMitRechnung === 1 ? 'Akte' : 'Akten'} mit Rechnung).`)
  if (t.leadsNoetig !== undefined) z.push(`Für das Soll von ${euro(t.soll ?? 0)} brauchen wir rund ${t.leadsNoetig} Leads im Monat (Soll ÷ (Ø Auftragswert × Abschlussquote ${quoteText(b.abschlussquote)})).`)
  if (t.hinweis) z.push(t.hinweis)
  return z
}

/** Ausführlicher Bericht für den Assistenten. */
export function zielBericht(z: ZielStand, trichter: Trichter[] = [], nurSparte?: string): string {
  const zeilen: string[] = []
  const g = z.gesamt
  const lage = z.lage === 'vorbei' ? ' (abgeschlossener Monat)' : z.lage === 'kommend' ? ' (kommender Monat)' : ` (Stand ${z.heute.split('-').reverse().join('.')}, Tag ${z.vergangeneTage} von ${z.tageImMonat})`
  zeilen.push(`Umsatzziel ${z.monatName}${lage}, alles netto:`)
  if (!nurSparte) {
    zeilen.push(`Gesamt: Ist (bezahlt) ${euro(g.bezahlt)} von ${euro(g.soll)} (${g.prozent} %); mit offenen Rechnungen ${euro(g.istPlusOffen)}; Hochrechnung ${euro(g.hochrechnung)} (${g.prozentHochrechnung} %).`)
    if (z.lage === 'laufend') zeilen.push(`Soll bis heute ${euro(g.sollBisHeute)} — ${g.abstand < 0 ? `Rückstand ${euro(-g.abstand)}` : `Vorsprung ${euro(g.abstand)}`}. Nötig: ${euro(g.noetigProWerktag)} je verbleibendem Werktag (${z.verbleibendeWerktage}).`)
  }
  for (const s of z.sparten) {
    if (nurSparte && s.sparte !== nurSparte) continue
    zeilen.push(`- ${s.name}: Ist ${euro(s.bezahlt)} von ${euro(s.soll)} (${s.prozent} %)${s.sollAusVorgabe ? ' [Soll = Vorgabe]' : ''}; offen ${euro(s.offen)}; erwartet ${euro(s.erwartet)}; Hochrechnung ${euro(s.hochrechnung)}${z.lage === 'laufend' ? `; Soll bis heute ${euro(s.sollBisHeute)} (${s.abstand < 0 ? `Rückstand ${euro(-s.abstand)}` : `Vorsprung ${euro(s.abstand)}`}); nötig ${euro(s.noetigProWerktag)} je Werktag` : ''}.${s.hinweis ? ` ${s.hinweis}` : ''}`)
  }
  if (z.ohneSparte > 0 && !nurSparte) zeilen.push(`Ohne Sparte: ${euro(z.ohneSparte)} (keine Sparte als „Rest“ eingestellt).`)
  for (const t of trichter) zeilen.push('', ...trichterText(t))
  zeilen.push('', 'Regeln: Ist = Zahlungseingang im Monat; offen = versendete Rechnungen des Monats, noch nicht bezahlt; erwartet = Entwürfe, Angebote × Chance, geschätzter Umsatz der Akten × Chance und Immobilien-Provision nach Stand des Objekts. Soll bis heute = Soll × vergangene Tage ÷ Tage im Monat.')
  return zeilen.join('\n')
}

// ─── Gesamtübersicht (Seite /ziele, Karte „Unser Ziel“, Assistent) ─────────────────────────────────────────────

export type ZielUebersicht = {
  stand: ZielStand
  /** Trichter je Sparte (mit Soll der Sparte → nötige Leads). */
  trichter: { sparte: string; trichter: Trichter }[]
  /** Trichter einer Abteilung, wenn gefragt (Soll nur, wenn die Abteilung die ganze Sparte ist). */
  bereich?: { bereich: string; sparte?: string; trichter: Trichter }
  sparten: SparteRegel[]
}

export function zielUebersicht(e: ZielEingabe, d: TrichterDaten, monat: string, optionen: { bereich?: string; vorschau?: UmsatzVorschau } = {}): ZielUebersicht {
  const stand = berechneZielStand(e, monat, optionen.vorschau)
  const trichter = e.sparten.map((s) => {
    const st = stand.sparten.find((x) => x.sparte === s.id)
    return { sparte: s.id, trichter: berechneTrichter(d, monat, bereicheDerSparte(e.sparten, s.id), { art: s.objektProvision ? 'immobilien' : 'beratung', soll: st?.soll, name: s.name }) }
  })
  const aus: ZielUebersicht = { stand, trichter, sparten: e.sparten }
  if (optionen.bereich) {
    const b = aktenBereich(optionen.bereich)
    const sparte = sparteDesBereichs(e.sparten, b)
    const ganz = sparte ? bereicheDerSparte(e.sparten, sparte) : []
    const soll = ganz.length === 1 && ganz[0] === b ? stand.sparten.find((x) => x.sparte === sparte)?.soll : undefined
    aus.bereich = { bereich: b, sparte, trichter: berechneTrichter(d, monat, [b], { soll, name: AKTEN_BEREICH_NAME[b] ?? b }) }
  }
  return aus
}
