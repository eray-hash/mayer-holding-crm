// Prüft den Leser für fremde Kalender (_shared/icsBelegt.ts) und das Abrufen/Speichern (fremdKalender.ts)
// ohne Netz: Serien, Zeitzonen, Ausnahmen, frei markierte Termine, Link-Prüfung, Weiterleitungen, Zeitplan.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { belegtAusIcs } from '../_shared/icsBelegt.ts'
import { fremdKalenderAbruf, fremdKalenderAktion, holeFremdIcs, pruefeFremdUrl } from './fremdKalender.ts'
import { falscheDatenbank } from '../_shared/testDoppel.ts'

const ms = (iso: string) => Date.parse(iso)
const kal = (...termine: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//DE', ...termine, 'END:VCALENDAR'].join('\r\n')
const termin = (...zeilen: string[]) => ['BEGIN:VEVENT', ...zeilen, 'END:VEVENT'].join('\r\n')
const FENSTER: [number, number] = [ms('2026-11-01T00:00:00Z'), ms('2027-01-31T00:00:00Z')]

Deno.test('Einzeltermin mit TZID Europe/Berlin (Winterzeit) → UTC', () => {
  const r = belegtAusIcs(kal(termin('UID:a', 'SUMMARY:Geheim', 'DTSTART;TZID=Europe/Berlin:20261127T100000', 'DTEND;TZID=Europe/Berlin:20261127T113000')), ...FENSTER)
  assertEquals(r.bloecke, [{ b: '2026-11-27T09:00:00.000Z', e: '2026-11-27T10:30:00.000Z' }])
  // Nur Zeiten — kein Titel im Ergebnis
  assert(!JSON.stringify(r).includes('Geheim'))
})

Deno.test('Outlook-Zonenname, UTC-Zeit, Zeit ohne Zone und DURATION', () => {
  const r = belegtAusIcs(
    kal(
      termin('UID:a', 'DTSTART;TZID="W. Europe Standard Time":20261110T080000', 'DTEND;TZID="W. Europe Standard Time":20261110T090000'),
      termin('UID:b', 'DTSTART:20261111T120000Z', 'DURATION:PT45M'),
      termin('UID:c', 'DTSTART:20261112T140000', 'DTEND:20261112T150000'),
    ),
    ...FENSTER,
  )
  assertEquals(r.bloecke.map((x) => [x.b, x.e]), [
    ['2026-11-10T07:00:00.000Z', '2026-11-10T08:00:00.000Z'],
    ['2026-11-11T12:00:00.000Z', '2026-11-11T12:45:00.000Z'],
    ['2026-11-12T13:00:00.000Z', '2026-11-12T14:00:00.000Z'],
  ])
})

Deno.test('Abgesagt, frei (TRANSPARENT, Outlook FREE) und Zeitpunkt ohne Ende belegen nichts', () => {
  const r = belegtAusIcs(
    kal(
      termin('UID:a', 'STATUS:CANCELLED', 'DTSTART:20261110T080000Z', 'DTEND:20261110T090000Z'),
      termin('UID:b', 'TRANSP:TRANSPARENT', 'DTSTART:20261110T100000Z', 'DTEND:20261110T110000Z'),
      termin('UID:c', 'X-MICROSOFT-CDO-BUSYSTATUS:FREE', 'DTSTART:20261110T120000Z', 'DTEND:20261110T130000Z'),
      termin('UID:d', 'DTSTART:20261110T140000Z'),
    ),
    ...FENSTER,
  )
  assertEquals(r.bloecke, [])
  assertEquals(r.termine, 4)
})

Deno.test('Ganztägig: Mitternacht Berlin, mehrtägig; sperrt nur ausdrücklich markiert', () => {
  const r = belegtAusIcs(
    kal(
      termin('UID:a', 'DTSTART;VALUE=DATE:20261124', 'DTEND;VALUE=DATE:20261127', 'X-MICROSOFT-CDO-BUSYSTATUS:OOF'),
      termin('UID:b', 'DTSTART;VALUE=DATE:20261201'),
    ),
    ...FENSTER,
  )
  assertEquals(r.bloecke, [
    { b: '2026-11-23T23:00:00.000Z', e: '2026-11-26T23:00:00.000Z', g: true, a: true },
    { b: '2026-11-30T23:00:00.000Z', e: '2026-12-01T23:00:00.000Z', g: true },
  ])
})

Deno.test('Wöchentliche Serie über die Zeitumstellung bleibt um 9 Uhr Ortszeit, mit COUNT und EXDATE', () => {
  const r = belegtAusIcs(
    kal(
      termin(
        'UID:serie',
        'DTSTART;TZID=Europe/Berlin:20261019T090000',
        'DTEND;TZID=Europe/Berlin:20261019T100000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4',
        'EXDATE;TZID=Europe/Berlin:20261102T090000',
      ),
    ),
    ms('2026-10-01T00:00:00Z'),
    ms('2027-01-01T00:00:00Z'),
  )
  // 19.10. (Sommerzeit, 07:00Z), 26.10. (Winterzeit, 08:00Z), 02.11. fällt aus, 09.11. — COUNT=4 zählt den ausgefallenen mit
  assertEquals(r.bloecke.map((x) => x.b), ['2026-10-19T07:00:00.000Z', '2026-10-26T08:00:00.000Z', '2026-11-09T08:00:00.000Z'])
})

Deno.test('Wöchentlich an mehreren Tagen mit INTERVAL und UNTIL', () => {
  const r = belegtAusIcs(
    kal(termin('UID:s', 'DTSTART:20261102T080000Z', 'DTEND:20261102T083000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261130T235959Z')),
    ...FENSTER,
  )
  assertEquals(r.bloecke.map((x) => x.b.slice(0, 10)), ['2026-11-02', '2026-11-05', '2026-11-16', '2026-11-19', '2026-11-30'])
})

Deno.test('Täglich, monatlich (letzter Freitag) und jährlich; Serie von 2015 läuft bis ins Fenster', () => {
  const r = belegtAusIcs(
    kal(
      termin('UID:t', 'DTSTART;TZID=Europe/Berlin:20261103T120000', 'DTEND;TZID=Europe/Berlin:20261103T123000', 'RRULE:FREQ=DAILY;COUNT=3'),
      termin('UID:m', 'DTSTART;TZID=Europe/Berlin:20260130T150000', 'DTEND;TZID=Europe/Berlin:20260130T160000', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR'),
      termin('UID:j', 'DTSTART;TZID=Europe/Berlin:20151215T180000', 'DTEND;TZID=Europe/Berlin:20151215T200000', 'RRULE:FREQ=YEARLY'),
    ),
    ...FENSTER,
  )
  const tage = r.bloecke.map((x) => x.b.slice(0, 10))
  assertEquals(tage, ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-27', '2026-12-15', '2026-12-25', '2027-01-29'])
})

Deno.test('Geänderter Einzeltermin einer Serie ersetzt den ursprünglichen; abgesagter fällt weg', () => {
  const r = belegtAusIcs(
    kal(
      termin('UID:x', 'DTSTART;TZID=Europe/Berlin:20261102T100000', 'DTEND;TZID=Europe/Berlin:20261102T110000', 'RRULE:FREQ=WEEKLY;COUNT=3'),
      termin('UID:x', 'RECURRENCE-ID;TZID=Europe/Berlin:20261109T100000', 'DTSTART;TZID=Europe/Berlin:20261110T140000', 'DTEND;TZID=Europe/Berlin:20261110T150000'),
      termin('UID:x', 'RECURRENCE-ID;TZID=Europe/Berlin:20261116T100000', 'STATUS:CANCELLED', 'DTSTART;TZID=Europe/Berlin:20261116T100000', 'DTEND;TZID=Europe/Berlin:20261116T110000'),
    ),
    ...FENSTER,
  )
  assertEquals(r.bloecke.map((x) => x.b), ['2026-11-02T09:00:00.000Z', '2026-11-10T13:00:00.000Z'])
})

Deno.test('Gefaltete Zeilen, Erinnerung im Termin, kaputter Eintrag und Fenstergrenzen', () => {
  const ics = kal(
    termin('UID:a', 'DTSTART;TZID=Europe/Be', ' rlin:20261105T100000', 'DTEND;TZID=Europe/Berlin:20261105T110000', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'DTSTART:19990101T000000Z', 'END:VALARM'),
    termin('UID:kaputt', 'DTSTART:gestern'),
    termin('UID:alt', 'DTSTART:20250101T100000Z', 'DTEND:20250101T110000Z'),
  )
  const r = belegtAusIcs(ics, ...FENSTER)
  assertEquals(r.bloecke, [{ b: '2026-11-05T09:00:00.000Z', e: '2026-11-05T10:00:00.000Z' }])
  assertEquals(belegtAusIcs('kein Kalender', ...FENSTER).bloecke, [])
})

Deno.test('Endlose tägliche Serie wird begrenzt', () => {
  const r = belegtAusIcs(kal(termin('UID:a', 'DTSTART:20261101T080000Z', 'DTEND:20261101T081500Z', 'RRULE:FREQ=DAILY')), ms('2026-11-01T00:00:00Z'), ms('2036-11-01T00:00:00Z'), 100)
  assertEquals(r.bloecke.length, 100)
  assert(r.gekuerzt)
})

Deno.test('Link-Prüfung', () => {
  assertEquals(pruefeFremdUrl('webcal://p01-caldav.icloud.com/published/2/abc'), { ok: true, url: 'https://p01-caldav.icloud.com/published/2/abc' })
  assertEquals(pruefeFremdUrl('http://outlook.office365.com/owa/calendar/x/calendar.ics').ok, true)
  for (const schlecht of ['', 'ftp://x.de/a.ics', 'https://127.0.0.1/a.ics', 'https://[::1]/a.ics', 'https://localhost/a.ics', 'https://drucker.local/a.ics', 'https://nutzer:pw@x.de/a.ics', 'https://x.de:8080/a.ics', 'https://abc.supabase.co/x', 'kein link']) {
    assertEquals(pruefeFremdUrl(schlecht).ok, false, schlecht)
  }
})

// Ein Termin übermorgen (liegt sicher im Abruffenster von 7 Tagen zurück bis ein Jahr voraus).
const icsZeit = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const UEBERMORGEN = new Date(Date.now() + 2 * 86400000)
const KALENDER = kal(termin('UID:a', `DTSTART:${icsZeit(UEBERMORGEN)}`, `DTEND:${icsZeit(new Date(UEBERMORGEN.getTime() + 3600000))}`))

function falschesNetz(antworten: Record<string, () => Response>) {
  const aufrufe: string[] = []
  const abruf = ((eingabe: string | URL | Request) => {
    const url = String(eingabe)
    aufrufe.push(url)
    const f = antworten[url]
    return Promise.resolve(f ? f() : new Response('weg', { status: 404 }))
  }) as typeof fetch
  return { abruf, aufrufe }
}

Deno.test('Abruf: Weiterleitung wird geprüft, interne Ziele abgelehnt, Fehlermeldungen verständlich', async () => {
  const netz = falschesNetz({
    'https://kalender.example.com/a.ics': () => new Response(null, { status: 302, headers: { location: '/b.ics' } }),
    'https://kalender.example.com/b.ics': () => new Response(KALENDER, { status: 200 }),
    'https://kalender.example.com/boese.ics': () => new Response(null, { status: 301, headers: { location: 'https://169.254.169.254/latest' } }),
    'https://kalender.example.com/seite': () => new Response('<html>Kalender ansehen</html>', { status: 200 }),
    'https://kalender.example.com/zu.ics': () => new Response('x', { status: 403 }),
  })
  assertStringIncludes(await holeFremdIcs('https://kalender.example.com/a.ics', netz.abruf), 'BEGIN:VCALENDAR')
  const fehler = async (url: string) => {
    try {
      await holeFremdIcs(url, netz.abruf)
      return ''
    } catch (err) {
      return (err as Error).message
    }
  }
  assertStringIncludes(await fehler('https://kalender.example.com/boese.ics'), 'IP-Adresse')
  assertEquals(netz.aufrufe.includes('https://169.254.169.254/latest'), false)
  assertStringIncludes(await fehler('https://kalender.example.com/seite'), 'kein Kalender')
  assertStringIncludes(await fehler('https://kalender.example.com/zu.ics'), 'nicht freigegeben')
  assertStringIncludes(await fehler('https://kalender.example.com/weg.ics'), 'nicht (mehr)')
})

Deno.test('Aktionen: speichern liest erst, falscher Link wird nicht gespeichert; laden, entfernen', async () => {
  const db = falscheDatenbank({ kalender_fremd: [] })
  const netz = falschesNetz({ 'https://kalender.example.com/gut.ics': () => new Response(KALENDER) })
  const schlecht = await fremdKalenderAktion(db, 'Eray@X.de', { action: 'kalender_fremd_speichern', url: 'https://kalender.example.com/falsch.ics' }, netz.abruf)
  assertEquals(schlecht.status, 400)
  assertEquals(db.tabellen.kalender_fremd.length, 0)

  const gut = await fremdKalenderAktion(db, 'Eray@X.de', { action: 'kalender_fremd_speichern', url: 'webcal://kalender.example.com/gut.ics' }, netz.abruf)
  assertEquals(gut.status, 200)
  assertEquals(gut.daten.verbunden, true)
  assertEquals(gut.daten.anzahl, 1)
  assertEquals(db.tabellen.kalender_fremd[0].email, 'eray@x.de')
  assertEquals(db.tabellen.kalender_fremd[0].url, 'https://kalender.example.com/gut.ics')

  const geladen = await fremdKalenderAktion(db, 'eray@x.de', { action: 'kalender_fremd_laden' }, netz.abruf)
  assertEquals(geladen.daten.url, 'https://kalender.example.com/gut.ics')
  // Ein anderer Mitarbeiter sieht den Link nicht.
  assertEquals((await fremdKalenderAktion(db, 'hasan@x.de', { action: 'kalender_fremd_laden' }, netz.abruf)).daten, { verbunden: false })

  const weg = await fremdKalenderAktion(db, 'eray@x.de', { action: 'kalender_fremd_speichern', url: '' }, netz.abruf)
  assertEquals(weg.daten, { verbunden: false })
  assertEquals(db.tabellen.kalender_fremd.length, 0)
})

Deno.test('Zeitplan: holt nur fällige, Fehler lassen alte Zeiten stehen', async () => {
  const jetzt = Date.now()
  const db = falscheDatenbank({
    kalender_fremd: [
      { email: 'a@x.de', url: 'https://kalender.example.com/gut.ics', belegt: [], anzahl: 0, versucht_am: null, fehler: null, fehler_seit: null },
      { email: 'b@x.de', url: 'https://kalender.example.com/weg.ics', belegt: [{ b: 'alt', e: 'alt' }], anzahl: 1, versucht_am: new Date(jetzt - 60 * 60000).toISOString(), fehler: null, fehler_seit: null },
      { email: 'c@x.de', url: 'https://kalender.example.com/gut.ics', belegt: [], anzahl: 0, versucht_am: new Date(jetzt - 60000).toISOString(), fehler: null, fehler_seit: null },
    ],
  })
  const netz = falschesNetz({ 'https://kalender.example.com/gut.ics': () => new Response(KALENDER) })
  const r = await fremdKalenderAbruf(db, 10_000, netz.abruf)
  assertEquals(r, { geprueft: 2, ok: 1, fehler: 1 })
  const [a, b, c] = db.tabellen.kalender_fremd
  assertEquals(a.anzahl, 1)
  assertEquals(b.belegt, [{ b: 'alt', e: 'alt' }])
  assertStringIncludes(String(b.fehler), 'nicht (mehr)')
  assert(b.fehler_seit)
  assertEquals(c.versucht_am, new Date(jetzt - 60000).toISOString())
})
