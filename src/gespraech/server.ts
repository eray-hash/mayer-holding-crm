// Aufrufe der Gesprächs-App an den Server (email-gateway, Aktionen gespraech_*, gebaut von Helfer „pipeline“).
// Alle mit dem eigenen Login (callAuthenticated). Die Antworten werden großzügig gelesen (Zeile direkt oder
// unter `aufnahme`), damit kleine Abweichungen im Antwortformat die App nicht lahmlegen.

import { callAuthenticated } from '../lib/emailGateway'
import { supabase } from '../lib/supabaseClient'
import { GESPRAECH_SPEICHER, type GespraechAnlegenEingabe, type GespraechAufnahme, type GespraechFoto, type GespraechMarker, type GespraechUploadZiel } from './typen'

export async function gespraechAnlegen(eingabe: GespraechAnlegenEingabe & { lokalId: string; aufbewahrenTage?: number }): Promise<string> {
  // Die Kennung vom Handy wird zur Kennung der Aufnahme (Server: body.id) — ein zweiter Aufruf nach verlorener Antwort liefert dieselbe.
  const d = await callAuthenticated({ action: 'gespraech_anlegen', ...eingabe, id: eingabe.lokalId, aufbewahrenTage: eingabe.aufbewahrenTage })
  const id = d?.id ?? d?.aufnahme?.id
  if (!id) throw new Error('Der Server hat keine Nummer für die Aufnahme geliefert.')
  return String(id)
}

/** Ziel für einen Tonabschnitt ({nr}) oder ein Foto ({foto}). */
export async function gespraechUploadZiel(id: string, wofuer: { nr: number } | { foto: number }, mime: string): Promise<GespraechUploadZiel> {
  // Der Server unterscheidet Ton und Foto am Dateityp; die Nummer heißt dort immer nr.
  const nr = 'nr' in wofuer ? wofuer.nr : wofuer.foto
  const d = await callAuthenticated({ action: 'gespraech_upload_url', id, mime: mime.split(';')[0].trim(), nr })
  if (!d?.pfad || !d?.token) throw new Error('Der Server hat kein Ziel zum Hochladen geliefert.')
  return { pfad: String(d.pfad), signedUrl: String(d.signedUrl ?? ''), token: String(d.token) }
}

/** Lädt eine Datei an das vom Server vergebene Ziel. Ein zweiter Versuch derselben Datei gilt als Erfolg. */
export async function ladeHoch(ziel: GespraechUploadZiel, datei: Blob, mime: string): Promise<void> {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank eingerichtet.')
  const { error } = await supabase.storage.from(GESPRAECH_SPEICHER).uploadToSignedUrl(ziel.pfad, ziel.token, datei, { contentType: mime || datei.type || 'application/octet-stream' })
  if (error) {
    const text = String(error.message ?? error)
    // Nach einer verlorenen Antwort liegt die Datei schon dort — das ist kein Fehler.
    if (/already exists|duplicate|409/i.test(text) || (error as { statusCode?: string | number }).statusCode == 409) return
    throw new Error(`Hochladen fehlgeschlagen: ${text}`)
  }
}

export async function gespraechSegmentFertig(id: string, nr: number, dauer_s: number, bytes: number, mime: string): Promise<void> {
  await callAuthenticated({ action: 'gespraech_segment_fertig', id, nr, dauer_s, bytes, mime: mime.split(';')[0].trim() })
}

export async function gespraechMarker(id: string, marker: GespraechMarker[]): Promise<void> {
  await callAuthenticated({ action: 'gespraech_marker', id, marker })
}

export async function gespraechNotiz(id: string, inhalt: { notizen: string } | { fotos: GespraechFoto[] }): Promise<void> {
  await callAuthenticated({ action: 'gespraech_notiz', id, ...inhalt })
}

export async function gespraechAbschliessen(id: string, dauer_s: number, segmente: number): Promise<void> {
  // nummern: alle aufgenommenen Abschnitte (1…n), damit der Server weiß, worauf er warten muss.
  await callAuthenticated({ action: 'gespraech_abschliessen', id, dauer_s, segmente, nummern: Array.from({ length: segmente }, (_, i) => i + 1) })
}

export async function gespraechStand(id: string): Promise<GespraechAufnahme> {
  const d = await callAuthenticated({ action: 'gespraech_stand', id })
  const zeile = d?.aufnahme ?? d?.zeile ?? (d?.id ? d : null)
  if (!zeile) throw new Error('Aufnahme nicht gefunden.')
  return normalisiere(zeile)
}

export async function gespraechListe(seite = 0): Promise<GespraechAufnahme[]> {
  const d = await callAuthenticated({ action: 'gespraech_liste', seite })
  const liste = d?.aufnahmen ?? d?.liste ?? d?.zeilen ?? (Array.isArray(d) ? d : [])
  return (Array.isArray(liste) ? liste : []).map(normalisiere)
}

export async function gespraechVerwerfen(id: string): Promise<void> {
  await callAuthenticated({ action: 'gespraech_verwerfen', id })
}

// deno-lint-ignore no-explicit-any
function normalisiere(z: any): GespraechAufnahme {
  return {
    ...z,
    id: String(z.id),
    segmente: Array.isArray(z.segmente) ? z.segmente : [],
    marker: Array.isArray(z.marker) ? z.marker : [],
    fotos: Array.isArray(z.fotos) ? z.fotos : [],
  } as GespraechAufnahme
}
