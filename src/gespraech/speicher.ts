// Gerätespeicher der Gesprächs-App (IndexedDB „mayer-gespraech“). Hier liegt jede Aufnahme, bis der Server
// sie vollständig hat — ein geschlossenes Fenster, ein leerer Akku oder ein Funkloch verlieren also nichts.
//   aufnahmen: LokaleAufnahme je lokalId (Stand der Warteschlange, siehe warteschlange.ts)
//   daten:     Ton und Fotos als ArrayBuffer (Safari speichert Blobs in IndexedDB nicht überall zuverlässig)
//              <lokalId>|teil|<nr>|<lfd>   Teilstücke eines Abschnitts während der Aufnahme (alle 5 s eins)
//              <lokalId>|seg|<nr>          fertig zusammengesetzter Abschnitt
//              <lokalId>|foto|<n>          Foto
// Änderungen an einer Aufnahme laufen über aktualisiere(): Lesen und Schreiben in EINER Transaktion,
// damit Aufnahme-Seite und Hochladen sich nicht gegenseitig Felder überschreiben.

import type { LokaleAufnahme } from './warteschlange.ts'

const DB_NAME = 'mayer-gespraech'
const VERSION = 1
const AUFNAHMEN = 'aufnahmen'
const DATEN = 'daten'

type Gespeichert = { buf: ArrayBuffer; mime: string }

let dbVersprechen: Promise<IDBDatabase> | null = null

function oeffne(): Promise<IDBDatabase> {
  if (dbVersprechen) return dbVersprechen
  dbVersprechen = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Dieser Browser kann keine Aufnahmen auf dem Gerät speichern.'))
      return
    }
    const anfrage = indexedDB.open(DB_NAME, VERSION)
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result
      if (!db.objectStoreNames.contains(AUFNAHMEN)) db.createObjectStore(AUFNAHMEN, { keyPath: 'lokalId' })
      if (!db.objectStoreNames.contains(DATEN)) db.createObjectStore(DATEN)
    }
    anfrage.onsuccess = () => {
      const db = anfrage.result
      // Wird die Datenbank von einer neueren Version der App geöffnet, diese Verbindung freigeben.
      db.onversionchange = () => {
        db.close()
        dbVersprechen = null
      }
      resolve(db)
    }
    anfrage.onerror = () => reject(anfrage.error ?? new Error('Gerätespeicher ließ sich nicht öffnen.'))
    anfrage.onblocked = () => reject(new Error('Gerätespeicher ist durch ein anderes Fenster blockiert.'))
  }).catch((err) => {
    dbVersprechen = null
    throw err
  })
  return dbVersprechen
}

function warte<T>(anfrage: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    anfrage.onsuccess = () => resolve(anfrage.result)
    anfrage.onerror = () => reject(anfrage.error)
  })
}

function fertig(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Speichern auf dem Gerät fehlgeschlagen.'))
    tx.onabort = () => reject(tx.error ?? new Error('Speichern auf dem Gerät abgebrochen (Speicher voll?).'))
  })
}

// ---------------------------------------------------------------------------------------------
// Aufnahmen

export async function alleAufnahmen(): Promise<LokaleAufnahme[]> {
  const db = await oeffne()
  const liste = (await warte(db.transaction(AUFNAHMEN).objectStore(AUFNAHMEN).getAll())) as LokaleAufnahme[]
  return liste.sort((a, b) => b.erstelltAm.localeCompare(a.erstelltAm))
}

export async function ladeAufnahme(lokalId: string): Promise<LokaleAufnahme | null> {
  const db = await oeffne()
  return ((await warte(db.transaction(AUFNAHMEN).objectStore(AUFNAHMEN).get(lokalId))) as LokaleAufnahme | undefined) ?? null
}

export async function speichereAufnahme(a: LokaleAufnahme): Promise<void> {
  const db = await oeffne()
  const tx = db.transaction(AUFNAHMEN, 'readwrite')
  tx.objectStore(AUFNAHMEN).put(a)
  await fertig(tx)
  melde()
}

/** Liest, ändert und schreibt eine Aufnahme in einer Transaktion. `aendern` muss synchron sein. */
export async function aktualisiere(lokalId: string, aendern: (a: LokaleAufnahme) => LokaleAufnahme): Promise<LokaleAufnahme | null> {
  const db = await oeffne()
  const tx = db.transaction(AUFNAHMEN, 'readwrite')
  const store = tx.objectStore(AUFNAHMEN)
  let neu: LokaleAufnahme | null = null
  const anfrage = store.get(lokalId)
  anfrage.onsuccess = () => {
    const alt = anfrage.result as LokaleAufnahme | undefined
    if (!alt) return
    neu = aendern(alt)
    store.put(neu)
  }
  await fertig(tx)
  melde()
  return neu
}

/** Entfernt eine Aufnahme mit allen Ton- und Fotodaten vom Gerät. */
export async function loescheAufnahme(lokalId: string): Promise<void> {
  const db = await oeffne()
  const tx = db.transaction([AUFNAHMEN, DATEN], 'readwrite')
  tx.objectStore(AUFNAHMEN).delete(lokalId)
  tx.objectStore(DATEN).delete(praefix(`${lokalId}|`))
  await fertig(tx)
  melde()
}

/** Ton und Fotos einer Aufnahme löschen, den Eintrag (für die Anzeige) behalten. */
export async function loescheDaten(lokalId: string): Promise<void> {
  const db = await oeffne()
  const tx = db.transaction(DATEN, 'readwrite')
  tx.objectStore(DATEN).delete(praefix(`${lokalId}|`))
  await fertig(tx)
}

// ---------------------------------------------------------------------------------------------
// Ton und Fotos

function praefix(p: string): IDBKeyRange {
  return IDBKeyRange.bound(p, `${p}￿`)
}

const teilSchluessel = (lokalId: string, nr: number, lfd: number) => `${lokalId}|teil|${nr}|${String(lfd).padStart(6, '0')}`
const segSchluessel = (lokalId: string, nr: number) => `${lokalId}|seg|${nr}`
const fotoSchluessel = (lokalId: string, n: number) => `${lokalId}|foto|${n}`

async function legeAb(schluessel: string, blob: Blob): Promise<void> {
  const buf = await blob.arrayBuffer()
  const db = await oeffne()
  const tx = db.transaction(DATEN, 'readwrite')
  tx.objectStore(DATEN).put({ buf, mime: blob.type } satisfies Gespeichert, schluessel)
  await fertig(tx)
}

async function hole(schluessel: string): Promise<Blob | null> {
  const db = await oeffne()
  const g = (await warte(db.transaction(DATEN).objectStore(DATEN).get(schluessel))) as Gespeichert | undefined
  return g ? new Blob([g.buf], { type: g.mime }) : null
}

/** Ein Teilstück (etwa 5 s) eines laufenden Abschnitts sofort sichern. */
export async function speichereTeil(lokalId: string, nr: number, lfd: number, blob: Blob): Promise<void> {
  await legeAb(teilSchluessel(lokalId, nr, lfd), blob)
}

/** Wie viele Teilstücke eines Abschnitts liegen vor? */
export async function zaehleTeile(lokalId: string, nr: number): Promise<number> {
  const db = await oeffne()
  return await warte(db.transaction(DATEN).objectStore(DATEN).count(praefix(`${lokalId}|teil|${nr}|`)))
}

/**
 * Setzt die Teilstücke eines Abschnitts zu einer Datei zusammen (ein MediaRecorder-Lauf ergibt
 * aneinandergehängt eine gültige Datei), legt sie als Abschnitt ab und löscht die Teile. Liefert die Größe
 * in Bytes und die Zahl der Teile; 0/0, wenn keine Teile da waren.
 */
export async function fasseSegmentZusammen(lokalId: string, nr: number, mime: string): Promise<{ bytes: number; teile: number }> {
  const db = await oeffne()
  const bereich = praefix(`${lokalId}|teil|${nr}|`)
  const teile = (await warte(db.transaction(DATEN).objectStore(DATEN).getAll(bereich))) as Gespeichert[]
  if (teile.length === 0) {
    // Vielleicht schon zusammengesetzt (zweiter Aufruf nach einem Absturz mittendrin)
    const schon = await hole(segSchluessel(lokalId, nr))
    return { bytes: schon?.size ?? 0, teile: 0 }
  }
  const blob = new Blob(teile.map((t) => t.buf), { type: mime || teile[0].mime })
  const buf = await blob.arrayBuffer()
  const tx = db.transaction(DATEN, 'readwrite')
  const store = tx.objectStore(DATEN)
  store.put({ buf, mime: blob.type } satisfies Gespeichert, segSchluessel(lokalId, nr))
  store.delete(bereich)
  await fertig(tx)
  return { bytes: blob.size, teile: teile.length }
}

export async function holeSegment(lokalId: string, nr: number): Promise<Blob | null> {
  return await hole(segSchluessel(lokalId, nr))
}

export async function loescheSegment(lokalId: string, nr: number): Promise<void> {
  const db = await oeffne()
  const tx = db.transaction(DATEN, 'readwrite')
  tx.objectStore(DATEN).delete(segSchluessel(lokalId, nr))
  await fertig(tx)
}

export async function speichereFoto(lokalId: string, n: number, blob: Blob): Promise<void> {
  await legeAb(fotoSchluessel(lokalId, n), blob)
}

export async function holeFoto(lokalId: string, n: number): Promise<Blob | null> {
  return await hole(fotoSchluessel(lokalId, n))
}

export async function loescheFoto(lokalId: string, n: number): Promise<void> {
  const db = await oeffne()
  const tx = db.transaction(DATEN, 'readwrite')
  tx.objectStore(DATEN).delete(fotoSchluessel(lokalId, n))
  await fertig(tx)
}

/** Bittet den Browser, den Speicher dieser App nicht von selbst zu räumen (vor allem Android/Chrome). */
export async function bitteUmDauerhaftenSpeicher(): Promise<void> {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist?.()
  } catch {
    // Nicht jeder Browser kennt das — Aufnahmen landen trotzdem im Gerätespeicher.
  }
}

// ---------------------------------------------------------------------------------------------
// Benachrichtigung der Anzeige (gleiches Fenster)

const zuhoerer = new Set<() => void>()

export function beiAenderung(f: () => void): () => void {
  zuhoerer.add(f)
  return () => zuhoerer.delete(f)
}

export function melde(): void {
  for (const f of zuhoerer) {
    try {
      f()
    } catch {
      // Anzeige-Fehler dürfen das Speichern nicht stören.
    }
  }
}
