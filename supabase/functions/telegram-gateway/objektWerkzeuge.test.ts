// Prüft die Objekt-Werkzeuge mit einer nachgebauten Datenbank und Ablage (ohne Netz): Rechte (Bereich
// Immobilien, private Objekte, privater Assistent), Dubletten beim Anlegen, nur geänderte Spalten beim
// Ändern, Ordner- und Fassungslogik beim Ablegen, Herausnehmen aus der Kundenakte.
import { assert, assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import { findeDublette, freierName, fuehreObjektSchreibWerkzeugAus, istObjektSchreibWerkzeug, leseBetrag, mitEndung, type ObjektKontext, ordnerVon, speicherName, strassenSchluessel } from './objektWerkzeuge.ts'
import type { ObjektRow } from './objektakte.ts'

// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>
type Schreiben = { tabelle: string; art: 'insert' | 'update'; werte: Zeile; id?: string }

/** Nachbildung des Supabase-Clients: select/eq/maybeSingle, insert, update().eq(), Ablage download/upload/remove/getPublicUrl. */
function falscheDb(tabellen: Record<string, Zeile[]>, dateien: Record<string, { bytes: Uint8Array; typ: string }> = {}) {
  const geschrieben: Schreiben[] = []
  const hochgeladen: { eimer: string; pfad: string; typ: string; groesse: number }[] = []
  const entfernt: string[] = []
  function abfrage(tabelle: string) {
    const filter: ((z: Zeile) => boolean)[] = []
    let art: 'select' | 'insert' | 'update' = 'select'
    let werte: Zeile = {}
    const lauf = () => {
      const zeilen = tabellen[tabelle] ?? (tabellen[tabelle] = [])
      if (art === 'insert') {
        zeilen.push(structuredClone(werte))
        geschrieben.push({ tabelle, art, werte: structuredClone(werte) })
        return { data: null, error: null }
      }
      const treffer = zeilen.filter((z) => filter.every((f) => f(z)))
      if (art === 'update') {
        for (const z of treffer) Object.assign(z, structuredClone(werte))
        geschrieben.push({ tabelle, art, werte: structuredClone(werte), id: treffer[0]?.id })
        return { data: null, error: null }
      }
      return { data: structuredClone(treffer), error: null }
    }
    // deno-lint-ignore no-explicit-any
    const b: any = {
      select: () => b,
      // deno-lint-ignore no-explicit-any
      eq: (k: string, v: any) => (filter.push((z) => z[k] === v), b),
      maybeSingle: () => Promise.resolve({ data: lauf().data?.[0] ?? null, error: null }),
      insert: (w: Zeile) => ((art = 'insert'), (werte = w), b),
      update: (w: Zeile) => ((art = 'update'), (werte = w), b),
      // deno-lint-ignore no-explicit-any
      then: (a: any, c: any) => Promise.resolve(lauf()).then(a, c),
    }
    return b
  }
  const supabase = {
    from: (t: string) => abfrage(t),
    storage: {
      from: (eimer: string) => ({
        getPublicUrl: (pfad: string) => ({ data: { publicUrl: `https://projekt.test/storage/v1/object/public/${eimer}/${pfad}` } }),
        download: (pfad: string) => {
          const d = dateien[`${eimer}/${pfad}`]
          return Promise.resolve(d ? { data: new Blob([d.bytes as BlobPart], { type: d.typ }), error: null } : { data: null, error: { message: 'Object not found' } })
        },
        upload: (pfad: string, bytes: Uint8Array, opt: { contentType?: string }) => {
          hochgeladen.push({ eimer, pfad, typ: opt?.contentType ?? '', groesse: bytes.length })
          dateien[`${eimer}/${pfad}`] = { bytes, typ: opt?.contentType ?? '' }
          return Promise.resolve({ data: { path: pfad }, error: null })
        },
        remove: (pfade: string[]) => (entfernt.push(...pfade), Promise.resolve({ data: null, error: null })),
      }),
    },
  }
  return { supabase, geschrieben, hochgeladen, entfernt, tabellen }
}

const GF = { name: 'Andreas Mayer', email: 'andreas@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }
const QUIRIN = { name: 'Quirin Lutzenberger', email: 'quirin@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }
const BERATER = { name: 'Bea Berater', email: 'bea@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }
const HASAN_PRIVAT = { name: 'Hasan Privat', email: 'Hasan@Privat.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], nurPrivat: true }

function kontext(db: ReturnType<typeof falscheDb>, mitarbeiter: ObjektKontext['mitarbeiter']): ObjektKontext & { protokoll: string[] } {
  const protokoll: string[] = []
  return { supabase: db.supabase, mitarbeiter, protokolliere: (t) => protokoll.push(t), heute: '2026-11-22', protokoll }
}

function objekt(z: Zeile): Zeile {
  return { gruppe: 'aktuell', typ: 'Haus', kaufpreis: 0, prioritaet: 'Mittel', status: 'akquise', follow_up: { date: '2026-11-01', note: 'Objekt aufgenommen', done: false }, verantwortlich: 'Quirin Lutzenberger', activities: [], dokumente: {}, eigentuemer: null, off_market: false, privat_besitzer: null, ...z }
}

function stand() {
  return {
    objekte: [
      objekt({ id: 'o_lorch', bezeichnung: 'MFH Lorch', adresse: 'Teckstr. 62, 73547 Lorch', kaufpreis: 1200000, activities: [{ id: 'a0', date: '2026-11-01', text: 'Objekt angelegt', user: 'Quirin Lutzenberger' }], dokumente: { 'Exposé': [{ id: 'd_alt', name: 'Exposé.pdf', typ: 'application/pdf', datum: '2026-11-01', groesse: '1 MB', url: 'o_lorch/d_alt_Expose.pdf' }] } }),
      objekt({ id: 'o_privat_carl', bezeichnung: 'Villa Carl', adresse: 'Seeweg 1, 89073 Ulm', privat_besitzer: 'carl@mayer.de', verantwortlich: 'Carl' }),
      objekt({ id: 'o_privat_hasan', bezeichnung: 'Ferienwohnung Hasan', adresse: 'Strandweg 3, 23570 Lübeck', privat_besitzer: 'hasan@privat.de', verantwortlich: 'Hasan Privat' }),
    ],
    kunden: [
      { id: 'k_dick', bereich: 'immobilienkunden', firma: 'HD-IMMO', ansprechpartner: 'Helmut Dick', verantwortlich_email: null, activities: [], dokumente: [{ id: 'kd1', name: 'Prospekt Boarding House.pdf', typ: 'application/pdf', datum: '2026-11-22', groesse: '2 MB', url: 'k_dick/dok_1_Prospekt.pdf' }, { id: 'kd2', name: 'Visitenkarte.jpg', typ: 'image/jpeg', datum: '2026-11-22', groesse: '1 KB', url: 'k_dick/dok_2_Visitenkarte.jpg' }] },
      { id: 'k_beratung', bereich: 'beratung', firma: 'Beratungskunde GmbH', ansprechpartner: '', verantwortlich_email: null, activities: [], dokumente: [{ id: 'kb1', name: 'Bilanz.pdf', typ: 'application/pdf', datum: '2026-11-22', groesse: '1 MB', url: 'k_beratung/dok_b_Bilanz.pdf' }] },
      { id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: 'Ungeklärte Eingänge', ansprechpartner: 'Ungeklärte Eingänge', verantwortlich_email: null, activities: [], dokumente: [{ id: 'u1', name: 'Grundbuch Lorch.pdf', typ: 'application/pdf', datum: '2026-11-22', groesse: '1 MB', url: 'https://projekt.test/storage/v1/object/public/email-anhaenge/telegram/1763800000000_Grundbuch_Lorch.pdf' }] },
    ],
    mitarbeiter: [
      { name: 'Andreas Mayer', aktiv: true },
      { name: 'Quirin Lutzenberger', aktiv: true },
      { name: 'Bea Berater', aktiv: true },
    ],
  }
}

function dateien() {
  const pdf = (n: number) => ({ bytes: new Uint8Array(n).fill(1), typ: 'application/pdf' })
  return {
    'email-anhaenge/telegram/1763800000000_h0123456789ab_Expose_Boarding_House.pdf': pdf(2048),
    'email-anhaenge/telegram/1763800000000_Grundbuch_Lorch.pdf': pdf(1500),
    'kunden-dokumente/k_dick/dok_1_Prospekt.pdf': pdf(4096),
    'kunden-dokumente/k_dick/dok_2_Visitenkarte.jpg': { bytes: new Uint8Array(500), typ: 'image/jpeg' },
    'kunden-dokumente/k_beratung/dok_b_Bilanz.pdf': pdf(100),
  }
}

// ---------- reine Hilfen ----------

Deno.test('Werkzeugnamen', () => {
  assert(istObjektSchreibWerkzeug('objekt_anlegen') && istObjektSchreibWerkzeug('objekt_aendern') && istObjektSchreibWerkzeug('dateien_ins_objekt'))
  assert(!istObjektSchreibWerkzeug('objekte_suchen'))
})

Deno.test('Straßenschlüssel: Schreibweisen von Straße und Hausnummer', () => {
  assertEquals(strassenSchluessel('Teckstraße 62, 73547 Lorch'), 'teckstr62')
  assertEquals(strassenSchluessel('Teckstr. 62'), 'teckstr62')
  assertEquals(strassenSchluessel('Hauptstr. 5 a, 89073 Ulm'), 'hauptstr5a')
  assertEquals(strassenSchluessel('73547 Lorch, Teckstraße 62'), 'teckstr62')
  assertEquals(strassenSchluessel('73547 Lorch'), '')
})

Deno.test('Kaufpreis aus Text', () => {
  assertEquals(leseBetrag('1.200.000 €'), 1200000)
  assertEquals(leseBetrag('1,2 Mio'), 1200000)
  assertEquals(leseBetrag('950 Tsd.'), 950000)
  assertEquals(leseBetrag(1200000), 1200000)
  assertEquals(leseBetrag('1.200.000,00 EUR'), 1200000)
  assertEquals(leseBetrag('auf Anfrage'), undefined)
})

Deno.test('Speichername ohne Umlaute, Fassungen, Endung, Ordner', () => {
  assertEquals(speicherName('Exposé Boarding House Größe.pdf'), 'Expose_Boarding_House_Groesse.pdf')
  assertEquals(speicherName('../../geheim'), 'geheim')
  assertEquals(freierName('Exposé.pdf', [{ name: 'Exposé.pdf' }]), 'Exposé (2).pdf')
  assertEquals(freierName('Exposé.pdf', [{ name: 'Exposé.pdf' }, { name: 'exposé (2).pdf' }]), 'Exposé (3).pdf')
  assertEquals(freierName('Neu.pdf', [{ name: 'Exposé.pdf' }]), 'Neu.pdf')
  assertEquals(mitEndung('Exposé Remstal', 'scan.pdf'), 'Exposé Remstal.pdf')
  assertEquals(mitEndung('', 'scan.pdf'), 'scan.pdf')
  assertEquals(ordnerVon('Expose'), 'Exposé')
  assertEquals(ordnerVon('grundbuch'), 'Grundbuch')
  assertEquals(ordnerVon('Prospekte'), undefined)
})

Deno.test('Dublette: gleiche Straße/Hausnummer, gleiche Bezeichnung; andere PLZ nicht', () => {
  const o = stand().objekte as unknown as ObjektRow[]
  assertEquals(findeDublette(o, { bezeichnung: 'Boarding House Remstal', adresse: 'Teckstraße 62, 73547 Lorch' })?.id, 'o_lorch')
  assertEquals(findeDublette(o, { bezeichnung: 'mfh lorch', adresse: '' })?.id, 'o_lorch')
  assertEquals(findeDublette(o, { bezeichnung: 'Anderes Haus', adresse: 'Teckstraße 62, 70173 Stuttgart' }), undefined)
  // Tippfehler im Straßennamen: über sucheObjekte, gleiche PLZ und Hausnummer.
  assertEquals(findeDublette(o, { bezeichnung: 'Boarding House', adresse: 'Tekstrasse 62, 73547 Lorch' })?.id, 'o_lorch')
})

// ---------- objekt_anlegen ----------

Deno.test('Anlegen: ohne Immobilien-Rechte nicht freigegeben, nichts geschrieben', async () => {
  const db = falscheDb(stand())
  const r = await fuehreObjektSchreibWerkzeugAus('objekt_anlegen', { bezeichnung: 'Boarding House Remstal', typ: 'Gewerbe' }, kontext(db, BERATER))
  assertMatch(r, /^Nicht freigegeben/)
  assertEquals(db.geschrieben.length, 0)
})

Deno.test('Anlegen: Dublette wird abgelehnt, mit trotzdem angelegt', async () => {
  const db = falscheDb(stand())
  const k = kontext(db, GF)
  const eingabe = { bezeichnung: 'Boarding House Remstal', adresse: 'Teckstraße 62, 73547 Lorch', typ: 'Gewerbe', kaufpreis: '1.200.000 €' }
  const r1 = await fuehreObjektSchreibWerkzeugAus('objekt_anlegen', eingabe, k)
  assertMatch(r1, /^Nicht angelegt/)
  assertStringIncludes(r1, 'objekt_id=o_lorch')
  assertStringIncludes(r1, 'trotzdem=true')
  assertEquals(db.geschrieben.length, 0)
  const r2 = await fuehreObjektSchreibWerkzeugAus('objekt_anlegen', { ...eingabe, trotzdem: true }, k)
  assertMatch(r2, /^Angelegt/)
  assertEquals(db.geschrieben.length, 1)
})

Deno.test('Anlegen: Felder wie im CRM, Anbieter im Verlauf, verantwortlich = Aufrufer', async () => {
  const db = falscheDb(stand())
  const k = kontext(db, GF)
  const r = await fuehreObjektSchreibWerkzeugAus('objekt_anlegen', {
    bezeichnung: 'Boarding House Remstal',
    adresse: 'Lindenweg 4, 73547 Lorch',
    typ: 'Gewerbe',
    kaufpreis: '1.200.000 €',
    anbieter: { art: 'Makler', name: 'Helmut Dick', firma: 'HD-IMMO', telefon: '07172 123' },
    notiz: '14 Apartments',
  }, k)
  assertMatch(r, /^Angelegt: Objektakte „Boarding House Remstal“/)
  assertStringIncludes(r, '1.200.000 €')
  const z = db.geschrieben[0].werte
  assertEquals(db.geschrieben[0].tabelle, 'objekte')
  assertMatch(r, new RegExp(`objekt_id=${z.id}$`))
  assertMatch(z.id, /^o_[0-9a-f]{12}$/)
  assertEquals([z.status, z.gruppe, z.prioritaet, z.typ, z.kaufpreis, z.verantwortlich, z.privat_besitzer], ['akquise', 'aktuell', 'Mittel', 'Gewerbe', 1200000, 'Andreas Mayer', null])
  assertEquals(z.follow_up, { date: '2026-11-22', note: 'Objekt aufgenommen', done: false })
  assertEquals(z.dokumente, {})
  assertEquals(z.activities.length, 1)
  assertEquals(Object.keys(z.activities[0]).sort(), ['date', 'id', 'text', 'user'])
  assertStringIncludes(z.activities[0].text, 'Angeboten von Makler Helmut Dick (HD-IMMO), Tel. 07172 123.')
  assertStringIncludes(z.activities[0].text, 'Notiz: 14 Apartments')
  assert(!('eigentuemer' in z), 'ohne Eigentümer keine leere Eigentümer-Angabe')
  assertEquals(k.protokoll.length, 1)
})

Deno.test('Anlegen: fremder Verantwortlicher muss aktiver Mitarbeiter sein', async () => {
  const db = falscheDb(stand())
  const r = await fuehreObjektSchreibWerkzeugAus('objekt_anlegen', { bezeichnung: 'Neu', typ: 'Haus', verantwortlich: 'Quirin' }, kontext(db, GF))
  assertMatch(r, /verantwortlich Quirin Lutzenberger/)
  const r2 = await fuehreObjektSchreibWerkzeugAus('objekt_anlegen', { bezeichnung: 'Neu 2', typ: 'Haus', verantwortlich: 'Niemand' }, kontext(db, GF))
  assertMatch(r2, /^Fehler: „Niemand“ ist kein aktiver Mitarbeiter/)
})

Deno.test('Anlegen im privaten Assistenten: privates Objekt mit eigener Adresse (klein); private Objekte anderer zählen nicht als Dublette', async () => {
  const db = falscheDb(stand())
  const r = await fuehreObjektSchreibWerkzeugAus('objekt_anlegen', { bezeichnung: 'Villa Carl', adresse: 'Seeweg 1, 89073 Ulm', typ: 'Haus' }, kontext(db, HASAN_PRIVAT))
  assertMatch(r, /^Angelegt/)
  assertStringIncludes(r, 'Privat')
  assert(!r.includes('o_privat_carl'))
  assertEquals(db.geschrieben[0].werte.privat_besitzer, 'hasan@privat.de')
  // Die eigene private Wohnung ist eine Dublette, die Holding-Objekte gibt es für ihn nicht.
  const r2 = await fuehreObjektSchreibWerkzeugAus('objekt_anlegen', { bezeichnung: 'FeWo', adresse: 'Strandweg 3, 23570 Lübeck', typ: 'Wohnung' }, kontext(db, HASAN_PRIVAT))
  assertStringIncludes(r2, 'objekt_id=o_privat_hasan')
  const r3 = await fuehreObjektSchreibWerkzeugAus('objekt_anlegen', { bezeichnung: 'MFH Lorch', adresse: 'Teckstraße 62, 73547 Lorch', typ: 'Haus' }, kontext(db, HASAN_PRIVAT))
  assertMatch(r3, /^Angelegt/)
})

// ---------- objekt_aendern ----------

Deno.test('Ändern: nur geänderte Spalten, Verlauf beschreibt die Änderung', async () => {
  const db = falscheDb(stand())
  const k = kontext(db, QUIRIN)
  const r = await fuehreObjektSchreibWerkzeugAus('objekt_aendern', { objekt_id: 'o_lorch', status: 'vermarktung', kaufpreis: 1200000, bezeichnung: 'MFH Lorch', follow_up_datum: '28.11.2026' }, k)
  assertMatch(r, /^Bei „MFH Lorch“/)
  assertStringIncludes(r, 'objekt_id=o_lorch')
  assertEquals(db.geschrieben.length, 1)
  const w = db.geschrieben[0].werte
  assertEquals(Object.keys(w).sort(), ['activities', 'follow_up', 'status', 'updated_at'])
  assertEquals(w.status, 'vermarktung')
  assertEquals(w.follow_up, { date: '2026-11-28', note: 'Objekt aufgenommen', done: false })
  assertStringIncludes(w.activities[0].text, 'Status: Akquise → Aktiv in Vermarktung')
  assertEquals(w.activities[0].user, 'Quirin Lutzenberger')
  assertEquals(w.activities.length, 2, 'alter Verlauf bleibt dahinter erhalten')
})

Deno.test('Ändern: nichts anders → kein Schreiben; Eigentümer nur genannte Teile', async () => {
  const db = falscheDb(stand())
  const k = kontext(db, GF)
  const r = await fuehreObjektSchreibWerkzeugAus('objekt_aendern', { objekt_id: 'o_lorch', status: 'akquise', kaufpreis: '1,2 Mio' }, k)
  assertMatch(r, /^Nichts geändert/)
  assertEquals(db.geschrieben.length, 0)
  await fuehreObjektSchreibWerkzeugAus('objekt_aendern', { objekt_id: 'o_lorch', eigentuemer: { name: 'Erika Muster' } }, k)
  assertEquals(db.geschrieben[0].werte.eigentuemer, { name: 'Erika Muster', telefon: '', email: '' })
  await fuehreObjektSchreibWerkzeugAus('objekt_aendern', { objekt_id: 'o_lorch', eigentuemer: { telefon: '0731 1' } }, k)
  assertEquals(db.geschrieben[1].werte.eigentuemer, { name: 'Erika Muster', telefon: '0731 1', email: '' })
})

Deno.test('Ändern: Rechte — fremder Bereich, fremdes privates Objekt, privater Assistent', async () => {
  const db = falscheDb(stand())
  assertMatch(await fuehreObjektSchreibWerkzeugAus('objekt_aendern', { objekt_id: 'o_lorch', status: 'archiv' }, kontext(db, BERATER)), /^Nicht freigegeben/)
  // Auch die Geschäftsführung sieht private Objekte anderer nicht.
  assertMatch(await fuehreObjektSchreibWerkzeugAus('objekt_aendern', { objekt_id: 'o_privat_carl', status: 'archiv' }, kontext(db, GF)), /^Fehler: Es gibt kein Objekt/)
  assertMatch(await fuehreObjektSchreibWerkzeugAus('objekt_aendern', { objekt_id: 'o_lorch', status: 'archiv' }, kontext(db, HASAN_PRIVAT)), /^Fehler: Es gibt kein Objekt/)
  assertMatch(await fuehreObjektSchreibWerkzeugAus('objekt_aendern', { objekt_id: 'o_privat_hasan', status: 'archiv' }, kontext(db, HASAN_PRIVAT)), /geändert/)
  assertMatch(await fuehreObjektSchreibWerkzeugAus('objekt_aendern', { objekt_id: 'o_privat_hasan', verantwortlich: 'Andreas Mayer' }, kontext(db, HASAN_PRIVAT)), /^Nicht geändert/)
  assertEquals(db.geschrieben.length, 1)
})

// ---------- dateien_ins_objekt ----------

Deno.test('Ablegen: Telegram-Datei kopiert, gleicher Name als weitere Fassung, sicherer Speicherpfad, zweites Mal „liegt bereits“', async () => {
  const db = falscheDb(stand(), dateien())
  const k = kontext(db, QUIRIN)
  const r = await fuehreObjektSchreibWerkzeugAus('dateien_ins_objekt', { objekt_id: 'o_lorch', dateien: [{ pfad: 'telegram/1763800000000_h0123456789ab_Expose_Boarding_House.pdf', ordner: 'Exposé', name: 'Exposé' }] }, k)
  assertMatch(r, /^In die Objektakte „MFH Lorch“/)
  assertStringIncludes(r, 'Exposé (2).pdf (Ordner Exposé, weitere Fassung)')
  assertStringIncludes(r, 'objekt_id=o_lorch')
  assertEquals(db.hochgeladen.length, 1)
  const h = db.hochgeladen[0]
  assertEquals(h.eimer, 'objekt-dokumente')
  assertMatch(h.pfad, /^o_lorch\/dok_[0-9a-f]{12}_Expose\.pdf$/, 'eigene Kennung je Datei, Name ohne Umlaut')
  assertEquals([h.typ, h.groesse], ['application/pdf', 2048])
  const w = db.geschrieben.find((x) => x.tabelle === 'objekte')!.werte
  assertEquals(Object.keys(w).sort(), ['activities', 'dokumente', 'updated_at'])
  assertEquals(w.dokumente['Exposé'].map((d: Zeile) => d.name), ['Exposé (2).pdf', 'Exposé.pdf'])
  const neu = w.dokumente['Exposé'][0]
  assertEquals([neu.url, neu.datum, neu.groesse, neu.typ], [h.pfad, '2026-11-22', '2 KB', 'application/pdf'])
  assertEquals(neu.herkunft, 'https://projekt.test/storage/v1/object/public/email-anhaenge/telegram/1763800000000_h0123456789ab_Expose_Boarding_House.pdf')
  const r2 = await fuehreObjektSchreibWerkzeugAus('dateien_ins_objekt', { objekt_id: 'o_lorch', dateien: [{ pfad: 'telegram/1763800000000_h0123456789ab_Expose_Boarding_House.pdf', ordner: 'Exposé' }] }, k)
  assertStringIncludes(r2, 'liegt bereits in dieser Objektakte')
  assertEquals(db.hochgeladen.length, 1)
})

Deno.test('Ablegen: Telegram-Datei aus „Ungeklärte Eingänge“ zieht um; ungültiger Pfad und Ordner werden gemeldet', async () => {
  const db = falscheDb(stand(), dateien())
  const r = await fuehreObjektSchreibWerkzeugAus('dateien_ins_objekt', {
    objekt_id: 'o_lorch',
    dateien: [
      { pfad: 'telegram/1763800000000_Grundbuch_Lorch.pdf', ordner: 'Grundbuch' },
      { pfad: '../kunden-dokumente/x.pdf', ordner: 'Grundbuch' },
      { pfad: 'telegram/1763800000000_Grundbuch_Lorch.pdf', ordner: 'Prospekte' },
      { pfad: 'telegram/gibtsnicht.pdf', ordner: 'Sonstiges' },
    ],
  }, kontext(db, QUIRIN))
  assertStringIncludes(r, 'Grundbuch_Lorch.pdf (Ordner Grundbuch)')
  assertStringIncludes(r, 'kein gültiger Pfad')
  assertStringIncludes(r, 'Ordner „Prospekte“ gibt es in der Objektakte nicht')
  assertStringIncludes(r, 'gibt es in der Ablage nicht')
  assertEquals(db.tabellen.kunden.find((x) => x.id === 'k_eingang_ungeklaert')!.dokumente.length, 0)
})

Deno.test('Ablegen aus der Kundenakte: kopiert, auf Wunsch dort herausgenommen (nur der Eintrag), Verlauf in beiden Akten', async () => {
  const db = falscheDb(stand(), dateien())
  const k = kontext(db, QUIRIN)
  const r = await fuehreObjektSchreibWerkzeugAus('dateien_ins_objekt', {
    objekt_id: 'o_lorch',
    dateien: [{ kunde_id: 'k_dick', dokument_id: 'kd1', ordner: 'Exposé' }],
    aus_kundenakte_entfernen: true,
  }, k)
  assertStringIncludes(r, 'Prospekt Boarding House.pdf (Ordner Exposé)')
  assertStringIncludes(r, 'Aus der Akte von HD-IMMO (Helmut Dick) genommen')
  assertMatch(db.hochgeladen[0].pfad, /^o_lorch\/dok_[0-9a-f]{12}_Prospekt_Boarding_House\.pdf$/)
  const akte = db.tabellen.kunden.find((x) => x.id === 'k_dick')!
  assertEquals(akte.dokumente.map((d: Zeile) => d.id), ['kd2'])
  assertStringIncludes(akte.activities[0].text, 'in die Objektakte „MFH Lorch“')
  const kundenUpdate = db.geschrieben.find((x) => x.tabelle === 'kunden')!.werte
  assertEquals(Object.keys(kundenUpdate).sort(), ['activities', 'dokumente'])
  // Die Datei der Kundenakte wird nicht gelöscht.
  assertEquals(db.entfernt.length, 0)
})

Deno.test('Ablegen: ohne aus_kundenakte_entfernen bleibt das Dokument in der Kundenakte', async () => {
  const db = falscheDb(stand(), dateien())
  await fuehreObjektSchreibWerkzeugAus('dateien_ins_objekt', { objekt_id: 'o_lorch', dateien: [{ kunde_id: 'k_dick', dokument_id: 'kd1', ordner: 'Exposé' }] }, kontext(db, QUIRIN))
  assertEquals(db.tabellen.kunden.find((x) => x.id === 'k_dick')!.dokumente.length, 2)
  assertEquals(db.geschrieben.filter((x) => x.tabelle === 'kunden').length, 0)
})

Deno.test('Ablegen: Rechte — Kundenakte aus fremdem Bereich, Objekt ohne Rechte', async () => {
  const db = falscheDb(stand(), dateien())
  const r = await fuehreObjektSchreibWerkzeugAus('dateien_ins_objekt', { objekt_id: 'o_lorch', dateien: [{ kunde_id: 'k_beratung', dokument_id: 'kb1', ordner: 'Sonstiges' }] }, kontext(db, QUIRIN))
  assertStringIncludes(r, 'Nicht freigegeben: Der Bereich Unternehmensberatung')
  assertStringIncludes(r, 'Nichts in die Objektakte')
  assertEquals(db.hochgeladen.length, 0)
  assertMatch(await fuehreObjektSchreibWerkzeugAus('dateien_ins_objekt', { objekt_id: 'o_lorch', dateien: [{ kunde_id: 'k_beratung', dokument_id: 'kb1', ordner: 'Sonstiges' }] }, kontext(db, BERATER)), /^Nicht freigegeben/)
  assertMatch(await fuehreObjektSchreibWerkzeugAus('dateien_ins_objekt', { objekt_id: 'o_privat_carl', dateien: [{ kunde_id: 'k_dick', dokument_id: 'kd1', ordner: 'Exposé' }] }, kontext(db, GF)), /^Fehler: Es gibt kein Objekt/)
  assertEquals(db.geschrieben.length, 0)
})
