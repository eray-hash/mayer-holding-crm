// Zahlungserinnerung / Mahnungen auf dem Server: Texte, Fristen, Gebühren und Beträge wie im CRM (src/lib/rechnungPdf.ts),
// Eintrag an der Rechnung wie MahnungModal, PDF im Satzspiegel des Briefbogens. Erfundene Daten.
//
//   npx -y deno test --allow-all _shared/mahnungKern.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { erzeugeHoldingMahnungPdf, MAHNUNG_SATZSPIEGEL, type Platzierung } from './mahnungHoldingPdf.ts'
import { leseStufe, mahnBetraege, mahnungDateiname, mahnungMailText, mahnVermerk, mahnVorlage, type MahnRechnungDaten, rechnungNachMahnung } from './mahnungKern.ts'

const basis = (): MahnRechnungDaten => ({
  id: 'r1',
  nummer: 'MBG-001',
  datum: '2026-11-24',
  zahlungsziel: '2026-12-08',
  status: 'Versendet',
  mahnstufe: null,
  betrag_brutto: 5950,
  zahlungen: [{ datum: '2026-12-01', betrag: 950 }],
  mahnungen: [],
})

Deno.test('Stufen: Fristen, Gebühren und Texte wie im CRM', () => {
  const r = basis()
  const e = mahnVorlage(r, 'erinnerung')
  assertEquals([e.tage, e.gebuehr], [7, 0])
  assertEquals(
    e.text,
    'sicherlich ist es Ihrer Aufmerksamkeit entgangen, dass unsere Rechnung Nr. MBG-001 vom 24.11.2026 noch nicht vollständig beglichen ist. Die Zahlung war am 08.12.2026 fällig.\nWir bitten Sie freundlich, den unten aufgeführten Betrag bis zum genannten Datum zu überweisen.',
  )
  assertStringIncludes(e.schluss, 'betrachten Sie dieses Schreiben bitte als gegenstandslos')

  r.mahnungen = [{ datum: '2026-12-11', stufe: 'erinnerung', gebuehr: 0, neueFrist: '2026-12-18' }]
  const m1 = mahnVorlage(r, 'mahnung1')
  assertEquals([m1.tage, m1.gebuehr], [10, 5])
  assertStringIncludes(m1.text, 'bis heute keinen vollständigen Zahlungseingang feststellen – auch nicht nach unserer Zahlungserinnerung vom 11.12.2026.')

  r.mahnungen.push({ datum: '2026-12-22', stufe: 'mahnung1', gebuehr: 5, neueFrist: '2027-01-01' })
  const m2 = mahnVorlage(r, 'mahnung2')
  assertEquals([m2.tage, m2.gebuehr], [10, 5])
  assertStringIncludes(m2.text, 'trotz unserer bisherigen Schreiben (Zahlungserinnerung vom 11.12.2026, 1. Mahnung vom 22.12.2026) ist unsere Rechnung Nr. MBG-001')
  assertStringIncludes(m2.schluss, 'an ein Inkassobüro übergeben')
})

Deno.test('Rechnung ohne Zahlungsfrist: kein „war am … fällig“', () => {
  const e = mahnVorlage({ ...basis(), ohne_zahlungsfrist: true }, 'erinnerung')
  assert(!e.text.includes('fällig'))
  assertStringIncludes(e.text, 'noch nicht vollständig beglichen ist.\nWir bitten Sie freundlich')
})

Deno.test('Beträge: offen minus Zahlungen plus frühere und neue Gebühren', () => {
  const r = basis()
  assertEquals(mahnBetraege(r, 0), { brutto: 5950, gezahlt: 950, fruehere: 0, gebuehr: 0, offen: 5000, summe: 5000 })
  r.mahnungen = [{ stufe: 'erinnerung', gebuehr: 0 }, { stufe: 'mahnung1', gebuehr: 5 }]
  assertEquals(mahnBetraege(r, 5).summe, 5010)
})

Deno.test('Eintrag an der Rechnung, Mailtext, Vermerk, Dateiname, Stufe lesen', () => {
  const r = basis()
  const eintrag = { id: 'mahn_x', datum: '2026-12-11', stufe: 'erinnerung', gebuehr: 0, neueFrist: '2026-12-18', weg: 'email' as const, an: 'k@beispiel.example', dokumentName: 'Z.pdf', von: 'Erika Beispiel' }
  assertEquals(rechnungNachMahnung(r, eintrag), { mahnungen: [eintrag], mahnstufe: 'erinnerung', status: 'Überfällig' })
  assertEquals(rechnungNachMahnung({ ...r, status: 'Bezahlt' }, eintrag).status, 'Bezahlt')
  assertStringIncludes(mahnungMailText(r, 'mahnung1', 5005, '2027-01-01'), 'anbei erhalten Sie unsere 1. Mahnung zu Rechnung Nr. MBG-001 vom 24.11.2026.\nBitte überweisen Sie den offenen Betrag von 5.005,00 € bis spätestens 01.01.2027.')
  assertEquals(mahnVermerk('MBG-001', 'erinnerung', 'email', 'k@beispiel.example', '2026-12-18', 5000), 'Zahlungserinnerung zu Rechnung MBG-001 per E-Mail an k@beispiel.example gesendet — neue Frist 18.12.2026, offen 5.000,00 €')
  assertEquals(mahnungDateiname('MBG/001', 'mahnung2', '2027-01-05'), '2. Mahnung zu Rechnung MBG-001 (05.01.2027).pdf')
  assertEquals([leseStufe('Zahlungserinnerung'), leseStufe('1. Mahnung'), leseStufe('mahnung2'), leseStufe('Inkasso')], ['erinnerung', 'mahnung1', 'mahnung2', null])
})

Deno.test('PDF: Briefbogen-Satzspiegel, Kontoinhaber Andreas Mayer, Vorschau-Vermerk', async () => {
  const r = { ...basis(), mahnungen: [{ datum: '2026-12-11', stufe: 'erinnerung', gebuehr: 0, neueFrist: '2026-12-18' }] }
  const v = mahnVorlage(r, 'mahnung1')
  for (const vorschau of [false, true]) {
    const protokoll: Platzierung[] = []
    const { bytes, seiten, summe } = await erzeugeHoldingMahnungPdf(
      { rechnung: r, stufe: 'mahnung1', datum: '2026-12-22', neueFrist: '2027-01-01', gebuehr: v.gebuehr, empfaenger: ['Musterbau GmbH', 'Beispielweg 12', '89073 Ulm'], text: v.text, schluss: v.schluss, absender: 'Erika Beispiel', vorschau },
      { protokoll },
    )
    assertEquals([seiten, summe], [1, 5005])
    const doc = await PDFDocument.load(bytes)
    assertEquals(doc.getTitle(), vorschau ? '1. Mahnung zu Rechnung MBG-001 (Vorschau)' : '1. Mahnung zu Rechnung MBG-001')
    for (const p of protokoll) {
      assert(p.x2 <= MAHNUNG_SATZSPIEGEL.rechts + 0.01, `ragt in die Team-Spalte: ${p.text}`)
      assert(p.y <= MAHNUNG_SATZSPIEGEL.unten + 0.01, `ragt in die Fußzeile: ${p.text}`)
    }
    const texte = protokoll.map((p) => p.text)
    assert(texte.includes('1. Mahnung'))
    assert(texte.includes('Andreas Mayer'), 'Kontoinhaber')
    assert(texte.includes('Zahlbar bis spätestens 01.01.2027'))
    assert(texte.includes('5.005,00 €'))
    assertEquals(texte.some((t) => t.startsWith('VORSCHAU')), vorschau)
  }
})
