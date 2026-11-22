// Tägliche Datensicherung (Runde 5, 22.11.2026) — unabhängig von den Sicherungen des Anbieters.
//
// Anlass: Am 17.11.2026 hat ein Browserfenster Akten-Zeilen überschrieben (echter Datenverlust). Supabase sichert
// selbst, aber nur als ganze Datenbank und nur über das Dashboard zurückzuholen; eine einzelne Akte oder Tabelle
// auf einen alten Stand zu setzen, geht damit nicht.
//
// Ablauf:
// - Nachts ab 2:30 Uhr (Berlin) aus dem Minutentakt (termin_erinnerungen): einmal je Nacht beansprucht
//   (Zeile `datensicherung_stand` in abteilung_eintraege, Versionsprüfung wie superuser.ts), bis zu drei Versuche
//   im Abstand von 20 Minuten, Fenster bis 5:59 Uhr. Außerhalb des Fensters kein Datenbankzugriff.
// - Alle Tabellen im Schema public (Liste aus der Datenbankfunktion sicherung_tabellen, also auch künftige
//   Tabellen), außer AUSGESCHLOSSEN; ki_verbrauch nur 90 Tage. Seitenweise gelesen (Supabase gibt höchstens 1000
//   Zeilen je Abfrage): bei einspaltigem Primärschlüssel fortlaufend nach Schlüssel, sonst nach Versatz.
// - Je Tabelle eine gzip-gepackte NDJSON-Datei, dazu die Liste der Dateien in der Ablage (nur Pfade und Größen —
//   die Dokumente selbst sind zu groß) und ein Manifest (Zeilen, Prüfsummen). Alles in einem ZIP im privaten
//   Eimer `sicherungen` (nur Dienstschlüssel), Manifest zusätzlich einzeln (<name>.json).
// - Aufbewahrung: 14 tägliche, 8 wöchentliche, 12 monatliche (siehe zuBehalten in _shared/sicherungKern.ts).
// - Scheitert die Nacht dreimal, geht EINE Telegram-Nachricht an die Superuser (abschaltbar je Person über die
//   Karte auf der Superuser-Seite). Keine Nachricht bei Erfolg.
// - Aktion `datensicherung` (nur Geschäftsführung/Admins und Superuser): Stand lesen, „jetzt sichern“
//   (im Hintergrund), Download-Link (10 Minuten) für eine Sicherung, Telegram-Hinweis an/aus.
// - Einspielen: scripts/sicherung-wiederherstellen.ts (von Hand, mit Dienstschlüssel, Probelauf als Vorgabe).

import { berlinZeit } from './tagesmeldung.ts'
import { ermittleAufrufer } from './postfach.ts'
import {
  AUSGESCHLOSSEN,
  ZEITLICH_BEGRENZT,
  SICHERUNG_EIMER,
  SICHERUNG_FORMAT,
  GzipSammler,
  baueZipPaket,
  groesseText,
  istSicherungsName,
  nameAlsText,
  sha256Hex,
  sicherungsName,
  tabellenDatei,
  zuBehalten,
  type Manifest,
  type TabellenEintrag,
} from '../_shared/sicherungKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any
export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>

export const STAND_ID = 'datensicherung_stand'
const SEITE = 1000
const VERSUCHE = 3
const ABSTAND_MS = 20 * 60_000
/** Länger läuft eine Sicherung nie (Grenze der Server-Funktion ~400 s); ältere Sperren gelten als abgebrochen. */
const SPERRE_MS = 15 * 60_000
const ZEIT_BUDGET_MS = 300_000
const LINK_SEKUNDEN = 600

export type TabellenInfo = { tabelle: string; schluessel: string[]; spalten: string[]; sortierung: string[]; geschaetzt?: number }

export type Zusammenfassung = {
  name: string
  zeit: string
  art: Manifest['art']
  bytes: number
  dauerMs: number
  tabellen: number
  zeilen: number
  dateien: number
  dateienBytes: number
}

export type Stand = {
  version?: string
  /** Berliner Datum der Nacht, für die zuletzt beansprucht wurde. */
  nacht?: string
  nachtErfolg?: boolean
  versuche?: number
  letzterVersuch?: string
  /** Gesetzt, solange eine Sicherung läuft (Sperre gegen doppelte Läufe). */
  laeuftSeit?: string | null
  laeuftArt?: Manifest['art'] | null
  letzte?: Zusammenfassung
  letzterFehler?: { zeit: string; text: string; art: Manifest['art'] } | null
  /** Nacht, für die die Fehlermeldung schon verschickt wurde. */
  gemeldet?: string
  /** Adressen (klein), die keine Fehlermeldung per Telegram wollen. */
  ohneMeldung?: string[]
  /** Letzte Downloads (wer, wann, welche) — höchstens 10. */
  downloads?: { von: string; am: string; name: string }[]
}

// ---------------------------------------------------------------------------------------------
// Sicherung erstellen
// ---------------------------------------------------------------------------------------------

export type SicherungsOptionen = {
  jetzt?: Date
  /** false = nur lesen und messen (Probelauf): nichts hochladen, nichts löschen. */
  schreiben?: boolean
  art?: Manifest['art']
  von?: string
  zeitBudgetMs?: number
  /** Ersetzt die Datenbankfunktion sicherung_tabellen (nur für Messungen, bevor die SQL eingespielt ist). */
  ladeTabellen?: () => Promise<TabellenInfo[]>
  /** Ersetzt die Datenbankfunktion sicherung_dateiliste (ebenso). */
  ladeDateien?: (nach: string | null) => Promise<DateiZeile[]>
}

export type DateiZeile = { id: string; eimer: string; pfad: string; groesse: number | null; typ: string | null; erstellt: string | null }

export type SicherungsErgebnis = {
  manifest: Manifest
  paketBytes: number
  /** Nur beim Schreiben: Sicherungen, die die Drehung entfernt hat. */
  entfernt: string[]
}

async function ladeTabellenAusDb(admin: Db): Promise<TabellenInfo[]> {
  const { data, error } = await admin.rpc('sicherung_tabellen')
  if (error) throw new Error(`Tabellenliste nicht lesbar: ${error.message}`)
  if (!Array.isArray(data) || data.length === 0) throw new Error('Tabellenliste ist leer.')
  return data.map((z: Record<string, unknown>) => ({
    tabelle: String(z.tabelle),
    schluessel: Array.isArray(z.schluessel) ? z.schluessel.map(String) : [],
    spalten: Array.isArray(z.spalten) ? z.spalten.map(String) : [],
    sortierung: Array.isArray(z.sortierung) ? z.sortierung.map(String) : [],
    geschaetzt: Number(z.geschaetzt ?? 0),
  }))
}

function dateienAusDb(admin: Db): (nach: string | null) => Promise<DateiZeile[]> {
  return async (nach) => {
    const { data, error } = await admin.rpc('sicherung_dateiliste', { p_nach: nach, p_grenze: SEITE })
    if (error) throw new Error(`Dateiliste nicht lesbar: ${error.message}`)
    return Array.isArray(data) ? data : []
  }
}

/** Liest eine Tabelle seitenweise und schreibt jede Zeile als NDJSON in den Sammler. Gibt die Zeilenzahl zurück. */
async function exportiereTabelle(admin: Db, info: TabellenInfo, sammler: GzipSammler, frist: () => void, ab: string | null): Promise<{ zeilen: number; warnung?: string }> {
  const begrenzt = ZEITLICH_BEGRENZT[info.tabelle]
  let zeilen = 0
  const schreibe = async (seite: Record<string, unknown>[]) => {
    await sammler.schreibe(seite.map((z) => JSON.stringify(z)).join('\n') + '\n')
    zeilen += seite.length
  }
  if (info.schluessel.length === 1) {
    // Fortlaufend nach Schlüssel: neue Zeilen während der Sicherung verschieben keine Seiten.
    const k = info.schluessel[0]
    let letzter: unknown = null
    for (;;) {
      frist()
      let q = admin.from(info.tabelle).select('*')
      if (begrenzt && ab) q = q.gte(begrenzt.spalte, ab)
      if (letzter !== null) q = q.gt(k, letzter)
      const { data, error } = await q.order(k, { ascending: true }).limit(SEITE)
      if (error) throw new Error(`${info.tabelle}: ${error.message}`)
      if (!Array.isArray(data) || data.length === 0) break
      await schreibe(data)
      letzter = data[data.length - 1][k]
      if (letzter === null || letzter === undefined) throw new Error(`${info.tabelle}: Zeile ohne Schlüssel ${k}`)
    }
    return { zeilen }
  }
  // Zusammengesetzter oder fehlender Schlüssel: nach Versatz, sortiert nach allen sortierbaren Spalten.
  const sortierung = info.schluessel.length ? info.schluessel : info.sortierung
  let von = 0
  for (;;) {
    frist()
    let q = admin.from(info.tabelle).select('*')
    if (begrenzt && ab) q = q.gte(begrenzt.spalte, ab)
    for (const s of sortierung) q = q.order(s, { ascending: true })
    const { data, error } = await q.range(von, von + SEITE - 1)
    if (error) throw new Error(`${info.tabelle}: ${error.message}`)
    if (!Array.isArray(data) || data.length === 0) break
    await schreibe(data)
    von += data.length
  }
  return { zeilen, warnung: info.schluessel.length ? undefined : `${info.tabelle}: kein Primärschlüssel — nach Versatz gelesen${sortierung.length ? '' : ' (ohne Sortierung)'}, beim Einspielen nur von Hand.` }
}

/** Erstellt eine Sicherung. Wirft bei jedem Fehler (der Aufrufer protokolliert). */
export async function erstelleSicherung(admin: Db, o: SicherungsOptionen = {}): Promise<SicherungsErgebnis> {
  const jetzt = o.jetzt ?? new Date()
  const start = Date.now()
  const budget = o.zeitBudgetMs ?? ZEIT_BUDGET_MS
  const frist = () => {
    if (Date.now() - start > budget) throw new Error(`Zeitgrenze von ${Math.round(budget / 1000)} Sekunden überschritten.`)
  }
  const name = sicherungsName(jetzt)
  const tabellen = await (o.ladeTabellen ? o.ladeTabellen() : ladeTabellenAusDb(admin))
  const teile = new Map<string, Uint8Array>()
  const eintraege: TabellenEintrag[] = []
  const ausgelassen: Manifest['ausgelassen'] = []
  const warnungen: string[] = []

  for (const info of [...tabellen].sort((a, b) => a.tabelle.localeCompare(b.tabelle))) {
    if (AUSGESCHLOSSEN[info.tabelle]) {
      ausgelassen.push({ tabelle: info.tabelle, grund: AUSGESCHLOSSEN[info.tabelle] })
      continue
    }
    const begrenzt = ZEITLICH_BEGRENZT[info.tabelle]
    const ab = begrenzt ? new Date(jetzt.getTime() - begrenzt.tage * 86400_000).toISOString() : null
    const sammler = new GzipSammler()
    const { zeilen, warnung } = await exportiereTabelle(admin, info, sammler, frist, ab)
    const bytes = await sammler.fertig()
    if (warnung) warnungen.push(warnung)
    const datei = tabellenDatei(info.tabelle)
    teile.set(datei, bytes)
    eintraege.push({
      tabelle: info.tabelle,
      datei,
      zeilen,
      bytes: bytes.length,
      sha256: await sha256Hex(bytes),
      schluessel: info.schluessel,
      spalten: info.spalten,
      ...(begrenzt && ab ? { filter: `${begrenzt.spalte} ab ${ab}` } : {}),
    })
  }

  // Liste der Dateien in der Ablage (ohne den Sicherungs-Eimer), fortlaufend nach id.
  const ladeDateien = o.ladeDateien ?? dateienAusDb(admin)
  const dateiSammler = new GzipSammler()
  const jeEimer: Record<string, { anzahl: number; bytes: number }> = {}
  let dateiAnzahl = 0
  let dateiBytes = 0
  let nach: string | null = null
  for (;;) {
    frist()
    const seite: DateiZeile[] = await ladeDateien(nach)
    if (seite.length === 0) break
    const zeilen = seite.filter((d) => d.eimer !== SICHERUNG_EIMER)
    await dateiSammler.schreibe(zeilen.map((d) => JSON.stringify({ eimer: d.eimer, pfad: d.pfad, groesse: d.groesse, typ: d.typ, erstellt: d.erstellt })).join('\n') + (zeilen.length ? '\n' : ''))
    for (const d of zeilen) {
      const g = Number(d.groesse) || 0
      jeEimer[d.eimer] ??= { anzahl: 0, bytes: 0 }
      jeEimer[d.eimer].anzahl++
      jeEimer[d.eimer].bytes += g
      dateiAnzahl++
      dateiBytes += g
    }
    nach = seite[seite.length - 1].id
  }
  const dateiGz = await dateiSammler.fertig()
  teile.set('dateien.ndjson.gz', dateiGz)

  const manifest: Manifest = {
    format: SICHERUNG_FORMAT,
    name,
    erstellt: jetzt.toISOString(),
    dauerMs: 0,
    art: o.art ?? 'nacht',
    ...(o.von ? { von: o.von } : {}),
    tabellen: eintraege,
    ausgelassen,
    dateien: { datei: 'dateien.ndjson.gz', anzahl: dateiAnzahl, bytes: dateiBytes, sha256: await sha256Hex(dateiGz), jeEimer },
    gesamtZeilen: eintraege.reduce((s, e) => s + e.zeilen, 0),
    warnungen,
  }
  manifest.dauerMs = Date.now() - start
  const paket = baueZipPaket(manifest, teile, jetzt)
  const ergebnis: SicherungsErgebnis = { manifest: { ...manifest, paketBytes: paket.length }, paketBytes: paket.length, entfernt: [] }
  if (o.schreiben === false) return ergebnis

  const eimer = admin.storage.from(SICHERUNG_EIMER)
  // Läuft am selben Tag zur selben Minute schon eine (sehr selten): Name mit Sekunden eindeutig machen geht nicht
  // (Muster der Drehung) — dann wird die ältere ersetzt.
  const hoch = await eimer.upload(`${name}.zip`, paket, { contentType: 'application/zip', upsert: true })
  if (hoch.error) throw new Error(`Hochladen fehlgeschlagen: ${hoch.error.message}`)
  const m = await eimer.upload(`${name}.json`, new TextEncoder().encode(JSON.stringify(ergebnis.manifest)), { contentType: 'application/json', upsert: true })
  if (m.error) throw new Error(`Manifest nicht gespeichert: ${m.error.message}`)
  ergebnis.entfernt = await drehe(admin).catch((err) => {
    // Die Sicherung selbst ist gelungen; eine liegengebliebene alte Sicherung ist kein Grund für einen Fehlschlag.
    console.error('Datensicherung: Aufräumen alter Sicherungen fehlgeschlagen:', err instanceof Error ? err.message : err)
    return []
  })
  return ergebnis
}

export type SicherungsDatei = { name: string; bytes: number; erstellt: string | null }

/** Alle Sicherungen im Eimer (neueste zuerst), aus der Liste der .zip-Dateien. */
export async function listeSicherungen(admin: Db): Promise<SicherungsDatei[]> {
  const { data, error } = await admin.storage.from(SICHERUNG_EIMER).list('', { limit: 1000, sortBy: { column: 'name', order: 'desc' } })
  if (error) throw new Error(`Sicherungen nicht lesbar: ${error.message}`)
  return (Array.isArray(data) ? data : [])
    .filter((d: { name?: string }) => typeof d.name === 'string' && d.name.endsWith('.zip') && istSicherungsName(d.name.slice(0, -4)))
    .map((d: { name: string; created_at?: string; metadata?: { size?: number } }) => ({ name: d.name.slice(0, -4), bytes: Number(d.metadata?.size ?? 0), erstellt: d.created_at ?? null }))
    .sort((a: SicherungsDatei, b: SicherungsDatei) => b.name.localeCompare(a.name))
}

/** Entfernt Sicherungen außerhalb der Aufbewahrung (Paket und Manifest). Gibt die entfernten Namen zurück. */
export async function drehe(admin: Db): Promise<string[]> {
  const alle = (await listeSicherungen(admin)).map((s) => s.name)
  const bleibt = zuBehalten(alle)
  const weg = alle.filter((n) => !bleibt.has(n))
  if (weg.length === 0) return []
  const { error } = await admin.storage.from(SICHERUNG_EIMER).remove(weg.flatMap((n) => [`${n}.zip`, `${n}.json`]))
  if (error) throw new Error(error.message)
  return weg
}

function zusammenfassung(e: SicherungsErgebnis): Zusammenfassung {
  return {
    name: e.manifest.name,
    zeit: e.manifest.erstellt,
    art: e.manifest.art,
    bytes: e.paketBytes,
    dauerMs: e.manifest.dauerMs,
    tabellen: e.manifest.tabellen.length,
    zeilen: e.manifest.gesamtZeilen,
    dateien: e.manifest.dateien.anzahl,
    dateienBytes: e.manifest.dateien.bytes,
  }
}

// ---------------------------------------------------------------------------------------------
// Stand (Zeile in abteilung_eintraege)
// ---------------------------------------------------------------------------------------------

function alsStand(x: unknown): Stand {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Stand) : {}
}

export async function leseStand(admin: Db): Promise<{ da: boolean; stand: Stand }> {
  const { data, error } = await admin.from('abteilung_eintraege').select('daten').eq('id', STAND_ID).maybeSingle()
  if (error) throw new Error(`Stand nicht lesbar: ${error.message}`)
  return { da: !!data, stand: alsStand(data?.daten) }
}

/**
 * Ändert den Stand nur, wenn er seit dem Lesen unverändert ist (Versionsprüfung). `aendere` bekommt den frisch
 * gelesenen Stand; gibt es null zurück, wird nichts geschrieben. Ergebnis: der geschriebene Stand oder null
 * (jemand anderes war schneller / nichts zu tun). `versuche` > 1 = bei Zusammenstoß neu lesen und wiederholen.
 */
export async function aendereStand(admin: Db, aendere: (alt: Stand) => Stand | null, versuche = 1, jetzt = new Date()): Promise<Stand | null> {
  for (let i = 0; i < versuche; i++) {
    const { da, stand } = await leseStand(admin)
    const neu = aendere(structuredClone(stand))
    if (!neu) return null
    const geschrieben: Stand = { ...neu, version: crypto.randomUUID() }
    if (!da) {
      const { error } = await admin.from('abteilung_eintraege').insert({ id: STAND_ID, art: STAND_ID, daten: geschrieben, updated_at: jetzt.toISOString() })
      if (!error) return geschrieben
      continue
    }
    let q = admin.from('abteilung_eintraege').update({ daten: geschrieben, updated_at: jetzt.toISOString() }).eq('id', STAND_ID)
    if (typeof stand.version === 'string') q = q.eq('daten->>version', stand.version)
    const { data, error } = await q.select('id')
    if (!error && Array.isArray(data) && data.length > 0) return geschrieben
  }
  return null
}

function sperreAktiv(s: Stand, jetzt: Date): boolean {
  return !!s.laeuftSeit && jetzt.getTime() - new Date(s.laeuftSeit).getTime() < SPERRE_MS
}

/** Führt eine beanspruchte Sicherung aus und schreibt das Ergebnis in den Stand. Wirft nie. */
async function fuehreAus(admin: Db, art: Manifest['art'], von: string | undefined, jetzt: Date, optionen: Partial<SicherungsOptionen>): Promise<{ ok: true; ergebnis: SicherungsErgebnis } | { ok: false; fehler: string }> {
  try {
    const ergebnis = await erstelleSicherung(admin, { ...optionen, jetzt, art, von })
    await aendereStand(admin, (s) => ({ ...s, laeuftSeit: null, laeuftArt: null, letzte: zusammenfassung(ergebnis), letzterFehler: null, ...(art === 'nacht' ? { nachtErfolg: true } : {}) }), 3)
    console.log(`Datensicherung ${ergebnis.manifest.name}: ${ergebnis.manifest.tabellen.length} Tabellen, ${ergebnis.manifest.gesamtZeilen} Zeilen, ${groesseText(ergebnis.paketBytes)}, ${Math.round(ergebnis.manifest.dauerMs / 1000)} s${ergebnis.entfernt.length ? `, entfernt: ${ergebnis.entfernt.join(', ')}` : ''}.`)
    return { ok: true, ergebnis }
  } catch (err) {
    const text = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    console.error('Datensicherung fehlgeschlagen:', text)
    await aendereStand(admin, (s) => ({ ...s, laeuftSeit: null, laeuftArt: null, letzterFehler: { zeit: new Date().toISOString(), text, art } }), 3).catch(() => null)
    return { ok: false, fehler: text }
  }
}

// ---------------------------------------------------------------------------------------------
// Nachtlauf (aus dem Minutentakt)
// ---------------------------------------------------------------------------------------------

/** 2:30 bis 5:59 Uhr Berliner Zeit. */
export function imNachtfenster(jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  return (b.stunde === 2 && b.minute >= 30) || (b.stunde >= 3 && b.stunde <= 5)
}

async function meldeFehlschlag(admin: Db, sende: SendeFunktion, stand: Stand, nacht: string): Promise<number> {
  const { data } = await admin.from('mitarbeiter').select('email, aktiv, ist_superuser, telegram_chat_id').eq('ist_superuser', true)
  const ohne = new Set((stand.ohneMeldung ?? []).map((x) => x.toLowerCase()))
  const empfaenger = (Array.isArray(data) ? data : []).filter((m: { aktiv?: boolean; telegram_chat_id?: unknown; email?: string }) => m.aktiv && m.telegram_chat_id && !ohne.has(String(m.email ?? '').toLowerCase()))
  if (empfaenger.length === 0) return 0
  const [j, mo, t] = nacht.split('-')
  const zuletzt = stand.letzte ? `Letzte gelungene Sicherung: ${nameAlsText(stand.letzte.name)}.` : 'Es gibt noch keine gelungene Sicherung.'
  const text = [
    `Datensicherung der Nacht ${t}.${mo}.${j} ist ${VERSUCHE}-mal fehlgeschlagen.`,
    `Grund: ${stand.letzterFehler?.text ?? 'unbekannt'}`,
    zuletzt,
    'Im CRM unter Superuser → Datensicherung kannst du sie von Hand starten.',
  ].join('\n')
  let n = 0
  for (const m of empfaenger) if (await sende(m.telegram_chat_id, text)) n++
  return n
}

export type NachtErgebnis = { gelaufen: boolean; ok?: boolean; gemeldet?: number; grund?: string }

/**
 * Vom Minutentakt gerufen. Außerhalb von 2:30–5:59 Uhr ohne Datenbankzugriff. Beansprucht die Nacht (nie doppelt),
 * versucht es höchstens dreimal im Abstand von 20 Minuten und meldet nach dem dritten Fehlschlag einmal per Telegram.
 * Wirft nie.
 */
export async function pruefeNaechtlicheSicherung(admin: Db, sende: SendeFunktion, jetzt = new Date(), optionen: Partial<SicherungsOptionen> = {}): Promise<NachtErgebnis> {
  try {
    if (!imNachtfenster(jetzt)) return { gelaufen: false, grund: 'außerhalb' }
    const nacht = berlinZeit(jetzt).datum
    const { stand } = await leseStand(admin)
    const dieseNacht = stand.nacht === nacht
    if (dieseNacht && stand.nachtErfolg) return { gelaufen: false, grund: 'erledigt' }
    if (sperreAktiv(stand, jetzt)) return { gelaufen: false, grund: 'läuft' }
    const versuche = dieseNacht ? stand.versuche ?? 0 : 0
    if (versuche >= VERSUCHE) {
      // Letzter Versuch abgebrochen (Sperre abgelaufen ohne Ergebnis) oder fehlgeschlagen: einmal melden.
      if (stand.gemeldet === nacht) return { gelaufen: false, grund: 'gemeldet' }
      const beansprucht = await aendereStand(admin, (s) => {
        if (s.gemeldet === nacht || s.nachtErfolg || sperreAktiv(s, jetzt)) return null
        // Abgebrochener Lauf (Server beendet) hinterlässt nur die Sperre: als Fehler festhalten.
        const fehler = s.laeuftSeit ? { zeit: jetzt.toISOString(), text: 'Lauf abgebrochen (vermutlich Zeitgrenze des Servers).', art: 'nacht' as const } : s.letzterFehler
        return { ...s, gemeldet: nacht, laeuftSeit: null, laeuftArt: null, letzterFehler: fehler ?? null }
      }, 1, jetzt)
      if (!beansprucht) return { gelaufen: false, grund: 'gemeldet' }
      return { gelaufen: false, ok: false, gemeldet: await meldeFehlschlag(admin, sende, beansprucht, nacht) }
    }
    if (dieseNacht && stand.letzterVersuch && jetzt.getTime() - new Date(stand.letzterVersuch).getTime() < ABSTAND_MS) return { gelaufen: false, grund: 'warten' }
    const beansprucht = await aendereStand(admin, (s) => {
      // Frisch gelesen: hat inzwischen ein anderer Takt begonnen, nichts tun.
      if (sperreAktiv(s, jetzt) || (s.nacht === nacht && (s.nachtErfolg || (s.versuche ?? 0) !== versuche))) return null
      const abgebrochen = s.laeuftSeit ? { letzterFehler: { zeit: jetzt.toISOString(), text: 'Lauf abgebrochen (vermutlich Zeitgrenze des Servers).', art: 'nacht' as const } } : {}
      return { ...s, ...abgebrochen, nacht, nachtErfolg: false, versuche: versuche + 1, letzterVersuch: jetzt.toISOString(), laeuftSeit: jetzt.toISOString(), laeuftArt: 'nacht' }
    }, 1, jetzt)
    if (!beansprucht) return { gelaufen: false, grund: 'beansprucht' }
    const r = await fuehreAus(admin, 'nacht', undefined, jetzt, optionen)
    if (r.ok) return { gelaufen: true, ok: true }
    if (versuche + 1 < VERSUCHE) return { gelaufen: true, ok: false }
    // Dritter Fehlschlag: gleich melden (einmal je Nacht).
    const gemeldet = await aendereStand(admin, (s) => (s.gemeldet === nacht ? null : { ...s, gemeldet: nacht }), 3)
    return { gelaufen: true, ok: false, gemeldet: gemeldet ? await meldeFehlschlag(admin, sende, gemeldet, nacht) : 0 }
  } catch (err) {
    console.error('Datensicherung (Nachtlauf) fehlgeschlagen:', err instanceof Error ? err.message : err)
    return { gelaufen: false, ok: false, grund: 'fehler' }
  }
}

// ---------------------------------------------------------------------------------------------
// Aktion datensicherung (Superuser-Seite)
// ---------------------------------------------------------------------------------------------

export type AktionsErgebnis = { status: number; daten: unknown }

async function darfSichern(admin: Db, email: string, istGf: boolean): Promise<boolean> {
  if (istGf) return true
  const { data } = await admin.from('mitarbeiter').select('ist_superuser, aktiv').ilike('email', email.replace(/[\\%_]/g, (z) => `\\${z}`)).maybeSingle()
  return !!data?.aktiv && !!data?.ist_superuser
}

async function ladeManifest(admin: Db, name: string): Promise<Manifest | null> {
  const { data, error } = await admin.storage.from(SICHERUNG_EIMER).download(`${name}.json`)
  if (error || !data) return null
  try {
    return JSON.parse(await data.text()) as Manifest
  } catch {
    return null
  }
}

/**
 * { aufgabe: 'stand' }                 → Stand, Liste der Sicherungen, Zahlen der neuesten (Zeilen je Tabelle)
 * { aufgabe: 'jetzt' }                 → startet eine Sicherung im Hintergrund (409, wenn schon eine läuft)
 * { aufgabe: 'herunterladen', name? }  → Link (10 Minuten) zum Paket; ohne name die neueste
 * { aufgabe: 'meldung', an: boolean }  → Telegram bei Fehlschlag für den Aufrufer an/aus
 * `imHintergrund` = EdgeRuntime.waitUntil (aus index.ts).
 */
export async function datensicherungAktion(req: Request, admin: Db, body: Record<string, unknown>, imHintergrund: (p: Promise<unknown>) => void, jetzt = new Date()): Promise<AktionsErgebnis> {
  const aufrufer = await ermittleAufrufer(req, admin, body)
  if (!aufrufer) return { status: 401, daten: { error: 'Bitte neu anmelden.' } }
  if (!(await darfSichern(admin, aufrufer.email, aufrufer.istGf))) return { status: 403, daten: { error: 'Nur für Geschäftsführung und Superuser.' } }
  const aufgabe = String(body.aufgabe ?? 'stand')

  if (aufgabe === 'jetzt') {
    const beansprucht = await aendereStand(admin, (s) => (sperreAktiv(s, jetzt) ? null : { ...s, laeuftSeit: jetzt.toISOString(), laeuftArt: 'hand' }), 1, jetzt)
    if (!beansprucht) return { status: 409, daten: { error: 'Es läuft gerade schon eine Sicherung. Bitte in ein paar Minuten nachsehen.' } }
    imHintergrund(fuehreAus(admin, 'hand', aufrufer.email, jetzt, {}))
    return { status: 200, daten: { ok: true, gestartet: true } }
  }

  if (aufgabe === 'herunterladen') {
    const liste = await listeSicherungen(admin)
    const gewuenscht = typeof body.name === 'string' && body.name ? body.name : liste[0]?.name
    if (!gewuenscht || !liste.some((s) => s.name === gewuenscht)) return { status: 404, daten: { error: 'Diese Sicherung gibt es nicht (mehr).' } }
    const { data, error } = await admin.storage.from(SICHERUNG_EIMER).createSignedUrl(`${gewuenscht}.zip`, LINK_SEKUNDEN, { download: `crm-sicherung-${gewuenscht}.zip` })
    if (error || !data?.signedUrl) return { status: 500, daten: { error: `Link ließ sich nicht erstellen: ${error?.message ?? 'unbekannt'}` } }
    await aendereStand(admin, (s) => ({ ...s, downloads: [{ von: aufrufer.email, am: jetzt.toISOString(), name: gewuenscht }, ...(s.downloads ?? [])].slice(0, 10) }), 3, jetzt).catch(() => null)
    console.log(`Datensicherung ${gewuenscht} heruntergeladen von ${aufrufer.email}.`)
    return { status: 200, daten: { ok: true, url: data.signedUrl, name: gewuenscht, gueltigSekunden: LINK_SEKUNDEN } }
  }

  if (aufgabe === 'meldung') {
    const an = body.an !== false
    const email = aufrufer.email.toLowerCase()
    const neu = await aendereStand(admin, (s) => {
      const ohne = new Set((s.ohneMeldung ?? []).map((x) => x.toLowerCase()))
      if (an) ohne.delete(email)
      else ohne.add(email)
      return { ...s, ohneMeldung: [...ohne].sort() }
    }, 3, jetzt)
    if (!neu) return { status: 409, daten: { error: 'Gerade geändert — bitte noch einmal versuchen.' } }
  } else if (aufgabe !== 'stand') {
    return { status: 400, daten: { error: `Unbekannte Aufgabe „${aufgabe}“.` } }
  }

  const [{ stand }, liste] = await Promise.all([leseStand(admin), listeSicherungen(admin).catch(() => [] as SicherungsDatei[])])
  const neueste = liste[0] ? await ladeManifest(admin, liste[0].name) : null
  return {
    status: 200,
    daten: {
      ok: true,
      laeuft: sperreAktiv(stand, jetzt) ? { seit: stand.laeuftSeit, art: stand.laeuftArt ?? null } : null,
      letzte: stand.letzte ?? null,
      letzterFehler: stand.letzterFehler ?? null,
      meldungAn: !(stand.ohneMeldung ?? []).includes(aufrufer.email.toLowerCase()),
      sicherungen: liste,
      gesamtBytes: liste.reduce((s, x) => s + x.bytes, 0),
      neueste: neueste
        ? {
          name: neueste.name,
          erstellt: neueste.erstellt,
          art: neueste.art,
          dauerMs: neueste.dauerMs,
          paketBytes: neueste.paketBytes ?? liste[0].bytes,
          gesamtZeilen: neueste.gesamtZeilen,
          tabellen: neueste.tabellen.map((t) => ({ tabelle: t.tabelle, zeilen: t.zeilen, bytes: t.bytes })),
          ausgelassen: neueste.ausgelassen,
          dateien: { anzahl: neueste.dateien.anzahl, bytes: neueste.dateien.bytes },
          warnungen: neueste.warnungen,
        }
        : null,
    },
  }
}
