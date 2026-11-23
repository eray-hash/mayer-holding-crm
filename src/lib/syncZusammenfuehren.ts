// Reine Hilfen zum Zusammenführen von Listen und Feldern beim Speichern (ohne Abhängigkeiten, damit sie mit
// `deno test` prüfbar sind). Benutzt von crmSync.ts (Kundenakten, Objekte) und zeilenSchreiben.ts (alle übrigen
// Tabellen). Grundsatz: Ein Fenster schreibt nur, was es selbst geändert hat — alles andere bleibt so, wie es
// in der Datenbank steht (Telegram-Assistent, Zeitplan, Kollegen in einem anderen Fenster).

export type ListenEintrag = { id: string }

export function gleich(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** Eine Liste von Einträgen mit Kennung (fehlend = leer); alles andere: null (dann wird nicht zusammengeführt). */
export function alsListe(wert: unknown): ListenEintrag[] | null {
  if (wert == null) return []
  if (!Array.isArray(wert)) return null
  return wert.every((x) => x && typeof x === 'object' && typeof (x as ListenEintrag).id === 'string') ? (wert as ListenEintrag[]) : null
}

export function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return !!wert && typeof wert === 'object' && !Array.isArray(wert)
}

/**
 * Führt eine Liste zusammen: `vorher` und `nachher` sind der Stand dieses Fensters vor und nach der
 * Änderung, `server` ist der aktuelle Stand der Datenbank. Gibt die zu schreibende Liste zurück und
 * was der Server zusätzlich wusste (damit das Fenster es gleich mit anzeigt).
 * (Für Kundenakten und Objekte — unverändert aus crmSync.ts hierher verschoben.)
 */
export function fuehreListeZusammen(
  vorher: ListenEintrag[],
  nachher: ListenEintrag[],
  server: ListenEintrag[],
): { liste: ListenEintrag[]; neu: ListenEintrag[]; weg: string[]; frisch: ListenEintrag[] } {
  const vorherNachId = new Map(vorher.map((x) => [x.id, x]))
  const serverNachId = new Map(server.map((x) => [x.id, x]))
  const nachherIds = new Set(nachher.map((x) => x.id))
  // Was andere inzwischen dazugelegt haben: steht in der Datenbank, war diesem Fenster nie bekannt.
  const neu = server.filter((x) => !vorherNachId.has(x.id) && !nachherIds.has(x.id))
  const weg: string[] = []
  const frisch: ListenEintrag[] = []
  const liste: ListenEintrag[] = []
  let fremdeEingefuegt = false
  for (const eintrag of nachher) {
    const alt = vorherNachId.get(eintrag.id)
    if (!alt) {
      liste.push(eintrag) // in diesem Fenster neu angelegt
      continue
    }
    // Fremde neue Einträge kommen vor den ersten schon bekannten Eintrag (neueste stehen oben).
    if (!fremdeEingefuegt) {
      liste.push(...neu)
      fremdeEingefuegt = true
    }
    if (!gleich(alt, eintrag)) {
      liste.push(eintrag) // in diesem Fenster geändert
      continue
    }
    const aktuell = serverNachId.get(eintrag.id)
    if (!aktuell) {
      weg.push(eintrag.id) // hier unverändert, in der Datenbank inzwischen gelöscht
      continue
    }
    if (!gleich(aktuell, eintrag)) frisch.push(aktuell) // hier unverändert, in der Datenbank ergänzt
    liste.push(aktuell)
  }
  if (!fremdeEingefuegt) liste.push(...neu)
  return { liste, neu, weg, frisch }
}

/** Trägt in eine Liste des Fensters nach, was die Datenbank zusätzlich wusste. */
export function wendeServerStandAn<T extends ListenEintrag>(liste: T[] | undefined, stand: { neu: ListenEintrag[]; weg: string[]; frisch: ListenEintrag[] }): T[] {
  const weg = new Set(stand.weg)
  const frisch = new Map(stand.frisch.map((x) => [x.id, x]))
  const vorhanden = new Set((liste ?? []).map((x) => x.id))
  const fremde = stand.neu.filter((x) => !vorhanden.has(x.id)) as T[]
  const rest = (liste ?? []).filter((x) => !weg.has(x.id)).map((x) => (frisch.get(x.id) as T | undefined) ?? x)
  return [...fremde, ...rest]
}

/**
 * Dreiwege-Zusammenführung einer Liste für die übrigen Tabellen (Projekt-Meilensteine mit ihren Aufgaben,
 * Zeilen eines Tagesplans, Zahlungen einer Rechnung, …):
 * - eigene neue, geänderte und gelöschte Einträge gelten;
 * - bei einem hier geänderten Eintrag, den es in der Datenbank noch gibt, gelten nur die hier geänderten Felder
 *   des Eintrags — Listen darin (z. B. Aufgaben eines Meilensteins) werden ebenso zusammengeführt;
 * - hier unveränderte Einträge kommen in der Fassung der Datenbank (dort gelöscht = weg);
 * - Einträge, die andere inzwischen angelegt haben, bleiben — an ihrer Stelle aus der Datenbank (hinter ihrem
 *   dortigen Vorgänger), damit z. B. die Block-Reihenfolge eines Tagesplans erhalten bleibt.
 */
export function dreiWegeListe(vorher: ListenEintrag[], nachher: ListenEintrag[], server: ListenEintrag[]): ListenEintrag[] {
  const vorherNachId = new Map(vorher.map((x) => [x.id, x]))
  const serverNachId = new Map(server.map((x) => [x.id, x]))
  const nachherIds = new Set(nachher.map((x) => x.id))
  const ergebnis: ListenEintrag[] = []
  for (const eintrag of nachher) {
    const alt = vorherNachId.get(eintrag.id)
    const aktuell = serverNachId.get(eintrag.id)
    if (!alt) {
      ergebnis.push(eintrag) // hier neu angelegt
    } else if (!gleich(alt, eintrag)) {
      // hier geändert: nur die eigenen Felder, sonst der Stand der Datenbank (dort gelöscht: eigene Fassung)
      ergebnis.push(aktuell && istObjekt(aktuell) ? (dreiWegeObjekt(alt as unknown as Record<string, unknown>, eintrag as unknown as Record<string, unknown>, aktuell as unknown as Record<string, unknown>) as unknown as ListenEintrag) : eintrag)
    } else if (aktuell) {
      ergebnis.push(aktuell) // hier unverändert: Fassung der Datenbank
    }
  }
  const fremdIds = new Set(server.filter((x) => !vorherNachId.has(x.id) && !nachherIds.has(x.id)).map((x) => x.id))
  if (fremdIds.size === 0) return ergebnis
  let vorgaenger: string | null = null
  for (const x of server) {
    if (fremdIds.has(x.id)) {
      const i = vorgaenger === null ? -1 : ergebnis.findIndex((e) => e.id === vorgaenger)
      ergebnis.splice(i + 1, 0, x)
      vorgaenger = x.id
    } else if (ergebnis.some((e) => e.id === x.id)) {
      vorgaenger = x.id
    }
  }
  return ergebnis
}

/**
 * Dreiwege-Zusammenführung eines Objekts (eine Ebene): Felder, die dieses Fenster geändert hat, gelten (Listen
 * mit Kennungen darin werden mit dreiWegeListe zusammengeführt); alle übrigen Felder kommen aus der Datenbank.
 * Verschachtelte Objekte werden als Ganzes übernommen, nie gemischt (sonst entstünden Mischformen, z. B. aus
 * zwei verschiedenen Belegen).
 */
export function dreiWegeObjekt(vorher: Record<string, unknown> | undefined, nachher: Record<string, unknown>, server: Record<string, unknown>): Record<string, unknown> {
  const a = vorher ?? {}
  const ergebnis: Record<string, unknown> = { ...server }
  for (const k of new Set([...Object.keys(a), ...Object.keys(nachher)])) {
    if (gleich(a[k], nachher[k])) continue // hier unverändert: Stand der Datenbank gilt
    if (nachher[k] === undefined) {
      delete ergebnis[k] // hier entfernt
      continue
    }
    const la = alsListe(a[k])
    const lb = Array.isArray(nachher[k]) ? alsListe(nachher[k]) : null
    const lc = alsListe(server[k])
    ergebnis[k] = la && lb && lc ? dreiWegeListe(la, lb, lc) : nachher[k]
  }
  return ergebnis
}
