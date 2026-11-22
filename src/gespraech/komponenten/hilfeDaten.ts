// Daten für Spickzettel und Leitfaden während der Aufnahme (Runde 5, 22.11.2026).
// - Spickzettel: Server-Aktion gespraech_vorbereitung (email-gateway/gespraechUebernehmen.ts, Kern
//   _shared/terminBriefingKern.ts) — offene Punkte, fehlende Unterlagen, letzte Kontakte, nächste Schritte,
//   Wiedervorlagen, offene Rechnungen. Wird vor dem Gespräch geladen und im Gerätespeicher abgelegt, damit er
//   im Funkloch beim Kunden trotzdem da ist (hilfeVorladen; Start- und Einwilligungs-Bildschirm rufen es auf).
// - Leitfaden: Fragebögen/Checklisten aus der Tabelle vorlagen (eigener Login, Zeilenschutz je Bereich gilt),
//   aufbereitet mit leitfadenText.ts, ebenfalls im Gerätespeicher.
// - Fortschritt je Aufnahme (gewählter Leitfaden, abgehakte Fragen, Notizen) nur auf dem Gerät; Notizen zu
//   Fragen gehen zusätzlich als Markierung {art:'frage'} an den Server (siehe Leitfaden.tsx).

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { callAuthenticated } from '../../lib/emailGateway'
import { supabase } from '../../lib/supabaseClient'
import { lies, raeumeAuf, schreibe } from './hilfeSpeicher'
import { LEITFADEN_TYPEN, leitfadenAusVorlage, type Leitfaden, type VorlageZeile } from './leitfadenText'

// ---------------------------------------------------------------------------------------------
// Spickzettel

export type SpickZiel = { kundeId?: string | null; objektId?: string | null; terminId?: string | null }

/** Antwort von gespraech_vorbereitung (nur die Felder, die der Spickzettel zeigt). */
export type SpickDaten = {
  termin: { id: string; titel: string; beginn: string } | null
  bezug: { art: 'kunde' | 'objekt'; id: string; bereich?: string } | null
  hinweis?: string
  briefing?: {
    kopf: string
    stand: string
    verantwortlich: string
    sachverhalt: string
    naechsteSchritte: string
    eckdaten: string[]
    kontakte: { datum: string; text: string }[]
    offen: string[]
    fehlend: string[]
    fehlendSeit: string
    geld: string[]
    fehler: string[]
  }
  gespraechspunkte?: string[]
}

/** Nach so vielen Minuten wird ein gespeicherter Spickzettel neu geholt (wenn Netz da ist). */
const SPICK_FRISCH_MIN = 20
const LEITFAEDEN_FRISCH_MIN = 60

function spickSchluessel(ziel: SpickZiel): string[] {
  const s: string[] = []
  if (ziel.kundeId) s.push(`spick|kunde:${ziel.kundeId}`)
  if (ziel.objektId) s.push(`spick|objekt:${ziel.objektId}`)
  if (ziel.terminId) s.push(`spick|termin:${ziel.terminId}`)
  return s
}

export function hatZiel(ziel: SpickZiel): boolean {
  return spickSchluessel(ziel).length > 0
}

async function spickAusSpeicher(ziel: SpickZiel): Promise<{ daten: SpickDaten; am: number } | null> {
  for (const k of spickSchluessel(ziel)) {
    const e = await lies<SpickDaten>(k)
    if (e) return { daten: e.wert, am: e.am }
  }
  return null
}

/** Holt den Spickzettel vom Server und legt ihn unter allen passenden Schlüsseln ab. */
async function spickVomServer(ziel: SpickZiel): Promise<SpickDaten> {
  // Akte vor Objekt vor Termin: mit Akte ist die Zuordnung eindeutig, der Termin sucht sie erst.
  const anfrage = ziel.kundeId ? { kundeId: ziel.kundeId } : ziel.objektId ? { objektId: ziel.objektId } : { terminId: ziel.terminId }
  const d = (await callAuthenticated({ action: 'gespraech_vorbereitung', ...anfrage })) as SpickDaten & { ok?: boolean }
  const daten: SpickDaten = {
    termin: d.termin ? { id: String(d.termin.id), titel: String(d.termin.titel ?? ''), beginn: String(d.termin.beginn ?? '') } : null,
    bezug: d.bezug ?? null,
    hinweis: d.hinweis,
    briefing: d.briefing,
    gespraechspunkte: Array.isArray(d.gespraechspunkte) ? d.gespraechspunkte : [],
  }
  const schluessel = new Set(spickSchluessel(ziel))
  if (daten.bezug) schluessel.add(`spick|${daten.bezug.art}:${daten.bezug.id}`)
  for (const k of schluessel) await schreibe(k, daten)
  return daten
}

const laufend = new Map<string, Promise<SpickDaten>>()

function holeEinmal(ziel: SpickZiel): Promise<SpickDaten> {
  const k = spickSchluessel(ziel).join('&')
  const da = laufend.get(k)
  if (da) return da
  const p = spickVomServer(ziel).finally(() => laufend.delete(k))
  laufend.set(k, p)
  return p
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * Vor dem Gespräch aufrufen (Startseite mit dem nächsten Termin, Einwilligungs-Bildschirm): legt Spickzettel
 * und Leitfäden im Gerätespeicher ab, falls sie fehlen oder älter als 20 bzw. 60 Minuten sind. Fehler werden
 * geschluckt — ohne Netz bleibt der alte Stand.
 */
export async function hilfeVorladen(ziel: SpickZiel): Promise<void> {
  if (!online()) return
  const aufgaben: Promise<unknown>[] = [leitfaedenLaden(false)]
  if (hatZiel(ziel)) {
    aufgaben.push(
      spickAusSpeicher(ziel).then((alt) => {
        if (!alt || Date.now() - alt.am > SPICK_FRISCH_MIN * 60_000) return holeEinmal(ziel)
      }),
    )
  }
  await Promise.allSettled(aufgaben)
  void raeumeAuf(30)
}

export type SpickStand = { daten: SpickDaten | null; am: number | null; laedt: boolean; fehler: string | null; neuLaden: () => void }

export function useSpickzettel(ziel: SpickZiel): SpickStand {
  const k = spickSchluessel(ziel).join('&')
  const [daten, setDaten] = useState<SpickDaten | null>(null)
  const [am, setAm] = useState<number | null>(null)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [runde, setRunde] = useState(0)

  useEffect(() => {
    if (!k) return
    let aktiv = true
    const z = ziel
    void (async () => {
      const alt = await spickAusSpeicher(z)
      if (!aktiv) return
      if (alt) {
        setDaten(alt.daten)
        setAm(alt.am)
      }
      const erzwingen = runde > 0
      if (!online() || (alt && !erzwingen && Date.now() - alt.am < SPICK_FRISCH_MIN * 60_000)) return
      setLaedt(true)
      setFehler(null)
      try {
        const neu = await holeEinmal(z)
        if (!aktiv) return
        setDaten(neu)
        setAm(Date.now())
      } catch (err) {
        if (aktiv) setFehler(err instanceof Error ? err.message : String(err))
      } finally {
        if (aktiv) setLaedt(false)
      }
    })()
    return () => {
      aktiv = false
    }
    // ziel steckt vollständig in k
  }, [k, runde])

  const neuLaden = useCallback(() => setRunde((r) => r + 1), [])
  return { daten, am, laedt, fehler, neuLaden }
}

// ---------------------------------------------------------------------------------------------
// Leitfäden

async function leitfaedenVomServer(): Promise<Leitfaden[]> {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank eingerichtet.')
  const { data, error } = await supabase.from('vorlagen').select('id, name, bereich, typ, text').in('typ', LEITFADEN_TYPEN).order('bereich').order('name')
  if (error) throw new Error(error.message)
  const liste = ((data ?? []) as VorlageZeile[]).map(leitfadenAusVorlage).filter((l): l is Leitfaden => l !== null)
  await schreibe('leitfaeden', liste)
  return liste
}

let leitfaedenLauf: Promise<Leitfaden[]> | null = null

async function leitfaedenLaden(erzwingen: boolean): Promise<Leitfaden[]> {
  const alt = await lies<Leitfaden[]>('leitfaeden')
  if (alt && (!erzwingen && Date.now() - alt.am < LEITFAEDEN_FRISCH_MIN * 60_000)) return alt.wert
  if (!online()) return alt?.wert ?? []
  leitfaedenLauf ??= leitfaedenVomServer().finally(() => (leitfaedenLauf = null))
  try {
    return await leitfaedenLauf
  } catch (err) {
    if (alt) return alt.wert
    throw err
  }
}

export function useLeitfaeden(): { liste: Leitfaden[] | null; fehler: string | null } {
  const [liste, setListe] = useState<Leitfaden[] | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  useEffect(() => {
    let aktiv = true
    void lies<Leitfaden[]>('leitfaeden').then((alt) => aktiv && alt && setListe(alt.wert))
    leitfaedenLaden(false)
      .then((l) => aktiv && setListe(l))
      .catch((err) => {
        if (!aktiv) return
        setFehler(err instanceof Error ? err.message : String(err))
        setListe((x) => x ?? [])
      })
    return () => {
      aktiv = false
    }
  }, [])
  return { liste, fehler }
}

// ---------------------------------------------------------------------------------------------
// Fortschritt je Aufnahme

export type Fortschritt = {
  /** undefined = noch nicht gewählt (Vorschlag gilt), null = bewusst kein Leitfaden */
  leitfadenId?: string | null
  gefragt: string[]
  notizen: Record<string, string>
  /** Leitfäden, für die die Markierung „Leitfaden: …“ schon gesetzt ist */
  markiert: string[]
}

const LEER: Fortschritt = { gefragt: [], notizen: {}, markiert: [] }

/** Fortschritt der Aufnahme `lokalId`. `geladen` ist falsch, bis der gespeicherte Stand gelesen ist — vorher
 *  nichts ändern, sonst überschreibt der leere Anfangsstand den gespeicherten. */
export function useFortschritt(lokalId: string | null): { fortschritt: Fortschritt; geladen: boolean; aendern: (f: (alt: Fortschritt) => Fortschritt) => void } {
  const [stand, setStand] = useState<{ fuer: string | null; f: Fortschritt }>({ fuer: null, f: LEER })
  useEffect(() => {
    if (!lokalId) return
    let aktiv = true
    void lies<Fortschritt>(`fortschritt|${lokalId}`).then((e) => aktiv && setStand({ fuer: lokalId, f: e ? { ...LEER, ...e.wert } : LEER }))
    return () => {
      aktiv = false
    }
  }, [lokalId])
  const geladen = !!lokalId && stand.fuer === lokalId
  const aendern = useCallback(
    (f: (alt: Fortschritt) => Fortschritt) => {
      if (!lokalId) return
      setStand((alt) => {
        if (alt.fuer !== lokalId) return alt
        const neu = f(alt.f)
        void schreibe(`fortschritt|${lokalId}`, neu)
        return { fuer: lokalId, f: neu }
      })
    },
    [lokalId],
  )
  return { fortschritt: geladen ? stand.f : LEER, geladen, aendern }
}

// ---------------------------------------------------------------------------------------------
// Zuletzt gewählter Leitfaden je Bereich und Art (Browser-Speicher)

const ZULETZT = 'mayer_gespraech_leitfaden_zuletzt'

export function zuletztGewaehlt(bereich: string | null, art: string): string | null {
  try {
    const m = JSON.parse(window.localStorage.getItem(ZULETZT) ?? '{}') as Record<string, string>
    const w = m[`${bereich ?? '-'}|${art}`]
    return typeof w === 'string' ? w : null
  } catch {
    return null
  }
}

export function merkeGewaehlt(bereich: string | null, art: string, id: string | null): void {
  try {
    const m = JSON.parse(window.localStorage.getItem(ZULETZT) ?? '{}') as Record<string, string>
    m[`${bereich ?? '-'}|${art}`] = id ?? ''
    window.localStorage.setItem(ZULETZT, JSON.stringify(m))
  } catch {
    // privates Fenster: dann eben ohne Gedächtnis
  }
}

// ---------------------------------------------------------------------------------------------
// Anzeige während der Aufnahme (je Gerät)

export type Reiter = 'spick' | 'leitfaden' | 'notizen'
export type Anzeige = { dunkel: boolean; gross: boolean; reiter: Reiter; zu: string[]; nurOffen: boolean }

const ANZEIGE = 'mayer_gespraech_anzeige'
const ANZEIGE_STANDARD: Anzeige = { dunkel: true, gross: false, reiter: 'spick', zu: ['sachverhalt'], nurOffen: false }

function liesAnzeige(): Anzeige {
  try {
    const roh = JSON.parse(window.localStorage.getItem(ANZEIGE) ?? '{}')
    const a = { ...ANZEIGE_STANDARD, ...(roh && typeof roh === 'object' ? roh : {}) } as Anzeige
    if (!['spick', 'leitfaden', 'notizen'].includes(a.reiter)) a.reiter = 'spick'
    if (!Array.isArray(a.zu)) a.zu = []
    return a
  } catch {
    return { ...ANZEIGE_STANDARD }
  }
}

let anzeige: Anzeige | null = null
const anzeigeZuhoerer = new Set<() => void>()

function aktuelleAnzeige(): Anzeige {
  anzeige ??= liesAnzeige()
  return anzeige
}

export function setzeAnzeige(aenderung: Partial<Anzeige>): void {
  anzeige = { ...aktuelleAnzeige(), ...aenderung }
  try {
    window.localStorage.setItem(ANZEIGE, JSON.stringify(anzeige))
  } catch {
    // nur bis zum Schließen
  }
  for (const f of anzeigeZuhoerer) f()
}

export function useAnzeige(): Anzeige {
  return useSyncExternalStore(
    (f) => {
      anzeigeZuhoerer.add(f)
      return () => anzeigeZuhoerer.delete(f)
    },
    aktuelleAnzeige,
  )
}
