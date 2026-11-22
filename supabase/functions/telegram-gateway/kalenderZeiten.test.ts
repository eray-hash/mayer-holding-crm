// Prüft freie_zeiten mit einer nachgebauten Datenbank (ohne Netz): Lücken je Tag, Vorschlag prüfen,
// Kollegen (Sichtbarkeit, Outlook-Termine, gemeinsame Termine), eigener Kalender, Wochenende, Fehler.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { freieAbschnitte, fuehreKalenderZeitenWerkzeugAus, istKalenderZeitenWerkzeug, type KalenderZeitenKontext } from './kalenderZeiten.ts'
import { falscheDatenbank } from '../_shared/testDoppel.ts'

const z = (iso: string) => new Date(iso).toISOString()

function aufbau() {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', name: 'Andreas Mayer', email: 'andreas@x.de', aktiv: true },
      { id: 'm2', name: 'Hasan Yilmaz', email: 'hasan@x.de', aktiv: true },
      { id: 'm3', name: 'Quirin Lang', email: 'quirin@x.de', aktiv: true },
      { id: 'm4', name: 'Alt Weg', email: 'alt@x.de', aktiv: false },
    ],
    kalender_einstellungen: [
      { id: 'e1', email: 'hasan@x.de', sichtbar: true },
      { id: 'e3', email: 'quirin@x.de', sichtbar: false },
    ],
    termine: [
      // Fr 27.11.2026 (Winterzeit: Berlin = UTC+1)
      { id: 't1', titel: 'Telefonat Müller', beginn: z('2026-11-27T08:00:00Z'), ende: z('2026-11-27T09:00:00Z'), ganztags: false, besitzer_email: 'andreas@x.de', teilnehmer: [], ms_id: null, kunde_bereich: 'beratung' },
      { id: 't2', titel: 'Geheim Hasan', beginn: z('2026-11-27T12:00:00Z'), ende: z('2026-11-27T13:30:00Z'), ganztags: false, besitzer_email: 'hasan@x.de', teilnehmer: [], ms_id: null, kunde_bereich: null },
      { id: 't3', titel: 'Outlook Hasan', beginn: z('2026-11-27T14:00:00Z'), ende: z('2026-11-27T15:00:00Z'), ganztags: false, besitzer_email: 'hasan@x.de', teilnehmer: [], ms_id: 'AAMk', kunde_bereich: null },
      { id: 't4', titel: 'Quirin privat', beginn: z('2026-11-27T09:00:00Z'), ende: z('2026-11-27T10:00:00Z'), ganztags: false, besitzer_email: 'quirin@x.de', teilnehmer: [], ms_id: null, kunde_bereich: null },
      { id: 't5', titel: 'Gemeinsam mit Quirin', beginn: z('2026-11-27T15:00:00Z'), ende: z('2026-11-27T16:00:00Z'), ganztags: false, besitzer_email: 'quirin@x.de', teilnehmer: ['andreas@x.de'], ms_id: null, kunde_bereich: null },
      { id: 't6', titel: 'Erinnerung', beginn: z('2026-11-26T23:00:00Z'), ende: z('2026-11-27T23:00:00Z'), ganztags: true, besitzer_email: 'andreas@x.de', teilnehmer: [], ms_id: null, kunde_bereich: null },
    ],
    kalender_fremd: [
      {
        id: 'f1',
        email: 'andreas@x.de',
        stand: new Date().toISOString(),
        fehler: null,
        belegt: [
          { b: z('2026-11-27T10:00:00Z'), e: z('2026-11-27T11:00:00Z') },
          { b: z('2026-11-25T23:00:00Z'), e: z('2026-11-26T23:00:00Z'), g: true },
          { b: z('2026-12-01T23:00:00Z'), e: z('2026-12-02T23:00:00Z'), g: true, a: true },
        ],
      },
      { id: 'f3', email: 'quirin@x.de', stand: new Date().toISOString(), fehler: null, belegt: [{ b: z('2026-11-27T07:00:00Z'), e: z('2026-11-27T17:00:00Z') }] },
    ],
  })
}

function kontext(db: ReturnType<typeof aufbau>, extra: Partial<KalenderZeitenKontext['mitarbeiter']> = {}, jetzt = Date.parse('2026-11-22T10:00:00Z')): KalenderZeitenKontext {
  return { supabase: db, mitarbeiter: { name: 'Andreas Mayer', email: 'Andreas@x.de', ...extra }, protokolliere: () => {}, heute: '2026-11-22', jetzt }
}

Deno.test('Name wird erkannt', () => {
  assert(istKalenderZeitenWerkzeug('freie_zeiten'))
  assert(!istKalenderZeitenWerkzeug('termin_anlegen'))
})

Deno.test('freieAbschnitte: Lücken, Viertelstunde, Mindestdauer', () => {
  const h = (x: number) => Date.UTC(2026, 10, 27, 0, 0) + x * 3600000
  assertEquals(freieAbschnitte(h(8), h(18), [{ von: h(9), bis: h(10.2) }, { von: h(10), bis: h(11) }, { von: h(17.5), bis: h(19) }], 3600000), [
    [h(8), h(9)],
    [h(11), h(17.5)],
  ])
  assertEquals(freieAbschnitte(h(8), h(9), [{ von: h(8.5), bis: h(8.6) }], 3600000), [])
})

Deno.test('Freie Zeiten mit Hasan: eigene, Hasans und Zeiten aus dem eigenen Kalender; Outlook-Termin von Hasan zählt nicht', async () => {
  const db = aufbau()
  const r = await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', { von: '2026-11-27', personen: ['Hasan'] }, kontext(db))
  assertStringIncludes(r, 'für du, Hasan Yilmaz')
  // Belegt: 09–10 (Telefonat), 11–12 (eigener Kalender), 13–14:30 (Hasan), 16–17 (gemeinsam mit Quirin)
  assertStringIncludes(r, 'Fr 27.11.2026: 08:00–09:00, 10:00–11:00, 12:00–13:00, 14:30–16:00, 17:00–18:00')
  // Ganztägige CRM-Einträge sperren nicht, werden aber genannt
  assertStringIncludes(r, 'ganztägig: du – „Erinnerung“')
  assert(!r.includes('Geheim Hasan'))
  assert(!r.includes('Outlook Hasan'))
})

Deno.test('Vorschlag aus einer Mail prüfen: Überschneidung mit eigenem Termin, Kollege nur „belegt“', async () => {
  const db = aufbau()
  const r = await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', { vorschlag: '2026-11-27T09:30', personen: ['Hasan'], dauer_minuten: 240 }, kontext(db))
  assertStringIncludes(r, 'Vorschlag Fr 27.11.2026, 09:30–13:30 Uhr: überschneidet sich mit')
  assertStringIncludes(r, '- du: „Telefonat Müller“, 09:00–10:00 Uhr')
  assertStringIncludes(r, '- du: belegt im eigenen Kalender, 11:00–12:00 Uhr')
  assertStringIncludes(r, '- Hasan Yilmaz: belegt, 13:00–14:30 Uhr')
  const frei = await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', { vorschlag: '2026-11-27T12:00', personen: ['Hasan'] }, kontext(db))
  assertStringIncludes(frei, 'Vorschlag Fr 27.11.2026, 12:00–13:00 Uhr: frei (du, Hasan Yilmaz).')
})

Deno.test('Kollege mit verborgenem Kalender: nur gemeinsame Termine zählen, Hinweis', async () => {
  const db = aufbau()
  const r = await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', { von: '2026-11-27', personen: ['Quirin'], ohne_mich: true }, kontext(db))
  // Quirins eigener Termin (10–11) und sein eigener Kalender (08–18) sind verborgen; der gemeinsame Termin 16–17 zählt
  assertStringIncludes(r, 'Fr 27.11.2026: 08:00–16:00, 17:00–18:00')
  assertStringIncludes(r, 'Quirin Lang zeigt Kollegen den Kalender nicht')
  assert(!r.includes('Quirin privat'))
})

Deno.test('Wochenende ausgelassen; ganztägig abwesend im eigenen Kalender sperrt den Tag', async () => {
  const db = aufbau()
  const r = await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', { von: '2026-11-28', bis: '2026-12-02' }, kontext(db))
  assertStringIncludes(r, 'Mo 30.11.2026: 08:00–18:00')
  assertStringIncludes(r, 'Mi 02.12.2026: nichts frei')
  assertStringIncludes(r, '(2 Tag(e) Wochenende ausgelassen.)')
  assert(!r.includes('Sa 28.11.2026'))
})

Deno.test('Heute: erst ab der nächsten Viertelstunde', async () => {
  const db = aufbau()
  const r = await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', { von: '2026-11-23' }, kontext(db, {}, Date.parse('2026-11-23T10:07:00Z')))
  assertStringIncludes(r, 'Mo 23.11.2026: 11:15–18:00')
})

Deno.test('Fehler und privater Assistent', async () => {
  const db = aufbau()
  assertStringIncludes(await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', { personen: ['Niemand'] }, kontext(db)), 'Fehler: „Niemand“ ist kein eindeutiger Kollege')
  assertStringIncludes(await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', { von: '2026-11-01', bis: '2026-12-31' }, kontext(db)), 'Fehler: Höchstens 31 Tage')
  assertStringIncludes(await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', { vorschlag: 'Freitag' }, kontext(db)), 'Fehler: vorschlag')
  assertStringIncludes(await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', { dauer_minuten: 5 }, kontext(db)), 'Fehler: dauer_minuten')
  assertStringIncludes(await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', { personen: ['Hasan'] }, kontext(db, { nurPrivat: true })), 'private Assistent')
  assertStringIncludes(await fuehreKalenderZeitenWerkzeugAus('freie_zeiten', {}, kontext(db, { email: '' })), 'Fehler: Für diesen Mitarbeiter')
})
