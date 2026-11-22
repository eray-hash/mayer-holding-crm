// Tests: freitags nicht mehr drei Berichte an dieselbe Person (22.11.2026).
// Wer den Wochenrückblick bekommt, bekommt weder den Wochenbericht der Tagesmeldung noch den Superuser-Wochenbericht;
// Superuser finden ihren Teil als Zusatz im Wochenrückblick. Datenbank im Speicher, ohne Netz und ohne KI.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { sendeTagesmeldungen, tagesmeldungTest } from './tagesmeldung.ts'
import { pruefeSuperuserWochenbericht } from './superuser.ts'
import { mitAnhang, pruefeWochenrueckblick, wochenrueckblickTest } from './wochenrueckblick.ts'
import { wochenrueckblickAdressen } from './wochenrueckblickEmpfaenger.ts'

// Freitag, 20.11.2026, 16:05 Uhr in Berlin (Winterzeit = UTC+1)
const FREITAG = new Date('2026-11-20T15:05:00Z')
const ERAY = 'eray@example.de'
const HASAN = 'hasan@example.de'
const ANDREAS = 'andreas@example.de'
const QUIRIN = 'quirin@example.de'

/** Die Testdatenbank kennt range/ilike/not und JSON-Pfade (daten->>version) nicht — hier nachgebildet. */
// deno-lint-ignore no-explicit-any
function db(tabellen: Record<string, Zeile[]>): any {
  const d = falscheDatenbank(tabellen)
  const from = d.from.bind(d)
  const jsonFilter = (s: string, pruef: (v: string | null) => boolean) => {
    const [spalte, feld] = s.split('->>')
    return (z: Zeile) => {
      const o = z[spalte] as Record<string, unknown> | null | undefined
      const v = o && typeof o === 'object' ? o[feld] : undefined
      return pruef(v == null ? null : String(v))
    }
  }
  // deno-lint-ignore no-explicit-any
  ;(d as any).from = (t: string) => {
    // deno-lint-ignore no-explicit-any
    const q: any = from(t)
    const eq = q.eq.bind(q)
    const is = q.is.bind(q)
    q.range = (ab: number) => (ab === 0 ? q : q.limit(0))
    q.ilike = (s: string, w: string) => eq(s, w.replace(/\\(.)/g, '$1'))
    q.not = (s: string) => (q.filter.push((z: Zeile) => z[s] != null), q)
    q.eq = (s: string, w: unknown) => (s.includes('->>') ? (q.filter.push(jsonFilter(s, (v) => v === String(w))), q) : eq(s, w))
    q.is = (s: string, w: unknown) => (s.includes('->>') ? (q.filter.push(jsonFilter(s, (v) => v === null)), q) : is(s, w))
    return q
  }
  // deno-lint-ignore no-explicit-any
  ;(d as any).auth = { admin: { listUsers: () => Promise.resolve({ data: { users: [] }, error: null }) } }
  return d
}

function team(): Zeile[] {
  return [
    { id: '1', name: 'Eray Yesil', email: ERAY, aktiv: true, rolle: 'geschaeftsfuehrung', ist_admin: true, ist_superuser: true, telegram_chat_id: 111, bereiche: [] },
    { id: '2', name: 'Hasan Süslü', email: HASAN, aktiv: true, rolle: 'geschaeftsfuehrung', ist_admin: true, ist_superuser: false, telegram_chat_id: 222, bereiche: [] },
    { id: '3', name: 'Andreas Mayer', email: ANDREAS, aktiv: true, rolle: 'geschaeftsfuehrung', ist_admin: false, ist_superuser: false, telegram_chat_id: 444, bereiche: [] },
    { id: '4', name: 'Quirin Lutzenberger', email: QUIRIN, aktiv: true, rolle: 'mitarbeiter', ist_admin: false, ist_superuser: false, telegram_chat_id: 333, bereiche: ['immobilien'] },
  ]
}

function tabellen(einstellung?: Record<string, unknown>, mitarbeiter: Zeile[] = team()): Record<string, Zeile[]> {
  return {
    mitarbeiter,
    kalender_einstellungen: [],
    kunden: [],
    objekte: [],
    rechnungen: [],
    vorgeschlagene_leads: [],
    termine: [],
    todos: [],
    abteilung_eintraege: einstellung ? [{ id: 'wochenrueckblick_einstellung', art: 'wochenrueckblick_einstellung', daten: einstellung }] : [],
  }
}

function sammler() {
  const gesendet: { chat: number | string; text: string }[] = []
  return { gesendet, sende: (chat: number | string, text: string) => (gesendet.push({ chat, text }), Promise.resolve(true)) }
}

const RUECKBLICK_AN_ERAY = { an: true, berichtAn: [ERAY], wochentag: 5, stunde: 16, zusammenfassung: false }

// ---------------------------------------------------------------------------------------------
// Wer bekommt den Rückblick?
// ---------------------------------------------------------------------------------------------

Deno.test('wochenrueckblickAdressen: nur eingeschaltet, nur Geschäftsführung mit Telegram aus berichtAn', async () => {
  assertEquals([...(await wochenrueckblickAdressen(db(tabellen(RUECKBLICK_AN_ERAY))))], [ERAY])
  assertEquals([...(await wochenrueckblickAdressen(db(tabellen({ ...RUECKBLICK_AN_ERAY, an: false }))))], [])
  assertEquals([...(await wochenrueckblickAdressen(db(tabellen())))], [])
  // Quirin ist keine Geschäftsführung → zählt nicht, auch wenn er eingetragen wäre
  assertEquals([...(await wochenrueckblickAdressen(db(tabellen({ ...RUECKBLICK_AN_ERAY, berichtAn: [ERAY, QUIRIN] }))))], [ERAY])
})

// ---------------------------------------------------------------------------------------------
// Wochenbericht der Tagesmeldung
// ---------------------------------------------------------------------------------------------

Deno.test('Tagesmeldung-Wochenbericht: nicht an Empfänger des Wochenrückblicks, die anderen unverändert', async () => {
  const d = db(tabellen(RUECKBLICK_AN_ERAY))
  const s = sammler()
  const r = await sendeTagesmeldungen(d, s.sende, FREITAG, s.sende)
  assertEquals(r.woche, 2)
  assertEquals(s.gesendet.map((g) => g.chat).sort(), [222, 444])
  for (const g of s.gesendet) assertStringIncludes(g.text, 'Wochenbericht')
  // Nächster Takt: Hasan und Andreas sind erledigt, Eray bleibt ausgenommen
  const s2 = sammler()
  assertEquals((await sendeTagesmeldungen(d, s2.sende, new Date('2026-11-20T15:06:00Z'), s2.sende)).woche, 0)
  assertEquals(s2.gesendet.length, 0)
})

Deno.test('Tagesmeldung-Wochenbericht: ohne Rückblick (keine Zeile oder ausgeschaltet) bekommen ihn alle Geschäftsführer', async () => {
  for (const einstellung of [undefined, { ...RUECKBLICK_AN_ERAY, an: false }]) {
    const s = sammler()
    assertEquals((await sendeTagesmeldungen(db(tabellen(einstellung)), s.sende, FREITAG, s.sende)).woche, 3)
    assertEquals(s.gesendet.map((g) => g.chat).sort(), [111, 222, 444])
  }
})

Deno.test('Tagesmeldung-Wochenbericht: ausgenommen ist nur, wer den Rückblick wirklich bekommt', async () => {
  // Eray steht in berichtAn, hat aber kein Telegram → bekommt weder Rückblick noch Tagesmeldung (die geht nur mit Telegram)
  const ohneTelegram = team().map((m) => (m.email === ERAY ? { ...m, telegram_chat_id: null } : m))
  const s = sammler()
  assertEquals((await sendeTagesmeldungen(db(tabellen(RUECKBLICK_AN_ERAY, ohneTelegram)), s.sende, FREITAG, s.sende)).woche, 2)
  // Andreas steht in berichtAn mit Telegram → er wird ausgenommen, Eray (nicht eingetragen) bekommt ihn
  const s2 = sammler()
  assertEquals((await sendeTagesmeldungen(db(tabellen({ ...RUECKBLICK_AN_ERAY, berichtAn: [ANDREAS] })), s2.sende, FREITAG, s2.sende)).woche, 2)
  assertEquals(s2.gesendet.map((g) => g.chat).sort(), [111, 222])
})

Deno.test('Tagesmeldung-Wochenbericht: Einstellung nicht lesbar → niemand vermerkt, nächster Takt sendet', async () => {
  const d = db(tabellen(RUECKBLICK_AN_ERAY))
  let kaputt = true
  const from = d.from
  d.from = (t: string) => {
    const q = from(t)
    if (t === 'abteilung_eintraege' && kaputt) {
      const eq = q.eq
      q.eq = (s: string, w: unknown) => (w === 'wochenrueckblick_einstellung' ? { maybeSingle: () => Promise.resolve({ data: null, error: { message: 'weg' } }) } : eq(s, w))
    }
    return q
  }
  const s = sammler()
  assertEquals((await sendeTagesmeldungen(d, s.sende, FREITAG, s.sende)).woche, 0)
  assertEquals(s.gesendet.length, 0)
  kaputt = false
  assertEquals((await sendeTagesmeldungen(d, s.sende, new Date('2026-11-20T15:06:00Z'), s.sende)).woche, 2)
})

Deno.test('tagesmeldungTest: Hinweis, wenn die Person stattdessen den Wochenrückblick bekommt', async () => {
  const d = db(tabellen(RUECKBLICK_AN_ERAY))
  const s = sammler()
  const eray = await tagesmeldungTest(d, s.sende, { email: ERAY, art: 'woche', jetzt: FREITAG.toISOString() }, s.sende)
  assert(eray.ok)
  assertStringIncludes(eray.hinweis ?? '', 'Wochenrückblick')
  const hasan = await tagesmeldungTest(d, s.sende, { email: HASAN, art: 'woche', jetzt: FREITAG.toISOString() }, s.sende)
  assert(hasan.ok && !hasan.hinweis)
})

// ---------------------------------------------------------------------------------------------
// Superuser-Wochenbericht
// ---------------------------------------------------------------------------------------------

Deno.test('Superuser-Wochenbericht: nicht an Superuser, die den Rückblick bekommen; andere Superuser weiter', async () => {
  const mitZweitemSuperuser = team().map((m) => (m.email === HASAN ? { ...m, ist_superuser: true } : m))
  const d = db(tabellen(RUECKBLICK_AN_ERAY, mitZweitemSuperuser))
  const s = sammler()
  assertEquals(await pruefeSuperuserWochenbericht(d, s.sende, FREITAG), 1)
  assertEquals(s.gesendet.map((g) => g.chat), [222])
  assertStringIncludes(s.gesendet[0].text, 'Superuser-Wochenbericht')
  assertStringIncludes(s.gesendet[0].text, 'Neue Akten: 0')
  assertEquals(await pruefeSuperuserWochenbericht(d, s.sende, new Date('2026-11-20T15:06:00Z')), 0)
  assertEquals(s.gesendet.length, 1)
})

Deno.test('Superuser-Wochenbericht: einziger Superuser bekommt den Rückblick → nichts, Woche trotzdem vermerkt', async () => {
  const d = db(tabellen(RUECKBLICK_AN_ERAY))
  const s = sammler()
  assertEquals(await pruefeSuperuserWochenbericht(d, s.sende, FREITAG), 0)
  assertEquals(s.gesendet.length, 0)
  const zeile = d.tabelle('abteilung_eintraege').find((z: Zeile) => z.id === 'superuser_wochenbericht')
  assertEquals((zeile.daten as Record<string, unknown>).woche, '2026-11-20')
  // Ohne Rückblick bekommt Eray ihn wie bisher
  const s2 = sammler()
  assertEquals(await pruefeSuperuserWochenbericht(db(tabellen()), s2.sende, FREITAG), 1)
  assertEquals(s2.gesendet.map((g) => g.chat), [111])
})

// ---------------------------------------------------------------------------------------------
// Wochenrückblick mit Zusatz für Superuser
// ---------------------------------------------------------------------------------------------

Deno.test('Wochenrückblick: Superuser bekommen den Zusatz, andere nicht', async () => {
  const d = db(tabellen({ ...RUECKBLICK_AN_ERAY, berichtAn: [ERAY, HASAN] }))
  const s = sammler()
  let gebaut = 0
  const anhang = () => (gebaut++, Promise.resolve('Zusatz für Superuser:\n\nNutzung: Eray 90 Min.'))
  assertEquals((await pruefeWochenrueckblick(d, s.sende, { anhang }, FREITAG)).gesendet, 2)
  assertEquals(gebaut, 1)
  const an = (chat: number) => s.gesendet.filter((g) => g.chat === chat).map((g) => g.text)
  assertEquals(an(111).length, 1)
  assert(an(111)[0].startsWith('Wochenrückblick'))
  assertStringIncludes(an(111)[0], 'Zusatz für Superuser:\n\nNutzung: Eray 90 Min.')
  assertEquals(an(222).length, 1)
  assert(!an(222)[0].includes('Superuser'))
})

Deno.test('Wochenrückblick: echter Superuser-Zusatz aus superuser.ts, ohne Akten-Zahlen doppelt', async () => {
  const d = db(tabellen(RUECKBLICK_AN_ERAY))
  const s = sammler()
  assertEquals((await pruefeWochenrueckblick(d, s.sende, {}, FREITAG)).gesendet, 1)
  const text = s.gesendet[0].text
  assertStringIncludes(text, 'Wochenrückblick')
  assertStringIncludes(text, 'Zusatz für Superuser:')
  assertStringIncludes(text, '- Eray Yesil: ')
  assertStringIncludes(text, 'Offene Wünsche: 0')
  assert(!text.includes('Superuser-Wochenbericht'))
  assert(!text.includes('Anfragen: 0 neue Absender'))
})

Deno.test('Wochenrückblick: Zusatz schlägt fehl → Rückblick geht trotzdem raus', async () => {
  const d = db(tabellen(RUECKBLICK_AN_ERAY))
  const s = sammler()
  assertEquals((await pruefeWochenrueckblick(d, s.sende, { anhang: () => Promise.reject(new Error('kaputt')) }, FREITAG)).gesendet, 1)
  assertEquals(s.gesendet.length, 1)
  assert(!s.gesendet[0].text.includes('Superuser'))
})

Deno.test('Wochenrückblick: zu lang für eine Nachricht → Zusatz als zweite Nachricht', async () => {
  const d = db(tabellen(RUECKBLICK_AN_ERAY))
  const s = sammler()
  const lang = `Zusatz für Superuser:\n${'x'.repeat(3950)}`
  assertEquals((await pruefeWochenrueckblick(d, s.sende, { anhang: () => Promise.resolve(lang) }, FREITAG)).gesendet, 1)
  assertEquals(s.gesendet.length, 2)
  assert(s.gesendet[0].text.startsWith('Wochenrückblick'))
  assert(s.gesendet[1].text.startsWith('Zusatz für Superuser:'))
  assert(s.gesendet[1].text.length <= 3900)
})

Deno.test('mitAnhang: ohne Zusatz unverändert, kurz zusammen, lang getrennt', () => {
  assertEquals(mitAnhang('A', null), ['A'])
  assertEquals(mitAnhang('A', 'B'), ['A\n\n—\n\nB'])
  assertEquals(mitAnhang('A'.repeat(3000), 'B'.repeat(1000)).length, 2)
})

Deno.test('wochenrueckblickTest: Vorschau zeigt Superusern ihren Zusatz', async () => {
  const d = db(tabellen({ ...RUECKBLICK_AN_ERAY, berichtAn: [ERAY, HASAN] }))
  const s = sammler()
  const anhang = () => Promise.resolve('Zusatz für Superuser:\n\nNutzung')
  const eray = await wochenrueckblickTest(d, { email: ERAY, name: 'Eray Yesil', istGf: true }, { senden: true }, s.sende, { jetzt: FREITAG, anhang })
  assertEquals((eray.daten as { superuserZusatz?: string }).superuserZusatz, 'Zusatz für Superuser:\n\nNutzung')
  assertStringIncludes(s.gesendet[0].text, 'Zusatz für Superuser')
  const hasan = await wochenrueckblickTest(d, { email: HASAN, name: 'Hasan Süslü', istGf: true }, {}, s.sende, { jetzt: FREITAG, anhang })
  assertEquals((hasan.daten as { superuserZusatz?: string }).superuserZusatz, undefined)
})
