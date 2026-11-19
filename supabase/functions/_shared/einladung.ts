// Kalender-Einladungen (.ics, RFC 5545) aus eingehenden Mails lesen und in den CRM-Kalender übernehmen.
//
// Hintergrund: Die Mail-Kalender der Mitarbeiter (IONOS) lassen sich nicht zweiseitig abgleichen (kein
// CalDAV, geprüft am 18.11.2026). Stattdessen werden Einladungen, die im persönlichen Postfach eines
// Mitarbeiters ankommen (Outlook/Exchange, Google Kalender, Apple/iCloud …), als Termin in seinen
// CRM-Kalender übernommen — geändert, wenn der Einladende den Termin ändert, und gelöscht, wenn er absagt.
//
// - Zuordnung über (besitzer_email, extern_uid = UID der Einladung). Zeilen ohne extern_uid (im CRM
//   angelegte Termine) werden hier nie angefasst.
// - Serientermine: nur der erste Termin wird übernommen (kein Ausrollen der Wiederholungsregel).
// - Einzelne geänderte Termine einer Serie (RECURRENCE-ID) werden ausgelassen.
// - Der Stand der Einladung (SEQUENCE, DTSTAMP) liegt in `termine.gast` unter eigenen Schlüsseln
//   (`extern_sequenz`, `extern_stempel`), damit eine ältere Fassung, die später abgeholt wird (z. B. aus
//   einem Unterordner), eine neuere nicht überschreibt. Die Schlüssel für einen eingeladenen Kunden
//   (`email`, `name`, `eingeladen`, `sequenz`) bleiben davon unberührt.

export type Einladung = {
  uid: string
  /** REQUEST | CANCEL | PUBLISH | REPLY | … (Großbuchstaben). Ein Termin mit STATUS:CANCELLED gilt als CANCEL. */
  methode: string
  titel: string
  /** ISO-Zeitpunkt (UTC). Ganztägig: Mitternacht deutscher Zeit am ersten Tag. */
  beginn: string
  /** ISO-Zeitpunkt (UTC). Ganztägig: Mitternacht deutscher Zeit am Tag NACH dem letzten Tag. */
  ende: string
  ganztags: boolean
  ort?: string
  beschreibung?: string
  organisator?: { name?: string; email?: string }
  sequenz: number
  serie: boolean
  /** DTSTAMP als ISO-Zeitpunkt, falls vorhanden — unterscheidet zwei Fassungen mit gleicher SEQUENCE. */
  zeitstempel?: string
}

const STANDARD_ZONE = 'Europe/Berlin'
const STUNDE = 3600000
const TAG = 86400000

// ---------- Zeilen ----------

type Zeile = { name: string; params: Record<string, string>; wert: string }

/** Zerlegt eine (bereits entfaltete) Inhaltszeile in Name, Parameter und Wert — Anführungszeichen beachten. */
function zerlegeZeile(roh: string): Zeile | null {
  let i = 0
  let inAnf = false
  // Name bis zum ersten ';' oder ':'
  while (i < roh.length && roh[i] !== ';' && roh[i] !== ':') i++
  if (i >= roh.length) return null
  const name = roh.slice(0, i).trim().toUpperCase()
  const params: Record<string, string> = {}
  if (roh[i] === ';') {
    let start = i + 1
    i++
    for (; i < roh.length; i++) {
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

function textWert(wert: string): string {
  return wert.replace(/\\([\\;,nN])/g, (_, z: string) => (z === 'n' || z === 'N' ? '\n' : z)).trim()
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
  'e. europe standard time': 'Europe/Chisinau',
  'fle standard time': 'Europe/Helsinki',
  'gtb standard time': 'Europe/Bucharest',
  'turkey standard time': 'Europe/Istanbul',
  'russian standard time': 'Europe/Moscow',
  'israel standard time': 'Asia/Jerusalem',
  'egypt standard time': 'Africa/Cairo',
  'south africa standard time': 'Africa/Johannesburg',
  'arab standard time': 'Asia/Riyadh',
  'arabian standard time': 'Asia/Dubai',
  'india standard time': 'Asia/Kolkata',
  'singapore standard time': 'Asia/Singapore',
  'china standard time': 'Asia/Shanghai',
  'tokyo standard time': 'Asia/Tokyo',
  'aus eastern standard time': 'Australia/Sydney',
  'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'pacific standard time': 'America/Los_Angeles',
}

// Ältere Outlook-Fassungen schreiben den Anzeigenamen als TZID, z. B.
// "(UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien".
const STAEDTE: [RegExp, string][] = [
  [/amsterdam|berlin|bern|wien|vienna|stockholm|rom\b|rome/i, 'Europe/Berlin'],
  [/br(ü|u)ssel|brussels|kopenhagen|copenhagen|madrid|paris/i, 'Europe/Paris'],
  [/belgrad|belgrade|bratislava|budapest|ljubljana|prag|prague/i, 'Europe/Budapest'],
  [/sarajevo|skopje|warschau|warsaw|zagreb/i, 'Europe/Warsaw'],
  [/dublin|edinburgh|lissabon|lisbon|london/i, 'Europe/London'],
  [/istanbul/i, 'Europe/Istanbul'],
  [/athen|athens|bukarest|bucharest/i, 'Europe/Bucharest'],
  [/helsinki|kiew|kyiv|kiev|riga|sofia|tallinn|vilnius/i, 'Europe/Helsinki'],
  [/moskau|moscow/i, 'Europe/Moscow'],
]

const gueltigeZonen = new Map<string, boolean>()
function istIana(zone: string): boolean {
  if (!zone) return false
  const bekannt = gueltigeZonen.get(zone)
  if (bekannt !== undefined) return bekannt
  let ok = false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    ok = true
  } catch {
    ok = false
  }
  gueltigeZonen.set(zone, ok)
  return ok
}

/** Bekannte Zone zu einer TZID (IANA, Windows-Name, Anzeigename, "/mozilla.org/…/Europe/Berlin") oder null. */
function bekannteZone(tzid: string): string | null {
  const roh = tzid.trim().replace(/^"(.*)"$/, '$1')
  if (!roh) return null
  const windows = WINDOWS_ZONEN[roh.toLowerCase()]
  if (windows) return windows
  if (/^[A-Za-z_]+\/[A-Za-z_+\-]+(\/[A-Za-z_+\-]+)?$/.test(roh) && istIana(roh)) return roh
  // Präfixe wie "/mozilla.org/20050126_1/Europe/Berlin" oder "/softwarestudio.org/Olson_20011030_5/Europe/Berlin"
  const teile = roh.split('/').filter(Boolean)
  for (let n = Math.min(3, teile.length); n >= 2; n--) {
    const kandidat = teile.slice(-n).join('/')
    if (/^[A-Za-z_]+\/[A-Za-z_+\-/]+$/.test(kandidat) && istIana(kandidat)) return kandidat
  }
  for (const [muster, zone] of STAEDTE) if (muster.test(roh)) return zone
  return null
}

const formate = new Map<string, Intl.DateTimeFormat>()
/** Abstand der Zone zu UTC (Minuten) zum Zeitpunkt `ms`. */
function zonenAbstand(zone: string, ms: number): number {
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
type Umrechner = (o: Ortszeit) => number

function ianaUmrechner(zone: string): Umrechner {
  return (o) => {
    const naiv = Date.UTC(o.j, o.mo - 1, o.t, o.h, o.mi, o.s)
    let ms = naiv - zonenAbstand(zone, naiv) * 60000
    // Zweiter Schritt für Zeiten nahe der Umstellung Sommer-/Winterzeit.
    const zweiter = naiv - zonenAbstand(zone, ms) * 60000
    if (zweiter !== ms) ms = zweiter
    return ms
  }
}

// Eigene Zeitzonen-Beschreibung aus der Datei (VTIMEZONE) — nur, wenn die TZID keine bekannte Zone ist
// (z. B. "Customized Time Zone" aus Outlook). Unterstützt jährliche Regeln mit BYMONTH/BYDAY.
type Abschnitt = { start: Ortszeit | null; von: number; zu: number; regel: Record<string, string> | null }

function versatz(wert: string): number | null {
  const m = wert.trim().match(/^([+-])(\d{2})(\d{2})(\d{2})?$/)
  if (!m) return null
  const min = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -min : min
}

const WOCHENTAGE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Tag im Monat für z. B. "-1SU" (letzter Sonntag) oder "2SU" (zweiter Sonntag). */
function tagNachRegel(jahr: number, monat: number, byday: string): number | null {
  const m = byday.trim().match(/^([+-]?\d{1,2})?([A-Z]{2})$/)
  if (!m) return null
  const wtag = WOCHENTAGE.indexOf(m[2])
  if (wtag < 0) return null
  const n = m[1] ? Number(m[1]) : 1
  const tageImMonat = new Date(Date.UTC(jahr, monat, 0)).getUTCDate()
  if (n > 0) {
    const ersterWtag = new Date(Date.UTC(jahr, monat - 1, 1)).getUTCDay()
    const tag = 1 + ((wtag - ersterWtag + 7) % 7) + (n - 1) * 7
    return tag <= tageImMonat ? tag : null
  }
  const letzterWtag = new Date(Date.UTC(jahr, monat - 1, tageImMonat)).getUTCDay()
  const tag = tageImMonat - ((letzterWtag - wtag + 7) % 7) + (n + 1) * 7
  return tag >= 1 ? tag : null
}

function vtimezoneUmrechner(abschnitte: Abschnitt[]): Umrechner | null {
  const brauchbar = abschnitte.filter((a) => Number.isFinite(a.zu))
  if (brauchbar.length === 0) return null
  return (o) => {
    const ziel = Date.UTC(o.j, o.mo - 1, o.t, o.h, o.mi, o.s)
    // Alle Umstellungen im Jahr davor und im Jahr selbst, als Ortszeit (vor der Umstellung) verglichen.
    const umstellungen: { wann: number; zu: number }[] = []
    for (const a of brauchbar) {
      const s = a.start ?? { j: 1970, mo: 1, t: 1, h: 0, mi: 0, s: 0 }
      const startMs = Date.UTC(s.j, s.mo - 1, s.t, s.h, s.mi, s.s)
      if (a.regel && String(a.regel.FREQ ?? '').toUpperCase() === 'YEARLY' && a.regel.BYMONTH && a.regel.BYDAY) {
        const monat = Number(a.regel.BYMONTH.split(',')[0])
        for (const jahr of [o.j - 1, o.j]) {
          const tag = tagNachRegel(jahr, monat, a.regel.BYDAY.split(',')[0])
          if (!tag) continue
          const wann = Date.UTC(jahr, monat - 1, tag, s.h, s.mi, s.s)
          if (wann >= startMs) umstellungen.push({ wann, zu: a.zu })
        }
      } else {
        umstellungen.push({ wann: startMs, zu: a.zu })
      }
    }
    umstellungen.sort((x, y) => x.wann - y.wann)
    let abstand = brauchbar[0].von
    for (const u of umstellungen) if (u.wann <= ziel) abstand = u.zu
    if (!Number.isFinite(abstand)) abstand = brauchbar[0].zu
    return ziel - abstand * 60000
  }
}

// ---------- Datum/Zeit-Werte ----------

function liesOrtszeit(wert: string): { o: Ortszeit; nurDatum: boolean; utc: boolean } | null {
  const m = wert.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i)
  if (!m) return null
  return {
    o: { j: Number(m[1]), mo: Number(m[2]), t: Number(m[3]), h: Number(m[4] ?? 0), mi: Number(m[5] ?? 0), s: Number(m[6] ?? 0) },
    nurDatum: m[4] === undefined,
    utc: !!m[7],
  }
}

function liesDauer(wert: string): { ms: number; tage: number } | null {
  const m = wert.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i)
  if (!m) return null
  const vz = m[1] === '-' ? -1 : 1
  const tage = (Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * vz
  const ms = (Number(m[4] ?? 0) * STUNDE + Number(m[5] ?? 0) * 60000 + Number(m[6] ?? 0) * 1000) * vz
  return { ms, tage }
}

const berlin = ianaUmrechner(STANDARD_ZONE)

/** Mitternacht deutscher Zeit an einem Kalendertag (für ganztägige Termine). */
function mitternacht(j: number, mo: number, t: number): number {
  const d = new Date(Date.UTC(j, mo - 1, t))
  return berlin({ j: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, t: d.getUTCDate(), h: 0, mi: 0, s: 0 })
}

// ---------- Lesen ----------

type Roh = { zeilen: Zeile[] }

/** Liest alle Termine (VEVENT) einer .ics-Datei. Fehlerhafte Einträge werden ausgelassen, nie geworfen. */
export function liesEinladungen(ics: string): Einladung[] {
  if (typeof ics !== 'string' || !/BEGIN:VCALENDAR/i.test(ics)) return []
  const zeilen = entfalte(ics)
  let methode = ''
  const termine: Roh[] = []
  const zonen = new Map<string, Abschnitt[]>()

  const stapel: string[] = []
  let termin: Roh | null = null
  let zoneId = ''
  let zoneAbschnitte: Abschnitt[] = []
  let abschnitt: Abschnitt | null = null

  for (const roh of zeilen) {
    const z = zerlegeZeile(roh)
    if (!z) continue
    if (z.name === 'BEGIN') {
      const art = z.wert.trim().toUpperCase()
      stapel.push(art)
      if (art === 'VEVENT' && stapel.length === 2) termin = { zeilen: [] }
      else if (art === 'VTIMEZONE') {
        zoneId = ''
        zoneAbschnitte = []
      } else if ((art === 'STANDARD' || art === 'DAYLIGHT') && stapel.includes('VTIMEZONE')) {
        abschnitt = { start: null, von: NaN, zu: NaN, regel: null }
      }
      continue
    }
    if (z.name === 'END') {
      const art = z.wert.trim().toUpperCase()
      // Fehlende END-Zeilen tolerieren: bis zur passenden Ebene zurück.
      const stelle = stapel.lastIndexOf(art)
      if (stelle >= 0) stapel.length = stelle
      if (art === 'VEVENT' && termin) {
        termine.push(termin)
        termin = null
      } else if (art === 'VTIMEZONE') {
        if (zoneId) zonen.set(zoneId, zoneAbschnitte)
      } else if ((art === 'STANDARD' || art === 'DAYLIGHT') && abschnitt) {
        zoneAbschnitte.push(abschnitt)
        abschnitt = null
      }
      continue
    }
    const oben = stapel[stapel.length - 1]
    if (oben === 'VCALENDAR' && z.name === 'METHOD') methode = z.wert.trim().toUpperCase()
    else if (oben === 'VEVENT' && termin && stapel.length === 2) termin.zeilen.push(z)
    else if (oben === 'VTIMEZONE' && z.name === 'TZID') zoneId = z.wert.trim()
    else if ((oben === 'STANDARD' || oben === 'DAYLIGHT') && abschnitt) {
      if (z.name === 'DTSTART') abschnitt.start = liesOrtszeit(z.wert)?.o ?? null
      else if (z.name === 'TZOFFSETFROM') abschnitt.von = versatz(z.wert) ?? NaN
      else if (z.name === 'TZOFFSETTO') abschnitt.zu = versatz(z.wert) ?? NaN
      else if (z.name === 'RRULE') {
        const regel: Record<string, string> = {}
        for (const teil of z.wert.split(';')) {
          const [k, v] = teil.split('=')
          if (k && v) regel[k.trim().toUpperCase()] = v.trim().toUpperCase()
        }
        abschnitt.regel = regel
      }
    }
  }

  const umrechner = new Map<string, Umrechner>()
  const fuerZone = (tzid: string | undefined): Umrechner => {
    if (!tzid) return berlin // "Floating": deutsche Zeit
    const schon = umrechner.get(tzid)
    if (schon) return schon
    const zone = bekannteZone(tzid)
    const r = zone ? ianaUmrechner(zone) : vtimezoneUmrechner(zonen.get(tzid) ?? zonen.get(tzid.replace(/^"(.*)"$/, '$1')) ?? []) ?? berlin
    umrechner.set(tzid, r)
    return r
  }

  const ergebnis: Einladung[] = []
  for (const t of termine) {
    try {
      const erste = (name: string) => t.zeilen.find((z) => z.name === name)
      const uid = erste('UID')?.wert.trim() ?? ''
      if (!uid) continue
      // Einzelne Änderung eines Serientermins — ausgelassen (siehe Kopf).
      if (erste('RECURRENCE-ID')) continue
      const startZeile = erste('DTSTART')
      if (!startZeile) continue
      const start = liesOrtszeit(startZeile.wert)
      if (!start) continue
      const ganztags = start.nurDatum || String(startZeile.params.VALUE ?? '').toUpperCase() === 'DATE'

      let beginnMs: number
      let endeMs: number
      const endZeile = erste('DTEND')
      const dauer = erste('DURATION') ? liesDauer(erste('DURATION')!.wert) : null
      if (ganztags) {
        beginnMs = mitternacht(start.o.j, start.o.mo, start.o.t)
        const ende = endZeile ? liesOrtszeit(endZeile.wert) : null
        if (ende) endeMs = mitternacht(ende.o.j, ende.o.mo, ende.o.t)
        else if (dauer) endeMs = mitternacht(start.o.j, start.o.mo, start.o.t + Math.max(1, dauer.tage + Math.ceil(dauer.ms / TAG)))
        else endeMs = mitternacht(start.o.j, start.o.mo, start.o.t + 1)
        if (endeMs <= beginnMs) endeMs = mitternacht(start.o.j, start.o.mo, start.o.t + 1)
      } else {
        beginnMs = start.utc ? Date.UTC(start.o.j, start.o.mo - 1, start.o.t, start.o.h, start.o.mi, start.o.s) : fuerZone(startZeile.params.TZID)(start.o)
        const ende = endZeile ? liesOrtszeit(endZeile.wert) : null
        if (ende) {
          endeMs = ende.utc
            ? Date.UTC(ende.o.j, ende.o.mo - 1, ende.o.t, ende.o.h, ende.o.mi, ende.o.s)
            : fuerZone(endZeile!.params.TZID ?? startZeile.params.TZID)(ende.o)
        } else if (dauer) endeMs = beginnMs + dauer.tage * TAG + dauer.ms
        else endeMs = beginnMs + STUNDE
        if (!(endeMs > beginnMs)) endeMs = beginnMs + STUNDE
      }
      if (!Number.isFinite(beginnMs) || !Number.isFinite(endeMs)) continue

      const orgZeile = erste('ORGANIZER')
      const organisator = orgZeile
        ? {
            name: orgZeile.params.CN ? textWert(orgZeile.params.CN) : undefined,
            email: orgZeile.wert.trim().replace(/^mailto:/i, '').toLowerCase() || undefined,
          }
        : undefined
      const status = String(erste('STATUS')?.wert ?? '').trim().toUpperCase()
      const stempel = erste('DTSTAMP') ? liesOrtszeit(erste('DTSTAMP')!.wert) : null
      const sequenz = Number.parseInt(String(erste('SEQUENCE')?.wert ?? '0').trim(), 10)
      const ort = textWert(erste('LOCATION')?.wert ?? '')
      const beschreibung = textWert(erste('DESCRIPTION')?.wert ?? '')
      ergebnis.push({
        uid,
        methode: status === 'CANCELLED' ? 'CANCEL' : methode,
        titel: textWert(erste('SUMMARY')?.wert ?? '') || '(ohne Titel)',
        beginn: new Date(beginnMs).toISOString(),
        ende: new Date(endeMs).toISOString(),
        ganztags,
        ...(ort ? { ort } : {}),
        ...(beschreibung ? { beschreibung } : {}),
        ...(organisator && (organisator.name || organisator.email) ? { organisator } : {}),
        sequenz: Number.isFinite(sequenz) ? sequenz : 0,
        serie: !!(erste('RRULE') || erste('RDATE')),
        ...(stempel ? { zeitstempel: new Date(stempel.utc ? Date.UTC(stempel.o.j, stempel.o.mo - 1, stempel.o.t, stempel.o.h, stempel.o.mi, stempel.o.s) : berlin(stempel.o)).toISOString() } : {}),
      })
    } catch (err) {
      console.error('Termin aus Einladung nicht lesbar:', (err as Error)?.message ?? err)
    }
  }
  return ergebnis
}

// ---------- Übernehmen ----------

// Wie in email-gateway/kalender.ts (ERLAUBTE_ERINNERUNGEN) — hier wiederholt, damit _shared nicht von
// einer einzelnen Funktion abhängt.
const ERINNERUNGEN = [1440, 60, 30, 15]
// Eigene Einladungen des CRM (an Kunden, Buchungsseite) tragen diese Endung — nie zurück übernehmen.
const EIGENE_UID = /@mayer-holding-crm$/i
// Termine, die schon länger vorbei sind, nicht mehr anlegen (z. B. beim ersten Abholen eines Postfachs).
const HOECHSTENS_VORBEI_MS = TAG
const BESCHREIBUNG_HOECHSTENS = 4000

function beschreibungFuer(e: Einladung): string {
  const wer = e.organisator ? [e.organisator.name, e.organisator.email ? `<${e.organisator.email}>` : ''].filter(Boolean).join(' ') : ''
  return [
    wer ? `Einladung von ${wer}` : 'Aus einer Kalender-Einladung übernommen',
    e.serie ? 'Serientermin — nur der erste Termin wurde übernommen.' : '',
    e.beschreibung ? `\n${e.beschreibung.slice(0, BESCHREIBUNG_HOECHSTENS)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

type Vorhanden = { id: string; titel: string; beschreibung: string; ort: string; beginn: string; ende: string; ganztags: boolean; gast: Record<string, unknown> | null }

/**
 * Übernimmt die Termine einer .ics-Datei in den Kalender von `besitzerEmail`.
 * REQUEST/PUBLISH (oder ohne METHOD): anlegen bzw. ändern. CANCEL: eigenen Termin mit dieser UID löschen.
 * Alles andere (REPLY, COUNTER, …) wird ausgelassen. Wirft nicht bei einzelnen Datenbankfehlern, sondern
 * zählt den Termin als ausgelassen und schreibt ins Protokoll.
 */
// deno-lint-ignore no-explicit-any
export async function uebernehmeEinladung(admin: any, besitzerEmail: string, ics: string): Promise<{ angelegt: number; geaendert: number; abgesagt: number; uebersprungen: number }> {
  const zaehler = { angelegt: 0, geaendert: 0, abgesagt: 0, uebersprungen: 0 }
  const besitzer = String(besitzerEmail ?? '').trim().toLowerCase()
  if (!besitzer) return zaehler
  const jetzt = Date.now()

  for (const e of liesEinladungen(ics)) {
    try {
      if (EIGENE_UID.test(e.uid)) {
        zaehler.uebersprungen++
        continue
      }
      const methode = (e.methode || 'PUBLISH').toUpperCase()

      if (methode === 'CANCEL') {
        const { data, error } = await admin.from('termine').delete().eq('besitzer_email', besitzer).eq('extern_uid', e.uid).select('id')
        if (error) throw new Error(error.message)
        const anzahl = Array.isArray(data) ? data.length : 0
        if (anzahl > 0) zaehler.abgesagt += anzahl
        else zaehler.uebersprungen++
        continue
      }
      if (methode !== 'REQUEST' && methode !== 'PUBLISH') {
        zaehler.uebersprungen++
        continue
      }

      const { data: alt, error: leseFehler } = await admin
        .from('termine')
        .select('id, titel, beschreibung, ort, beginn, ende, ganztags, gast')
        .eq('besitzer_email', besitzer)
        .eq('extern_uid', e.uid)
        .maybeSingle()
      if (leseFehler) throw new Error(leseFehler.message)
      const vorher = alt as Vorhanden | null

      if (!vorher && new Date(e.ende).getTime() < jetzt - HOECHSTENS_VORBEI_MS) {
        zaehler.uebersprungen++
        continue
      }

      const felder = {
        titel: e.titel.slice(0, 300),
        beschreibung: beschreibungFuer(e),
        ort: (e.ort ?? '').slice(0, 500),
        beginn: e.beginn,
        ende: e.ende,
        ganztags: e.ganztags,
      }
      const stand = { extern_sequenz: e.sequenz, ...(e.zeitstempel ? { extern_stempel: e.zeitstempel } : {}) }
      const bisBeginn = (new Date(e.beginn).getTime() - jetzt) / 60000
      const erinnert = { [besitzer]: ERINNERUNGEN.filter((m) => bisBeginn <= m) }

      if (!vorher) {
        const { error } = await admin.from('termine').insert({
          ...felder,
          besitzer_email: besitzer,
          teilnehmer: [],
          quelle: 'einladung',
          extern_uid: e.uid,
          gast: stand,
          erinnert,
          geaendert_am: new Date().toISOString(),
        })
        // 23505: ein gleichzeitiger Lauf hat dieselbe Einladung gerade angelegt.
        if (error && error.code !== '23505') throw new Error(error.message)
        if (error) zaehler.uebersprungen++
        else zaehler.angelegt++
        continue
      }

      // Ältere Fassung als die schon übernommene? Dann nichts tun.
      const gast = (vorher.gast ?? {}) as Record<string, unknown>
      const altSequenz = typeof gast.extern_sequenz === 'number' ? gast.extern_sequenz : -1
      const altStempel = typeof gast.extern_stempel === 'string' ? gast.extern_stempel : ''
      if (e.sequenz < altSequenz || (e.sequenz === altSequenz && altStempel && e.zeitstempel && e.zeitstempel < altStempel)) {
        zaehler.uebersprungen++
        continue
      }
      const zeitGeaendert =
        new Date(vorher.beginn).getTime() !== new Date(felder.beginn).getTime() ||
        new Date(vorher.ende).getTime() !== new Date(felder.ende).getTime() ||
        vorher.ganztags !== felder.ganztags
      const inhaltGeaendert = zeitGeaendert || vorher.titel !== felder.titel || (vorher.ort ?? '') !== felder.ort || (vorher.beschreibung ?? '') !== felder.beschreibung
      if (!inhaltGeaendert) {
        // Gleicher Inhalt: nur den Stand nachziehen, damit eine spätere ältere Fassung erkannt wird.
        if (e.sequenz > altSequenz || (e.zeitstempel && e.zeitstempel > altStempel)) {
          await admin.from('termine').update({ gast: { ...gast, ...stand } }).eq('id', vorher.id)
        }
        zaehler.uebersprungen++
        continue
      }
      const { error } = await admin
        .from('termine')
        .update({ ...felder, gast: { ...gast, ...stand }, geaendert_am: new Date().toISOString(), ...(zeitGeaendert ? { erinnert } : {}) })
        .eq('id', vorher.id)
        .eq('besitzer_email', besitzer)
      if (error) throw new Error(error.message)
      zaehler.geaendert++
    } catch (err) {
      console.error('Einladung nicht übernommen:', besitzer, e.uid, (err as Error)?.message ?? err)
      zaehler.uebersprungen++
    }
  }
  return zaehler
}
