// Prüft das Werkzeug nachtermin_protokoll (ohne Netz): gegliedertes Protokoll mit den Feldern der Akte,
// „Nächste Schritte“ der Akte, Verlauf, Rechte, private Akten, Sammelakten, doppelte Aufrufe.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { fuehreNachTerminWerkzeugAus, istNachTerminWerkzeug, liste, NACHTERMIN_WERKZEUGE, protokollText, type NachTerminKontext } from './nachTerminWerkzeug.ts'
import { FalscheDatenbank } from '../_shared/testDoppel.ts'

const ANDREAS = { name: 'Andreas Mayer', email: 'andreas@mayer.test', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }
const QUIRIN = { name: 'Quirin Lutzenberger', email: 'quirin@mayer.test', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }
const HASAN = { name: 'Hasan Süslü', email: 'hasan@mayer.test', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['erben'] }

function db() {
  return new FalscheDatenbank({
    kunden: [
      { id: 'k_lehle', bereich: 'erben', firma: 'Josef Lehle', ansprechpartner: 'Josef Lehle', verantwortlich_email: null, naechste_schritte: 'Mandantenfragebogen besprechen', activities: [{ id: 'x', date: '2026-11-20', text: 'Notiz: Telefonat', user: 'Andreas Mayer' }] },
      { id: 'k_privat', bereich: 'privat', firma: 'Max Privat', ansprechpartner: 'Max Privat', verantwortlich_email: 'hasan@mayer.test', naechste_schritte: null, activities: [] },
    ],
    protokolle: [],
  })
}

function kontext(d: FalscheDatenbank, mitarbeiter: NachTerminKontext["mitarbeiter"] = ANDREAS): NachTerminKontext & { log: string[] } {
  const log: string[] = []
  return { supabase: d, mitarbeiter, protokolliere: (t) => log.push(t), heute: '2026-11-27', log }
}

const EINGABE = {
  kunde_id: 'k_lehle',
  betreff: 'Erstgespräch Testament',
  teilnehmer: 'Josef Lehle, Andreas Mayer',
  zusammenfassung: 'Herr Lehle will ein Berliner Testament; Unterlagen fehlen noch.',
  besprochen: ['Altes Testament von 2009', '- Vor- und Nacherbschaft für die Kinder'],
  vereinbart: ['Angebot über 1.200 Euro bis Montag'],
  naechste_schritte: ['Andreas schickt das Angebot bis 30.11.', 'Herr Lehle bringt den Grundbuchauszug'],
  wortlaut: 'Also, der Termin mit Lehle war gut …',
}

Deno.test('Werkzeug ist bekannt und beschrieben', () => {
  assert(istNachTerminWerkzeug('nachtermin_protokoll'))
  assert(!istNachTerminWerkzeug('gespraechsprotokoll_anlegen'))
  assertEquals(NACHTERMIN_WERKZEUGE[0].input_schema.required, ['kunde_id', 'besprochen'])
})

Deno.test('liste: Aufzählungszeichen weg, Leeres weg, auch aus Zeilen', () => {
  assertEquals(liste(['- a', '  ', '2) b', '• c']), ['a', 'b', 'c'])
  assertEquals(liste('eins\n- zwei\n'), ['eins', 'zwei'])
  assertEquals(liste(undefined), [])
})

Deno.test('legt das gegliederte Protokoll an und aktualisiert die Akte', async () => {
  const d = db()
  const k = kontext(d)
  const r = await fuehreNachTerminWerkzeugAus('nachtermin_protokoll', EINGABE, k)
  assertStringIncludes(r, 'Gesprächsprotokoll „Erstgespräch Testament“ vom 27.11.2026 in der Akte von Josef Lehle angelegt')
  assertStringIncludes(r, 'Vorher stand dort: „Mandantenfragebogen besprechen“')
  assertStringIncludes(r, 'wiedervorlage_anlegen')
  const p = d.tabelle('protokolle')[0]
  assertEquals(p.kunde_id, 'k_lehle')
  assertEquals(p.bereich, 'erben')
  assertEquals(p.datum, '2026-11-27')
  assertEquals(p.kernthemen, ['Altes Testament von 2009', 'Vor- und Nacherbschaft für die Kinder'])
  assertEquals(p.vereinbarungen, ['Angebot über 1.200 Euro bis Montag'])
  assertEquals(p.offene_punkte, ['Andreas schickt das Angebot bis 30.11.', 'Herr Lehle bringt den Grundbuchauszug'])
  assertEquals(p.ki_zusammenfassung, EINGABE.zusammenfassung)
  const text = String(p.text)
  for (const teil of ['Teilnehmer: Josef Lehle, Andreas Mayer', 'Besprochen:\n- Altes Testament', 'Vereinbart:\n- Angebot', 'Nächste Schritte:\n- Andreas schickt', 'Rückmeldung im Wortlaut:\nAlso, der Termin']) assertStringIncludes(text, teil)
  const akte = d.tabelle('kunden')[0]
  assertEquals(akte.naechste_schritte, '- Andreas schickt das Angebot bis 30.11.\n- Herr Lehle bringt den Grundbuchauszug')
  assertEquals(akte.letzte_aktivitaet, '2026-11-27')
  const verlauf = akte.activities as { text: string }[]
  assertEquals(verlauf.length, 2)
  assertStringIncludes(verlauf[0].text, 'Gesprächsprotokoll nach Termin angelegt')
  assertEquals(k.log.length, 2)
  // Keine Wiedervorlagen oder To-dos angelegt.
  assertEquals(d.tabelle('wiedervorlagen').length, 0)
  assertEquals(d.tabelle('todos').length, 0)
})

Deno.test('doppelter Aufruf legt nichts noch einmal an', async () => {
  const d = db()
  await fuehreNachTerminWerkzeugAus('nachtermin_protokoll', EINGABE, kontext(d))
  const r = await fuehreNachTerminWerkzeugAus('nachtermin_protokoll', EINGABE, kontext(d))
  assertStringIncludes(r, 'Schon vorhanden')
  assertEquals(d.tabelle('protokolle').length, 1)
})

Deno.test('akte_aktualisieren false und ohne nächste Schritte: Feld der Akte bleibt', async () => {
  const d = db()
  await fuehreNachTerminWerkzeugAus('nachtermin_protokoll', { ...EINGABE, akte_aktualisieren: false }, kontext(d))
  assertEquals(d.tabelle('kunden')[0].naechste_schritte, 'Mandantenfragebogen besprechen')
  const d2 = db()
  const r = await fuehreNachTerminWerkzeugAus('nachtermin_protokoll', { kunde_id: 'k_lehle', besprochen: ['Nur Kennenlernen'] }, kontext(d2))
  assertEquals(d2.tabelle('kunden')[0].naechste_schritte, 'Mandantenfragebogen besprechen')
  assert(!r.includes('wiedervorlage_anlegen'))
  const p = d2.tabelle('protokolle')[0]
  assertEquals(p.betreff, 'Kundentermin am 27.11.2026')
  assertEquals(p.teilnehmer, 'Josef Lehle, Andreas Mayer')
  assertEquals(p.offene_punkte, null)
})

Deno.test('Rechte: fremder Bereich, fremde private Akte, Sammelakte, fehlende Angaben', async () => {
  const d = db()
  assertStringIncludes(await fuehreNachTerminWerkzeugAus('nachtermin_protokoll', EINGABE, kontext(d, QUIRIN)), 'Nicht freigegeben')
  assertStringIncludes(await fuehreNachTerminWerkzeugAus('nachtermin_protokoll', { ...EINGABE, kunde_id: 'k_privat' }, kontext(d, ANDREAS)), 'Fehler: Es gibt keine Akte')
  assertStringIncludes(await fuehreNachTerminWerkzeugAus('nachtermin_protokoll', { ...EINGABE, kunde_id: 'k_intern_holding' }, kontext(d)), 'Fehler: In den Sammelakten')
  assertStringIncludes(await fuehreNachTerminWerkzeugAus('nachtermin_protokoll', { kunde_id: 'k_lehle' }, kontext(d)), 'Fehler: besprochen fehlt')
  assertStringIncludes(await fuehreNachTerminWerkzeugAus('nachtermin_protokoll', { besprochen: ['x'] }, kontext(d)), 'Fehler: kunde_id fehlt')
  assertEquals(d.tabelle('protokolle').length, 0)
})

Deno.test('eigene private Akte: Protokoll ja, Vorschlag nur To-dos', async () => {
  const d = db()
  const r = await fuehreNachTerminWerkzeugAus('nachtermin_protokoll', { ...EINGABE, kunde_id: 'k_privat' }, kontext(d, HASAN))
  assertStringIncludes(r, 'angelegt')
  assertStringIncludes(r, 'todo_anlegen')
  assert(!r.includes('wiedervorlage_anlegen'))
  assertEquals(d.tabelle('protokolle')[0].bereich, 'privat')
})

Deno.test('protokollText ohne Punkte', () => {
  assertStringIncludes(protokollText({ teilnehmer: 'A', besprochen: ['x'], vereinbart: [], naechste: [], wortlaut: '' }), 'Vereinbart:\n- nichts genannt')
})
