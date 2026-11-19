// Baut Kalender-Einladungen im iCalendar-Format (.ics, RFC 5545), wie sie Outlook, Apple Kalender und
// Google Kalender per E-Mail verstehen. Zeiten werden immer in UTC geschrieben (…Z), ganztägige Termine
// als DATE. Gemeinsame Grundlage für die Buchungsseite und für Einladungen an Kunden.

export type IcsPerson = { name?: string; email: string }

export type IcsTermin = {
  /** Dauerhafte Kennung des Termins; dieselbe UID ändert bzw. sagt einen bereits verschickten Termin ab. */
  uid: string
  titel: string
  beginn: string // ISO-Zeitpunkt
  ende: string // ISO-Zeitpunkt
  ganztags?: boolean
  ort?: string
  beschreibung?: string
  organisator: IcsPerson
  teilnehmer?: IcsPerson[]
  /** REQUEST = Einladung/Änderung, CANCEL = Absage. */
  methode?: 'REQUEST' | 'CANCEL'
  /** Zählt bei jeder Änderung hoch, damit Kalender die neue Fassung übernehmen. */
  sequenz?: number
}

function utc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function datum(iso: string): string {
  // Ganztägig: Kalendertag in deutscher Zeit.
  const teile = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  return teile.replace(/-/g, '')
}

/** DTEND eines ganztägigen Termins ist laut RFC 5545 der Tag NACH dem letzten Tag. */
function folgetag(jjjjmmtt: string): string {
  const d = new Date(Date.UTC(Number(jjjjmmtt.slice(0, 4)), Number(jjjjmmtt.slice(4, 6)) - 1, Number(jjjjmmtt.slice(6, 8)) + 1))
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function text(wert: string): string {
  return wert.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Zeilen über 75 Byte nach RFC 5545 falten (Fortsetzung beginnt mit einem Leerzeichen). */
function falte(zeile: string): string {
  const bytes = new TextEncoder().encode(zeile)
  if (bytes.length <= 75) return zeile
  const teile: string[] = []
  let rest = zeile
  let grenze = 75
  while (new TextEncoder().encode(rest).length > grenze) {
    let n = Math.min(rest.length, grenze)
    while (new TextEncoder().encode(rest.slice(0, n)).length > grenze) n--
    teile.push(rest.slice(0, n))
    rest = rest.slice(n)
    grenze = 74 // Folgezeilen haben das führende Leerzeichen
  }
  teile.push(rest)
  return teile.join('\r\n ')
}

function person(rolle: 'ORGANIZER' | 'ATTENDEE', p: IcsPerson): string {
  const name = p.name ? `;CN=${text(p.name).replace(/"/g, '')}` : ''
  const extra = rolle === 'ATTENDEE' ? ';ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE' : ''
  return `${rolle}${name}${extra}:mailto:${p.email}`
}

/** Liefert den Inhalt einer .ics-Datei (CRLF-Zeilenenden) für genau einen Termin. */
export function baueIcs(t: IcsTermin): string {
  const methode = t.methode ?? 'REQUEST'
  const zeilen = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mayer Holding CRM//DE',
    'CALSCALE:GREGORIAN',
    `METHOD:${methode}`,
    'BEGIN:VEVENT',
    `UID:${t.uid}`,
    `DTSTAMP:${utc(new Date().toISOString())}`,
    `SEQUENCE:${t.sequenz ?? 0}`,
    ...(t.ganztags
      ? [`DTSTART;VALUE=DATE:${datum(t.beginn)}`, `DTEND;VALUE=DATE:${folgetag(datum(t.ende))}`]
      : [`DTSTART:${utc(t.beginn)}`, `DTEND:${utc(t.ende)}`]),
    `SUMMARY:${text(t.titel)}`,
    ...(t.ort ? [`LOCATION:${text(t.ort)}`] : []),
    ...(t.beschreibung ? [`DESCRIPTION:${text(t.beschreibung)}`] : []),
    person('ORGANIZER', t.organisator),
    ...(t.teilnehmer ?? []).map((p) => person('ATTENDEE', p)),
    `STATUS:${methode === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return zeilen.map(falte).join('\r\n') + '\r\n'
}

/** Als Mail-Anhang für sendMail (Base64), mit dem Inhaltstyp, an dem Mailprogramme eine Einladung erkennen. */
export function icsAnhang(t: IcsTermin, dateiname = 'einladung.ics'): { filename: string; contentBase64: string; contentType: string } {
  const bytes = new TextEncoder().encode(baueIcs(t))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return { filename: dateiname, contentBase64: btoa(bin), contentType: `text/calendar; charset=utf-8; method=${t.methode ?? 'REQUEST'}` }
}
