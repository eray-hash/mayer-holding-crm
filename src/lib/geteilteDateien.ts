// Was über „Teilen → Mayer CRM" (Android) hereinkam: Der Service-Worker (public/teilen-sw.js) legt
// Dateien, Titel, Text und Internetadresse im Zwischenspeicher „mayer-geteilt" ab und öffnet
// #/ablegen. Hier wird das gelesen und nach dem Ablegen wieder entfernt. Muss zu teilen-sw.js passen
// (Name des Zwischenspeichers, Schlüssel „__geteilt/liste", Aufbau der Einträge).

const TEILEN_CACHE = 'mayer-geteilt'

type GespeicherterEintrag = {
  stapel: string
  am: string
  titel?: string
  text?: string
  adresse?: string
  dateien: { schluessel: string; name: string; typ: string; groesse: number }[]
}

export type GeteilteDatei = { schluessel: string; datei: File }
export type GeteilterStapel = { stapel: string; am: string; titel: string; text: string; adresse: string; dateien: GeteilteDatei[] }

function listenSchluessel(): string {
  // Gleicher Schlüssel wie im Service-Worker: relativ zu dessen Scope = Verzeichnis der index.html.
  return new URL('__geteilt/liste', new URL('./', window.location.href)).href
}

const zwischenspeicherDa = () => typeof window !== 'undefined' && 'caches' in window

async function leseListe(cache: Cache): Promise<GespeicherterEintrag[]> {
  const antwort = await cache.match(listenSchluessel())
  if (!antwort) return []
  try {
    const liste = await antwort.json()
    return Array.isArray(liste) ? (liste as GespeicherterEintrag[]) : []
  } catch {
    return []
  }
}

/** Alles, was geteilt und noch nicht abgelegt wurde — älteste zuerst. */
export async function ladeGeteilte(): Promise<GeteilterStapel[]> {
  if (!zwischenspeicherDa()) return []
  const cache = await caches.open(TEILEN_CACHE)
  const liste = await leseListe(cache)
  const ergebnis: GeteilterStapel[] = []
  for (const e of liste) {
    const dateien: GeteilteDatei[] = []
    for (const d of e.dateien ?? []) {
      const antwort = await cache.match(d.schluessel)
      if (!antwort) continue
      const blob = await antwort.blob()
      dateien.push({ schluessel: d.schluessel, datei: new File([blob], d.name, { type: d.typ || blob.type }) })
    }
    ergebnis.push({ stapel: e.stapel, am: e.am, titel: e.titel ?? '', text: e.text ?? '', adresse: e.adresse ?? '', dateien })
  }
  return ergebnis
}

/** Entfernt abgelegte Dateien aus dem Zwischenspeicher; leere Einträge (ohne Datei und Text) verschwinden mit. */
export async function entferneGeteilteDateien(schluessel: string[]): Promise<void> {
  if (!zwischenspeicherDa() || schluessel.length === 0) return
  const cache = await caches.open(TEILEN_CACHE)
  const weg = new Set(schluessel)
  for (const s of weg) await cache.delete(s)
  const liste = (await leseListe(cache))
    .map((e) => ({ ...e, dateien: (e.dateien ?? []).filter((d) => !weg.has(d.schluessel)) }))
    .filter((e) => e.dateien.length > 0 || (e.text ?? '').trim() || (e.adresse ?? '').trim() || (e.titel ?? '').trim())
  await cache.put(listenSchluessel(), new Response(JSON.stringify(liste), { headers: { 'Content-Type': 'application/json' } }))
}

/** Entfernt Titel/Text/Adresse der Stapel (nachdem die Notiz in den Verlauf geschrieben oder verworfen wurde). */
export async function entferneGeteilteTexte(stapel: string[]): Promise<void> {
  if (!zwischenspeicherDa() || stapel.length === 0) return
  const cache = await caches.open(TEILEN_CACHE)
  const weg = new Set(stapel)
  const liste = (await leseListe(cache))
    .map((e) => (weg.has(e.stapel) ? { ...e, titel: '', text: '', adresse: '' } : e))
    .filter((e) => (e.dateien ?? []).length > 0 || (e.text ?? '').trim() || (e.adresse ?? '').trim() || (e.titel ?? '').trim())
  await cache.put(listenSchluessel(), new Response(JSON.stringify(liste), { headers: { 'Content-Type': 'application/json' } }))
}

/** Text aus Titel, Text und Adresse eines geteilten Stapels (doppelte Teile nur einmal). */
export function notizAusStapel(s: Pick<GeteilterStapel, 'titel' | 'text' | 'adresse'>): string {
  const teile: string[] = []
  for (const t of [s.titel, s.text, s.adresse]) {
    const sauber = t.trim()
    if (sauber && !teile.some((x) => x.includes(sauber))) teile.push(sauber)
  }
  return teile.join('\n')
}

/** Dateiname für den Speicherpfad: keine Zeichen, die der Server in Pfaden ablehnt (siehe _shared/speicherPfad.ts). */
export function sichererDateiname(name: string): string {
  // eslint-disable-next-line no-control-regex
  const sauber = name.replace(/[/\\?#%\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '').trim()
  return sauber || 'Datei'
}
