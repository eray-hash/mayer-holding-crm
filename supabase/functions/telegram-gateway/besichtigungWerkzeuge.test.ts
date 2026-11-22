// Prüft die Besichtigungs-Werkzeuge mit einer nachgebauten Datenbank (ohne Netz): Rechte (Zeilenregeln
// besichtigungen + objekte), Spalten beim Anlegen wie zuZeile() im CRM, Ändern nur der geänderten
// Spalten, Verlauf im Objekt und im Kontakt, Hinweise zum Kalender, deutsche Ortszeit.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { berlinZuZeitpunkt, besichtigungVerlaufText, darfBesichtigungen, fuehreBesichtigungWerkzeugAus } from './besichtigungWerkzeuge.ts'

const gf = { name: 'Andreas Mayer', email: 'gf@x.de', rolle: 'geschaeftsfuehrung', bereiche: [] as string[] }
const quirin = { name: 'Quirin Lang', email: 'q@x.de', rolle: 'mitarbeiter', bereiche: ['immobilien'] }
const berater = { name: 'Bernd Berater', email: 'b@x.de', rolle: 'mitarbeiter', bereiche: ['beratung'] }
const hasan = { name: 'Hasan Yilmaz', email: 'h@x.de', rolle: 'mitarbeiter', bereiche: ['beratung'] }

const JETZT = new Date('2026-11-22T09:00:00Z')

function besichtigung(z: Partial<Zeile> = {}): Zeile {
  return {
    id: 'bes_1', objekt_id: 'o_1', kunde_id: null, kunde_bereich: null, interessent: 'Familie Müller', telefon: '0731 2', email: 'mueller@x.de',
    beginn: '2026-11-25T13:00:00.000Z', dauer_min: 30, durchgefuehrt_von: 'Quirin Lang', status: 'geplant', interesse: null, rueckmeldung: '',
    angebot: null, naechster_schritt: '', kalender_termin_id: null, erstellt_von: 'Quirin Lang', erstellt_am: '2026-11-21T10:00:00Z', geaendert_am: '2026-11-21T10:00:00Z',
    ...z,
  }
}

const grunddaten = () => ({
  objekte: [
    { id: 'o_1', bezeichnung: 'MFH Ulm Weststadt', adresse: 'Söflinger Str. 1, Ulm', privat_besitzer: null, activities: [{ id: 'act_alt', date: '2026-11-01', text: 'alt', user: 'x' }] },
    { id: 'o_2', bezeichnung: 'ETW Neu-Ulm', adresse: 'Hauptstr. 5', privat_besitzer: null, activities: [] },
    { id: 'o_priv', bezeichnung: 'Hasans Ferienhaus', adresse: 'Am See 1', privat_besitzer: 'H@x.de', activities: [] },
  ],
  besichtigungen: [
    besichtigung(),
    besichtigung({ id: 'bes_2', objekt_id: 'o_2', interessent: 'Herr Schmidt', beginn: '2026-11-23T10:00:00.000Z' }),
    besichtigung({ id: 'bes_alt', status: 'durchgefuehrt', beginn: '2026-11-10T10:00:00.000Z', interesse: 'hoch', angebot: 450000, rueckmeldung: 'Gefällt sehr' }),
    besichtigung({ id: 'bes_fern', beginn: '2027-02-01T10:00:00.000Z', interessent: 'Später' }),
    besichtigung({ id: 'bes_priv', objekt_id: 'o_priv', interessent: 'Nachbar', beginn: '2026-11-24T10:00:00.000Z' }),
  ],
  kunden: [
    { id: 'k_immo', bereich: 'immobilienkunden', firma: 'Familie Weber', ansprechpartner: 'Jana Weber', email: 'weber@x.de', telefon: '0731 9', verantwortlich_email: null, activities: [] },
    { id: 'k_ber', bereich: 'beratung', firma: 'Bäckerei Brot', ansprechpartner: null, email: 'b@brot.de', telefon: null, verantwortlich_email: null, activities: [] },
  ],
  termine: [
    { id: '11111111-1111-1111-1111-111111111111', besitzer_email: 'q@x.de' },
    { id: '22222222-2222-2222-2222-222222222222', besitzer_email: 'gf@x.de' },
  ],
})

function umgebung(tabellen: Record<string, Zeile[]>, mitarbeiter: Zeile = quirin) {
  const db = falscheDatenbank(tabellen)
  const geschrieben: { tabelle: string; art: 'insert' | 'update'; werte: Zeile }[] = []
  const supabase = {
    from(t: string) {
      const q = db.from(t)
      const ins = q.insert.bind(q)
      const upd = q.update.bind(q)
      q.insert = (w: Zeile | Zeile[]) => (geschrieben.push({ tabelle: t, art: 'insert', werte: structuredClone(w as Zeile) }), ins(w))
      q.update = (w: Zeile) => (geschrieben.push({ tabelle: t, art: 'update', werte: structuredClone(w) }), upd(w))
      return q
    },
  }
  const protokoll: string[] = []
  // deno-lint-ignore no-explicit-any
  const ctx = { supabase, mitarbeiter: mitarbeiter as any, protokolliere: (s: string) => protokoll.push(s), heute: '2026-11-22', jetzt: () => JETZT }
  return { db, geschrieben, protokoll, ctx }
}

// ---------------------------------------------------------------------------------------------
// Rechte

Deno.test('Rechte: Immobilien-Freigabe nötig; privates Objekt nur Besitzer und auch der nur mit Immobilien-Freigabe', () => {
  assertEquals(darfBesichtigungen(quirin, { privat_besitzer: null }), true)
  assertEquals(darfBesichtigungen(berater, { privat_besitzer: null }), false)
  assertEquals(darfBesichtigungen(gf, { privat_besitzer: 'h@x.de' }), false)
  assertEquals(darfBesichtigungen(hasan, { privat_besitzer: 'h@x.de' }), false, 'Zeilenregel besichtigungen verlangt darf_bereich(immobilien)')
  assertEquals(darfBesichtigungen({ ...hasan, bereiche: ['immobilien'] }, { privat_besitzer: 'h@x.de' }), true)
  assertEquals(darfBesichtigungen({ ...gf, nurPrivat: true }, { privat_besitzer: null }), false)
})

Deno.test('Rechte: ohne Immobilien „nicht freigegeben“, fremdes privates Objekt „gibt es nicht“, nichts geschrieben', async () => {
  const u = umgebung(grunddaten(), berater)
  for (const [name, input] of [
    ['besichtigungen_zeigen', {}],
    ['besichtigungen_zeigen', { objekt_id: 'o_1' }],
    ['besichtigung_anlegen', { objekt_id: 'o_1', beginn: '2026-11-28T14:30', interessent: 'X' }],
    ['besichtigung_aendern', { id: 'bes_1', status: 'abgesagt' }],
  ] as const) {
    const r = await fuehreBesichtigungWerkzeugAus(name, input, u.ctx)
    assert(r.startsWith('Nicht freigegeben'), `${name}: ${r}`)
    assertStringIncludes(r, 'Immobilien')
  }
  const g = umgebung(grunddaten(), gf)
  assertStringIncludes(await fuehreBesichtigungWerkzeugAus('besichtigungen_zeigen', { objekt_id: 'o_priv' }, g.ctx), 'Fehler: Dieses Objekt gibt es nicht')
  const r = await fuehreBesichtigungWerkzeugAus('besichtigung_aendern', { id: 'bes_priv', status: 'abgesagt' }, g.ctx)
  assertEquals(r, 'Fehler: Diese Besichtigung gibt es nicht.')
  assertEquals([...u.geschrieben, ...g.geschrieben].length, 0)
})

// ---------------------------------------------------------------------------------------------
// Zeigen

Deno.test('besichtigungen_zeigen ohne Objekt: nur geplante im Zeitraum, nur sichtbare Objekte, nächste zuerst', async () => {
  const u = umgebung(grunddaten(), gf)
  const r = await fuehreBesichtigungWerkzeugAus('besichtigungen_zeigen', {}, u.ctx)
  assertStringIncludes(r, 'in den nächsten 14 Tagen: 2.')
  assert(r.indexOf('Herr Schmidt') < r.indexOf('Familie Müller'))
  assertStringIncludes(r, 'Objekt: MFH Ulm Weststadt, Söflinger Str. 1, Ulm')
  assert(!r.includes('Nachbar'), 'privates Objekt eines anderen')
  assert(!r.includes('Später'), 'außerhalb des Zeitraums')
  assert(!r.includes('bes_alt'))
  assertStringIncludes(await fuehreBesichtigungWerkzeugAus('besichtigungen_zeigen', { tage: 120 }, u.ctx), 'Später')
})

Deno.test('besichtigungen_zeigen mit Objekt: anstehend und bisher, Angebot und Rückmeldung', async () => {
  const u = umgebung(grunddaten())
  const r = await fuehreBesichtigungWerkzeugAus('besichtigungen_zeigen', { objekt_id: 'o_1' }, u.ctx)
  assertStringIncludes(r, 'Besichtigungen für MFH Ulm Weststadt')
  assertStringIncludes(r, '2 anstehend, 1 durchgeführt, 1 Angebot(e), höchstes 450.000 €')
  assert(r.indexOf('Anstehend:') < r.indexOf('id=bes_1') && r.indexOf('id=bes_1') < r.indexOf('Bisher:') && r.indexOf('Bisher:') < r.indexOf('id=bes_alt'))
  assertStringIncludes(r, 'Großes Interesse')
  assertStringIncludes(r, 'Rückmeldung: Gefällt sehr')
})

// ---------------------------------------------------------------------------------------------
// Anlegen

Deno.test('besichtigung_anlegen: genau die Spalten wie zuZeile() im CRM, deutsche Zeit, Verlauf im Objekt', async () => {
  const u = umgebung(grunddaten())
  const r = await fuehreBesichtigungWerkzeugAus('besichtigung_anlegen', { objekt_id: 'o_1', beginn: '2026-11-28T14:30', interessent: ' Herr Klein ', telefon: '0170 1', naechster_schritt: 'bringt Bankberater mit' }, u.ctx)
  assertStringIncludes(r, 'Eingetragen: Besichtigung MFH Ulm Weststadt mit Herr Klein')
  assertStringIncludes(r, '28.11.2026, 14:30 Uhr')
  assertStringIncludes(r, 'Nicht im Kalender')
  const ins = u.geschrieben.find((g) => g.tabelle === 'besichtigungen' && g.art === 'insert')!.werte
  assertEquals(Object.keys(ins).sort(), [
    'angebot', 'beginn', 'dauer_min', 'durchgefuehrt_von', 'email', 'erstellt_von', 'geaendert_am', 'id', 'interesse', 'interessent', 'kalender_termin_id',
    'kunde_bereich', 'kunde_id', 'naechster_schritt', 'objekt_id', 'rueckmeldung', 'status', 'telefon',
  ])
  assert(String(ins.id).startsWith('bes_'))
  assertEquals(ins.beginn, '2026-11-28T13:30:00.000Z')
  assertEquals(ins.status, 'geplant')
  assertEquals(ins.interessent, 'Herr Klein')
  assertEquals(ins.email, '')
  assertEquals(ins.dauer_min, 30)
  assertEquals(ins.durchgefuehrt_von, 'Quirin Lang')
  assertEquals(ins.erstellt_von, 'Quirin Lang')
  assertEquals(ins.kunde_bereich, null)
  const verlauf = u.db.tabellen.objekte[0].activities as Zeile[]
  assertEquals(verlauf.length, 2)
  assertEquals(verlauf[0].text, 'Besichtigung mit Herr Klein für Sa., 28.11.2026, 14:30 Uhr eingetragen')
  assertEquals(verlauf[0].user, 'Quirin Lang')
  assertEquals(verlauf[1].id, 'act_alt', 'alter Verlauf bleibt erhalten')
  assertEquals(u.protokoll.length, 1)

  const doppelt = await fuehreBesichtigungWerkzeugAus('besichtigung_anlegen', { objekt_id: 'o_1', beginn: '2026-11-28T14:30', interessent: 'herr klein' }, u.ctx)
  assert(doppelt.startsWith('Nicht angelegt'), doppelt)
})

Deno.test('besichtigung_anlegen: Kontakt aus den Immobilien-Kontakten füllt Name/Telefon/E-Mail und bekommt Verlauf; andere Bereiche abgelehnt', async () => {
  const u = umgebung(grunddaten(), gf)
  const r = await fuehreBesichtigungWerkzeugAus('besichtigung_anlegen', { objekt_id: 'o_2', beginn: '2026-12-01T09:00', kunde_id: 'k_immo', email: 'anders@x.de', termin_id: '22222222-2222-2222-2222-222222222222' }, u.ctx)
  assertStringIncludes(r, 'mit Familie Weber')
  assertStringIncludes(r, 'Mit dem Kalendertermin verknüpft')
  const ins = u.geschrieben.find((g) => g.tabelle === 'besichtigungen' && g.art === 'insert')!.werte
  assertEquals([ins.kunde_id, ins.kunde_bereich, ins.interessent, ins.telefon, ins.email, ins.kalender_termin_id], ['k_immo', 'immobilienkunden', 'Familie Weber', '0731 9', 'anders@x.de', '22222222-2222-2222-2222-222222222222'])
  const kontakt = u.db.tabellen.kunden[0]
  assertEquals((kontakt.activities as Zeile[])[0].text, 'Besichtigung mit Familie Weber für Di., 01.12.2026, 09:00 Uhr eingetragen (Objekt: ETW Neu-Ulm)')
  assertEquals(kontakt.letzte_aktivitaet, '2026-11-22')

  assertStringIncludes(await fuehreBesichtigungWerkzeugAus('besichtigung_anlegen', { objekt_id: 'o_2', beginn: '2026-12-01T09:00', kunde_id: 'k_ber' }, u.ctx), 'Fehler: Verknüpfen lassen sich nur Kontakte aus den Immobilien-Kontakten')
  assertStringIncludes(await fuehreBesichtigungWerkzeugAus('besichtigung_anlegen', { objekt_id: 'o_2', beginn: '2026-12-01T09:00', interessent: 'X', termin_id: '11111111-1111-1111-1111-111111111111' }, u.ctx), 'Fehler: Verknüpfen lässt sich nur ein Termin aus dem eigenen Kalender')
  assertStringIncludes(await fuehreBesichtigungWerkzeugAus('besichtigung_anlegen', { objekt_id: 'o_2', beginn: '2026-12-01', interessent: 'X' }, u.ctx), 'Fehler: beginn muss Datum und Uhrzeit haben')
  assertStringIncludes(await fuehreBesichtigungWerkzeugAus('besichtigung_anlegen', { objekt_id: 'o_2', beginn: '2026-12-01T09:00' }, u.ctx), 'Fehler: Bitte den Interessenten angeben')
})

// ---------------------------------------------------------------------------------------------
// Ändern

Deno.test('besichtigung_aendern absagen: nur Stand (+ Kalender-Verknüpfung) und geaendert_am, Hinweis auf termin_absagen, Verlauf', async () => {
  const t = grunddaten()
  t.besichtigungen[0].kalender_termin_id = '11111111-1111-1111-1111-111111111111'
  const u = umgebung(t)
  const r = await fuehreBesichtigungWerkzeugAus('besichtigung_aendern', { id: 'bes_1', status: 'abgesagt' }, u.ctx)
  assertStringIncludes(r, 'Stand: Geplant → Abgesagt')
  assertStringIncludes(r, 'mit termin_absagen entfernen')
  assertStringIncludes(r, 'termin_id=11111111-1111-1111-1111-111111111111')
  const upd = u.geschrieben.find((g) => g.tabelle === 'besichtigungen' && g.art === 'update')!.werte
  assertEquals(Object.keys(upd).sort(), ['geaendert_am', 'kalender_termin_id', 'status'])
  assertEquals(upd.status, 'abgesagt')
  assertEquals(upd.kalender_termin_id, null)
  assertEquals((u.db.tabellen.objekte[0].activities as Zeile[])[0].text, 'Besichtigung mit Familie Müller: Abgesagt')
  assertEquals(u.db.tabellen.besichtigungen[0].rueckmeldung, '', 'andere Spalten unberührt')
})

Deno.test('besichtigung_aendern verschieben: nur beginn, Hinweis termin_aendern bei Kalendertermin', async () => {
  const t = grunddaten()
  t.besichtigungen[0].kalender_termin_id = '11111111-1111-1111-1111-111111111111'
  const u = umgebung(t)
  const r = await fuehreBesichtigungWerkzeugAus('besichtigung_aendern', { id: 'bes_1', beginn: '2026-11-26T15:00', interessent: 'Familie Müller' }, u.ctx)
  assertStringIncludes(r, 'Zeit: Mi., 25.11.2026, 14:00 Uhr → Do., 26.11.2026, 15:00 Uhr')
  assertStringIncludes(r, 'mit termin_aendern nachziehen')
  const upd = u.geschrieben.find((g) => g.tabelle === 'besichtigungen' && g.art === 'update')!.werte
  assertEquals(Object.keys(upd).sort(), ['beginn', 'geaendert_am'])
  assertEquals(upd.beginn, '2026-11-26T14:00:00.000Z')
  assertEquals((u.db.tabellen.objekte[0].activities as Zeile[])[0].text, 'Besichtigung mit Familie Müller verschoben auf Do., 26.11.2026, 15:00 Uhr')
})

Deno.test('besichtigung_aendern stattgefunden mit Rückmeldung, Interesse und Angebot; Angebot 0 entfernt', async () => {
  const t = grunddaten()
  t.besichtigungen[0].kunde_id = 'k_immo'
  t.besichtigungen[0].kunde_bereich = 'immobilienkunden'
  const u = umgebung(t)
  const r = await fuehreBesichtigungWerkzeugAus('besichtigung_aendern', { id: 'bes_1', status: 'durchgefuehrt', interesse: 'hoch', rueckmeldung: 'Küche zu klein, sonst top', angebot: 395000, naechster_schritt: 'Finanzierungsnachweis anfordern' }, u.ctx)
  assertStringIncludes(r, 'Stand: Geplant → Durchgeführt')
  assertStringIncludes(r, 'Angebot: (leer) → 395.000 €')
  const upd = u.geschrieben.find((g) => g.tabelle === 'besichtigungen' && g.art === 'update')!.werte
  assertEquals(Object.keys(upd).sort(), ['angebot', 'geaendert_am', 'interesse', 'naechster_schritt', 'rueckmeldung', 'status'])
  const text = 'Besichtigung mit Familie Müller: Durchgeführt · Großes Interesse · Kaufpreisangebot 395.000 €'
  assertEquals((u.db.tabellen.objekte[0].activities as Zeile[])[0].text, text)
  assertEquals((u.db.tabellen.kunden[0].activities as Zeile[])[0].text, `${text} (Objekt: MFH Ulm Weststadt)`)

  const weg = await fuehreBesichtigungWerkzeugAus('besichtigung_aendern', { id: 'bes_alt', angebot: 0 }, u.ctx)
  assertStringIncludes(weg, 'Angebot: 450.000 € → (leer)')
  assertEquals(u.db.tabellen.besichtigungen.find((b) => b.id === 'bes_alt')!.angebot, null)
})

Deno.test('besichtigung_aendern: gleiche Werte → nichts geschrieben; ungültige Werte → Fehler', async () => {
  const u = umgebung(grunddaten())
  const r = await fuehreBesichtigungWerkzeugAus('besichtigung_aendern', { id: 'bes_1', status: 'geplant', beginn: '2026-11-25T14:00', telefon: '0731 2' }, u.ctx)
  assert(r.startsWith('Nichts geändert'), r)
  assertEquals(u.geschrieben.length, 0)
  assertStringIncludes(await fuehreBesichtigungWerkzeugAus('besichtigung_aendern', { id: 'bes_1', status: 'storniert' }, u.ctx), 'Fehler: Ungültiger Stand')
  assertStringIncludes(await fuehreBesichtigungWerkzeugAus('besichtigung_aendern', { id: 'bes_1', interesse: 'riesig' }, u.ctx), 'Fehler: Ungültiges Interesse')
  assertStringIncludes(await fuehreBesichtigungWerkzeugAus('besichtigung_aendern', { id: 'bes_x' }, u.ctx), 'Fehler: Diese Besichtigung gibt es nicht')
})

// ---------------------------------------------------------------------------------------------
// Reine Hilfen

Deno.test('deutsche Ortszeit: Winter und Sommer, ungültige Angaben', () => {
  assertEquals(berlinZuZeitpunkt('2026-11-28T14:30')?.toISOString(), '2026-11-28T13:30:00.000Z')
  assertEquals(berlinZuZeitpunkt('2026-07-01 09:00')?.toISOString(), '2026-07-01T07:00:00.000Z')
  assertEquals(berlinZuZeitpunkt('2026-11-28'), null)
  assertEquals(berlinZuZeitpunkt('2026-02-30T10:00'), null)
})

Deno.test('Verlaufstext wie im CRM', () => {
  const b = { interessent: 'A', beginn: '2026-11-25T13:00:00Z', status: 'geplant', interesse: null, angebot: null }
  assertEquals(besichtigungVerlaufText(b, b), '')
  assertEquals(besichtigungVerlaufText(b, { ...b, status: 'nicht_erschienen' }), 'Besichtigung mit A: Nicht erschienen')
  assertEquals(besichtigungVerlaufText(b, { ...b, interesse: 'kein' }), 'Kein Interesse')
})
