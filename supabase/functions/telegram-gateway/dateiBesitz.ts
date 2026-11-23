// Besitz per Telegram geschickter, noch nicht abgelegter Dateien (Ordner „telegram/“ im Eimer „email-anhaenge“).
//
// Anlass (Sicherheitsprüfung 23.11.2026): Der private Assistent (privatBot.ts) lässt Dateien, die er keiner
// eigenen privaten Akte zuordnen kann, unabgelegt im gemeinsamen Ordner liegen — und unzugeordnete_dateien,
// datei_lesen, dateien_ablegen, dateien_ins_objekt und kontoauszug_abgleichen zeigten jedem Kollegen im
// Mayer-Assistenten jede unabgelegte Datei. Seitdem tragen Dateien aus dem privaten Assistenten im Namen
// eine Besitzer-Marke hinter dem Inhaltsabdruck:
//
//   <Zeitstempel>_h<abdruck>[p<von>-<bis>]_pv<8 Zeichen>_<Name>
//
// „pv“ + die ersten 8 Hex-Zeichen des SHA-256 der kleingeschriebenen Login-Adresse. Die Adresse selbst
// steht so nicht in öffentlichen Datei-Adressen. Regel für UNABGELEGTE Dateien (liegt eine Datei schon
// in einer Akte oder einem Objekt, gelten die Rechte dieser Akte, siehe Aufrufer):
//  - Mayer-Assistent: Dateien mit der Marke eines anderen gibt es nicht; ohne Marke wie bisher für alle.
//  - Privater Assistent: nur Dateien mit der eigenen Marke — Eingänge der Holding gibt es dort nicht.

import type { RechteMitarbeiter } from './rechte.ts'

/** Name im Ordner „telegram/“: Zeitstempel, Inhaltsabdruck (Gruppe 1), optional Besitzer-Marke (Gruppe 2). */
export const MARKE_MUSTER = /^\d{10,}_(h[0-9a-f]{12}(?:p\d+-\d+)?)(?:_(pv[0-9a-f]{8}))?_/

/** Anzeigename ohne Zeitstempel, Inhaltsabdruck und Besitzer-Marke. */
export function anzeigeNameAusOrdner(dateiImOrdner: string): string {
  return String(dateiImOrdner ?? '').replace(MARKE_MUSTER, '').replace(/^\d{10,}_/, '')
}

/** Besitzer-Marke aus dem Dateinamen (auch aus einem vollen Pfad oder einer Adresse), sonst null. */
export function besitzerMarkeAusName(name: string): string | null {
  const letztes = String(name ?? '').split(/[?#]/)[0].split('/').pop() ?? ''
  return letztes.match(MARKE_MUSTER)?.[2] ?? null
}

/** „pv“ + 8 Hex-Zeichen aus der Login-Adresse; ohne Adresse aus dem Namen (dann nur für ihn selbst wiedererkennbar). */
export async function privatMarke(m: Pick<RechteMitarbeiter, 'email' | 'name'>): Promise<string> {
  const quelle = String(m.email ?? '').trim().toLowerCase() || `name:${String(m.name ?? '').trim().toLowerCase()}`
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(quelle)))
  return `pv${[...digest.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Zusatz für den Dateinamen beim Speichern: im privaten Assistenten „_pv…“, sonst leer. */
export async function besitzerZusatz(m: RechteMitarbeiter | undefined | null): Promise<string> {
  return m?.nurPrivat === true ? `_${await privatMarke(m)}` : ''
}

/**
 * Prüfer für unabgelegte Dateien: true = die Datei gibt es für diesen Mitarbeiter nicht.
 * Einmal je Aufruf bauen (die Marke wird dabei einmal berechnet), dann für viele Namen verwenden.
 */
export async function fremdPruefer(m: RechteMitarbeiter, imPrivatBot = m.nurPrivat === true): Promise<(name: string) => boolean> {
  const meine = await privatMarke(m)
  return (name: string) => {
    const marke = besitzerMarkeAusName(name)
    if (imPrivatBot) return marke !== meine
    return marke !== null && marke !== meine
  }
}

/** Einzelprüfung: Gibt es diese unabgelegte Datei für den Mitarbeiter nicht? */
export async function unzugeordnetFremd(m: RechteMitarbeiter, name: string, imPrivatBot = m.nurPrivat === true): Promise<boolean> {
  return (await fremdPruefer(m, imPrivatBot))(name)
}
