// Datensicherung — gemeinsamer Kern (Runde 5, 22.11.2026). Reine Hilfen ohne Datenbank und ohne Netz, genutzt von
// email-gateway/datensicherung.ts (nächtliche Sicherung) und scripts/sicherung-wiederherstellen.ts (Einspielen von
// Hand). Läuft in Deno; nur Web-Standards (CompressionStream, crypto.subtle, TextEncoder).
//
// Aufbau einer Sicherung im Speicher-Eimer `sicherungen`:
//   <name>.zip   — das Paket: manifest.json, LIESMICH.txt, tabellen/<tabelle>.ndjson.gz (je Zeile ein JSON-Objekt,
//                  gzip-gepackt), dateien.ndjson.gz (Liste der Dateien in der Ablage: Eimer, Pfad, Größe — die Dateien
//                  selbst sind NICHT enthalten).
//   <name>.json  — dasselbe Manifest noch einmal einzeln (plus Paketgröße), damit die Superuser-Seite die Zahlen
//                  ohne das ganze Paket lesen kann.
// <name> = Berliner Datum und Uhrzeit „JJJJ-MM-TT_HHMM“, z. B. 2026-11-23_0230.

import { erstelleZip, leseZip } from './zipSchreiber.ts'

export type Zeile = Record<string, unknown>

export const SICHERUNG_EIMER = 'sicherungen'
export const SICHERUNG_FORMAT = 1

/** Tabellen, die nie mitgesichert werden: Zähler, kurzlebige Anmelde-Zeichen und Warteschlangen — nichts davon
 *  braucht man nach einem Datenverlust, manches (Anmelde-Zeichen) gehört nicht in eine herunterladbare Datei. */
export const AUSGESCHLOSSEN: Record<string, string> = {
  formular_zaehler: 'Mengenzähler der öffentlichen Formulare (kurzlebig)',
  fonds_portal_sessions: 'Anmelde-Sitzungen des Investoren-Portals (kurzlebig)',
  fonds_portal_logins: 'Anmelde-Links des Investoren-Portals (kurzlebig)',
  ms_anmeldungen: 'laufende Microsoft-Anmeldungen (kurzlebig)',
  telegram_warteschlange: 'Warteschlange für Telegram-Sammelsendungen (kurzlebig)',
  // Zugangsgeheimnisse (verschlüsselt) gehören nicht in eine herunterladbare Datei; nach einem Totalverlust neu verbinden.
  ms_geheimnisse: 'Microsoft-Zugänge (verschlüsselt) — nach Verlust neu verbinden',
  postfach_geheimnisse: 'Postfach-Passwörter (verschlüsselt) — nach Verlust neu eingeben',
}

/** Große, abgeleitete Tabellen: nur die letzten N Tage (Spalte = Zeitstempel). */
export const ZEITLICH_BEGRENZT: Record<string, { spalte: string; tage: number }> = {
  ki_verbrauch: { spalte: 'am', tage: 90 },
}

/** Spalten, über die eine Zeile zu einer Akte (Tabelle kunden) gehört. */
export const AKTE_SPALTEN = ['kunde_id', 'akte_id', 'zugewiesener_kunde_id', 'verknuepft_kunde_id'] as const

export type Aufbewahrung = { taeglich: number; woechentlich: number; monatlich: number }
export const AUFBEWAHRUNG: Aufbewahrung = { taeglich: 14, woechentlich: 8, monatlich: 12 }

export type TabellenEintrag = {
  tabelle: string
  datei: string
  zeilen: number
  /** Größe der gepackten Datei im Paket. */
  bytes: number
  /** SHA-256 der gepackten Datei (hex). */
  sha256: string
  schluessel: string[]
  spalten: string[]
  /** z. B. „am ab 2026-08-25T00:30:00.000Z“ bei zeitlich begrenzten Tabellen. */
  filter?: string
}

export type Manifest = {
  format: number
  name: string
  erstellt: string
  dauerMs: number
  art: 'nacht' | 'hand' | 'probe'
  von?: string
  tabellen: TabellenEintrag[]
  ausgelassen: { tabelle: string; grund: string }[]
  dateien: { datei: string; anzahl: number; bytes: number; sha256: string; jeEimer: Record<string, { anzahl: number; bytes: number }> }
  gesamtZeilen: number
  warnungen: string[]
  /** Nur in <name>.json: Größe des Pakets. */
  paketBytes?: number
}

// ---------------------------------------------------------------------------------------------
// Namen und Aufbewahrung
// ---------------------------------------------------------------------------------------------

const BERLIN = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Name einer Sicherung aus dem Zeitpunkt (Berliner Zeit): „2026-11-23_0230“. */
export function sicherungsName(jetzt: Date): string {
  const t: Record<string, string> = {}
  for (const p of BERLIN.formatToParts(jetzt)) t[p.type] = p.value
  return `${t.year}-${t.month}-${t.day}_${String(Number(t.hour) % 24).padStart(2, '0')}${t.minute}`
}

const NAME_MUSTER = /^(\d{4})-(\d{2})-(\d{2})_(\d{4})$/

export function istSicherungsName(name: string): boolean {
  return NAME_MUSTER.test(name)
}

/** „2026-11-23_0230“ → „23.11.2026, 02:30 Uhr“. */
export function nameAlsText(name: string): string {
  const m = NAME_MUSTER.exec(name)
  return m ? `${m[3]}.${m[2]}.${m[1]}, ${m[4].slice(0, 2)}:${m[4].slice(2)} Uhr` : name
}

/** ISO-Kalenderwoche „2026-W48“ eines Datums „JJJJ-MM-TT“. */
export function isoWoche(datum: string): string {
  const [j, m, t] = datum.split('-').map(Number)
  const d = new Date(Date.UTC(j, m - 1, t))
  const wt = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - wt)
  const jahr = d.getUTCFullYear()
  const woche = Math.ceil(((d.getTime() - Date.UTC(jahr, 0, 1)) / 86400000 + 1) / 7)
  return `${jahr}-W${String(woche).padStart(2, '0')}`
}

/**
 * Welche Sicherungen bleiben: alle der letzten `taeglich` Tage (an denen gesichert wurde), dazu je Kalenderwoche die
 * älteste Sicherung der letzten `woechentlich` Wochen und je Monat die älteste der letzten `monatlich` Monate.
 * „Älteste“ statt „neueste“, damit die Wahl stabil bleibt (die erste Sicherung einer Woche bleibt die erste).
 * Namen, die nicht dem Muster folgen, werden nie gelöscht (sie gehören nicht zur Drehung).
 */
export function zuBehalten(namen: string[], regel: Aufbewahrung = AUFBEWAHRUNG): Set<string> {
  const gueltig = [...new Set(namen.filter(istSicherungsName))].sort()
  const bleibt = new Set(namen.filter((n) => !istSicherungsName(n)))
  const tage = [...new Set(gueltig.map((n) => n.slice(0, 10)))].sort().reverse().slice(0, regel.taeglich)
  for (const n of gueltig) if (tage.includes(n.slice(0, 10))) bleibt.add(n)
  const aeltesteJe = (schluessel: (n: string) => string, anzahl: number) => {
    const erste = new Map<string, string>()
    for (const n of gueltig) if (!erste.has(schluessel(n))) erste.set(schluessel(n), n)
    for (const k of [...erste.keys()].sort().reverse().slice(0, anzahl)) bleibt.add(erste.get(k)!)
  }
  aeltesteJe((n) => isoWoche(n.slice(0, 10)), regel.woechentlich)
  aeltesteJe((n) => n.slice(0, 7), regel.monatlich)
  return bleibt
}

// ---------------------------------------------------------------------------------------------
// Packen
// ---------------------------------------------------------------------------------------------

const KODIERER = new TextEncoder()

/** Schreibt Text fortlaufend in einen gzip-Strom und sammelt nur die gepackten Bytes (wenig Speicher). */
export class GzipSammler {
  private schreiber: WritableStreamDefaultWriter<BufferSource>
  private ergebnis: Promise<Uint8Array>
  constructor() {
    const strom = new CompressionStream('gzip')
    this.schreiber = strom.writable.getWriter()
    this.ergebnis = new Response(strom.readable).arrayBuffer().then((b) => new Uint8Array(b))
  }
  async schreibe(text: string): Promise<void> {
    if (text) await this.schreiber.write(KODIERER.encode(text))
  }
  async fertig(): Promise<Uint8Array> {
    await this.schreiber.close()
    return await this.ergebnis
  }
}

export async function gzip(daten: Uint8Array | string): Promise<Uint8Array> {
  const s = new GzipSammler()
  await s.schreibe(typeof daten === 'string' ? daten : new TextDecoder().decode(daten))
  return await s.fertig()
}

export async function gunzip(daten: Uint8Array): Promise<Uint8Array> {
  const strom = new Blob([daten as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(strom).arrayBuffer())
}

export async function sha256Hex(daten: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', daten as Uint8Array<ArrayBuffer>))
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** NDJSON (je Zeile ein JSON-Objekt) in Zeilen zerlegen. */
export function leseNdjson(text: string): Zeile[] {
  const aus: Zeile[] = []
  for (const z of text.split('\n')) if (z.trim()) aus.push(JSON.parse(z))
  return aus
}

export const LIESMICH = [
  'Datensicherung des Mayer-Holding-CRM',
  '',
  'Inhalt:',
  '- manifest.json: wann gesichert, welche Tabellen, wie viele Zeilen, Prüfsummen (SHA-256 der .gz-Dateien).',
  '- tabellen/<name>.ndjson.gz: je Tabelle eine gepackte Textdatei, je Zeile ein Datensatz im JSON-Format.',
  '  Öffnen: entpacken (z. B. mit 7-Zip oder „gunzip“), dann mit einem Texteditor lesen.',
  '- dateien.ndjson.gz: Liste aller Dateien in der Ablage (Eimer, Pfad, Größe). Die Dateien selbst',
  '  (Dokumente, Anhänge, Fotos) sind NICHT in dieser Sicherung.',
  '',
  'Nicht enthalten: Anmeldungen (Passwörter liegen beim Anmeldedienst), kurzlebige Zähler und Warteschlangen',
  '(siehe „ausgelassen“ im Manifest), KI-Verbrauch älter als 90 Tage.',
  '',
  'Einspielen: nur über das Programm scripts/sicherung-wiederherstellen.ts im Code des CRM (eine einzelne',
  'Tabelle oder eine einzelne Akte, zuerst immer als Probelauf). Nie von Hand in die Datenbank kopieren.',
  '',
].join('\n')

export function tabellenDatei(tabelle: string): string {
  return `tabellen/${tabelle}.ndjson.gz`
}

/** Baut das Paket (ZIP, unkomprimiert gespeichert — die Teile sind schon gzip-gepackt). */
export function baueZipPaket(manifest: Manifest, teile: Map<string, Uint8Array>, jetzt = new Date()): Uint8Array {
  const eintraege = [
    { name: 'manifest.json', inhalt: KODIERER.encode(JSON.stringify(manifest, null, 2)) },
    { name: 'LIESMICH.txt', inhalt: KODIERER.encode(LIESMICH) },
    ...[...teile.entries()].map(([name, inhalt]) => ({ name, inhalt })),
  ]
  return erstelleZip(eintraege, jetzt)
}

export type GelesenesPaket = {
  manifest: Manifest
  /** Zeilen einer Tabelle (null = nicht im Paket). Prüft die Prüfsumme. */
  zeilen: (tabelle: string) => Promise<Zeile[] | null>
  dateiliste: () => Promise<Zeile[]>
}

/** Liest ein Paket. Wirft bei kaputtem ZIP, falscher Prüfsumme oder unbekanntem Format. */
export function lesePaket(zip: Uint8Array): GelesenesPaket {
  const teile = new Map<string, { inhalt: Uint8Array; crcStimmt: boolean }>()
  for (const e of leseZip(zip)) teile.set(e.name, e)
  const m = teile.get('manifest.json')
  if (!m) throw new Error('Kein manifest.json im Paket — das ist keine Datensicherung des CRM.')
  const manifest = JSON.parse(new TextDecoder().decode(m.inhalt)) as Manifest
  if (manifest.format !== SICHERUNG_FORMAT) throw new Error(`Unbekanntes Format ${manifest.format} (erwartet ${SICHERUNG_FORMAT}).`)
  const lies = async (datei: string, sha?: string): Promise<Zeile[]> => {
    const t = teile.get(datei)
    if (!t) throw new Error(`${datei} fehlt im Paket.`)
    if (!t.crcStimmt) throw new Error(`${datei} ist beschädigt (Prüfsumme des ZIP stimmt nicht).`)
    if (sha && (await sha256Hex(t.inhalt)) !== sha) throw new Error(`${datei} ist beschädigt (SHA-256 stimmt nicht mit dem Manifest überein).`)
    return leseNdjson(new TextDecoder().decode(await gunzip(t.inhalt)))
  }
  return {
    manifest,
    zeilen: async (tabelle) => {
      const e = manifest.tabellen.find((x) => x.tabelle === tabelle)
      if (!e) return null
      const zeilen = await lies(e.datei, e.sha256)
      if (zeilen.length !== e.zeilen) throw new Error(`${tabelle}: ${zeilen.length} Zeilen gelesen, laut Manifest ${e.zeilen}.`)
      return zeilen
    },
    dateiliste: () => lies(manifest.dateien.datei, manifest.dateien.sha256),
  }
}

// ---------------------------------------------------------------------------------------------
// Vergleich und Auswahl (für das Einspielen)
// ---------------------------------------------------------------------------------------------

/** JSON mit sortierten Schlüsseln — zum Vergleichen von Werten unabhängig von der Reihenfolge. */
export function stabil(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stabil).join(',')}]`
  if (x && typeof x === 'object') {
    return `{${Object.keys(x as Zeile).sort().map((k) => `${JSON.stringify(k)}:${stabil((x as Zeile)[k])}`).join(',')}}`
  }
  return JSON.stringify(x ?? null)
}

export function schluesselWert(z: Zeile, schluessel: string[]): string {
  return schluessel.map((s) => stabil(z[s])).join('|')
}

export type Aenderung = { schluessel: string; sicherung: Zeile; live: Zeile; felder: string[] }
export type Vergleich = {
  /** In der Sicherung, live nicht (mehr) vorhanden → würde neu angelegt. */
  neu: Zeile[]
  /** In beiden, mit abweichenden Feldern → würde auf den Stand der Sicherung gesetzt. */
  geaendert: Aenderung[]
  gleich: number
  /** Nur live (seit der Sicherung neu) → bleibt unberührt, außer beim Löschen-Schalter. */
  nurLive: Zeile[]
}

/**
 * Vergleicht Zeilen der Sicherung mit den Live-Zeilen über den Primärschlüssel. Verglichen werden nur Felder, die in
 * der Sicherung stehen (neue Spalten seit der Sicherung zählen nicht), ohne Schlüssel; `spalten` schränkt weiter ein.
 */
export function vergleiche(sicherung: Zeile[], live: Zeile[], schluessel: string[], spalten?: string[]): Vergleich {
  const liveJe = new Map(live.map((z) => [schluesselWert(z, schluessel), z]))
  const gesehen = new Set<string>()
  const v: Vergleich = { neu: [], geaendert: [], gleich: 0, nurLive: [] }
  for (const z of sicherung) {
    const k = schluesselWert(z, schluessel)
    gesehen.add(k)
    const l = liveJe.get(k)
    if (!l) {
      v.neu.push(z)
      continue
    }
    const felder = Object.keys(z).filter((f) => !schluessel.includes(f) && (!spalten || spalten.includes(f)) && f in l && stabil(z[f]) !== stabil(l[f]))
    if (felder.length) v.geaendert.push({ schluessel: k, sicherung: z, live: l, felder })
    else v.gleich++
  }
  for (const [k, l] of liveJe) if (!gesehen.has(k)) v.nurLive.push(l)
  return v
}

/** Die Spalte, über die eine Tabelle an einer Akte hängt (oder null). kunden selbst: 'id'. */
export function akteSpalte(tabelle: string, spalten: string[]): string | null {
  if (tabelle === 'kunden') return 'id'
  return AKTE_SPALTEN.find((s) => spalten.includes(s)) ?? null
}

/** Reihenfolge beim Einspielen einer Akte: erst die Akte selbst (Fremdschlüssel), dann die übrigen nach Namen. */
export function akteReihenfolge(tabellen: string[]): string[] {
  return [...tabellen].sort((a, b) => (a === 'kunden' ? -1 : b === 'kunden' ? 1 : a.localeCompare(b)))
}

/** Text der Feldliste einer Änderung, gekürzt. */
export function felderText(felder: string[], hoechstens = 6): string {
  return felder.length > hoechstens ? `${felder.slice(0, hoechstens).join(', ')} … (+${felder.length - hoechstens})` : felder.join(', ')
}

/** Bytes lesbar: „4,2 MB“. */
export function groesseText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} Byte`
  const einheiten = ['KB', 'MB', 'GB', 'TB']
  let w = bytes / 1024
  let i = 0
  while (w >= 1024 && i < einheiten.length - 1) {
    w /= 1024
    i++
  }
  return `${w.toFixed(w < 10 ? 1 : 0).replace('.', ',')} ${einheiten[i]}`
}
