// Prüft kontakt_luecken und kurzpruefung_ausfuellen (Runde 6) mit der Testdatenbank, ohne Netz: Rechnung der Lücken,
// Rechte, Einstellung an/aus; Kurzprüfung Schritt für Schritt im Format des Browsers, frisch gelesen vor dem Schreiben.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fehltText, kontaktLuecken, nachfrageText, pruefeKontakt } from '../_shared/kontaktLuecken.ts'
import { euroGanz, istBegonnen, leereKurzpruefung, offenePunkte, PUNKTE, trageEin, vervollstaendige } from '../_shared/kurzpruefungKern.ts'
import { fuehreKontaktLueckenWerkzeugAus } from './kontaktLueckenWerkzeug.ts'
import { fuehreKurzpruefungWerkzeugAus } from './kurzpruefungWerkzeug.ts'

const HEUTE = '2026-11-23'
const QUIRIN = { name: 'Quirin Lutzenberger', email: 'q@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien', 'finanzierungen'] }
const HASAN = { name: 'Hasan Süslü', email: 'h@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }

function kunden() {
  return [
    { id: 'k1', bereich: 'finanzierungen', firma: 'Anna Alt', ansprechpartner: null, email: '', telefon: '', status: 'interessent', verantwortlich: 'Quirin Lutzenberger' },
    { id: 'k2', bereich: 'immobilienkunden', firma: 'Bernd Bau', ansprechpartner: null, email: 'b@bau.de', telefon: '-', status: 'interessent', verantwortlich: 'Quirin' },
    { id: 'k3', bereich: 'beratung', firma: 'Carla Chef', ansprechpartner: null, email: null, telefon: null, status: 'lead', verantwortlich: 'Hasan Süslü' },
    { id: 'k4', bereich: 'finanzierungen', firma: 'Dora Done', ansprechpartner: null, email: '', telefon: '', status: 'verloren', verantwortlich: 'Quirin Lutzenberger' },
    { id: 'k5', bereich: 'privat', firma: 'Privat', ansprechpartner: null, email: '', telefon: '', status: 'neu', verantwortlich: 'Quirin Lutzenberger', verantwortlich_email: 'q@x.de' },
    { id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: 'Ungeklärte Eingänge', email: '', telefon: '', status: 'lead', verantwortlich: '' },
    { id: 'k6', bereich: 'finanzierungen', firma: 'Emil Echt', ansprechpartner: null, email: 'e@echt.de', telefon: '0731 123456', status: 'interessent', verantwortlich: 'Quirin Lutzenberger' },
  ]
}

const mitarbeiter = [{ name: 'Quirin Lutzenberger', aktiv: true }, { name: 'Hasan Süslü', aktiv: true }]

function k(db: ReturnType<typeof falscheDatenbank>, m: typeof QUIRIN = QUIRIN) {
  const protokoll: string[] = []
  return { ctx: { supabase: db, mitarbeiter: m, protokolliere: (t: string) => protokoll.push(t), heute: HEUTE }, protokoll }
}

Deno.test('Kern: Lücken nur für laufende Akten der Holding, Platzhalter zählen nicht', () => {
  const l = kontaktLuecken(kunden())
  assertEquals(l.map((x) => x.id), ['k1', 'k3', 'k2'])
  assertEquals(kontaktLuecken(kunden(), { nurOhneKontakt: true }).map((x) => x.id), ['k1', 'k3'])
  assertEquals(pruefeKontakt(kunden()[1])!.fehlt, ['telefon'])
  assertEquals(fehltText(['telefon', 'email']), 'Telefon und E-Mail')
  assertEquals(pruefeKontakt(kunden()[6]), null)
})

Deno.test('Kern: Nachfragetext — eine Akte als Satz, mehrere als Liste, Probelauf mit „ginge an“', () => {
  const [a, c] = kontaktLuecken(kunden(), { nurOhneKontakt: true })
  const eins = nachfrageText([a])
  assertStringIncludes(eins, 'Zu Akte Anna Alt (Finanzierungen) fehlen Telefon und E-Mail – weißt du sie?')
  assertStringIncludes(eins, 'Kontakt-Nachfrage aus')
  const zwei = nachfrageText([a, c])
  assertStringIncludes(zwei, '• Anna Alt (Finanzierungen): Telefon und E-Mail fehlen')
  const probe = nachfrageText([{ ...a, an: 'Quirin Lutzenberger' }], true)
  assertStringIncludes(probe, 'Probelauf')
  assertStringIncludes(probe, 'ginge an Quirin Lutzenberger')
  assert(!/[A-Za-z]+ing\b|\bLead\b/.test(eins + zwei), 'englische Wörter im Text')
})

Deno.test('kontakt_luecken: meine Akten, ohne fremde Bereiche, private und Endstand', async () => {
  const db = falscheDatenbank({ kunden: kunden(), mitarbeiter })
  const r = await fuehreKontaktLueckenWerkzeugAus('kontakt_luecken', {}, k(db).ctx)
  assertStringIncludes(r, 'Anna Alt (kunde_id=k1)')
  assert(!r.includes('Carla'), 'fremder Bereich sichtbar')
  assert(!r.includes('Dora'), 'Endstand gezählt')
  assert(!r.includes('Privat'), 'privater Kontakt gezählt')
  assert(!r.includes('Bernd'), 'teilweise ohne auch_teilweise')
  const teil = await fuehreKontaktLueckenWerkzeugAus('kontakt_luecken', { auch_teilweise: true }, k(db).ctx)
  assertStringIncludes(teil, 'Bernd Bau (kunde_id=k2)')
  const eine = await fuehreKontaktLueckenWerkzeugAus('kontakt_luecken', { kunde_id: 'k3' }, k(db).ctx)
  assertStringIncludes(eine, 'Nicht freigegeben')
})

Deno.test('kontakt_luecken: Nachfrage für sich ab- und anschalten', async () => {
  const db = falscheDatenbank({ kunden: kunden(), mitarbeiter, assistent_hinweise: [] })
  const { ctx, protokoll } = k(db)
  assertStringIncludes(await fuehreKontaktLueckenWerkzeugAus('kontakt_luecken', { nachfrage: false }, ctx), 'aus')
  assertEquals(db.tabelle('assistent_hinweise').map((z) => [z.email, z.kontakt_nachfrage]), [['q@x.de', false]])
  await fuehreKontaktLueckenWerkzeugAus('kontakt_luecken', { nachfrage: true }, ctx)
  assertEquals(db.tabelle('assistent_hinweise').length, 1)
  assertEquals(db.tabelle('assistent_hinweise')[0].kontakt_nachfrage, true)
  assertEquals(protokoll.length, 2)
})

// ---------- Kurzprüfung ----------

Deno.test('Kern: leeres Blatt wie im Browser, Eintragen, Reihenfolge der Punkte', () => {
  const leer = leereKurzpruefung(450000, HEUTE)
  assertEquals(leer.zeilen.preis.ist, euroGanz(450000))
  assertEquals(leer.zeilen.preis.ist.replace(/\s/g, ' '), '450.000 €')
  assertEquals(leer.gruendeDafuer, ['', '', '', ''])
  assertEquals(PUNKTE.length, 25)
  assertEquals(offenePunkte(leer)[0].id, 'preis')
  assert(!istBegonnen(leer), 'vorbelegter Kaufpreis zählt als begonnen')
  const { kp, geaendert, fehler } = trageEin(leer, [
    { punkt: 'preis', marktwert: '420.000 €', ergebnis: 'zu hoch' },
    { punkt: 'gruendeDafuer', liste: ['gute Lage', 'hohe Nachfrage'] },
    { punkt: 'prio', wert: 'b' },
    { punkt: 'quatsch', wert: 'x' },
  ])
  assertEquals(geaendert, ['preis', 'gruendeDafuer', 'prio'])
  assertEquals(fehler.length, 1)
  assertEquals(kp.zeilen.preis, { ist: euroGanz(450000), marktwert: '420.000 €', ergebnis: 'zu hoch' })
  assertEquals(kp.gruendeDafuer, ['gute Lage', 'hohe Nachfrage', '', ''])
  assertEquals(kp.prio, 'B')
  assertEquals(offenePunkte(kp)[0].id, 'preisProQm')
  assert(istBegonnen(kp))
  assertEquals(leer.zeilen.preis.marktwert, '', 'altes Blatt verändert')
  // Listen ergänzen, höchstens vier
  const mehr = trageEin(kp, [{ punkt: 'gruendeDafuer', wert: 'a; b; c' }]).kp
  assertEquals(mehr.gruendeDafuer, ['gute Lage', 'hohe Nachfrage', 'a', 'b'])
  assertEquals(vervollstaendige(null, 0, HEUTE).zeilen, { preis: { ist: '', marktwert: '', ergebnis: '' } })
})

function objekte() {
  return [
    { id: 'o1', bezeichnung: 'Geislingen', status: 'akquise', kaufpreis: 300000, kurzpruefung: null, activities: [], verantwortlich: 'Quirin Lutzenberger', privat_besitzer: null },
    { id: 'o2', bezeichnung: 'Aalen', status: 'akquise', kaufpreis: 0, kurzpruefung: { datum: '2026-11-01', zeilen: { preis: { ist: '', marktwert: '1', ergebnis: '' } }, gruendeDafuer: [], gruendeDagegen: [], naechsteSchritte: [] }, activities: [], verantwortlich: 'Quirin Lutzenberger', privat_besitzer: null },
    { id: 'o3', bezeichnung: 'Lorch', status: 'vermarktung', kaufpreis: 0, kurzpruefung: null, activities: [], verantwortlich: 'Quirin Lutzenberger', privat_besitzer: null },
    { id: 'o_priv', bezeichnung: 'Privat Andreas', status: 'akquise', kaufpreis: 0, kurzpruefung: null, activities: [], verantwortlich: 'Quirin', privat_besitzer: 'a@x.de' },
  ]
}

Deno.test('kurzpruefung_ausfuellen: Liste ohne Kurzprüfung, private Objekte anderer fehlen', async () => {
  const db = falscheDatenbank({ objekte: objekte(), mitarbeiter })
  const r = await fuehreKurzpruefungWerkzeugAus('kurzpruefung_ausfuellen', {}, k(db).ctx)
  assertStringIncludes(r, '1 ohne Kurzprüfung, 1 angefangen')
  assertStringIncludes(r, 'ohne: Geislingen (objekt_id=o1)')
  assertStringIncludes(r, 'angefangen: Aalen')
  assert(!r.includes('Lorch') && !r.includes('Privat Andreas'))
  assertStringIncludes(await fuehreKurzpruefungWerkzeugAus('kurzpruefung_ausfuellen', {}, k(db, HASAN).ctx), 'Nicht freigegeben')
})

Deno.test('kurzpruefung_ausfuellen: erster Punkt, Antworten speichern im Browser-Format, nächster Punkt', async () => {
  const db = falscheDatenbank({ objekte: objekte(), mitarbeiter })
  const start = await fuehreKurzpruefungWerkzeugAus('kurzpruefung_ausfuellen', { objekt_id: 'o1' }, k(db).ctx)
  assertStringIncludes(start, 'noch nicht begonnen')
  assertStringIncludes(start, 'Nächster Punkt (preis): Preis: Ist, Marktwert und unser Ergebnis?')
  // Ein offenes Browserfenster hat inzwischen gespeichert — das bleibt erhalten.
  db.tabelle('objekte')[0].kurzpruefung = { ...leereKurzpruefung(300000, HEUTE), offeneFragen: 'Altlasten?' }
  const { ctx, protokoll } = k(db)
  const r = await fuehreKurzpruefungWerkzeugAus('kurzpruefung_ausfuellen', { objekt_id: 'o1', antworten: [{ punkt: 'preis', marktwert: '280.000 €', ergebnis: 'leicht zu hoch' }] }, ctx)
  assertStringIncludes(r, 'Gespeichert in der Kurzprüfung Geislingen')
  assertStringIncludes(r, 'Nächster Punkt (preisProQm)')
  const kp = db.tabelle('objekte')[0].kurzpruefung as Record<string, unknown>
  assertEquals((kp.zeilen as Record<string, unknown>).preis, { ist: euroGanz(300000), marktwert: '280.000 €', ergebnis: 'leicht zu hoch' })
  assertEquals(kp.offeneFragen, 'Altlasten?')
  assertEquals(kp.naechsteSchritte, ['', '', '', ''])
  assertEquals(kp.datum, HEUTE)
  assertStringIncludes((db.tabelle('objekte')[0].activities as { text: string }[])[0].text, 'Kurzprüfung per Telegram ergänzt')
  assertEquals(protokoll.length, 1)
  const nichts = await fuehreKurzpruefungWerkzeugAus('kurzpruefung_ausfuellen', { objekt_id: 'o1', antworten: [{ punkt: 'gibtsnicht', wert: 'x' }] }, ctx)
  assertStringIncludes(nichts, 'Nichts gespeichert')
})

Deno.test('kurzpruefung_ausfuellen: Wochenhinweis an/aus', async () => {
  const db = falscheDatenbank({ objekte: objekte(), mitarbeiter, assistent_hinweise: [] })
  assertStringIncludes(await fuehreKurzpruefungWerkzeugAus('kurzpruefung_ausfuellen', { wochenhinweis: false }, k(db).ctx), 'aus')
  assertEquals(db.tabelle('assistent_hinweise')[0].kurzpruefung_hinweis, false)
})
