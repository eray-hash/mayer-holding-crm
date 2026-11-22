// Gerätespeicher für Spickzettel und Leitfaden (IndexedDB „mayer-gespraech-hilfe“, getrennt von den
// Aufnahmen in speicher.ts, damit dort keine Versionsänderung nötig ist). Einfache Ablage Schlüssel → Wert:
//   spick|kunde:<id> / spick|objekt:<id> / spick|termin:<id>   Briefing der Akte (für den Einsatz ohne Netz)
//   leitfaeden                                                aufbereitete Fragebögen aus den Vorlagen
//   fortschritt|<lokalId>                                     gewählter Leitfaden, abgehakte Fragen, Notizen
// Fehlt IndexedDB (privates Fenster), gilt ein Zwischenspeicher bis zum Schließen.

const DB_NAME = 'mayer-gespraech-hilfe'
const ABLAGE = 'kv'

type Eintrag<T> = { wert: T; am: number }

const ersatz = new Map<string, Eintrag<unknown>>()
let dbVersprechen: Promise<IDBDatabase | null> | null = null

function oeffne(): Promise<IDBDatabase | null> {
  if (dbVersprechen) return dbVersprechen
  dbVersprechen = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const anfrage = indexedDB.open(DB_NAME, 1)
      anfrage.onupgradeneeded = () => {
        if (!anfrage.result.objectStoreNames.contains(ABLAGE)) anfrage.result.createObjectStore(ABLAGE)
      }
      anfrage.onsuccess = () => {
        const db = anfrage.result
        db.onversionchange = () => {
          db.close()
          dbVersprechen = null
        }
        resolve(db)
      }
      anfrage.onerror = () => resolve(null)
      anfrage.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbVersprechen
}

export async function lies<T>(schluessel: string): Promise<Eintrag<T> | null> {
  const db = await oeffne()
  if (!db) return (ersatz.get(schluessel) as Eintrag<T> | undefined) ?? null
  return await new Promise((resolve) => {
    try {
      const a = db.transaction(ABLAGE).objectStore(ABLAGE).get(schluessel)
      a.onsuccess = () => resolve((a.result as Eintrag<T> | undefined) ?? null)
      a.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function schreibe<T>(schluessel: string, wert: T): Promise<void> {
  const eintrag: Eintrag<T> = { wert, am: Date.now() }
  const db = await oeffne()
  if (!db) {
    ersatz.set(schluessel, eintrag)
    return
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(ABLAGE, 'readwrite')
      tx.objectStore(ABLAGE).put(eintrag, schluessel)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      ersatz.set(schluessel, eintrag)
      resolve()
    }
  })
}

/** Entfernt Einträge, die länger als `tage` nicht geschrieben wurden (Spickzettel, Fortschritt alter Aufnahmen). */
export async function raeumeAuf(tage = 30): Promise<void> {
  const grenze = Date.now() - tage * 86_400_000
  const db = await oeffne()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(ABLAGE, 'readwrite')
      const zeiger = tx.objectStore(ABLAGE).openCursor()
      zeiger.onsuccess = () => {
        const z = zeiger.result
        if (!z) return
        const e = z.value as Eintrag<unknown> | undefined
        if (!e || typeof e.am !== 'number' || e.am < grenze) z.delete()
        z.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}
