// Tests für die Personen-Übersicht (person_ueberblick) — mit Doppeln für Datenbank und Hotmail, ohne Netz.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { fuehrePersonWerkzeugAus, istPersonWerkzeug, PERSON_WERKZEUGE, type HotmailAufruf, TEXT_HOECHSTENS, zerlegeName } from './personUeberblick.ts'

const ICH = 'sueslue@hotmail.com'
const FREMD = 'kollege@mayer-holding.de'

// ---------- Datenbank-Doppel (eq, ilike, is, in, order, range, maybeSingle) ----------

type Zeile = Record<string, unknown>
type Filter = { op: string; spalte: string; wert: unknown }

function likeZuRegex(muster: string): RegExp {
  const teile = [...muster].map((c) => (c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  return new RegExp(`^${teile.join('')}$`, 'i')
}

function passt(z: Zeile, f: Filter): boolean {
  const v = z[f.spalte]
  if (f.op === 'eq') return v !== null && v !== undefined && String(v) === String(f.wert)
  if (f.op === 'ilike') return typeof v === 'string' && likeZuRegex(String(f.wert)).test(v)
  if (f.op === 'is') return f.wert === null ? v === null || v === undefined : v === f.wert
  if (f.op === 'in') return (f.wert as unknown[]).some((w) => String(w) === String(v))
  throw new Error(`Operator ${f.op} fehlt im Doppel`)
}

class FalscheDb {
  abfragen: { tabelle: string; filter: Filter[] }[] = []
  constructor(public tabellen: Record<string, Zeile[]>) {}
  from(tabelle: string) {
    // deno-lint-ignore no-this-alias
    const db = this
    const filter: Filter[] = []
    let von = 0
    let bis = Infinity
    let einzel = false
    const q = {
      select: () => q,
      eq: (spalte: string, wert: unknown) => (filter.push({ op: 'eq', spalte, wert }), q),
      ilike: (spalte: string, wert: unknown) => (filter.push({ op: 'ilike', spalte, wert }), q),
      is: (spalte: string, wert: unknown) => (filter.push({ op: 'is', spalte, wert }), q),
      in: (spalte: string, wert: unknown[]) => (filter.push({ op: 'in', spalte, wert }), q),
      order: () => q,
      range: (a: number, b: number) => ((von = a), (bis = b), q),
      maybeSingle: () => ((einzel = true), q),
      then: (ok: (r: { data: unknown; error: null }) => unknown, nein?: (e: unknown) => unknown) => {
        db.abfragen.push({ tabelle, filter: [...filter] })
        const zeilen = (db.tabellen[tabelle] ?? []).filter((z) => filter.every((f) => passt(z, f))).slice(von, bis + 1)
        return Promise.resolve({ data: einzel ? zeilen[0] ?? null : structuredClone(zeilen), error: null }).then(ok, nein)
      },
    }
    return q
  }
}

// ---------- Hotmail-Doppel ----------

type TestMail = { id: string; von: [string, string]; an?: [string, string][]; cc?: [string, string][]; betreff: string; datum: string; anhang?: boolean; vorschau?: string }
const alsGraph = (m: TestMail) => ({
  id: m.id,
  von: { name: m.von[0], adresse: m.von[1] },
  an: (m.an ?? []).map(([name, adresse]) => ({ name, adresse })),
  cc: (m.cc ?? []).map(([name, adresse]) => ({ name, adresse })),
  betreff: m.betreff,
  datum: m.datum,
  hatAnhaenge: !!m.anhang,
  vorschau: m.vorschau ?? '',
  unterhaltung: `u_${m.id}`,
})

function hotmailDoppel(treffer: Record<string, { mails: TestMail[]; mehr?: boolean }>): { aufruf: HotmailAufruf; begriffe: string[] } {
  const begriffe: string[] = []
  const aufruf: HotmailAufruf = (body) => {
    assertEquals(body.action, 'outlook_suche')
    begriffe.push(String(body.begriff))
    const t = treffer[String(body.begriff).toLowerCase()] ?? { mails: [] }
    return Promise.resolve({ ok: true, status: 200, daten: { mails: t.mails.map(alsGraph), ausgeblendet: 0, mehr: t.mehr === true } })
  }
  return { aufruf, begriffe }
}

const ICH_T: [string, string] = ['Hasan Süslü', ICH]
const THOMAS_A: [string, string] = ['Thomas Bosler', 'thomas@bosler-bau.de']
const THOMAS_B: [string, string] = ['Bosler, T.', 't.bosler@gmx.de']

function grunddaten(): Record<string, Zeile[]> {
  return {
    ms_konten: [{ login_email: ICH, ms_adresse: ICH }],
    kunden: [
      { id: 'k_bosler', firma: null, ansprechpartner: 'Thomas Bosler', email: 'thomas@bosler-bau.de', telefon: '0731 1', activities: [{ id: 'a1', date: '2026-10-01', text: 'Angebot Dach besprochen' }], dokumente: [{}], bereich: 'privat', verantwortlich_email: ICH },
      { id: 'k_anderer', firma: 'Müller GmbH', ansprechpartner: 'Frau Müller', email: 'm@mueller.de', telefon: null, activities: [{ id: 'a2', date: '2026-09-01', text: 'Rückruf Bosler wegen Dach' }, { id: 'a3', date: '2026-09-02', text: 'nichts' }], dokumente: [], bereich: 'privat', verantwortlich_email: ICH },
      // Fremder privater Kontakt mit demselben Namen — darf NIE erscheinen.
      { id: 'k_fremd', firma: null, ansprechpartner: 'Thomas Bosler', email: 'geheim@fremd.de', telefon: '999', activities: [{ id: 'a9', date: '2026-11-01', text: 'GEHEIME NOTIZ Bosler' }], dokumente: [], bereich: 'privat', verantwortlich_email: FREMD },
    ],
    termine: [
      { id: 't1', titel: 'Treffen Bosler', ort: 'Ulm', beschreibung: null, beginn: '2026-11-10T09:00:00Z', ende: '2026-11-10T10:00:00Z', ganztags: false, besitzer_email: ICH, teilnehmer: [], kunde_id: null, kunde_name: null },
      { id: 't_fremd', titel: 'FREMDER TERMIN Bosler', ort: null, beschreibung: null, beginn: '2026-11-11T09:00:00Z', ende: '2026-11-11T10:00:00Z', ganztags: false, besitzer_email: FREMD, teilnehmer: [], kunde_id: null, kunde_name: null },
      { id: 't_kollegen', titel: 'Bosler mit Kollegen', ort: null, beschreibung: null, beginn: '2026-11-12T09:00:00Z', ende: '2026-11-12T10:00:00Z', ganztags: false, besitzer_email: ICH, teilnehmer: [FREMD], kunde_id: null, kunde_name: null },
    ],
    todos: [
      { id: 'td1', aufgabe: 'Bosler zurückrufen', kunde_projekt: null, aktueller_stand: null, erledigt_am: null, erledigen_bis: '2026-11-30', besitzer_email: ICH, bereich: null },
      { id: 'td_fremd', aufgabe: 'FREMDES TODO Bosler', kunde_projekt: null, aktueller_stand: null, erledigt_am: null, erledigen_bis: null, besitzer_email: FREMD, bereich: null },
      { id: 'td_mayer', aufgabe: 'MAYER-TODO Bosler', kunde_projekt: null, aktueller_stand: null, erledigt_am: null, erledigen_bis: null, besitzer_email: ICH, bereich: 'beratung' },
    ],
    protokolle: [
      { id: 'p1', kunde_id: 'k_bosler', bereich: 'privat', besitzer_email: null, datum: '2026-10-05', betreff: 'Erstgespräch', teilnehmer: 'Thomas Bosler', text: 'Dach', ki_zusammenfassung: null },
      { id: 'p_fremd', kunde_id: 'k_fremd', bereich: 'privat', besitzer_email: FREMD, datum: '2026-10-06', betreff: 'FREMDES PROTOKOLL', teilnehmer: 'Thomas Bosler', text: 'Bosler', ki_zusammenfassung: null },
    ],
    gesendete_emails: [
      { id: 'g1', an: 'thomas@bosler-bau.de', an_name: 'Thomas Bosler', betreff: 'Unterlagen aus dem CRM', gesendet_am: '2026-08-01T10:00:00Z', besitzer_email: ICH },
      { id: 'g_fremd', an: 'thomas@bosler-bau.de', an_name: 'Thomas Bosler', betreff: 'FREMD GESENDET', gesendet_am: '2026-08-02T10:00:00Z', besitzer_email: FREMD },
    ],
    eingegangene_emails: [
      { message_id: 'ms_abc:1', von: 'thomas@bosler-bau.de', von_name: 'Thomas Bosler', betreff: 'schon aus Hotmail abgelegt', mail_datum: '2026-07-01T10:00:00Z', anhaenge: [], besitzer_email: ICH },
      { message_id: '<x@imap>', von: 't.bosler@gmx.de', von_name: 'T. Bosler', betreff: 'Über das eigene Postfach', mail_datum: '2026-07-02T10:00:00Z', anhaenge: [{}], besitzer_email: ICH },
      { message_id: '<y@imap>', von: 'thomas@bosler-bau.de', von_name: 'Thomas Bosler', betreff: 'FREMDER EINGANG', mail_datum: '2026-07-03T10:00:00Z', anhaenge: [], besitzer_email: FREMD },
    ],
  }
}

/** Standard-Hotmail: Namenssuche findet zwei Adressen, die Adress-Suchen überschneiden sich. */
function standardHotmail(extra: Record<string, { mails: TestMail[]; mehr?: boolean }> = {}) {
  const m1: TestMail = { id: 'm1', von: THOMAS_A, an: [ICH_T], betreff: 'Angebot Dach', datum: '2026-11-20T08:00:00Z', anhang: true }
  const m2: TestMail = { id: 'm2', von: ICH_T, an: [THOMAS_B], betreff: 'Rückfrage', datum: '2025-03-01T08:00:00Z' }
  const m3: TestMail = { id: 'm3', von: ICH_T, an: [THOMAS_A], betreff: 'Termin', datum: '2024-05-01T08:00:00Z' }
  const m4: TestMail = { id: 'm4', von: THOMAS_B, an: [ICH_T], betreff: 'Privat', datum: '2023-01-01T08:00:00Z' }
  const m5: TestMail = { id: 'm5', von: ['Steuerbüro', 'info@steuer.de'], an: [ICH_T], betreff: 'Notiz zu Herrn Bosler', datum: '2026-01-01T08:00:00Z', vorschau: 'Herr Bosler hat angerufen' }
  return hotmailDoppel({
    bosler: { mails: [m1, m2, m5] },
    'thomas@bosler-bau.de': { mails: [m1, m3] },
    't.bosler@gmx.de': { mails: [m2, m4, m1] },
    ...extra,
  })
}

const ctx = (db: FalscheDb, hotmail: HotmailAufruf, verbunden = true) => ({ supabase: db, mitarbeiter: { email: ICH, name: 'Hasan' }, protokolliere: () => {}, hotmail, outlookVerbunden: verbunden })

// ---------- Tests ----------

Deno.test('Werkzeug ist definiert', () => {
  assertEquals(PERSON_WERKZEUGE.map((w) => w.name), ['person_ueberblick'])
  assert(istPersonWerkzeug('person_ueberblick'))
  assert(!istPersonWerkzeug('outlook_suche'))
})

Deno.test('Name zerlegen: Anrede weg, Adressen erkannt', () => {
  assertEquals(zerlegeName('Herrn Dr. Thomas Bosler'), { adressen: [], suchtext: 'Thomas Bosler', teile: ['thomas', 'bosler'] })
  assertEquals(zerlegeName('T.Bosler@GMX.de').adressen, ['t.bosler@gmx.de'])
  assertEquals(zerlegeName('Herr Süslü').teile, ['sueslue'])
})

Deno.test('Zusammenführen über mehrere Adressen ohne Doppelte, Richtung und Vollständigkeit', async () => {
  const db = new FalscheDb(grunddaten())
  const h = standardHotmail()
  const text = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Herr Bosler' }, ctx(db, h.aufruf))
  // Namenssuche, dann beide Adressen.
  assertEquals(h.begriffe.sort(), ['Bosler', 't.bosler@gmx.de', 'thomas@bosler-bau.de'].sort())
  assertStringIncludes(text, 'thomas@bosler-bau.de')
  assertStringIncludes(text, 't.bosler@gmx.de')
  // Hotmail m1..m4 + CRM gesendet g1 + CRM-Eingang <x@imap> = 6; m5 nur erwähnt; „ms_“-Eingang nicht doppelt.
  assertStringIncludes(text, 'Mails mit ihr/ihm: 6 (gesendet 3, empfangen 3)')
  assertStringIncludes(text, 'erste 01.01.2023, letzte 20.11.2026')
  assertStringIncludes(text, 'Dazu 1 Mails, in denen nur der Name vorkommt')
  for (const id of ['m1', 'm2', 'm3', 'm4']) assertEquals((text.match(new RegExp(`mail_id=${id}(?=\\n|$)`, 'g')) ?? []).length, 1, `${id} genau einmal`)
  assert(!text.includes('schon aus Hotmail abgelegt'))
  assertStringIncludes(text, 'Angebot Dach | Anhang | mail_id=m1')
  assertStringIncludes(text, 'Je Jahr: 2026: 3 · 2025: 1 · 2024: 1 · 2023: 1')
  // CRM-Teile
  assertStringIncludes(text, 'Private Kontaktakte: Thomas Bosler (kontakt_id=k_bosler')
  assertStringIncludes(text, 'Treffen Bosler')
  assertStringIncludes(text, 'Bosler zurückrufen')
  assertStringIncludes(text, 'Angebot Dach besprochen')
  assertStringIncludes(text, 'Rückruf Bosler wegen Dach [Akte Frau Müller (Müller GmbH)]')
  assertStringIncludes(text, 'Erstgespräch')
  assert(text.trimEnd().endsWith('Vollständig: ja.'), text.slice(-300))
})

Deno.test('Richtung gesendet / empfangen', async () => {
  const db = new FalscheDb(grunddaten())
  const gesendet = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Bosler', richtung: 'gesendet', nur: 'mails' }, ctx(db, standardHotmail().aufruf))
  assertStringIncludes(gesendet, 'Gesendete Mails an sie/ihn (3')
  for (const id of ['m2', 'm3']) assertStringIncludes(gesendet, `mail_id=${id}`)
  assertStringIncludes(gesendet, 'id=g1')
  for (const id of ['m1', 'm4', 'm5']) assert(!gesendet.includes(`mail_id=${id}`), id)
  assert(!gesendet.includes('Treffen Bosler'), 'nur=mails ohne Termine')

  const empfangen = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Bosler', richtung: 'empfangen', nur: 'mails' }, ctx(db, standardHotmail().aufruf))
  assertStringIncludes(empfangen, 'Empfangene Mails von ihr/ihm (3')
  for (const id of ['m1', 'm4', '<x@imap>']) assertStringIncludes(empfangen, `mail_id=${id}`)
  for (const id of ['m2', 'm3']) assert(!empfangen.includes(`mail_id=${id}`), id)
})

Deno.test('Mehrdeutiger Name: Liste und Nachfrage, keine Adress-Suchen', async () => {
  const db = new FalscheDb(grunddaten())
  const h = hotmailDoppel({
    bosler: {
      mails: [
        { id: 'x1', von: THOMAS_A, an: [ICH_T], betreff: 'a', datum: '2026-01-01T00:00:00Z' },
        { id: 'x2', von: ['Maria Bosler', 'maria.bosler@web.de'], an: [ICH_T], betreff: 'b', datum: '2026-01-02T00:00:00Z' },
      ],
    },
  })
  const text = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Bosler' }, ctx(db, h.aufruf))
  assertStringIncludes(text, 'Mehrdeutig')
  assertStringIncludes(text, 'Thomas Bosler')
  assertStringIncludes(text, 'maria.bosler@web.de')
  assertStringIncludes(text, 'Vollständig: nein, weil der Name mehrdeutig ist')
  assertEquals(h.begriffe, ['Bosler'])
  assert(!text.includes('geheim@fremd.de'))

  // Mit vollem Namen ist es eindeutig.
  const h2 = hotmailDoppel({ 'thomas bosler': { mails: [{ id: 'x1', von: THOMAS_A, an: [ICH_T], betreff: 'a', datum: '2026-01-01T00:00:00Z' }, { id: 'x2', von: ['Maria Bosler', 'maria.bosler@web.de'], an: [ICH_T], cc: [THOMAS_A], betreff: 'b', datum: '2026-01-02T00:00:00Z' }] } })
  const eindeutig = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Thomas Bosler', nur: 'mails' }, ctx(db, h2.aufruf))
  assert(!eindeutig.includes('Mehrdeutig'), eindeutig)
  assert(!eindeutig.includes('maria.bosler@web.de'))
})

Deno.test('Initiale und gleiche Person über die Kontaktakte gelten nicht als mehrdeutig', async () => {
  const db = new FalscheDb(grunddaten())
  const text = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Bosler', nur: 'mails' }, ctx(db, standardHotmail().aufruf))
  assert(!text.includes('Mehrdeutig'), text)
})

Deno.test('„mehr“ einer Suche wird ausdrücklich gemeldet', async () => {
  const db = new FalscheDb(grunddaten())
  const h = standardHotmail({ 'thomas@bosler-bau.de': { mails: [{ id: 'm1', von: THOMAS_A, an: [ICH_T], betreff: 'Angebot Dach', datum: '2026-11-20T08:00:00Z' }], mehr: true } })
  const text = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Bosler', nur: 'mails' }, ctx(db, h.aufruf))
  assertStringIncludes(text, 'Vollständig: nein, weil die Hotmail-Suche nach „thomas@bosler-bau.de“ hat mehr als 250 Treffer')
})

Deno.test('Große Mengen: Kürzung mit Hinweis, Zählung bleibt vollständig', async () => {
  const db = new FalscheDb(grunddaten())
  const viele: TestMail[] = Array.from({ length: 200 }, (_, i) => ({
    id: `AAMkAGI2THVSAAA${String(i).padStart(4, '0')}${'x'.repeat(130)}`,
    von: i % 2 ? THOMAS_A : ICH_T,
    an: [i % 2 ? ICH_T : THOMAS_A],
    betreff: `Betreff Nummer ${i} mit etwas längerem Text zur Sache Dachsanierung`,
    datum: new Date(Date.UTC(2020 + (i % 6), i % 12, 1 + (i % 27))).toISOString(),
  }))
  const h = hotmailDoppel({ 'thomas bosler': { mails: viele.slice(0, 50) }, 'thomas@bosler-bau.de': { mails: viele } })
  const text = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Thomas Bosler' }, ctx(db, h.aufruf))
  assert(text.length <= TEXT_HOECHSTENS + 500, `zu lang: ${text.length}`)
  assertStringIncludes(text, 'Mails mit ihr/ihm: 201') // 200 + CRM gesendet g1
  const m = text.match(/weitere (\d+) Mails nicht aufgeführt \(([^)]*)\) — nach Jahr \(seit\/bis\) oder Thema eingrenzen/)
  assert(m, text.slice(-800))
  assertStringIncludes(text, `Vollständig: nein, weil ${m![1]} der`)
  assertStringIncludes(text, 'nicht einzeln aufgeführt (gezählt sind alle)')

  // Eingrenzen auf ein Jahr: alles passt hinein.
  const jahr = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Thomas Bosler', seit: '2025-01-01', bis: '2025-12-31', nur: 'mails' }, ctx(db, h.aufruf))
  assert(!jahr.includes('nicht aufgeführt'), jahr.slice(-500))
  assert(jahr.trimEnd().endsWith('Vollständig: ja.'))
})

Deno.test('Besitzer-Schutz: Fremdes erscheint nie, jede Abfrage trägt die Besitzer-Bedingung', async () => {
  const db = new FalscheDb(grunddaten())
  const text = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Thomas Bosler' }, ctx(db, standardHotmail({ 'thomas bosler': { mails: [] } }).aufruf))
  for (const verboten of ['GEHEIME NOTIZ', 'k_fremd', 'geheim@fremd.de', 'FREMDER TERMIN', 'FREMDES TODO', 'MAYER-TODO', 'FREMDES PROTOKOLL', 'FREMD GESENDET', 'FREMDER EINGANG', 'Bosler mit Kollegen', '999']) {
    assert(!text.includes(verboten), `${verboten} darf nicht erscheinen`)
  }
  const besitzerSpalte: Record<string, string[]> = {
    kunden: ['verantwortlich_email'],
    termine: ['besitzer_email'],
    todos: ['besitzer_email'],
    gesendete_emails: ['besitzer_email'],
    eingegangene_emails: ['besitzer_email'],
    ms_konten: ['login_email'],
  }
  for (const a of db.abfragen) {
    if (a.tabelle === 'protokolle') {
      const nachKontakt = a.filter.find((f) => f.op === 'in' && f.spalte === 'kunde_id')
      const nachBesitzer = a.filter.find((f) => f.spalte === 'besitzer_email' && String(f.wert) === ICH)
      assert(nachBesitzer || (nachKontakt && (nachKontakt.wert as string[]).every((id) => ['k_bosler', 'k_anderer'].includes(id))), `protokolle ohne Besitzer-Bedingung: ${JSON.stringify(a.filter)}`)
      continue
    }
    const spalten = besitzerSpalte[a.tabelle]
    assert(spalten, `unerwartete Tabelle ${a.tabelle}`)
    assert(a.filter.some((f) => spalten.includes(f.spalte) && String(f.wert) === ICH), `${a.tabelle} ohne Besitzer-Bedingung: ${JSON.stringify(a.filter)}`)
  }
})

Deno.test('Ohne Microsoft-Konto: CRM-Teile ja, Vollständig nein', async () => {
  const db = new FalscheDb(grunddaten())
  const h = standardHotmail()
  const text = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Thomas Bosler' }, ctx(db, h.aufruf, false))
  assertEquals(h.begriffe, [])
  assertStringIncludes(text, 'Private Kontaktakte: Thomas Bosler')
  assertStringIncludes(text, 'id=g1')
  assertStringIncludes(text, 'Vollständig: nein, weil kein Microsoft-Konto verbunden')
})

Deno.test('E-Mail-Adresse als Name: nur diese Person, keine Namenssuche', async () => {
  const db = new FalscheDb(grunddaten())
  const h = standardHotmail()
  const text = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 't.bosler@gmx.de', nur: 'mails' }, ctx(db, h.aufruf))
  assertEquals(h.begriffe, ['t.bosler@gmx.de'])
  assertStringIncludes(text, 'E-Mail-Adressen: t.bosler@gmx.de')
  // m1 kommt in der Suche vor, aber ohne diese Adresse → nur erwähnt, nicht „mit ihm“.
  assertStringIncludes(text, 'Mails mit ihr/ihm: 3 (gesendet 1, empfangen 2)')
})

Deno.test('Fehler der Hotmail-Suche führt zu „nein“', async () => {
  const db = new FalscheDb(grunddaten())
  const aufruf: HotmailAufruf = () => Promise.resolve({ ok: false, status: 502, daten: { error: 'Microsoft nicht erreichbar' } })
  const text = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Thomas Bosler', nur: 'mails' }, ctx(db, aufruf))
  assertStringIncludes(text, 'Vollständig: nein, weil Hotmail-Suche nach „Thomas Bosler“ fehlgeschlagen (Microsoft nicht erreichbar)')
})

Deno.test('Eingaben prüfen', async () => {
  const db = new FalscheDb(grunddaten())
  const h = standardHotmail()
  assertStringIncludes(await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Herr' }, ctx(db, h.aufruf)), 'Fehler')
  assertStringIncludes(await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Bosler', seit: '1.1.2025' }, ctx(db, h.aufruf)), 'Fehler: seit')
  assertStringIncludes(await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Bosler' }, { ...ctx(db, h.aufruf), mitarbeiter: { email: '' } }), 'Fehler')
})
