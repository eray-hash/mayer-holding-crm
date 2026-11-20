// Microsoft-Konto eines Mitarbeiters (Outlook/Hotmail, To Do, Kalender) über Microsoft Graph.
//
// Nur für den Bereich „Privat“ und nur für freigegebene Logins (Function-Secret MS_ERLAUBT, Komma-Liste der
// CRM-Anmeldeadressen — bewusst nicht im Code, das Repository ist öffentlich).
//
// - Anmeldung: Autorisierungscode mit Prüfwert (PKCE) und App-Geheimnis. Der Browser holt sich über
//   `ms_anmelden_start` die Microsoft-Adresse; Microsoft leitet danach auf email-gateway/ms-rueckruf zurück.
//   Die Kennung (`state`) gilt einmal und 10 Minuten und bindet den Rückruf an den CRM-Login, der ihn gestartet hat.
// - Tabellen: `ms_konten` (Status, für den Besitzer lesbar), `ms_geheimnisse` (Zugang verschlüsselt, nur Server),
//   `ms_anmeldungen` (laufende Anmeldungen, nur Server).
// - Microsoft gibt beim Erneuern jedes Mal einen neuen Erneuerungsschlüssel aus; der alte wird damit wertlos.
//   Deshalb erneuert immer nur einer (Sperre `ms_konten.erneuerung_seit`), und der neue wird sofort gespeichert.
import { entschluessele, verschluessele, zuBase64, zufallsKennung } from './geheim.ts'

// deno-lint-ignore no-explicit-any
type Db = any

// Mandant der App-Registrierung: Hasans App „Persönlicher Assistent“ ist auf „nur persönliche Microsoft-Konten“
// eingestellt → `consumers`. Eine App für Geschäfts- und Privatkonten bräuchte `common` (Secret MS_MANDANT).
const MANDANT = /^(consumers|common|organizations|[0-9a-f-]{36})$/.test(Deno.env.get('MS_MANDANT') ?? '') ? Deno.env.get('MS_MANDANT')! : 'consumers'
const ANMELDUNG = `https://login.microsoftonline.com/${MANDANT}/oauth2/v2.0`
export const GRAPH = 'https://graph.microsoft.com/v1.0'
export const MS_RECHTE = ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send', 'Calendars.ReadWrite', 'Tasks.ReadWrite']
const ANMELDUNG_GUELTIG_MS = 10 * 60 * 1000

export class MsNichtVerbunden extends Error {}
export class MsFehler extends Error {
  constructor(public status: number, meldung: string, public code = '') {
    super(meldung)
  }
}

export type MsStatus = {
  erlaubt: boolean
  eingerichtet: boolean
  verbunden: boolean
  adresse?: string
  name?: string
  verbundenAm?: string
  letzterFehler?: string | null
  letzterErfolg?: string | null
}

type Zugang = { erneuerung: string; zugang?: string; ablauf?: number }

// ---------- Freigabe und Einrichtung ----------

export function msEingerichtet(): boolean {
  return !!(Deno.env.get('MS_CLIENT_ID') && Deno.env.get('MS_CLIENT_SECRET'))
}

export function msErlaubt(email: string): boolean {
  const liste = (Deno.env.get('MS_ERLAUBT') ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  return liste.includes(email.trim().toLowerCase())
}

export function rueckrufAdresse(): string {
  return Deno.env.get('MS_RUECKRUF_URL') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-gateway/ms-rueckruf`
}

/** Nur die echte CRM-Seite (oder lokal) darf Ziel des Rücksprungs sein. */
export function erlaubterRuecksprung(basis: string): boolean {
  return /^https:\/\/eray-hash\.github\.io\/mayer-holding-crm\/?$|^http:\/\/localhost:\d+\/?$/.test(basis)
}

export async function msStatus(admin: Db, email: string): Promise<MsStatus> {
  const erlaubt = msErlaubt(email)
  const eingerichtet = msEingerichtet()
  if (!erlaubt) return { erlaubt, eingerichtet, verbunden: false }
  const { data } = await admin.from('ms_konten').select('ms_adresse, ms_name, verbunden_am, letzter_fehler, letzter_erfolg').eq('login_email', email.toLowerCase()).maybeSingle()
  if (!data) return { erlaubt, eingerichtet, verbunden: false }
  return {
    erlaubt,
    eingerichtet,
    verbunden: true,
    adresse: data.ms_adresse ?? undefined,
    name: data.ms_name ?? undefined,
    verbundenAm: data.verbunden_am,
    letzterFehler: data.letzter_fehler,
    letzterErfolg: data.letzter_erfolg,
  }
}

// ---------- Anmeldung ----------

async function pruefwertZuChallenge(pruefwert: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pruefwert)))
  return zuBase64(hash).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Legt einen Anmeldevorgang an und gibt die Microsoft-Adresse zurück, auf die der Browser wechselt. */
export async function anmeldungStarten(admin: Db, email: string, ruecksprung: string): Promise<string> {
  if (!msEingerichtet()) throw new Error('Die Microsoft-Anbindung ist noch nicht eingerichtet (App-Registrierung fehlt).')
  if (!msErlaubt(email)) throw new MsFehler(403, 'Die Microsoft-Anbindung ist für dieses Konto nicht freigeschaltet.')
  if (!erlaubterRuecksprung(ruecksprung)) throw new MsFehler(400, 'Ungültige Rücksprung-Adresse.')
  // Alte, nie abgeschlossene Vorgänge aufräumen (nur abgelaufene).
  await admin.from('ms_anmeldungen').delete().lt('erstellt_am', new Date(Date.now() - ANMELDUNG_GUELTIG_MS).toISOString())
  const kennung = zufallsKennung(32)
  const pruefwert = zufallsKennung(48)
  const { error } = await admin.from('ms_anmeldungen').insert({ kennung, login_email: email.toLowerCase(), pruefwert, ruecksprung })
  if (error) throw new Error(`Anmeldung konnte nicht gestartet werden: ${error.message}`)
  const p = new URLSearchParams({
    client_id: Deno.env.get('MS_CLIENT_ID')!,
    response_type: 'code',
    redirect_uri: rueckrufAdresse(),
    response_mode: 'query',
    scope: MS_RECHTE.join(' '),
    state: kennung,
    code_challenge: await pruefwertZuChallenge(pruefwert),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return `${ANMELDUNG}/authorize?${p}`
}

async function schluesselAnfrage(felder: Record<string, string>): Promise<Record<string, unknown>> {
  const antwort = await fetch(`${ANMELDUNG}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('MS_CLIENT_ID')!, client_secret: Deno.env.get('MS_CLIENT_SECRET')!, scope: MS_RECHTE.join(' '), ...felder }),
  })
  const daten = await antwort.json().catch(() => ({}))
  if (!antwort.ok) {
    const code = String(daten?.error ?? '')
    throw new MsFehler(antwort.status, String(daten?.error_description ?? code ?? `Microsoft antwortet ${antwort.status}`).split('\r\n')[0].slice(0, 300), code)
  }
  return daten
}

async function speichereZugang(admin: Db, email: string, z: Zugang): Promise<void> {
  const { error } = await admin.from('ms_geheimnisse').upsert({ login_email: email, verschluesselt: await verschluessele(JSON.stringify(z)), geaendert_am: new Date().toISOString() })
  if (error) throw new Error(`Microsoft-Zugang konnte nicht gespeichert werden: ${error.message}`)
}

function zugangAus(daten: Record<string, unknown>, bisher?: string): Zugang {
  const erneuerung = String(daten.refresh_token ?? bisher ?? '')
  if (!erneuerung) throw new MsFehler(400, 'Microsoft hat keinen dauerhaften Zugang erteilt (Recht offline_access fehlt).')
  return { erneuerung, zugang: String(daten.access_token ?? ''), ablauf: Date.now() + (Number(daten.expires_in ?? 3600) - 120) * 1000 }
}

export type RueckrufErgebnis = { ruecksprung: string; ok: boolean; meldung: string }

/** Verarbeitet den Rückruf von Microsoft. Wirft nie; gibt immer zurück, wohin der Browser soll. */
export async function anmeldungAbschliessen(admin: Db, params: URLSearchParams): Promise<RueckrufErgebnis | null> {
  const kennung = params.get('state') ?? ''
  if (!kennung) return null
  // Einmal verwenden: sofort löschen und nur weitermachen, wenn genau diese Zeile gelöscht wurde.
  const { data: vorgang } = await admin.from('ms_anmeldungen').delete().eq('kennung', kennung).select('login_email, pruefwert, ruecksprung, erstellt_am').maybeSingle()
  if (!vorgang) return null
  const ruecksprung = String(vorgang.ruecksprung)
  if (Date.now() - new Date(vorgang.erstellt_am).getTime() > ANMELDUNG_GUELTIG_MS) return { ruecksprung, ok: false, meldung: 'Die Anmeldung hat zu lange gedauert. Bitte noch einmal verbinden.' }
  if (params.get('error')) {
    const abgebrochen = params.get('error') === 'access_denied'
    return { ruecksprung, ok: false, meldung: abgebrochen ? 'Die Anmeldung wurde abgebrochen oder die Rechte wurden nicht erteilt.' : `Microsoft meldet: ${(params.get('error_description') ?? params.get('error') ?? '').slice(0, 200)}` }
  }
  const code = params.get('code') ?? ''
  if (!code) return { ruecksprung, ok: false, meldung: 'Microsoft hat keinen Anmeldecode geschickt.' }
  const email = String(vorgang.login_email)
  try {
    if (!msErlaubt(email)) return { ruecksprung, ok: false, meldung: 'Die Microsoft-Anbindung ist für dieses Konto nicht freigeschaltet.' }
    const daten = await schluesselAnfrage({ grant_type: 'authorization_code', code, redirect_uri: rueckrufAdresse(), code_verifier: String(vorgang.pruefwert) })
    const zugang = zugangAus(daten)
    const ich = await fetch(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`, { headers: { authorization: `Bearer ${zugang.zugang}` } }).then((r) => r.json()).catch(() => ({}))
    const adresse = String(ich?.mail || ich?.userPrincipalName || '').toLowerCase()
    const { error } = await admin.from('ms_konten').upsert({
      login_email: email,
      ms_adresse: adresse || null,
      ms_name: ich?.displayName ?? null,
      verbunden_am: new Date().toISOString(),
      letzter_fehler: null,
      letzter_erfolg: new Date().toISOString(),
      erneuerung_seit: null,
      stand: {},
    })
    if (error) throw new Error(error.message)
    await speichereZugang(admin, email, zugang)
    return { ruecksprung, ok: true, meldung: adresse ? `Verbunden mit ${adresse}.` : 'Verbunden.' }
  } catch (e) {
    console.error('Microsoft-Anmeldung fehlgeschlagen', e instanceof Error ? e.message : e)
    return { ruecksprung, ok: false, meldung: `Verbinden fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }
  }
}

export async function msTrennen(admin: Db, email: string): Promise<void> {
  await admin.from('ms_konten').delete().eq('login_email', email.toLowerCase())
}

// ---------- Zugang ----------

async function ladeZugang(admin: Db, email: string): Promise<Zugang> {
  const { data } = await admin.from('ms_geheimnisse').select('verschluesselt').eq('login_email', email).maybeSingle()
  if (!data?.verschluesselt) throw new MsNichtVerbunden('Kein Microsoft-Konto verbunden.')
  try {
    return JSON.parse(await entschluessele(data.verschluesselt)) as Zugang
  } catch {
    throw new MsNichtVerbunden('Der gespeicherte Microsoft-Zugang ist nicht mehr lesbar — bitte neu verbinden.')
  }
}

async function vermerkeFehler(admin: Db, email: string, meldung: string | null): Promise<void> {
  const feld = meldung ? { letzter_fehler: meldung.slice(0, 300) } : { letzter_fehler: null, letzter_erfolg: new Date().toISOString() }
  await admin.from('ms_konten').update(feld).eq('login_email', email)
}

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Gültiger Zugangsschlüssel; erneuert bei Bedarf (nur einer gleichzeitig). */
export async function msZugang(admin: Db, email: string, erzwingen = false): Promise<string> {
  email = email.toLowerCase()
  for (let versuch = 0; versuch < 8; versuch++) {
    const z = await ladeZugang(admin, email)
    if (!erzwingen && z.zugang && (z.ablauf ?? 0) > Date.now()) return z.zugang
    // Sperre holen: nur wenn niemand gerade (in der letzten Minute) erneuert.
    const grenze = new Date(Date.now() - 60_000).toISOString()
    const { data: gesperrt } = await admin
      .from('ms_konten')
      .update({ erneuerung_seit: new Date().toISOString() })
      .eq('login_email', email)
      .or(`erneuerung_seit.is.null,erneuerung_seit.lt.${grenze}`)
      .select('login_email')
    if (!gesperrt?.length) {
      await warte(700)
      erzwingen = false // ein anderer erneuert gerade — danach dessen Schlüssel nehmen
      continue
    }
    try {
      const daten = await schluesselAnfrage({ grant_type: 'refresh_token', refresh_token: z.erneuerung })
      const neu = zugangAus(daten, z.erneuerung)
      await speichereZugang(admin, email, neu)
      return neu.zugang!
    } catch (e) {
      if (e instanceof MsFehler && (e.code === 'invalid_grant' || e.code === 'interaction_required')) {
        await vermerkeFehler(admin, email, 'Die Microsoft-Anmeldung ist abgelaufen oder wurde widerrufen — bitte neu verbinden.')
        throw new MsNichtVerbunden('Die Microsoft-Anmeldung ist abgelaufen — bitte im Bereich Privat neu verbinden.')
      }
      throw e
    } finally {
      await admin.from('ms_konten').update({ erneuerung_seit: null }).eq('login_email', email)
    }
  }
  throw new MsFehler(503, 'Microsoft-Zugang wird gerade erneuert — bitte gleich noch einmal versuchen.')
}

export type GraphOptionen = { methode?: string; daten?: unknown; kopf?: Record<string, string>; roh?: boolean }

/**
 * Anfrage an Microsoft Graph für genau diesen CRM-Login. `pfad` beginnt mit "/" (relativ zu v1.0) oder ist eine
 * volle Graph-Adresse (z. B. @odata.nextLink). Wiederholt bei 429/503 (Retry-After, höchstens ~20 s gesamt)
 * und einmal mit frischem Schlüssel bei 401.
 */
export async function graph<T = Record<string, unknown>>(admin: Db, email: string, pfad: string, o: GraphOptionen = {}): Promise<T> {
  const url = pfad.startsWith('https://') ? pfad : `${GRAPH}${pfad}`
  if (!url.startsWith(GRAPH)) throw new Error('Nur Microsoft-Graph-Adressen sind erlaubt.')
  let gewartet = 0
  let frisch = false
  for (let versuch = 0; versuch < 6; versuch++) {
    const schluessel = await msZugang(admin, email, frisch)
    const kopf: Record<string, string> = { authorization: `Bearer ${schluessel}`, ...(o.kopf ?? {}) }
    if (o.daten !== undefined) kopf['content-type'] = 'application/json'
    const antwort = await fetch(url, { method: o.methode ?? 'GET', headers: kopf, body: o.daten === undefined ? undefined : JSON.stringify(o.daten) })
    if ((antwort.status === 429 || antwort.status === 503 || antwort.status === 504) && gewartet < 20_000) {
      const sek = Math.min(Number(antwort.headers.get('retry-after')) || 2 ** versuch, 10)
      gewartet += sek * 1000
      await warte(sek * 1000)
      continue
    }
    if (antwort.status === 401 && !frisch) {
      frisch = true
      continue
    }
    if (!antwort.ok) {
      const daten = await antwort.json().catch(() => ({}))
      const meldung = String(daten?.error?.message ?? `Microsoft antwortet ${antwort.status}`).slice(0, 300)
      if (antwort.status >= 500 || antwort.status === 401) await vermerkeFehler(admin, email.toLowerCase(), meldung)
      throw new MsFehler(antwort.status, meldung, String(daten?.error?.code ?? ''))
    }
    if (o.roh) return antwort as unknown as T
    if (antwort.status === 204) return {} as T
    const text = await antwort.text()
    return (text ? JSON.parse(text) : {}) as T
  }
  throw new MsFehler(429, 'Microsoft bremst gerade — bitte gleich noch einmal versuchen.')
}

/** Alle Seiten einer Graph-Liste (über @odata.nextLink), höchstens `maximal` Einträge. */
export async function graphAlle<T = Record<string, unknown>>(admin: Db, email: string, pfad: string, maximal = 1000, kopf?: Record<string, string>): Promise<T[]> {
  let daten = await graph<{ value?: T[]; '@odata.nextLink'?: string }>(admin, email, pfad, { kopf })
  const werte = [...(daten.value ?? [])]
  while (daten['@odata.nextLink'] && werte.length < maximal) {
    daten = await graph(admin, email, daten['@odata.nextLink'], { kopf })
    werte.push(...(daten.value ?? []))
  }
  return werte.slice(0, maximal)
}

// ---------- Zeiten ----------

export const OUTLOOK_ZEITZONE = 'W. Europe Standard Time'

/**
 * Outlook-Zeitangabe {dateTime, timeZone} → ISO-Zeitpunkt (UTC). To Do liefert Fälligkeiten in UTC
 * (21.11. 00:00 deutscher Zeit kommt als '2026-11-20T23:00:00 UTC') — ohne Umrechnung wäre jedes Datum
 * einen Tag zu früh.
 */
export function msZeitZuIso(dt: { dateTime?: string; timeZone?: string } | null | undefined): string | null {
  if (!dt?.dateTime) return null
  const wert = dt.dateTime.slice(0, 19)
  const zone = dt.timeZone ?? 'UTC'
  if (zone === 'UTC' || zone === 'tzone://Microsoft/Utc' || zone === 'Etc/GMT') return new Date(`${wert}Z`).toISOString()
  return berlinZuUtc(wert)
}

/** 'JJJJ-MM-TTTHH:MM:SS' als deutsche Ortszeit → ISO (UTC), sommerzeitrichtig. */
export function berlinZuUtc(lokal: string): string {
  const alsUtc = new Date(`${lokal.slice(0, 19)}Z`)
  // Versatz Berlins zu diesem Zeitpunkt ermitteln (zweimal, wegen der Umstellungsstunde).
  let versatz = berlinVersatzMinuten(alsUtc)
  let ergebnis = new Date(alsUtc.getTime() - versatz * 60_000)
  versatz = berlinVersatzMinuten(ergebnis)
  ergebnis = new Date(alsUtc.getTime() - versatz * 60_000)
  return ergebnis.toISOString()
}

function berlinVersatzMinuten(d: Date): number {
  const teile = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d)
  const w = (t: string) => Number(teile.find((p) => p.type === t)?.value)
  const alsUtc = Date.UTC(w('year'), w('month') - 1, w('day'), w('hour'), w('minute'), w('second'))
  return Math.round((alsUtc - d.getTime()) / 60_000)
}

/** ISO-Zeitpunkt → Outlook-Zeitangabe in deutscher Zeit. */
export function isoZuMsZeit(iso: string): { dateTime: string; timeZone: string } {
  const teile = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
  return { dateTime: teile.replace(' ', 'T'), timeZone: OUTLOOK_ZEITZONE }
}
