// Tests für briefbogen.ts – die Vorlagen (Word und PDF) werden hier im Code gebaut, keine Binärdateien.
import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1'
import { strFromU8, strToU8, unzipSync, zipSync } from 'npm:fflate@0.8.2'
import { PDFDocument, PDFName, rgb } from 'npm:pdf-lib@1.17.1'
import { type BriefDaten, briefDatum, erzeugeBriefPdf, fuelleDocx, platzhalterIn } from './briefbogen.ts'

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"'

const INHALTSTYPEN = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
const STILE = `<?xml version="1.0" encoding="UTF-8"?><w:styles ${NS}><w:style w:styleId="Standard"/></w:styles>`
const KOPF = `<?xml version="1.0" encoding="UTF-8"?><w:hdr ${NS}><w:p><w:r><w:t>Unser Zeichen – [[BETREFF]]</w:t></w:r></w:p></w:hdr>`

function dokument(mitText = true): string {
  const absaetze = [
    // mit Attributen und fett
    `<w:p w14:paraId="1A2B3C4D" w14:textId="77777777" w:rsidR="00AB12CD"><w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t>[[EMPFAENGER]]</w:t></w:r></w:p>`,
    `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>[[DATUM]]</w:t></w:r></w:p>`,
    // von Word auf drei Läufe verteilt
    `<w:p w:rsidR="00112233"><w:pPr><w:pStyle w:val="Standard"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>[[</w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:rPr><w:i/></w:rPr><w:t>BETREFF</w:t></w:r><w:proofErr w:type="spellEnd"/><w:r><w:t>]]</w:t></w:r></w:p>`,
    `<w:p/>`,
    `<w:p><w:r><w:t>[[ANREDE]]</w:t></w:r></w:p>`,
    mitText ? `<w:p><w:r><w:t>[[TEXT]]</w:t></w:r></w:p>` : '',
    `<w:p><w:r><w:t>Mit freundlichen Grüßen</w:t></w:r></w:p>`,
  ]
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${absaetze.join('')}<w:sectPr/></w:body></w:document>`
}

function vorlage(mitText = true): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(INHALTSTYPEN),
    'word/document.xml': strToU8(dokument(mitText)),
    'word/styles.xml': strToU8(STILE),
    'word/header1.xml': strToU8(KOPF),
    'word/media/bild.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]),
  })
}

const BRIEF: BriefDaten = {
  empfaenger: ['Müller & Söhne GmbH', '', 'Hauptstraße 1', '89073 Ulm'],
  datum: 'Ulm, den 20.11.2026',
  betreff: 'Angebot <Nr. 7> für "Haus" $& Garten',
  anrede: 'Sehr geehrte Frau Öztürk,',
  absaetze: ['Erster Absatz mit ß und €.', 'Zweiter Absatz\nmit Zeilenumbruch.', 'Kein [[TEXT]] hier.'],
}

Deno.test('fuelleDocx ersetzt alle Platzhalter und maskiert Werte', () => {
  const aus = unzipSync(fuelleDocx(vorlage(), BRIEF))
  const xml = strFromU8(aus['word/document.xml'])

  for (const n of ['EMPFAENGER', 'DATUM', 'BETREFF', 'ANREDE']) assert(!xml.includes(`[[${n}]]`), `[[${n}]] steht noch drin`)
  assert(!/\[\[TEXT\]\]/.test(xml), '[[TEXT]] darf nicht wörtlich stehen (auch nicht aus dem Wert)')
  assert(xml.includes('Müller &amp; Söhne GmbH'))
  assert(xml.includes('Angebot &lt;Nr. 7&gt; für &quot;Haus&quot; $&amp; Garten'), 'Betreff falsch maskiert oder $& ausgewertet')
  assert(xml.includes('Sehr geehrte Frau Öztürk,'))
  assert(xml.includes('Ulm, den 20.11.2026'))
  assert(xml.includes('Zweiter Absatz</w:t><w:br/><w:t xml:space="preserve">mit Zeilenumbruch.'))
  assert(xml.includes('Kein [&#91;TEXT]] hier.'))

  // Ein Absatz je Empfängerzeile; nur der erste fett und mit Kennung
  const empf = [...xml.matchAll(/<w:p w:rsidR="00AB12CD">.*?<\/w:p>|<w:p w14:paraId="1A2B3C4D".*?<\/w:p>/gs)].map((m) => m[0])
  assertEquals(empf.length, 4)
  assert(empf[0].includes('<w:b/>') && empf[0].includes('Müller'))
  for (const p of empf.slice(1)) assert(!p.includes('<w:b/>') && !p.includes('<w:bCs/>'), 'nur die erste Zeile darf fett sein')
  assert(!empf[1].includes('<w:r>'), 'leere Zeile soll keinen Lauf haben')
  assert(empf[3].includes('89073 Ulm'))

  // Aufgeteilter Betreff: ein Lauf, Format des ersten Laufs (fett), Absatzformat bleibt
  const betreff = xml.match(/<w:p w:rsidR="00112233">.*?<\/w:p>/s)![0]
  assertEquals((betreff.match(/<w:r>/g) ?? []).length, 1)
  assert(betreff.includes('<w:pStyle w:val="Standard"/>'))
  assert(betreff.includes('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Angebot'))

  // Drei Textabsätze, Gruß unverändert
  assertEquals((xml.match(/Erster Absatz|Zweiter Absatz|Kein \[/g) ?? []).length, 3)
  assert(xml.includes('Mit freundlichen Grüßen'))

  // Kopfzeile ebenfalls ersetzt
  assert(strFromU8(aus['word/header1.xml']).includes('Unser Zeichen – Angebot &lt;Nr. 7&gt;'))

  // Übrige Dateien unverändert
  assertEquals(aus['word/styles.xml'], strToU8(STILE))
  assertEquals(aus['[Content_Types].xml'], strToU8(INHALTSTYPEN))
  assertEquals(aus['word/media/bild.png'], new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]))
  assertEquals(Object.keys(aus), ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/header1.xml', 'word/media/bild.png'])
})

Deno.test('fuelleDocx setzt ohne Datum das heutige Datum mit Ort ein', () => {
  const xml = strFromU8(unzipSync(fuelleDocx(vorlage(), { ...BRIEF, datum: undefined, ort: 'Neu-Ulm' }))['word/document.xml'])
  assert(xml.includes(briefDatum('Neu-Ulm')))
  assert(/Neu-Ulm, den \d\d\.\d\d\.\d{4}/.test(xml))
})

Deno.test('platzhalterIn erkennt auch aufgeteilte Platzhalter', () => {
  assertEquals(platzhalterIn(vorlage()), ['EMPFAENGER', 'DATUM', 'BETREFF', 'ANREDE', 'TEXT'])
  assertEquals(platzhalterIn(vorlage(false)), ['EMPFAENGER', 'DATUM', 'BETREFF', 'ANREDE'])
})

Deno.test('fuelleDocx meldet fehlendes [[TEXT]] und kaputte Dateien', () => {
  assertThrows(() => fuelleDocx(vorlage(false), BRIEF), Error, '[[TEXT]]')
  assertThrows(() => fuelleDocx(zipSync({ 'a.txt': strToU8('x') }), BRIEF), Error, 'word/document.xml')
  assertThrows(() => fuelleDocx(new Uint8Array([1, 2, 3]), BRIEF), Error, 'keine gültige Word-Datei')
})

async function hintergrundPdf(seiten: number, groesse: [number, number]): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  for (let i = 0; i < seiten; i++) {
    const s = d.addPage(groesse)
    s.drawRectangle({ x: 20, y: groesse[1] - 60, width: 200, height: 40, color: rgb(0.1, 0.3, 0.6) })
  }
  return await d.save()
}

const LANGER_BRIEF: BriefDaten = {
  empfaenger: ['Herrn', 'Max Mustermann', 'Musterweg 3', '89075 Ulm'],
  ort: 'Ulm',
  betreff: 'Ihre Anfrage – „Grüße“ aus Ulm, Kosten 1.000 € 😀',
  anrede: 'Sehr geehrter Herr Mustermann,',
  absaetze: Array.from({ length: 40 }, (_, i) => `Absatz ${i + 1}: Für Rückfragen – „Grüße“ … 😀👍🏽 ✓`),
  gruss: ['Mit freundlichen Grüßen', '', 'Hasan Süslü'],
}

Deno.test('erzeugeBriefPdf: zwei Hintergrundseiten, drei Briefseiten', async () => {
  const pdf = await PDFDocument.load(await erzeugeBriefPdf(await hintergrundPdf(2, [595.28, 841.89]), LANGER_BRIEF))
  assertEquals(pdf.getPageCount(), 3)
  for (const s of pdf.getPages()) assertEquals([Math.round(s.getWidth()), Math.round(s.getHeight())], [595, 842])
  assertEquals(pdf.getTitle(), LANGER_BRIEF.betreff)
})

Deno.test('erzeugeBriefPdf: eine Hintergrundseite gilt auch für Folgeseiten, Seitengröße vom Briefbogen', async () => {
  const pdf = await PDFDocument.load(await erzeugeBriefPdf(await hintergrundPdf(1, [612, 792]), LANGER_BRIEF))
  assert(pdf.getPageCount() >= 3)
  for (const s of pdf.getPages()) assertEquals([s.getWidth(), s.getHeight()], [612, 792])
})

Deno.test('erzeugeBriefPdf: ohne Hintergrund A4, kurzer Brief eine Seite, eigene Ränder', async () => {
  const kurz = { ...LANGER_BRIEF, absaetze: ['Nur ein Satz.'], datum: undefined }
  const pdf = await PDFDocument.load(await erzeugeBriefPdf(null, kurz, { links: 20, schrift: 10, unten: undefined }))
  assertEquals(pdf.getPageCount(), 1)
  assertEquals(Math.round(pdf.getPage(0).getHeight()), 842)
})

Deno.test('erzeugeBriefPdf: unlesbarer Briefbogen gibt deutsche Fehlermeldung', async () => {
  await assertRejects(() => erzeugeBriefPdf(new Uint8Array([1, 2, 3]), LANGER_BRIEF), Error, 'Briefbogen-PDF')
})

Deno.test('erzeugeBriefPdf: Serifenschrift auf Wunsch, **fette** Zeilen in der Unterschrift', async () => {
  const brief: BriefDaten = { empfaenger: ['Firma'], betreff: 'Betreff', anrede: 'Sehr geehrte Damen und Herren,', absaetze: ['Text'], gruss: ['Mit freundlichen Grüßen', '', '**Andreas Mayer Holding**', '**H. Süslü**', 'Ulmer Wirtschaftskanzlei'] }
  const schriften = async (b: Uint8Array) => {
    const doc = await PDFDocument.load(b)
    return doc.context.enumerateIndirectObjects().map(([, o]) => String((o as { get?: (k: unknown) => unknown }).get?.(PDFName.of('BaseFont')) ?? '')).filter(Boolean)
  }
  const mitSerif = await schriften(await erzeugeBriefPdf(null, brief, { serif: 1 }))
  assert(mitSerif.includes('/Times-Roman') && mitSerif.includes('/Times-Bold'), `Times eingebettet: ${mitSerif}`)
  const ohne = await schriften(await erzeugeBriefPdf(null, brief))
  assert(ohne.includes('/Helvetica') && !ohne.includes('/Times-Roman'), `ohne serif bleibt Helvetica: ${ohne}`)
})

