// Projekt-Checkliste (Hasan und Eray, 20.11.2026): eine Zeile je Akte über alle Bereiche, mit Stand im
// Ablauf, Sachverhalt, Vermittler, Dienstleistungen, erwartetem Umsatz, Chance, Wiedervorlage,
// Unterlagen, nächsten Schritten und einer Ampel. Hier steht nur Rechnen ohne Oberfläche, damit es sich
// ohne Browser prüfen lässt (lib/checkliste.test.mts).
//
// Eine Zeile = eine Akte. Jede Akte gehört zu genau einem Bereich; ein Kunde mit Gründung und Erbfolge hat
// also schon heute zwei Akten und damit zwei Zeilen („je Auftrag“).
import type { AmpelFarbe, Kunde, KundeBereich, Rechnung, StatusNode } from '../types'
import {
  AKADEMIE_HAUPTPFAD, AKADEMIE_STATUS, BERATUNG_HAUPTPFAD, BERATUNG_STATUS, BETRIEBSFORMEN_HAUPTPFAD, BETRIEBSFORMEN_STATUS,
  BETRIEBSUEBERGABE_HAUPTPFAD, BETRIEBSUEBERGABE_STATUS, ERBEN_HAUPTPFAD, ERBEN_STATUS, FINANZIERUNGEN_HAUPTPFAD,
  FINANZIERUNGEN_STATUS, IMMOBILIEN_KUNDEN_HAUPTPFAD, IMMOBILIEN_KUNDEN_STATUS, PRIVAT_HAUPTPFAD, PRIVAT_STATUS,
} from '../data/statusNetworks'
import { berechneKv, rundeCent, type Kostenvoranschlag } from './kostenvoranschlaege'

export const STATUS_NETZ: Record<KundeBereich, { status: Record<string, StatusNode>; pfad: string[] }> = {
  beratung: { status: BERATUNG_STATUS, pfad: BERATUNG_HAUPTPFAD },
  erben: { status: ERBEN_STATUS, pfad: ERBEN_HAUPTPFAD },
  betriebsuebergabe: { status: BETRIEBSUEBERGABE_STATUS, pfad: BETRIEBSUEBERGABE_HAUPTPFAD },
  betriebsformen: { status: BETRIEBSFORMEN_STATUS, pfad: BETRIEBSFORMEN_HAUPTPFAD },
  akademie: { status: AKADEMIE_STATUS, pfad: AKADEMIE_HAUPTPFAD },
  finanzierungen: { status: FINANZIERUNGEN_STATUS, pfad: FINANZIERUNGEN_HAUPTPFAD },
  privat: { status: PRIVAT_STATUS, pfad: PRIVAT_HAUPTPFAD },
  immobilienkunden: { status: IMMOBILIEN_KUNDEN_STATUS, pfad: IMMOBILIEN_KUNDEN_HAUPTPFAD },
}

export type Stand = {
  label: string
  /** 1-basiert; nur wenn der Status auf dem Hauptpfad liegt. */
  schritt?: number
  schritte: number
  abgeschlossen: boolean
  /** Neuanfrage, die das CRM selbst aus einer Mail angelegt hat (Beratung „Lead / Neuanfrage“). */
  neuanfrage: boolean
}

export function standVon(bereich: KundeBereich, status: string): Stand {
  const netz = STATUS_NETZ[bereich]
  const knoten = netz?.status[status]
  const i = netz ? netz.pfad.indexOf(status) : -1
  return {
    label: knoten?.label ?? status ?? '–',
    schritt: i >= 0 ? i + 1 : undefined,
    schritte: netz?.pfad.length ?? 0,
    abgeschlossen: !!knoten?.isTerminal,
    neuanfrage: bereich === 'beratung' && status === 'lead',
  }
}

/** Netto-Betrag eines Kostenvoranschlags. Ohne Positionen ist `betrag` brutto, wenn ein Steuersatz dabeisteht; sonst wie notiert. */
export function kvNetto(kv: Pick<Kostenvoranschlag, 'betrag' | 'positionen' | 'aufschlagProzent' | 'ustSatz'>): number | undefined {
  if (kv.positionen && kv.positionen.length > 0) return berechneKv(kv.positionen, kv.aufschlagProzent ?? 0, kv.ustSatz ?? 19).netto
  if (kv.betrag === undefined || kv.betrag === null || Number.isNaN(kv.betrag)) return undefined
  if (kv.ustSatz !== undefined && kv.ustSatz !== null) return rundeCent(kv.betrag / (1 + kv.ustSatz / 100))
  return kv.betrag
}

/** Erwarteter Umsatz netto aus den nicht abgelehnten Kostenvoranschlägen der Akte. */
export function umsatzVon(kvs: Kostenvoranschlag[]): { netto: number; anzahl: number; ohneBetrag: number } {
  const zaehlen = kvs.filter((k) => k.status !== 'abgelehnt')
  let netto = 0
  let ohneBetrag = 0
  for (const kv of zaehlen) {
    const n = kvNetto(kv)
    if (n === undefined) ohneBetrag++
    else netto += n
  }
  return { netto: rundeCent(netto), anzahl: zaehlen.length, ohneBetrag }
}

export type UnterlagenStand = { angefordert: number; da: number; seit?: string }

/** Unterlagen aus den Anforderungen (Link zur Hochlade-Seite): wie viele angefordert, wie viele schon da. */
export function unterlagenVon(k: Pick<Kunde, 'unterlagenAnforderungen'>): UnterlagenStand | undefined {
  const liste = (k.unterlagenAnforderungen ?? []).filter((a) => a.art === 'anforderung')
  if (liste.length === 0) return undefined
  const angefordert = new Set<string>()
  const da = new Set<string>()
  let seit: string | undefined
  for (const a of liste) {
    for (const p of a.punkte ?? []) angefordert.add(p)
    if (a.weitere?.trim()) angefordert.add(a.weitere.trim())
    for (const e of a.eingang ?? []) da.add(e.punkt)
    if (!seit || a.datum < seit) seit = a.datum
  }
  const erhalten = [...angefordert].filter((p) => da.has(p)).length
  return { angefordert: angefordert.size, da: erhalten, seit: seit?.slice(0, 10) }
}

/** Neueste Aktivität der Akte (JJJJ-MM-TT) oder undefined. */
export function letzterKontakt(k: Pick<Kunde, 'activities'>): string | undefined {
  let neu: string | undefined
  for (const a of k.activities ?? []) {
    const d = (a.date ?? '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!neu || d > neu)) neu = d
  }
  return neu
}

function tageZwischen(von: string, bis: string): number {
  const a = new Date(von + 'T00:00:00').getTime()
  const b = new Date(bis + 'T00:00:00').getTime()
  return Math.round((b - a) / 86_400_000)
}

/** Sonntag der Woche von `heute` (Wochen beginnen montags). */
export function wochenEnde(heute: string): string {
  const d = new Date(heute + 'T00:00:00')
  const tag = (d.getDay() + 6) % 7 // Montag = 0
  d.setDate(d.getDate() + (6 - tag))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type AmpelErgebnis = { farbe: AmpelFarbe; gruende: string[]; manuell: boolean }

const kurz = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`

/**
 * Ampel nach den Regeln aus dem Gespräch vom 20.11.2026:
 * Rot = Wiedervorlage überfällig, Rechnung überfällig oder 21 Tage keine Aktivität.
 * Gelb = Wiedervorlage diese Woche, keine Wiedervorlage gesetzt, Unterlagen fehlen seit über 7 Tagen,
 * Kostenvoranschlag seit über 7 Tagen offen. Sonst Grün. Eine vom Berater gesetzte Ampel geht vor.
 */
/** Offene Wiedervorlagen einer Akte: das bisherige Follow-up der Akte und die Einträge der Tabelle wiedervorlagen, nach Fälligkeit. */
export function offeneWiedervorlagen(k: Pick<Kunde, 'followUp'>, eintraege: { titel: string; faellig: string; quelle?: string }[] = []): NaechsteWv[] {
  const liste: NaechsteWv[] = eintraege
    .filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.faellig ?? ''))
    .map((w) => ({ titel: w.titel, datum: w.faellig, automatisch: w.quelle === 'regel' }))
  const fu = k.followUp
  if (fu && !fu.done && /^\d{4}-\d{2}-\d{2}$/.test(fu.date ?? '')) liste.push({ titel: fu.note?.trim() || 'Follow-up', datum: fu.date, automatisch: false })
  return liste.sort((a, b) => a.datum.localeCompare(b.datum))
}

export type NaechsteWv = { titel: string; datum: string; automatisch: boolean }

export function berechneAmpel(
  k: Kunde,
  bereich: KundeBereich,
  ctx: { heute: string; rechnungen: Rechnung[]; kvs: Kostenvoranschlag[]; wiedervorlagen?: { titel: string; faellig: string; quelle?: string }[] },
): AmpelErgebnis {
  if (k.ampelManuell) return { farbe: k.ampelManuell.farbe, gruende: [k.ampelManuell.grund || 'vom Berater gesetzt'], manuell: true }
  const rot: string[] = []
  const gelb: string[] = []
  const stand = standVon(bereich, k.status)
  const offene = offeneWiedervorlagen(k, ctx.wiedervorlagen)
  const ueberfaellig = offene.filter((w) => w.datum < ctx.heute)
  if (ueberfaellig.length) {
    rot.push(`Wiedervorlage seit ${kurz(ueberfaellig[0].datum)} überfällig: ${ueberfaellig[0].titel}`)
  } else if (offene.length === 0) {
    gelb.push('keine Wiedervorlage gesetzt')
  } else if (offene[0].datum <= wochenEnde(ctx.heute)) {
    gelb.push(`Wiedervorlage am ${kurz(offene[0].datum)}: ${offene[0].titel}`)
  }
  for (const r of ctx.rechnungen) {
    if (r.kundeId !== k.id || r.status === 'Bezahlt' || r.status === 'Entwurf') continue
    if (r.status === 'Überfällig' || (r.zahlungsziel && r.zahlungsziel < ctx.heute)) rot.push(`Rechnung ${r.nummer} überfällig`)
  }
  const kontakt = letzterKontakt(k)
  if (kontakt && !stand.neuanfrage) {
    const tage = tageZwischen(kontakt, ctx.heute)
    if (tage > 21) rot.push(`seit ${tage} Tagen nichts passiert`)
  }
  const u = unterlagenVon(k)
  if (u && u.da < u.angefordert && u.seit) {
    const tage = tageZwischen(u.seit, ctx.heute)
    if (tage > 7) gelb.push(`Unterlagen fehlen seit ${tage} Tagen`)
  }
  for (const kv of ctx.kvs) {
    if (kv.status !== 'offen') continue
    const datum = /^\d{4}-\d{2}-\d{2}$/.test(kv.datum ?? '') ? kv.datum! : kv.erstelltAm?.slice(0, 10)
    if (!datum) continue
    const tage = tageZwischen(datum, ctx.heute)
    if (tage > 7) gelb.push(`Kostenvoranschlag seit ${tage} Tagen offen`)
  }
  if (rot.length) return { farbe: 'rot', gruende: [...rot, ...gelb], manuell: false }
  if (gelb.length) return { farbe: 'gelb', gruende: gelb, manuell: false }
  return { farbe: 'gruen', gruende: [], manuell: false }
}

export const AMPEL_RANG: Record<AmpelFarbe, number> = { rot: 0, gelb: 1, gruen: 2 }
export const AMPEL_LABEL: Record<AmpelFarbe, string> = { rot: 'Rot', gelb: 'Gelb', gruen: 'Grün' }

/** Gewichteter Umsatz = Umsatz × Chance. Ohne Chance zählt nichts. */
export function gewichtet(netto: number, prozent: number | undefined): number {
  if (prozent === undefined || prozent === null) return 0
  return rundeCent((netto * prozent) / 100)
}
