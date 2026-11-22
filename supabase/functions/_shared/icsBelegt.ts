// Belegte Zeiten aus einem fremden Kalender (veröffentlichter Kalender-Link von Outlook, iCloud, Google,
// IONOS …, Format iCalendar/RFC 5545) — nur Zeiträume, nie Titel, Ort oder Inhalt.
//
// - Serientermine werden ausgerollt: FREQ DAILY/WEEKLY/MONTHLY/YEARLY mit INTERVAL, COUNT, UNTIL,
//   BYDAY (auch „1MO“, „-1FR“), BYMONTHDAY, BYMONTH; EXDATE fällt weg, RDATE kommt dazu, einzelne
//   geänderte Termine einer Serie (RECURRENCE-ID) ersetzen den ursprünglichen Termin.
// - Uhrzeiten werden in der Zone des Termins weitergezählt (10:00 bleibt 10:00 über die Zeitumstellung).
//   Unbekannte Zonen und Zeiten ohne Zone gelten als deutsche Zeit.
// - Nicht belegt: abgesagte Termine (STATUS:CANCELLED), „frei“ markierte (TRANSP:TRANSPARENT,
//   X-MICROSOFT-CDO-BUSYSTATUS:FREE).
// - Ganztägige Einträge: Mitternacht deutscher Zeit bis Mitternacht nach dem letzten Tag. Sie sperren den
//   ganzen Tag nur, wenn sie ausdrücklich als belegt/abwesend markiert sind (`a`), sonst sind sie ein Hinweis
//   (Kalender legen Geburtstage, Feiertage u. Ä. ganztägig an).
// - Wirft nie; fehlerhafte Einträge werden ausgelassen.

export type BelegtBlock = {
  /** Beginn, ISO-Zeitpunkt (UTC). */
  b: string
  /** Ende, ISO-Zeitpunkt (UTC). */
  e: string
  /** ganztägig */
  g?: true
  /** sperrt den ganzen Zeitraum ausdrücklich (abwesend oder ausdrücklich „belegt“ markiert) — nur bei ganztägig gesetzt */
  a?: true
}

export type IcsErgebnis = { bloecke: BelegtBlock[]; termine: number; gekuerzt: boolean }

const STANDARD_ZONE = 'Europe/Berlin'
const STUNDE = 3600000
const TAG = 86400000
const HOECHSTENS_SCHRITTE = 20000 // je Serie
const HOECHSTENS_BLOECKE = 5000

// ---------- Zeilen ----------

type Zeile = { name: string; params: Record<string, string>; wert: string }

function zerlegeZeile(roh: string): Zeile | null {
  let i = 0
  while (i < roh.length && roh[i] !== ';' && roh[i] !== ':') i++
  if (i >= roh.length) return null
  const name = roh.slice(0, i).trim().toUpperCase()
  const params: Record<string, string> = {}
  if (roh[i] === ';') {
    let inAnf = false
    let start = i + 1
    for (i = i + 1; i < roh.length; i++) {
      const z = roh[i]
      if (z === '"') inAnf = !inAnf
      else if (!inAnf && (z === ';' || z === ':')) {
        const teil = roh.slice(start, i)
        const gleich = teil.indexOf('=')
        if (gleich > 0) params[teil.slice(0, gleich).trim().toUpperCase()] = teil.slice(gleich + 1).trim().replace(/^"(.*)"$/, '$1')
        start = i + 1
        if (z === ':') break
      }
    }
    if (i >= roh.length) return null
  }
  return { name, params, wert: roh.slice(i + 1) }
}

function entfalte(ics: string): string[] {
  return ics
    .replace(/^﻿/, '')
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((z) => z.trim().length > 0)
}

// ---------- Zeitzonen ----------

const WINDOWS_ZONEN: Record<string, string> = {
  'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw',
  'romance standard time': 'Europe/Paris',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'utc': 'UTC',
  'coordinated universal time': 'UTC',
  'fle standard time': 'Europe/Helsinki',
  'gtb standard time': 'Europe/Bucharest',
  'turkey standard time': 'Europe/Istanbul',
  'russian standard time': 'Europe/Moscow',
  'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago',
  'pacific standard time': 'America/Los_Angeles',
}

const gueltig = new Map<string, boolean>()
function istIana(zone: string): boolean {
  const schon = gueltig.get(zone)
  if (schon !== undefined) return schon
  let ok = false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    ok = true
  } catch {
    ok = false
  }
  gueltig.set(zone, ok)
  return ok
}

/** IANA-Zone zu einer TZID; unbekannt → deutsche Zeit. */
export function zoneVon(tzid: string | undefined): string {
  const roh = String(tzid ?? '').trim().replace(/^"(.*)"$/, '$1')
  if (!roh) return STANDARD_ZONE
  const w = WINDOWS_ZONEN[roh.toLowerCase()]
  if (w) return w
  if (/^[A-Za-z_]+(\/[A-Za-z_+\-]+){1,2}$/.test(roh) && istIana(roh)) return roh
  const teile = roh.split('/').filter(Boolean)
  for (let n = Math.min(3, teile.length); n >= 2; n--) {
    const k = teile.slice(-n).join('/')
    if (/^[A-Za-z_]+(\/[A-Za-z_+\-]+){1,2}$/.test(k) && istIana(k)) return k
  }
  if (/london|dublin|lissabon|lisbon/i.test(roh)) return 'Europe/London'
  if (/paris|madrid|br(ü|u)ssel|brussels/i.test(roh)) return 'Europe/Paris'
  return STANDARD_ZONE
}

const formate = new Map<string, Intl.DateTimeFormat>()
function abstandMin(zone: string, ms: number): number {
  let f = formate.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    formate.set(zone, f)
  }
  const t: Record<string, number> = {}
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') t[p.type] = Number(p.value)
  const alsUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour === 24 ? 0 : t.hour, t.minute, t.second)
  return Math.round((alsUtc - Math.floor(ms / 1000) * 1000) / 60000)
}

type Ortszeit = { j: number; mo: number; t: number; h: number; mi: number; s: number }

/** Ortszeit in einer Zone → UTC-Millisekunden (zweiter Schritt für Zeiten an der Zeitumstellung). */
export function ortszeitZuUtc(o: Ortszeit, zone: string): number {
  const naiv = Date.UTC(o.j, o.mo - 1, o.t, o.h, o.mi, o.s)
  if (zone === 'UTC') return naiv
  const ms = naiv - abstandMin(zone, naiv) * 60000
  const zweiter = naiv - abstandMin(zone, ms) * 60000
  return zweiter !== ms ? zweiter : ms
}

const mitternacht = (j: number, mo: number, t: number) => {
  const d = new Date(Date.UTC(j, mo - 1, t))
  return ortszeitZuUtc({ j: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, t: d.getUTCDate(), h: 0, mi: 0, s: 0 }, STANDARD_ZONE)
}

// ---------- Werte ----------

type Zeitwert = { o: Ortszeit; nurDatum: boolean; utc: boolean }

function liesZeit(wert: string): Zeitwert | null {
  const m = wert.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i)
  if (!m) return null
  return {
    o: { j: +m[1], mo: +m[2], t: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) },
    nurDatum: m[4] === undefined,
    utc: !!m[7],
  }
}

function liesDauer(wert: string): number | null {
  const m = wert.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i)
  if (!m) return null
  const vz = m[1] === '-' ? -1 : 1
  return vz * ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * TAG + +(m[4] ?? 0) * STUNDE + +(m[5] ?? 0) * 60000 + +(m[6] ?? 0) * 1000)
}

/** Zeitpunkt eines Werts (UTC-ms). Nur-Datum: Mitternacht deutscher Zeit. */
function zeitpunkt(z: Zeitwert, zone: string): number {
  if (z.nurDatum) return mitternacht(z.o.j, z.o.mo, z.o.t)
  if (z.utc) return Date.UTC(z.o.j, z.o.mo - 1, z.o.t, z.o.h, z.o.mi, z.o.s)
  return ortszeitZuUtc(z.o, zone)
}

// ---------- Wiederholungsregel ----------

const WTAGE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

type Regel = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  intervall: number
  anzahl?: number
  bis?: Zeitwert
  byday: { n: number; tag: number }[]
  bymonthday: number[]
  bymonth: number[]
}

export function liesRegel(wert: string): Regel | null {
  const r: Record<string, string> = {}
  for (const teil of wert.split(';')) {
    const [k, v] = teil.split('=')
    if (k && v) r[k.trim().toUpperCase()] = v.trim().toUpperCase()
  }
  const freq = r.FREQ
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null
  const byday: { n: number; tag: number }[] = []
  for (const x of (r.BYDAY ?? '').split(',').filter(Boolean)) {
    const m = x.match(/^([+-]?\d{1,2})?([A-Z]{2})$/)
    if (!m || WTAGE.indexOf(m[2]) < 0) continue
    byday.push({ n: m[1] ? Number(m[1]) : 0, tag: WTAGE.indexOf(m[2]) })
  }
  const zahlen = (s?: string) => (s ?? '').split(',').map((x) => Number.parseInt(x, 10)).filter((x) => Number.isFinite(x) && x !== 0)
  const anzahl = r.COUNT ? Number.parseInt(r.COUNT, 10) : undefined
  return {
    freq,
    intervall: Math.max(1, Number.parseInt(r.INTERVAL ?? '1', 10) || 1),
    ...(anzahl && anzahl > 0 ? { anzahl } : {}),
    ...(r.UNTIL && liesZeit(r.UNTIL) ? { bis: liesZeit(r.UNTIL)! } : {}),
    byday,
    bymonthday: zahlen(r.BYMONTHDAY),
    bymonth: zahlen(r.BYMONTH).filter((m) => m >= 1 && m <= 12),
  }
}

type Datum = { j: number; mo: number; t: number }
const tageImMonat = (j: number, mo: number) => new Date(Date.UTC(j, mo, 0)).getUTCDate()
const wochentag = (d: Datum) => new Date(Date.UTC(d.j, d.mo - 1, d.t)).getUTCDay()
const plusTage = (d: Datum, n: number): Datum => {
  const x = new Date(Date.UTC(d.j, d.mo - 1, d.t + n))
  return { j: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, t: x.getUTCDate() }
}
const datumZahl = (d: Datum) => d.j * 10000 + d.mo * 100 + d.t

/** Tage eines Monats, die zu BYDAY/BYMONTHDAY passen (sonst der Tag des Serienbeginns). */
function tageImMonatNachRegel(j: number, mo: number, r: Regel, startTag: number): number[] {
  const anzahl = tageImMonat(j, mo)
  const tage = new Set<number>()
  if (r.bymonthday.length > 0) {
    for (const x of r.bymonthday) {
      const t = x > 0 ? x : anzahl + 1 + x
      if (t >= 1 && t <= anzahl) tage.add(t)
    }
  }
  if (r.byday.length > 0) {
    const passend = new Set<number>()
    for (const { n, tag } of r.byday) {
      const alle: number[] = []
      for (let t = 1; t <= anzahl; t++) if (wochentag({ j, mo, t }) === tag) alle.push(t)
      if (n === 0) alle.forEach((t) => passend.add(t))
      else {
        const t = n > 0 ? alle[n - 1] : alle[alle.length + n]
        if (t) passend.add(t)
      }
    }
    if (r.bymonthday.length > 0) {
      for (const t of [...tage]) if (!passend.has(t)) tage.delete(t)
    } else passend.forEach((t) => tage.add(t))
  }
  if (r.bymonthday.length === 0 && r.byday.length === 0 && startTag <= anzahl) tage.add(startTag)
  return [...tage].sort((a, b) => a - b)
}

/**
 * Kalendertage der Serie ab dem Starttag (inklusive), aufsteigend. Bricht ab, wenn `weiter` false liefert
 * (Fenster-Ende, UNTIL oder COUNT erreicht) oder nach HOECHSTENS_SCHRITTE Schritten.
 */
function rolleAus(start: Datum, r: Regel, weiter: (d: Datum) => boolean): void {
  const startZahl = datumZahl(start)
  let schritte = 0
  const gib = (d: Datum): boolean => {
    if (datumZahl(d) < startZahl) return true
    return weiter(d)
  }
  if (r.freq === 'DAILY') {
    for (let k = 0; schritte++ < HOECHSTENS_SCHRITTE; k++) {
      const d = plusTage(start, k * r.intervall)
      if (r.bymonth.length > 0 && !r.bymonth.includes(d.mo)) continue
      if (r.byday.length > 0 && !r.byday.some((b) => b.tag === wochentag(d))) continue
      if (r.bymonthday.length > 0 && !r.bymonthday.some((x) => (x > 0 ? x : tageImMonat(d.j, d.mo) + 1 + x) === d.t)) continue
      if (!gib(d)) return
    }
    return
  }
  if (r.freq === 'WEEKLY') {
    // Wochen beginnen montags (WKST=MO, Standard).
    const montag = plusTage(start, -((wochentag(start) + 6) % 7))
    const tage = (r.byday.length > 0 ? r.byday.map((b) => b.tag) : [wochentag(start)]).map((t) => (t + 6) % 7).sort((a, b) => a - b)
    for (let k = 0; schritte < HOECHSTENS_SCHRITTE; k++) {
      for (const versatz of tage) {
        schritte++
        const d = plusTage(montag, k * 7 * r.intervall + versatz)
        if (r.bymonth.length > 0 && !r.bymonth.includes(d.mo)) continue
        if (!gib(d)) return
      }
    }
    return
  }
  if (r.freq === 'MONTHLY') {
    for (let k = 0; schritte < HOECHSTENS_SCHRITTE; k++) {
      const gesamt = start.mo - 1 + k * r.intervall
      const j = start.j + Math.floor(gesamt / 12)
      const mo = (gesamt % 12) + 1
      schritte++
      if (r.bymonth.length > 0 && !r.bymonth.includes(mo)) continue
      for (const t of tageImMonatNachRegel(j, mo, r, start.t)) {
        schritte++
        if (!gib({ j, mo, t })) return
      }
    }
    return
  }
  // YEARLY
  const monate = r.bymonth.length > 0 ? [...r.bymonth].sort((a, b) => a - b) : [start.mo]
  for (let k = 0; schritte < HOECHSTENS_SCHRITTE; k++) {
    const j = start.j + k * r.intervall
    for (const mo of monate) {
      schritte++
      const tage = r.byday.length > 0 || r.bymonthday.length > 0 ? tageImMonatNachRegel(j, mo, r, start.t) : start.t <= tageImMonat(j, mo) ? [start.t] : []
      for (const t of tage) {
        schritte++
        if (!gib({ j, mo, t })) return
      }
    }
  }
}

// ---------- Lesen ----------

type Termin = { zeilen: Zeile[] }

/** Liest belegte Zeiträume im Fenster [vonMs, bisMs). */
export function belegtAusIcs(ics: string, vonMs: number, bisMs: number, hoechstens = HOECHSTENS_BLOECKE): IcsErgebnis {
  const leer: IcsErgebnis = { bloecke: [], termine: 0, gekuerzt: false }
  if (typeof ics !== 'string' || !/BEGIN:VCALENDAR/i.test(ics)) return leer
  const termine: Termin[] = []
  const stapel: string[] = []
  let aktuell: Termin | null = null
  for (const roh of entfalte(ics)) {
    const z = zerlegeZeile(roh)
    if (!z) continue
    if (z.name === 'BEGIN') {
      const art = z.wert.trim().toUpperCase()
      stapel.push(art)
      if (art === 'VEVENT') aktuell = { zeilen: [] }
      continue
    }
    if (z.name === 'END') {
      const art = z.wert.trim().toUpperCase()
      const stelle = stapel.lastIndexOf(art)
      if (stelle >= 0) stapel.length = stelle
      if (art === 'VEVENT' && aktuell) {
        termine.push(aktuell)
        aktuell = null
      }
      continue
    }
    // Nur Eigenschaften direkt im Termin (nicht in einer Erinnerung VALARM darin).
    if (aktuell && stapel[stapel.length - 1] === 'VEVENT') aktuell.zeilen.push(z)
  }

  type Auswertung = {
    uid: string
    startZeile: Zeile
    start: Zeitwert
    zone: string
    ganztags: boolean
    dauerMs: number
    dauerTage: number
    belegt: boolean
    sperrt: boolean
    regel: Regel | null
    exdates: Set<number>
    rdates: number[]
    recurrenceId: number | null
  }
  const auswertungen: Auswertung[] = []
  for (const t of termine) {
    try {
      const erste = (n: string) => t.zeilen.find((z) => z.name === n)
      const startZeile = erste('DTSTART')
      if (!startZeile) continue
      const start = liesZeit(startZeile.wert)
      if (!start) continue
      const ganztags = start.nurDatum || String(startZeile.params.VALUE ?? '').toUpperCase() === 'DATE'
      const zone = start.utc ? 'UTC' : zoneVon(startZeile.params.TZID)
      const beginnMs = zeitpunkt(start, zone)
      let dauerMs = STUNDE
      let dauerTage = 1
      const endZeile = erste('DTEND')
      const ende = endZeile ? liesZeit(endZeile.wert) : null
      const dauer = erste('DURATION') ? liesDauer(erste('DURATION')!.wert) : null
      if (ganztags) {
        if (ende) dauerTage = Math.round((Date.UTC(ende.o.j, ende.o.mo - 1, ende.o.t) - Date.UTC(start.o.j, start.o.mo - 1, start.o.t)) / TAG)
        else if (dauer !== null) dauerTage = Math.ceil(dauer / TAG)
        if (!(dauerTage >= 1)) dauerTage = 1
      } else {
        if (ende) dauerMs = zeitpunkt(ende, ende.utc ? 'UTC' : zoneVon(endZeile!.params.TZID ?? startZeile.params.TZID)) - beginnMs
        else if (dauer !== null) dauerMs = dauer
        else dauerMs = 0 // RFC 5545: ohne Ende und Dauer ein Zeitpunkt — belegt dann nichts
      }
      const status = String(erste('STATUS')?.wert ?? '').trim().toUpperCase()
      const transpRoh = String(erste('TRANSP')?.wert ?? '').trim().toUpperCase()
      const msStatus = String(erste('X-MICROSOFT-CDO-BUSYSTATUS')?.wert ?? '').trim().toUpperCase()
      const frei = status === 'CANCELLED' || transpRoh === 'TRANSPARENT' || msStatus === 'FREE'
      const sperrt = msStatus === 'OOF' || msStatus === 'BUSY' || transpRoh === 'OPAQUE'
      const exdates = new Set<number>()
      const rdates: number[] = []
      for (const z of t.zeilen) {
        if (z.name !== 'EXDATE' && z.name !== 'RDATE') continue
        if (String(z.params.VALUE ?? '').toUpperCase() === 'PERIOD') continue
        const zz = z.params.TZID ? zoneVon(z.params.TZID) : zone
        for (const w of z.wert.split(',')) {
          const x = liesZeit(w)
          if (!x) continue
          const ms = zeitpunkt(x, x.utc ? 'UTC' : zz)
          if (z.name === 'EXDATE') exdates.add(ms)
          else rdates.push(ms)
        }
      }
      const ridZeile = erste('RECURRENCE-ID')
      const rid = ridZeile ? liesZeit(ridZeile.wert) : null
      auswertungen.push({
        uid: erste('UID')?.wert.trim() || `ohne-uid-${auswertungen.length}`,
        startZeile,
        start,
        zone,
        ganztags,
        dauerMs,
        dauerTage,
        belegt: !frei,
        sperrt,
        regel: erste('RRULE') ? liesRegel(erste('RRULE')!.wert) : null,
        exdates,
        rdates,
        recurrenceId: rid ? zeitpunkt(rid, rid.utc ? 'UTC' : ridZeile!.params.TZID ? zoneVon(ridZeile!.params.TZID) : zone) : null,
      })
    } catch {
      // Eintrag auslassen
    }
  }

  // Geänderte Einzeltermine einer Serie: ihre RECURRENCE-ID ersetzt den Termin der Serie.
  const ersetzt = new Map<string, Set<number>>()
  for (const a of auswertungen) {
    if (a.recurrenceId === null) continue
    const s = ersetzt.get(a.uid) ?? new Set<number>()
    s.add(a.recurrenceId)
    ersetzt.set(a.uid, s)
  }

  const bloecke: BelegtBlock[] = []
  let gekuerzt = false
  const schluessel = new Set<string>()
  const fuege = (a: Auswertung, beginnMs: number) => {
    let endeMs: number
    if (a.ganztags) {
      const d = new Date(beginnMs + 12 * STUNDE) // Mittag, damit der Kalendertag in Berlin sicher stimmt
      const tag = new Intl.DateTimeFormat('en-CA', { timeZone: STANDARD_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-').map(Number)
      endeMs = mitternacht(tag[0], tag[1], tag[2] + a.dauerTage)
    } else endeMs = beginnMs + a.dauerMs
    if (!(endeMs > beginnMs) || endeMs <= vonMs || beginnMs >= bisMs) return
    const k = `${beginnMs}|${endeMs}|${a.ganztags ? 1 : 0}`
    if (schluessel.has(k)) return
    if (bloecke.length >= hoechstens) {
      gekuerzt = true
      return
    }
    schluessel.add(k)
    bloecke.push({
      b: new Date(beginnMs).toISOString(),
      e: new Date(endeMs).toISOString(),
      ...(a.ganztags ? { g: true as const } : {}),
      ...(a.ganztags && a.sperrt ? { a: true as const } : {}),
    })
  }

  for (const a of auswertungen) {
    if (!a.belegt) continue
    if (a.recurrenceId !== null || !a.regel) {
      // Einzeltermin (auch ein geänderter Einzeltermin einer Serie) — plus RDATEs
      const startMs = zeitpunkt(a.start, a.zone)
      const weg = ersetzt.get(a.uid)
      if (a.recurrenceId !== null || !weg?.has(startMs)) fuege(a, startMs)
      for (const r of a.rdates) if (!a.exdates.has(r) && !weg?.has(r)) fuege(a, r)
      continue
    }
    const r = a.regel
    const weg = ersetzt.get(a.uid) ?? new Set<number>()
    const bisMsRegel = r.bis ? (r.bis.nurDatum ? mitternacht(r.bis.o.j, r.bis.o.mo, r.bis.o.t + 1) - 1 : zeitpunkt(r.bis, r.bis.utc ? 'UTC' : a.zone)) : Infinity
    let gezaehlt = 0
    const laengsteDauer = a.ganztags ? a.dauerTage * TAG + STUNDE : Math.max(0, a.dauerMs)
    rolleAus({ j: a.start.o.j, mo: a.start.o.mo, t: a.start.o.t }, r, (d) => {
      // Weit vor dem Fenster: nur zählen (COUNT), ohne die teure Zonen-Umrechnung.
      const grob = Date.UTC(d.j, d.mo - 1, d.t, a.start.o.h, a.start.o.mi)
      if (grob + laengsteDauer + 2 * TAG < vonMs && grob + 2 * TAG < bisMsRegel) {
        if (r.anzahl !== undefined && gezaehlt >= r.anzahl) return false
        gezaehlt++
        return true
      }
      const ms =a.ganztags ? mitternacht(d.j, d.mo, d.t) : a.start.utc ? Date.UTC(d.j, d.mo - 1, d.t, a.start.o.h, a.start.o.mi, a.start.o.s) : ortszeitZuUtc({ ...d, h: a.start.o.h, mi: a.start.o.mi, s: a.start.o.s }, a.zone)
      if (ms > bisMsRegel) return false
      if (r.anzahl !== undefined && gezaehlt >= r.anzahl) return false
      gezaehlt++
      if (ms >= bisMs) return false
      if (ms + laengsteDauer > vonMs && !a.exdates.has(ms) && !weg.has(ms)) fuege(a, ms)
      return !gekuerzt
    })
    for (const rd of a.rdates) if (!a.exdates.has(rd) && !weg.has(rd)) fuege(a, rd)
  }

  bloecke.sort((x, y) => (x.b < y.b ? -1 : x.b > y.b ? 1 : 0))
  return { bloecke, termine: auswertungen.length, gekuerzt }
}
