// Hochlade-Warteschlange der Gesprächs-App — der reine Teil (ohne IndexedDB und Netz), mit Deno geprüft
// (src/gespraech/tests/warteschlange.test.ts). Jede Aufnahme liegt als LokaleAufnahme im Gerätespeicher
// (speicher.ts); uploader.ts fragt hier nach dem nächsten Schritt, führt ihn aus und schreibt das Ergebnis
// zurück. Reihenfolge je Aufnahme:
//   1. anlegen (gespraech_anlegen → Server-id; auch nachträglich, wenn ohne Netz aufgenommen wurde)
//   2. Abschnitte der Reihe nach: hochladen (gespraech_upload_url + Speicher), dann melden (gespraech_segment_fertig)
//   3. Fotos hochladen, dann gesammelt melden (gespraech_notiz {fotos})
//   4. Markierungen und Notizen, sobald sie sich geändert haben (gespraech_marker / gespraech_notiz)
//   5. abschließen (gespraech_abschliessen), erst wenn die Aufnahme beendet und alles oben erledigt ist.
// Schlägt ein Schritt fehl, wartet die Aufnahme (2 s, 4 s, 8 s … höchstens 5 Minuten) und versucht es erneut.
// Nichts wird gelöscht, bevor der Server es hat.

import type { GespraechArt, GespraechEinwilligung, GespraechMarker } from './typen.ts'

/** Abschnitt auf dem Gerät: „aufnahme“ = wird gerade aufgenommen (Teile liegen einzeln), „lokal“ = fertig
 *  zusammengesetzt, „hochgeladen“ = im Speicher des Servers, „gemeldet“ = gespraech_segment_fertig erledigt. */
export type LokalSegmentStatus = 'aufnahme' | 'lokal' | 'hochgeladen' | 'gemeldet'

export type LokalSegment = { nr: number; mime: string; dauer_s: number; bytes: number; status: LokalSegmentStatus; pfad?: string }

export type LokalFoto = { n: number; name: string; mime: string; sek: number; status: 'lokal' | 'hochgeladen' | 'gemeldet'; pfad?: string }

export type LokaleAufnahme = {
  lokalId: string
  serverId: string | null
  erstelltAm: string
  mitarbeiterEmail: string
  art: GespraechArt
  titel: string
  kundeId?: string
  kundeBereich?: string
  kundeName?: string
  objektId?: string
  objektName?: string
  terminId?: string
  einwilligung: GespraechEinwilligung
  aufbewahrenTage: number
  /** Aufnahme ist beendet (Knopf „Beenden“ oder wiederhergestellt und zum Auswerten freigegeben). */
  beendet: boolean
  dauer_s: number
  /** Lebenszeichen der aufnehmenden Seite (ms); liegt es zurück und ist nicht beendet, ist die Aufnahme verwaist. */
  lebtBis: number
  segmente: LokalSegment[]
  fotos: LokalFoto[]
  marker: GespraechMarker[]
  /** Zuletzt erfolgreich gesendeter Stand (JSON der Markierungen bzw. Notiztext). */
  markerGesendet: string
  notizen: string
  notizenGesendet: string
  abgeschlossen: boolean
  versuche: number
  naechsterVersuch: number
  letzterFehler: string | null
}

export type Schritt =
  | { art: 'anlegen' }
  | { art: 'segment_hochladen'; nr: number }
  | { art: 'segment_melden'; nr: number }
  | { art: 'foto_hochladen'; n: number }
  | { art: 'fotos_melden' }
  | { art: 'marker' }
  | { art: 'notiz' }
  | { art: 'abschliessen' }
  | { art: 'warten'; bis: number }
  | { art: 'nichts' }

export const HOECHSTE_WARTEZEIT_MS = 5 * 60_000

/** Wartezeit nach dem n-ten Fehlschlag: 2 s, 4 s, 8 s … höchstens 5 Minuten. */
export function wartezeit(versuche: number): number {
  if (versuche <= 0) return 0
  return Math.min(HOECHSTE_WARTEZEIT_MS, 2000 * 2 ** Math.min(20, versuche - 1))
}

/** Was als Nächstes für diese Aufnahme zu tun ist. `online`: navigator.onLine. */
export function naechsterSchritt(a: LokaleAufnahme, jetzt: number, online = true): Schritt {
  if (a.abgeschlossen) return { art: 'nichts' }
  if (!online) return { art: 'nichts' }
  if (a.naechsterVersuch > jetzt) return { art: 'warten', bis: a.naechsterVersuch }
  if (!a.serverId) return { art: 'anlegen' }
  for (const s of [...a.segmente].sort((x, y) => x.nr - y.nr)) {
    if (s.status === 'lokal') return { art: 'segment_hochladen', nr: s.nr }
    if (s.status === 'hochgeladen') return { art: 'segment_melden', nr: s.nr }
  }
  for (const f of [...a.fotos].sort((x, y) => x.n - y.n)) if (f.status === 'lokal') return { art: 'foto_hochladen', n: f.n }
  if (a.fotos.some((f) => f.status === 'hochgeladen')) return { art: 'fotos_melden' }
  if (markerJson(a.marker) !== a.markerGesendet) return { art: 'marker' }
  if (a.notizen !== a.notizenGesendet) return { art: 'notiz' }
  if (bereitZumAbschliessen(a)) return { art: 'abschliessen' }
  return { art: 'nichts' }
}

/** Beendet, mindestens ein Abschnitt, alle Abschnitte und Fotos gemeldet, Markierungen und Notizen gesendet. */
export function bereitZumAbschliessen(a: LokaleAufnahme): boolean {
  return (
    a.beendet &&
    !!a.serverId &&
    a.segmente.length > 0 &&
    a.segmente.every((s) => s.status === 'gemeldet') &&
    a.fotos.every((f) => f.status === 'gemeldet') &&
    markerJson(a.marker) === a.markerGesendet &&
    a.notizen === a.notizenGesendet
  )
}

/** Nummern der Abschnitte für gespraech_abschliessen — die tatsächlichen, aufsteigend (Lücken möglich, siehe server.ts). */
export function abschlussNummern(a: Pick<LokaleAufnahme, 'segmente'>): number[] {
  return [...new Set(a.segmente.map((s) => s.nr))].sort((x, y) => x - y)
}

export function markerJson(m: GespraechMarker[]): string {
  return JSON.stringify(m)
}

/** Nach einem erfolgreichen Schritt: Fehlerzähler zurück. */
export function nachErfolg(a: LokaleAufnahme): LokaleAufnahme {
  return { ...a, versuche: 0, naechsterVersuch: 0, letzterFehler: null }
}

/** Nach einem Fehlschlag: Zähler hoch, nächster Versuch später. */
export function nachFehler(a: LokaleAufnahme, jetzt: number, fehler: string): LokaleAufnahme {
  const versuche = a.versuche + 1
  return { ...a, versuche, naechsterVersuch: jetzt + wartezeit(versuche), letzterFehler: fehler.slice(0, 300) }
}

/** Setzt den Stand eines Abschnitts (unveränderliche Kopie). */
export function mitSegment(a: LokaleAufnahme, nr: number, aenderung: Partial<LokalSegment>): LokaleAufnahme {
  return { ...a, segmente: a.segmente.map((s) => (s.nr === nr ? { ...s, ...aenderung } : s)) }
}

export function mitFoto(a: LokaleAufnahme, n: number, aenderung: Partial<LokalFoto>): LokaleAufnahme {
  return { ...a, fotos: a.fotos.map((f) => (f.n === n ? { ...f, ...aenderung } : f)) }
}

/** Nächste freie Abschnittsnummer (ab 1). */
export function naechsteSegmentNr(a: Pick<LokaleAufnahme, 'segmente'>): number {
  return a.segmente.reduce((m, s) => Math.max(m, s.nr), 0) + 1
}

export function naechsteFotoNr(a: Pick<LokaleAufnahme, 'fotos'>): number {
  return a.fotos.reduce((m, f) => Math.max(m, f.n), 0) + 1
}

/** Lebenszeichen liegt zurück, aber die Aufnahme wurde nie beendet (Fenster geschlossen, Akku leer …). */
export function istVerwaist(a: LokaleAufnahme, jetzt: number): boolean {
  return !a.beendet && !a.abgeschlossen && a.lebtBis < jetzt
}

/** Stand für die Anzeige. */
export function fortschritt(a: LokaleAufnahme): { gemeldet: number; gesamt: number; offen: boolean } {
  const gemeldet = a.segmente.filter((s) => s.status === 'gemeldet').length
  return { gemeldet, gesamt: a.segmente.length, offen: !a.abgeschlossen }
}

/** Kurztext für die Anzeige einer Aufnahme, die noch auf dem Gerät liegt. */
export function standText(a: LokaleAufnahme, jetzt: number, online: boolean): string {
  if (a.abgeschlossen) return 'Hochgeladen — wird ausgewertet'
  if (istVerwaist(a, jetzt)) return 'Unvollständig — nicht beendet'
  if (!a.beendet) return 'Aufnahme läuft'
  const { gemeldet, gesamt } = fortschritt(a)
  if (!online) return `Wartet auf Netz (${gemeldet} von ${gesamt} Abschnitten hochgeladen)`
  if (a.letzterFehler) return `Neuer Versuch gleich (${gemeldet} von ${gesamt} hochgeladen)`
  return `Wird hochgeladen (${gemeldet} von ${gesamt})`
}

/** Dauer eines wiederhergestellten Abschnitts, wenn nur die Zahl der Teile bekannt ist. */
export function geschaetzteDauer(teile: number, teilMs: number): number {
  return Math.round((teile * teilMs) / 1000)
}

/** Dateiendung zum Format (für Fotos und Anzeige; Server legt den Pfad fest). */
export function endungZu(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a'
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('webm')) return 'webm'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('png')) return 'png'
  if (m.includes('heic')) return 'heic'
  return 'bin'
}
