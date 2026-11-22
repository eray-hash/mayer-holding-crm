// Online-Unterschrift (22.11.2026): gemeinsamer Kern für das CRM (src/components/UnterschriftAnfordern.tsx,
// src/pages/formulare/PublicUnterschrift.tsx) und den Server (email-gateway/unterschrift.ts).
//
// Ablauf: Ein Mitarbeiter füllt eine Vorlage aus (VorlageAusfuellenModal) und schickt sie zum Unterschreiben.
// Gespeichert wird ein Schnappschuss des Texts genau so, wie er ihn vorbereitet hat: alle seine Angaben
// eingesetzt, Kästchen gesetzt (☒/☐), die Auszeichnungen der Vorlage (# Titel, ## Abschnitt, | Tabelle,
// || Spalten, **fett**) bleiben erhalten. Nur die Felder, die der Kunde selbst ausfüllen soll, bleiben als
// {{Feldname}} stehen. Leere Felder, die niemand ausfüllt, werden zur Linie (wie im gedruckten PDF).
//
// Reine Funktionen ohne Datenbank und ohne Deno-/Browser-Besonderheiten (crypto.subtle gibt es in beiden).

/** So lange gilt ein Link zum Unterschreiben. */
export const UNTERSCHRIFT_GUELTIG_TAGE = 30
/** 32 Zufallsbytes base64url (43 Zeichen) oder länger. */
export const UNTERSCHRIFT_TOKEN = /^[A-Za-z0-9_-]{43,128}$/
/** Wie LEERES_FELD in src/lib/vorlagenFuellen.ts. */
export const LEERE_LINIE = '____________________'
/** Höchstlänge einer Angabe des Kunden. */
export const MAX_FELD_LAENGE = 300

export type UnterschriftStatus = 'offen' | 'unterschrieben' | 'abgelehnt' | 'abgelaufen' | 'zurueckgezogen'

export const STATUS_TEXT: Record<UnterschriftStatus, string> = {
  offen: 'Wartet auf Unterschrift',
  unterschrieben: 'Unterschrieben',
  abgelehnt: 'Vom Kunden abgelehnt',
  abgelaufen: 'Link abgelaufen',
  zurueckgezogen: 'Zurückgezogen',
}

/** Ein Feld, das der Kunde auf der Seite selbst ausfüllt. */
export type KundenFeld = { name: string; pflicht: boolean }

const FELD = /\{\{\s*([^{}]+?)\s*\}\}/g
const feldName = (roh: string) => roh.split('=')[0].trim()

/** 32 Zufallsbytes, base64url ohne Auffüllzeichen. */
export function neuesUnterschriftToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Macht einen eingesetzten Wert unschädlich für die Auszeichnung: keine geschweiften Klammern (sonst entstünde
 * ein neues Feld), kein ** (fett), keine Tabellentrenner, keine Zeilenumbrüche (eine Zeile könnte sonst mit
 * „#“ zur Überschrift werden). Höchstens MAX_FELD_LAENGE Zeichen.
 */
export function wertSauber(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
    .replace(/\r?\n+/g, ', ')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\*\*/g, '')
    .replace(/ \|\| | \| /g, ' / ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FELD_LAENGE)
}

/**
 * Schnappschuss für die Anfrage: Werte des Mitarbeiters eingesetzt, Kästchen nach `angekreuzt` (Nummer in
 * Reihenfolge des Auftretens, wie in vorlagenFuellen.ts), die Felder in `kundenFelder` bleiben als {{Name}}.
 */
export function schnappschuss(text: string, werte: Record<string, string>, angekreuzt: Iterable<number>, kundenFelder: string[]): string {
  const an = new Set(angekreuzt)
  const kunde = new Set(kundenFelder)
  let nr = 0
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[☐☒]/g, () => (an.has(nr++) ? '☒' : '☐'))
    .replace(FELD, (_m, roh: string) => {
      const name = feldName(roh)
      if (kunde.has(name)) return `{{${name}}}`
      return wertSauber(werte[name]) || LEERE_LINIE
    })
}

/** Namen der Felder, die im Schnappschuss noch offen sind (in Reihenfolge, jeder einmal). */
export function offeneFelderIn(text: string): string[] {
  const namen: string[] = []
  for (const m of text.matchAll(FELD)) {
    const n = feldName(m[1])
    if (!namen.includes(n)) namen.push(n)
  }
  return namen
}

/** Setzt die Angaben des Kunden ein; was fehlt, wird zur Linie. Ergebnis: der endgültige Text. */
export function setzeKundenwerte(text: string, werte: Record<string, unknown>): string {
  return text.replace(FELD, (_m, roh: string) => wertSauber(werte[feldName(roh)]) || LEERE_LINIE)
}

/** Prüft die Angaben des Kunden gegen die Feldliste. Fehlertext oder die bereinigten Werte (nur bekannte Felder). */
export function pruefeKundenwerte(felder: KundenFeld[], eingabe: unknown): { werte: Record<string, string> } | { fehler: string } {
  const roh = eingabe && typeof eingabe === 'object' && !Array.isArray(eingabe) ? (eingabe as Record<string, unknown>) : {}
  const werte: Record<string, string> = {}
  const fehlt: string[] = []
  for (const f of felder) {
    const w = wertSauber(roh[f.name])
    if (w) werte[f.name] = w
    else if (f.pflicht) fehlt.push(f.name)
  }
  if (fehlt.length) return { fehler: `Bitte füllen Sie noch aus: ${fehlt.join(', ')}.` }
  return { werte }
}

/** Feldliste aus der Datenbank (jsonb) lesen; Unbrauchbares fällt weg. */
export function kundenFelderAus(roh: unknown): KundenFeld[] {
  if (!Array.isArray(roh)) return []
  const aus: KundenFeld[] = []
  for (const x of roh) {
    const name = typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as { name?: unknown }).name ?? '') : ''
    const n = name.trim()
    if (!n || aus.some((a) => a.name === n)) continue
    aus.push({ name: n, pflicht: typeof x === 'object' ? (x as { pflicht?: unknown }).pflicht !== false : true })
  }
  return aus
}

// ---------- Zerlegung für das PDF auf dem Server ----------

export type Lauf = { text: string; fett: boolean }
export type Block =
  | { art: 'titel'; laeufe: Lauf[] }
  | { art: 'ueberschrift'; laeufe: Lauf[] }
  | { art: 'zeile'; laeufe: Lauf[]; einzug: number }
  | { art: 'leer' }
  | { art: 'tabelle'; zeilen: Lauf[][][]; rahmenlos: boolean }

function laeufe(text: string): Lauf[] {
  // Kästchen als Text, damit die Standardschrift sie setzen kann.
  const t = text.replace(/☒/g, '[X]').replace(/☐/g, '[  ]')
  return t
    .split('**')
    .map((stueck, i) => ({ text: stueck, fett: i % 2 === 1 }))
    .filter((l) => l.text !== '')
}

/** Zerlegt den (fertig eingesetzten) Text wie zerlegeVorlage im CRM. */
export function zerlegeText(text: string): Block[] {
  const bloecke: Block[] = []
  for (const roh of text.replace(/\r\n/g, '\n').split('\n')) {
    const zeile = roh.trimEnd()
    if (!zeile.trim()) bloecke.push({ art: 'leer' })
    else if (zeile.startsWith('## ')) bloecke.push({ art: 'ueberschrift', laeufe: laeufe(zeile.slice(3)) })
    else if (zeile.startsWith('# ')) bloecke.push({ art: 'titel', laeufe: laeufe(zeile.slice(2)) })
    else if (zeile.includes(' || ') || zeile.includes(' | ')) {
      const rahmenlos = zeile.includes(' || ')
      const zellen = zeile.split(rahmenlos ? ' || ' : ' | ').map((z) => laeufe(z.trim()))
      const letzter = bloecke[bloecke.length - 1]
      if (letzter?.art === 'tabelle' && letzter.rahmenlos === rahmenlos) letzter.zeilen.push(zellen)
      else bloecke.push({ art: 'tabelle', zeilen: [zellen], rahmenlos })
    } else {
      bloecke.push({ art: 'zeile', laeufe: laeufe(zeile.trimStart()), einzug: zeile.length - zeile.trimStart().length })
    }
  }
  return bloecke
}

/** Text ohne Auszeichnung (für Prüfsumme und Mail). */
export function alsReinerText(text: string): string {
  return text.replace(/^##? /gm, '').replace(/ \|\| /g, '      ').replace(/\*\*/g, '')
}

/** SHA-256 des endgültigen Texts als Hex — steht im PDF, damit sich spätere Änderungen erkennen lassen. */
export async function pruefsumme(text: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Datum und Uhrzeit in deutscher Zeit, z. B. "22.11.2026, 14:05 Uhr". */
export function zeitDe(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return ''
  const s = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
  return `${s} Uhr`
}
