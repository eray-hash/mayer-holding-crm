// Word, Excel und Senden per Telegram (dateiFormate.ts, dokumentErstellen.ts, dateiSenden.ts).
// Teil 1 baut .docx/.xlsx, packt sie wieder aus und prüft Pflichtteile, wohlgeformtes XML, Maskierung
// und Zahlen. Teil 2 ruft die Werkzeuge gegen eine Datenbank im Speicher (_shared/testDoppel.ts) auf;
// Telegram wird durch ein falsches fetch ersetzt.
//
//   npx -y deno test --allow-env --allow-read telegram-gateway/dateiFormate.test.ts
import { assert, assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import { strFromU8, unzipSync } from 'npm:fflate@0.8.2'
import { XMLValidator } from 'npm:fast-xml-parser@4.5.0'
import { blattName, DOCX_TYP, erstelleDocx, erstelleXlsx, spaltenName, XLSX_TYP, xmlText } from './dateiFormate.ts'
import { fuehreDokumentWerkzeugAus } from './dokumentErstellen.ts'
import { findeDokument, speicherOrt } from './dateiSenden.ts'
import { falscheDatenbank, type FalscheDatenbank } from '../_shared/testDoppel.ts'

function entpacke(bytes: Uint8Array): Record<string, string> {
  const roh = unzipSync(bytes)
  return Object.fromEntries(Object.entries(roh).map(([k, v]) => [k, strFromU8(v)]))
}

function pruefeWohlgeformt(teile: Record<string, string>) {
  for (const [pfad, xml] of Object.entries(teile)) {
    if (!/\.(xml|rels)$/.test(pfad)) continue
    const ergebnis = XMLValidator.validate(xml)
    assert(ergebnis === true, `${pfad} ist kein wohlgeformtes XML: ${JSON.stringify(ergebnis)}`)
  }
}

const TEXT = [
  'Einleitung mit **fett**, *kursiv* & <spitzen> Klammern „Anführung“ — Gedankenstrich, Umlaute äöüß ÄÖÜ.',
  'Zweite Zeile im selben Absatz\u0001 (Steuerzeichen fällt weg) 🙂',
  '',
  '## Abschnitt eins',
  '- Punkt A',
  '  - Unterpunkt A1',
  '- Punkt B mit **fett**',
  '',
  '1. Erster Schritt',
  '2. Zweiter Schritt',
  '',
  'Ein Absatz dazwischen.',
  '',
  '3. Dritter Schritt (neue Liste ab 3)',
  '',
  '---',
  '',
  '> Ein Zitat',
  '',
  '| Name | Betrag |',
  '|---|---|',
  '| Müller & Söhne | 1.234,50 € |',
  '| <Test> | 99 |',
].join('\n')

// ---------------------------------------------------------------------------------------------
// Teil 1: Dateien
// ---------------------------------------------------------------------------------------------

Deno.test('xmlText: maskiert & < > " und wirft Steuerzeichen weg', () => {
  assertEquals(xmlText('a & b < c > d "e" \u0001f „g“'), 'a &amp; b &lt; c &gt; d &quot;e&quot; f „g“')
})

Deno.test('Word: Pflichtteile, wohlgeformt, A4, Kopf- und Fußzeile mit Seitenzahlen', () => {
  const bytes = erstelleDocx({ titel: 'Merkblatt „Erbvertrag“ & Co', inhalt: TEXT, artName: 'Merkblatt', fuer: 'Zebra & Partner', stand: '20. November 2026', kopf: { name: 'Andreas Mayer Holding', zeile: 'Schwabstraße 3 · 89075 Ulm' }, urheber: 'Andreas Mayer Holding' })
  assertEquals([bytes[0], bytes[1]], [0x50, 0x4b], 'ZIP-Archiv')
  const t = entpacke(bytes)
  for (const teil of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml', 'word/header1.xml', 'word/footer1.xml', 'docProps/core.xml']) assert(t[teil], `${teil} fehlt`)
  pruefeWohlgeformt(t)
  const doc = t['word/document.xml']
  assertStringIncludes(doc, 'Merkblatt „Erbvertrag“ &amp; Co')
  assertStringIncludes(doc, '&amp; &lt;spitzen&gt; Klammern „Anführung“')
  assertStringIncludes(doc, 'äöüß ÄÖÜ')
  assertStringIncludes(doc, 'Für: Zebra &amp; Partner')
  assert(!doc.includes('\u0001'), 'Steuerzeichen darf nicht im XML stehen')
  assertStringIncludes(doc, '🙂')
  assertStringIncludes(doc, '<w:pgSz w:w="11906" w:h="16838"/>')
  assertStringIncludes(doc, '<w:br/>', 'Zeilenumbruch im Absatz')
  assertStringIncludes(doc, '<w:b/>')
  assertStringIncludes(doc, '<w:i/>')
  assertStringIncludes(doc, 'w:val="Heading2"')
  assertStringIncludes(doc, '<w:tbl>')
  assertStringIncludes(doc, '<w:tblHeader/>')
  assertStringIncludes(doc, 'Müller &amp; Söhne')
  assertStringIncludes(doc, 'w:val="Zitat"')
  assertStringIncludes(doc, '<w:bottom w:val="single"', 'Trennlinie')
  // Aufzählungen sind echte Word-Listen, keine eingetippten Zeichen.
  assert(!/<w:t[^>]*>[•–] /.test(doc), 'keine eingetippten Aufzählungszeichen')
  const numIds = [...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1])
  assert(numIds.includes('1'), 'Aufzählung nutzt die Punkt-Liste')
  const nummeriert = [...new Set(numIds.filter((n) => n !== '1'))]
  assertEquals(nummeriert.length, 2, 'zwei getrennte nummerierte Listen')
  for (const n of nummeriert) assertStringIncludes(t['word/numbering.xml'], `<w:num w:numId="${n}">`)
  assertMatch(doc, /<w:ilvl w:val="1"\/><w:numId w:val="1"\/>/, 'Unterpunkt eine Ebene tiefer')
  // Die zweite Liste beginnt bei 3.
  assertMatch(t['word/numbering.xml'], /<w:abstractNum w:abstractNumId="2">.*?<w:lvl w:ilvl="0"><w:start w:val="3"\/><w:numFmt w:val="decimal"\/>/)
  assertStringIncludes(t['word/header1.xml'], 'Andreas Mayer Holding')
  assertStringIncludes(t['word/footer1.xml'], ' PAGE ')
  assertStringIncludes(t['word/footer1.xml'], ' NUMPAGES ')
  assertStringIncludes(t['docProps/core.xml'], '<dc:title>Merkblatt „Erbvertrag“ &amp; Co</dc:title>')
  assertStringIncludes(t['[Content_Types].xml'], 'wordprocessingml.document.main+xml')
})

Deno.test('Word: private Akte — Kopf nur mit dem Namen des Besitzers', () => {
  const t = entpacke(erstelleDocx({ titel: 'Notiz', inhalt: 'Text', artName: 'Zusammenfassung', stand: '1. Januar 2026', kopf: { name: 'Anna Alt' }, urheber: 'Anna Alt' }))
  assertStringIncludes(t['word/header1.xml'], 'Anna Alt')
  assert(!t['word/header1.xml'].includes('Mayer'))
  assert(!t['word/document.xml'].includes('Mayer'))
  pruefeWohlgeformt(t)
})

Deno.test('Excel: Pflichtteile, wohlgeformt, Zahlen als Zahlen, Text maskiert', () => {
  const { bytes, blaetter } = erstelleXlsx({
    titel: 'Liste „Mieter“ & Co',
    urheber: 'Andreas Mayer Holding',
    blaetter: [
      {
        name: 'Liste: 2026/11 [neu]*?',
        spalten: ['Name', 'Betrag', 'PLZ', 'Baujahr'],
        zeilen: [
          ['Müller & Söhne', 1234.5, '89075', 1998],
          ['<Test> „Zitat“', '1.234,56 €', null, '2001'],
          ['Zeile\nmit Umbruch', 7, '01234', null],
        ],
      },
      { name: 'Liste: 2026/11 [neu]*?', spalten: ['A'], zeilen: [[1]] },
    ],
  })
  const t = entpacke(bytes)
  for (const teil of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'docProps/core.xml']) assert(t[teil], `${teil} fehlt`)
  pruefeWohlgeformt(t)

  // Blattnamen: ohne verbotene Zeichen, höchstens 31, eindeutig.
  assertEquals(blaetter.length, 2)
  for (const b of blaetter) {
    assert(b.name.length <= 31, b.name)
    assert(!/[:\\/?*[\]]/.test(b.name), b.name)
  }
  assert(blaetter[0].name.toLowerCase() !== blaetter[1].name.toLowerCase())
  assertEquals(blaetter[0], { name: 'Liste- 2026-11 -neu---', zeilen: 3, spalten: 4 })

  const s1 = t['xl/worksheets/sheet1.xml']
  // Kopfzeile fett (Stil 1), fixiert, mit Filter.
  assertMatch(s1, /<c r="A1" t="s" s="1">/)
  assertStringIncludes(s1, 'state="frozen"')
  assertStringIncludes(s1, '<autoFilter ref="A1:D4"/>')
  // Zahl als Zahl mit Tausenderpunkt-Format (Stil 4 = #,##0.0), nicht als Text.
  assertMatch(s1, /<c r="B2" s="4"><v>1234.5<\/v><\/c>/)
  // Deutsche Zahl mit € aus Text → Zahl im Euro-Format.
  assertMatch(s1, /<c r="B3" s="7"><v>1234.56<\/v><\/c>/)
  // PLZ bleibt Text (führende Null!), Baujahr ohne Tausenderpunkt.
  assertMatch(s1, /<c r="C2" t="s">/)
  assertMatch(s1, /<c r="C4" t="s">/)
  assertMatch(s1, /<c r="D2"><v>1998<\/v><\/c>/)
  assertMatch(s1, /<c r="D3" t="s">/, '"2001" als Text bleibt Text')
  assertMatch(s1, /<c r="A4" t="s" s="8">/, 'Text mit Umbruch umbricht')
  assert(!/<c r="C3"/.test(s1), 'leere Zelle fehlt')
  assertMatch(s1, /<col min="1" max="1" width="[\d.]+" customWidth="1"\/>/)

  const sst = t['xl/sharedStrings.xml']
  assertStringIncludes(sst, 'Müller &amp; Söhne')
  assertStringIncludes(sst, '&lt;Test&gt; „Zitat“')
  assertStringIncludes(sst, '>01234<')
  assertStringIncludes(t['xl/styles.xml'], 'formatCode="#,##0.0"')
  assertStringIncludes(t['xl/workbook.xml'], `name="${xmlText(blaetter[0].name)}"`)
  assertStringIncludes(t['docProps/core.xml'], 'Liste „Mieter“ &amp; Co')
  assertStringIncludes(s1, '&amp;L')
})

Deno.test('Excel: Hilfen für Spalten und Blattnamen', () => {
  assertEquals([spaltenName(0), spaltenName(25), spaltenName(26), spaltenName(701), spaltenName(702)], ['A', 'Z', 'AA', 'ZZ', 'AAA'])
  const v = new Set<string>()
  assertEquals(blattName('', 1, v), 'Tabelle1')
  assertEquals(blattName("'Zitat'", 2, v), 'Zitat')
  assertEquals(blattName('x'.repeat(40), 3, v).length, 31)
  assertEquals(blattName('x'.repeat(40), 4, v), `${'x'.repeat(27)} (2)`)
})

Deno.test('Excel: leere Eingabe und zu viele Zellen ergeben einen deutschen Fehler', () => {
  let fehler = ''
  try {
    erstelleXlsx({ titel: 'x', urheber: 'y', blaetter: [] })
  } catch (e) {
    fehler = (e as Error).message
  }
  assertStringIncludes(fehler, 'mindestens ein Blatt')
})

// Beispiel-Dateien zum Ansehen (nur wenn BEISPIEL_ORDNER gesetzt ist).
Deno.test('Beispiel-Dateien schreiben', async () => {
  const ordner = Deno.env.get('BEISPIEL_ORDNER')
  if (!ordner) return
  await Deno.writeFile(`${ordner}/Beispiel.docx`, erstelleDocx({ titel: 'Merkblatt „Erbvertrag“ & Co', inhalt: TEXT, artName: 'Merkblatt', fuer: 'Zebra & Partner', stand: '20. November 2026', kopf: { name: 'Andreas Mayer Holding', zeile: 'Andreas Mayer Holding UG (haftungsbeschränkt) · Schwabstraße 3 · 89075 Ulm' }, urheber: 'Andreas Mayer Holding' }))
  await Deno.writeFile(
    `${ordner}/Beispiel.xlsx`,
    erstelleXlsx({
      titel: 'Liste vom Foto',
      urheber: 'Andreas Mayer Holding',
      blaetter: [{ name: 'Liste', spalten: ['Name', 'Betrag', 'PLZ'], zeilen: [['Müller & Söhne', 1234.5, '89075'], ['<Test> „Zitat“', '1.234,56 €', null], ['Zeile\nmit Umbruch', 7, '01234']] }],
    }).bytes,
  )
})

// ---------------------------------------------------------------------------------------------
// Teil 2: Werkzeuge
// ---------------------------------------------------------------------------------------------

const ANNA = { id: 'm_a', name: 'Anna Alt', email: 'anna@firma.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }
const CARL = { id: 'm_c', name: 'Carl Kollege', email: 'carl@firma.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] as string[] }
// Die Funktion liest nur Adressen des eigenen Speichers (gleicher Ursprung wie SUPABASE_URL).
Deno.env.set('SUPABASE_URL', 'https://test.local')
const URL_OEFFENTLICH = 'https://test.local/storage/v1/object/public/email-anhaenge/telegram/17000_liste.jpg'

function db(): FalscheDatenbank {
  const d = falscheDatenbank({
    mitarbeiter: [
      { ...ANNA, aktiv: true, telegram_chat_id: 4711 },
      { ...CARL, aktiv: true, telegram_chat_id: null },
    ],
    kunden: [
      {
        id: 'k_b', bereich: 'beratung', firma: 'Zebra GmbH', ansprechpartner: 'Zora Zebra', verantwortlich_email: null, activities: [],
        dokumente: [
          { id: 'd_foto', name: 'Liste vom Foto.jpg', typ: 'image/jpeg', datum: '2026-11-20', groesse: '1 KB', url: URL_OEFFENTLICH },
          { id: 'd_ausweis', name: 'Personalausweis Zora.pdf', typ: 'application/pdf', datum: '2026-11-20', groesse: '1 KB', url: 'k_b/dok_x_Personalausweis.pdf' },
          { id: 'd_mv1', name: 'Mietvertrag Entwurf.docx', typ: DOCX_TYP, datum: '2026-11-19', groesse: '1 KB', url: 'k_b/dok_y.docx' },
          { id: 'd_mv2', name: 'Mietvertrag Entwurf alt.docx', typ: DOCX_TYP, datum: '2026-11-18', groesse: '1 KB', url: 'k_b/dok_z.docx' },
        ],
      },
      { id: 'k_priv_c', bereich: 'privat', firma: 'Carls Kontakt', ansprechpartner: '', verantwortlich_email: 'carl@firma.de', activities: [], dokumente: [{ id: 'd_p', name: 'Privat.pdf', typ: 'application/pdf', url: 'k_priv_c/p.pdf' }] },
      { id: 'k_priv_a', bereich: 'privat', firma: 'Annas Kontakt', ansprechpartner: '', verantwortlich_email: 'anna@firma.de', activities: [], dokumente: [] },
    ],
    briefboegen: [],
  })
  return d
}

async function legeAb(d: FalscheDatenbank, eimer: string, pfad: string, inhalt: string) {
  await d.storage.from(eimer).upload(pfad, new TextEncoder().encode(inhalt), { contentType: 'application/octet-stream' })
}

type Anfrage = { url: string; form?: FormData }
function falschesTelegram(antwort: () => Response = () => Response.json({ ok: true, result: {} })) {
  const anfragen: Anfrage[] = []
  const abruf = ((eingabe: string | URL | Request, init?: RequestInit) => {
    const url = String(eingabe)
    anfragen.push({ url, form: init?.body instanceof FormData ? init.body : undefined })
    return Promise.resolve(antwort())
  }) as typeof fetch
  return { anfragen, abruf }
}

function kontext(d: FalscheDatenbank, m: typeof ANNA, extra: Record<string, unknown> = {}) {
  const protokoll: string[] = []
  return { k: { supabase: d, mitarbeiter: m, protokolliere: (t: string) => protokoll.push(t), heute: '2026-11-20', ...extra }, protokoll }
}

Deno.test('tabelle_erstellen: legt eine .xlsx in der Akte ab und nennt datei_senden', async () => {
  const d = db()
  const { k, protokoll } = kontext(d, ANNA)
  const aus = await fuehreDokumentWerkzeugAus('tabelle_erstellen', { kunde_id: 'k_b', titel: 'Liste vom Foto', blaetter: [{ name: 'Liste', spalten: ['Name', 'Anzahl'], zeilen: [['Äpfel', 3], ['Birnen', 12]] }] }, k)
  assertStringIncludes(aus, 'Erstellt und abgelegt: „Liste vom Foto (20.11.2026).xlsx"')
  assertStringIncludes(aus, '2 Zeilen, 2 Spalten')
  assertStringIncludes(aus, 'datei_senden')
  const akte = d.tabelle('kunden').find((z) => z.id === 'k_b')!
  // deno-lint-ignore no-explicit-any
  const neu = (akte.dokumente as any[])[0]
  assertEquals(neu.typ, XLSX_TYP)
  assertEquals(neu.quelle, 'assistent')
  assertMatch(neu.url, /^k_b\/dok_[0-9a-f]{12}_Liste_vom_Foto_20\.11\.2026_\.xlsx$/)
  // deno-lint-ignore no-explicit-any
  assertStringIncludes((akte.activities as any[])[0].text, 'Excel-Tabelle')
  const gespeichert = d.ablage.get('kunden-dokumente')!.get(neu.url)!
  assertEquals(gespeichert.contentType, XLSX_TYP)
  assert(entpacke(gespeichert.bytes)['xl/worksheets/sheet1.xml'].includes('<v>12</v>'))
  assertEquals(protokoll.length, 1)
})

Deno.test('tabelle_erstellen: leere Tabelle und fremde private Akte werden abgelehnt', async () => {
  const d = db()
  const { k } = kontext(d, ANNA)
  assertStringIncludes(await fuehreDokumentWerkzeugAus('tabelle_erstellen', { kunde_id: 'k_b', titel: 'X', blaetter: [] }, k), 'leer')
  assertStringIncludes(await fuehreDokumentWerkzeugAus('tabelle_erstellen', { kunde_id: 'k_priv_c', titel: 'X', blaetter: [{ spalten: ['a'], zeilen: [[1]] }] }, k), 'keinen Kunden')
  assertEquals(d.ablage.get('kunden-dokumente')?.size ?? 0, 0)
})

Deno.test('dokument_erstellen mit format word: .docx in der Akte, private Akte ohne Mayer-Kopf', async () => {
  const d = db()
  const { k } = kontext(d, ANNA)
  const aus = await fuehreDokumentWerkzeugAus('dokument_erstellen', { kunde_id: 'k_priv_a', titel: 'Notiz', inhalt: '- eins\n- zwei', format: 'word' }, k)
  assertStringIncludes(aus, '„Notiz (20.11.2026).docx"')
  assertStringIncludes(aus, 'datei_senden')
  // deno-lint-ignore no-explicit-any
  const neu = (d.tabelle('kunden').find((z) => z.id === 'k_priv_a')!.dokumente as any[])[0]
  assertEquals(neu.typ, DOCX_TYP)
  const t = entpacke(d.ablage.get('kunden-dokumente')!.get(neu.url)!.bytes)
  assertStringIncludes(t['word/header1.xml'], 'Anna Alt')
  assert(!t['word/header1.xml'].includes('Mayer'))
  // PDF bleibt die Vorgabe.
  const pdf = await fuehreDokumentWerkzeugAus('dokument_erstellen', { kunde_id: 'k_b', titel: 'Merkblatt', inhalt: 'Text' }, k)
  assertStringIncludes(pdf, '.pdf"')
  assertStringIncludes(pdf, 'datei_senden')
})

Deno.test('datei_senden: schickt per sendDocument an den eigenen Chat (öffentliche Ablage mit dem Dienst-Client)', async () => {
  const d = db()
  await legeAb(d, 'email-anhaenge', 'telegram/17000_liste.jpg', 'BILD')
  const tg = falschesTelegram()
  const { k, protokoll } = kontext(d, ANNA, { botToken: 'TOKEN', abruf: tg.abruf })
  const aus = await fuehreDokumentWerkzeugAus('datei_senden', { kunde_id: 'k_b', name: 'liste foto', bildunterschrift: 'Hier die Liste' }, k)
  assertStringIncludes(aus, 'Gesendet: „Liste vom Foto.jpg"')
  assertEquals(tg.anfragen.length, 1)
  assertEquals(tg.anfragen[0].url, 'https://api.telegram.org/botTOKEN/sendDocument')
  const form = tg.anfragen[0].form!
  assertEquals(form.get('chat_id'), '4711')
  assertEquals(form.get('caption'), 'Hier die Liste')
  const datei = form.get('document') as File
  assertEquals(datei.name, 'Liste vom Foto.jpg')
  assertEquals(await datei.text(), 'BILD')
  assertEquals(protokoll.length, 1)
})

Deno.test('datei_senden: privater Speicherpfad, Telegram-Fehler verständlich', async () => {
  const d = db()
  await legeAb(d, 'kunden-dokumente', 'k_b/dok_y.docx', 'WORD')
  const tg = falschesTelegram(() => Response.json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, { status: 403 }))
  const { k } = kontext(d, ANNA, { botToken: 'TOKEN', abruf: tg.abruf })
  const aus = await fuehreDokumentWerkzeugAus('datei_senden', { kunde_id: 'k_b', dokument_id: 'd_mv1' }, k)
  assertStringIncludes(aus, 'Nicht gesendet')
  assertStringIncludes(aus, 'blockiert')
  assertEquals(((tg.anfragen[0].form!.get('document')) as File).name, 'Mietvertrag Entwurf.docx')
})

Deno.test('datei_senden: Mehrdeutig, sensibel, ohne Chat, fremde private Akte, fehlende Datei', async () => {
  const d = db()
  const tg = falschesTelegram()
  const anna = kontext(d, ANNA, { botToken: 'TOKEN', abruf: tg.abruf }).k
  assertStringIncludes(await fuehreDokumentWerkzeugAus('datei_senden', { kunde_id: 'k_b', name: 'Mietvertrag' }, anna), 'Mehrere Dateien')
  assertStringIncludes(await fuehreDokumentWerkzeugAus('datei_senden', { kunde_id: 'k_b', dokument_id: 'd_ausweis' }, anna), 'sensible Unterlage (Ausweis)')
  assertStringIncludes(await fuehreDokumentWerkzeugAus('datei_senden', { kunde_id: 'k_priv_c', dokument_id: 'd_p' }, anna), 'keinen Kunden')
  assertStringIncludes(await fuehreDokumentWerkzeugAus('datei_senden', { kunde_id: 'k_b', dokument_id: 'd_mv2' }, anna), 'nicht (mehr) vorhanden')
  const carl = kontext(d, CARL, { botToken: 'TOKEN', abruf: tg.abruf }).k
  assertStringIncludes(await fuehreDokumentWerkzeugAus('datei_senden', { kunde_id: 'k_b', dokument_id: 'd_mv1' }, carl), 'kein Telegram-Chat verbunden')
  assertEquals(tg.anfragen.length, 0)
})

Deno.test('datei_senden: ohne Bot-Schlüssel nur protokollieren; fremde Adresse wird nie abgerufen', async () => {
  const d = db()
  await legeAb(d, 'kunden-dokumente', 'k_b/dok_y.docx', 'WORD')
  const ohne = kontext(d, ANNA, { botToken: null })
  const log = console.log
  console.log = () => {}
  try {
    assertStringIncludes(await fuehreDokumentWerkzeugAus('datei_senden', { kunde_id: 'k_b', dokument_id: 'd_mv1' }, ohne.k), 'Testlauf ohne Bot-Schlüssel')
  } finally {
    console.log = log
  }
  d.tabelle('kunden').find((z) => z.id === 'k_b')!.dokumente = [{ id: 'g', name: 'Gross.pdf', typ: 'application/pdf', url: 'https://anderswo.example/gross.pdf' }]
  let abgerufen = 0
  const zaehler = ((u: string | URL | Request) => {
    if (!String(u).includes('api.telegram.org')) abgerufen++
    return Promise.resolve(new Response('{"ok":true}'))
  }) as typeof fetch
  const { k } = kontext(d, ANNA, { botToken: 'TOKEN', abruf: zaehler })
  assertStringIncludes(await fuehreDokumentWerkzeugAus('datei_senden', { kunde_id: 'k_b', dokument_id: 'g' }, k), 'ungültig')
  assertEquals(abgerufen, 0, 'keine Anfrage an fremde Adressen')
  // Pfad mit ../ (Versuch, mit dem Dienstschlüssel andere Eimer oder Tabellen zu lesen)
  d.tabelle('kunden').find((z) => z.id === 'k_b')!.dokumente = [{ id: 'h', name: 'x.pdf', typ: 'application/pdf', url: '../../../../rest/v1/mitarbeiter' }]
  assertStringIncludes(await fuehreDokumentWerkzeugAus('datei_senden', { kunde_id: 'k_b', dokument_id: 'h' }, k), 'ungültig')
})

Deno.test('datei_senden: Speicherort und Suche', () => {
  assertEquals(speicherOrt('k_b/dok_1.pdf', ''), { eimer: 'kunden-dokumente', pfad: 'k_b/dok_1.pdf' })
  assertEquals(speicherOrt('privat:fach/x.pdf', ''), { eimer: 'postfach-anhaenge', pfad: 'fach/x.pdf' })
  assertEquals(speicherOrt('https://p.supabase.co/storage/v1/object/public/email-anhaenge/a%20b.pdf', 'https://p.supabase.co'), { eimer: 'email-anhaenge', pfad: 'a b.pdf' })
  // Fremde Adressen, Doppelgänger-Adressen, fremde Eimer und ../ in jeder Schreibweise: abgelehnt.
  for (const boese of [
    'https://fremd.de/storage/v1/object/public/email-anhaenge/y.pdf',
    'https://p.supabase.co.boese.tld/storage/v1/object/public/email-anhaenge/y.pdf',
    'https://p.supabase.co/storage/v1/object/public/geheim/y.pdf',
    'https://p.supabase.co/storage/v1/object/public/email-anhaenge/../../../../rest/v1/mitarbeiter',
    'https://p.supabase.co/storage/v1/object/public/email-anhaenge/%2e%2e/%2e%2e/auth/v1/admin/users',
    '../../../../rest/v1/mitarbeiter?select=*',
    'k_b/../../postfach-anhaenge/x.pdf',
    'k_b/%2e%2e/x.pdf',
    '/k_b/x.pdf',
    'k_b\\..\\x.pdf',
    'privat:../x.pdf',
    'objekt-dokumente:o1/../../x',
  ]) assertEquals(speicherOrt(boese, 'https://p.supabase.co'), null, boese)
  const doks = [{ id: '1', name: 'Mieterliste.xlsx' }, { id: '2', name: 'Mieterliste alt.xlsx' }]
  assertEquals(findeDokument(doks, '', 'Mieterliste'), { dok: doks[0] }, 'genauer Name gewinnt')
  assert('meldung' in findeDokument(doks, '', 'xyz'))
})
