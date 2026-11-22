// Alle Zeilen einer Abfrage lesen (22.11.2026). Supabase (PostgREST) liefert höchstens 1000 Zeilen je
// Abfrage — ohne Fehler, die übrigen fehlen einfach. Das hat Hasans To-do-Liste (über 2.600 Aufgaben) und
// den Outlook-Abgleich still kaputt gemacht. Ein `.limit(5000)` hilft NICHT: die Grenze des Servers gilt trotzdem.
//
// Gemeinsam für Edge-Funktionen (Deno) und das CRM im Browser (src/lib/alleZeilen.ts reicht diese Datei weiter).
//
// Benutzung:
//   const { data, error } = await alleZeilen(() => db.from('todos').select('id, aufgabe').is('erledigt_am', null))
//   const { data } = await alleZeilen(() => db.from('ki_verbrauch').select('am, anlass').gte('am', ab), { ordnung: 'am' })
//
// `baue` muss bei jedem Aufruf eine NEUE Abfrage liefern (Select + Filter, ohne limit/range). Die Hilfe sortiert nach
// einer eindeutigen Spalte (Vorgabe `id`) und blättert mit `.range` in Seiten zu 1000. Eine eigene Sortierung der
// Abfrage bleibt vorne; `id` kommt nur als letzte Sortierung dazu, damit die Seiten sich nicht überschneiden.
//
// Test-Doppel (z. B. _shared/testDoppel.ts) kennen oft kein `.range` — dann wird die Abfrage genau einmal ausgeführt.

/** Größe einer Seite = Grenze des Servers. */
export const SEITE = 1000

/** Obergrenze, damit ein Fehler nie in einer Endlosschleife endet. */
export const HOECHSTENS = 200_000

export type ZeilenFehler = { message: string; code?: string }
export type AlleZeilenErgebnis<T> = { data: T[]; error: ZeilenFehler | null }

/** Was eine Abfrage mindestens können muss: abwartbar sein. `order`/`range` werden nur genutzt, wenn vorhanden. */
export type Abfrage = PromiseLike<{ data: unknown; error: unknown }>

export type AlleZeilenOptionen = {
  /** Eindeutige Sortierspalte(n) fürs Blättern. Vorgabe 'id'. `null` = die Abfrage ist schon eindeutig sortiert. */
  ordnung?: string | string[] | null
  /** Richtung der zusätzlichen Sortierung (Vorgabe aufsteigend). */
  aufsteigend?: boolean
  /** Höchstens so viele Zeilen insgesamt (z. B. statt eines früheren `.limit(5000)`). */
  hoechstens?: number
  /** Seitengröße; nur für Tests kleiner als 1000 setzen. */
  seite?: number
}

/** Tabellen, deren Primärschlüssel nicht `id` heißt (zum Blättern braucht es eine eindeutige Sortierung). */
export const SCHLUESSEL: Record<string, string[]> = {
  objekt_anfragen: ['email_id'],
  nutzung_minuten: ['email', 'minute'],
  dokument_inhalte: ['schluessel'],
  kalender_einstellungen: ['email'],
  kalender_fremd: ['email'],
  kundenportal_einstellungen: ['email'],
  objekt_luecken_hinweis: ['email'],
  rechnung_vorschlag_hinweis: ['email'],
  todo_aufraeumen_einstellungen: ['email'],
  kundenbericht_einstellung: ['kunde_id'],
  postfach_geheimnisse: ['postfach_id'],
  ms_anmeldungen: ['kennung'],
  ms_konten: ['login_email'],
  ms_geheimnisse: ['login_email'],
  privat_einstellungen: ['login_email'],
  fonds_portal_logins: ['token'],
  fonds_portal_sessions: ['token'],
}

/** Eindeutige Sortierspalte(n) einer Tabelle (Vorgabe `id`). */
export function schluesselVon(tabelle: string): string[] {
  return SCHLUESSEL[tabelle] ?? ['id']
}

// deno-lint-ignore no-explicit-any
type Beliebig = any

function alsFehler(e: unknown): ZeilenFehler | null {
  if (!e) return null
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const f = e as { message: unknown; code?: unknown }
    return { message: String(f.message), ...(f.code != null ? { code: String(f.code) } : {}) }
  }
  return { message: String(e) }
}

/** Liest alle Zeilen einer Abfrage seitenweise. Bei einem Fehler: bis dahin gelesene Zeilen + Fehler. */
// deno-lint-ignore no-explicit-any
export async function alleZeilen<T = Record<string, any>>(baue: () => Abfrage, optionen: AlleZeilenOptionen = {}): Promise<AlleZeilenErgebnis<T>> {
  const seite = Math.max(1, Math.floor(optionen.seite ?? SEITE))
  const hoechstens = Math.max(0, Math.floor(optionen.hoechstens ?? HOECHSTENS))
  const ordnung = optionen.ordnung === undefined ? ['id'] : optionen.ordnung === null ? [] : Array.isArray(optionen.ordnung) ? optionen.ordnung : [optionen.ordnung]
  const aufsteigend = optionen.aufsteigend !== false

  const sortiert = (q: Beliebig): Beliebig => {
    if (!q || typeof q.order !== 'function') return q
    let s = q
    for (const spalte of ordnung) s = s.order(spalte, { ascending: aufsteigend })
    return s
  }

  const erste = sortiert(baue())
  if (!erste || typeof erste.range !== 'function') {
    // Test-Doppel ohne `.range`: eine einzige Abfrage.
    const { data, error } = await (erste as Abfrage)
    const zeilen = Array.isArray(data) ? (data as T[]) : []
    return { data: zeilen.slice(0, hoechstens), error: alsFehler(error) }
  }

  const alle: T[] = []
  for (let von = 0; von < hoechstens; von += seite) {
    const q = von === 0 ? erste : sortiert(baue())
    const { data, error } = await (q.range(von, von + seite - 1) as Abfrage)
    const zeilen = Array.isArray(data) ? (data as T[]) : []
    alle.push(...zeilen)
    if (error) return { data: alle.slice(0, hoechstens), error: alsFehler(error) }
    if (zeilen.length < seite) break
  }
  return { data: alle.slice(0, hoechstens), error: null }
}

/** Wie alleZeilen, wirft aber bei einem Fehler (für Stellen, die bisher `if (error) throw …` hatten). */
// deno-lint-ignore no-explicit-any
export async function alleZeilenOderFehler<T = Record<string, any>>(baue: () => Abfrage, optionen: AlleZeilenOptionen = {}, was = 'Daten'): Promise<T[]> {
  const { data, error } = await alleZeilen<T>(baue, optionen)
  if (error) throw new Error(`${was} nicht lesbar: ${error.message}`)
  return data
}
