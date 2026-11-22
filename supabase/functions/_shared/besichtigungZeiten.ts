// Besichtigungszeiten zum Selbstbuchen (22.11.2026): reine Rechnungen ohne Datenbank, gemeinsam für
// das Fenster (ObjektBesichtigungenSection: Zeiten anlegen, Kalender prüfen) und den Server
// (email-gateway/objektPortal.ts: freie Zeiten im Interessenten-Portal).
//
// - Gerechnet wird in deutscher Zeit (Europe/Berlin) über Intl, auch über die Zeitumstellung hinweg.
// - Belegt ist der Makler durch CRM-Termine mit Uhrzeit (Besitzer oder Teilnehmer) und durch Zeiten aus
//   seinem eigenen Kalender (kalender_fremd.belegt: { b, e, g = ganztägig, a = ganztägig, sperrt }).
//   Ganztägige Einträge blockieren nur, wenn sie ausdrücklich sperren — wie in buchung.ts/kalenderZeiten.ts.

export type Zeitfenster = { beginn: string; ende: string }
export type BelegtBlock = { von: number; bis: number }

const MINUTE = 60000
const TAG = 86400000

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

export function berlinWand(ms: number): Wand {
  const teile = Object.fromEntries(BERLIN.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return { j: Number(teile.year), m: Number(teile.month), t: Number(teile.day), h: Number(teile.hour) % 24, min: Number(teile.minute) }
}

function versatz(ms: number): number {
  const w = berlinWand(ms)
  return Math.round((Date.UTC(w.j, w.m - 1, w.t, w.h, w.min) - Math.floor(ms / MINUTE) * MINUTE) / MINUTE)
}

/** Uhrzeit in deutscher Zeit → Zeitpunkt (ms); null, wenn es sie an dem Tag nicht gibt (Umstellung im Frühjahr). */
export function berlinZuUtc(j: number, m: number, t: number, h: number, min: number): number | null {
  const naiv = Date.UTC(j, m - 1, t, h, min)
  let ms = naiv - versatz(naiv) * MINUTE
  ms = naiv - versatz(ms) * MINUTE
  const w = berlinWand(ms)
  const soll = new Date(naiv)
  if (w.j !== soll.getUTCFullYear() || w.m !== soll.getUTCMonth() + 1 || w.t !== soll.getUTCDate() || w.h !== soll.getUTCHours() || w.min !== soll.getUTCMinutes()) return null
  return ms
}

const UHRZEIT = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/
const minuten = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

export const DAUER_WAHL = [15, 20, 30, 45, 60, 90]
export const HOECHSTENS_ZEITEN = 120

/** Eine einzelne Zeit: Datum „JJJJ-MM-TT“ und Uhrzeit „SS:MM“ (deutsche Zeit). */
export function einzelZeit(datum: string, uhrzeit: string, dauerMin: number): Zeitfenster | null {
  const d = DATUM.exec(datum)
  if (!d || !UHRZEIT.test(uhrzeit) || !(dauerMin >= 5 && dauerMin <= 480)) return null
  const s = minuten(uhrzeit)
  const start = berlinZuUtc(Number(d[1]), Number(d[2]), Number(d[3]), Math.floor(s / 60), s % 60)
  if (start === null) return null
  return { beginn: new Date(start).toISOString(), ende: new Date(start + dauerMin * MINUTE).toISOString() }
}

export type Serie = {
  /** ISO-Wochentage 1 (Montag) bis 7 (Sonntag). */
  wochentage: number[]
  von: string
  bis: string
  /** Länge einer Besichtigung = Takt. */
  dauerMin: number
  /** Wie viele Wochen ab heute (1–12). */
  wochen: number
}

/** „Jeden Di 16–18 Uhr, 30-Minuten-Takt, nächste 3 Wochen“ → Einzelzeiten, nur zukünftige, sortiert. */
export function serienZeiten(s: Serie, jetzt: Date): Zeitfenster[] {
  if (!UHRZEIT.test(s.von) || !UHRZEIT.test(s.bis)) return []
  const dauer = Math.round(s.dauerMin)
  if (!(dauer >= 5 && dauer <= 480)) return []
  const wochen = Math.max(1, Math.min(12, Math.round(s.wochen)))
  const tage = new Set(s.wochentage.filter((w) => Number.isInteger(w) && w >= 1 && w <= 7))
  const anfang = minuten(s.von)
  const schluss = minuten(s.bis)
  const heute = berlinWand(jetzt.getTime())
  const aus: Zeitfenster[] = []
  for (let i = 0; i < wochen * 7; i++) {
    const d = new Date(Date.UTC(heute.j, heute.m - 1, heute.t + i))
    const wochentag = ((d.getUTCDay() + 6) % 7) + 1
    if (!tage.has(wochentag)) continue
    for (let m = anfang; m + dauer <= schluss; m += dauer) {
      const start = berlinZuUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), Math.floor(m / 60), m % 60)
      if (start === null || start <= jetzt.getTime()) continue
      aus.push({ beginn: new Date(start).toISOString(), ende: new Date(start + dauer * MINUTE).toISOString() })
      if (aus.length >= HOECHSTENS_ZEITEN) return aus
    }
  }
  return aus
}

export type TerminZeile = { id?: string | null; beginn: string; ende: string; ganztags?: boolean | null; besitzer_email?: string | null; teilnehmer?: string[] | null }
export type FremdZeile = { email: string; belegt?: { b: string; e: string; g?: boolean; a?: boolean }[] | null }

/** Belegte Zeiten eines Mitarbeiters aus CRM-Terminen und seinem eigenen Kalender. */
export function belegtVon(email: string, termine: TerminZeile[], fremd: FremdZeile[]): (BelegtBlock & { terminId?: string })[] {
  const wer = email.trim().toLowerCase()
  if (!wer) return []
  const aus: (BelegtBlock & { terminId?: string })[] = []
  for (const t of termine) {
    if (t.ganztags) continue
    const beteiligt = String(t.besitzer_email ?? '').toLowerCase() === wer || (t.teilnehmer ?? []).some((x) => String(x).toLowerCase() === wer)
    if (!beteiligt) continue
    const von = Date.parse(t.beginn)
    const bis = Date.parse(t.ende)
    if (Number.isNaN(von) || Number.isNaN(bis)) continue
    aus.push({ von, bis, terminId: t.id ? String(t.id) : undefined })
  }
  for (const f of fremd) {
    if (String(f.email).toLowerCase() !== wer) continue
    for (const x of f.belegt ?? []) {
      if (x.g && !x.a) continue
      const von = Date.parse(x.b)
      const bis = Date.parse(x.e)
      if (!Number.isNaN(von) && !Number.isNaN(bis)) aus.push({ von, bis })
    }
  }
  return aus
}

export function ueberschneidet(z: Zeitfenster, belegt: BelegtBlock[]): boolean {
  const von = Date.parse(z.beginn)
  const bis = Date.parse(z.ende)
  return belegt.some((b) => b.von < bis && b.bis > von)
}

/** Zeitraum, über den Belegungen für eine Liste von Zeiten geladen werden müssen. */
export function spanne(zeiten: Zeitfenster[]): { von: string; bis: string } | null {
  if (zeiten.length === 0) return null
  const von = Math.min(...zeiten.map((z) => Date.parse(z.beginn)))
  const bis = Math.max(...zeiten.map((z) => Date.parse(z.ende)))
  return { von: new Date(von - TAG).toISOString(), bis: new Date(bis + TAG).toISOString() }
}

const TAG_KURZ = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit' })
const TAG_LANG = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })

export const tagKurz = (iso: string) => TAG_KURZ.format(new Date(iso))
export const tagLang = (iso: string) => TAG_LANG.format(new Date(iso))
export const uhr = (iso: string) => UHR.format(new Date(iso))
/** „Dienstag, 24.11.2026, 16:00–16:30 Uhr“ */
export const zeitraumText = (z: Zeitfenster) => `${tagLang(z.beginn)}, ${uhr(z.beginn)}–${uhr(z.ende)} Uhr`
/** Kalendertag in deutscher Zeit „JJJJ-MM-TT“ (zum Gruppieren). */
export function tagSchluessel(iso: string): string {
  const w = berlinWand(Date.parse(iso))
  return `${w.j}-${String(w.m).padStart(2, '0')}-${String(w.t).padStart(2, '0')}`
}
