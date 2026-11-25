// Erinnerungen (25.11.2026, Wunsch der Geschäftsführung): „Eine Erinnerung ist kein To-do, sondern eine Erinnerung.“
// Bis dahin legte der Assistent bei „erinnere mich/ihn um 12 an …“ ein To-do mit Erinnerungszeit an (todo_anlegen mit
// erinnern_um) — das landete in der To-do-Liste. Jetzt gibt es dafür die Tabelle `erinnerungen`
// (supabase/sql/2026-11-25_erinnerungen.sql):
//   - anlegen: Telegram-Werkzeug erinnerung_anlegen (telegram-gateway/erinnerungWerkzeuge.ts) oder im CRM
//     (Karte „Meine Erinnerungen“ auf „Heute“, src/components/MeineErinnerungen.tsx),
//   - verschicken: Minuten-Zeitplan termin_erinnerungen → email-gateway/erinnerungVersand.ts,
//   - Knöpfe „✓ Erledigt“ / „⏰ In 1 Stunde“ (callback er:e:<id> / er:s:<id>) → telegram-gateway/erinnerungWerkzeuge.ts.
// To-dos mit Erinnerungszeit (todos.erinnern_um, todoErinnerung.ts) gibt es weiterhin — für echte Aufgaben.
//
// Diese Datei ist bewusst ohne Importe und ohne Datenbank: Zeitrechnung, Fälligkeit, Text und Knöpfe, damit
// Telegram-Gateway, E-Mail-Gateway und Tests genau dasselbe benutzen.

export type Wiederholung = '' | 'taeglich' | 'woechentlich' | 'monatlich'
export const WIEDERHOLUNGEN: readonly Exclude<Wiederholung, ''>[] = ['taeglich', 'woechentlich', 'monatlich']
export const WIEDERHOLUNG_TEXT: Record<Exclude<Wiederholung, ''>, string> = {
  taeglich: 'täglich',
  woechentlich: 'wöchentlich',
  monatlich: 'monatlich',
}

export type ErinnerungZeile = {
  id: string
  fuer_email: string
  von_email: string | null
  von_name: string | null
  text: string
  faellig_um: string
  kunde_id?: string | null
  kunde_bereich?: string | null
  objekt_id?: string | null
  gesendet_am?: string | null
  erledigt_am?: string | null
  wiederholung?: string | null
  privat?: boolean | null
  quelle?: string | null
}

/** Länger als das überfällig und nie verschickt (z. B. Zeitplan stand still) → still abhaken statt Tage später senden. */
export const ZU_ALT_MS = 2 * 24 * 60 * 60 * 1000
/** „In 1 Stunde nochmal“. */
export const SPAETER_MS = 60 * 60 * 1000
export const HOECHSTE_TEXTLAENGE = 500

/** Abstand Berlin zu UTC in Minuten zu einem Zeitpunkt (60 im Winter, 120 im Sommer). */
function berlinVersatzMinuten(ms: number): number {
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  )
  const alsUtc = Date.UTC(Number(teile.year), Number(teile.month) - 1, Number(teile.day), Number(teile.hour), Number(teile.minute))
  return Math.round((alsUtc - Math.floor(ms / 60000) * 60000) / 60000)
}

/** Wanduhrzeit in Berlin (Jahr, Monat 1–12, Tag, Stunde, Minute) als UTC-Millisekunden, Sommer-/Winterzeit eingerechnet. */
function berlinWandZuUtc(j: number, mo: number, t: number, h: number, mi: number): number {
  const wand = Date.UTC(j, mo - 1, t, h, mi)
  // Zweimal rechnen: Der Versatz am geschätzten Zeitpunkt kann um die Umstellung herum noch der alte sein.
  let utc = wand - berlinVersatzMinuten(wand) * 60000
  utc = wand - berlinVersatzMinuten(utc) * 60000
  return utc
}

/** Teile eines Zeitpunkts in Berliner Wanduhrzeit. */
export function berlinTeile(iso: string | number | Date): { j: number; mo: number; t: number; h: number; mi: number; wochentag: number } {
  const d = new Date(iso)
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  const tage: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { j: Number(teile.year), mo: Number(teile.month), t: Number(teile.day), h: Number(teile.hour), mi: Number(teile.minute), wochentag: tage[String(teile.weekday)] ?? 0 }
}

/**
 * Deutsche Ortszeit („2026-11-25T12:00“, „2026-11-25 12:00“, „25.11.2026 12:00“, „25.11.2026, 12.00 Uhr“) als UTC-ISO.
 * Nur ein Datum ohne Uhrzeit → 09:00 Uhr. Ungültig → undefined. Relative Angaben („in 2 Stunden“, „morgen 9 Uhr“)
 * rechnet das Modell vorher selbst in diese Form um.
 */
export function berlinZeitZuUtc(wert: string): string | undefined {
  const s = String(wert ?? '').trim()
  let j: number, mo: number, t: number, h = 9, mi = 0
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ,]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/)
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[T ,]+(\d{1,2})[:.](\d{2})(?:\s*Uhr)?)?$/i)
  if (iso) [j, mo, t] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (de) [j, mo, t] = [Number(de[3]), Number(de[2]), Number(de[1])]
  else return undefined
  const zeit = iso ?? de!
  if (zeit[4] !== undefined) [h, mi] = [Number(zeit[4]), Number(zeit[5])]
  if (mo < 1 || mo > 12 || t < 1 || t > 31 || h > 23 || mi > 59) return undefined
  if (new Date(Date.UTC(j, mo - 1, t)).getUTCDate() !== t) return undefined // z. B. 31.02.
  return new Date(berlinWandZuUtc(j, mo, t, h, mi)).toISOString()
}

/**
 * Liest den gewünschten Zeitpunkt aus einer Werkzeug-Eingabe: UTC-ISO oder Fehlertext. Vergangenheit (mehr als
 * 5 Minuten) ist ein Fehler — eine Erinnerung für gestern würde nie ankommen.
 */
export function leseZeitpunkt(roh: unknown, jetzt = Date.now()): { utc: string } | { fehler: string } {
  const s = String(roh ?? '').trim()
  if (!s) return { fehler: 'Fehler: wann fehlt. Gib Datum und Uhrzeit in deutscher Ortszeit an, Form JJJJ-MM-TTTHH:MM, z. B. 2026-11-25T12:00.' }
  const utc = berlinZeitZuUtc(s)
  if (!utc) return { fehler: `Fehler: Zeitpunkt „${s}“ nicht erkannt. Nutze JJJJ-MM-TTTHH:MM in deutscher Ortszeit, z. B. 2026-11-25T12:00.` }
  if (Date.parse(utc) < jetzt - 5 * 60000) return { fehler: `Fehler: ${deZeitpunkt(utc)} liegt in der Vergangenheit. Nimm einen Zeitpunkt in der Zukunft (rechne „heute“, „morgen“, „in 2 Stunden“ vom aktuellen Datum und der aktuellen Uhrzeit aus).` }
  return { utc }
}

export function leseWiederholung(roh: unknown): Wiederholung | null {
  const s = String(roh ?? '').trim().toLowerCase()
  if (!s || s === 'keine' || s === 'nein') return ''
  if ((WIEDERHOLUNGEN as readonly string[]).includes(s)) return s as Wiederholung
  return null
}

/**
 * Nächster Zeitpunkt einer wiederkehrenden Erinnerung — gleiche Berliner Uhrzeit, also auch über die Zeitumstellung
 * hinweg „jeden Tag um 8“. Monatlich: gleicher Tag im Folgemonat, bei kürzeren Monaten der letzte Tag (31. → 30.).
 * Liegt das Ergebnis noch nicht nach `nach` (z. B. nach langem Stillstand), wird weitergezählt.
 */
export function naechsterZeitpunkt(iso: string, wiederholung: Wiederholung | string | null | undefined, nach = Date.now()): string | null {
  if (!wiederholung || !(WIEDERHOLUNGEN as readonly string[]).includes(wiederholung)) return null
  const start = berlinTeile(iso)
  for (let schritt = 1; schritt <= 400; schritt++) {
    let utc: number
    if (wiederholung === 'monatlich') {
      const mIndex = start.mo - 1 + schritt
      const j = start.j + Math.floor(mIndex / 12)
      const mo = (mIndex % 12) + 1
      const letzter = new Date(Date.UTC(j, mo, 0)).getUTCDate()
      utc = berlinWandZuUtc(j, mo, Math.min(start.t, letzter), start.h, start.mi)
    } else {
      const tage = (wiederholung === 'taeglich' ? 1 : 7) * schritt
      const tag = new Date(Date.UTC(start.j, start.mo - 1, start.t + tage))
      utc = berlinWandZuUtc(tag.getUTCFullYear(), tag.getUTCMonth() + 1, tag.getUTCDate(), start.h, start.mi)
    }
    if (utc > nach) return new Date(utc).toISOString()
  }
  return null
}

/** Ist die Erinnerung jetzt zu verschicken? Nur offen, noch nicht gesendet, Zeitpunkt erreicht. */
export function istFaellig(z: Pick<ErinnerungZeile, 'faellig_um' | 'gesendet_am' | 'erledigt_am'>, jetzt = Date.now()): boolean {
  if (z.gesendet_am || z.erledigt_am) return false
  const t = Date.parse(z.faellig_um)
  return Number.isFinite(t) && t <= jetzt
}

/** Zu lange überfällig, um noch sinnvoll zu sein (still abhaken). */
export function istZuAlt(z: Pick<ErinnerungZeile, 'faellig_um'>, jetzt = Date.now()): boolean {
  return jetzt - Date.parse(z.faellig_um) > ZU_ALT_MS
}

const BERLIN_ZEIT = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const BERLIN_UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })

/** UTC-Zeitpunkt als „Mi., 25.11.2026, 12:00 Uhr“ (deutsche Ortszeit). */
export function deZeitpunkt(iso: string): string {
  return `${BERLIN_ZEIT.format(new Date(iso))} Uhr`
}

/** Nur die Uhrzeit „12:00“. */
export function deUhrzeit(iso: string): string {
  return BERLIN_UHR.format(new Date(iso))
}

/** Vorname für „(von Hasan)“. */
export function vorname(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/)[0] ?? ''
}

/** Text der Telegram-Erinnerung. `akte` = Anzeigename der verknüpften Akte (falls vorhanden). */
export function erinnerungsNachricht(z: Pick<ErinnerungZeile, 'text' | 'fuer_email' | 'von_email' | 'von_name' | 'wiederholung'>, akte?: string | null): string {
  const zeilen = [`⏰ Erinnerung: ${z.text}`]
  if (akte) zeilen.push(`Akte: ${akte}`)
  const vonAnderem = !!z.von_email && z.von_email.toLowerCase() !== z.fuer_email.toLowerCase()
  if (vonAnderem && z.von_name) zeilen.push(`(von ${vorname(z.von_name)})`)
  const w = z.wiederholung as Exclude<Wiederholung, ''> | undefined
  if (w && WIEDERHOLUNG_TEXT[w]) zeilen.push(`Wiederholt sich ${WIEDERHOLUNG_TEXT[w]}.`)
  return zeilen.join('\n')
}

// ── Knöpfe unter der Erinnerung ────────────────────────────────────────────────────────────────────────────────────
// callback_data höchstens 64 Bytes: „er:e:“ + uuid (36) passt.
export type KnopfArt = 'e' | 's'
const KNOPF_MUSTER = /^er:([es]):([0-9a-f-]{36})$/

export function erinnerungKnoepfe(id: string): { text: string; callback_data: string }[][] {
  return [[{ text: '✓ Erledigt', callback_data: `er:e:${id}` }, { text: '⏰ In 1 Stunde nochmal', callback_data: `er:s:${id}` }]]
}

export function istErinnerungKnopf(daten: unknown): boolean {
  return KNOPF_MUSTER.test(String(daten ?? ''))
}

export function leseErinnerungKnopf(daten: unknown): { art: KnopfArt; id: string } | null {
  const m = KNOPF_MUSTER.exec(String(daten ?? ''))
  return m ? { art: m[1] as KnopfArt, id: m[2] } : null
}

// ── Erinnerung oder To-do? ─────────────────────────────────────────────────────────────────────────────────────────
// Sicherheitsnetz für todo_anlegen: Bittet der Mitarbeiter um eine Erinnerung („erinnere mich/ihn …“, „denk dran …“,
// „schick mir um 15 Uhr eine Nachricht …“) und sagt nicht ausdrücklich To-do/Aufgabe/Liste, ist es eine Erinnerung.
const ERINNERUNG_WORTE = /(erinner|denk(e|t)? (bitte |mal )?(dran|daran)|nicht vergessen|vergiss (nicht|nich)|schick (mir|ihm|ihr) (um|morgen|heute|in|am)|weck (mich|ihn|sie))/i
const TODO_WORTE = /(to-?\s?do|aufgabe|auf die liste|auf meine liste|auf seine liste|todo-?liste|aufgabenliste|zu erledigen)/i

export function klingtNachErinnerung(eingang: string | null | undefined): boolean {
  const t = String(eingang ?? '')
  if (!t || /^\[(Datei-Eingang|Weitergeleitete Nachricht|Systemmeldung)/.test(t)) return false
  return ERINNERUNG_WORTE.test(t) && !TODO_WORTE.test(t)
}
