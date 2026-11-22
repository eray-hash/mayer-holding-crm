import { assert, assertEquals, assertMatch, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { anschriftZeilen, gespraechAkteSetzen, type GespraechKontext, gespraechUebernehmen, gespraechVorbereitung, HOECHSTENS_AUDIO_BYTES, protokollTextAus, teilnehmerText, wirksameAnalyse } from './gespraechUebernehmen.ts'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'

const ICH = 'hasan@mayer.test'
const KOLLEGE = 'quirin@mayer.test'
const AUFNAHME = '11111111-2222-3333-4444-555555555555'

/** Testdatenbank plus ilike (nur genauer Vergleich, wie ihn das Modul nutzt: Muster ohne Platzhalter). */
function fakeAdmin(t: Record<string, Zeile[]>) {
  const db = falscheDatenbank()
  for (const [k, v] of Object.entries(t)) db.tabellen[k] = v
  // deno-lint-ignore no-explicit-any
  const mitIlike = (q: any): any => {
    q.ilike = (spalte: string, muster: string) => mitIlike(q.eq(spalte, String(muster).replace(/\\(.)/g, '$1')))
    return q
  }
  return { db, from: (tab: string) => mitIlike(db.from(tab)), storage: db.storage }
}

function analyse() {
  return {
    zusammenfassung: 'Herr Muster will sein Testament aufsetzen lassen.',
    kernthemen: ['Testament', 'Pflichtteil'],
    vereinbarungen: ['Entwurf bis Monatsende'],
    offene_punkte: ['Grundbuchauszug fehlt'],
    naechste_schritte: [{ text: 'Entwurf schreiben', faellig: '2026-11-30', wer: 'Hasan' }],
    termine: [{ titel: 'Besprechung Entwurf', datum: '2026-11-25', uhrzeit: '10:00', ort: 'Ulm' }],
    todos: [{ text: 'Grundbuchauszug anfordern', faellig: '2026-11-26' }, { text: 'Objekt prüfen', zustaendig: 'Quirin' }],
    wiedervorlagen: [{ titel: 'Nachfassen Entwurf', faellig: '2026-12-01' }],
    zahlen: [{ was: 'Vermögen', betrag: 400000, einheit: 'Euro' }],
    kundenfragen: ['Was kostet das?'],
    einwaende: [],
    stimmung: 'positiv',
    risiken: [],
    stammdaten: [{ feld: 'telefon', wert: '0172 1234567' }, { feld: 'email', wert: 'neu@muster.test' }, { feld: 'anschrift', wert: 'Hauptstr. 1, 89073 Ulm' }, { feld: 'firma', wert: 'Muster GmbH' }],
    unterlagen_fehlen: ['Grundbuchauszug'],
    mail_entwurf: { betreff: 'Ihr Testament', text: 'Guten Tag Herr Muster, …' },
    sprecher: [{ label: 'A', name: 'Hasan', rolle: 'mitarbeiter' }, { label: 'B', name: 'Max Muster', rolle: 'kunde' }],
  }
}

function stand(): Record<string, Zeile[]> {
  return {
    mitarbeiter: [
      { id: 'm1', name: 'Hasan', email: ICH, aktiv: true, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['erben'] },
      { id: 'm2', name: 'Quirin', email: KOLLEGE, aktiv: true, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] },
    ],
    kunden: [
      { id: 'k1', bereich: 'erben', firma: 'Max Muster', ansprechpartner: 'Max Muster', verantwortlich: 'Hasan', verantwortlich_email: null, telefon: '', email: 'alt@muster.test', anschrift: 'Hauptstr. 1\n89073 Ulm', naechste_schritte: 'Alter Schritt', activities: [{ id: 'a0', date: '2026-11-01', text: 'alt', user: 'x' }], dokumente: [], stammdaten_vorschlaege: [] },
      { id: 'kp', bereich: 'privat', firma: 'Privat Paul', ansprechpartner: 'Paul', verantwortlich: 'Hasan', verantwortlich_email: ICH, activities: [], dokumente: [] },
    ],
    gespraech_aufnahmen: [{
      id: AUFNAHME, mitarbeiter_email: ICH, kunde_id: 'k1', kunde_bereich: 'erben', objekt_id: null, termin_id: null, titel: 'Erstgespräch Testament', art: 'termin', status: 'fertig',
      segmente: [
        { nr: 2, pfad: `${ICH}/${AUFNAHME}/seg_2.webm`, mime: 'audio/webm', dauer_s: 300, bytes: 3, status: 'transkribiert' },
        { nr: 1, pfad: `${ICH}/${AUFNAHME}/seg_1.webm`, mime: 'audio/webm', dauer_s: 300, bytes: 3, status: 'transkribiert' },
        { nr: 3, pfad: `${KOLLEGE}/fremd/seg_1.webm`, mime: 'audio/webm', bytes: 3, status: 'transkribiert' },
      ],
      marker: [{ sek: 65, text: 'Pflichtteil klären', art: 'wichtig' }], notizen: 'Kunde wirkt entschlossen', fotos: [],
      transkript: 'Hasan: Guten Tag.\nMax Muster: Hallo.', analyse: analyse(), uebernommen: null, dauer_s: 600, erstellt_am: '2026-11-22T09:00:00Z',
    }],
    protokolle: [], wiedervorlagen: [], todos: [], termine: [],
  }
}

function kontext(admin: unknown, ueber: Partial<GespraechKontext> = {}): GespraechKontext {
  return {
    admin,
    aufrufer: { email: ICH, name: 'Hasan', istGf: false },
    heute: '2026-11-22',
    darfKunde: () => Promise.resolve(true),
    darfBereich: (b) => Promise.resolve(b === 'erben'),
    linkBasis: 'https://crm.test/',
    apiKey: null,
    ...ueber,
  }
}

async function mitAudio(admin: ReturnType<typeof fakeAdmin>) {
  await admin.storage.from('gespraech-aufnahmen').upload(`${ICH}/${AUFNAHME}/seg_1.webm`, new Uint8Array([1, 2, 3]), { contentType: 'audio/webm' })
  await admin.storage.from('gespraech-aufnahmen').upload(`${ICH}/${AUFNAHME}/seg_2.webm`, new Uint8Array([4, 5, 6]), { contentType: 'audio/webm' })
  await admin.storage.from('gespraech-aufnahmen').upload(`${KOLLEGE}/fremd/seg_1.webm`, new Uint8Array([9]), { contentType: 'audio/webm' })
}

const ALLES = { protokoll: true, naechsteSchritte: true, wiedervorlagen: [0], todos: [0, 1], termine: [0], stammdaten: [0, 1, 2, 3], audioInAkte: true, mailEntwurf: true }
const BEARBEITET = { todos: [{ text: 'Grundbuchauszug anfordern', faellig: '2026-11-26' }, { text: 'Objekt prüfen', zustaendig_email: KOLLEGE }] }

Deno.test('Hilfen: Anschrift, Teilnehmer, bearbeitete Fassung, Protokolltext', () => {
  assertEquals(anschriftZeilen('Hauptstr. 1, 89073 Ulm'), 'Hauptstr. 1\n89073 Ulm')
  assertEquals(teilnehmerText(analyse(), 'Max Muster', 'Hasan'), 'Hasan, Max Muster')
  assertEquals(teilnehmerText(null, 'Max Muster', 'Hasan'), 'Max Muster, Hasan')
  const w = wirksameAnalyse(analyse(), { wiedervorlagen: [{ titel: 'Anders', faellig: '2026-12-02' }], unbekannt: 1 })
  assertEquals(w.wiedervorlagen?.[0].titel, 'Anders')
  assertEquals(w.kernthemen, ['Testament', 'Pflichtteil'])
  const t = protokollTextAus(analyse(), { teilnehmer: 'Hasan, Max Muster', dauer: '10:00 Min.', marker: [{ sek: 65, text: 'Pflichtteil', art: 'wichtig' }], notizen: 'Notiz', transkript: 'Abschrift hier', link: 'https://crm.test/gespraech/#/aufnahme/x' })
  assertStringIncludes(t, 'Besprochen:\n- Testament')
  assertStringIncludes(t, 'Nächste Schritte:\n- Entwurf schreiben (Hasan, bis 30.11.2026)')
  assertStringIncludes(t, '1:05 Wichtig: Pflichtteil')
  assertStringIncludes(t, 'Vermögen: 400000 Euro')
  assert(t.indexOf('Abschrift:') > t.indexOf('Notizen:'))
})

Deno.test('Rechte und Voraussetzungen', async () => {
  const t = stand()
  const admin = fakeAdmin(t)
  const fremd = await gespraechUebernehmen(kontext(admin, { aufrufer: { email: KOLLEGE, name: 'Quirin', istGf: true } }), { id: AUFNAHME, auswahl: ALLES })
  assertEquals(fremd.status, 404)
  const ohneRecht = await gespraechUebernehmen(kontext(admin, { darfKunde: () => Promise.resolve(false) }), { id: AUFNAHME, auswahl: ALLES })
  assertEquals(ohneRecht.status, 403)
  t.gespraech_aufnahmen[0].status = 'analyse'
  assertEquals((await gespraechUebernehmen(kontext(admin), { id: AUFNAHME, auswahl: ALLES })).status, 409)
  t.gespraech_aufnahmen[0].status = 'fertig'
  t.gespraech_aufnahmen[0].kunde_id = null
  const ohneAkte = await gespraechUebernehmen(kontext(admin), { id: AUFNAHME, auswahl: ALLES })
  assertEquals(ohneAkte.status, 409)
  assertMatch(String(ohneAkte.daten.error), /Akte zuordnen/)
  t.gespraech_aufnahmen[0].kunde_id = 'k_eingang_ungeklaert'
  assertEquals((await gespraechUebernehmen(kontext(admin), { id: AUFNAHME, auswahl: ALLES })).status, 409)
  assertEquals(t.protokolle.length, 0)
})

Deno.test('Übernahme legt alles an, zweiter Aufruf legt nichts doppelt an', async () => {
  const t = stand()
  const admin = fakeAdmin(t)
  await mitAudio(admin)
  const r = await gespraechUebernehmen(kontext(admin), { id: AUFNAHME, auswahl: ALLES, bearbeitet: BEARBEITET })
  assertEquals(r.status, 200, JSON.stringify(r.daten))
  assertEquals(r.daten.hinweise, [])

  // Protokoll
  assertEquals(t.protokolle.length, 1)
  const p = t.protokolle[0]
  assertEquals(p.id, 'p_gespr_111111112222')
  assertEquals(p.kunde_id, 'k1')
  assertEquals(p.bereich, 'erben')
  assertEquals(p.datum, '2026-11-22')
  assertEquals(p.betreff, 'Erstgespräch Testament')
  assertEquals(p.teilnehmer, 'Hasan, Max Muster')
  assertEquals(p.kernthemen, ['Testament', 'Pflichtteil'])
  assertEquals(p.offene_punkte, ['Grundbuchauszug fehlt'])
  assertEquals(p.dauer_sekunden, 600)
  assertStringIncludes(String(p.text), `https://crm.test/gespraech/#/aufnahme/${AUFNAHME}`)

  // Wiedervorlage, To-dos, Termin
  assertEquals(t.wiedervorlagen.length, 1)
  assertEquals(t.wiedervorlagen[0].quelle, 'hand')
  assertEquals(t.wiedervorlagen[0].faellig, '2026-12-01')
  assertEquals(t.todos.length, 2)
  assertEquals(t.todos[0].besitzer_email, ICH)
  assertEquals(t.todos[0].erledigen_bis, '2026-11-26')
  assertEquals(t.todos[0].kunde_projekt, 'Max Muster')
  assertEquals(t.todos[1].besitzer_email, KOLLEGE)
  assertEquals(t.todos[1].aufgabe, 'Objekt prüfen (von Hasan)')
  assertEquals(t.termine.length, 1)
  assertEquals(t.termine[0].besitzer_email, ICH)
  assertEquals(t.termine[0].beginn, '2026-11-25T09:00:00.000Z') // 10 Uhr Winterzeit
  assertEquals(t.termine[0].ende, '2026-11-25T10:00:00.000Z')
  assertEquals(t.termine[0].kunde_id, 'k1')
  assertEquals(t.termine[0].quelle, 'gespraech')

  // Akte: Nächste Schritte, Stammdaten, Verlauf, Audio
  const k = t.kunden[0]
  assertEquals(k.naechste_schritte, '- Entwurf schreiben (Hasan, bis 30.11.2026)')
  assertEquals(k.telefon, '0172 1234567')
  assertEquals(k.email, 'alt@muster.test')
  // deno-lint-ignore no-explicit-any
  const vorschlaege = k.stammdaten_vorschlaege as any[]
  assertEquals(vorschlaege.length, 1)
  assertEquals(vorschlaege[0].feld, 'email')
  assertEquals(vorschlaege[0].wert, 'neu@muster.test')
  assertEquals(vorschlaege[0].bisher, 'alt@muster.test')
  assertEquals(vorschlaege[0].status, 'offen')
  assertEquals(vorschlaege[0].quelle, 'gespraech')
  // deno-lint-ignore no-explicit-any
  const verlauf = (k.activities as any[]).map((a) => String(a.text))
  assertEquals(verlauf.length, 1 + 6)
  assertMatch(verlauf[0], /^Gesprächsaufnahme übernommen \(Kundentermin, 10:00 Min\.\): „Erstgespräch Testament“: Gesprächsprotokoll/)
  assert(verlauf.some((v) => v.includes('Vorher stand dort: „Alter Schritt“')))
  assert(verlauf.some((v) => v.startsWith('Telefon aus der Gesprächsaufnahme vom 22.11.2026 ergänzt')))
  assert(verlauf.some((v) => v.includes('Firma: Muster GmbH')))
  assert(verlauf.some((v) => v.startsWith('Mail-Entwurf aus dem Gespräch (nicht verschickt) — Betreff: Ihr Testament')))
  assertEquals(verlauf[verlauf.length - 1], 'alt')
  // deno-lint-ignore no-explicit-any
  const doks = k.dokumente as any[]
  assertEquals(doks.map((d) => d.name), ['Gesprächsaufnahme 22.11.2026 Teil 1 von 2.webm', 'Gesprächsaufnahme 22.11.2026 Teil 2 von 2.webm'])
  const ablage = admin.db.ablage.get('kunden-dokumente')!
  assertEquals([...ablage.values()].map((d) => [...d.bytes]), [[1, 2, 3], [4, 5, 6]])
  assert(doks.every((d) => String(d.url).startsWith('k1/dok_')))

  // Vermerk an der Aufnahme
  // deno-lint-ignore no-explicit-any
  const u = t.gespraech_aufnahmen[0].uebernommen as any
  assertEquals(u.protokollId, p.id)
  assertEquals(Object.keys(u.wiedervorlagen), ['0'])
  assertEquals(Object.keys(u.todos), ['0', '1'])
  assertEquals(u.termine['0'], t.termine[0].id)
  assertEquals(u.stammdaten, { '0': 'ergaenzt', '1': vorschlaege[0].id, '2': 'gleich', '3': 'notiz' })
  assertEquals(u.audio.dokumentIds.length, 2)
  assertEquals(u.mailEntwurf, true)

  // Zweiter Aufruf: nichts neu
  const zweiter = await gespraechUebernehmen(kontext(admin), { id: AUFNAHME, auswahl: ALLES, bearbeitet: BEARBEITET })
  assertEquals(zweiter.status, 200)
  assertEquals(zweiter.daten.zeilen, ['Schon alles übernommen — nichts neu angelegt.'])
  assertEquals([t.protokolle.length, t.wiedervorlagen.length, t.todos.length, t.termine.length], [1, 1, 2, 1])
  assertEquals((t.kunden[0].activities as unknown[]).length, 7)
  assertEquals((t.kunden[0].dokumente as unknown[]).length, 2)
})

Deno.test('Schrittweise: erst nur das Protokoll, später mehr', async () => {
  const t = stand()
  const admin = fakeAdmin(t)
  const r1 = await gespraechUebernehmen(kontext(admin), { id: AUFNAHME, auswahl: { protokoll: true } })
  assertEquals(r1.status, 200)
  assertEquals([t.protokolle.length, t.wiedervorlagen.length, t.termine.length], [1, 0, 0])
  assertEquals(t.kunden[0].naechste_schritte, 'Alter Schritt')
  const r2 = await gespraechUebernehmen(kontext(admin), { id: AUFNAHME, auswahl: { wiedervorlagen: [0], termine: [0, 5] } })
  assertEquals(r2.status, 200)
  assertEquals([t.protokolle.length, t.wiedervorlagen.length, t.termine.length], [1, 1, 1])
  // deno-lint-ignore no-explicit-any
  const verlauf = (t.kunden[0].activities as any[]).map((a) => String(a.text))
  assertMatch(verlauf[0], /^Weitere Punkte aus der Gesprächsaufnahme „Erstgespräch Testament“ übernommen: Wiedervorlage/)
})

Deno.test('Gleichzeitiger zweiter Aufruf scheitert am Protokoll-Schlüssel', async () => {
  const t = stand()
  t.protokolle.push({ id: 'p_gespr_111111112222', kunde_id: 'k1' })
  const r = await gespraechUebernehmen(kontext(fakeAdmin(t)), { id: AUFNAHME, auswahl: ALLES })
  assertEquals(r.status, 409)
  assertEquals(t.wiedervorlagen.length, 0)
})

Deno.test('Zu großes Audio wird übersprungen, private Akte ohne Wiedervorlagen, ganztägiger Termin', async () => {
  const t = stand()
  const z = t.gespraech_aufnahmen[0]
  z.kunde_id = 'kp'
  // deno-lint-ignore no-explicit-any
  ;(z.segmente as any[])[0].bytes = HOECHSTENS_AUDIO_BYTES
  const admin = fakeAdmin(t)
  await mitAudio(admin)
  const r = await gespraechUebernehmen(kontext(admin), {
    id: AUFNAHME,
    auswahl: { wiedervorlagen: [0], termine: [0], audioInAkte: true },
    bearbeitet: { termine: [{ titel: 'Ganzer Tag', datum: '2026-11-25' }] },
  })
  assertEquals(r.status, 200)
  const hinweise = r.daten.hinweise as string[]
  assert(hinweise.some((h) => h.includes('Private Kontakte haben keine Wiedervorlagen')))
  assert(hinweise.some((h) => h.startsWith('Audio nicht in die Akte kopiert')))
  assertEquals(t.wiedervorlagen.length, 0)
  assertEquals(admin.db.ablage.get('kunden-dokumente')?.size ?? 0, 0)
  assertEquals(t.termine[0].ganztags, true)
  assertEquals(t.termine[0].beginn, '2026-11-24T23:00:00.000Z')
  assertEquals(t.termine[0].ende, '2026-11-25T23:00:00.000Z')
  // deno-lint-ignore no-explicit-any
  assertMatch((t.gespraech_aufnahmen[0].uebernommen as any).audio.uebersprungen, /zu groß/)
})

Deno.test('Akte zuordnen und neu anlegen', async () => {
  const t = stand()
  t.gespraech_aufnahmen[0].kunde_id = null
  const admin = fakeAdmin(t)
  const k = kontext(admin)
  assertEquals((await gespraechAkteSetzen(k, { id: AUFNAHME, kundeId: 'k_intern_holding' })).status, 400)
  assertEquals((await gespraechAkteSetzen(kontext(admin, { darfKunde: () => Promise.resolve(false) }), { id: AUFNAHME, kundeId: 'k1' })).status, 403)
  const ok = await gespraechAkteSetzen(k, { id: AUFNAHME, kundeId: 'k1' })
  assertEquals(ok.daten, { ok: true, kundeId: 'k1', kundeBereich: 'erben', angelegt: false })
  assertEquals(t.gespraech_aufnahmen[0].kunde_id, 'k1')

  // Doppelt
  const doppelt = await gespraechAkteSetzen(k, { id: AUFNAHME, neu: { bereich: 'erben', firma: 'Max Muster' } })
  assertEquals(doppelt.status, 409)
  // deno-lint-ignore no-explicit-any
  assertEquals((doppelt.daten.doppelt as any).id, 'k1')
  // Bereich nicht freigegeben
  assertEquals((await gespraechAkteSetzen(k, { id: AUFNAHME, neu: { bereich: 'beratung', firma: 'Neu GmbH' } })).status, 403)
  // Neu
  const neu = await gespraechAkteSetzen(k, { id: AUFNAHME, neu: { bereich: 'erben', firma: 'Erika Neu', telefon: '0731 1', email: 'Erika@Neu.test' } })
  assertEquals(neu.status, 200)
  assertEquals(neu.daten.angelegt, true)
  const akte = t.kunden.find((x) => x.id === neu.daten.kundeId)!
  assertEquals(akte.status, 'erstkontakt')
  assertEquals(akte.ansprechpartner, 'Erika Neu')
  assertEquals(akte.email, 'erika@neu.test')
  assertEquals(akte.verantwortlich, 'Hasan')
  assertEquals(t.gespraech_aufnahmen[0].kunde_id, neu.daten.kundeId)
  // Privat: gehört dem Anlegenden
  const privat = await gespraechAkteSetzen(k, { id: AUFNAHME, neu: { bereich: 'privat', firma: 'Mein Kontakt' } })
  assertEquals(t.kunden.find((x) => x.id === privat.daten.kundeId)!.verantwortlich_email, ICH)

  // Nach der Übernahme lässt sich die Akte nicht mehr ändern
  t.gespraech_aufnahmen[0].uebernommen = { protokollId: 'p_x', kundeId: 'k1' }
  assertEquals((await gespraechAkteSetzen(k, { id: AUFNAHME, kundeId: 'k1' })).status, 409)
})

Deno.test('Vorbereitung: Briefing zur Akte mit Gesprächspunkten, Rechte, fremder Termin', async () => {
  const t = stand()
  t.termine.push({ id: 't-fremd', titel: 'Termin Quirin', besitzer_email: KOLLEGE, teilnehmer: [], beginn: '2026-11-23T09:00:00Z', ende: '2026-11-23T10:00:00Z', ganztags: false, kunde_id: 'k1' })
  t.termine.push({ id: 't1', titel: 'Testament Muster', besitzer_email: ICH, teilnehmer: [], beginn: '2026-11-23T09:00:00Z', ende: '2026-11-23T10:00:00Z', ganztags: false, kunde_id: 'k1' })
  const admin = fakeAdmin(t)
  const ki = () =>
    Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'gespraechspunkte', input: { punkte: ['Grundbuchauszug ansprechen', 'Nächsten Schritt vereinbaren'] } }] }), { status: 200 }))
  const k = kontext(admin, { ki, apiKey: 'test', jetzt: new Date('2026-11-22T12:00:00Z') })
  const r = await gespraechVorbereitung(k, { kundeId: 'k1' })
  assertEquals(r.status, 200, JSON.stringify(r.daten))
  assertEquals(r.daten.gespraechspunkte, ['Grundbuchauszug ansprechen', 'Nächsten Schritt vereinbaren'])
  // deno-lint-ignore no-explicit-any
  assertEquals((r.daten.vorgabe as any), { terminId: 't1', kundeId: 'k1', kundeBereich: 'erben', objektId: null, titel: 'Testament Muster' })
  assertStringIncludes(String(r.daten.text), 'Gesprächspunkte (Vorschlag)')
  assertEquals((await gespraechVorbereitung(k, { terminId: 't-fremd' })).status, 404)
  assertEquals((await gespraechVorbereitung(k, { terminId: 't1', punkte: false })).status, 200)
  t.kunden[0].bereich = 'beratung'
  assertEquals((await gespraechVorbereitung(k, { kundeId: 'k1' })).status, 403)
  assertEquals((await gespraechVorbereitung(k, {})).status, 400)
})
