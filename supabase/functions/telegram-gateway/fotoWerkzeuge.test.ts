// Prüft die Foto-Werkzeuge des Assistenten (fotoWerkzeuge.ts) an einer nachgebauten Datenbank und Ablage
// (ohne Netz, ohne KI): Rechte, Fotos per Telegram in den Ordner „Bilder“ (auch wartende Fotos einer
// Sammelsendung), Vorschlag für Titelbild und Reihenfolge, Reihenfolge setzen — geschrieben wird nur
// bilder_reihenfolge. Dazu die Reihenfolge im Exposé vom Server (Titelbild, „nicht im Exposé“, Drehung).
import { assert, assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import { decodeBase64 } from 'jsr:@std/encoding@1/base64'
import { falscheDatenbank, type FalscheDatenbank } from '../_shared/testDoppel.ts'
import { erstelleExposePdf, zeichenAusrichtung } from './exposePdf.ts'
import { type FotoKontext, fuehreFotoWerkzeugAus, istFotoWerkzeug, leseWarteZeile, ordneNachEinschaetzung } from './fotoWerkzeuge.ts'

const JPG = decodeBase64('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAoADwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlaKKK+hPPCrek/wDISi/H+RqpVvSf+QlF+P8AI1z4v/d5+j/I1ofxY+q/M6OiiiviD6YKKKKAMj+w/wDp5/8AHP8A69H9h/8ATz/45/8AXrXorv8A7Uxf8/4L/I5PqND+X8WZH9h/9PP/AI5/9eprTSvs1yk3n7tueNmO2PWtGipnmWJnFxlLR+S/yHHB0YtNR1XmwoooriOoKKKKACiiigAooooAKKKKACiiigD/2Q==')
const JPG6 = decodeBase64('/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAoADwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlaKKK+hPPCrek/wDISi/H+RqpVvSf+QlF+P8AI1z4v/d5+j/I1ofxY+q/M6OiiiviD6YKKKKAMj+w/wDp5/8AHP8A69H9h/8ATz/45/8AXrXorv8A7Uxf8/4L/I5PqND+X8WZH9h/9PP/AI5/9eprTSvs1yk3n7tueNmO2PWtGipnmWJnFxlLR+S/yHHB0YtNR1XmwoooriOoKKKKACiiigAooooAKKKKACiiigD/2Q==')
const PNG = decodeBase64('iVBORw0KGgoAAAANSUhEUgAAAB4AAAAKCAYAAACjd+4vAAAAJklEQVR4nGNkYGD4zzAAgGkgLAWBUYvpBpjoZxUqGLWYbmDALAYA5YQBE0qe3sYAAAAASUVORK5CYII=')

const JETZT = new Date('2026-11-22T10:00:00.000Z')
const vor = (min: number) => new Date(JETZT.getTime() - min * 60_000).toISOString()
const T1 = 'telegram/1763805000000_h0123456789ab_IMG_1.jpg'
const T2 = 'telegram/1763805001000_h0123456789ac_IMG_2.jpg'
const T3 = 'telegram/1763805002000_h0123456789ad_IMG_3.jpg'
const T_PDF = 'telegram/1763805003000_h0123456789ae_Grundbuch.pdf'
const T_ALT = 'telegram/1763700000000_h0123456789af_Alt.jpg'

const GF = { id: 'm_gf', name: 'Andreas Mayer', email: 'andreas@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }
const IMMO = { id: 'm_ql', name: 'Quirin L', email: 'quirin@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }
const BERATER = { id: 'm_bea', name: 'Bea Berater', email: 'bea@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }
const HASAN_PRIVAT = { id: 'm_hy', name: 'Hasan Y', email: 'hasan@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'], nurPrivat: true }

function foto(id: string, name: string) {
  return { id, name, typ: 'image/jpeg', datum: '2026-11-01', groesse: '1 KB', url: `o1/${id}_${name}` }
}

function aufbau(o: { warteschlange?: Record<string, unknown>[] } = {}) {
  const db = falscheDatenbank({
    objekte: [
      {
        id: 'o1',
        bezeichnung: 'Boarding House Remstal',
        adresse: 'Remsstraße 1, 73614 Schorndorf',
        privat_besitzer: null,
        dokumente: { Bilder: [foto('d3', 'bad.jpg'), foto('d2', 'kueche.jpg'), foto('d1', 'aussen.jpg')], Grundbuch: [] },
        activities: [],
        bilder_reihenfolge: [],
      },
      { id: 'o2', bezeichnung: 'Privatwohnung', adresse: 'Ulm', privat_besitzer: 'hasan@mayer.de', dokumente: { Bilder: [{ ...foto('p1', 'a.jpg'), url: 'o2/p1_a.jpg' }] }, activities: [], bilder_reihenfolge: [] },
    ],
    kunden: [],
    telegram_warteschlange: o.warteschlange ?? [],
  })
  const od = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>()
  for (const p of ['o1/d1_aussen.jpg', 'o1/d2_kueche.jpg', 'o1/d3_bad.jpg', 'o2/p1_a.jpg']) od.set(p, { bytes: new Uint8Array(JPG), contentType: 'image/jpeg' })
  db.ablage.set('objekt-dokumente', od)
  const tg = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>()
  for (const p of [T1, T2, T3, T_ALT]) tg.set(p, { bytes: new Uint8Array(JPG), contentType: 'image/jpeg' })
  tg.set(T_PDF, { bytes: new TextEncoder().encode('%PDF-1.4'), contentType: 'application/pdf' })
  db.ablage.set('email-anhaenge', tg)
  return db
}

/** Supabase-Client aus der Testdatenbank, dazu öffentliche Adressen der Ablage und eine Liste der geschriebenen Spalten. */
function client(db: FalscheDatenbank) {
  const geschrieben: { tabelle: string; felder: string[] }[] = []
  const supabase = {
    from: (t: string) => {
      const a = db.from(t)
      // deno-lint-ignore no-explicit-any
      const x = a as any
      const update = x.update.bind(a)
      x.update = (w: Record<string, unknown>) => {
        geschrieben.push({ tabelle: t, felder: Object.keys(w) })
        return update(w)
      }
      return a
    },
    storage: {
      from: (eimer: string) => ({
        ...db.storage.from(eimer),
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://beispiel.supabase.co/storage/v1/object/public/${eimer}/${p}` } }),
      }),
    },
  }
  return { supabase, geschrieben }
}

function kontext(db: FalscheDatenbank, mitarbeiter: FotoKontext['mitarbeiter'], ki?: FotoKontext['ki']) {
  const c = client(db)
  const protokoll: string[] = []
  const k: FotoKontext = { supabase: c.supabase, mitarbeiter, protokolliere: (t) => protokoll.push(t), heute: '2026-11-22', ki, jetzt: () => JETZT }
  return { k, protokoll, geschrieben: c.geschrieben }
}

const reihenfolge = (db: FalscheDatenbank, id = 'o1') => (db.tabelle('objekte').find((o) => o.id === id)?.bilder_reihenfolge ?? []) as Record<string, unknown>[]
const bilderOrdner = (db: FalscheDatenbank) => ((db.tabelle('objekte').find((o) => o.id === 'o1')?.dokumente as Record<string, { id: string; name: string }[]>).Bilder ?? [])

Deno.test('Werkzeugnamen', () => {
  assert(istFotoWerkzeug('fotos_ins_objekt'))
  assert(istFotoWerkzeug('titelbild_vorschlagen'))
  assert(istFotoWerkzeug('bild_reihenfolge_setzen'))
  assert(!istFotoWerkzeug('dateien_ins_objekt'))
})

Deno.test('Rechte: ohne Immobilien nicht freigegeben, fremdes privates Objekt gibt es nicht, privater Assistent nur eigene', async () => {
  for (const name of ['fotos_ins_objekt', 'titelbild_vorschlagen', 'bild_reihenfolge_setzen']) {
    const db = aufbau()
    const berater = kontext(db, BERATER)
    assertMatch(await fuehreFotoWerkzeugAus(name, { objekt_id: 'o1', pfade: [T1], reihenfolge: ['d1'] }, berater.k), /^Nicht freigegeben/)
    const gf = kontext(db, GF)
    assertMatch(await fuehreFotoWerkzeugAus(name, { objekt_id: 'o2', pfade: [T1], reihenfolge: ['p1'] }, gf.k), /^Fehler: Es gibt kein Objekt/)
    const privat = kontext(db, HASAN_PRIVAT)
    assertMatch(await fuehreFotoWerkzeugAus(name, { objekt_id: 'o1', pfade: [T1], reihenfolge: ['d1'] }, privat.k), /^Fehler: Es gibt kein Objekt/)
    assertEquals([...berater.geschrieben, ...gf.geschrieben, ...privat.geschrieben], [])
  }
  // Der Besitzer darf an seinem privaten Objekt arbeiten.
  const db = aufbau()
  const hasan = kontext(db, HASAN_PRIVAT)
  assertStringIncludes(await fuehreFotoWerkzeugAus('bild_reihenfolge_setzen', { objekt_id: 'o2', beschriftungen: [{ dokument_id: 'p1', text: 'Balkon' }] }, hasan.k), 'Gespeichert')
  assertEquals(reihenfolge(db, 'o2'), [{ id: 'p1', beschriftung: 'Balkon' }])
})

Deno.test('bild_reihenfolge_setzen: ohne Änderung nur anzeigen, sonst nur die Spalte bilder_reihenfolge schreiben', async () => {
  const db = aufbau()
  const { k, geschrieben, protokoll } = kontext(db, IMMO)
  const anzeige = await fuehreFotoWerkzeugAus('bild_reihenfolge_setzen', { objekt_id: 'o1' }, k)
  assertStringIncludes(anzeige, '1. Titelbild: bad.jpg (d3)')
  assertEquals(geschrieben, [])

  const r = await fuehreFotoWerkzeugAus(
    'bild_reihenfolge_setzen',
    { objekt_id: 'o1', reihenfolge: ['d1', 'kueche.jpg'], drehen: [{ dokument_id: 'd2', grad: -90 }], nicht_im_expose: ['d3'], beschriftungen: [{ dokument_id: 'd1', text: 'Ansicht von Süden' }, { dokument_id: 'gibtsnicht', text: 'x' }] },
    k,
  )
  assertStringIncludes(r, 'Gespeichert')
  assertStringIncludes(r, '1. Titelbild: aussen.jpg (d1) · „Ansicht von Süden“')
  assertStringIncludes(r, '2. kueche.jpg (d2) · gedreht 270°')
  assertStringIncludes(r, '3. bad.jpg (d3) · nicht im Exposé')
  assertStringIncludes(r, 'Nicht gefunden im Ordner Bilder: gibtsnicht')
  assertEquals(reihenfolge(db), [{ id: 'd1', beschriftung: 'Ansicht von Süden' }, { id: 'd2', drehung: 270 }, { id: 'd3', im_expose: false }])
  assertEquals(geschrieben, [{ tabelle: 'objekte', felder: ['bilder_reihenfolge'] }])
  assertEquals(protokoll.length, 1)

  // Titelbild wechseln: Angaben bleiben, nur die Reihenfolge ändert sich.
  await fuehreFotoWerkzeugAus('bild_reihenfolge_setzen', { objekt_id: 'o1', titelbild: 'd2', wieder_im_expose: ['d3'] }, k)
  assertEquals(reihenfolge(db), [{ id: 'd2', drehung: 270 }, { id: 'd1', beschriftung: 'Ansicht von Süden' }, { id: 'd3' }])
})

Deno.test('fotos_ins_objekt: Fotos in „Bilder“, hinten angehängt, wartende Fotos derselben Sendung mitgenommen', async () => {
  const db = aufbau({
    warteschlange: [
      { id: 1, mitarbeiter_id: 'm_ql', chat_id: '1', zeile: `pfad=${T2} | Name: IMG_2.jpg`, erstellt_am: vor(1) },
      { id: 2, mitarbeiter_id: 'm_ql', chat_id: '1', zeile: `pfad=${T3} | Name: IMG_3.jpg | Bildunterschrift: „Zu Objekt Ulm"`, erstellt_am: vor(1) },
      { id: 3, mitarbeiter_id: 'm_ql', chat_id: '1', zeile: `pfad=${T_PDF} | Name: Grundbuch.pdf`, erstellt_am: vor(1) },
      { id: 4, mitarbeiter_id: 'm_ql', chat_id: '1', zeile: `pfad=${T_ALT} | Name: Alt.jpg`, erstellt_am: vor(60) },
      { id: 5, mitarbeiter_id: 'm_anderer', chat_id: '2', zeile: `pfad=${T3} | Name: IMG_3.jpg`, erstellt_am: vor(1) },
    ],
  })
  // Bisher festgelegt: Außenansicht als Titelbild.
  db.tabelle('objekte')[0].bilder_reihenfolge = [{ id: 'd1' }]
  const { k, protokoll, geschrieben } = kontext(db, IMMO)
  const r = await fuehreFotoWerkzeugAus('fotos_ins_objekt', { objekt_id: 'o1', pfade: [T1, T_PDF, 'anderswo/x.jpg'], auch_wartende_fotos: true }, k)
  assertStringIncludes(r, '2 Fotos in die Objektakte „Boarding House Remstal“')
  assertStringIncludes(r, 'Davon 1 aus derselben Sendung mitgenommen.')
  assertStringIncludes(r, 'kein Foto — andere Dateien mit dateien_ins_objekt ablegen')
  assertStringIncludes(r, 'kein gültiger Pfad')
  assertStringIncludes(r, 'Titelbild: aussen.jpg')
  const namen = bilderOrdner(db).map((d) => d.name)
  assert(namen.includes('IMG_1.jpg') && namen.includes('IMG_2.jpg'))
  assert(!namen.includes('IMG_3.jpg') && !namen.includes('Alt.jpg'))
  // Reihenfolge: Titelbild bleibt, alte Fotos, dann die neuen in Sendereihenfolge.
  const nachName = new Map(bilderOrdner(db).map((d) => [d.id, d.name]))
  assertEquals(reihenfolge(db).map((e) => nachName.get(String(e.id))), ['aussen.jpg', 'bad.jpg', 'kueche.jpg', 'IMG_1.jpg', 'IMG_2.jpg'])
  // Nur die mitgenommene Zeile ist aus der Schlange verschwunden.
  assertEquals(db.tabelle('telegram_warteschlange').map((z) => z.id), [2, 3, 4, 5])
  assertEquals(protokoll, ['2 Datei(en) bei Objekt „Boarding House Remstal“ (Remsstraße 1, 73614 Schorndorf) (Ordner Bilder) abgelegt'])
  // dateien_ins_objekt schreibt Dokumente und Verlauf, danach nur noch die Reihenfolge.
  assertEquals(geschrieben.map((g) => g.felder.join(',')), ['dokumente,activities,updated_at', 'bilder_reihenfolge'])

  // Noch einmal dasselbe: nichts doppelt.
  const r2 = await fuehreFotoWerkzeugAus('fotos_ins_objekt', { objekt_id: 'o1', pfade: [T1] }, k)
  assertStringIncludes(r2, 'Keine neuen Fotos')
  assertStringIncludes(r2, 'liegt bereits in dieser Objektakte')
})

Deno.test('Warteschlangen-Zeile lesen', () => {
  assertEquals(leseWarteZeile(`pfad=${T1} | Name: IMG 1.jpg`), { pfad: T1, name: 'IMG 1.jpg', bildunterschrift: '' })
  assertEquals(leseWarteZeile(`pfad=${T1} | Name: IMG_1.jpg | Bildunterschrift: „Fotos zu Remstal"`)?.bildunterschrift, 'Fotos zu Remstal')
  assertEquals(leseWarteZeile('NICHT gespeichert: „x"'), null)
})

Deno.test('Reihenfolge nach Einschätzung: Titelbild, dann Außen → Wohnen → Küche → Bad → Übriges → Pläne', () => {
  const e = [
    { nr: 1, art: 'bad' as const, qualitaet: 4 },
    { nr: 2, art: 'plan' as const, qualitaet: 5 },
    { nr: 3, art: 'aussen' as const, qualitaet: 3 },
    { nr: 4, art: 'kueche' as const, qualitaet: 4 },
    { nr: 5, art: 'aussen' as const, qualitaet: 5 },
    { nr: 6, art: 'wohnen' as const, qualitaet: 2 },
  ]
  assertEquals(ordneNachEinschaetzung(6, 5, e), [5, 3, 6, 4, 1, 2])
  // Ungültige Titelbild-Nummer: das beste Außenfoto.
  assertEquals(ordneNachEinschaetzung(6, 99, e)[0], 5)
})

Deno.test('titelbild_vorschlagen: Vorschlag ohne Speichern, mit bestaetigt gespeichert; Bilder gehen klein an die Bilderkennung', async () => {
  const db = aufbau()
  // deno-lint-ignore no-explicit-any
  const anfragen: any[] = []
  // Fotos kommen in der Reihenfolge d3 (bad), d2 (kueche), d1 (aussen) an.
  const ki = (a: Record<string, unknown>) => {
    anfragen.push(a)
    return Promise.resolve({ content: [{ type: 'tool_use', name: 'fotos_einordnen', input: { titelbild: 3, fotos: [{ nr: 1, art: 'bad', qualitaet: 4 }, { nr: 2, art: 'kueche', qualitaet: 4 }, { nr: 3, art: 'aussen', qualitaet: 5 }] } }] })
  }
  const { k, geschrieben, protokoll } = kontext(db, IMMO, ki)
  const r = await fuehreFotoWerkzeugAus('titelbild_vorschlagen', { objekt_id: 'o1' }, k)
  assertStringIncludes(r, 'noch nicht gespeichert')
  assertStringIncludes(r, '1. Titelbild: aussen.jpg (d1) · Außenansicht')
  assertStringIncludes(r, '2. kueche.jpg (d2) · Küche')
  assertStringIncludes(r, 'reihenfolge=["d1","d2","d3"]')
  assertEquals(geschrieben, [])
  assertEquals(anfragen[0].model, 'claude-haiku-5-5')
  assertEquals(anfragen[0].tool_choice, { type: 'tool', name: 'fotos_einordnen' })
  assertEquals(anfragen[0].messages[0].content.filter((c: { type: string }) => c.type === 'image').length, 3)

  const r2 = await fuehreFotoWerkzeugAus('titelbild_vorschlagen', { objekt_id: 'o1', bestaetigt: true }, k)
  assertStringIncludes(r2, 'Gespeichert')
  assertEquals(reihenfolge(db).map((e) => e.id), ['d1', 'd2', 'd3'])
  assertEquals(geschrieben, [{ tabelle: 'objekte', felder: ['bilder_reihenfolge'] }])
  assertEquals(protokoll.length, 1)
})

Deno.test('Exposé vom Server: Drehung aus der Reihenfolge wird auf die Kamera-Angabe aufgeschlagen', async () => {
  assertEquals(zeichenAusrichtung({ bytes: JPG }), 1)
  assertEquals(zeichenAusrichtung({ bytes: JPG, drehung: 90 }), 6)
  assertEquals(zeichenAusrichtung({ bytes: JPG6 }), 6)
  assertEquals(zeichenAusrichtung({ bytes: JPG6, drehung: 90 }), 3)
  assertEquals(zeichenAusrichtung({ bytes: PNG, drehung: 270 }), 8)
  const pdf = await erstelleExposePdf({
    titel: 'Test',
    ortZeile: 'Ulm',
    objektart: 'Haus',
    preisText: '1 €',
    fakten: [],
    beschreibung: 'Text',
    titelbild: { bytes: JPG6, drehung: 270 },
    bilder: [{ bytes: JPG, drehung: 180 }, { bytes: PNG, drehung: 90 }],
    firma: 'Firma',
    kontakte: [{ titel: 'Ihr Ansprechpartner', name: 'A' }],
    stand: '22.11.2026',
  })
  assertEquals(pdf.bilderImPdf, 3)
  assertEquals(pdf.nichtLesbar, 0)
})
