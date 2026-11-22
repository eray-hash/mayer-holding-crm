// Prüft die Bücher-Werkzeuge mit einer nachgebauten Datenbank (ohne Netz): Rechte (Zeilenregel
// darf_bereich('buecher')), Liste/Suche, Lesen mit Checkliste/Kontakten/Dateien, Anlegen wie
// legeBuchAn und Ändern nur der geänderten Felder wie aendereBuch.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { BEREICH_IDS } from './rechte.ts'
import { buchAenderungAus, checklisteMit, darfBuecher, fuehreBuecherWerkzeugAus, stufeVon, zahlAus } from './buecherWerkzeuge.ts'

const gf = { name: 'Andreas Mayer', email: 'gf@x.de', rolle: 'geschaeftsfuehrung', bereiche: [] as string[] }
const admin = { name: 'Eray Yesil', email: 'admin@x.de', rolle: 'mitarbeiter', ist_admin: true, bereiche: [] as string[] }
const immo = { name: 'Quirin Lang', email: 'q@x.de', rolle: 'mitarbeiter', bereiche: ['immobilien'] }
const buchMa = { name: 'Bea Buch', email: 'b@x.de', rolle: 'mitarbeiter', bereiche: ['buecher'] }

function buch(z: Partial<Zeile> = {}): Zeile {
  return {
    id: 'buch_1', titel: 'Der kleine Igel', untertitel: null, reihe: 'Waldgeschichten', band: '1', autor: 'Anna Autor', illustrator: null,
    lektorat: null, zielgruppe: 'Kinder 3–6 Jahre', format: null, seitenzahl: 32, isbn: null, auflage: null, druckerei: null,
    erscheinungstermin: null, ladenpreis: 14.9, status: 'lektorat', checkliste: { konzept: true, manuskript_fertig: true }, notizen: 'Erste Notiz',
    dokumente: [{ id: 'bdok_1', name: 'Manuskript.pdf', pfad: 'buecher/buch_1/bdok_1_Manuskript.pdf', groesse: '120 KB', hochgeladenAm: '2026-11-21T10:00:00Z', hochgeladenVon: 'Andreas Mayer' }],
    verantwortlich: null, erstellt_am: '2026-11-21T09:00:00Z', geaendert_am: '2026-11-21T09:00:00Z', geaendert_von: 'Andreas Mayer',
    ...z,
  }
}

/** Datenbank-Doppel, das zusätzlich alle insert/update-Nutzlasten mitschreibt. */
function umgebung(tabellen: Record<string, Zeile[]>, mitarbeiter: Zeile = gf) {
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
  const ctx = { supabase, mitarbeiter: mitarbeiter as any, protokolliere: (s: string) => protokoll.push(s), heute: '2026-11-22' }
  return { db, geschrieben, protokoll, ctx }
}

const grunddaten = () => ({
  buecher: [buch(), buch({ id: 'buch_2', titel: 'Mut zur Übergabe', reihe: null, band: null, autor: 'Andreas Mayer', status: 'druck', checkliste: {}, dokumente: [], geaendert_am: '2026-11-20T09:00:00Z' })],
  buch_kontakte: [
    { id: 'bk_1', name: 'Anna Autor', rolle: 'Autor', firma: null, email: 'anna@autor.de', telefon: '0731 1', notiz: null, buch_ids: ['buch_1'] },
    { id: 'bk_2', name: 'Druckhaus Ulm', rolle: 'Druckerei', firma: 'Druckhaus Ulm GmbH', email: 'info@druck.de', telefon: null, notiz: 'gute Preise', buch_ids: ['buch_1', 'buch_2'] },
    { id: 'bk_3', name: 'Paul Presse', rolle: 'Presse', firma: 'Südwest Presse', email: null, telefon: null, notiz: null, buch_ids: [] },
  ],
  mitarbeiter: [
    { id: 'm1', name: 'Andreas Mayer', aktiv: true },
    { id: 'm2', name: 'Quirin Lang', aktiv: true },
    { id: 'm3', name: 'Hasan Yilmaz', aktiv: true },
  ],
})

// ---------------------------------------------------------------------------------------------
// Rechte

Deno.test('Rechte: Geschäftsführung und Admin ja, Immobilien-Mitarbeiter und privater Assistent nein', () => {
  assertEquals(darfBuecher(gf), true)
  assertEquals(darfBuecher(admin), true)
  assertEquals(darfBuecher(immo), false)
  assertEquals(darfBuecher({ ...gf, nurPrivat: true }), false)
})

Deno.test('Rechte: ohne Freigabe kein Werkzeug und kein Datenbankzugriff', async () => {
  for (const name of ['buecher_auflisten', 'buch_lesen', 'buch_anlegen', 'buch_aendern', 'buch_kontakte_suchen']) {
    const u = umgebung(grunddaten(), immo)
    const r = await fuehreBuecherWerkzeugAus(name, { buch_id: 'buch_1', titel: 'X' }, u.ctx)
    assert(r.startsWith('Nicht freigegeben'), r)
    assertStringIncludes(r, 'Bücher & Verlag')
    assert(!r.includes('Igel'))
    assertEquals(u.db.protokoll.length, 0)
  }
})

Deno.test({
  name: 'Rechte: Mitarbeiter mit Freigabe „buecher“ darf (sobald rechte.ts den Bereich kennt)',
  ignore: !BEREICH_IDS.includes('buecher'),
  fn: async () => {
    assertEquals(darfBuecher(buchMa), true)
    const u = umgebung(grunddaten(), buchMa)
    assertStringIncludes(await fuehreBuecherWerkzeugAus('buecher_auflisten', {}, u.ctx), 'Der kleine Igel')
  },
})

// ---------------------------------------------------------------------------------------------
// Auflisten, Lesen, Kontakte

Deno.test('buecher_auflisten: alle in Stufen-Reihenfolge, Filter nach Stufe und Suche', async () => {
  const u = umgebung(grunddaten())
  const alle = await fuehreBuecherWerkzeugAus('buecher_auflisten', {}, u.ctx)
  assertStringIncludes(alle, 'Bücher: 2.')
  assert(alle.indexOf('Der kleine Igel') < alle.indexOf('Mut zur Übergabe'), 'Lektorat vor Im Druck')
  assertStringIncludes(alle, 'Checkliste 2/')
  assertStringIncludes(alle, 'id=buch_1')
  const druck = await fuehreBuecherWerkzeugAus('buecher_auflisten', { stufe: 'druck' }, u.ctx)
  assertStringIncludes(druck, 'Mut zur Übergabe')
  assert(!druck.includes('Igel'))
  const suche = await fuehreBuecherWerkzeugAus('buecher_auflisten', { suche: 'waldgeschichten' }, u.ctx)
  assertStringIncludes(suche, 'Der kleine Igel')
  assert(!suche.includes('Mut zur'))
  assertStringIncludes(await fuehreBuecherWerkzeugAus('buecher_auflisten', { suche: 'gibtsnicht' }, u.ctx), 'keine')
})

Deno.test('buch_lesen: Angaben, Checkliste mit Kennungen, Kontakte des Buchs, Dateien', async () => {
  const u = umgebung(grunddaten())
  const r = await fuehreBuecherWerkzeugAus('buch_lesen', { buch_id: 'buch_1' }, u.ctx)
  assertStringIncludes(r, 'Stufe: Lektorat')
  assertStringIncludes(r, 'Ladenpreis: 14,90 €')
  assertStringIncludes(r, '[x] Idee und Zielgruppe festgehalten (konzept)')
  assertStringIncludes(r, '[ ] Lektorat abgeschlossen (lektorat_abgeschlossen)')
  assertStringIncludes(r, 'Lektorat & Korrektorat ← aktuelle Stufe')
  assertStringIncludes(r, 'Anna Autor (Autor)')
  assertStringIncludes(r, 'Druckhaus Ulm (Druckerei)')
  assert(!r.includes('Paul Presse'), 'Kontakt ohne dieses Buch')
  assertStringIncludes(r, 'Manuskript.pdf, 120 KB')
  // Über den Titel
  assertStringIncludes(await fuehreBuecherWerkzeugAus('buch_lesen', { titel: 'igel' }, u.ctx), 'id=buch_1')
  assertStringIncludes(await fuehreBuecherWerkzeugAus('buch_lesen', { buch_id: 'buch_x' }, u.ctx), 'Fehler: Dieses Buch gibt es nicht')
})

Deno.test('buch_kontakte_suchen: Rolle, Buch und Suchwort; Buchtitel werden genannt', async () => {
  const u = umgebung(grunddaten())
  const druck = await fuehreBuecherWerkzeugAus('buch_kontakte_suchen', { rolle: 'Druckerei' }, u.ctx)
  assertStringIncludes(druck, 'Druckhaus Ulm')
  assertStringIncludes(druck, '„Der kleine Igel“')
  assertStringIncludes(druck, '„Mut zur Übergabe“')
  assert(!druck.includes('Anna'))
  const zuBuch2 = await fuehreBuecherWerkzeugAus('buch_kontakte_suchen', { buch_id: 'buch_2' }, u.ctx)
  assertStringIncludes(zuBuch2, 'Buch-Kontakte (zum genannten Buch): 1.')
  assertStringIncludes(await fuehreBuecherWerkzeugAus('buch_kontakte_suchen', { suche: 'südwest' }, u.ctx), 'Paul Presse')
})

// ---------------------------------------------------------------------------------------------
// Anlegen und Ändern

Deno.test('buch_anlegen: nur angegebene Felder plus geaendert_von, wie legeBuchAn; doppelter Titel abgelehnt', async () => {
  const u = umgebung(grunddaten())
  const r = await fuehreBuecherWerkzeugAus('buch_anlegen', { titel: '  Der  große Bär ', autor: 'Anna Autor', zielgruppe: '', stufe: 'Manuskript', ladenpreis: '12,90', verantwortlich: 'Quirin' }, u.ctx)
  assertStringIncludes(r, 'Angelegt: Buch „Der große Bär“, Stufe Manuskript')
  const ins = u.geschrieben.find((g) => g.art === 'insert')!
  assertEquals(ins.werte, { titel: 'Der große Bär', autor: 'Anna Autor', zielgruppe: null, status: 'manuskript', ladenpreis: 12.9, verantwortlich: 'Quirin Lang', geaendert_von: 'Andreas Mayer' })
  assertEquals(u.protokoll.length, 1)

  const doppelt = await fuehreBuecherWerkzeugAus('buch_anlegen', { titel: 'der kleine igel' }, u.ctx)
  assert(doppelt.startsWith('Nicht angelegt'), doppelt)
  assertStringIncludes(doppelt, 'id=buch_1')
  assertStringIncludes(await fuehreBuecherWerkzeugAus('buch_anlegen', { titel: 'Der kleine Igel', doppelt_erlaubt: true }, u.ctx), 'Angelegt')
  assertStringIncludes(await fuehreBuecherWerkzeugAus('buch_anlegen', { titel: '   ' }, u.ctx), 'Fehler')
  assertStringIncludes(await fuehreBuecherWerkzeugAus('buch_anlegen', { titel: 'Y', stufe: 'fertig' }, u.ctx), 'Fehler: Unbekannte Stufe')
})

Deno.test('buch_aendern: schreibt nur geänderte Felder, gleiche Werte bleiben weg, leerer Text löscht', async () => {
  const u = umgebung(grunddaten())
  const r = await fuehreBuecherWerkzeugAus('buch_aendern', { buch_id: 'buch_1', autor: 'Anna Autor', seitenzahl: 32, isbn: '978-3-00-000000-1', reihe: '', ladenpreis: 14.9 }, u.ctx)
  assertStringIncludes(r, 'Geändert: Buch „Der kleine Igel“')
  assertStringIncludes(r, 'ISBN: (leer) → 978-3-00-000000-1')
  assertStringIncludes(r, 'Reihe: Waldgeschichten → (leer)')
  assert(!r.includes('Autor:'))
  const upd = u.geschrieben.find((g) => g.art === 'update')!
  assertEquals(Object.keys(upd.werte).sort(), ['geaendert_am', 'geaendert_von', 'isbn', 'reihe'])
  assertEquals(upd.werte.isbn, '978-3-00-000000-1')
  assertEquals(upd.werte.reihe, null)
  assertEquals(upd.werte.geaendert_von, 'Andreas Mayer')
  assertEquals(u.db.tabellen.buecher[0].autor, 'Anna Autor')
  assertEquals(u.db.tabellen.buecher[0].notizen, 'Erste Notiz', 'nicht genannte Felder bleiben')
})

Deno.test('buch_aendern: nichts Neues → kein Schreiben', async () => {
  const u = umgebung(grunddaten())
  const r = await fuehreBuecherWerkzeugAus('buch_aendern', { buch_id: 'buch_1', autor: 'Anna Autor', stufe: 'lektorat', schritte_erledigt: ['konzept'] }, u.ctx)
  assert(r.startsWith('Nichts geändert'), r)
  assertEquals(u.geschrieben.length, 0)
  assertEquals(u.protokoll.length, 0)
})

Deno.test('buch_aendern: Checkliste ergänzt die vorhandenen Häkchen, Stufe und Notiz anhängen', async () => {
  const u = umgebung(grunddaten())
  const r = await fuehreBuecherWerkzeugAus('buch_aendern', { buch_id: 'buch_1', stufe: 'illustration', schritte_erledigt: ['lektorat_beauftragt', 'Lektorat abgeschlossen'], schritte_offen: ['manuskript_fertig'], notiz_anhaengen: 'Lektorin zufrieden' }, u.ctx)
  assertStringIncludes(r, 'Stufe: Lektorat → Illustration')
  assertStringIncludes(r, 'Notiz angehängt')
  assertStringIncludes(r, 'jetzt 3/')
  const upd = u.geschrieben.find((g) => g.art === 'update')!
  assertEquals(upd.werte.checkliste, { konzept: true, lektorat_beauftragt: true, lektorat_abgeschlossen: true })
  assertEquals(upd.werte.status, 'illustration')
  assertEquals(upd.werte.notizen, 'Erste Notiz\n22.11.2026 (Andreas Mayer): Lektorin zufrieden')
  assertStringIncludes(await fuehreBuecherWerkzeugAus('buch_aendern', { buch_id: 'buch_1', schritte_erledigt: ['gibtsnicht'] }, u.ctx), 'Fehler: Unbekannter Schritt')
})

Deno.test('buch_aendern: Verantwortlicher muss eindeutig sein, „ich“ = Fragender', async () => {
  const u = umgebung(grunddaten())
  assertStringIncludes(await fuehreBuecherWerkzeugAus('buch_aendern', { buch_id: 'buch_1', verantwortlich: 'Niemand' }, u.ctx), 'Fehler: „Niemand“ ist kein eindeutiger Mitarbeiter')
  assertStringIncludes(await fuehreBuecherWerkzeugAus('buch_aendern', { buch_id: 'buch_1', verantwortlich: 'ich' }, u.ctx), 'Verantwortlich: (leer) → Andreas Mayer')
})

// ---------------------------------------------------------------------------------------------
// Reine Hilfen

Deno.test('Hilfen: Zahlen, Stufen, Änderungsberechnung, Checkliste', () => {
  assertEquals(zahlAus('1.200', true), 1200)
  assertEquals(zahlAus('12,90 €', false), 12.9)
  assertEquals(zahlAus('', true), null)
  assertEquals(zahlAus('abc', true), undefined)
  assertEquals(stufeVon('Im Druck'), 'druck')
  assertEquals(stufeVon('satz'), 'satz')
  assertEquals(stufeVon('Veröffentlicht'), 'veroeffentlicht')
  assertEquals(stufeVon('quatsch'), undefined)
  assertEquals(buchAenderungAus({ erscheinungstermin: '31.02.2027' }).fehler?.startsWith('Fehler'), true)
  assertEquals(buchAenderungAus({ erscheinungstermin: '01.03.2027' }).spalten, { erscheinungstermin: '2027-03-01' })
  // ladenpreis als Zahl-Text aus der Datenbank gilt als gleich
  assertEquals(buchAenderungAus({ ladenpreis: 14.9 }, buch({ ladenpreis: '14.90' }) as never).spalten, {})
  assertEquals(checklisteMit({ a: true }, ['isbn'], []).checkliste, { a: true, isbn: true })
})
