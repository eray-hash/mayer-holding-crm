// Online-Terminbuchung: Kunden buchen selbst einen freien Termin bei einem Mitarbeiter
// (öffentliche Seite /formular/termin/:kennung).
//
// - Jeder Mitarbeiter stellt seine Buchungsseite selbst ein (`kalender_einstellungen.buchung`):
//   an/aus, Titel, Dauer, Puffer, Mindestvorlauf, wie weit im Voraus, Zeiten je Wochentag, Ort,
//   Hinweis. Beim ersten Einschalten bekommt er eine zufällige Kennung (`buchung_kennung`) — sie
//   steht in der Adresse der Buchungsseite. Ausschalten sperrt die Seite sofort (404).
// - Frei ist eine Uhrzeit, wenn sie in den eingestellten Zeiten liegt, der Mindestvorlauf eingehalten
//   ist und sie samt Puffer (davor und danach) keinen Termin mit Uhrzeit berührt, bei dem der
//   Mitarbeiter Besitzer oder Teilnehmer ist. Ganztägige Einträge blockieren nicht — wie in
//   kalender.ts (`findeUeberschneidungen`), dort sind sie meist Erinnerungen.
// - Gerechnet wird in deutscher Zeit (Europe/Berlin) über Intl, also auch über die Zeitumstellung
//   hinweg richtig; nie mit festem +01:00.
// - Nach außen geht nur: Name des Mitarbeiters, Titel, Dauer, Ort, Hinweis und die freien Zeiten.
//   Nie Titel, Inhalt oder Lage anderer Termine (außer, dass eine Zeit eben nicht frei ist).
// - Beim Buchen: Zeit noch einmal prüfen, Termin anlegen (quelle 'buchung', Gast in `gast`), danach
//   noch einmal auf gleichzeitige Buchung prüfen, Mitarbeiter per Telegram benachrichtigen, Kunde
//   bekommt eine Bestätigung mit Kalenderdatei (.ics).
import { ERLAUBTE_ERINNERUNGEN, sendeTelegram, zeitraumText } from './kalender.ts'
import { icsAnhang } from '../_shared/ics.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// Der Dienst-Zugang zur Datenbank — wie in kalender.ts/kalenderAbo.ts.
// deno-lint-ignore no-explicit-any
type Db = any

export type BuchungsKontext = {
  /** E-Mail des angemeldeten Mitarbeiters (nur bei den Einstellungs-Aktionen gesetzt, sonst undefined) */
  aufruferEmail?: string
  sendeMail: (to: string, subject: string, text: string, anhaenge?: { filename: string; contentBase64: string; contentType: string }[]) => Promise<void>
  grenzeErreicht: (grenzen: { schluessel: string; hoechstens: number }[]) => Promise<boolean>
}

export const BUCHUNGS_AKTIONEN = new Set(['buchung_einstellungen_laden', 'buchung_einstellungen_speichern', 'public_buchung_info', 'public_buchung_anlegen'])

// ---------- Einstellungen ----------

export type Zeitraum = [string, string]

export type BuchungsEinstellungen = {
  aktiv: boolean
  titel: string
  dauer_min: number
  puffer_min: number
  vorlauf_std: number
  tage_voraus: number
  /** ISO-Wochentag "1" (Montag) bis "7" (Sonntag) → Zeiträume ["HH:MM","HH:MM"] in deutscher Zeit. */
  zeiten: Record<string, Zeitraum[]>
  ort: string
  hinweis: string
}

export const DAUER_WAHL = [15, 30, 45, 60, 90]
export const PUFFER_WAHL = [0, 5, 10, 15, 30]
const MAX_TAGE_VORAUS = 90
const MAX_VORLAUF_STD = 720
const MAX_ZEITRAEUME_JE_TAG = 3
const KENNUNG_MUSTER = /^[A-Za-z0-9_-]{12,64}$/
const UHRZEIT_MUSTER = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/
const STUNDE_MS = 3600000
const MINUTE_MS = 60000

export function standardEinstellungen(): BuchungsEinstellungen {
  const werktag: Zeitraum[] = [['09:00', '12:00'], ['13:00', '17:00']]
  return {
    aktiv: false,
    titel: 'Beratungsgespräch',
    dauer_min: 30,
    puffer_min: 0,
    vorlauf_std: 24,
    tage_voraus: 30,
    zeiten: { '1': werktag, '2': werktag, '3': werktag, '4': werktag, '5': werktag, '6': [], '7': [] },
    ort: '',
    hinweis: '',
  }
}

const minutenVon = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Strenge Prüfung beim Speichern. Liefert die bereinigten Einstellungen oder eine Fehlermeldung. */
export function pruefeEinstellungen(roh: unknown): { ok: true; buchung: BuchungsEinstellungen } | { ok: false; fehler: string } {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return { ok: false, fehler: 'Die Einstellungen fehlen.' }
  // deno-lint-ignore no-explicit-any
  const r = roh as any
  if (typeof r.aktiv !== 'boolean') return { ok: false, fehler: 'Bitte angeben, ob die Online-Buchung an oder aus ist.' }
  const titel = String(r.titel ?? '').replace(/\s+/g, ' ').trim()
  if (titel.length < 2 || titel.length > 80) return { ok: false, fehler: 'Der Titel muss 2 bis 80 Zeichen lang sein.' }
  const dauer = Number(r.dauer_min)
  if (!DAUER_WAHL.includes(dauer)) return { ok: false, fehler: `Dauer bitte aus ${DAUER_WAHL.join(', ')} Minuten wählen.` }
  const puffer = Number(r.puffer_min)
  if (!PUFFER_WAHL.includes(puffer)) return { ok: false, fehler: `Puffer bitte aus ${PUFFER_WAHL.join(', ')} Minuten wählen.` }
  const vorlauf = Number(r.vorlauf_std)
  if (!Number.isInteger(vorlauf) || vorlauf < 0 || vorlauf > MAX_VORLAUF_STD) return { ok: false, fehler: `Der Mindestvorlauf muss eine ganze Zahl von 0 bis ${MAX_VORLAUF_STD} Stunden sein.` }
  const tage = Number(r.tage_voraus)
  if (!Number.isInteger(tage) || tage < 1 || tage > MAX_TAGE_VORAUS) return { ok: false, fehler: `„Wie weit im Voraus“ muss eine ganze Zahl von 1 bis ${MAX_TAGE_VORAUS} Tagen sein.` }
  if (!r.zeiten || typeof r.zeiten !== 'object' || Array.isArray(r.zeiten)) return { ok: false, fehler: 'Die Zeiten je Wochentag fehlen.' }
  const erlaubteTage = ['1', '2', '3', '4', '5', '6', '7']
  for (const schluessel of Object.keys(r.zeiten)) if (!erlaubteTage.includes(schluessel)) return { ok: false, fehler: 'Unbekannter Wochentag in den Zeiten.' }
  const tagName = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
  const zeiten: Record<string, Zeitraum[]> = {}
  let irgendeineZeit = false
  for (const tag of erlaubteTage) {
    const liste = r.zeiten[tag] ?? []
    if (!Array.isArray(liste)) return { ok: false, fehler: `Zeiten am ${tagName[Number(tag)]} sind ungültig.` }
    if (liste.length > MAX_ZEITRAEUME_JE_TAG) return { ok: false, fehler: `Am ${tagName[Number(tag)]} höchstens ${MAX_ZEITRAEUME_JE_TAG} Zeiträume.` }
    const raeume: Zeitraum[] = []
    for (const z of liste) {
      if (!Array.isArray(z) || z.length !== 2 || typeof z[0] !== 'string' || typeof z[1] !== 'string' || !UHRZEIT_MUSTER.test(z[0]) || !UHRZEIT_MUSTER.test(z[1])) {
        return { ok: false, fehler: `Uhrzeit am ${tagName[Number(tag)]} bitte als SS:MM angeben (z. B. 09:00).` }
      }
      if (minutenVon(z[1]) - minutenVon(z[0]) < dauer) return { ok: false, fehler: `Am ${tagName[Number(tag)]} ist ein Zeitraum kürzer als die Termindauer (${dauer} Minuten).` }
      raeume.push([z[0], z[1]])
    }
    raeume.sort((a, b) => minutenVon(a[0]) - minutenVon(b[0]))
    for (let i = 1; i < raeume.length; i++) {
      if (minutenVon(raeume[i][0]) < minutenVon(raeume[i - 1][1])) return { ok: false, fehler: `Am ${tagName[Number(tag)]} überschneiden sich die Zeiträume.` }
    }
    if (raeume.length > 0) irgendeineZeit = true
    zeiten[tag] = raeume
  }
  if (r.aktiv && !irgendeineZeit) return { ok: false, fehler: 'Bitte mindestens an einem Wochentag Zeiten eintragen, sonst kann niemand buchen.' }
  const ort = String(r.ort ?? '').trim()
  if (ort.length > 200) return { ok: false, fehler: 'Der Ort darf höchstens 200 Zeichen lang sein.' }
  const hinweis = String(r.hinweis ?? '').trim()
  if (hinweis.length > 1000) return { ok: false, fehler: 'Der Hinweis darf höchstens 1000 Zeichen lang sein.' }
  return { ok: true, buchung: { aktiv: r.aktiv, titel, dauer_min: dauer, puffer_min: puffer, vorlauf_std: vorlauf, tage_voraus: tage, zeiten, ort, hinweis } }
}

/** Gespeicherte (oder fehlende) Einstellungen lesen: Unvollständiges mit Standardwerten auffüllen. */
export function leseEinstellungen(roh: unknown): BuchungsEinstellungen {
  const std = standardEinstellungen()
  if (!roh || typeof roh !== 'object') return std
  const geprueft = pruefeEinstellungen({ ...std, ...(roh as Record<string, unknown>) })
  if (geprueft.ok) return geprueft.buchung
  // Kaputt gespeichert: lieber aus als mit Unsinn rechnen.
  return { ...std, aktiv: false }
}

function neueKennung(): string {
  const bytes = new Uint8Array(12) // 12 Byte → 16 Zeichen base64url
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------- Deutsche Zeit ----------

const BERLIN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type Wand = { j: number; m: number; t: number; h: number; min: number }

function berlinWand(ms: number): Wand {
  const teile = Object.fromEntries(BERLIN.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return { j: Number(teile.year), m: Number(teile.month), t: Number(teile.day), h: Number(teile.hour) % 24, min: Number(teile.minute) }
}

/** Abstand Berlin–UTC in Minuten zu diesem Zeitpunkt (60 im Winter, 120 im Sommer). */
function berlinVersatz(ms: number): number {
  const w = berlinWand(ms)
  const minute = Math.floor(ms / MINUTE_MS) * MINUTE_MS
  return Math.round((Date.UTC(w.j, w.m - 1, w.t, w.h, w.min) - minute) / MINUTE_MS)
}

/** Uhrzeit in deutscher Zeit → Zeitpunkt (ms). null, wenn es die Uhrzeit an dem Tag nicht gibt (Umstellung im Frühjahr). */
export function berlinZuUtc(j: number, m: number, t: number, h: number, min: number): number | null {
  const naiv = Date.UTC(j, m - 1, t, h, min)
  let ms = naiv - berlinVersatz(naiv) * MINUTE_MS
  ms = naiv - berlinVersatz(ms) * MINUTE_MS
  const w = berlinWand(ms)
  const soll = new Date(naiv)
  if (w.j !== soll.getUTCFullYear() || w.m !== soll.getUTCMonth() + 1 || w.t !== soll.getUTCDate() || w.h !== soll.getUTCHours() || w.min !== soll.getUTCMinutes()) return null
  return ms
}

const p2 = (n: number) => String(n).padStart(2, '0')

// ---------- Freie Zeiten ----------

export type Belegung = { id?: string; beginn: string; ende: string; erstellt_am?: string | null; quelle?: string | null }

/**
 * Nach dem Anlegen: Muss diese Buchung zurückgezogen werden? Ja, wenn in der Zeit (samt Puffer) ein anderer Termin
 * liegt — außer einer gleichzeitigen Online-Buchung, die NACH dieser angelegt wurde (die zieht sich selbst zurück).
 * Vorher zogen sich bei zwei gleichzeitigen Buchungen beide zurück, und keiner der Kunden bekam den Termin.
 */
export function mussZurueckziehen(meins: { id: string; erstellt_am?: string | null }, andere: Belegung[]): boolean {
  const zeit = (x?: string | null) => {
    const t = new Date(String(x ?? '')).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  const spaeter = (x: Belegung) => zeit(x.erstellt_am) > zeit(meins.erstellt_am) || (zeit(x.erstellt_am) === zeit(meins.erstellt_am) && String(x.id) > String(meins.id))
  return andere.some((x) => String(x.id) !== String(meins.id) && !(x.quelle === 'buchung' && spaeter(x)))
}
export type FreierTag = { datum: string; zeiten: string[] }

/**
 * Reine Rechnung (ohne Datenbank): freie Anfangszeiten ab heute (deutscher Kalendertag) bis
 * einschließlich heute + tage_voraus, gruppiert nach Tag. Nur Tage mit mindestens einer freien Zeit.
 * Raster: alle min(Dauer, 30) Minuten ab Beginn des Zeitraums.
 */
export function berechneFreieZeiten(b: BuchungsEinstellungen, belegt: Belegung[], jetzt: Date): FreierTag[] {
  const dauerMs = b.dauer_min * MINUTE_MS
  const pufferMs = b.puffer_min * MINUTE_MS
  const schritt = Math.min(b.dauer_min, 30)
  const fruehestens = jetzt.getTime() + b.vorlauf_std * STUNDE_MS
  const blocker = belegt
    .map((x) => ({ von: new Date(x.beginn).getTime(), bis: new Date(x.ende).getTime() }))
    .filter((x) => !Number.isNaN(x.von) && !Number.isNaN(x.bis))
  const heute = berlinWand(jetzt.getTime())
  const tage: FreierTag[] = []
  for (let i = 0; i <= b.tage_voraus; i++) {
    const d = new Date(Date.UTC(heute.j, heute.m - 1, heute.t + i))
    const [j, m, t] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
    const wochentag = String(((d.getUTCDay() + 6) % 7) + 1)
    const zeiten: string[] = []
    for (const [von, bis] of b.zeiten[wochentag] ?? []) {
      const ende = minutenVon(bis)
      for (let s = minutenVon(von); s + b.dauer_min <= ende; s += schritt) {
        const start = berlinZuUtc(j, m, t, Math.floor(s / 60), s % 60)
        if (start === null || start < fruehestens) continue
        const schluss = start + dauerMs
        if (blocker.some((x) => x.von < schluss + pufferMs && x.bis > start - pufferMs)) continue
        zeiten.push(new Date(start).toISOString())
      }
    }
    if (zeiten.length > 0) tage.push({ datum: `${j}-${p2(m)}-${p2(t)}`, zeiten: [...new Set(zeiten)].sort() })
  }
  return tage
}

// ---------- Datenbank ----------

const maske = (email: string) => email.replace(/[\\%_]/g, (z) => `\\${z}`)

/** Termine mit Uhrzeit, bei denen der Mitarbeiter Besitzer oder Teilnehmer ist und die [von, bis) berühren. */
async function ladeBelegung(admin: Db, email: string, von: string, bis: string): Promise<Belegung[]> {
  const spalten = 'id, beginn, ende, erstellt_am, quelle'
  const [eigene, dabei] = await Promise.all([
    alleZeilen(() => admin.from('termine').select(spalten).eq('ganztags', false).ilike('besitzer_email', maske(email)).lt('beginn', bis).gt('ende', von)),
    alleZeilen(() => admin.from('termine').select(spalten).eq('ganztags', false).contains('teilnehmer', [email]).lt('beginn', bis).gt('ende', von)),
  ])
  if (eigene.error) throw new Error(eigene.error.message)
  if (dabei.error) throw new Error(dabei.error.message)
  const alle = new Map<string, Belegung>()
  for (const x of [...(eigene.data ?? []), ...(dabei.data ?? [])] as Belegung[]) alle.set(String(x.id), x)
  return [...alle.values()]
}

type Kontext = { email: string; name: string; chat: number | string | null; buchung: BuchungsEinstellungen }

/** Buchungsseite zur Kennung — nur wenn eingeschaltet und der Mitarbeiter aktiv ist. */
async function ladeKontext(admin: Db, kennung: string): Promise<Kontext | null> {
  const { data: einst, error } = await admin.from('kalender_einstellungen').select('email, buchung, buchung_kennung').eq('buchung_kennung', kennung).maybeSingle()
  if (error) throw new Error(error.message)
  if (!einst?.email || einst.buchung_kennung !== kennung) return null
  const buchung = leseEinstellungen(einst.buchung)
  if (!buchung.aktiv) return null
  const email = String(einst.email).trim().toLowerCase()
  const { data: m, error: mFehler } = await admin.from('mitarbeiter').select('name, email, aktiv, telegram_chat_id').ilike('email', maske(email)).maybeSingle()
  if (mFehler) throw new Error(mFehler.message)
  if (!m || m.aktiv === false) return null
  return { email, name: String(m.name ?? '').trim() || 'Mayer Holding', chat: m.telegram_chat_id ?? null, buchung }
}

async function freieZeitenFuer(admin: Db, k: Kontext, jetzt: Date): Promise<FreierTag[]> {
  const von = new Date(jetzt.getTime() - STUNDE_MS).toISOString()
  const bis = new Date(jetzt.getTime() + (k.buchung.tage_voraus + 2) * 24 * STUNDE_MS).toISOString()
  const belegt = await ladeBelegung(admin, k.email, von, bis)
  return berechneFreieZeiten(k.buchung, belegt, jetzt)
}

// ---------- Texte ----------

const TAG_LANG = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })

function fehler(status: number, text: string) {
  return { status, inhalt: { error: text } }
}

const NICHT_GEFUNDEN = () => fehler(404, 'Diese Buchungsseite gibt es nicht oder sie ist zurzeit abgeschaltet.')
const EMAIL_MUSTER = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/

// ---------- Aktionen ----------

// deno-lint-ignore no-explicit-any
export async function buchungAktion(admin: any, body: any, k: BuchungsKontext): Promise<{ status: number; inhalt: unknown }> {
  const aktion = String(body?.action ?? '')
  try {
    if (aktion === 'buchung_einstellungen_laden' || aktion === 'buchung_einstellungen_speichern') {
      const ich = String(k.aufruferEmail ?? '').trim().toLowerCase()
      if (!ich) return fehler(401, 'Bitte neu einloggen — der Login-Nachweis fehlt oder ist abgelaufen.')
      const { data: zeile, error } = await admin.from('kalender_einstellungen').select('email, buchung, buchung_kennung').eq('email', ich).maybeSingle()
      if (error) return fehler(500, `Kalender-Einstellungen nicht lesbar: ${error.message}`)
      const kennungVorher = typeof zeile?.buchung_kennung === 'string' && KENNUNG_MUSTER.test(zeile.buchung_kennung) ? (zeile.buchung_kennung as string) : null

      if (aktion === 'buchung_einstellungen_laden') {
        return { status: 200, inhalt: { ok: true, buchung: leseEinstellungen(zeile?.buchung), kennung: kennungVorher } }
      }

      const geprueft = pruefeEinstellungen(body?.buchung)
      if (!geprueft.ok) return fehler(400, geprueft.fehler)
      const buchung = geprueft.buchung
      // Kennung beim ersten Einschalten; danach bleibt sie (auch beim Aus- und wieder Einschalten).
      let kennung = kennungVorher
      for (let versuch = 0; versuch < 3; versuch++) {
        const neu = !kennung && buchung.aktiv ? neueKennung() : null
        const felder = { buchung, ...(neu ? { buchung_kennung: neu } : {}), geaendert_am: new Date().toISOString() }
        const { error: schreibFehler } = zeile
          ? await admin.from('kalender_einstellungen').update(felder).eq('email', ich)
          : await admin.from('kalender_einstellungen').insert({ email: ich, erinnerungen: [60], sichtbar: true, ...felder })
        if (!schreibFehler) {
          if (neu) kennung = neu
          return { status: 200, inhalt: { ok: true, buchung, kennung } }
        }
        // Doppelte Kennung (eindeutiger Index) → neu würfeln; sonst echter Fehler.
        if (!(neu && /duplicate|unique|23505/i.test(`${schreibFehler.code ?? ''} ${schreibFehler.message ?? ''}`))) {
          return fehler(500, `Einstellungen konnten nicht gespeichert werden: ${schreibFehler.message}`)
        }
      }
      return fehler(500, 'Einstellungen konnten nicht gespeichert werden. Bitte noch einmal versuchen.')
    }

    if (aktion === 'public_buchung_info') {
      const kennung = String(body?.kennung ?? '').trim()
      if (!KENNUNG_MUSTER.test(kennung)) return NICHT_GEFUNDEN()
      const ktx = await ladeKontext(admin, kennung)
      if (!ktx) return NICHT_GEFUNDEN()
      const tage = await freieZeitenFuer(admin, ktx, new Date())
      return {
        status: 200,
        inhalt: { name: ktx.name, titel: ktx.buchung.titel, dauer_min: ktx.buchung.dauer_min, ort: ktx.buchung.ort, hinweis: ktx.buchung.hinweis, tage },
      }
    }

    if (aktion === 'public_buchung_anlegen') {
      const kennung = String(body?.kennung ?? '').trim()
      if (!KENNUNG_MUSTER.test(kennung)) return NICHT_GEFUNDEN()
      // Unsichtbares Feld gegen Programme: so tun, als hätte es geklappt, und nichts tun.
      if (String(body?.webseite ?? '').trim()) {
        const b = String(body?.beginn ?? '')
        return { status: 200, inhalt: { ok: true, beginn: b, ende: b } }
      }
      const name = String(body?.name ?? '').replace(/\s+/g, ' ').trim()
      if (name.length < 2 || name.length > 120) return fehler(400, 'Bitte Ihren Namen angeben (2 bis 120 Zeichen).')
      const email = String(body?.email ?? '').trim().toLowerCase()
      if (email.length > 200 || !EMAIL_MUSTER.test(email)) return fehler(400, 'Bitte eine gültige E-Mail-Adresse angeben.')
      const telefon = String(body?.telefon ?? '').trim()
      if (telefon.length > 40) return fehler(400, 'Die Telefonnummer ist zu lang.')
      const nachricht = String(body?.nachricht ?? '').trim()
      if (nachricht.length > 2000) return fehler(400, 'Die Nachricht darf höchstens 2000 Zeichen lang sein.')
      const beginn = new Date(String(body?.beginn ?? ''))
      if (Number.isNaN(beginn.getTime())) return fehler(400, 'Bitte eine Uhrzeit auswählen.')

      if (await k.grenzeErreicht([{ schluessel: `buchung:${kennung}`, hoechstens: 20 }, { schluessel: `buchung-mail:${email}`, hoechstens: 3 }])) {
        return fehler(429, 'Zu viele Buchungen in kurzer Zeit. Bitte versuchen Sie es in einer Stunde noch einmal oder rufen Sie uns an.')
      }

      const ktx = await ladeKontext(admin, kennung)
      if (!ktx) return NICHT_GEFUNDEN()
      const b = ktx.buchung
      const jetzt = new Date()
      const frei = (await freieZeitenFuer(admin, ktx, jetzt)).some((tag) => tag.zeiten.some((z) => new Date(z).getTime() === beginn.getTime()))
      const BELEGT = () => fehler(409, 'Diese Uhrzeit ist leider nicht mehr frei. Bitte wählen Sie eine andere.')
      if (!frei) return BELEGT()
      const ende = new Date(beginn.getTime() + b.dauer_min * MINUTE_MS)

      // Bestehenden Kunden mit genau dieser E-Mail-Adresse verknüpfen — nur bei genau einem Treffer.
      let kunde: { id: string; bereich: string; name: string } | null = null
      try {
        const { data: treffer } = await admin.from('kunden').select('id, bereich, firma, ansprechpartner').ilike('email', maske(email)).neq('bereich', 'privat').limit(2)
        if (Array.isArray(treffer) && treffer.length === 1) {
          const t = treffer[0]
          kunde = { id: String(t.id), bereich: String(t.bereich), name: String(t.firma || t.ansprechpartner || name) }
        }
      } catch (err) {
        console.error('Buchung: Kundensuche fehlgeschlagen:', err instanceof Error ? err.message : err)
      }

      const bisBeginn = (beginn.getTime() - jetzt.getTime()) / MINUTE_MS
      const zeile = {
        titel: `${b.titel}: ${name}`,
        beschreibung: [
          'Online gebucht über die Buchungsseite.',
          `Name: ${name}`,
          `E-Mail: ${email}`,
          telefon ? `Telefon: ${telefon}` : '',
          nachricht ? `\nNachricht:\n${nachricht}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        ort: b.ort,
        beginn: beginn.toISOString(),
        ende: ende.toISOString(),
        ganztags: false,
        besitzer_email: ktx.email,
        // Leer statt [Mitarbeiter]: kalender.ts hält Besitzer nie zusätzlich als Teilnehmer (speichereTermin
        // filtert ihn heraus) — sonst bekäme er beim Bearbeiten „hat dich aus einem Termin genommen“ und
        // beim Löschen „Termin abgesagt“ über seinen eigenen Termin.
        teilnehmer: [],
        kunde_id: kunde?.id ?? null,
        kunde_bereich: kunde?.bereich ?? null,
        kunde_name: kunde?.name ?? null,
        quelle: 'buchung',
        gast: { name, email, telefon, nachricht },
        // Wie in kalender.ts: schon verstrichene Vorläufe gelten als erledigt.
        erinnert: { [ktx.email]: ERLAUBTE_ERINNERUNGEN.filter((m) => bisBeginn <= m) },
        geaendert_am: jetzt.toISOString(),
      }
      const { data: termin, error } = await admin.from('termine').insert(zeile).select('id, beginn, ende, erstellt_am').single()
      if (error || !termin) return fehler(500, 'Der Termin konnte nicht gespeichert werden. Bitte versuchen Sie es noch einmal.')

      // Gleichzeitig gebucht? Dann zieht die später angelegte Buchung zurück (die frühere bleibt bestehen).
      const puffer = b.puffer_min * MINUTE_MS
      const nachher = await ladeBelegung(admin, ktx.email, new Date(beginn.getTime() - puffer).toISOString(), new Date(ende.getTime() + puffer).toISOString())
      if (mussZurueckziehen({ id: String(termin.id), erstellt_am: termin.erstellt_am ?? null }, nachher)) {
        await admin.from('termine').delete().eq('id', termin.id)
        return BELEGT()
      }

      const zeitraum = zeitraumText({ beginn: zeile.beginn, ende: zeile.ende, ganztags: false })
      await sendeTelegram(
        ktx.chat,
        [
          '📅 Online-Termin gebucht',
          '',
          b.titel,
          zeitraum,
          `Name: ${name}`,
          `E-Mail: ${email}`,
          telefon ? `Telefon: ${telefon}` : null,
          kunde ? `Kunde im CRM: ${kunde.name}` : null,
          nachricht ? `\nNachricht:\n${nachricht.slice(0, 800)}` : null,
        ]
          .filter((z) => z !== null)
          .join('\n'),
      )

      let bestaetigungGesendet = false
      try {
        const tag = TAG_LANG.format(beginn)
        const von = UHR.format(beginn)
        const bis = UHR.format(ende)
        const anhang = icsAnhang(
          {
            uid: `${termin.id}@mayer-holding-crm`,
            titel: `${b.titel} mit ${ktx.name}`,
            beginn: zeile.beginn,
            ende: zeile.ende,
            ort: b.ort || undefined,
            beschreibung: `${b.titel} mit ${ktx.name}, Andreas Mayer Holding.${b.hinweis ? `\n\n${b.hinweis}` : ''}`,
            organisator: { name: ktx.name, email: ktx.email },
            teilnehmer: [{ name, email }],
          },
          'termin.ics',
        )
        const text = [
          `Guten Tag ${name},`,
          '',
          'vielen Dank für Ihre Buchung. Hiermit bestätigen wir Ihren Termin:',
          '',
          b.titel,
          `${tag}, ${von}–${bis} Uhr (deutsche Zeit)`,
          b.ort ? `Ort: ${b.ort}` : null,
          `Gesprächspartner: ${ktx.name}`,
          b.hinweis ? `\n${b.hinweis}` : null,
          '',
          'Im Anhang finden Sie den Termin als Kalenderdatei. Mit einem Klick darauf können Sie ihn in Ihren Kalender übernehmen.',
          '',
          'Falls Sie den Termin absagen oder verschieben möchten, antworten Sie einfach auf diese E-Mail oder rufen Sie uns an.',
          '',
          'Mit freundlichen Grüßen',
          ktx.name,
          'Andreas Mayer Holding',
        ]
          .filter((z) => z !== null)
          .join('\n')
        await k.sendeMail(email, `Terminbestätigung: ${b.titel} am ${tag.replace(/^[^,]+,\s*/, '')} um ${von} Uhr`, text, [anhang])
        bestaetigungGesendet = true
      } catch (err) {
        console.error('Buchung: Bestätigung per Mail fehlgeschlagen:', err instanceof Error ? err.message : err)
      }

      return { status: 200, inhalt: { ok: true, beginn: zeile.beginn, ende: zeile.ende, bestaetigungGesendet } }
    }

    return fehler(400, 'Unbekannte Aktion der Terminbuchung.')
  } catch (err) {
    console.error('Terminbuchung fehlgeschlagen:', err instanceof Error ? err.message : err)
    return fehler(500, 'Die Terminbuchung ist gerade nicht erreichbar. Bitte versuchen Sie es später noch einmal.')
  }
}
