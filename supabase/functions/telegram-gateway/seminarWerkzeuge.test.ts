// Prüft die Seminar-Werkzeuge des Assistenten mit einer nachgebauten Datenbank (ohne Netz): Rechte
// (Zeilenregel darf_bereich('akademie')), Liste, Anlegen mit deutscher Zeit, Teilnehmerliste, Anmelden von Hand.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { berlinZuIso, fuehreSeminarWerkzeugAus, istSeminarWerkzeug, SEMINAR_WERKZEUGE } from './seminarWerkzeuge.ts'

const gf = { name: 'Andreas Mayer', email: 'gf@x.de', rolle: 'geschaeftsfuehrung', bereiche: [] as string[] }
const akademie = { name: 'Hasan Süslü', email: 'h@x.de', rolle: 'mitarbeiter', bereiche: ['akademie'] }
const immo = { name: 'Quirin Lang', email: 'q@x.de', rolle: 'mitarbeiter', bereiche: ['immobilien'] }
const T1 = '11111111-1111-4111-8111-111111111111'

function grunddaten(): Record<string, Zeile[]> {
  return {
    seminare: [
      { id: 'sem_rhetorik', titel: 'Rhetorik', bereich: 'Kommunikation', preis_netto: 490, dozent: null },
      { id: 'sem_rhetorik_2', titel: 'Rhetorik für Fortgeschrittene', bereich: 'Kommunikation', preis_netto: null, dozent: null },
      { id: 'sem_nlp', titel: 'Einführung NLP', bereich: 'Kommunikation', preis_netto: null, dozent: null },
    ],
    seminar_termine: [
      { id: T1, seminar_id: 'sem_rhetorik', beginn: '2026-12-03T08:00:00.000Z', ende: '2026-12-03T16:00:00.000Z', ort: 'Ulm', online_link: null, plaetze: 2, preis: null, referent: 'Hasan Süslü', status: 'geplant', oeffentlich: true },
      { id: '22222222-2222-4222-8222-222222222222', seminar_id: 'sem_nlp', beginn: '2026-10-01T08:00:00.000Z', ende: null, ort: null, online_link: null, plaetze: null, preis: null, referent: null, status: 'durchgefuehrt', oeffentlich: false },
    ],
    seminar_anmeldungen: [
      { id: 'a1', termin_id: T1, name: 'Erika Muster', email: 'erika@muster.de', status: 'angemeldet', quelle: 'formular', kunde_id: null, erstellt_am: '2026-11-20T10:00:00Z' },
      { id: 'a2', termin_id: T1, name: 'Max Storno', email: 'max@x.de', status: 'storniert', quelle: 'hand', kunde_id: null, erstellt_am: '2026-11-20T11:00:00Z' },
    ],
    kunden: [
      { id: 'k_ak', bereich: 'akademie', firma: 'Bernd Beispiel', ansprechpartner: 'Bernd Beispiel', email: 'bernd@b.de', telefon: '0731 9', seminare: [{ id: 'sem_rhetorik', titel: 'Rhetorik', stand: 'interessiert' }], activities: [] },
      { id: 'k_be', bereich: 'beratung', firma: 'Firma X', ansprechpartner: 'Xaver', email: 'x@firma.de', activities: [] },
    ],
  }
}

function umgebung(mitarbeiter: Zeile = gf, tabellen = grunddaten()) {
  const db = falscheDatenbank(tabellen)
  const protokoll: string[] = []
  // deno-lint-ignore no-explicit-any
  const ctx = { supabase: db, mitarbeiter: mitarbeiter as any, protokolliere: (s: string) => protokoll.push(s), heute: '2026-11-22' }
  return { db, ctx, protokoll }
}

Deno.test('Werkzeugliste vollständig', () => {
  assertEquals(SEMINAR_WERKZEUGE.map((w) => w.name), ['seminartermine_zeigen', 'seminartermin_anlegen', 'teilnehmer_zeigen', 'teilnehmer_anmelden'])
  assert(istSeminarWerkzeug('teilnehmer_anmelden'))
  assert(!istSeminarWerkzeug('kunden_suchen'))
})

Deno.test('Rechte: ohne Akademie keine Antwort und kein Datenbankzugriff; privater Assistent nie', async () => {
  for (const name of SEMINAR_WERKZEUGE.map((w) => w.name)) {
    const u = umgebung(immo)
    const r = await fuehreSeminarWerkzeugAus(name, { termin_id: T1, seminar: 'Rhetorik', beginn: '2026-12-10T09:00' }, u.ctx)
    assert(r.startsWith('Nicht freigegeben'), r)
    assert(!r.includes('Erika'))
    assertEquals(u.db.protokoll.length, 0)
    const p = umgebung({ ...gf, nurPrivat: true })
    assertStringIncludes(await fuehreSeminarWerkzeugAus(name, {}, p.ctx), 'privaten Assistenten')
  }
})

Deno.test('Deutsche Zeit in UTC (Winter, Sommer, ungültig)', () => {
  assertEquals(berlinZuIso('2026-12-03T09:00'), '2026-12-03T08:00:00.000Z')
  assertEquals(berlinZuIso('2026-07-01 09:30'), '2026-07-01T07:30:00.000Z')
  assertEquals(berlinZuIso('2026-03-29T12:00'), '2026-03-29T10:00:00.000Z')
  assertEquals(berlinZuIso('2026-12-24', '23:59'), '2026-12-24T22:59:00.000Z')
  assertEquals(berlinZuIso('2026-02-30T09:00'), undefined)
  assertEquals(berlinZuIso('2026-12-03'), undefined)
  assertEquals(berlinZuIso('morgen'), undefined)
})

Deno.test('Termine zeigen: kommende mit Belegung, Suche, vergangene nur auf Wunsch', async () => {
  const u = umgebung(akademie)
  const r = await fuehreSeminarWerkzeugAus('seminartermine_zeigen', {}, u.ctx)
  assertStringIncludes(r, 'Kommende Seminartermine: 1.')
  assertStringIncludes(r, '„Rhetorik“')
  assertStringIncludes(r, '1 von 2 Plätzen belegt, 1 frei')
  assertStringIncludes(r, 'Do., 03.12.2026, 09:00 Uhr bis 17:00 Uhr')
  assertStringIncludes(r, `termin_id=${T1}`)
  assertStringIncludes(r, '490,00 € netto')
  assert(!r.includes('NLP'))
  const alle = await fuehreSeminarWerkzeugAus('seminartermine_zeigen', { vergangene: true, seminar: 'nlp' }, u.ctx)
  assertStringIncludes(alle, 'Einführung NLP')
  assertStringIncludes(alle, 'durchgeführt')
})

Deno.test('Termin anlegen: Auswahl bei mehreren Treffern, dann mit seminar_id; Vorgaben', async () => {
  const u = umgebung(akademie)
  const mehrere = await fuehreSeminarWerkzeugAus('seminartermin_anlegen', { seminar: 'rhetorik f', beginn: '2026-12-10T09:00' }, u.ctx)
  assertStringIncludes(mehrere, 'Angelegt') // eindeutig: „Rhetorik für Fortgeschrittene“
  const zweideutig = await fuehreSeminarWerkzeugAus('seminartermin_anlegen', { seminar: 'Rhetor', beginn: '2026-12-10T09:00' }, u.ctx)
  assertStringIncludes(zweideutig, 'Mehrere Seminare passen')
  const genau = await fuehreSeminarWerkzeugAus('seminartermin_anlegen', { seminar: 'Rhetorik', beginn: '2026-12-10T09:00', ende: '2026-12-10T17:00', plaetze: 12, ort: 'Ulm', anmeldeschluss: '2026-12-01' }, u.ctx)
  assertStringIncludes(genau, 'Angelegt: „Rhetorik“')
  assertStringIncludes(genau, 'Katalogpreis 490,00 € netto')
  assertStringIncludes(genau, 'Anmeldung über das Internet: aus')
  const t = u.db.tabellen.seminar_termine.at(-1)!
  assertEquals(t.seminar_id, 'sem_rhetorik')
  assertEquals(t.beginn, '2026-12-10T08:00:00.000Z')
  assertEquals(t.anmeldeschluss, '2026-12-01T22:59:00.000Z')
  assertEquals(t.oeffentlich, false)
  assertEquals(t.verantwortlich, 'Hasan Süslü')
  assertEquals(t.plaetze, 12)
  assertEquals(u.protokoll.length, 2)
  assertStringIncludes(await fuehreSeminarWerkzeugAus('seminartermin_anlegen', { seminar: 'Rhetorik', beginn: '10.12.' }, u.ctx), 'kein gültiger Zeitpunkt')
  assertStringIncludes(await fuehreSeminarWerkzeugAus('seminartermin_anlegen', { seminar: 'Kochen', beginn: '2026-12-10T09:00' }, u.ctx), 'kein Seminar')
  assertStringIncludes(await fuehreSeminarWerkzeugAus('seminartermin_anlegen', { seminar_id: 'sem_nlp', beginn: '2026-12-10T09:00', ende: '2026-12-10T08:00' }, u.ctx), 'vor dem Beginn')
})

Deno.test('Teilnehmer zeigen', async () => {
  const u = umgebung(akademie)
  const r = await fuehreSeminarWerkzeugAus('teilnehmer_zeigen', { termin_id: T1 }, u.ctx)
  assertStringIncludes(r, '1 von 2 Plätzen belegt')
  assertStringIncludes(r, 'Erika Muster | angemeldet')
  assertStringIncludes(r, 'Max Storno | storniert')
  assertStringIncludes(await fuehreSeminarWerkzeugAus('teilnehmer_zeigen', { termin_id: 'x' }, u.ctx), 'ungültig')
})

Deno.test('Teilnehmer anmelden: aus Akademie-Akte, frei, doppelt, voll → Warteliste, fremde Akte', async () => {
  const u = umgebung(akademie)
  const ausAkte = await fuehreSeminarWerkzeugAus('teilnehmer_anmelden', { termin_id: T1, kunde_id: 'k_ak' }, u.ctx)
  assertStringIncludes(ausAkte, 'Eingetragen: Bernd Beispiel')
  assertStringIncludes(ausAkte, 'angemeldet')
  const a = u.db.tabellen.seminar_anmeldungen.at(-1)!
  assertEquals(a.kunde_id, 'k_ak')
  assertEquals(a.email, 'bernd@b.de')
  assertEquals(a.quelle, 'hand')
  assertEquals(a.firma, null)
  const k = u.db.tabellen.kunden.find((x) => x.id === 'k_ak')!
  assertEquals(k.seminare, [{ id: 'sem_rhetorik', titel: 'Rhetorik', stand: 'angemeldet' }])
  assertEquals((k.activities as unknown[]).length, 1)

  assertStringIncludes(await fuehreSeminarWerkzeugAus('teilnehmer_anmelden', { termin_id: T1, kunde_id: 'k_ak' }, u.ctx), 'schon eingetragen')
  assertStringIncludes(await fuehreSeminarWerkzeugAus('teilnehmer_anmelden', { termin_id: T1, name: 'E. M.', email: 'ERIKA@muster.de' }, u.ctx), 'schon eingetragen')

  const voll = await fuehreSeminarWerkzeugAus('teilnehmer_anmelden', { termin_id: T1, name: 'Clara Neu', email: 'clara@neu.de' }, u.ctx)
  assertStringIncludes(voll, 'Warteliste')
  assertEquals(u.db.tabellen.seminar_anmeldungen.at(-1)!.status, 'warteliste')

  const ueberbucht = await fuehreSeminarWerkzeugAus('teilnehmer_anmelden', { termin_id: T1, name: 'Dora Extra', status: 'bestaetigt' }, u.ctx)
  assertStringIncludes(ueberbucht, 'überbucht')
  assertStringIncludes(ueberbucht, 'Ohne E-Mail-Adresse')

  assertStringIncludes(await fuehreSeminarWerkzeugAus('teilnehmer_anmelden', { termin_id: T1, kunde_id: 'k_be' }, u.ctx), 'nicht zur Akademie')
  assertStringIncludes(await fuehreSeminarWerkzeugAus('teilnehmer_anmelden', { termin_id: T1 }, u.ctx), 'name fehlt')
  assertStringIncludes(await fuehreSeminarWerkzeugAus('teilnehmer_anmelden', { termin_id: T1, name: 'Eva', email: 'kaputt' }, u.ctx), 'ungültig')
  assertStringIncludes(await fuehreSeminarWerkzeugAus('teilnehmer_anmelden', { termin_id: '22222222-2222-4222-8222-222222222222', name: 'Eva' }, u.ctx), 'durchgeführt')
})
