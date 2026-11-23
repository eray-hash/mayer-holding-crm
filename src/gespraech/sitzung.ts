// Die laufende Aufnahme als eine Sitzung außerhalb von React: Wechselt man in der App die Seite, läuft die
// Aufnahme weiter. Verbindet Zustandsautomat (automat.ts), Tonaufnahme (rekorder.ts), Gerätespeicher
// (speicher.ts) und Hochladen (uploader.ts). Die Oberfläche liest den Stand über useSitzung().
//
// Sicherung: Jedes Teilstück (5 s) landet sofort im Gerätespeicher, alle 5 s schreibt die Sitzung ein
// Lebenszeichen. Wird die App geschlossen, erkennt der nächste Start die Aufnahme als „unvollständig“
// (istVerwaist) und bietet Fortsetzen oder Hochladen an (wiederherstellen()).

import { useSyncExternalStore } from 'react'
import { dauerMs, schritt, START, type AutomatEreignis, type AutomatZustand } from './automat'
import { einstellungen } from './einstellungen'
import { holeMikrofon, Pegel, SegmentRekorder, ZEITEN, type SegmentInfo } from './rekorder'
import * as speicher from './speicher'
import { LiveUntertitel, untertitelMoeglich } from './untertitel'
import { anstossen } from './uploader'
import { haltWach, lassSchlafen } from './wachHalten'
import { geschaetzteDauer, istVerwaist, naechsteFotoNr, naechsteSegmentNr, type LokaleAufnahme } from './warteschlange'
import type { GespraechArt, GespraechEinwilligung, GespraechMarker, GespraechMarkerArt } from './typen'
import * as server from './server'
import { nimmtGeradeAuf } from './direktLink'

export type AufnahmeVorbereitung = {
  art: GespraechArt
  titel: string
  kundeId?: string
  kundeBereich?: string
  kundeName?: string
  objektId?: string
  objektName?: string
  terminId?: string
  /** Eine unvollständige Aufnahme auf dem Gerät weiterführen (gleiche lokalId, neue Abschnitte hinten dran). */
  fortsetzenVon?: string
}

export type SitzungStand = {
  automat: AutomatZustand
  vorbereitung: AufnahmeVorbereitung | null
  lokalId: string | null
  /** Bereits vorhandene Aufnahmezeit beim Fortsetzen einer unvollständigen Aufnahme (ms). */
  basisMs: number
  segmentNr: number
  stumm: boolean
  wachGehalten: boolean
  untertitel: string
  marker: GespraechMarker[]
  notizen: string
  fotos: number
  /** Hinweis an den Nutzer (z. B. nach einer Unterbrechung). */
  hinweis: string | null
}

const LEER: SitzungStand = {
  automat: START,
  vorbereitung: null,
  lokalId: null,
  basisMs: 0,
  segmentNr: 0,
  stumm: false,
  wachGehalten: false,
  untertitel: '',
  marker: [],
  notizen: '',
  fotos: 0,
  hinweis: null,
}

let stand: SitzungStand = LEER
const zuhoerer = new Set<() => void>()

function setze(aenderung: Partial<SitzungStand>): void {
  stand = { ...stand, ...aenderung }
  for (const f of zuhoerer) f()
}

function ereignis(e: AutomatEreignis): void {
  const neu = schritt(stand.automat, e)
  if (neu !== stand.automat) setze({ automat: neu })
}

export function sitzung(): SitzungStand {
  return stand
}

export function useSitzung(): SitzungStand {
  return useSyncExternalStore(
    (f) => {
      zuhoerer.add(f)
      return () => zuhoerer.delete(f)
    },
    () => stand,
  )
}

/** Läuft eine Aufnahme (auch pausiert oder unterbrochen)? Dann ändern Direkt-Links und Startseite nichts. */
export function nimmtAuf(): boolean {
  return nimmtGeradeAuf(stand.automat.phase)
}

/** Aufnahmezeit insgesamt in ms (inkl. früherer Teile beim Fortsetzen). */
export function gesamtMs(jetzt = Date.now()): number {
  return stand.basisMs + dauerMs(stand.automat, jetzt)
}

// ---------------------------------------------------------------------------------------------
// Laufzeit-Objekte (nicht Teil des angezeigten Stands)

let rekorder: SegmentRekorder | null = null
let pegel: Pegel | null = null
let untertitel: LiveUntertitel | null = null
let herzschlag: number | null = null
let notizWecker: number | null = null

export function pegelWert(): number {
  return pegel?.wert() ?? 0
}

function neueId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

// ---------------------------------------------------------------------------------------------
// Ablauf

/** Schritt 1: Was wird aufgenommen? Danach zeigt die Oberfläche die Einwilligung. */
export function vorbereiten(v: AufnahmeVorbereitung): void {
  // Auch eine unterbrochene Aufnahme (Anruf, App verlassen — Rekorder schon gestoppt) nicht überschreiben:
  // sonst ginge ihr Stand verloren, z. B. wenn währenddessen ein Direkt-Link geöffnet wird.
  if (rekorder?.laeuft || nimmtAuf()) throw new Error('Es läuft bereits eine Aufnahme.')
  if (stand.automat.phase === 'beendet' || stand.automat.phase === 'fehler') stand = { ...LEER }
  setze({ ...LEER, vorbereitung: v, automat: schritt(START, { typ: 'einwilligung_zeigen' }) })
}

export function abbrechen(): void {
  if (stand.automat.phase === 'einwilligung' || stand.automat.phase === 'fehler') setze({ ...LEER })
}

/** Schritt 2: Einwilligung bestätigt → Mikrofon holen und aufnehmen. */
export async function starten(einwilligung: GespraechEinwilligung, mitarbeiterEmail: string): Promise<void> {
  const v = stand.vorbereitung
  if (!v || stand.automat.phase !== 'einwilligung') return
  ereignis({ typ: 'einwilligung_ok' })
  let stream: MediaStream
  try {
    stream = await holeMikrofon()
  } catch (err) {
    ereignis({ typ: 'fehler', text: err instanceof Error ? err.message : String(err) })
    return
  }
  void speicher.bitteUmDauerhaftenSpeicher()

  // Aufnahme im Gerätespeicher anlegen (oder die unvollständige weiterführen)
  let a: LokaleAufnahme | null = v.fortsetzenVon ? await speicher.ladeAufnahme(v.fortsetzenVon) : null
  if (a) {
    a = await speicher.aktualisiere(a.lokalId, (x) => ({ ...x, beendet: false, lebtBis: Date.now() + 20_000 }))
  }
  if (!a) {
    a = {
      lokalId: neueId(),
      serverId: null,
      erstelltAm: new Date().toISOString(),
      mitarbeiterEmail: mitarbeiterEmail.toLowerCase(),
      art: v.art,
      titel: v.titel,
      kundeId: v.kundeId,
      kundeBereich: v.kundeBereich,
      kundeName: v.kundeName,
      objektId: v.objektId,
      objektName: v.objektName,
      terminId: v.terminId,
      einwilligung,
      aufbewahrenTage: einstellungen().aufbewahrungTage,
      beendet: false,
      dauer_s: 0,
      lebtBis: Date.now() + 20_000,
      segmente: [],
      fotos: [],
      marker: [],
      markerGesendet: '[]',
      notizen: '',
      notizenGesendet: '',
      abgeschlossen: false,
      versuche: 0,
      naechsterVersuch: 0,
      letzterFehler: null,
    }
    await speicher.speichereAufnahme(a)
  }
  const lokalId = a!.lokalId
  setze({ lokalId, basisMs: (a!.dauer_s ?? 0) * 1000, marker: a!.marker, notizen: a!.notizen, fotos: a!.fotos.length })
  anstossen() // legt die Aufnahme beim Server an, sobald Netz da ist

  await starteTon(stream, naechsteSegmentNr(a!))
}

async function starteTon(stream: MediaStream, ersteNr: number): Promise<void> {
  const lokalId = stand.lokalId!
  rekorder = new SegmentRekorder({
    beiSegmentStart: async (nr, mime) => {
      setze({ segmentNr: nr })
      await speicher.aktualisiere(lokalId, (x) =>
        x.segmente.some((s) => s.nr === nr) ? x : { ...x, segmente: [...x.segmente, { nr, mime, dauer_s: 0, bytes: 0, status: 'aufnahme' }] },
      )
    },
    beiTeil: async (nr, lfd, daten) => {
      await speicher.speichereTeil(lokalId, nr, lfd, daten)
    },
    beiSegmentEnde: async (info: SegmentInfo) => {
      await schliesseSegment(lokalId, info.nr, info.mime, Math.round(info.dauerMs / 1000))
      anstossen()
    },
    beiStoerung: (_art, text) => {
      ereignis({ typ: 'unterbrechung', jetzt: Date.now(), grund: text })
      raeumeLaufzeitAuf(false)
      void schreibeLebenszeichen()
      setze({ hinweis: `${text} Das bisher Aufgenommene ist gesichert.` })
    },
    beiStumm: (stumm) => setze({ stumm }),
  })
  try {
    await rekorder.start(stream, ersteNr)
  } catch (err) {
    for (const t of stream.getTracks()) t.stop()
    rekorder = null
    ereignis({ typ: 'fehler', text: `Aufnahme ließ sich nicht starten: ${err instanceof Error ? err.message : String(err)}`, jetzt: Date.now() })
    return
  }
  pegel = new Pegel(stream)
  ereignis({ typ: 'gestartet', jetzt: Date.now() })
  setze({ hinweis: null, stumm: false })

  const e = einstellungen()
  if (e.wachHalten) void haltWach().then((ok) => setze({ wachGehalten: ok }))
  if (e.untertitel && untertitelMoeglich()) {
    untertitel = new LiveUntertitel((text) => setze({ untertitel: text }))
    untertitel.start()
  }
  if (herzschlag !== null) window.clearInterval(herzschlag)
  herzschlag = window.setInterval(() => void schreibeLebenszeichen(), 5000)
  document.addEventListener('visibilitychange', beiSichtbarkeit)
  window.addEventListener('pagehide', beiVerlassen)
}

/** Setzt die Teilstücke eines Abschnitts zusammen und gibt ihn zum Hochladen frei. */
async function schliesseSegment(lokalId: string, nr: number, mime: string, dauer_s: number | null): Promise<void> {
  // Nur einmal je Abschnitt: Kommt das Ende eines Recorders erst nach dem Beenden (stop() wartet höchstens 8 s, danach
  // setzt wiederherstellen() den Abschnitt schon zusammen), lägen nur noch die letzten Sekunden als Teile da — ein
  // zweites Zusammensetzen würde den fertigen Abschnitt damit überschreiben (ohne Dateikopf, Ton davor weg) und ihn
  // erneut zum Hochladen freigeben. Nachzügler-Teile verfallen dann mit dem Aufräumen der Aufnahme.
  const vorher = (await speicher.ladeAufnahme(lokalId))?.segmente.find((s) => s.nr === nr)
  if (!vorher || vorher.status !== 'aufnahme') return
  const { bytes, teile } = await speicher.fasseSegmentZusammen(lokalId, nr, mime)
  await speicher.aktualisiere(lokalId, (x) => {
    if (bytes === 0) return { ...x, segmente: x.segmente.filter((s) => s.nr !== nr) }
    const dauer = dauer_s ?? geschaetzteDauer(teile, ZEITEN.teilMs)
    return { ...x, segmente: x.segmente.map((s) => (s.nr === nr ? { ...s, mime: s.mime || mime, bytes, dauer_s: dauer || s.dauer_s, status: 'lokal' as const } : s)) }
  })
}

async function schreibeLebenszeichen(): Promise<void> {
  const lokalId = stand.lokalId
  if (!lokalId) return
  const aktiv = stand.automat.phase === 'laeuft' || stand.automat.phase === 'pausiert'
  const dauer = Math.round(gesamtMs() / 1000)
  await speicher.aktualisiere(lokalId, (x) => ({ ...x, dauer_s: dauer, lebtBis: aktiv ? Date.now() + 20_000 : x.lebtBis })).catch(() => undefined)
}

function beiSichtbarkeit(): void {
  if (document.visibilityState === 'hidden') {
    // Vor dem Verlassen das bisher Aufgenommene sichern — das iPhone hält die Aufnahme gleich an.
    rekorder?.sichereJetzt()
    void schreibeLebenszeichen()
  }
}

function beiVerlassen(): void {
  rekorder?.sichereJetzt()
  void schreibeLebenszeichen()
}

function raeumeLaufzeitAuf(rekorderStoppen: boolean): void {
  if (rekorderStoppen) void rekorder?.stop()
  rekorder = null
  pegel?.schliessen()
  pegel = null
  untertitel?.stop()
  untertitel = null
  if (herzschlag !== null) window.clearInterval(herzschlag)
  herzschlag = null
  void lassSchlafen()
  setze({ wachGehalten: false, stumm: false })
  document.removeEventListener('visibilitychange', beiSichtbarkeit)
  window.removeEventListener('pagehide', beiVerlassen)
}

export function pause(): void {
  if (stand.automat.phase !== 'laeuft') return
  rekorder?.pause()
  ereignis({ typ: 'pause', jetzt: Date.now() })
  void schreibeLebenszeichen()
}

export function weiter(): void {
  if (stand.automat.phase !== 'pausiert') return
  rekorder?.weiter()
  ereignis({ typ: 'weiter', jetzt: Date.now() })
}

/** Nach einer Unterbrechung (Anruf, App verlassen): mit neuem Mikrofon-Zugriff weiter aufnehmen. */
export async function fortsetzen(): Promise<void> {
  if (stand.automat.phase !== 'unterbrochen' || !stand.lokalId) return
  ereignis({ typ: 'fortsetzen' })
  let stream: MediaStream
  try {
    stream = await holeMikrofon()
  } catch (err) {
    ereignis({ typ: 'fehler', text: err instanceof Error ? err.message : String(err), jetzt: Date.now() })
    return
  }
  const a = await speicher.ladeAufnahme(stand.lokalId)
  await starteTon(stream, a ? naechsteSegmentNr(a) : stand.segmentNr + 1)
}

/** Beendet die Aufnahme, sichert den letzten Abschnitt und gibt alles zum Hochladen frei. Liefert die lokalId. */
export async function beenden(): Promise<string | null> {
  const lokalId = stand.lokalId
  if (!lokalId) return null
  const r = rekorder
  ereignis({ typ: 'beenden', jetzt: Date.now() })
  if (r) await r.stop()
  raeumeLaufzeitAuf(false)
  if (notizWecker !== null) window.clearTimeout(notizWecker)
  notizWecker = null
  const dauer = Math.round(gesamtMs() / 1000)
  await speicher.aktualisiere(lokalId, (x) => ({ ...x, marker: stand.marker, notizen: stand.notizen, dauer_s: dauer, beendet: true, lebtBis: 0 }))
  // Abschnitte, deren Ende nie gemeldet wurde (Störung), jetzt zusammensetzen.
  await wiederherstellen(lokalId)
  anstossen()
  return lokalId
}

/** Nach dem Wechsel auf den Warte-Bildschirm: Sitzung für die nächste Aufnahme freigeben. */
export function zuruecksetzen(): void {
  if (rekorder?.laeuft) return
  setze({ ...LEER })
}

// ---------------------------------------------------------------------------------------------
// Während der Aufnahme

const MARKER_TEXT: Record<GespraechMarkerArt, string> = { wichtig: 'Wichtig', aufgabe: 'Aufgabe', frage: 'Frage' }

export function markieren(art: GespraechMarkerArt): number {
  const sek = Math.floor(gesamtMs() / 1000)
  const marker = [...stand.marker, { sek, art, text: MARKER_TEXT[art] }]
  setze({ marker })
  void sichereMarker()
  return marker.length - 1
}

export function markerText(index: number, text: string): void {
  const marker = stand.marker.map((m, i) => (i === index ? { ...m, text: text.slice(0, 300) || MARKER_TEXT[m.art] } : m))
  setze({ marker })
  void sichereMarker()
}

export function markerEntfernen(index: number): void {
  setze({ marker: stand.marker.filter((_, i) => i !== index) })
  void sichereMarker()
}

async function sichereMarker(): Promise<void> {
  const lokalId = stand.lokalId
  if (!lokalId) return
  const marker = stand.marker
  await speicher.aktualisiere(lokalId, (x) => ({ ...x, marker }))
  anstossen()
}

export function notizSetzen(text: string): void {
  setze({ notizen: text })
  if (notizWecker !== null) window.clearTimeout(notizWecker)
  notizWecker = window.setTimeout(() => {
    notizWecker = null
    const lokalId = stand.lokalId
    if (!lokalId) return
    const notizen = stand.notizen
    void speicher.aktualisiere(lokalId, (x) => ({ ...x, notizen })).then(() => anstossen())
  }, 1500)
}

/** Foto eines Dokuments: verkleinert (lange Seite höchstens 2000 px), gesichert, zum Hochladen freigegeben. */
export async function fotoHinzufuegen(datei: File): Promise<void> {
  const lokalId = stand.lokalId
  if (!lokalId) return
  const sek = Math.floor(gesamtMs() / 1000)
  const bild = await verkleinere(datei)
  const a = await speicher.ladeAufnahme(lokalId)
  if (!a) return
  const n = naechsteFotoNr(a)
  await speicher.speichereFoto(lokalId, n, bild)
  const name = datei.name && !/^image\.(jpe?g|png|heic)$/i.test(datei.name) ? datei.name : `Foto ${n}.jpg`
  await speicher.aktualisiere(lokalId, (x) => ({ ...x, fotos: [...x.fotos, { n, name, mime: bild.type || 'image/jpeg', sek, status: 'lokal' as const }] }))
  setze({ fotos: stand.fotos + 1 })
  anstossen()
}

async function verkleinere(datei: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(datei)
    const faktor = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * faktor)
    canvas.height = Math.round(bitmap.height * faktor)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
    return blob && blob.size > 0 ? blob : datei
  } catch {
    return datei
  }
}

// ---------------------------------------------------------------------------------------------
// Unvollständige Aufnahmen (Fenster geschlossen, Akku leer …)

export async function unvollstaendigeAufnahmen(): Promise<LokaleAufnahme[]> {
  const alle = await speicher.alleAufnahmen()
  const jetzt = Date.now()
  return alle.filter((a) => a.lokalId !== stand.lokalId && istVerwaist(a, jetzt))
}

/** Setzt liegengebliebene Teilstücke zu Abschnitten zusammen (Dauer geschätzt) und rechnet die Gesamtdauer nach. */
export async function wiederherstellen(lokalId: string): Promise<LokaleAufnahme | null> {
  const a = await speicher.ladeAufnahme(lokalId)
  if (!a) return null
  for (const s of a.segmente.filter((x) => x.status === 'aufnahme')) await schliesseSegment(lokalId, s.nr, s.mime, null)
  return await speicher.aktualisiere(lokalId, (x) => {
    const summe = x.segmente.reduce((n, s) => n + (s.dauer_s || 0), 0)
    return { ...x, dauer_s: Math.max(x.dauer_s, summe) }
  })
}

/** Unvollständige Aufnahme so wie sie ist hochladen und auswerten lassen. */
export async function unvollstaendigeAuswerten(lokalId: string): Promise<void> {
  const a = await wiederherstellen(lokalId)
  if (!a) return
  if (a.segmente.length === 0) {
    await verwerfen(lokalId)
    throw new Error('In dieser Aufnahme ist kein Ton gesichert — sie wurde entfernt.')
  }
  await speicher.aktualisiere(lokalId, (x) => ({ ...x, beendet: true, lebtBis: 0 }))
  anstossen()
}

/** Unvollständige Aufnahme weiterführen: zeigt die Einwilligung erneut, dann geht es mit neuen Abschnitten weiter. */
export async function unvollstaendigeFortsetzen(lokalId: string): Promise<void> {
  const a = await wiederherstellen(lokalId)
  if (!a) return
  vorbereiten({
    art: a.art,
    titel: a.titel,
    kundeId: a.kundeId,
    kundeBereich: a.kundeBereich,
    kundeName: a.kundeName,
    objektId: a.objektId,
    objektName: a.objektName,
    terminId: a.terminId,
    fortsetzenVon: lokalId,
  })
}

/** Entfernt eine Aufnahme vom Gerät; liegt sie schon beim Server, wird sie dort verworfen (Ton gelöscht). */
export async function verwerfen(lokalId: string): Promise<void> {
  const a = await speicher.ladeAufnahme(lokalId)
  if (a?.serverId) {
    try {
      await server.gespraechVerwerfen(a.serverId)
    } catch {
      // Ohne Netz: auf dem Gerät trotzdem entfernen; der Server löscht den Ton spätestens nach der Frist.
    }
  }
  await speicher.loescheAufnahme(lokalId)
}
