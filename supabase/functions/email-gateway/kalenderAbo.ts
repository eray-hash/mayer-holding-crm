// Kalender-Abo: CRM-Termine erscheinen im Kalender, den jeder Mitarbeiter sowieso benutzt (Outlook,
// iPhone/Mac, Google, Android, Webmail).
//
// - Jeder bekommt eine persönliche, geheime Adresse (`kalender_einstellungen.feed_token`). Die
//   Kalender-App ruft sie per GET ab (ohne Kopfzeilen, ohne Login) und bekommt die eigenen Termine
//   (Besitzer oder Teilnehmer) als iCalendar-Datei nach RFC 5545 — 60 Tage zurück bis 18 Monate voraus.
// - Nur eine Richtung: CRM → Kalender-App. Was in der App geändert wird, kommt nicht zurück.
// - Wer die Adresse kennt, sieht die Termine. Deshalb: mindestens 32 Zufallsbytes, bei unbekannter
//   Kennung nur ein nacktes 404, und auf Wunsch eine neue Adresse (die alte ist dann sofort ungültig).
//   Ausgeschiedene (nicht mehr aktive) Mitarbeiter bekommen nichts mehr.
// - Der Kundenname steht in der Beschreibung, nie ein Verweis ins CRM.

// Der Dienst-Zugang zur Datenbank — in postfach.ts genauso typisiert, dort aber nicht exportiert.
// deno-lint-ignore no-explicit-any
type Db = any

export type AboTermin = {
  id: string
  titel: string
  beschreibung: string | null
  ort: string | null
  beginn: string
  ende: string
  ganztags: boolean
  besitzer_email: string
  teilnehmer: string[] | null
  kunde_name: string | null
  geaendert_am?: string | null
}

const TAG_MS = 86400000
const TAGE_ZURUECK = 60
const MONATE_VORAUS = 18
const MAX_TERMINE = 5000
const UID_DOMAIN = 'kalender.mayer-holding-crm'
const TOKEN_MUSTER = /^[A-Za-z0-9_-]{32,128}$/

// ---------- Kennung ----------

/** 32 Zufallsbytes, base64url ohne Auffüllzeichen (43 Zeichen). */
export function neuerAboToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function aboAdressen(supabaseUrl: string, token: string): { https: string; webcal: string } {
  const https = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/email-gateway?kalender=${encodeURIComponent(token)}`
  return { https, webcal: https.replace(/^https?:\/\//i, 'webcal://') }
}

/**
 * Liefert die Abo-Adressen des Mitarbeiters. Legt eine Kennung an, wenn es noch keine gibt; mit
 * `neu` immer eine frische (die alte Adresse ist danach ungültig). Andere Spalten bleiben unberührt.
 */
export async function aboLink(
  admin: Db,
  email: string,
  neu: boolean,
  supabaseUrl: string,
): Promise<{ ok: true; https: string; webcal: string } | { ok: false; fehler: string }> {
  const wer = email.trim().toLowerCase()
  const { data: zeile, error: lesefehler } = await admin.from('kalender_einstellungen').select('email, feed_token').eq('email', wer).maybeSingle()
  if (lesefehler) return { ok: false, fehler: `Kalender-Einstellungen nicht lesbar: ${lesefehler.message}` }
  const vorhanden = typeof zeile?.feed_token === 'string' && TOKEN_MUSTER.test(zeile.feed_token) ? (zeile.feed_token as string) : ''
  if (vorhanden && !neu) return { ok: true, ...aboAdressen(supabaseUrl, vorhanden) }

  const token = neuerAboToken()
  if (zeile) {
    const { error } = await admin.from('kalender_einstellungen').update({ feed_token: token }).eq('email', wer)
    if (error) return { ok: false, fehler: `Neuer Link konnte nicht gespeichert werden: ${error.message}` }
  } else {
    // Noch keine Zeile: mit denselben Grundwerten anlegen, die die Oberfläche ohne Zeile annimmt.
    const { error } = await admin.from('kalender_einstellungen').insert({ email: wer, erinnerungen: [60], sichtbar: true, feed_token: token })
    if (error) {
      // Gleichzeitig angelegt (z. B. Einstellungen im anderen Fenster gespeichert): dann nur die Kennung setzen.
      const { error: zweiter } = await admin.from('kalender_einstellungen').update({ feed_token: token }).eq('email', wer)
      if (zweiter) return { ok: false, fehler: `Link konnte nicht gespeichert werden: ${error.message}` }
    }
  }
  return { ok: true, ...aboAdressen(supabaseUrl, token) }
}

// ---------- iCalendar (RFC 5545) ----------

const enc = new TextEncoder()

/** TEXT-Wert maskieren: \ ; , und Zeilenumbrüche; Steuerzeichen (außer Tab) fallen weg. */
export function maskiereText(s: string): string {
  return s
    .replace(/\r\n|\r|\n/g, '\n')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/** Zeile nach höchstens 75 Bytes umbrechen (Folgezeilen beginnen mit Leerzeichen); nie mitten in einem UTF-8-Zeichen. */
export function falteZeile(zeile: string): string {
  const teile: string[] = []
  let aktuell = ''
  let bytes = 0
  let grenze = 75
  for (const zeichen of zeile) {
    const laenge = enc.encode(zeichen).length
    if (bytes + laenge > grenze) {
      teile.push(aktuell)
      aktuell = ''
      bytes = 0
      grenze = 74 // + führendes Leerzeichen = 75
    }
    aktuell += zeichen
    bytes += laenge
  }
  teile.push(aktuell)
  return teile.join('\r\n ')
}

const p2 = (n: number) => String(n).padStart(2, '0')

function utc(d: Date): string {
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`
}

const BERLIN_TAG = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Kalendertag in Berlin als [Jahr, Monat, Tag] — ganztägige Termine werden im CRM ab Mitternacht deutscher Zeit gespeichert. */
function berlinTag(d: Date): [number, number, number] {
  const teile = Object.fromEntries(BERLIN_TAG.formatToParts(d).map((t) => [t.type, t.value]))
  return [Number(teile.year), Number(teile.month), Number(teile.day)]
}

function datumWert([j, m, t]: [number, number, number], plus = 0): string {
  const d = new Date(Date.UTC(j, m - 1, t + plus))
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`
}

export function baueIcs(termine: AboTermin[], ich: string, namen: Map<string, string>, jetzt = new Date()): string {
  const zeilen: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mayer Holding CRM//Kalender-Abo//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Mayer Holding CRM',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ]
  const stempel = utc(jetzt)
  for (const t of termine) {
    const von = new Date(t.beginn)
    const bis = new Date(t.ende)
    if (Number.isNaN(von.getTime()) || Number.isNaN(bis.getTime())) continue
    zeilen.push('BEGIN:VEVENT')
    zeilen.push(`UID:${maskiereText(String(t.id))}@${UID_DOMAIN}`)
    zeilen.push(`DTSTAMP:${stempel}`)
    if (t.ganztags) {
      const start = berlinTag(von)
      // Ende exklusiv: der Tag nach dem letzten belegten Tag (gespeichert ist Mitternacht danach).
      let ende = datumWert(berlinTag(new Date(Math.max(bis.getTime() - 1, von.getTime()))), 1)
      if (ende <= datumWert(start)) ende = datumWert(start, 1)
      zeilen.push(`DTSTART;VALUE=DATE:${datumWert(start)}`)
      zeilen.push(`DTEND;VALUE=DATE:${ende}`)
    } else {
      zeilen.push(`DTSTART:${utc(von)}`)
      zeilen.push(`DTEND:${utc(bis.getTime() > von.getTime() ? bis : new Date(von.getTime() + 60000))}`)
    }
    zeilen.push(`SUMMARY:${maskiereText(String(t.titel ?? '').trim() || 'Termin')}`)
    const ort = String(t.ort ?? '').trim()
    if (ort) zeilen.push(`LOCATION:${maskiereText(ort)}`)
    const andere = [t.besitzer_email, ...(t.teilnehmer ?? [])].map((p) => String(p).toLowerCase()).filter((p, i, a) => p !== ich && a.indexOf(p) === i)
    const beschreibung = [
      t.kunde_name ? `Kunde: ${t.kunde_name}` : '',
      andere.length > 0 ? `Gemeinsam mit: ${andere.map((p) => namen.get(p) ?? p).join(', ')}` : '',
      String(t.beschreibung ?? '').trim().slice(0, 8000),
    ].filter(Boolean)
    if (beschreibung.length > 0) zeilen.push(`DESCRIPTION:${maskiereText(beschreibung.join('\n\n'))}`)
    const geaendert = t.geaendert_am ? new Date(t.geaendert_am) : null
    if (geaendert && !Number.isNaN(geaendert.getTime())) zeilen.push(`LAST-MODIFIED:${utc(geaendert)}`)
    zeilen.push('STATUS:CONFIRMED')
    zeilen.push('TRANSP:OPAQUE')
    zeilen.push('END:VEVENT')
  }
  zeilen.push('END:VCALENDAR')
  return zeilen.map(falteZeile).join('\r\n') + '\r\n'
}

// ---------- Abruf durch die Kalender-App ----------

const NICHT_GEFUNDEN = () => new Response('Nicht gefunden', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

/**
 * Beantwortet GET/HEAD. Ohne gültige Kennung immer 404 ohne Einzelheiten — auch für jeden anderen
 * GET-Aufruf der Funktion, damit dort nie etwas anderes ausgeliefert wird.
 */
export async function kalenderAboAntwort(admin: Db, token: string | null, methode: string, jetzt = new Date()): Promise<Response> {
  const kennung = (token ?? '').trim()
  if (!TOKEN_MUSTER.test(kennung)) return NICHT_GEFUNDEN()
  try {
    const { data: einst, error } = await admin.from('kalender_einstellungen').select('email, feed_token').eq('feed_token', kennung).maybeSingle()
    if (error) throw new Error(error.message)
    // Doppelt prüfen, falls die Abfrage anders filtert als gedacht.
    if (!einst?.email || einst.feed_token !== kennung) return NICHT_GEFUNDEN()
    const ich = String(einst.email).toLowerCase()

    const { data: team, error: teamFehler } = await admin.from('mitarbeiter').select('name, email').eq('aktiv', true)
    if (teamFehler) throw new Error(teamFehler.message)
    const namen = new Map<string, string>()
    for (const m of (team ?? []) as { name: string | null; email: string | null }[]) {
      if (m.email) namen.set(String(m.email).toLowerCase(), m.name || String(m.email))
    }
    if (!namen.has(ich)) return NICHT_GEFUNDEN()

    const von = new Date(jetzt.getTime() - TAGE_ZURUECK * TAG_MS).toISOString()
    const bisDatum = new Date(jetzt.getTime())
    bisDatum.setUTCMonth(bisDatum.getUTCMonth() + MONATE_VORAUS)
    const bis = bisDatum.toISOString()
    const spalten = 'id, titel, beschreibung, ort, beginn, ende, ganztags, besitzer_email, teilnehmer, kunde_name, geaendert_am'
    const muster = ich.replace(/[\\%_]/g, (z) => `\\${z}`)
    const [eigene, dabei] = await Promise.all([
      admin.from('termine').select(spalten).ilike('besitzer_email', muster).lt('beginn', bis).gt('ende', von).order('beginn').limit(MAX_TERMINE),
      admin.from('termine').select(spalten).contains('teilnehmer', [ich]).lt('beginn', bis).gt('ende', von).order('beginn').limit(MAX_TERMINE),
    ])
    if (eigene.error) throw new Error(eigene.error.message)
    if (dabei.error) throw new Error(dabei.error.message)
    const termine = new Map<string, AboTermin>()
    for (const t of [...(eigene.data ?? []), ...(dabei.data ?? [])] as AboTermin[]) {
      const beteiligt = String(t.besitzer_email ?? '').toLowerCase() === ich || (t.teilnehmer ?? []).some((p) => String(p).toLowerCase() === ich)
      if (beteiligt) termine.set(t.id, t)
    }
    const liste = [...termine.values()].sort((a, b) => new Date(a.beginn).getTime() - new Date(b.beginn).getTime())
    const ics = baueIcs(liste, ich, namen, jetzt)
    const headers = {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="mayer-holding-crm.ics"',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
    }
    return new Response(methode === 'HEAD' ? null : ics, { status: 200, headers })
  } catch (err) {
    console.error('Kalender-Abo fehlgeschlagen:', err instanceof Error ? err.message : err)
    return new Response('Vorübergehend nicht erreichbar', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '300' } })
  }
}
