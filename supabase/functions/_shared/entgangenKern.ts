// Entgangene Klienten (24.11.2026, Wunsch der Geschäftsführung): Klienten, die uns entgangen sind, und warum.
//
// Gemeinsamer Kern für das CRM (Status-Dialog, Seite /entgangen), den Telegram-Assistenten
// (telegram-gateway/entgangenWerkzeuge.ts) und den Server (email-gateway/entgangen.ts). Reine Funktionen —
// kein Netz, keine Datenbank —, damit alle drei dieselben Gründe, Texte und Zahlen haben.
//
// Datenmodell: kunden.verloren (jsonb, SQL supabase/sql/2026-11-24_entgangene_klienten.sql) ist gesetzt,
// solange die Akte auf „verloren“ steht. Beim Wieder-Aufnehmen wird es geleert; die Historie bleibt im Verlauf.
//
// „Droht zu entgehen“: offene Akten (kein Endstand, nicht privat) mit langer Funkstille, niedriger bestätigter
// oder vorgeschlagener Chance oder einer Rechnung, die lange über dem Zahlungsziel liegt. Grenzen in DROH_GRENZEN.

import { STUFE_ZURUECK, STUFEN_NAMEN, stufeFuer } from './chanceKern.ts'
import { AKTE_ENDSTAENDE } from './umsatzKern.ts'

// ─── Gründe ─────────────────────────────────────────────────────────────────────────────────────────

export const ENTGANGEN_GRUENDE = [
  { id: 'keine_rueckmeldung', label: 'Keine Rückmeldung mehr' },
  { id: 'eigener_steuerberater', label: 'Bleibt beim eigenen Steuerberater' },
  { id: 'zu_teuer', label: 'Zu teuer' },
  { id: 'kein_bedarf', label: 'Kein Bedarf / kein Interesse' },
  { id: 'konkurrenz', label: 'Hat sich für Konkurrenz entschieden' },
  { id: 'zahlt_nicht', label: 'Zahlt nicht / Grundgebühr nicht bezahlt' },
  { id: 'zeitpunkt', label: 'Zeitpunkt passt nicht (aufgeschoben)' },
  { id: 'passt_nicht', label: 'Passt nicht zu uns' },
  { id: 'persoenlich', label: 'Verstorben / persönliche Gründe' },
  { id: 'sonstiges', label: 'Sonstiges' },
] as const

export type EntgangenGrund = (typeof ENTGANGEN_GRUENDE)[number]['id']

export const GRUND_IDS: readonly EntgangenGrund[] = ENTGANGEN_GRUENDE.map((g) => g.id)

export function grundLabel(grund: string | null | undefined): string {
  return ENTGANGEN_GRUENDE.find((g) => g.id === grund)?.label ?? 'Sonstiges'
}

function einfach(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Stichwörter für frei formulierte Gründe (Telegram: „hat sich nicht mehr gemeldet“, „war ihm zu teuer“).
const STICHWOERTER: [RegExp, EntgangenGrund][] = [
  [/steuerberater|stb\b/, 'eigener_steuerberater'],
  [/konkurren|anderen (anbieter|berater|makler)|woanders|mitbewerb/, 'konkurrenz'],
  [/teuer|preis|kosten|honorar|budget/, 'zu_teuer'],
  [/zahlt|bezahlt|grundgebuehr|rechnung offen|zahlung/, 'zahlt_nicht'],
  [/verstorb|tod\b|krank|persoenlich|familie/, 'persoenlich'],
  [/zeitpunkt|spaeter|aufgeschoben|verschoben|naechstes jahr|nicht jetzt/, 'zeitpunkt'],
  [/passt nicht zu uns|nicht zu uns|nicht unser|unserioes/, 'passt_nicht'],
  [/rueckmeldung|meldet sich nicht|nicht mehr gemeldet|nicht erreichbar|funkstille|keine antwort|antwortet nicht/, 'keine_rueckmeldung'],
  [/kein bedarf|kein interesse|braucht nicht|will nicht|abgesagt/, 'kein_bedarf'],
  [/sonstig|anderes/, 'sonstiges'],
]

/** Grund aus Kennung, Bezeichnung oder freiem Text; unbekannt → undefined. */
export function leseGrund(roh: unknown): EntgangenGrund | undefined {
  const t = String(roh ?? '').trim()
  if (!t) return undefined
  const direkt = ENTGANGEN_GRUENDE.find((g) => g.id === t || g.label.toLowerCase() === t.toLowerCase())
  if (direkt) return direkt.id
  const e = einfach(t)
  const nachLabel = ENTGANGEN_GRUENDE.find((g) => einfach(g.label) === e || einfach(g.id.replace(/_/g, ' ')) === e)
  if (nachLabel) return nachLabel.id
  for (const [muster, grund] of STICHWOERTER) if (muster.test(e)) return grund
  return undefined
}

// ─── Datenform ──────────────────────────────────────────────────────────────────────────────────────

export type Verloren = {
  grund: EntgangenGrund
  notiz?: string
  /** JJJJ-MM-TT */
  am: string
  von: string
  /** Status, auf dem die Akte vorher stand. */
  phaseVorher?: string
  /** Entgangener Betrag netto in Euro. */
  wertNetto?: number
  vermittler?: string
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/

function betragOderNichts(roh: unknown): number | undefined {
  const n = typeof roh === 'number' ? roh : typeof roh === 'string' && roh.trim() ? Number(roh.replace(/\./g, '').replace(',', '.')) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined
}

function textOderNichts(roh: unknown, n: number): string | undefined {
  const t = String(roh ?? '').trim()
  return t ? t.slice(0, n) : undefined
}

/** Gespeicherten Eintrag lesen; unbrauchbar → undefined. Unbekannter Grund zählt als „Sonstiges“. */
export function leseVerloren(roh: unknown): Verloren | undefined {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return undefined
  const r = roh as Record<string, unknown>
  const am = String(r.am ?? '').slice(0, 10)
  if (!DATUM.test(am)) return undefined
  return baueVerloren({
    grund: leseGrund(r.grund) ?? 'sonstiges',
    notiz: r.notiz,
    am,
    von: r.von,
    phaseVorher: r.phaseVorher,
    wertNetto: r.wertNetto,
    vermittler: r.vermittler,
  })
}

/** Neuer Eintrag mit bereinigten Werten (leere Angaben fallen weg). */
export function baueVerloren(e: {
  grund: EntgangenGrund
  notiz?: unknown
  am: string
  von?: unknown
  phaseVorher?: unknown
  wertNetto?: unknown
  vermittler?: unknown
}): Verloren {
  const v: Verloren = { grund: e.grund, am: e.am.slice(0, 10), von: textOderNichts(e.von, 120) ?? 'CRM' }
  const notiz = textOderNichts(e.notiz, 1000)
  if (notiz) v.notiz = notiz
  const phase = textOderNichts(e.phaseVorher, 60)
  if (phase && phase !== 'verloren') v.phaseVorher = phase
  const wert = betragOderNichts(e.wertNetto)
  if (wert) v.wertNetto = wert
  const vermittler = textOderNichts(e.vermittler, 150)
  if (vermittler) v.vermittler = vermittler
  return v
}

/** Vorbelegung des entgangenen Betrags: erwarteter Umsatz aus kunden.auftrag_chance. */
export function wertAusChance(auftragChance: unknown): number | undefined {
  if (!auftragChance || typeof auftragChance !== 'object') return undefined
  return betragOderNichts((auftragChance as Record<string, unknown>).umsatzNetto)
}

/** Name aus kunden.vermittler ({name}). */
export function vermittlerName(roh: unknown): string | undefined {
  if (!roh || typeof roh !== 'object') return undefined
  return textOderNichts((roh as Record<string, unknown>).name, 150)
}

/** Chance in Prozent aus auftrag_chance (bestätigt oder nicht). */
export function chanceProzent(roh: unknown): number | undefined {
  if (!roh || typeof roh !== 'object') return undefined
  const p = Number((roh as Record<string, unknown>).prozent)
  return Number.isFinite(p) ? p : undefined
}

// ─── Texte ──────────────────────────────────────────────────────────────────────────────────────────

export function euroText(n: number): string {
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`
}

/** Datum JJJJ-MM-TT als TT.MM.JJJJ. */
export function deDatum(iso: string): string {
  return DATUM.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso
}

/** Eintrag im Verlauf beim Markieren. phaseName: Bezeichnung des vorigen Status. */
export function verlaufTextMarkiert(v: Verloren, phaseName?: string): string {
  const teile = [`Als entgangen markiert — Grund: ${grundLabel(v.grund)}`]
  if (v.notiz) teile.push(`Notiz: ${v.notiz}`)
  if (phaseName || v.phaseVorher) teile.push(`verloren in Phase: ${phaseName || v.phaseVorher}`)
  if (v.wertNetto) teile.push(`entgangen: ${euroText(v.wertNetto)} netto`)
  return teile.join(' · ')
}

/** Eintrag im Verlauf beim Wieder-Aufnehmen — hält fest, was vorher galt. */
export function verlaufTextWiederAufgenommen(v: Verloren | undefined, neuerStatusName: string): string {
  const vorher = v ? ` (war entgangen seit ${deDatum(v.am)}, Grund: ${grundLabel(v.grund)}${v.notiz ? ` — ${v.notiz}` : ''})` : ''
  return `Wieder aufgenommen, Status: ${neuerStatusName}${vorher}`
}

/** Status, auf den eine wieder aufgenommene Akte zurückgeht: der vorige Stand, sonst die Wiedervorlage. */
export function statusNachWiederAufnahme(v: Verloren | undefined, erlaubt: (status: string) => boolean): string | undefined {
  const vorher = v?.phaseVorher
  if (vorher && vorher !== 'verloren' && !AKTE_ENDSTAENDE.includes(vorher) && erlaubt(vorher)) return vorher
  if (erlaubt('wiedervorlage')) return 'wiedervorlage'
  return undefined
}

// ─── Phase („wo verlieren wir sie?“) ────────────────────────────────────────────────────────────────

export const PHASE_ZURUECK = 'Zurückgestellt (Wiedervorlage)'
export const PHASE_UNBEKANNT = 'Unbekannt'

/** Gemeinsame Stufe (wie die Projekt-Checkliste) für die vorige Phase — über alle Bereiche vergleichbar. */
export function phaseStufe(bereich: string, phaseVorher: string | undefined): { schluessel: string; label: string; reihenfolge: number } {
  if (!phaseVorher) return { schluessel: 'unbekannt', label: PHASE_UNBEKANNT, reihenfolge: 99 }
  const s = stufeFuer(bereich, phaseVorher)
  if (s === undefined) return { schluessel: 'unbekannt', label: PHASE_UNBEKANNT, reihenfolge: 99 }
  if (s === STUFE_ZURUECK) return { schluessel: 'zurueck', label: PHASE_ZURUECK, reihenfolge: 50 }
  return { schluessel: `stufe${s}`, label: `${s + 1}. ${STUFEN_NAMEN[s]}`, reihenfolge: s }
}

// ─── Auswertung ─────────────────────────────────────────────────────────────────────────────────────

export type EntgangenEintrag = {
  id: string
  name: string
  /** Kundenakten-Schlüssel (beratung, immobilienkunden, …). */
  bereich: string
  verloren: Verloren
}

export type AuswertungZeile = { schluessel: string; label: string; anzahl: number; betrag: number }

export type EntgangenAuswertung = {
  anzahl: number
  betrag: number
  /** Einträge ohne Betrag (zählen in `betrag` mit 0). */
  ohneBetrag: number
  jeGrund: AuswertungZeile[]
  jePhase: AuswertungZeile[]
  jeVermittler: AuswertungZeile[]
  jeBereich: AuswertungZeile[]
}

/** Liegt das Datum im Zeitraum (beide Grenzen einschließlich, leer = offen)? */
export function imZeitraum(am: string, von?: string, bis?: string): boolean {
  if (von && am < von) return false
  if (bis && am > bis) return false
  return true
}

/** Beginn des Zeitraums „letzte n Tage“ bzw. „dieses Jahr“ (JJJJ-MM-TT), ausgehend von heute. */
export function zeitraumBeginn(art: 'alle' | '30' | '90' | '365' | 'jahr', heute: string): string | undefined {
  if (art === 'alle') return undefined
  if (art === 'jahr') return `${heute.slice(0, 4)}-01-01`
  const d = new Date(`${heute}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - Number(art))
  return d.toISOString().slice(0, 10)
}

function sortiert(m: Map<string, AuswertungZeile>, nachReihenfolge?: Map<string, number>): AuswertungZeile[] {
  return [...m.values()].sort((a, b) => {
    if (nachReihenfolge) return (nachReihenfolge.get(a.schluessel) ?? 0) - (nachReihenfolge.get(b.schluessel) ?? 0)
    return b.anzahl - a.anzahl || b.betrag - a.betrag || a.label.localeCompare(b.label, 'de')
  })
}

function zaehle(m: Map<string, AuswertungZeile>, schluessel: string, label: string, betrag: number): void {
  const z = m.get(schluessel) ?? { schluessel, label, anzahl: 0, betrag: 0 }
  z.anzahl += 1
  z.betrag = Math.round((z.betrag + betrag) * 100) / 100
  m.set(schluessel, z)
}

/** Anzahl und entgangener Betrag je Grund, Phase, Vermittler und Bereich — nur Einträge im Zeitraum. */
export function werteAus(
  eintraege: readonly EntgangenEintrag[],
  opt: { von?: string; bis?: string; bereichName?: (bereich: string) => string } = {},
): EntgangenAuswertung {
  const jeGrund = new Map<string, AuswertungZeile>()
  const jePhase = new Map<string, AuswertungZeile>()
  const phaseReihe = new Map<string, number>()
  const jeVermittler = new Map<string, AuswertungZeile>()
  const jeBereich = new Map<string, AuswertungZeile>()
  let anzahl = 0
  let betrag = 0
  let ohneBetrag = 0
  for (const e of eintraege) {
    if (!imZeitraum(e.verloren.am, opt.von, opt.bis)) continue
    const wert = e.verloren.wertNetto ?? 0
    anzahl += 1
    betrag += wert
    if (!wert) ohneBetrag += 1
    zaehle(jeGrund, e.verloren.grund, grundLabel(e.verloren.grund), wert)
    const p = phaseStufe(e.bereich, e.verloren.phaseVorher)
    phaseReihe.set(p.schluessel, p.reihenfolge)
    zaehle(jePhase, p.schluessel, p.label, wert)
    const v = e.verloren.vermittler?.trim()
    zaehle(jeVermittler, v ? v.toLowerCase() : '-', v || 'Ohne Vermittler', wert)
    zaehle(jeBereich, e.bereich, opt.bereichName ? opt.bereichName(e.bereich) : e.bereich, wert)
  }
  return {
    anzahl,
    betrag: Math.round(betrag * 100) / 100,
    ohneBetrag,
    jeGrund: sortiert(jeGrund),
    jePhase: sortiert(jePhase, phaseReihe),
    jeVermittler: sortiert(jeVermittler),
    jeBereich: sortiert(jeBereich),
  }
}

// ─── Droht zu entgehen ──────────────────────────────────────────────────────────────────────────────

export const DROH_GRENZEN = {
  /** Keine Aktivität seit mehr als so vielen Tagen. */
  stilleTage: 45,
  /** Chance (bestätigt oder vorgeschlagen) höchstens so viel Prozent. */
  chanceMax: 15,
  /** Rechnung seit mindestens so vielen Tagen über dem Zahlungsziel und nicht bezahlt. */
  rechnungTage: 30,
} as const

export type DrohGrund =
  | { art: 'funkstille'; tage: number }
  | { art: 'chance'; prozent: number }
  | { art: 'rechnung'; tage: number; betrag: number; nummer?: string }

export type DrohAkte = {
  bereich: string
  status: string
  /** Letzte Aktivität (JJJJ-MM-TT); siehe letzteAktivitaet(). */
  letzteAktivitaet?: string
  chanceProzent?: number
}

export type OffeneRechnung = { status: string; zahlungsziel?: string | null; betrag: number; nummer?: string }

export function tageZwischen(von: string, bis: string): number {
  const a = Date.parse(`${von.slice(0, 10)}T12:00:00Z`)
  const b = Date.parse(`${bis.slice(0, 10)}T12:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/** Jüngstes Datum aus letzte_aktivitaet und dem Verlauf (JJJJ-MM-TT); keines → undefined. */
export function letzteAktivitaet(letzte: unknown, verlauf: unknown): string | undefined {
  let best = ''
  const nimm = (x: unknown) => {
    const t = String(x ?? '').slice(0, 10)
    if (DATUM.test(t) && t > best) best = t
  }
  nimm(letzte)
  if (Array.isArray(verlauf)) for (const a of verlauf) nimm((a as Record<string, unknown> | null)?.date)
  return best || undefined
}

/** Ist die Akte schon am Ende (abgeschlossen, verloren …)? */
export function istEndstand(status: string | null | undefined): boolean {
  const s = String(status ?? '')
  return AKTE_ENDSTAENDE.includes(s) || s === 'archiv'
}

/** Warum eine offene Akte zu entgehen droht; leer = kein Anlass. Private Akten und Endstände nie. */
export function drohtZuEntgehen(akte: DrohAkte, rechnungen: readonly OffeneRechnung[], heute: string): DrohGrund[] {
  if (akte.bereich === 'privat' || istEndstand(akte.status)) return []
  const gruende: DrohGrund[] = []
  if (akte.letzteAktivitaet) {
    const tage = tageZwischen(akte.letzteAktivitaet, heute)
    if (tage > DROH_GRENZEN.stilleTage) gruende.push({ art: 'funkstille', tage })
  }
  if (akte.chanceProzent !== undefined && akte.chanceProzent <= DROH_GRENZEN.chanceMax) gruende.push({ art: 'chance', prozent: akte.chanceProzent })
  let aeltesteRechnung: { tage: number; betrag: number; nummer?: string } | undefined
  for (const r of rechnungen) {
    if (r.status === 'Bezahlt' || r.status === 'Entwurf' || !r.zahlungsziel) continue
    const tage = tageZwischen(String(r.zahlungsziel), heute)
    if (tage < DROH_GRENZEN.rechnungTage) continue
    if (!aeltesteRechnung || tage > aeltesteRechnung.tage) aeltesteRechnung = { tage, betrag: r.betrag, nummer: r.nummer }
  }
  if (aeltesteRechnung) gruende.push({ art: 'rechnung', ...aeltesteRechnung })
  return gruende
}

export function drohGrundText(g: DrohGrund): string {
  if (g.art === 'funkstille') return `seit ${g.tage} Tagen keine Aktivität`
  if (g.art === 'chance') return `Chance nur ${g.prozent} %`
  return `Rechnung${g.nummer ? ` ${g.nummer}` : ''} über ${euroText(g.betrag)} seit ${g.tage} Tagen überfällig`
}

/** Kurzer Text der Auswertung (Telegram). */
export function auswertungText(a: EntgangenAuswertung, oben = 5): string {
  if (a.anzahl === 0) return 'Keine entgangenen Klienten in diesem Zeitraum.'
  const zeile = (z: AuswertungZeile) => `- ${z.label}: ${z.anzahl}${z.betrag ? ` (${euroText(z.betrag)})` : ''}`
  const block = (titel: string, liste: AuswertungZeile[]) => liste.length ? [`${titel}:`, ...liste.slice(0, oben).map(zeile)] : []
  return [
    `${a.anzahl} entgangene ${a.anzahl === 1 ? 'Akte' : 'Akten'}, zusammen ${euroText(a.betrag)} netto entgangen${a.ohneBetrag ? ` (${a.ohneBetrag} ohne Betrag)` : ''}.`,
    ...block('Je Grund', a.jeGrund),
    ...block('Wo wir sie verlieren (Phase)', a.jePhase),
    ...block('Je Vermittler', a.jeVermittler),
    ...block('Je Bereich', a.jeBereich),
  ].join('\n')
}
