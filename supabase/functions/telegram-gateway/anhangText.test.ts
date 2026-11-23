import { assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1'
import { strToU8, zipSync } from 'npm:fflate@0.8.2'
import { bueroAnhangText, istExcel, istWord } from './anhangText.ts'
import { erstelleXlsx } from './dateiFormate.ts'

Deno.test('Word-Anhang: Absätze und Tabellenzellen werden Text', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>Vorhaben &amp; Beteiligte</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Max Muster</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t xml:space="preserve">Gesellschafter</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
  const bytes = zipSync({ 'word/document.xml': strToU8(xml) })
  const text = bueroAnhangText('uebersicht.docx', '', bytes)!
  assertStringIncludes(text, 'Vorhaben & Beteiligte')
  assertStringIncludes(text, 'Max Muster')
  assertStringIncludes(text, 'Gesellschafter')
})

Deno.test('Excel-Anhang: Blätter und Zellen werden Text', () => {
  const { bytes } = erstelleXlsx({ titel: 'Probe', urheber: 'Test', blaetter: [{ name: 'Umsätze', spalten: ['Monat', 'Wert'], zeilen: [['Oktober', 12]] }] })
  const text = bueroAnhangText('liste.xlsx', '', bytes)!
  assertStringIncludes(text, 'Tabellenblatt: Umsätze')
  assertStringIncludes(text, 'Oktober')
  assertStringIncludes(text, '12')
})

Deno.test('Erkennung, Kürzung und Fehler', () => {
  assertEquals(istWord('a.DOCX'), true)
  assertEquals(istExcel('a.bin', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), true)
  assertEquals(bueroAnhangText('a.pdf', 'application/pdf', new Uint8Array()), null)
  const lang = zipSync({ 'word/document.xml': strToU8(`<w:p><w:t>${'x'.repeat(500)}</w:t></w:p>`) })
  assertStringIncludes(bueroAnhangText('a.docx', '', lang, 100)!, 'gekürzt')
  assertThrows(() => bueroAnhangText('a.docx', '', zipSync({ 'x.txt': strToU8('x') })))
})
