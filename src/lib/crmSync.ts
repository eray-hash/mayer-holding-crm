// Stufe 1 der Supabase-Migration: Kunden/Mandanten (alle sechs Bereiche), Immobilien-Objekte,
// Gesprächsprotokolle und Objekt-Vorschläge laufen jetzt über eine echte, geteilte Datenbank statt
// nur über den lokalen Browser-Speicher — Voraussetzung dafür, dass mehrere Mitarbeiter (und ein
// einzelner Mitarbeiter auf mehreren Geräten) dieselben Daten sehen. Alles andere (Rechnungen,
// Vorlagen, Projekte/Kanban, Fonds-Investoren, ...) bleibt bewusst vorerst lokal — das ist Stufe 2.
//
// Strategie: nach jedem Dispatch wird per Objekt-Referenz-Vergleich ermittelt, welche Kunden/
// Objekte/Protokolle/Vorschläge sich geändert haben (der Reducer gibt für geänderte Einträge immer
// ein neues Objekt zurück, unveränderte Einträge behalten dieselbe Referenz), und nur die
// geänderten Zeilen werden per Upsert geschrieben — kein manuelles Nachpflegen pro Action-Typ nötig.
import { supabase, isSupabaseConfigured } from './supabaseClient'
import type { AppData } from '../context/AppContext'
import type { Kunde, KundeBereich, Objekt, Protokoll, ObjektVorschlag } from '../types'

export { isSupabaseConfigured }

const KUNDE_KEYS: { bereich: KundeBereich; key: keyof AppData }[] = [
  { bereich: 'beratung', key: 'kunden' },
  { bereich: 'erben', key: 'erbenMandanten' },
  { bereich: 'betriebsuebergabe', key: 'betriebsuebergabeMandanten' },
  { bereich: 'betriebsformen', key: 'betriebsformenMandanten' },
  { bereich: 'akademie', key: 'akademieTeilnehmer' },
  { bereich: 'finanzierungen', key: 'finanzierungenMandanten' },
]

function diffById<T extends { id: string }>(prev: T[], next: T[]): T[] {
  if (prev === next) return []
  const prevMap = new Map(prev.map((x) => [x.id, x]))
  return next.filter((x) => prevMap.get(x.id) !== x)
}

function kundeToRow(bereich: KundeBereich, k: Kunde) {
  return {
    id: k.id,
    bereich,
    firma: k.firma,
    ansprechpartner: k.ansprechpartner,
    email: k.email,
    telefon: k.telefon,
    prioritaet: k.prioritaet,
    status: k.status,
    follow_up: k.followUp,
    verantwortlich: k.verantwortlich,
    letzte_aktivitaet: k.letzteAktivitaet,
    activities: k.activities,
    unterlagen_checkliste: k.unterlagenCheckliste ?? null,
    signaturen: k.signaturen ?? null,
    kaeuferprofil: k.kaeuferprofil ?? null,
    selbstauskunft: k.selbstauskunft ?? null,
    dokumente: k.dokumente ?? null,
  }
}

function rowToKunde(row: any): Kunde {
  return {
    id: row.id,
    firma: row.firma,
    ansprechpartner: row.ansprechpartner,
    email: row.email,
    telefon: row.telefon,
    prioritaet: row.prioritaet,
    status: row.status,
    followUp: row.follow_up,
    verantwortlich: row.verantwortlich,
    letzteAktivitaet: row.letzte_aktivitaet,
    activities: row.activities ?? [],
    unterlagenCheckliste: row.unterlagen_checkliste ?? undefined,
    signaturen: row.signaturen ?? undefined,
    kaeuferprofil: row.kaeuferprofil ?? undefined,
    selbstauskunft: row.selbstauskunft ?? undefined,
    dokumente: row.dokumente ?? undefined,
  }
}

function objektToRow(o: Objekt) {
  return {
    id: o.id,
    bezeichnung: o.bezeichnung,
    adresse: o.adresse,
    gruppe: o.gruppe,
    typ: o.typ,
    kaufpreis: o.kaufpreis,
    prioritaet: o.prioritaet,
    status: o.status,
    follow_up: o.followUp,
    verantwortlich: o.verantwortlich,
    activities: o.activities,
    dokumente: o.dokumente,
    quelle: o.quelle ?? null,
    immo_radar_link: o.immoRadarLink ?? null,
    lukrativitaet: o.lukrativitaet ?? null,
    zugewiesener_kunde: o.zugewiesenerKunde ?? null,
  }
}

function rowToObjekt(row: any): Objekt {
  return {
    id: row.id,
    bezeichnung: row.bezeichnung,
    adresse: row.adresse,
    gruppe: row.gruppe,
    typ: row.typ,
    kaufpreis: Number(row.kaufpreis),
    prioritaet: row.prioritaet,
    status: row.status,
    followUp: row.follow_up,
    verantwortlich: row.verantwortlich,
    activities: row.activities ?? [],
    dokumente: row.dokumente ?? {},
    quelle: row.quelle ?? undefined,
    immoRadarLink: row.immo_radar_link ?? undefined,
    lukrativitaet: row.lukrativitaet ?? undefined,
    zugewiesenerKunde: row.zugewiesener_kunde ?? undefined,
  }
}

function protokollToRow(p: Protokoll) {
  return {
    id: p.id,
    bereich: p.bereich,
    kunde_id: p.kundeId,
    datum: p.datum,
    teilnehmer: p.teilnehmer,
    betreff: p.betreff,
    text: p.text,
    kernthemen: p.kernthemen ?? null,
    vereinbarungen: p.vereinbarungen ?? null,
    offene_punkte: p.offenePunkte ?? null,
    stimmung: p.stimmung ?? null,
    ki_zusammenfassung: p.kiZusammenfassung ?? null,
  }
}

function rowToProtokoll(row: any): Protokoll {
  return {
    id: row.id,
    bereich: row.bereich,
    kundeId: row.kunde_id,
    datum: row.datum,
    teilnehmer: row.teilnehmer,
    betreff: row.betreff,
    text: row.text,
    kernthemen: row.kernthemen ?? undefined,
    vereinbarungen: row.vereinbarungen ?? undefined,
    offenePunkte: row.offene_punkte ?? undefined,
    stimmung: row.stimmung ?? undefined,
    kiZusammenfassung: row.ki_zusammenfassung ?? undefined,
  }
}

function vorschlagToRow(v: ObjektVorschlag) {
  return {
    id: v.id,
    objekt_id: v.objektId,
    kunde_bereich: v.kundeBereich,
    kunde_id: v.kundeId,
    kunde_name: v.kundeName,
    steuer_begruendung: v.steuerBegruendung,
    status: v.status,
    erstellt_am: v.erstelltAm,
    erstellt_von: v.erstelltVon,
    beantwortet_am: v.beantwortetAm ?? null,
  }
}

function rowToVorschlag(row: any): ObjektVorschlag {
  return {
    id: row.id,
    objektId: row.objekt_id,
    kundeBereich: row.kunde_bereich,
    kundeId: row.kunde_id,
    kundeName: row.kunde_name,
    steuerBegruendung: row.steuer_begruendung,
    status: row.status,
    erstelltAm: row.erstellt_am,
    erstelltVon: row.erstellt_von,
    beantwortetAm: row.beantwortet_am ?? undefined,
  }
}

function logFehler(kontext: string, error: { message: string } | null) {
  if (error) console.error(`Supabase-Sync fehlgeschlagen (${kontext}):`, error.message)
}

// Nach jedem Dispatch aufgerufen (außer beim initialen Hydrate selbst) — schreibt nur, was sich
// seit dem letzten Stand tatsächlich geändert hat. Läuft bewusst "fire and forget": ein CRM-Nutzer
// soll nicht auf einen Netzwerk-Roundtrip warten müssen, bevor die UI reagiert.
export function syncAfterDispatch(prev: AppData, next: AppData) {
  if (!supabase) return

  for (const { bereich, key } of KUNDE_KEYS) {
    const changed = diffById(prev[key] as Kunde[], next[key] as Kunde[])
    for (const k of changed) {
      supabase.from('kunden').upsert(kundeToRow(bereich, k)).then(({ error }) => logFehler(`Kunde ${k.firma}`, error))
    }
  }

  for (const o of diffById(prev.objekte, next.objekte)) {
    supabase.from('objekte').upsert(objektToRow(o)).then(({ error }) => logFehler(`Objekt ${o.bezeichnung}`, error))
  }

  for (const p of diffById(prev.protokolle, next.protokolle)) {
    supabase.from('protokolle').upsert(protokollToRow(p)).then(({ error }) => logFehler('Protokoll', error))
  }

  for (const v of diffById(prev.objektVorschlaege, next.objektVorschlaege)) {
    supabase.from('objekt_vorschlaege').upsert(vorschlagToRow(v)).then(({ error }) => logFehler('Objekt-Vorschlag', error))
  }
}

export type HydratedData = {
  kunden: Record<KundeBereich, Kunde[]>
  objekte: Objekt[]
  protokolle: Protokoll[]
  objektVorschlaege: ObjektVorschlag[]
}

// Lädt den aktuellen, geteilten Stand beim Start (und kann für ein manuelles "Aktualisieren" erneut
// aufgerufen werden). Es gibt noch keine Supabase-Realtime-Anbindung — Änderungen eines anderen
// Geräts/Mitarbeiters werden beim nächsten Neuladen der Seite sichtbar, nicht live.
export async function hydrateFromSupabase(): Promise<HydratedData | null> {
  if (!supabase) return null
  const [kundenRes, objekteRes, protokolleRes, vorschlaegeRes] = await Promise.all([
    supabase.from('kunden').select('*'),
    supabase.from('objekte').select('*'),
    supabase.from('protokolle').select('*'),
    supabase.from('objekt_vorschlaege').select('*'),
  ])
  if (kundenRes.error) throw new Error(kundenRes.error.message)
  if (objekteRes.error) throw new Error(objekteRes.error.message)
  if (protokolleRes.error) throw new Error(protokolleRes.error.message)
  if (vorschlaegeRes.error) throw new Error(vorschlaegeRes.error.message)

  const kunden: Record<KundeBereich, Kunde[]> = {
    beratung: [],
    erben: [],
    betriebsuebergabe: [],
    betriebsformen: [],
    akademie: [],
    finanzierungen: [],
  }
  for (const row of kundenRes.data ?? []) {
    kunden[row.bereich as KundeBereich].push(rowToKunde(row))
  }

  return {
    kunden,
    objekte: (objekteRes.data ?? []).map(rowToObjekt),
    protokolle: (protokolleRes.data ?? []).map(rowToProtokoll),
    objektVorschlaege: (vorschlaegeRes.data ?? []).map(rowToVorschlag),
  }
}
