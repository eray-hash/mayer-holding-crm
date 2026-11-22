// Prüft die Datei-Werkzeuge (verschieben, umbenennen, löschen, an Kollegen schicken) mit einer
// nachgebauten Datenbank, Ablage und Telegram — ohne Netz. Schwerpunkte: Rechte von Quelle, Ziel und
// Empfänger, nur geänderte Spalten, Verlauf in beiden Akten, „aussortiert“ statt Löschen.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { aussortierZiel, behalteEndung, type DateiKontext, dateiOrtVon, fuehreDateiVerwaltungAus, istDateiVerwaltungsWerkzeug, type MailAuftrag } from './dateiVerwaltung.ts'

// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

// Volle Adressen der eigenen Ablage werden nur erkannt, wenn sie zum Projekt gehören (speicherPfad.ts).
Deno.env.set('SUPABASE_URL', 'https://projekt.test')

function falscheDb(tabellen: Record<string, Zeile[]>, dateien: Record<string, { bytes: Uint8Array; typ: string }>) {
  const geschrieben: { tabelle: string; werte: Zeile; id?: string }[] = []
  const verschoben: { eimer: string; von: string; nach: string }[] = []
  const hochgeladen: string[] = []
  const entfernt: string[] = []
  function abfrage(tabelle: string) {
    const filter: ((z: Zeile) => boolean)[] = []
    let art: 'select' | 'update' = 'select'
    let werte: Zeile = {}
    const lauf = () => {
      const zeilen = tabellen[tabelle] ?? (tabellen[tabelle] = [])
      const treffer = zeilen.filter((z) => filter.every((f) => f(z)))
      if (art === 'update') {
        for (const z of treffer) Object.assign(z, structuredClone(werte))
        geschrieben.push({ tabelle, werte: structuredClone(werte), id: treffer[0]?.id })
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
          hochgeladen.push(`${eimer}/${pfad}`)
          dateien[`${eimer}/${pfad}`] = { bytes, typ: opt?.contentType ?? '' }
          return Promise.resolve({ data: { path: pfad }, error: null })
        },
        move: (von: string, nach: string) => {
          const d = dateien[`${eimer}/${von}`]
          if (!d) return Promise.resolve({ data: null, error: { message: 'Object not found' } })
          delete dateien[`${eimer}/${von}`]
          dateien[`${eimer}/${nach}`] = d
          verschoben.push({ eimer, von, nach })
          return Promise.resolve({ data: null, error: null })
        },
        remove: (pfade: string[]) => (entfernt.push(...pfade.map((p) => `${eimer}/${p}`)), Promise.resolve({ data: null, error: null })),
      }),
    },
  }
  return { supabase, geschrieben, verschoben, hochgeladen, entfernt, tabellen, dateien }
}

const GF = { name: 'Andreas Mayer', email: 'andreas@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }
const QUIRIN = { name: 'Quirin Lutzenberger', email: 'quirin@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }
const BEA = { name: 'Bea Berater', email: 'bea@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }

const URL_TG = 'https://projekt.test/storage/v1/object/public/email-anhaenge/telegram/1763800000000_Scan.pdf'

function stand() {
  return {
    kunden: [
      { id: 'k_a', bereich: 'beratung', firma: 'Alpha GmbH', ansprechpartner: '', verantwortlich_email: null, activities: [{ id: 'x', date: '2026-11-01', text: 'alt', user: 'X' }], dokumente: [
        { id: 'd1', name: 'Vertrag Alpha.pdf', typ: 'application/pdf', datum: '2026-11-20', groesse: '1 KB', url: 'k_a/dok_1_Vertrag.pdf' },
        { id: 'd2', name: 'Ausweis Müller.jpg', typ: 'image/jpeg', datum: '2026-11-20', groesse: '1 KB', url: 'k_a/dok_2_Ausweis.jpg' },
      ] },
      { id: 'k_b', bereich: 'beratung', firma: 'Beta AG', ansprechpartner: 'Herr Beta', verantwortlich_email: null, activities: [], dokumente: [{ id: 'b1', name: 'Vertrag Alpha.pdf', typ: 'application/pdf', datum: '2026-11-01', groesse: '1 KB', url: 'k_b/dok_x_Vertrag.pdf' }] },
      { id: 'k_immo', bereich: 'immobilienkunden', firma: 'Immo Kunde', ansprechpartner: '', verantwortlich_email: null, activities: [], dokumente: [{ id: 'i1', name: 'Exposé Lorch.pdf', typ: 'application/pdf', datum: '2026-11-20', groesse: '2 KB', url: 'k_immo/dok_i_Expose.pdf' }] },
      { id: 'k_priv_carl', bereich: 'privat', firma: 'Carls Kontakt', ansprechpartner: '', verantwortlich_email: 'carl@mayer.de', activities: [], dokumente: [{ id: 'p1', name: 'Privat.pdf', typ: 'application/pdf', datum: '2026-11-20', groesse: '1 KB', url: 'k_priv_carl/dok_p.pdf' }] },
      { id: 'k_priv_andreas', bereich: 'privat', firma: 'Andreas privat', ansprechpartner: '', verantwortlich_email: 'andreas@mayer.de', activities: [], dokumente: [{ id: 'pa1', name: 'Notiz.pdf', typ: 'application/pdf', datum: '2026-11-20', groesse: '1 KB', url: 'k_priv_andreas/dok_n.pdf' }] },
      { id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: 'Ungeklärte Eingänge', ansprechpartner: 'Ungeklärte Eingänge', verantwortlich_email: null, activities: [], dokumente: [{ id: 'u1', name: 'Scan.pdf', typ: 'application/pdf', datum: '2026-11-21', groesse: '1 KB', url: URL_TG }] },
      { id: 'k_intern_holding', bereich: 'beratung', firma: 'Unterlagen des Hauses', ansprechpartner: '', verantwortlich_email: null, activities: [], dokumente: [] },
    ],
    objekte: [
      { id: 'o_lorch', bezeichnung: 'MFH Lorch', adresse: 'Teckstr. 62, 73547 Lorch', privat_besitzer: null, activities: [], interessenten_dokumente: ['od1', 'od9'], dokumente: {
        'Grundbuch': [{ id: 'od1', name: 'Grundbuch Lorch.pdf', typ: 'application/pdf', datum: '2026-11-10', groesse: '3 KB', url: 'o_lorch/od1_Grundbuch.pdf' }],
        'Exposé': [{ id: 'od2', name: 'Exposé.pdf', typ: 'application/pdf', datum: '2026-11-10', groesse: '3 KB', url: 'o_lorch/od2_Expose.pdf' }],
      } },
      { id: 'o_ulm', bezeichnung: 'Haus Ulm', adresse: '', privat_besitzer: null, activities: [], dokumente: {} },
    ],
    mitarbeiter: [
      { id: 'm1', name: 'Andreas Mayer', email: 'andreas@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], telegram_chat_id: 1001, aktiv: true },
      { id: 'm2', name: 'Quirin Lutzenberger', email: 'quirin@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'], telegram_chat_id: 1002, aktiv: true },
      { id: 'm3', name: 'Bea Berater', email: 'bea@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'], telegram_chat_id: null, aktiv: true },
      { id: 'm4', name: 'Carl Privat', email: 'carl@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], telegram_chat_id: 1004, aktiv: true },
    ],
  }
}

function dateien() {
  const pdf = (s: string) => ({ bytes: new TextEncoder().encode(s), typ: 'application/pdf' })
  return {
    'kunden-dokumente/k_a/dok_1_Vertrag.pdf': pdf('VERTRAG'),
    'kunden-dokumente/k_a/dok_2_Ausweis.jpg': { bytes: new TextEncoder().encode('AUSWEIS'), typ: 'image/jpeg' },
    'kunden-dokumente/k_b/dok_x_Vertrag.pdf': pdf('ANDERER'),
    'kunden-dokumente/k_immo/dok_i_Expose.pdf': pdf('EXPOSE'),
    'kunden-dokumente/k_priv_carl/dok_p.pdf': pdf('P'),
    'kunden-dokumente/k_priv_andreas/dok_n.pdf': pdf('N'),
    'email-anhaenge/telegram/1763800000000_Scan.pdf': pdf('SCAN'),
    'objekt-dokumente/o_lorch/od1_Grundbuch.pdf': pdf('GRUNDBUCH'),
    'objekt-dokumente/o_lorch/od2_Expose.pdf': pdf('EXPOSE2'),
  }
}

function kontext(db: ReturnType<typeof falscheDb>, mitarbeiter: DateiKontext['mitarbeiter'], mehr: Partial<DateiKontext> = {}): DateiKontext & { protokoll: string[] } {
  const protokoll: string[] = []
  return { supabase: db.supabase, mitarbeiter, protokolliere: (t) => protokoll.push(t), heute: '2026-11-22', botToken: null, protokoll, ...mehr }
}

const kunde = (db: ReturnType<typeof falscheDb>, id: string) => db.tabellen.kunden.find((k) => k.id === id)!
const objekt = (db: ReturnType<typeof falscheDb>, id: string) => db.tabellen.objekte.find((o) => o.id === id)!

// ---------- reine Hilfen ----------

Deno.test('Werkzeugnamen', () => {
  for (const n of ['datei_verschieben', 'datei_umbenennen', 'datei_loeschen', 'datei_an_kollegen']) assert(istDateiVerwaltungsWerkzeug(n))
  assert(!istDateiVerwaltungsWerkzeug('datei_senden'))
})

Deno.test('Endung bleibt, andere bekannte Endung wird ersetzt', () => {
  assertEquals(behalteEndung('Mietvertrag 2024', 'scan_123.pdf'), 'Mietvertrag 2024.pdf')
  assertEquals(behalteEndung('Mietvertrag.PDF', 'scan.pdf'), 'Mietvertrag.PDF')
  assertEquals(behalteEndung('Mietvertrag.docx', 'scan.pdf'), 'Mietvertrag.pdf')
  assertEquals(behalteEndung('Fassung 1.2', 'brief.docx'), 'Fassung 1.2.docx')
  assertEquals(behalteEndung('a/b', 'x'), 'a b')
})

Deno.test('Speicherort und Ziel „aussortiert“', () => {
  assertEquals(dateiOrtVon('o_lorch/od1.pdf', true), { eimer: 'objekt-dokumente', pfad: 'o_lorch/od1.pdf' })
  assertEquals(dateiOrtVon('k_a/dok.pdf', false), { eimer: 'kunden-dokumente', pfad: 'k_a/dok.pdf' })
  assertEquals(dateiOrtVon('o/../x', true), null)
  assertEquals(aussortierZiel({ eimer: 'kunden-dokumente', pfad: 'k_a/dok_1.pdf' }, 'k_a'), 'k_a/aussortiert/dok_1.pdf')
  assertEquals(aussortierZiel({ eimer: 'objekt-dokumente', pfad: 'o_lorch/x/y.pdf' }, 'o_lorch'), 'o_lorch/aussortiert/x/y.pdf')
  assertEquals(aussortierZiel({ eimer: 'email-anhaenge', pfad: 'telegram/1_a.pdf' }, 'egal'), 'telegram-aussortiert/1_a.pdf')
  assertEquals(aussortierZiel({ eimer: 'email-anhaenge', pfad: 'mail123/a.pdf' }, 'k_a'), null)
  assertEquals(aussortierZiel({ eimer: 'kunden-dokumente', pfad: 'k_b/dok.pdf' }, 'k_a'), null)
  assertEquals(aussortierZiel({ eimer: 'kunden-dokumente', pfad: 'k_a/aussortiert/dok.pdf' }, 'k_a'), null)
  assertEquals(aussortierZiel({ eimer: 'postfach-anhaenge', pfad: 'k_a/a.pdf' }, 'k_a'), null)
})

// ---------- datei_verschieben ----------

Deno.test('verschieben Kunde → Kunde: Datei zieht in den Ordner der Zielakte, alte aussortiert, Verlauf in beiden, gleicher Name als (2)', async () => {
  const db = falscheDb(stand(), dateien())
  const k = kontext(db, BEA)
  const aus = await fuehreDateiVerwaltungAus('datei_verschieben', { von_kunde_id: 'k_a', dokument_id: 'd1', nach_kunde_id: 'k_b', begruendung: 'Gehört zu Beta.' }, k)
  assertStringIncludes(aus, 'Verschoben: „Vertrag Alpha (2).pdf“ liegt jetzt in der Akte Beta AG (Herr Beta)')
  const a = kunde(db, 'k_a')
  const b = kunde(db, 'k_b')
  assertEquals(a.dokumente.map((d: Zeile) => d.id), ['d2'])
  assertEquals(b.dokumente[0].id, 'd1')
  assertEquals(b.dokumente[0].name, 'Vertrag Alpha (2).pdf')
  assert(b.dokumente[0].url.startsWith('k_b/dok_'), b.dokumente[0].url)
  assertEquals(new TextDecoder().decode(db.dateien[`kunden-dokumente/${b.dokumente[0].url}`].bytes), 'VERTRAG')
  assertEquals(db.verschoben, [{ eimer: 'kunden-dokumente', von: 'k_a/dok_1_Vertrag.pdf', nach: 'k_a/aussortiert/dok_1_Vertrag.pdf' }])
  assertStringIncludes(b.activities[0].text, 'aus der Akte Alpha GmbH hierher verschoben: „Vertrag Alpha (2).pdf“ — Grund: Gehört zu Beta')
  assertStringIncludes(a.activities[0].text, 'in die Akte Beta AG (Herr Beta) verschoben: „Vertrag Alpha.pdf“ (dort „Vertrag Alpha (2).pdf“)')
  assertEquals(a.activities[1].text, 'alt')
  // Nur Listen, Verlauf und Datum geschrieben — nie die ganze Zeile.
  for (const g of db.geschrieben) assertEquals(Object.keys(g.werte).sort(), ['activities', 'dokumente', 'letzte_aktivitaet'])
  assertEquals(k.protokoll.length, 1)
})

Deno.test('verschieben aus Ungeklärte Eingänge (Telegram-Adresse): Verweis bleibt, keine Kopie', async () => {
  const db = falscheDb(stand(), dateien())
  const aus = await fuehreDateiVerwaltungAus('datei_verschieben', { von_kunde_id: 'k_eingang_ungeklaert', name: 'scan', nach_kunde_id: 'k_a', neuer_name: 'Steuerbescheid 2024' }, kontext(db, BEA))
  assertStringIncludes(aus, '„Steuerbescheid 2024.pdf“')
  assertEquals(kunde(db, 'k_a').dokumente[0].url, URL_TG)
  assertEquals(kunde(db, 'k_eingang_ungeklaert').dokumente.length, 0)
  assertEquals(db.hochgeladen.length + db.verschoben.length, 0)
})

Deno.test('verschieben in die Sammelakte per nach_ziel', async () => {
  const db = falscheDb(stand(), dateien())
  const aus = await fuehreDateiVerwaltungAus('datei_verschieben', { von_kunde_id: 'k_eingang_ungeklaert', dokument_id: 'u1', nach_ziel: 'intern' }, kontext(db, QUIRIN))
  assertStringIncludes(aus, 'Unterlagen des Hauses')
  assertEquals(kunde(db, 'k_intern_holding').dokumente[0].id, 'u1')
})

Deno.test('verschieben Kunde → Objekt über dateien_ins_objekt, Eintrag weg, alte Datei aussortiert', async () => {
  const db = falscheDb(stand(), dateien())
  const aus = await fuehreDateiVerwaltungAus('datei_verschieben', { von_kunde_id: 'k_immo', dokument_id: 'i1', nach_objekt_id: 'o_lorch', ordner: 'Exposé' }, kontext(db, QUIRIN))
  assertStringIncludes(aus, 'In die Objektakte')
  assertEquals(kunde(db, 'k_immo').dokumente.length, 0)
  const exp = objekt(db, 'o_lorch').dokumente['Exposé']
  assertEquals(exp.length, 2)
  assert(exp[0].url.startsWith('o_lorch/'))
  assertEquals(db.verschoben, [{ eimer: 'kunden-dokumente', von: 'k_immo/dok_i_Expose.pdf', nach: 'k_immo/aussortiert/dok_i_Expose.pdf' }])
  // Ohne Ordner geht es nicht.
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_verschieben', { von_kunde_id: 'k_a', dokument_id: 'd1', nach_objekt_id: 'o_lorch' }, kontext(db, GF)), 'gültiger Ordner')
})

Deno.test('verschieben Objekt → Kunde: Kopie in kunden-dokumente, Freigabe fürs Portal entfernt, alte Datei aussortiert', async () => {
  const db = falscheDb(stand(), dateien())
  const aus = await fuehreDateiVerwaltungAus('datei_verschieben', { von_objekt_id: 'o_lorch', dokument_id: 'od1', nach_kunde_id: 'k_immo' }, kontext(db, QUIRIN))
  assertStringIncludes(aus, 'Verschoben: „Grundbuch Lorch.pdf“ liegt jetzt in der Akte Immo Kunde')
  const o = objekt(db, 'o_lorch')
  assertEquals(o.dokumente['Grundbuch'], [])
  assertEquals(o.interessenten_dokumente, ['od9'])
  assertStringIncludes(o.activities[0].text, 'in die Akte Immo Kunde verschoben')
  const neu = kunde(db, 'k_immo').dokumente[0]
  assert(neu.url.startsWith('k_immo/dok_'), neu.url)
  assertEquals(neu.herkunft, undefined)
  assertEquals(new TextDecoder().decode(db.dateien[`kunden-dokumente/${neu.url}`].bytes), 'GRUNDBUCH')
  assertStringIncludes(kunde(db, 'k_immo').activities[0].text, 'aus der Objektakte „MFH Lorch“ (Teckstr. 62, 73547 Lorch) (Ordner Grundbuch) hierher verschoben')
  assertEquals(db.verschoben, [{ eimer: 'objekt-dokumente', von: 'o_lorch/od1_Grundbuch.pdf', nach: 'o_lorch/aussortiert/od1_Grundbuch.pdf' }])
  const objektSchreiben = db.geschrieben.find((g) => g.tabelle === 'objekte')!
  assertEquals(Object.keys(objektSchreiben.werte).sort(), ['activities', 'dokumente', 'interessenten_dokumente', 'updated_at'])
})

Deno.test('verschieben Objekt → Objekt: gleicher Ordner ohne Angabe', async () => {
  const db = falscheDb(stand(), dateien())
  const aus = await fuehreDateiVerwaltungAus('datei_verschieben', { von_objekt_id: 'o_lorch', name: 'Exposé', nach_objekt_id: 'o_ulm' }, kontext(db, GF))
  assertStringIncludes(aus, '(Ordner Exposé)')
  const neu = objekt(db, 'o_ulm').dokumente['Exposé'][0]
  assert(neu.url.startsWith('o_ulm/dok_'))
  assertEquals(Object.keys(neu).sort(), ['datum', 'groesse', 'id', 'name', 'typ', 'url'])
})

Deno.test('verschieben: Rechte an Quelle und Ziel, private Akten anderer gibt es nicht', async () => {
  const db = falscheDb(stand(), dateien())
  // Bea (nur Beratung) darf nicht in eine Objektakte und nicht aus Immobilien.
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_verschieben', { von_kunde_id: 'k_a', dokument_id: 'd1', nach_objekt_id: 'o_lorch', ordner: 'Verträge' }, kontext(db, BEA)), 'Nicht freigegeben: Der Bereich Immobilien')
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_verschieben', { von_kunde_id: 'k_immo', dokument_id: 'i1', nach_kunde_id: 'k_a' }, kontext(db, BEA)), 'Nicht freigegeben: Der Bereich Immobilien')
  // Quirin (nur Immobilien) darf nicht in eine Beratungsakte.
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_verschieben', { von_kunde_id: 'k_immo', dokument_id: 'i1', nach_kunde_id: 'k_a' }, kontext(db, QUIRIN)), 'Unternehmensberatung')
  // Private Akte eines Kollegen: auch für die Geschäftsführung „nicht gefunden“.
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_verschieben', { von_kunde_id: 'k_priv_carl', dokument_id: 'p1', nach_kunde_id: 'k_a' }, kontext(db, GF)), 'Es gibt keine Kundenakte')
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_verschieben', { von_kunde_id: 'k_a', dokument_id: 'd1', nach_kunde_id: 'k_a' }, kontext(db, GF)), 'dieselbe Akte')
  assertEquals(db.geschrieben.length, 0)
})

// ---------- datei_umbenennen ----------

Deno.test('umbenennen in der Kundenakte: Endung bleibt, Art wird vermerkt', async () => {
  const db = falscheDb(stand(), dateien())
  const aus = await fuehreDateiVerwaltungAus('datei_umbenennen', { kunde_id: 'k_a', dokument_id: 'd1', neuer_name: 'Beratervertrag 2026', kategorie: 'Vertrag' }, kontext(db, BEA))
  assertStringIncludes(aus, '„Vertrag Alpha.pdf“ heißt jetzt „Beratervertrag 2026.pdf“')
  const d = kunde(db, 'k_a').dokumente.find((x: Zeile) => x.id === 'd1')
  assertEquals([d.name, d.kategorie, d.url], ['Beratervertrag 2026.pdf', 'Vertrag', 'k_a/dok_1_Vertrag.pdf'])
  assertStringIncludes(kunde(db, 'k_a').activities[0].text, '„Vertrag Alpha.pdf“ → „Beratervertrag 2026.pdf“; Art: Vertrag')
  assertEquals(db.verschoben.length + db.hochgeladen.length, 0)
})

Deno.test('umbenennen in der Objektakte: Art = Ordner, Dokument wandert in den Ordner', async () => {
  const db = falscheDb(stand(), dateien())
  const aus = await fuehreDateiVerwaltungAus('datei_umbenennen', { objekt_id: 'o_lorch', dokument_id: 'od2', kategorie: 'Expose' }, kontext(db, QUIRIN))
  assertStringIncludes(aus, 'Nichts geändert')
  const aus2 = await fuehreDateiVerwaltungAus('datei_umbenennen', { objekt_id: 'o_lorch', dokument_id: 'od2', neuer_name: 'Grundbuch Lorch', kategorie: 'Grundbuch' }, kontext(db, QUIRIN))
  assertStringIncludes(aus2, 'heißt jetzt „Grundbuch Lorch (2).pdf“ und liegt jetzt im Ordner Grundbuch (vorher Exposé)')
  const o = objekt(db, 'o_lorch')
  assertEquals(o.dokumente['Exposé'], [])
  assertEquals(o.dokumente['Grundbuch'].map((d: Zeile) => d.id), ['od2', 'od1'])
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_umbenennen', { objekt_id: 'o_lorch', dokument_id: 'od1', kategorie: 'Quatsch' }, kontext(db, QUIRIN)), 'gibt es nicht')
})

// ---------- datei_loeschen ----------

Deno.test('löschen: ohne Bestätigung nichts, mit Bestätigung Eintrag weg und Datei unter aussortiert', async () => {
  const db = falscheDb(stand(), dateien())
  const vorab = await fuehreDateiVerwaltungAus('datei_loeschen', { kunde_id: 'k_a', name: 'vertrag' }, kontext(db, BEA))
  assertStringIncludes(vorab, 'NOCH NICHT GELÖSCHT')
  assertStringIncludes(vorab, 'unter „aussortiert“ aufbewahrt')
  assertStringIncludes(vorab, 'dokument_id=d1')
  assertEquals(db.geschrieben.length + db.verschoben.length, 0)
  const k = kontext(db, BEA)
  const aus = await fuehreDateiVerwaltungAus('datei_loeschen', { kunde_id: 'k_a', dokument_id: 'd1', bestaetigt: true }, k)
  assertStringIncludes(aus, 'Gelöscht: „Vertrag Alpha.pdf“')
  assertEquals(kunde(db, 'k_a').dokumente.map((d: Zeile) => d.id), ['d2'])
  assertStringIncludes(kunde(db, 'k_a').activities[0].text, 'gelöscht: „Vertrag Alpha.pdf“ (Datei aufbewahrt unter aussortiert)')
  assertEquals(db.verschoben, [{ eimer: 'kunden-dokumente', von: 'k_a/dok_1_Vertrag.pdf', nach: 'k_a/aussortiert/dok_1_Vertrag.pdf' }])
  assertEquals(db.entfernt, [])
  assertEquals(k.protokoll.length, 1)
})

Deno.test('löschen: Datei, die noch in einer anderen Akte liegt, bleibt; Telegram-Datei nach telegram-aussortiert', async () => {
  const s = stand()
  s.kunden.find((x) => x.id === 'k_b')!.dokumente.push({ id: 'b2', name: 'Scan Kopie.pdf', typ: 'application/pdf', datum: '2026-11-21', groesse: '1 KB', url: URL_TG })
  const db = falscheDb(s, dateien())
  const aus = await fuehreDateiVerwaltungAus('datei_loeschen', { kunde_id: 'k_eingang_ungeklaert', dokument_id: 'u1', bestaetigt: true }, kontext(db, BEA))
  assertStringIncludes(aus, 'noch in einer anderen Akte')
  assertEquals(db.verschoben.length, 0)
  const aus2 = await fuehreDateiVerwaltungAus('datei_loeschen', { kunde_id: 'k_b', dokument_id: 'b2', bestaetigt: true }, kontext(db, BEA))
  assertStringIncludes(aus2, 'aussortiert')
  assertEquals(db.verschoben, [{ eimer: 'email-anhaenge', von: 'telegram/1763800000000_Scan.pdf', nach: 'telegram-aussortiert/1763800000000_Scan.pdf' }])
})

Deno.test('löschen in der Objektakte: auch aus der Portal-Freigabe; Rechte', async () => {
  const db = falscheDb(stand(), dateien())
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_loeschen', { objekt_id: 'o_lorch', dokument_id: 'od1', bestaetigt: true }, kontext(db, BEA)), 'Nicht freigegeben')
  const aus = await fuehreDateiVerwaltungAus('datei_loeschen', { objekt_id: 'o_lorch', dokument_id: 'od1', bestaetigt: true }, kontext(db, QUIRIN))
  assertStringIncludes(aus, 'Gelöscht')
  assertEquals(objekt(db, 'o_lorch').interessenten_dokumente, ['od9'])
  assertEquals(db.verschoben[0].nach, 'o_lorch/aussortiert/od1_Grundbuch.pdf')
})

// ---------- datei_an_kollegen ----------

function falschesTelegram() {
  const anfragen: { url: string; form?: FormData }[] = []
  const abruf = ((url: string, init?: RequestInit) => {
    anfragen.push({ url, form: init?.body as FormData })
    return Promise.resolve(Response.json({ ok: true, result: {} }))
  }) as unknown as typeof fetch
  return { anfragen, abruf }
}

Deno.test('an Kollegen: Objekt-Dokument per Telegram, Vermerk im Verlauf', async () => {
  const db = falscheDb(stand(), dateien())
  const tg = falschesTelegram()
  const k = kontext(db, GF, { botToken: 'TOKEN', abruf: tg.abruf })
  const aus = await fuehreDateiVerwaltungAus('datei_an_kollegen', { objekt_id: 'o_lorch', name: 'grundbuch', an: 'Quirin', nachricht: 'Bitte prüfen' }, k)
  assertStringIncludes(aus, 'Gesendet an Quirin Lutzenberger: „Grundbuch Lorch.pdf“ — Telegram')
  assertEquals(tg.anfragen.length, 1)
  const form = tg.anfragen[0].form!
  assertEquals(form.get('chat_id'), '1002')
  assertEquals(form.get('caption'), 'Von Andreas Mayer: Bitte prüfen')
  assertEquals(await (form.get('document') as File).text(), 'GRUNDBUCH')
  assertStringIncludes(objekt(db, 'o_lorch').activities[0].text, 'an Quirin Lutzenberger geschickt')
  assertEquals(Object.keys(db.geschrieben[0].werte).sort(), ['activities', 'updated_at'])
})

Deno.test('an Kollegen: Empfänger ohne Rechte, private Akte, unbekannt — nichts gesendet', async () => {
  const db = falscheDb(stand(), dateien())
  const tg = falschesTelegram()
  const k = kontext(db, GF, { botToken: 'TOKEN', abruf: tg.abruf })
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_an_kollegen', { kunde_id: 'k_a', dokument_id: 'd1', an: 'Quirin' }, k), 'Quirin Lutzenberger darf die Akte von Alpha GmbH nicht sehen')
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_an_kollegen', { objekt_id: 'o_lorch', dokument_id: 'od1', an: 'Bea' }, k), 'Bea Berater darf Objektakten nicht sehen')
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_an_kollegen', { kunde_id: 'k_priv_andreas', dokument_id: 'pa1', an: 'Carl' }, k), 'privaten Akten gehen nicht an Kollegen')
  assertStringIncludes(await fuehreDateiVerwaltungAus('datei_an_kollegen', { kunde_id: 'k_a', dokument_id: 'd1', an: 'Niemand' }, k), 'gibt es nicht')
  assertEquals(tg.anfragen.length, 0)
  assertEquals(db.geschrieben.length, 0)
})

Deno.test('an Kollegen: sensible Unterlage nicht über Telegram, aber per Mail an die Arbeitsadresse', async () => {
  const db = falscheDb(stand(), dateien())
  const tg = falschesTelegram()
  const mails: MailAuftrag[] = []
  const k = kontext(db, GF, { botToken: 'TOKEN', abruf: tg.abruf, sendeMail: (m) => (mails.push(m), Promise.resolve({ ok: true })) })
  const aus = await fuehreDateiVerwaltungAus('datei_an_kollegen', { kunde_id: 'k_a', dokument_id: 'd2', an: 'Bea', per_mail: true }, k)
  assertStringIncludes(aus, 'Gesendet an Bea Berater: „Ausweis Müller.jpg“ — Mail an bea@mayer.de')
  assertStringIncludes(aus, 'Nicht gesendet: Telegram: „Ausweis Müller.jpg“ ist eine sensible Unterlage')
  assertEquals(tg.anfragen.length, 0)
  assertEquals(mails.length, 1)
  assertEquals(mails[0].an, 'bea@mayer.de')
  assertEquals(atob(mails[0].anhaenge[0].contentBase64), 'AUSWEIS')
  assertStringIncludes(mails[0].text, 'Hallo Bea,')
  // Ohne Mail-Weg und ohne Telegram-Chat: verständlicher Hinweis.
  kunde(db, 'k_a').dokumente.push({ id: 'd3', name: 'Gesprächsnotiz.pdf', typ: 'application/pdf', datum: '2026-11-20', groesse: '1 KB', url: 'k_a/dok_1_Vertrag.pdf' })
  const ohne = await fuehreDateiVerwaltungAus('datei_an_kollegen', { kunde_id: 'k_a', dokument_id: 'd3', an: 'Bea' }, kontext(db, GF, { botToken: 'TOKEN', abruf: tg.abruf }))
  assertStringIncludes(ohne, 'nicht mit Telegram verbunden')
  assertStringIncludes(ohne, 'per_mail=true')
})
