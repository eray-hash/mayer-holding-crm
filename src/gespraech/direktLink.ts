// Direkt-Links in die Aufnahme (Runde 5): #/aufnehmen?termin=…|kunde=…|objekt=…&art=… — siehe
// supabase/functions/_shared/gespraechLink.ts (Aufbau und Lesen des Links, auch vom Server benutzt).
// Hier: aus dem gelesenen Link die Vorbereitung der Aufnahme machen (Termin, Akte, Titel, Art). Rein — das
// Nachschlagen in der Datenbank kommt über `DirektLader` (direktLinkLader.ts), damit es ohne Netz testbar ist.
//
// Regeln:
// - Termin gefunden → Titel des Termins; ohne Akte im Link wird die Akte des Termins gesucht (findeBezug).
// - Akte/Objekt/Termin nicht gefunden (gelöscht, nicht sichtbar) → `hinweis`; die App zeigt dann die Startseite
//   mit allem Übrigen vorbelegt, statt ohne Rückfrage ohne Akte aufzunehmen.
// - Kein Netz (Lader wirft) → die Nummern aus dem Link werden ungeprüft übernommen; aufnehmen geht trotzdem.
// - Nur „art=termin“ ohne Nummern (Schnellaktion „Termin aufnehmen“) → der laufende oder gleich beginnende Termin
//   samt Akte, wenn es einen gibt.

import type { AufnehmenZiel } from '../../supabase/functions/_shared/gespraechLink.ts'
import type { GespraechArt } from './typen.ts'

/** Gleiche Form wie AufnahmeVorbereitung in sitzung.ts (ohne fortsetzenVon). */
export type DirektVorbereitung = {
  art: GespraechArt
  titel: string
  kundeId?: string
  kundeBereich?: string
  kundeName?: string
  objektId?: string
  objektName?: string
  terminId?: string
}

export type DirektTermin = { id: string; titel: string }
export type DirektAkte = { art: 'kunde'; id: string; bereich: string; name: string } | { art: 'objekt'; id: string; name: string }

/** null = nicht gefunden bzw. nicht sichtbar; ein Fehler (throw) = keine Verbindung. */
export type DirektLader = {
  termin: (id: string) => Promise<DirektTermin | null>
  /** Akte zum Termin (nur nach termin(id) mit Treffer gerufen); wirft nie. */
  akteZuTermin: (id: string) => Promise<DirektAkte | null>
  kunde: (id: string) => Promise<DirektAkte | null>
  objekt: (id: string) => Promise<DirektAkte | null>
  /** Laufender oder in Kürze beginnender Termin des Mitarbeiters (samt Akte), sonst null. */
  aktuellerTermin: () => Promise<{ termin: DirektTermin; akte: DirektAkte | null } | null>
}

export type DirektAufloesung = { vorbereitung: DirektVorbereitung; hinweis: string | null }

export const ART_TITEL: Record<GespraechArt, string> = { termin: 'Termin', telefon: 'Telefonat', notiz: 'Notiz' }

export const HINWEIS = {
  fehlerhaft: 'Der Link war nicht vollständig lesbar.',
  termin: 'Der Termin aus dem Link wurde nicht gefunden (gelöscht oder für Sie nicht sichtbar).',
  kunde: 'Die Akte aus dem Link wurde nicht gefunden (gelöscht oder für Sie nicht sichtbar).',
  objekt: 'Das Objekt aus dem Link wurde nicht gefunden (gelöscht oder für Sie nicht sichtbar).',
}

async function versuche<T>(f: () => Promise<T>): Promise<{ ok: true; wert: T } | { ok: false }> {
  try {
    return { ok: true, wert: await f() }
  } catch {
    return { ok: false }
  }
}

function setzeAkte(v: DirektVorbereitung, a: DirektAkte): void {
  if (a.art === 'kunde') {
    v.kundeId = a.id
    if (a.bereich) v.kundeBereich = a.bereich
    if (a.name) v.kundeName = a.name
  } else {
    v.objektId = a.id
    if (a.name) v.objektName = a.name
  }
}

export async function loeseDirektLinkAuf(ziel: AufnehmenZiel, lader: DirektLader, standardArt: GespraechArt): Promise<DirektAufloesung> {
  const hinweise: string[] = []
  if (ziel.fehlerhaft) hinweise.push(HINWEIS.fehlerhaft)
  const v: DirektVorbereitung = { art: ziel.art ?? (ziel.termin ? 'termin' : standardArt), titel: '' }
  let terminTitel = ''
  let terminGefunden = false

  if (ziel.termin) {
    const r = await versuche(() => lader.termin(ziel.termin!))
    if (!r.ok) v.terminId = ziel.termin // keine Verbindung: Nummer ungeprüft mitgeben
    else if (r.wert) {
      v.terminId = r.wert.id
      terminTitel = r.wert.titel
      terminGefunden = true
    } else hinweise.push(HINWEIS.termin)
  }

  for (const art of ['kunde', 'objekt'] as const) {
    const id = ziel[art]
    if (!id) continue
    const r = await versuche(() => lader[art](id))
    if (!r.ok) {
      if (art === 'kunde') v.kundeId = id
      else v.objektId = id
    } else if (r.wert) setzeAkte(v, r.wert)
    else hinweise.push(HINWEIS[art])
  }

  // Termin ohne Akte im Link: die Akte des Termins.
  if (terminGefunden && !ziel.kunde && !ziel.objekt) {
    const a = await lader.akteZuTermin(v.terminId!).catch(() => null)
    if (a) setzeAkte(v, a)
  }

  // Schnellaktion „Termin aufnehmen“: der Termin, der gerade läuft oder gleich beginnt.
  if (!ziel.termin && !ziel.kunde && !ziel.objekt && v.art === 'termin') {
    const jetzt = await lader.aktuellerTermin().catch(() => null)
    if (jetzt) {
      v.terminId = jetzt.termin.id
      terminTitel = jetzt.termin.titel
      if (jetzt.akte) setzeAkte(v, jetzt.akte)
    }
  }

  v.titel = (terminTitel.trim() || v.kundeName || v.objektName || ART_TITEL[v.art]).slice(0, 200)
  return { vorbereitung: v, hinweis: hinweise.length ? hinweise.join(' ') : null }
}

/** Phasen, in denen eine Aufnahme läuft — dann ändert ein Direkt-Link nichts (zurück zur laufenden Aufnahme). */
export function nimmtGeradeAuf(phase: string): boolean {
  return phase === 'startet' || phase === 'laeuft' || phase === 'pausiert' || phase === 'unterbrochen'
}
