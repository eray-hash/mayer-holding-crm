// Prüft die Zuordnung Termin → Akte (ohne Netz): sicher über die Gast-Adresse, Vorschlag über den Titel (auch bei
// Outlook-Terminen), übersprungene private und reine Team-Termine, abgelehnte Akten, Beanspruchung (jeder Termin
// einmal), Reihenfolge, Trockenlauf, Zuordnung von Hand mit Rechten, und das Assistent-Werkzeug termin_zuordnen.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { aenderungFuer, ordneTermineZu, terminZuordnenAktion } from './terminZuordnung.ts'
import { bewerteTermin, istPrivaterTermin, istTeamTermin, ladeZuordnungsUmgebung, ordneVonHandZu, vorschlagSichtbar, type ZuordnungTermin } from '../_shared/terminZuordnungKern.ts'
import { akteVorschlagText, fuehreZuordnungWerkzeugAus, istZuordnungWerkzeug } from '../telegram-gateway/terminZuordnungWerkzeug.ts'
import { FalscheDatenbank } from '../_shared/testDoppel.ts'

const JETZT = new Date('2026-11-22T10:00:00Z')
const ANDREAS = 'andreas@mayer.test'
const HASAN = 'hasan@mayer.test'
const QUIRIN = 'quirin@mayer.test'

function termin(t: Partial<ZuordnungTermin> & Record<string, unknown>): Record<string, unknown> {
  return {
    titel: 'Termin',
    ort: '',
    beginn: '2026-11-25T09:00:00.000Z',
    ende: '2026-11-25T10:00:00.000Z',
    ganztags: false,
    besitzer_email: HASAN,
    teilnehmer: [],
    kunde_id: null,
    kunde_bereich: null,
    kunde_name: null,
    quelle: 'crm',
    gast: null,
    ms_teilnehmer: null,
    zuordnung_vorschlag: null,
    zuordnung_geprueft_am: null,
    ...t,
  }
}

function db(termine: Record<string, unknown>[], extra: Record<string, Record<string, unknown>[]> = {}) {
  return new FalscheDatenbank({
    termine,
    besichtigungen: [],
    objekte: [{ id: 'o1', bezeichnung: 'Wohnhaus Söflingen', privat_besitzer: null }],
    postfaecher: [{ adresse: 'info@mayer.test' }],
    ms_konten: [{ ms_adresse: 'hsueslue@firma.test' }],
    mitarbeiter: [
      { name: 'Andreas Mayer', email: ANDREAS, rolle: 'geschaeftsfuehrung', ist_admin: true, bereiche: [], aktiv: true },
      { name: 'Hasan Süslü', email: HASAN, rolle: 'geschaeftsfuehrung', ist_admin: true, bereiche: [], aktiv: true },
      { name: 'Quirin Lutzenberger', email: QUIRIN, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'], aktiv: true },
    ],
    kunden: [
      { id: 'k_lehle', bereich: 'erben', firma: 'Josef Lehle', ansprechpartner: 'Josef Lehle', email: 'josef@lehle.test', verantwortlich_email: null },
      { id: 'k_dippert', bereich: 'beratung', firma: 'easyBKV GmbH', ansprechpartner: 'Andreas Dippert', email: 'ad@v2.test', verantwortlich_email: null },
      { id: 'k_doppelt1', bereich: 'beratung', firma: 'Firma A', ansprechpartner: 'Anna Alt', email: 'gemeinsam@x.test', verantwortlich_email: null },
      { id: 'k_doppelt2', bereich: 'erben', firma: 'Firma B', ansprechpartner: 'Bernd Alt', email: 'gemeinsam@x.test', verantwortlich_email: null },
      { id: 'k_huber', bereich: 'privat', firma: 'Max Huber', ansprechpartner: 'Max Huber', email: 'huber@privat.test', verantwortlich_email: HASAN },
      { id: 'k_immo', bereich: 'immobilienkunden', firma: 'Familie Wagner', ansprechpartner: 'Paul Wagner', email: 'wagner@immo.test', verantwortlich_email: null },
      { id: 'k_intern_holding', bereich: 'beratung', firma: 'Intern', email: 'info@mayer.test' },
      { id: 'k_caras', bereich: 'finanzierungen', firma: 'Caras', ansprechpartner: 'Caras', email: '', verantwortlich_email: null },
      { id: 'k_profile', bereich: 'immobilienkunden', firma: 'Zwei Ankaufsprofile an Hasan', ansprechpartner: 'Zwei Ankaufsprofile an Hasan (Absender noch eintragen)', email: '', verantwortlich_email: null },
      { id: 'k_senden', bereich: 'beratung', firma: 'Stadt Senden', ansprechpartner: 'Sundarp, Andreas', email: 'sundarp@senden.test', verantwortlich_email: null },
    ],
    ...extra,
  })
}

const zeile = (d: FalscheDatenbank, id: string) => d.tabelle('termine').find((t) => t.id === id)!

Deno.test('Gast-Adresse bei genau einer Akte (Outlook-Teilnehmer) → automatisch zugeordnet', async () => {
  const d = db([termin({ id: 't1', titel: 'Erstgespräch', quelle: 'outlook', ms_teilnehmer: [{ email: 'ad@v2.test', name: 'Andreas Dippert' }, { email: HASAN, name: 'Hasan' }] })])
  const r = await ordneTermineZu(d, { jetzt: JETZT })
  assertEquals([r.geprueft, r.zugeordnet, r.vorschlaege], [1, 1, 0])
  const t = zeile(d, 't1')
  assertEquals([t.kunde_id, t.kunde_bereich, t.kunde_name], ['k_dippert', 'beratung', 'easyBKV GmbH'])
  assertEquals((t.zuordnung_vorschlag as Record<string, unknown>).stand, 'automatisch')
  assert(t.zuordnung_geprueft_am)
})

Deno.test('Name im Titel → nur Vorschlag, auch bei Outlook-Terminen; kunde_id bleibt leer', async () => {
  const d = db([
    termin({ id: 't1', titel: 'Termin mit Josef Lehle', quelle: 'crm' }),
    termin({ id: 't2', titel: 'Telefonat Lehle wegen Testament', quelle: 'outlook' }),
  ])
  const r = await ordneTermineZu(d, { jetzt: JETZT })
  assertEquals([r.geprueft, r.zugeordnet, r.vorschlaege], [2, 0, 2])
  for (const id of ['t1', 't2']) {
    const t = zeile(d, id)
    assertEquals(t.kunde_id, null)
    const v = t.zuordnung_vorschlag as Record<string, unknown>
    assertEquals([v.stand, v.kunde_id, v.name, v.wie], ['vorschlag', 'k_lehle', 'Josef Lehle', 'titel'])
  }
})

Deno.test('Kollegen-Namen zählen nicht; ganzer Titel = Name einer Akte → Vorschlag', async () => {
  const d = db([
    termin({ id: 'hasan', titel: 'Hasan Süslü - und Partner wg. Kooperation und Moritz Beck', quelle: 'outlook' }),
    termin({ id: 'andreas', titel: '4 Punkte: Supabase · Groq-Konto · Andreas fragen', quelle: 'assistent' }),
    termin({ id: 'caras', titel: 'Caras', quelle: 'outlook' }),
    termin({ id: 'carasplus', titel: 'Caras Vorbereitung', quelle: 'outlook' }),
  ])
  await ordneTermineZu(d, { jetzt: JETZT })
  assertEquals(zeile(d, 'hasan').zuordnung_vorschlag, null)
  assertEquals(zeile(d, 'andreas').zuordnung_vorschlag, null)
  assertEquals((zeile(d, 'caras').zuordnung_vorschlag as Record<string, unknown>).kunde_id, 'k_caras')
  assertEquals(zeile(d, 'carasplus').zuordnung_vorschlag, null)
})

Deno.test('Mehrdeutige Gast-Adresse → nichts automatisch; private, Team- und abgesagte Termine übersprungen', async () => {
  const d = db([
    termin({ id: 'mehr', titel: 'Abstimmung', gast: { email: 'gemeinsam@x.test' } }),
    termin({ id: 'privat', titel: 'Essen gehen (privat) mit Josef Lehle' }),
    termin({ id: 'team', titel: 'Jour fixe Lehle', teilnehmer: [ANDREAS], ms_teilnehmer: [{ email: 'info@amayer-holding.com', name: 'Holding' }, { email: 'hsueslue@firma.test', name: 'H' }] }),
    termin({ id: 'abgesagt', titel: 'Abgesagt: Termin mit Josef Lehle' }),
  ])
  const r = await ordneTermineZu(d, { jetzt: JETZT })
  assertEquals([r.geprueft, r.zugeordnet, r.vorschlaege, r.uebersprungen], [4, 0, 0, 3])
  for (const id of ['mehr', 'privat', 'team', 'abgesagt']) {
    assertEquals(zeile(d, id).kunde_id, null)
    assertEquals(zeile(d, id).zuordnung_vorschlag, null)
    assert(zeile(d, id).zuordnung_geprueft_am, `${id} beansprucht`)
  }
})

Deno.test('Abgelehnte Akte kommt für den Termin nicht wieder; alter Vorschlag wird zurückgenommen', async () => {
  const d = db([
    termin({ id: 't1', titel: 'Termin mit Josef Lehle', zuordnung_vorschlag: { stand: 'keiner', abgelehnt: ['k_lehle'] } }),
    termin({ id: 't2', titel: 'Kaffee', zuordnung_vorschlag: { stand: 'vorschlag', kunde_id: 'k_lehle', name: 'Josef Lehle' } }),
    termin({ id: 't3', titel: 'Erstgespräch', gast: { email: 'josef@lehle.test' }, zuordnung_vorschlag: { abgelehnt: ['k_lehle'] } }),
  ])
  const r = await ordneTermineZu(d, { jetzt: JETZT })
  assertEquals([r.zugeordnet, r.vorschlaege], [0, 0])
  assertEquals(zeile(d, 't1').zuordnung_vorschlag, { stand: 'keiner', abgelehnt: ['k_lehle'] }) // unverändert
  assertEquals((zeile(d, 't2').zuordnung_vorschlag as Record<string, unknown>).stand, 'keiner')
  assertEquals(zeile(d, 't3').kunde_id, null)
})

Deno.test('Private Kontakte nur am Termin ihres Besitzers; Rechte des Besitzers zählen', async () => {
  const d = db([
    termin({ id: 'hasan', titel: 'Treffen Max Huber', besitzer_email: HASAN }),
    termin({ id: 'andreas', titel: 'Treffen Max Huber', besitzer_email: ANDREAS }),
    termin({ id: 'quirin', titel: 'Erstgespräch', besitzer_email: QUIRIN, gast: { email: 'josef@lehle.test' } }),
    termin({ id: 'quirin2', titel: 'Besichtigung', besitzer_email: QUIRIN, gast: { email: 'wagner@immo.test' } }),
  ])
  await ordneTermineZu(d, { jetzt: JETZT })
  assertEquals((zeile(d, 'hasan').zuordnung_vorschlag as Record<string, unknown>).kunde_id, 'k_huber')
  assertEquals(zeile(d, 'andreas').zuordnung_vorschlag, null)
  assertEquals(zeile(d, 'quirin').kunde_id, null) // Quirin darf Erben nicht sehen
  assertEquals(zeile(d, 'quirin2').kunde_id, 'k_immo')
})

Deno.test('Beanspruchung: jeder Termin einmal, Reihenfolge kommend → letzte 30 Tage → älter, höchstens n je Lauf', async () => {
  const d = db([
    termin({ id: 'alt', titel: 'Alt', beginn: '2026-09-01T09:00:00.000Z', ende: '2026-09-01T10:00:00.000Z' }),
    termin({ id: 'vorhin', titel: 'Vorhin', beginn: '2026-11-10T09:00:00.000Z', ende: '2026-11-10T10:00:00.000Z' }),
    termin({ id: 'spaeter', titel: 'Später', beginn: '2027-01-10T09:00:00.000Z', ende: '2027-01-10T10:00:00.000Z' }),
    termin({ id: 'bald', titel: 'Bald', beginn: '2026-11-23T09:00:00.000Z', ende: '2026-11-23T10:00:00.000Z' }),
    termin({ id: 'verknuepft', titel: 'Mit Akte', kunde_id: 'k_lehle' }),
  ])
  const r1 = await ordneTermineZu(d, { jetzt: JETZT, hoechstens: 3 })
  assertEquals(r1.geprueft, 3)
  assertEquals(['bald', 'spaeter', 'vorhin'].map((id) => !!zeile(d, id).zuordnung_geprueft_am), [true, true, true])
  assertEquals(zeile(d, 'alt').zuordnung_geprueft_am, null)
  const r2 = await ordneTermineZu(d, { jetzt: JETZT, hoechstens: 3 })
  assertEquals(r2.geprueft, 1)
  const r3 = await ordneTermineZu(d, { jetzt: JETZT })
  assertEquals(r3.geprueft, 0)
  assertEquals(zeile(d, 'verknuepft').zuordnung_geprueft_am, null)
})

Deno.test('Trockenlauf schreibt nichts und listet das Ergebnis', async () => {
  const d = db([
    termin({ id: 't1', titel: 'Erstgespräch', gast: { email: 'josef@lehle.test' } }),
    termin({ id: 't2', titel: 'Termin mit Josef Lehle' }),
    termin({ id: 't3', titel: 'Zahnarzt' }),
  ])
  const vorher = structuredClone(d.tabelle('termine'))
  const r = await ordneTermineZu(d, { jetzt: JETZT, trockenlauf: true })
  assertEquals([r.geprueft, r.zugeordnet, r.vorschlaege], [3, 1, 1])
  assertEquals(d.tabelle('termine'), vorher)
  assertEquals(r.liste?.find((x) => x.id === 't1')?.akte, 'Josef Lehle (erben, k_lehle)')
})

Deno.test('Zwischendurch von Hand verknüpft → der Lauf überschreibt nichts', async () => {
  const d = db([termin({ id: 't1', titel: 'Erstgespräch', gast: { email: 'josef@lehle.test' } })])
  // Nach dem Beanspruchen setzt jemand von Hand eine andere Akte.
  d.nachAbfrage = (info) => {
    if (info.tabelle === 'termine' && info.art === 'update' && !zeile(d, 't1').kunde_id) Object.assign(zeile(d, 't1'), { kunde_id: 'k_dippert', kunde_name: 'easyBKV GmbH' })
  }
  await ordneTermineZu(d, { jetzt: JETZT })
  assertEquals(zeile(d, 't1').kunde_id, 'k_dippert')
})

Deno.test('Hilfsregeln: privat, Team, Änderung nur bei Bedarf', async () => {
  assert(istPrivaterTermin({ titel: 'Privat: Arzt' }))
  assert(istPrivaterTermin({ titel: 'Urlaub Italien' }))
  assert(!istPrivaterTermin({ titel: 'Privatkunde Huber' }))
  const team = new Set([ANDREAS, HASAN])
  assert(istTeamTermin({ besitzer_email: HASAN, teilnehmer: [ANDREAS], gast: null, ms_teilnehmer: null }, team))
  assert(!istTeamTermin({ besitzer_email: HASAN, teilnehmer: [], gast: null, ms_teilnehmer: null }, team))
  assert(!istTeamTermin({ besitzer_email: HASAN, teilnehmer: [ANDREAS], gast: { email: 'kunde@x.test' }, ms_teilnehmer: null }, team))
  const t = termin({ id: 'x', zuordnung_vorschlag: { stand: 'vorschlag', kunde_id: 'k_lehle' } }) as ZuordnungTermin
  assertEquals(aenderungFuer(t, { art: 'vorschlag', kunde: { id: 'k_lehle', bereich: 'erben' }, name: 'Josef Lehle' }, 'am'), null)
  assertEquals(aenderungFuer(termin({ id: 'y' }) as ZuordnungTermin, { art: 'keiner' }, 'am'), null)
  // Gast-Adresse eines Holding-Postfachs gilt nicht als Kunde
  const d = db([termin({ id: 'z', titel: 'Abstimmung', gast: { email: 'info@mayer.test' } })])
  const u = await ladeZuordnungsUmgebung(d)
  assertEquals((await bewerteTermin(d, zeile(d, 'z') as ZuordnungTermin, u)).art, 'uebersprungen')
})

Deno.test('Von Hand: zuordnen, lösen (kommt nicht wieder), Vorschlag ablehnen, Rechte', async () => {
  const d = db([
    termin({ id: 't1', titel: 'Telefonat', besitzer_email: HASAN, teilnehmer: [QUIRIN] }),
    termin({ id: 't2', titel: 'Termin mit Josef Lehle', besitzer_email: HASAN, zuordnung_vorschlag: { stand: 'vorschlag', kunde_id: 'k_lehle', bereich: 'erben', name: 'Josef Lehle' } }),
  ])
  const hasan = { email: HASAN, name: 'Hasan Süslü', rolle: 'geschaeftsfuehrung', ist_admin: true, bereiche: [] }
  const quirin = { email: QUIRIN, name: 'Quirin', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }

  let r = await ordneVonHandZu(d, hasan, { terminId: 't1', kundeId: 'k_lehle' })
  assert(r.ok)
  assertEquals([zeile(d, 't1').kunde_id, zeile(d, 't1').kunde_name, zeile(d, 't1').kunde_bereich], ['k_lehle', 'Josef Lehle', 'erben'])
  // Privater Kontakt nicht an einem Termin mit Kollegen
  r = await ordneVonHandZu(d, hasan, { terminId: 't1', kundeId: 'k_huber' })
  assert(!r.ok && r.fehler.includes('privaten Kontakt'))
  // Quirin ist Teilnehmer, darf Erben aber nicht sehen
  r = await ordneVonHandZu(d, quirin, { terminId: 't1', kundeId: 'k_lehle' })
  assert(!r.ok && r.status === 403)
  // Andreas ist nicht beteiligt
  r = await ordneVonHandZu(d, { email: ANDREAS, rolle: 'geschaeftsfuehrung', ist_admin: true }, { terminId: 't1', kundeId: 'k_lehle' })
  assert(!r.ok && r.status === 404)
  // Sammelakte nie
  r = await ordneVonHandZu(d, hasan, { terminId: 't1', kundeId: 'k_intern_holding' })
  assert(!r.ok)
  // Lösen → abgelehnt; der Minutentakt schlägt sie danach nicht wieder vor
  r = await ordneVonHandZu(d, hasan, { terminId: 't1', kundeId: null })
  assert(r.ok)
  assertEquals(zeile(d, 't1').kunde_id, null)
  assertEquals((zeile(d, 't1').zuordnung_vorschlag as Record<string, unknown>).abgelehnt, ['k_lehle'])
  // Vorschlag ablehnen
  r = await ordneVonHandZu(d, hasan, { terminId: 't2', kundeId: null, vorschlagAblehnen: true })
  assert(r.ok)
  assertEquals(zeile(d, 't2').zuordnung_vorschlag, { stand: 'keiner', wie: 'Hasan Süslü', am: (zeile(d, 't2').zuordnung_vorschlag as Record<string, unknown>).am, abgelehnt: ['k_lehle'] })
  zeile(d, 't2').zuordnung_geprueft_am = null // z. B. Titel geändert
  const lauf = await ordneTermineZu(d, { jetzt: JETZT })
  assertEquals(lauf.vorschlaege, 0)
})

Deno.test('Von Hand mit gleicheTitel: alle eigenen Termine mit demselben Titel ohne Akte, abgelehnte ausgenommen', async () => {
  const d = db([
    termin({ id: 'c1', titel: 'Caras', quelle: 'outlook' }),
    termin({ id: 'c2', titel: 'Caras', quelle: 'outlook', zuordnung_vorschlag: { stand: 'vorschlag', kunde_id: 'k_caras', abgelehnt: ['k_lehle'] } }),
    termin({ id: 'c3', titel: 'Caras', quelle: 'outlook', zuordnung_vorschlag: { abgelehnt: ['k_caras'] } }),
    termin({ id: 'c4', titel: 'Caras', quelle: 'outlook', kunde_id: 'k_dippert' }),
    termin({ id: 'c5', titel: 'Caras', besitzer_email: ANDREAS }),
    termin({ id: 'c6', titel: 'Caras Vorbereitung' }),
  ])
  const r = await ordneVonHandZu(d, { email: HASAN, name: 'Hasan', rolle: 'geschaeftsfuehrung', ist_admin: true }, { terminId: 'c1', kundeId: 'k_caras', gleicheTitel: true })
  assert(r.ok)
  assertEquals(r.weitere, 1)
  assertEquals(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => zeile(d, id).kunde_id), ['k_caras', 'k_caras', null, 'k_dippert', null, null])
  assertEquals((zeile(d, 'c2').zuordnung_vorschlag as Record<string, unknown>).abgelehnt, ['k_lehle'])
  assertStringIncludes(r.text, '1 weitere Termin')
})

Deno.test('Aktion termin_zuordnen: nur aktive Mitarbeiter, Antwort mit Termin', async () => {
  const d = db([termin({ id: 't1', titel: 'Telefonat', besitzer_email: HASAN })])
  const ok = await terminZuordnenAktion(d, 'Hasan@Mayer.test', { terminId: 't1', kundeId: 'k_dippert' })
  assertEquals(ok.status, 200)
  assertEquals((ok.daten.termin as Record<string, unknown>).kunde_name, 'easyBKV GmbH')
  const fremd = await terminZuordnenAktion(d, 'niemand@x.test', { terminId: 't1', kundeId: 'k_dippert' })
  assertEquals(fremd.status, 403)
})

Deno.test('Werkzeug termin_zuordnen: Vorschlag übernehmen, lösen, Anzeige in termine_zeigen', async () => {
  const d = db([termin({ id: 't1', titel: 'Termin mit Josef Lehle', besitzer_email: HASAN, zuordnung_vorschlag: { stand: 'vorschlag', kunde_id: 'k_lehle', bereich: 'erben', name: 'Josef Lehle' } })])
  const protokoll: string[] = []
  const ctx = { supabase: d, mitarbeiter: { name: 'Hasan Süslü', email: HASAN, rolle: 'geschaeftsfuehrung', ist_admin: true, bereiche: [] }, protokolliere: (s: string) => protokoll.push(s), heute: '2026-11-22' }
  assert(istZuordnungWerkzeug('termin_zuordnen'))
  assertStringIncludes(akteVorschlagText(ctx.mitarbeiter, zeile(d, 't1') as ZuordnungTermin) ?? '', 'k_lehle')
  // Quirin (nur Immobilien) sieht den Erben-Vorschlag nicht
  assertEquals(vorschlagSichtbar({ email: QUIRIN, bereiche: ['immobilien'] }, zeile(d, 't1') as ZuordnungTermin), null)
  let antwort = await fuehreZuordnungWerkzeugAus('termin_zuordnen', { termin_id: 't1' }, ctx)
  assertStringIncludes(antwort, 'Josef Lehle')
  assertEquals(zeile(d, 't1').kunde_id, 'k_lehle')
  assertEquals(akteVorschlagText(ctx.mitarbeiter, zeile(d, 't1') as ZuordnungTermin), undefined)
  antwort = await fuehreZuordnungWerkzeugAus('termin_zuordnen', { termin_id: 't1', loesen: true }, ctx)
  assertStringIncludes(antwort, 'gelöst')
  assertEquals(protokoll.length, 2)
  antwort = await fuehreZuordnungWerkzeugAus('termin_zuordnen', { termin_id: 't1' }, ctx)
  assert(antwort.startsWith('Fehler: '))
  // Privater Assistent: nur eigene Termine ohne Kollegen
  d.tabelle('termine').push(termin({ id: 't2', titel: 'Mit Kollegen', besitzer_email: HASAN, teilnehmer: [ANDREAS] }))
  antwort = await fuehreZuordnungWerkzeugAus('termin_zuordnen', { termin_id: 't2', kunde_id: 'k_huber' }, { ...ctx, mitarbeiter: { ...ctx.mitarbeiter, nurPrivat: true } })
  assert(antwort.startsWith('Fehler: '))
})
