// Belegte Zeiten aus dem eigenen Kalender (Outlook, iPhone/iCloud, Google, IONOS …) im CRM-Kalender.
//
// - Jeder Mitarbeiter kann einen veröffentlichten Kalender-Link (iCalendar, .ics) hinterlegen
//   (Tabelle `kalender_fremd`, eine Zeile je Mitarbeiter). Der Server holt ihn alle 15 Minuten
//   (Zeitplan-Aktion `kalender_fremd_abruf`) und speichert NUR die belegten Zeiträume (`belegt`, jsonb) —
//   keine Titel, keine Orte, keine Inhalte (siehe _shared/icsBelegt.ts).
// - Das CRM zeigt sie als graue Blöcke „Belegt (eigener Kalender)“, Kollegen nur als „Privat“
//   (Datenbankfunktion `kalender_fremd_belegt`, hält die Sichtbarkeits-Einstellung ein). Der Assistent
//   berücksichtigt sie bei `freie_zeiten`.
// - Der Link ist ein Geheimnis des Mitarbeiters: nur er selbst bekommt ihn zurück (Aktion `kalender_fremd_laden`).
// - Abgerufen wird nur https auf übliche Namen (keine IP-Adressen, keine internen Namen, höchstens drei
//   Weiterleitungen, höchstens 5 MB, 15 Sekunden).

import { belegtAusIcs, type BelegtBlock } from '../_shared/icsBelegt.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const FREMD_AKTIONEN = new Set(['kalender_fremd_laden', 'kalender_fremd_speichern', 'kalender_fremd_aktualisieren'])

const TAG = 86400000
const TAGE_ZURUECK = 7
const TAGE_VORAUS = 366
const HOECHSTENS_BYTES = 5 * 1024 * 1024
const ZEITLIMIT_MS = 15000
const ABRUF_ABSTAND_MS = 14 * 60000

export type FremdStatus = {
  verbunden: boolean
  url?: string
  stand?: string | null
  anzahl?: number
  fehler?: string | null
}

// ---------- Link prüfen ----------

/** Macht aus der Eingabe eine abrufbare https-Adresse oder liefert eine Fehlermeldung. */
export function pruefeFremdUrl(eingabe: string): { ok: true; url: string } | { ok: false; fehler: string } {
  let roh = String(eingabe ?? '').trim()
  if (!roh) return { ok: false, fehler: 'Bitte den Kalender-Link einfügen.' }
  if (roh.length > 2000) return { ok: false, fehler: 'Der Link ist zu lang.' }
  roh = roh.replace(/^webcals?:\/\//i, 'https://').replace(/^http:\/\//i, 'https://')
  let u: URL
  try {
    u = new URL(roh)
  } catch {
    return { ok: false, fehler: 'Das ist kein gültiger Link. Er beginnt mit https:// oder webcal://.' }
  }
  if (u.protocol !== 'https:') return { ok: false, fehler: 'Der Link muss mit https:// oder webcal:// beginnen.' }
  if (u.username || u.password) return { ok: false, fehler: 'Links mit Benutzername oder Passwort werden nicht unterstützt.' }
  if (u.port && u.port !== '443') return { ok: false, fehler: 'Dieser Link wird nicht unterstützt (ungewöhnlicher Anschluss).' }
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) {
    return { ok: false, fehler: 'Bitte den Link mit dem Namen des Anbieters nehmen, keine IP-Adresse.' }
  }
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(host) || host.endsWith('.supabase.co') || host.endsWith('.supabase.in')) {
    return { ok: false, fehler: 'Dieser Link ist nicht erreichbar.' }
  }
  return { ok: true, url: u.toString() }
}

// ---------- Abrufen ----------

/** Holt den Kalender. Wirft mit einer verständlichen Meldung. */
export async function holeFremdIcs(url: string, abruf: typeof fetch = fetch): Promise<string> {
  let adresse = url
  for (let sprung = 0; sprung <= 3; sprung++) {
    const geprueft = pruefeFremdUrl(adresse)
    if (!geprueft.ok) throw new Error(geprueft.fehler)
    let antwort: Response
    try {
      antwort = await abruf(geprueft.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(ZEITLIMIT_MS),
        headers: { Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5', 'User-Agent': 'Kalenderabgleich/1.0' },
      })
    } catch (err) {
      const name = (err as Error)?.name
      throw new Error(name === 'TimeoutError' || name === 'AbortError' ? 'Der Kalender hat nicht rechtzeitig geantwortet.' : 'Der Kalender ist nicht erreichbar.')
    }
    if (antwort.status >= 300 && antwort.status < 400) {
      const ziel = antwort.headers.get('location')
      await antwort.body?.cancel()
      if (!ziel) throw new Error('Der Kalender leitet ins Leere weiter.')
      adresse = new URL(ziel, geprueft.url).toString()
      continue
    }
    if (antwort.status === 404 || antwort.status === 410) {
      await antwort.body?.cancel()
      throw new Error('Den Kalender gibt es unter diesem Link nicht (mehr). Bitte den Link in der Kalender-App neu veröffentlichen und hier neu eintragen.')
    }
    if (antwort.status === 401 || antwort.status === 403) {
      await antwort.body?.cancel()
      throw new Error('Der Kalender ist nicht freigegeben. Bitte in der Kalender-App „veröffentlichen“ bzw. „öffentlich freigeben“ wählen.')
    }
    if (!antwort.ok) {
      await antwort.body?.cancel()
      throw new Error(`Der Kalender antwortet mit einem Fehler (${antwort.status}).`)
    }
    const text = await liesBegrenzt(antwort)
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error('Unter diesem Link liegt kein Kalender. Bitte den Link für Kalender-Apps nehmen (endet meist auf .ics), nicht den Link zum Ansehen im Browser.')
    }
    return text
  }
  throw new Error('Der Kalender leitet zu oft weiter.')
}

async function liesBegrenzt(antwort: Response): Promise<string> {
  const laenge = Number(antwort.headers.get('content-length') ?? '0')
  if (laenge > HOECHSTENS_BYTES) {
    await antwort.body?.cancel()
    throw new Error('Der Kalender ist zu groß (mehr als 5 MB).')
  }
  if (!antwort.body) return ''
  const leser = antwort.body.getReader()
  const teile: Uint8Array[] = []
  let gesamt = 0
  while (true) {
    const { done, value } = await leser.read()
    if (done) break
    gesamt += value.byteLength
    if (gesamt > HOECHSTENS_BYTES) {
      await leser.cancel()
      throw new Error('Der Kalender ist zu groß (mehr als 5 MB).')
    }
    teile.push(value)
  }
  const alles = new Uint8Array(gesamt)
  let stelle = 0
  for (const t of teile) {
    alles.set(t, stelle)
    stelle += t.byteLength
  }
  return new TextDecoder('utf-8').decode(alles)
}

/** Holt und liest den Kalender: belegte Zeiträume von 7 Tagen zurück bis ein Jahr voraus. */
export async function ladeBelegtVonLink(url: string, jetzt = Date.now(), abruf: typeof fetch = fetch): Promise<{ bloecke: BelegtBlock[]; termine: number }> {
  const ics = await holeFremdIcs(url, abruf)
  const { bloecke, termine } = belegtAusIcs(ics, jetzt - TAGE_ZURUECK * TAG, jetzt + TAGE_VORAUS * TAG)
  return { bloecke, termine }
}

// ---------- Speichern ----------

function status(zeile: Record<string, unknown> | null): FremdStatus {
  if (!zeile) return { verbunden: false }
  return {
    verbunden: true,
    url: String(zeile.url ?? ''),
    stand: (zeile.stand as string | null) ?? null,
    anzahl: Number(zeile.anzahl ?? 0),
    fehler: (zeile.fehler as string | null) ?? null,
  }
}

const SPALTEN = 'email, url, stand, anzahl, fehler, fehler_seit, versucht_am'

async function aktualisiere(admin: Db, zeile: { email: string; url: string; fehler_seit?: string | null }, abruf: typeof fetch): Promise<{ ok: boolean; fehler?: string }> {
  const jetzt = new Date()
  try {
    const { bloecke } = await ladeBelegtVonLink(zeile.url, jetzt.getTime(), abruf)
    const { error } = await admin
      .from('kalender_fremd')
      .update({ belegt: bloecke, anzahl: bloecke.length, stand: jetzt.toISOString(), versucht_am: jetzt.toISOString(), fehler: null, fehler_seit: null })
      .eq('email', zeile.email)
    if (error) throw new Error(`Speichern fehlgeschlagen: ${error.message}`)
    return { ok: true }
  } catch (err) {
    const fehler = (err as Error)?.message ?? String(err)
    // Die zuletzt gelesenen Zeiten bleiben stehen; der Fehler wird angezeigt.
    await admin.from('kalender_fremd').update({ versucht_am: jetzt.toISOString(), fehler, fehler_seit: zeile.fehler_seit ?? jetzt.toISOString() }).eq('email', zeile.email)
    return { ok: false, fehler }
  }
}

/** Aktionen des angemeldeten Mitarbeiters (`ich` = seine Adresse, vom Aufrufer geprüft). */
export async function fremdKalenderAktion(admin: Db, ich: string, body: Record<string, unknown>, abruf: typeof fetch = fetch): Promise<{ status: number; daten: Record<string, unknown> }> {
  const wer = ich.trim().toLowerCase()
  const lies = async () => {
    const { data, error } = await admin.from('kalender_fremd').select(SPALTEN).eq('email', wer).maybeSingle()
    if (error) throw new Error(error.message)
    return data as Record<string, unknown> | null
  }
  try {
    if (body.action === 'kalender_fremd_laden') return { status: 200, daten: status(await lies()) }

    if (body.action === 'kalender_fremd_speichern') {
      const eingabe = String(body.url ?? '').trim()
      if (!eingabe) {
        const { error } = await admin.from('kalender_fremd').delete().eq('email', wer)
        if (error) throw new Error(error.message)
        return { status: 200, daten: { verbunden: false } }
      }
      const geprueft = pruefeFremdUrl(eingabe)
      if (!geprueft.ok) return { status: 400, daten: { error: geprueft.fehler } }
      // Erst lesen, dann speichern: ein falscher Link wird gar nicht erst gespeichert.
      let bloecke: BelegtBlock[]
      try {
        bloecke = (await ladeBelegtVonLink(geprueft.url, Date.now(), abruf)).bloecke
      } catch (err) {
        return { status: 400, daten: { error: (err as Error)?.message ?? 'Der Kalender konnte nicht gelesen werden.' } }
      }
      const jetzt = new Date().toISOString()
      const { error } = await admin
        .from('kalender_fremd')
        .upsert({ email: wer, url: geprueft.url, belegt: bloecke, anzahl: bloecke.length, stand: jetzt, versucht_am: jetzt, fehler: null, fehler_seit: null }, { onConflict: 'email' })
      if (error) throw new Error(error.message)
      return { status: 200, daten: status(await lies()) }
    }

    if (body.action === 'kalender_fremd_aktualisieren') {
      const zeile = await lies()
      if (!zeile) return { status: 200, daten: { verbunden: false } }
      await aktualisiere(admin, { email: wer, url: String(zeile.url), fehler_seit: zeile.fehler_seit as string | null }, abruf)
      return { status: 200, daten: status(await lies()) }
    }
    return { status: 400, daten: { error: 'Unbekannte Aktion.' } }
  } catch (err) {
    console.error('Eigener Kalender:', (err as Error)?.message ?? err)
    return { status: 500, daten: { error: `Fehler beim eigenen Kalender: ${(err as Error)?.message ?? err}` } }
  }
}

/** Zeitplan: alle hinterlegten Kalender neu holen, die länger als 14 Minuten nicht versucht wurden. */
export async function fremdKalenderAbruf(admin: Db, budgetMs = 90_000, abruf: typeof fetch = fetch): Promise<{ geprueft: number; ok: number; fehler: number }> {
  const start = Date.now()
  const grenze = new Date(start - ABRUF_ABSTAND_MS).toISOString()
  const { data, error } = await admin
    .from('kalender_fremd')
    .select(SPALTEN)
    .or(`versucht_am.is.null,versucht_am.lt.${grenze}`)
    .order('versucht_am', { ascending: true, nullsFirst: true })
    .limit(40)
  if (error) {
    console.error('Eigene Kalender nicht lesbar:', error.message)
    return { geprueft: 0, ok: 0, fehler: 0 }
  }
  const zeilen = (data ?? []) as { email: string; url: string; fehler_seit: string | null }[]
  const ergebnis = { geprueft: 0, ok: 0, fehler: 0 }
  // Höchstens vier gleichzeitig; nach Ablauf des Budgets keine neuen mehr (der Rest kommt beim nächsten Lauf).
  let naechste = 0
  const arbeiter = async () => {
    while (naechste < zeilen.length && Date.now() - start < budgetMs) {
      const z = zeilen[naechste++]
      ergebnis.geprueft++
      const r = await aktualisiere(admin, z, abruf)
      if (r.ok) ergebnis.ok++
      else ergebnis.fehler++
    }
  }
  await Promise.all([arbeiter(), arbeiter(), arbeiter(), arbeiter()])
  return ergebnis
}
