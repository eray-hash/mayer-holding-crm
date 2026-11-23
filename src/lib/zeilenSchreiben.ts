// Schreiben einzelner Zeilen aus dem Browser in die geteilte Datenbank (benutzt von crmSync.ts). Ohne
// Abhängigkeiten zu Vite/Supabase, damit es mit `deno test` und einem Test-Doppel prüfbar ist.
//
// Regeln (Bugfix-Nacht 23.11.2026, nach dem Datenverlust vom 17.11.):
// 1. Nur die Felder schreiben, die dieses Fenster geändert hat. Geänderte Listen (mit Kennungen) und — wo
//    angegeben — ganze Datenfelder (abteilung_eintraege.daten) werden vorher frisch gelesen und zusammengeführt.
// 2. Eine Zeile, die dieses Fenster aus der Datenbank kennt (geladen oder selbst angelegt) und die dort jetzt
//    fehlt, wurde anderswo gelöscht: Die Änderung wird verworfen statt die Zeile wieder anzulegen (früher kamen
//    gelöschte Aufgaben, Akten usw. so zurück). Nur Zeilen, die nie in der Datenbank angekommen sind (z. B.
//    offline angelegt), werden vollständig nachgetragen.
// 3. Schreibvorgänge je Zeile laufen nacheinander (eine Kette je Zeile), damit sich zwei schnelle Änderungen
//    nicht überholen.
// 4. Scheitert ein Speichern am Netz (offline, Zeitüberschreitung, abgelaufene Anmeldung), wird es gemerkt und
//    nachgeholt (bei „wieder online“ und alle 30 Sekunden) — vom letzten sicher gespeicherten Stand aus, sodass
//    auch spätere Änderungen derselben Zeile mitkommen. Früher war so eine Änderung still verloren.
// 5. Löscht ein einzelner Vorgang auf einmal mehr als HOECHSTENS_LOESCHEN Zeilen einer Tabelle, wird nichts
//    gelöscht (Schutz z. B. vor „Daten zurücksetzen“, das alle Listen leert — das würde sonst alle Akten,
//    Rechnungen, Aufgaben … in der Datenbank löschen).

import { alsListe, dreiWegeListe, dreiWegeObjekt, gleich, istObjekt } from './syncZusammenfuehren.ts'

export type Ausgang = 'ok' | 'nachholen' | 'fehler' | 'verworfen'
export type SyncFehler = { message: string; code?: string } | null

// Die Abfrage-Kette von supabase-js wird nur strukturell benutzt (from → update/upsert/select/delete …).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SyncClient = { from: (tabelle: string) => any }

/** Mehr Löschungen einer Tabelle in einem einzigen Vorgang gelten als Fehler (jede Lösch-Aktion löscht genau eine Zeile). */
export const HOECHSTENS_LOESCHEN = 3

// ---------- Meldungen ----------

type Melder = (art: 'fehler' | 'verworfen' | 'loeschen_gesperrt', tabelle: string, kontext: string, text?: string) => void

let melder: Melder = (art, tabelle, kontext, text) => {
  if (art === 'fehler') console.error(`Supabase-Sync fehlgeschlagen (${kontext}):`, text ?? '')
  else if (art === 'verworfen') console.warn(`[crmSync] ${kontext}: in der Datenbank inzwischen gelöscht — Änderung verworfen (${tabelle})`)
  else console.error(`[crmSync] ${kontext}: zu viele Löschungen auf einmal in ${tabelle} — nichts gelöscht`)
}

/** crmSync.ts hängt hier zusätzlich das Melden an die Geschäftsführung (app_fehler) an. */
export function setzeMelder(neu: Melder): void {
  melder = neu
}

export function istNetzFehler(fehler: unknown): boolean {
  const text = fehler instanceof Error ? `${fehler.name} ${fehler.message}` : istObjekt(fehler) ? String(fehler.message ?? '') : String(fehler ?? '')
  return /failed to fetch|network|load failed|fetch failed|timeout|timed out|aborted|jwt expired|upstream|gateway/i.test(text)
}

function ausgangBeiFehler(tabelle: string, kontext: string, fehler: { message: string }): Ausgang {
  const netz = istNetzFehler(fehler)
  // Netzfehler werden nachgeholt, nicht gemeldet (offline kann ohnehin nichts gemeldet werden).
  if (netz) console.warn(`[crmSync] ${kontext}: Speichern wird nachgeholt (${fehler.message})`)
  else melder('fehler', tabelle, kontext, fehler.message)
  return netz ? 'nachholen' : 'fehler'
}

// ---------- Welche Zeilen gibt es in der Datenbank? ----------

const inDatenbank = new Set<string>()

/** Beim Laden und nach jedem erfolgreichen Anlegen: Diese Zeilen gibt es in der Datenbank. */
export function merkeInDatenbank(tabelle: string, ids: Iterable<string>): void {
  for (const id of ids) inDatenbank.add(`${tabelle}:${id}`)
}

/**
 * Beim Laden des Stands (hydrate): Diese Zeilen gibt es in der Datenbank. Steht eine davon noch als „in diesem
 * Fenster gelöscht“ vermerkt, ist das Löschen nicht durchgegangen (fehlendes Recht — die Datenbank löscht dann still
 * nichts — oder abgelehnt) und die Zeile ist nach dem Neuladen wieder sichtbar: Der Vermerk fällt weg, sonst würde
 * jede weitere Änderung an ihr bis zum Neuladen der Seite still nicht gespeichert (Nachtprüfung 23.11.2026).
 * Läuft das Löschen noch oder wartet es aufs Nachholen, bleibt der Vermerk.
 */
export function merkeGeladen(tabelle: string, ids: Iterable<string>): void {
  for (const id of ids) {
    const s = `${tabelle}:${id}`
    inDatenbank.add(s)
    if (geloescht.has(s) && !ketten.has(s) && !offeneLoeschungen.get(tabelle)?.ids.has(id)) geloescht.delete(s)
  }
}

export function istInDatenbank(tabelle: string, id: string): boolean {
  return inDatenbank.has(`${tabelle}:${id}`)
}

/**
 * Die Zeile fehlt in der Datenbank (Änderung traf nichts). Kannte dieses Fenster sie von dort, wurde sie
 * anderswo gelöscht → verwerfen. Sonst ist sie nie angekommen → vollständig anlegen wie bisher.
 */
export async function legeAnFallsNieGespeichert(client: SyncClient, tabelle: string, id: string, zeile: Record<string, unknown>, kontext: string): Promise<Ausgang> {
  if (istInDatenbank(tabelle, id)) {
    melder('verworfen', tabelle, kontext)
    return 'verworfen'
  }
  return legeAn(client, tabelle, id, zeile, kontext)
}

export async function legeAn(client: SyncClient, tabelle: string, id: string, zeile: Record<string, unknown>, kontext: string): Promise<Ausgang> {
  const { error } = await client.from(tabelle).upsert(zeile)
  if (error) return ausgangBeiFehler(tabelle, kontext, error)
  merkeInDatenbank(tabelle, [id])
  return 'ok'
}

// ---------- Eine Zeile feldweise schreiben ----------

export type ZeilenAuftrag = {
  tabelle: string
  id: string
  kontext: string
  /** Stand der Zeile vor der Änderung (wie toRow ihn liefert); fehlt = in diesem Fenster neu. */
  vorher: Record<string, unknown> | undefined
  nachher: Record<string, unknown>
  /** Kennungen ergeben sich aus dem Inhalt (z. B. Tagesplan „Name|Datum“): Eine „neue“ Zeile kann der Server
   *  schon angelegt haben — dann wird auch beim ersten Speichern zusammengeführt statt überschrieben. */
  festeIds?: boolean
  /** Felder, die als Ganzes ein Datenobjekt sind (abteilung_eintraege.daten): Feld für Feld zusammenführen. */
  objektFelder?: string[]
}

export async function schreibeZeile(client: SyncClient, z: ZeilenAuftrag): Promise<Ausgang> {
  const { tabelle, id, kontext, nachher } = z
  if (!z.vorher && !z.festeIds) return legeAn(client, tabelle, id, nachher, kontext)
  const vorher: Record<string, unknown> = z.vorher ?? { id }
  const geaendert = Object.keys(nachher).filter((f) => f !== 'id' && !gleich(vorher[f], nachher[f]))
  if (geaendert.length === 0) return 'ok'
  const aenderung: Record<string, unknown> = Object.fromEntries(geaendert.map((f) => [f, nachher[f] ?? null]))

  const objektFelder = new Set(z.objektFelder ?? [])
  const zuMischen = geaendert.filter((f) =>
    objektFelder.has(f) ? istObjekt(nachher[f]) : Array.isArray(nachher[f]) && alsListe(nachher[f]) !== null && alsListe(vorher[f]) !== null,
  )
  if (zuMischen.length > 0) {
    const { data: server, error } = await client.from(tabelle).select(`id, ${zuMischen.join(', ')}`).eq('id', id).maybeSingle()
    // Ohne frischen Stand nie die eigene ganze Liste schreiben (sie würde fremde Einträge löschen).
    if (error) return ausgangBeiFehler(tabelle, kontext, error)
    if (!server) return legeAnFallsNieGespeichert(client, tabelle, id, nachher, kontext)
    const zeile = server as Record<string, unknown>
    for (const f of zuMischen) {
      if (objektFelder.has(f)) {
        if (istObjekt(zeile[f])) aenderung[f] = dreiWegeObjekt(istObjekt(vorher[f]) ? vorher[f] : undefined, nachher[f] as Record<string, unknown>, zeile[f])
        continue
      }
      const c = alsListe(zeile[f])
      if (c) aenderung[f] = dreiWegeListe(alsListe(vorher[f]) ?? [], alsListe(nachher[f]) ?? [], c)
    }
  }
  const { data, error } = await client.from(tabelle).update(aenderung).eq('id', id).select('id')
  if (error) return ausgangBeiFehler(tabelle, kontext, error)
  if (((data as unknown[] | null) ?? []).length === 0) return legeAnFallsNieGespeichert(client, tabelle, id, nachher, kontext)
  merkeInDatenbank(tabelle, [id])
  return 'ok'
}

// ---------- Ketten, Nachholen, Löschen ----------

type Offen = { vorher: unknown; nachher: unknown; schreibe: (vorher: unknown, nachher: unknown) => Promise<Ausgang>; versuche: number }

/** So oft wird nachgeholt (alle 30 Sekunden, also rund eine Stunde), dann aufgegeben und gemeldet. */
export const HOECHSTENS_VERSUCHE = 120

const ketten = new Map<string, Promise<Ausgang>>()
const ausstehend = new Map<string, Offen>()
const geloescht = new Set<string>()
const offeneLoeschungen = new Map<string, { client: SyncClient; tabelle: string; ids: Set<string>; kontext: string }>()
let laufend = 0
let zeitgeber: ReturnType<typeof setInterval> | null = null

/** Läuft gerade noch ein Speichern oder wartet eines aufs Nachholen? Dann lädt das Fenster den Stand nicht neu. */
export function schreibtGerade(): boolean {
  return laufend > 0 || ausstehend.size > 0 || offeneLoeschungen.size > 0
}

/** Anzahl der Änderungen, die aufs Nachholen warten (für Tests und Anzeige). */
export function anzahlAusstehend(): number {
  return ausstehend.size + [...offeneLoeschungen.values()].reduce((n, l) => n + l.ids.size, 0)
}

/**
 * Plant das Schreiben einer Zeile in ihre Kette. `schreibe(vorher, nachher)` bekommt als `vorher` den letzten
 * sicher gespeicherten Stand: Wartet die Zeile noch aufs Nachholen, ist das der Stand vor der ersten nicht
 * gespeicherten Änderung (so kommen alle Änderungen seither mit).
 */
export function plane<V, N>(schluessel: string, vorher: V | undefined, nachher: N, schreibe: (vorher: V | undefined, nachher: N) => Promise<Ausgang>): Promise<Ausgang> {
  laufend++
  const kette: Promise<Ausgang> = (ketten.get(schluessel) ?? Promise.resolve<Ausgang>('ok'))
    .then(async (): Promise<Ausgang> => {
      if (geloescht.has(schluessel)) return 'ok' // inzwischen in diesem Fenster gelöscht
      const offen = ausstehend.get(schluessel)
      const basis = offen ? (offen.vorher as V | undefined) : vorher
      let ausgang: Ausgang
      try {
        ausgang = await schreibe(basis, nachher)
      } catch (err) {
        console.error(`[crmSync] ${schluessel}:`, err)
        ausgang = istNetzFehler(err) ? 'nachholen' : 'fehler'
      }
      const versuche = (offen?.versuche ?? 0) + 1
      if (ausgang === 'nachholen' && versuche > HOECHSTENS_VERSUCHE) {
        ausstehend.delete(schluessel)
        melder('fehler', schluessel.split(':')[0], schluessel, 'Speichern nach vielen Versuchen aufgegeben')
        return 'fehler'
      }
      if (ausgang === 'nachholen' && !geloescht.has(schluessel)) {
        ausstehend.set(schluessel, { vorher: basis, nachher, schreibe: schreibe as Offen['schreibe'], versuche })
        starteNachholen()
      } else {
        ausstehend.delete(schluessel)
      }
      return ausgang
    })
    .finally(() => {
      laufend--
      if (ketten.get(schluessel) === kette) ketten.delete(schluessel)
    })
  ketten.set(schluessel, kette)
  return kette
}

/** Feldweises Schreiben einer Zeile über ihre Kette (Schlüssel „tabelle:id“). */
export function schreibeSpaeter(client: SyncClient, auftrag: Omit<ZeilenAuftrag, 'vorher' | 'nachher'>, vorher: Record<string, unknown> | undefined, nachher: Record<string, unknown>): Promise<Ausgang> {
  return plane(`${auftrag.tabelle}:${auftrag.id}`, vorher, nachher, (v, n) => schreibeZeile(client, { ...auftrag, vorher: v, nachher: n }))
}

/** Löscht Zeilen (nach den laufenden Schreibvorgängen derselben Zeilen); am Netz gescheitert → nachholen. */
export function loescheZeilen(client: SyncClient, tabelle: string, ids: string[], kontext: string): Promise<Ausgang> {
  if (ids.length === 0) return Promise.resolve('ok')
  if (ids.length > HOECHSTENS_LOESCHEN) {
    melder('loeschen_gesperrt', tabelle, kontext, `${ids.length} Zeilen`)
    return Promise.resolve('fehler')
  }
  const schluessel = ids.map((id) => `${tabelle}:${id}`)
  for (const s of schluessel) {
    geloescht.add(s)
    ausstehend.delete(s) // Eine noch nicht gespeicherte Änderung einer gelöschten Zeile ist hinfällig.
  }
  const vorherige = schluessel.map((s) => ketten.get(s)).filter((k): k is Promise<Ausgang> => !!k)
  laufend++
  const kette: Promise<Ausgang> = Promise.all(vorherige)
    .then(async (): Promise<Ausgang> => {
      try {
        const { error } = await client.from(tabelle).delete().in('id', ids)
        if (!error) return 'ok'
        return ausgangBeiFehler(tabelle, `${kontext} löschen`, error)
      } catch (err) {
        console.error(`[crmSync] ${kontext} löschen:`, err)
        return istNetzFehler(err) ? 'nachholen' : 'fehler'
      }
    })
    .then((ausgang) => {
      const offen = offeneLoeschungen.get(tabelle)
      if (ausgang === 'nachholen') {
        const eintrag = offen ?? { client, tabelle, ids: new Set<string>(), kontext }
        for (const id of ids) eintrag.ids.add(id)
        offeneLoeschungen.set(tabelle, eintrag)
        starteNachholen()
        return ausgang
      }
      // Abgelehnt: Die Zeile steht weiter in der Datenbank — spätere Änderungen an ihr nicht still verwerfen.
      if (ausgang === 'fehler') for (const s of schluessel) geloescht.delete(s)
      if (offen) {
        for (const id of ids) offen.ids.delete(id)
        if (offen.ids.size === 0) offeneLoeschungen.delete(tabelle)
      }
      return ausgang
    })
    .finally(() => {
      laufend--
      for (const s of schluessel) if (ketten.get(s) === kette) ketten.delete(s)
    })
  for (const s of schluessel) ketten.set(s, kette)
  return kette
}

/** Holt alle am Netz gescheiterten Schreib- und Löschvorgänge nach. */
export function holeNach(): Promise<Ausgang[]> {
  const laeufe: Promise<Ausgang>[] = []
  for (const [schluessel, offen] of ausstehend) {
    if (ketten.has(schluessel)) continue // läuft ohnehin gerade
    laeufe.push(plane<unknown, unknown>(schluessel, offen.vorher, offen.nachher, offen.schreibe))
  }
  for (const [tabelle, offen] of [...offeneLoeschungen]) {
    offeneLoeschungen.delete(tabelle)
    const ids = [...offen.ids]
    for (const s of ids) geloescht.delete(`${tabelle}:${s}`) // erlaubt den erneuten Durchlauf durch loescheZeilen
    for (let i = 0; i < ids.length; i += HOECHSTENS_LOESCHEN) laeufe.push(loescheZeilen(offen.client, tabelle, ids.slice(i, i + HOECHSTENS_LOESCHEN), offen.kontext))
  }
  if (ausstehend.size === 0 && offeneLoeschungen.size === 0 && laeufe.length === 0 && zeitgeber) {
    clearInterval(zeitgeber)
    zeitgeber = null
  }
  return Promise.all(laeufe)
}

function starteNachholen(): void {
  if (zeitgeber || typeof window === 'undefined') return
  zeitgeber = setInterval(() => void holeNach(), 30_000)
}

if (typeof window !== 'undefined') window.addEventListener('online', () => void holeNach())
// Noch nicht gespeicherte Änderungen (z. B. offline): vor dem Schließen/Neuladen der Seite warnen.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (ev) => {
    if (anzahlAusstehend() === 0) return
    ev.preventDefault()
    ev.returnValue = ''
  })
}

/** Wartet (höchstens `ms`), bis die laufenden Schreibvorgänge fertig sind — vor dem Neuladen des Stands. */
export async function warteAufSchreibvorgaenge(ms: number): Promise<void> {
  if (ketten.size === 0) return
  let uhr: ReturnType<typeof setTimeout> | undefined
  await Promise.race([Promise.all([...ketten.values()]), new Promise<void>((r) => (uhr = setTimeout(r, ms)))])
  if (uhr !== undefined) clearTimeout(uhr)
}

/** Nur für Tests: alles vergessen. */
export function _zuruecksetzen(): void {
  inDatenbank.clear()
  ketten.clear()
  ausstehend.clear()
  geloescht.clear()
  offeneLoeschungen.clear()
  laufend = 0
}
