// Scan-Eingang (scanEingang.ts): reine Hilfen ohne Netz.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { betreffIstName, dateiSicher, nameAusBetreff, pfadAusUrl, wahlAufgabe } from './scanEingang.ts'

Deno.test('Name der neuen Akte aus dem Betreff', () => {
  assertEquals(nameAusBetreff('anna beispiel'), 'Anna Beispiel')
  assertEquals(nameAusBetreff('WG: anna beispiel Teil 2'), 'Anna Beispiel')
  assertEquals(nameAusBetreff('otto von muster'), 'Otto von Muster')
})

Deno.test('Dateiname und Speicherpfad', () => {
  assertEquals(dateiSicher('Gesprächsprotokoll 2026-11-10'), 'Gesprachsprotokoll_2026-11-10.pdf')
  assertEquals(dateiSicher('Brief.pdf'), 'Brief.pdf')
  assertEquals(pfadAusUrl('https://x.supabase.co/storage/v1/object/public/email-anhaenge/postfach/ab/1_Scan.pdf'), 'postfach/ab/1_Scan.pdf')
  assertEquals(pfadAusUrl('https://x.supabase.co/storage/v1/object/public/andere/1.pdf'), null)
})

Deno.test('Aufgabe für die Wahl nennt Akten mit Nummer und Teile', () => {
  const a = wahlAufgabe('anna beispiel', [
    { id: 'k1', bereich: 'erben', firma: 'Anna Beispiel – Erben', ansprechpartner: 'Anna Beispiel', email: null },
    { id: 'k2', bereich: 'beratung', firma: 'Anna Beispiel', ansprechpartner: 'Anna Beispiel', email: null },
  ], [{ kategorie: 'Testament', kurzinhalt: 'Testament von 2020', datei: 'Testament.pdf' }])
  assertStringIncludes(a, '1. Bereich erben: Anna Beispiel – Erben')
  assertStringIncludes(a, '2. Bereich beratung')
  assertStringIncludes(a, '1. Testament — Testament von 2020')
  assert(wahlAufgabe('x y', [], []).includes('keine'))
})

Deno.test('Nur Betreffe, die nach einem Namen aussehen', () => {
  assert(betreffIstName('anna beispiel'))
  assert(betreffIstName('fam. muster'))
  assert(betreffIstName('ben wurm'))
  assert(!betreffIstName('Message from KM_C3350i'))
  assert(!betreffIstName('SKM_C3350i26112314530.pdf'))
  assert(!betreffIstName(''))
  assert(!betreffIstName('Scan'))
  assert(!betreffIstName('test'))
})
