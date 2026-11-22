// Prüft die öffentliche Seminar-Anmeldung und die Anlass-Prüfung der Akademie-Nachrichten mit einer
// nachgebauten Datenbank (ohne Netz, ohne Telegram).
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { BEDINGUNGEN_VORLAGE, DATENSCHUTZ_TEXT, seminarAnmelden, seminareMit, seminarTerminLaden } from './seminarAnmeldung.ts'
import { istSeminarRegel, pruefeSeminarAnlass } from './seminarNachrichten.ts'

const TOKEN = '3f2b8c1e-4d5a-4b6c-9d7e-112233445566'
const JETZT = new Date('2026-11-22T10:00:00Z')
const META = { ip: '1.2.3.4', geraet: 'Testgerät' }

function termin(z: Partial<Zeile> = {}): Zeile {
  return {
    id: 't1', seminar_id: 'sem_rhetorik', anmelde_token: TOKEN, beginn: '2026-12-03T08:00:00Z', ende: '2026-12-03T16:00:00Z', ort: 'Schwabstraße 3, Ulm',
    online_link: 'https://treffen.test/geheim', plaetze: 2, preis: null, referent: 'Hasan Süslü', verantwortlich: 'Hasan Süslü', status: 'geplant',
    anmeldeschluss: null, oeffentlich: true, ...z,
  }
}

function stand(t: Partial<Zeile> = {}, weitere: Partial<Record<string, Zeile[]>> = {}) {
  return {
    seminar_termine: [termin(t)],
    seminare: [{ id: 'sem_rhetorik', titel: 'Rhetorik', beschreibung: 'Frei sprechen', dauer: '1 Tag', bereich: 'Kommunikation', preis_netto: 490, dozent: null }],
    seminar_anmeldungen: [] as Zeile[],
    kunden: [] as Zeile[],
    vorlagen: [{ id: BEDINGUNGEN_VORLAGE, text: '# Teilnahmebedingungen\nAbmeldung bis 14 Tage vorher kostenfrei.' }],
    ...weitere,
  }
}

const eingabe = (z: Record<string, unknown> = {}) => ({ name: 'Erika Muster', firma: 'Muster GmbH', email: 'Erika@Muster.de', telefon: '0731 123', teilnahmebedingungen: true, datenschutz: true, ...z })

Deno.test('Seite laden: Eckdaten, freie Plätze, Texte — ohne Online-Zugang', async () => {
  const db = falscheDatenbank(stand({}, { seminar_anmeldungen: [{ id: 'a0', termin_id: 't1', status: 'bestaetigt', email: 'x@y.de' }, { id: 'a00', termin_id: 't1', status: 'storniert', email: 'z@y.de' }] }))
  const s = await seminarTerminLaden(db, TOKEN, JETZT.getTime())
  assert(s.stufe === 'offen')
  assertEquals(s.seminar.titel, 'Rhetorik')
  assertEquals(s.freiePlaetze, 1)
  assertEquals(s.termin.preis, 490)
  assertEquals(s.termin.online, true)
  assertStringIncludes(s.texte.teilnahmebedingungen, 'Abmeldung')
  assertEquals(s.texte.datenschutz, DATENSCHUTZ_TEXT)
  assert(!JSON.stringify(s).includes('geheim'), 'Online-Link darf nicht öffentlich sein')
  assert(!JSON.stringify(s).includes('x@y.de'), 'Teilnehmer dürfen nicht öffentlich sein')
})

Deno.test('Seite laden: ungültig, nicht öffentlich, abgesagt, vorbei, Anmeldeschluss', async () => {
  const fall = async (t: Partial<Zeile>, token = TOKEN) => await seminarTerminLaden(falscheDatenbank(stand(t)), token, JETZT.getTime())
  assertEquals((await fall({}, 'abc')).stufe, 'ungueltig')
  assertEquals((await fall({}, '3f2b8c1e-4d5a-4b6c-9d7e-000000000000')).stufe, 'ungueltig')
  const nichtOeffentlich = await fall({ oeffentlich: false })
  assert(nichtOeffentlich.stufe === 'ungueltig' && nichtOeffentlich.grund.includes('nicht freigeschaltet'))
  const abgesagt = await fall({ status: 'abgesagt' })
  assert(abgesagt.stufe === 'ungueltig' && abgesagt.grund.includes('abgesagt'))
  const vorbei = await fall({ beginn: '2026-11-01T08:00:00Z' })
  assert(vorbei.stufe === 'ungueltig' && vorbei.grund.includes('stattgefunden'))
  const schluss = await fall({ anmeldeschluss: '2026-11-20T00:00:00Z' })
  assert(schluss.stufe === 'ungueltig' && schluss.grund.includes('Anmeldefrist'))
})

Deno.test('Anmelden: neue Akademie-Akte, Zustimmung mit Wortlaut, Telegram an den Zuständigen', async () => {
  const db = falscheDatenbank(stand())
  const meldungen: [string, string][] = []
  const r = await seminarAnmelden(db, TOKEN, eingabe(), META, async (wer, text) => void meldungen.push([wer, text]), JETZT)
  assertEquals(r.stufe, 'angemeldet')
  const a = db.tabellen.seminar_anmeldungen[0]
  assertEquals(a.status, 'angemeldet')
  assertEquals(a.quelle, 'formular')
  assertEquals(a.email, 'erika@muster.de')
  // deno-lint-ignore no-explicit-any
  const z = a.zustimmung as any
  assertEquals(z.datenschutz, true)
  assertEquals(z.teilnahmebedingungen, true)
  assertStringIncludes(z.texte.teilnahmebedingungen, 'Abmeldung')
  assertEquals(z.am, JETZT.toISOString())
  const k = db.tabellen.kunden[0]
  assertEquals(a.kunde_id, k.id)
  assertEquals(k.bereich, 'akademie')
  assertEquals(k.status, 'anmeldung_eingegangen')
  assertEquals(k.firma, 'Muster GmbH')
  assertEquals(k.ansprechpartner, 'Erika Muster')
  assertEquals(k.verantwortlich, 'Hasan Süslü')
  // deno-lint-ignore no-explicit-any
  const verlauf = k.activities as any[]
  assertEquals(verlauf.length, 2)
  assert(verlauf.some((v) => /automatisch angelegt/i.test(v.text)), 'ohne „automatisch angelegt“ käme eine Willkommensnachricht')
  assertStringIncludes(verlauf[0].text, 'Platz vergeben')
  assertEquals(k.seminare, [{ id: 'sem_rhetorik', titel: 'Rhetorik', stand: 'angemeldet' }])
  assertEquals(meldungen.length, 1)
  assertEquals(meldungen[0][0], 'Hasan Süslü')
  assertStringIncludes(meldungen[0][1], 'noch 1 Plätze frei')
  assertStringIncludes(meldungen[0][1], 'neu angelegt')
})

Deno.test('Anmelden: bestehende Akte per E-Mail, Interessent wird zu „Anmeldung eingegangen“, Telefon ergänzt', async () => {
  const db = falscheDatenbank(stand({}, {
    kunden: [{ id: 'k1', bereich: 'akademie', email: 'erika@muster.de', status: 'interessent', telefon: '', activities: [{ id: 'x', text: 'alt' }], seminare: [{ id: 'sem_rhetorik', titel: 'Rhetorik', stand: 'interessiert' }] },
      { id: 'k2', bereich: 'beratung', email: 'erika@muster.de', status: 'lead' }],
  }))
  const r = await seminarAnmelden(db, TOKEN, eingabe(), META, undefined, JETZT)
  assertEquals(r.stufe, 'angemeldet')
  assertEquals(db.tabellen.kunden.length, 2)
  const k = db.tabellen.kunden.find((x) => x.id === 'k1')!
  assertEquals(db.tabellen.seminar_anmeldungen[0].kunde_id, 'k1')
  assertEquals(k.status, 'anmeldung_eingegangen')
  assertEquals(k.telefon, '0731 123')
  assertEquals(k.seminare, [{ id: 'sem_rhetorik', titel: 'Rhetorik', stand: 'angemeldet' }])
  assertEquals((k.activities as unknown[]).length, 2)
  assertEquals(db.tabellen.kunden.find((x) => x.id === 'k2')!.status, 'lead')
})

Deno.test('Anmelden: voll → Warteliste; doppelt → nichts Neues', async () => {
  const db = falscheDatenbank(stand({ plaetze: 1 }, { seminar_anmeldungen: [{ id: 'a0', termin_id: 't1', status: 'angemeldet', email: 'x@y.de' }] }))
  const meldungen: string[] = []
  const r = await seminarAnmelden(db, TOKEN, eingabe(), META, async (_w, t) => void meldungen.push(t), JETZT)
  assertEquals(r.stufe, 'warteliste')
  assertEquals(db.tabellen.seminar_anmeldungen.length, 2)
  assertEquals(db.tabellen.seminar_anmeldungen[1].status, 'warteliste')
  assertStringIncludes(meldungen[0], 'Warteliste')
  const k = db.tabellen.kunden[0]
  assertEquals(k.seminare, [{ id: 'sem_rhetorik', titel: 'Rhetorik', stand: 'interessiert' }])
  const noch = await seminarAnmelden(db, TOKEN, eingabe({ email: 'erika@muster.de ' }), META, undefined, JETZT)
  assert(noch.stufe === 'warteliste' && noch.schonAngemeldet === true)
  assertEquals(db.tabellen.seminar_anmeldungen.length, 2)
})

Deno.test('Anmelden: Prüfungen und unsichtbares Feld', async () => {
  const fall = async (z: Record<string, unknown>) => {
    const db = falscheDatenbank(stand())
    return { r: await seminarAnmelden(db, TOKEN, eingabe(z), META, undefined, JETZT), db }
  }
  assertEquals((await fall({ name: 'Al' })).r.stufe, 'fehler')
  assertEquals((await fall({ email: 'keine-adresse' })).r.stufe, 'fehler')
  assertEquals((await fall({ teilnahmebedingungen: false })).r.stufe, 'fehler')
  assertEquals((await fall({ datenschutz: 'ja' })).r.stufe, 'fehler')
  const roboter = await fall({ webseite: 'http://spam.test' })
  assertEquals(roboter.r.stufe, 'angemeldet')
  assertEquals(roboter.db.tabellen.seminar_anmeldungen.length, 0)
  assertEquals(roboter.db.tabellen.kunden.length, 0)
  // Ohne Teilnahmebedingungen-Text genügt der Datenschutz.
  const db = falscheDatenbank(stand({}, { vorlagen: [] }))
  const r = await seminarAnmelden(db, TOKEN, eingabe({ teilnahmebedingungen: false }), META, undefined, JETZT)
  assertEquals(r.stufe, 'angemeldet')
  // deno-lint-ignore no-explicit-any
  assertEquals((db.tabellen.seminar_anmeldungen[0].zustimmung as any).teilnahmebedingungen, null)
  assertEquals((await seminarAnmelden(falscheDatenbank(stand({ oeffentlich: false })), TOKEN, eingabe(), META, undefined, JETZT)).stufe, 'ungueltig')
})

Deno.test('Seminare der Akte zusammenführen', () => {
  assertEquals(seminareMit(null, { id: 's', titel: 'S' }), [{ id: 's', titel: 'S', stand: 'angemeldet' }])
  assertEquals(seminareMit([{ id: 's', titel: 'S', stand: 'teilgenommen' }], { id: 's', titel: 'S' }), [{ id: 's', titel: 'S', stand: 'teilgenommen' }])
  assertEquals(seminareMit([{ id: 's', titel: 'S', stand: 'angemeldet' }], { id: 's', titel: 'S' }, 'teilgenommen'), [{ id: 's', titel: 'S', stand: 'teilgenommen' }])
})

Deno.test('Anlass der Akademie-Nachrichten', async () => {
  const db = falscheDatenbank({
    seminar_termine: [termin(), termin({ id: 't2', status: 'abgesagt' })],
    seminar_anmeldungen: [
      { id: 'a1', termin_id: 't1', status: 'angemeldet' },
      { id: 'a2', termin_id: 't1', status: 'storniert' },
      { id: 'a3', termin_id: 't1', status: 'warteliste' },
      { id: 'a4', termin_id: 't2', status: 'bestaetigt' },
    ],
  })
  const j = JETZT.getTime()
  assert(istSeminarRegel('akademie_seminar_absage'))
  assert(!istSeminarRegel('immo_besichtigung_absage'))
  assertEquals(await pruefeSeminarAnlass(db, { regel: 'akademie_seminar_bestaetigung', anmeldung_id: 'a1' }, j), null)
  assertEquals(await pruefeSeminarAnlass(db, { regel: 'akademie_seminar_erinnerung', anmeldung_id: 'a2' }, j), 'Anmeldung steht jetzt auf „storniert“')
  assertEquals(await pruefeSeminarAnlass(db, { regel: 'akademie_seminar_warteliste', anmeldung_id: 'a3' }, j), null)
  assertEquals(await pruefeSeminarAnlass(db, { regel: 'akademie_seminar_warteliste', anmeldung_id: 'a1' }, j), 'Anmeldung steht jetzt auf „angemeldet“')
  assertEquals(await pruefeSeminarAnlass(db, { regel: 'akademie_seminar_absage', anmeldung_id: 'a4' }, j), null)
  assertEquals(await pruefeSeminarAnlass(db, { regel: 'akademie_seminar_bestaetigung', anmeldung_id: 'a4' }, j), 'Termin steht jetzt auf „abgesagt“')
  assertEquals(await pruefeSeminarAnlass(db, { regel: 'akademie_seminar_bestaetigung', anmeldung_id: 'a1' }, new Date('2026-12-04T00:00:00Z').getTime()), 'Termin ist schon vorbei')
  assertEquals(await pruefeSeminarAnlass(db, { regel: 'akademie_seminar_bestaetigung', anmeldung_id: null }, j), 'Anmeldung gibt es nicht mehr')
})
