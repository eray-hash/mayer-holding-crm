// Prüft „Verträge und Abos im Blick“: Kündigungsrechnung (Verlängerung, Monatsletzter, Schaltjahr, fehlende
// Angaben), Besitzer-Schutz in jeder Abfrage, Vollständigkeits-Hinweis der Liste, Löschen nur nach Bestätigung
// und die Zeilen für den Morgenplan — mit einer Datenbank im Speicher.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import {
  artVon,
  felderAus,
  fuehreVertragWerkzeugAus,
  HOECHSTENS_ZEIGEN,
  naechsteKuendigung,
  plusMonate,
  proMonat,
  sortiereVertraege,
  type VertragKontext,
  vertragsFristZeilen,
  VERTRAG_WERKZEUGE,
} from './vertragWerkzeuge.ts'

const HEUTE = '2026-11-23'
const ICH = 'sueslue@hotmail.com'
const FREMD = 'andere@mayer.de'

function vertrag(id: string, mehr: Zeile = {}): Zeile {
  return {
    id,
    besitzer_email: ICH,
    anbieter: 'EnBW',
    art: 'Strom',
    bezeichnung: null,
    beitrag: 85,
    beitrag_rhythmus: 'monatlich',
    vertragsbeginn: null,
    laufzeit_ende: '2026-12-31',
    kuendigungsfrist_tage: null,
    kuendigungsfrist_monate: 1,
    verlaengert_sich: true,
    verlaengerung_monate: 12,
    naechste_kuendigung: null,
    notiz: null,
    quelle: null,
    ...mehr,
  }
}

function aufbau(zeilen: Zeile[], o: { privat?: boolean; email?: string } = {}) {
  const db = falscheDatenbank({ privat_vertraege: zeilen })
  const protokoll: string[] = []
  const ctx: VertragKontext = { supabase: db, mitarbeiter: { name: 'Hasan', email: o.email ?? 'Sueslue@Hotmail.com' }, protokolliere: (t) => protokoll.push(t), heute: HEUTE, privat: o.privat ?? true }
  const tab = () => db.tabelle('privat_vertraege')
  return { db, ctx, protokoll, tab, zeile: (id: string) => tab().find((z) => z.id === id) }
}

// ---------------------------------------------------------------------------------------------
// Rechnung

Deno.test('naechsteKuendigung: Frist in Monaten und Tagen, Termin noch offen', () => {
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2027-12-31', kuendigungsfrist_monate: 3, verlaengert_sich: true }, HEUTE), { art: 'kuendbar', kuendigen_bis: '2027-09-30', laufzeit_ende: '2027-12-31', verlaengert: 0 })
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2027-03-15', kuendigungsfrist_tage: 42 }, HEUTE), { art: 'kuendbar', kuendigen_bis: '2027-02-01', laufzeit_ende: '2027-03-15', verlaengert: 0 })
  // Monatsletzter: 30.06. − 1 Monat = 31.05.
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2027-06-30', kuendigungsfrist_monate: 1 }, HEUTE), { art: 'kuendbar', kuendigen_bis: '2027-05-31', laufzeit_ende: '2027-06-30', verlaengert: 0 })
  // Heute ist der letzte Tag: noch rechtzeitig
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2026-12-23', kuendigungsfrist_monate: 1 }, HEUTE), { art: 'kuendbar', kuendigen_bis: HEUTE, laufzeit_ende: '2026-12-23', verlaengert: 0 })
})

Deno.test('naechsteKuendigung: automatische Verlängerung rollt um 12 Monate (oder den eigenen Schritt) weiter', () => {
  // Termin 30.09.2026 verpasst → Vertrag läuft bis 31.12.2027, kündbar bis 30.09.2027
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2026-12-31', kuendigungsfrist_monate: 3, verlaengert_sich: true }, HEUTE), { art: 'kuendbar', kuendigen_bis: '2027-09-30', laufzeit_ende: '2027-12-31', verlaengert: 1 })
  // Ohne Angabe zur Verlängerung: wie verlängert
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2026-12-31', kuendigungsfrist_monate: 3 }, HEUTE).art, 'kuendbar')
  // Sehr altes Ende: viele Jahre weiter
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2015-04-30', kuendigungsfrist_tage: 30 }, HEUTE), { art: 'kuendbar', kuendigen_bis: '2027-03-31', laufzeit_ende: '2027-04-30', verlaengert: 12 })
  // Monatlich kündbar (Schritt 1 Monat, Frist 1 Monat): Ende nächster Monat, bis Ende dieses Monats
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2026-11-30', kuendigungsfrist_monate: 1, verlaengerung_monate: 1 }, HEUTE), { art: 'kuendbar', kuendigen_bis: '2026-11-30', laufzeit_ende: '2026-12-31', verlaengert: 1 })
  // Verlängert sich nicht: endet von selbst bzw. ist vorbei
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2027-01-31', verlaengert_sich: false }, HEUTE), { art: 'endet_von_selbst', laufzeit_ende: '2027-01-31' })
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2026-01-31', verlaengert_sich: false, kuendigungsfrist_monate: 3 }, HEUTE), { art: 'beendet', laufzeit_ende: '2026-01-31' })
})

Deno.test('naechsteKuendigung: Schaltjahr ohne Verrutschen', () => {
  assertEquals(plusMonate('2028-02-29', 12), '2029-02-28')
  assertEquals(plusMonate('2027-02-28', 12), '2028-02-29') // Monatsletzter bleibt Monatsletzter
  assertEquals(plusMonate('2027-01-31', 1), '2027-02-28')
  assertEquals(plusMonate('2026-03-15', -1), '2026-02-15')
  // Ende 29.02.2024, jährlich: 28.02.2025, 2026, 2027, dann wieder 29.02.2028 (vom ursprünglichen Ende aus gerechnet)
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2024-02-29', kuendigungsfrist_tage: 30 }, HEUTE), { art: 'kuendbar', kuendigen_bis: '2027-01-29', laufzeit_ende: '2027-02-28', verlaengert: 3 })
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2024-02-29', kuendigungsfrist_tage: 30 }, '2027-02-01'), { art: 'kuendbar', kuendigen_bis: '2028-01-30', laufzeit_ende: '2028-02-29', verlaengert: 4 })
  // 30 Tage vor dem 29.02.2028 = 30.01.2028 (Schalttag zählt mit)
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2028-02-29', kuendigungsfrist_tage: 30 }, HEUTE), { art: 'kuendbar', kuendigen_bis: '2028-01-30', laufzeit_ende: '2028-02-29', verlaengert: 0 })
})

Deno.test('naechsteKuendigung: fehlende Angaben', () => {
  assertEquals(naechsteKuendigung({}, HEUTE), { art: 'unvollstaendig', fehlt: ['laufzeit_ende', 'kuendigungsfrist'] })
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2027-12-31' }, HEUTE), { art: 'unvollstaendig', fehlt: ['kuendigungsfrist'] })
  assertEquals(naechsteKuendigung({ kuendigungsfrist_monate: 3 }, HEUTE), { art: 'unvollstaendig', fehlt: ['laufzeit_ende'] })
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2027-02-30', kuendigungsfrist_monate: 3 }, HEUTE), { art: 'unvollstaendig', fehlt: ['laufzeit_ende'] })
  // Verlängert sich nicht → Frist nicht nötig
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2027-12-31', verlaengert_sich: false }, HEUTE).art, 'endet_von_selbst')
  // Frist 0 Tage zählt als Angabe
  assertEquals(naechsteKuendigung({ laufzeit_ende: '2027-12-31', kuendigungsfrist_tage: 0 }, HEUTE), { art: 'kuendbar', kuendigen_bis: '2027-12-31', laufzeit_ende: '2027-12-31', verlaengert: 0 })
})

Deno.test('Eingaben: Art, Zahlweise, Beträge, Laufzeit in Monaten, monatlich kündbar', () => {
  assertEquals(artVon('Stromvertrag'), 'Strom')
  assertEquals(artVon('Handy'), 'Telefon')
  assertEquals(artVon('KFZ-Versicherung'), 'Versicherung')
  assertEquals(artVon('xyz'), undefined)
  const { felder, fehler } = felderAus({ beitrag: '1.200,50 €', beitrag_rhythmus: 'pro Jahr', vertragsbeginn: '01.03.2025', laufzeit_monate: 24, kuendigungsfrist_monate: 3 }, HEUTE)
  assertEquals(fehler, [])
  assertEquals(felder.beitrag, 1200.5)
  assertEquals(felder.beitrag_rhythmus, 'jährlich')
  assertEquals(felder.laufzeit_ende, '2027-02-28')
  assertEquals(felder.kuendigungsfrist_tage, null)
  const m = felderAus({ monatlich_kuendbar: true }, HEUTE).felder
  assertEquals([m.laufzeit_ende, m.verlaengerung_monate, m.verlaengert_sich], ['2026-11-30', 1, true])
  assert(felderAus({ laufzeit_ende: '31.02.2027' }, HEUTE).fehler.length === 1)
  assert(felderAus({ laufzeit_monate: 12 }, HEUTE).fehler[0].includes('Vertragsbeginn'))
  assertEquals(proMonat(120, 'jährlich'), 10)
  assertEquals(proMonat(30, 'vierteljährlich'), 10)
  assertEquals(proMonat(500, 'einmalig'), 0)
})

// ---------------------------------------------------------------------------------------------
// Werkzeuge

Deno.test('vertrag_anlegen: legt eigenen Vertrag an, rechnet Merkwert, fragt nach Fehlendem, verhindert Doppel', async () => {
  const { ctx, tab, protokoll } = aufbau([vertrag('fremd', { besitzer_email: FREMD, anbieter: 'Allianz', art: 'Versicherung' })])
  const r = await fuehreVertragWerkzeugAus('vertrag_anlegen', { anbieter: 'Allianz', art: 'Versicherung', bezeichnung: 'Hausrat', beitrag: 120, beitrag_rhythmus: 'jährlich' }, ctx)
  assertStringIncludes(r, 'Angelegt: Versicherung (Allianz, Hausrat): 120,00 € jährlich')
  assertStringIncludes(r, 'Es fehlt noch: Laufzeitende, Kündigungsfrist')
  const neu = tab().find((z) => z.besitzer_email === ICH)!
  assertEquals(neu.besitzer_email, ICH) // klein geschrieben
  assertEquals(neu.naechste_kuendigung, null)
  assertEquals(protokoll.length, 1)
  // Fremder Vertrag beim selben Anbieter zählt nicht als Doppel, eigener schon
  const doppelt = await fuehreVertragWerkzeugAus('vertrag_anlegen', { anbieter: 'allianz', art: 'Versicherung' }, ctx)
  assertStringIncludes(doppelt, 'Nichts angelegt')
  assert(!doppelt.includes('vertrag_id=fremd'))
  assertEquals(tab().length, 2)
  const zweiter = await fuehreVertragWerkzeugAus('vertrag_anlegen', { anbieter: 'allianz', art: 'Versicherung', trotzdem_neu: true }, ctx)
  assertStringIncludes(zweiter, 'Angelegt')
  assertEquals(tab().length, 3)
  // Mit allen Angaben: Merkwert gesetzt, keine Rückfrage zur Frist
  const voll = await fuehreVertragWerkzeugAus('vertrag_anlegen', { anbieter: 'EnBW', art: 'Strom', beitrag: 85, laufzeit_ende: '2026-12-31', kuendigungsfrist_monate: 1, verlaengert_sich: true }, ctx)
  assertStringIncludes(voll, 'kündbar bis 30.11.2026 (noch 7 Tage) zum 31.12.2026, Frist 1 Monat')
  assert(!voll.includes('Es fehlt'))
  assertEquals(tab().find((z) => z.anbieter === 'EnBW')!.naechste_kuendigung, '2026-11-30')
  // Fehlerhafte Eingabe: nichts angelegt
  const falsch = await fuehreVertragWerkzeugAus('vertrag_anlegen', { anbieter: 'X', laufzeit_ende: 'irgendwann' }, ctx)
  assert(falsch.startsWith('Fehler:'))
  assertEquals(tab().length, 4)
})

Deno.test('Besitzer-Schutz: fremde Verträge sind weder sichtbar noch änderbar noch löschbar; nur im privaten Assistenten', async () => {
  const { ctx, zeile, tab } = aufbau([vertrag('meins'), vertrag('fremd', { besitzer_email: FREMD, anbieter: 'Vattenfall', notiz: 'geheim' })])
  const liste = await fuehreVertragWerkzeugAus('vertraege_zeigen', {}, ctx)
  assertStringIncludes(liste, 'Alle 1 Verträge, vollständig')
  assert(!liste.includes('Vattenfall') && !liste.includes('geheim'))
  const aendern = await fuehreVertragWerkzeugAus('vertrag_aendern', { vertrag_id: 'fremd', beitrag: 1 }, ctx)
  assertStringIncludes(aendern, 'nicht gefunden')
  assertEquals(zeile('fremd')!.beitrag, 85)
  const loeschen = await fuehreVertragWerkzeugAus('vertrag_loeschen', { vertrag_id: 'fremd', bestaetigt: true }, ctx)
  assertStringIncludes(loeschen, 'nicht gefunden')
  assertEquals(tab().length, 2)
  // Mayer-Bot: abgelehnt
  const mayer = aufbau([vertrag('meins')], { privat: false })
  assertStringIncludes(await fuehreVertragWerkzeugAus('vertraege_zeigen', {}, mayer.ctx), 'nur im privaten Assistenten')
  // Ohne Login-Adresse: nichts
  const ohne = aufbau([vertrag('meins')], { email: '' })
  assert((await fuehreVertragWerkzeugAus('vertraege_zeigen', {}, ohne.ctx)).startsWith('Fehler:'))
})

Deno.test('vertrag_aendern: nur genannte Felder, Notiz ergänzen, Frist wechselt Einheit, Merkwert neu', async () => {
  const { ctx, zeile } = aufbau([vertrag('v1', { notiz: 'Kundennr. 4711', kuendigungsfrist_monate: null, kuendigungsfrist_tage: 14 })])
  const r = await fuehreVertragWerkzeugAus('vertrag_aendern', { vertrag_id: 'v1', kuendigungsfrist_monate: 3, notiz_ergaenzen: 'Preiserhöhung angekündigt' }, ctx)
  assertStringIncludes(r, 'Geändert: Strom (EnBW)')
  const z = zeile('v1')!
  assertEquals(z.kuendigungsfrist_monate, 3)
  assertEquals(z.kuendigungsfrist_tage, null)
  assertEquals(z.beitrag, 85)
  assertEquals(z.notiz, 'Kundennr. 4711\n23.11.2026: Preiserhöhung angekündigt')
  // 31.12.2026 − 3 Monate = 30.09.2026 vorbei → 30.09.2027
  assertEquals(z.naechste_kuendigung, '2027-09-30')
  // Gekündigt
  await fuehreVertragWerkzeugAus('vertrag_aendern', { vertrag_id: 'v1', verlaengert_sich: false }, ctx)
  assertEquals(zeile('v1')!.naechste_kuendigung, null)
  assertStringIncludes(await fuehreVertragWerkzeugAus('vertraege_zeigen', {}, ctx), 'endet am 31.12.2026 von selbst')
})

Deno.test('vertraege_zeigen: Sortierung, Filter, Summe im Monat, ausdrücklicher Hinweis auf weitere', async () => {
  const { ctx } = aufbau([
    vertrag('spaet', { anbieter: 'Telekom', art: 'Telefon', laufzeit_ende: '2027-08-31', beitrag: 40 }),
    vertrag('frueh', { anbieter: 'EnBW', laufzeit_ende: '2026-12-31', beitrag: 85 }),
    vertrag('offen', { anbieter: 'Agenda', art: 'Software', laufzeit_ende: null, beitrag: 360, beitrag_rhythmus: 'jährlich' }),
    vertrag('vorbei', { anbieter: 'Alt GmbH', art: 'Sonstiges', laufzeit_ende: '2025-01-31', verlaengert_sich: false }),
  ])
  const r = await fuehreVertragWerkzeugAus('vertraege_zeigen', {}, ctx)
  const reihe = [...r.matchAll(/vertrag_id=(\w+)/g)].map((m) => m[1])
  assertEquals(reihe, ['frueh', 'spaet', 'offen', 'vorbei'])
  assertStringIncludes(r, 'Alle 4 Verträge, vollständig')
  assertStringIncludes(r, 'Zusammen rund 240,00 € im Monat') // 85 + 40 + 30 + 85
  assertStringIncludes(r, 'Bei 1 Vertrag fehlt etwas')
  const art = await fuehreVertragWerkzeugAus('vertraege_zeigen', { art: 'Software' }, ctx)
  assertStringIncludes(art, '1 von 4 Verträgen passen (Art Software), vollständig')
  const bald = await fuehreVertragWerkzeugAus('vertraege_zeigen', { bald_tage: 30 }, ctx)
  assertEquals([...bald.matchAll(/vertrag_id=(\w+)/g)].map((m) => m[1]), ['frueh'])
  const suche = await fuehreVertragWerkzeugAus('vertraege_zeigen', { suche: 'nichtda' }, ctx)
  assertStringIncludes(suche, 'Insgesamt stehen 4 Verträge')

  // Mehr als HOECHSTENS_ZEIGEN: ausdrücklicher Hinweis
  const viele = Array.from({ length: HOECHSTENS_ZEIGEN + 5 }, (_, i) => vertrag(`v${i}`, { anbieter: `Anbieter ${i}` }))
  const gross = aufbau(viele)
  const lang = await fuehreVertragWerkzeugAus('vertraege_zeigen', {}, gross.ctx)
  assertStringIncludes(lang, `davon die ersten ${HOECHSTENS_ZEIGEN}`)
  assertStringIncludes(lang, 'ES GIBT WEITERE: 5 Verträge')
  assertEquals([...lang.matchAll(/vertrag_id=/g)].length, HOECHSTENS_ZEIGEN)
  assert(!lang.includes('vollständig'))
})

Deno.test('sortiereVertraege: kündbar nach Termin, dann endet von selbst, unvollständig, beendet', () => {
  const s = sortiereVertraege(
    [
      { id: 'b', anbieter: 'B', laufzeit_ende: null },
      { id: 'e', anbieter: 'E', laufzeit_ende: '2027-05-31', verlaengert_sich: false },
      { id: 'k2', anbieter: 'K2', laufzeit_ende: '2027-12-31', kuendigungsfrist_monate: 1 },
      { id: 'k1', anbieter: 'K1', laufzeit_ende: '2027-03-31', kuendigungsfrist_monate: 1 },
      { id: 'x', anbieter: 'X', laufzeit_ende: '2020-01-31', verlaengert_sich: false },
    ],
    HEUTE,
  )
  assertEquals(s.map((v) => v.id), ['k1', 'k2', 'e', 'b', 'x'])
})

Deno.test('vertrag_loeschen: ohne bestaetigt nur Vorschau, dann endgültig', async () => {
  const { ctx, tab, protokoll } = aufbau([vertrag('v1')])
  const vorschau = await fuehreVertragWerkzeugAus('vertrag_loeschen', { vertrag_id: 'v1' }, ctx)
  assertStringIncludes(vorschau, 'Noch nichts gelöscht')
  assertEquals(tab().length, 1)
  assertEquals(protokoll.length, 0)
  const weg = await fuehreVertragWerkzeugAus('vertrag_loeschen', { vertrag_id: 'v1', bestaetigt: true }, ctx)
  assertStringIncludes(weg, 'Gelöscht: Strom (EnBW)')
  assertEquals(tab().length, 0)
  assertEquals(protokoll.length, 1)
})

Deno.test('Werkzeugbeschreibungen: Anlegen von selbst, Rückfrage nach Fehlendem, Löschen nur nach Ja', () => {
  const nach = Object.fromEntries(VERTRAG_WERKZEUGE.map((w) => [w.name, w.description]))
  assertStringIncludes(nach.vertrag_anlegen, 'VON SELBST')
  assertStringIncludes(nach.vertrag_anlegen, 'mein Stromvertrag läuft bis')
  assertStringIncludes(nach.vertrag_anlegen, 'Kündigungsfrist')
  assertStringIncludes(nach.vertrag_loeschen, 'ausdrücklich Ja')
  assertStringIncludes(nach.vertraege_zeigen, 'dass es weitere gibt')
})

// ---------------------------------------------------------------------------------------------
// Morgenplan

Deno.test('vertragsFristZeilen: ≤ 45 Tage, sortiert, höchstens 3 + „und N weitere“, nur eigene, ohne monatlich kündbare', async () => {
  const db = falscheDatenbank({
    privat_vertraege: [
      vertrag('a', { anbieter: 'EnBW', laufzeit_ende: '2027-01-31', kuendigungsfrist_monate: 1 }), // bis 31.12. — 38 Tage
      vertrag('b', { anbieter: 'Telekom', art: 'Telefon', laufzeit_ende: '2026-12-31', kuendigungsfrist_monate: 1 }), // bis 30.11. — 7 Tage
      vertrag('c', { anbieter: 'Allianz', art: 'Versicherung', laufzeit_ende: '2027-01-01', kuendigungsfrist_monate: 1 }), // bis 01.12. — 8 Tage
      vertrag('d', { anbieter: 'HUK', art: 'Versicherung', laufzeit_ende: '2027-01-06', kuendigungsfrist_tage: 0, kuendigungsfrist_monate: null }), // bis 06.01. — 44 Tage
      vertrag('e', { anbieter: 'Spät', laufzeit_ende: '2027-03-31', kuendigungsfrist_monate: 1 }), // 98 Tage — nicht
      vertrag('f', { anbieter: 'Netflix', art: 'Software', laufzeit_ende: '2026-11-30', kuendigungsfrist_tage: 0, kuendigungsfrist_monate: null, verlaengerung_monate: 1 }), // monatlich — nicht
      vertrag('g', { anbieter: 'Gekündigt', laufzeit_ende: '2026-12-31', verlaengert_sich: false }), // nicht
      vertrag('h', { anbieter: 'Ohne Frist', laufzeit_ende: '2026-12-31', kuendigungsfrist_monate: null }), // unvollständig — nicht
      vertrag('x', { besitzer_email: FREMD, anbieter: 'Fremd', laufzeit_ende: '2026-12-31', kuendigungsfrist_monate: 1 }),
    ],
  })
  const zeilen = await vertragsFristZeilen(db, 'SUESLUE@hotmail.com', HEUTE)
  assertEquals(zeilen, [
    '• Telefon (Telekom): kündbar bis 30.11. — noch 7 Tage',
    '• Versicherung (Allianz): kündbar bis 01.12. — noch 8 Tage',
    '• Strom (EnBW): kündbar bis 31.12. — noch 38 Tage',
    '… und 1 weitere',
  ])
  // Genau drei: kein Zusatz; heute letzter Tag
  const db2 = falscheDatenbank({ privat_vertraege: [vertrag('a', { laufzeit_ende: '2026-12-23', kuendigungsfrist_monate: 1 })] })
  assertEquals(await vertragsFristZeilen(db2, ICH, HEUTE), ['• Strom (EnBW): kündbar bis 23.11. — heute letzter Tag'])
  // Nichts fällig, fremde Adresse, leere Adresse
  assertEquals(await vertragsFristZeilen(db2, FREMD, HEUTE), [])
  assertEquals(await vertragsFristZeilen(db2, '', HEUTE), [])
})

Deno.test('vertragsFristZeilen: wirft nie (Tabelle fehlt / Fehler) — leere Liste', async () => {
  const kaputt = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'relation "privat_vertraege" does not exist' } }) }) }) }
  assertEquals(await vertragsFristZeilen(kaputt, ICH, HEUTE), [])
  const wirft = { from: () => { throw new Error('weg') } }
  assertEquals(await vertragsFristZeilen(wirft, ICH, HEUTE), [])
})
