// Prüft die Zerlegung der Suchanfrage (Anführungszeichen, Wortanfänge, Ausschluss, ODER, Sonderzeichen).
import { assertEquals } from 'jsr:@std/assert@1'
import { alsTsquery, ausschnittTeile, ausschnittText, gesuchteTeile, MAX_BEGRIFFE, zerlegeSuche } from './sucheAnfrage.ts'

Deno.test('Wörter sind Wortanfänge, mehrere müssen alle vorkommen', () => {
  assertEquals(alsTsquery('Müller'), 'müller:*')
  assertEquals(alsTsquery('  Max   Müller '), 'max:* & müller:*')
  assertEquals(alsTsquery('Gesprä'), 'gesprä:*')
  assertEquals(alsTsquery('89075 Ulm'), '89075:* & ulm:*')
})

Deno.test('Anführungszeichen: genaue Wortfolge, auch deutsche und französische Zeichen', () => {
  assertEquals(alsTsquery('"Max Müller"'), '(max <-> müller)')
  assertEquals(alsTsquery('„Max Müller“'), '(max <-> müller)')
  assertEquals(alsTsquery('«Max Müller»'), '(max <-> müller)')
  assertEquals(alsTsquery('Kaution "drei Monatsmieten" Ulm'), 'kaution:* & (drei <-> monatsmieten) & ulm:*')
  // Ein Wort in Anführungszeichen: genau dieses Wort, kein Wortanfang
  assertEquals(alsTsquery('"Haus"'), 'haus')
  // Noch offen (man tippt gerade): letztes Wort als Anfang
  assertEquals(alsTsquery('"Max Mü'), '(max <-> mü:*)')
  // Einzelne Ziffer in einer Folge bleibt
  assertEquals(alsTsquery('"Haus 3"'), '(haus <-> 3)')
  // Leere Anführungszeichen
  assertEquals(alsTsquery('"" Ulm'), 'ulm:*')
})

Deno.test('Zusammengesetztes: Teile direkt hintereinander, letzter als Anfang', () => {
  assertEquals(alsTsquery('Müller-Lüdenscheidt'), '(müller <-> lüdenscheidt:*)')
  assertEquals(alsTsquery('07162/45569'), '(07162 <-> 45569:*)')
  assertEquals(alsTsquery("O'Brien"), 'brien:*')
  // kombinierende Zeichen bleiben am Wort (İ wird klein zu i + Punkt)
  assertEquals(alsTsquery('İstanbul'), 'i̇stanbul:*')
})

Deno.test('E-Mail-Adressen bleiben ein Begriff', () => {
  assertEquals(alsTsquery('info@amayer-holding.com'), "'info@amayer-holding.com':*")
  assertEquals(alsTsquery('<Info@Amayer-Holding.com>,'), "'info@amayer-holding.com':*")
  assertEquals(alsTsquery('info@'), "'info@':*")
})

Deno.test('Ausschluss mit Minus; nur Ausschlüsse ergeben keine Suche', () => {
  assertEquals(alsTsquery('Kaution -Testament'), 'kaution:* & !testament:*')
  assertEquals(alsTsquery('Kaution -"Max Müller"'), 'kaution:* & !(max <-> müller)')
  assertEquals(alsTsquery('-Testament'), '')
  assertEquals(alsTsquery('Bau - Plan'), 'bau:* & plan:*')
})

Deno.test('ODER und |', () => {
  assertEquals(alsTsquery('Erbschein ODER Testament'), '(erbschein:* | testament:*)')
  assertEquals(alsTsquery('Ulm Erbschein | Testament'), 'ulm:* & (erbschein:* | testament:*)')
  assertEquals(alsTsquery('a ODER b ODER Haus'), 'haus:*')
  // klein geschrieben ist es ein normales Wort
  assertEquals(alsTsquery('Haus oder Wohnung'), 'haus:* & oder:* & wohnung:*')
  // am Anfang oder Ende ohne Wirkung
  assertEquals(alsTsquery('ODER Haus |'), 'haus:*')
})

Deno.test('Sonderzeichen und Operatoren werden nie durchgereicht', () => {
  assertEquals(alsTsquery("kaution:* & !x | ( ' \\ ;--"), 'kaution:*')
  assertEquals(alsTsquery("'); drop table kunden; --"), 'drop:* & table:* & kunden:*')
  assertEquals(alsTsquery('a b c'), '')
  assertEquals(alsTsquery(''), '')
  assertEquals(alsTsquery('   '), '')
  // @ts-expect-error absichtlich falscher Typ
  assertEquals(alsTsquery(null), '')
  const q = alsTsquery('<script>alert(1)</script> Müller')
  assertEquals(/^[\p{L}\p{N}&|!<>()*:' -]*$/u.test(q), true)
})

Deno.test('Höchstens zehn Begriffe, lange Eingaben gekürzt', () => {
  const viele = Array.from({ length: 30 }, (_, i) => `wort${i}`).join(' ')
  assertEquals(zerlegeSuche(viele).length, MAX_BEGRIFFE)
  assertEquals(alsTsquery('x'.repeat(5000)).length <= 303, true)
})

Deno.test('Gesuchte Teile und Ausschnitte', () => {
  assertEquals(gesuchteTeile('Max "Müller Lüdenscheidt" -Huber'), ['max', 'müller', 'lüdenscheidt'])
  assertEquals(ausschnittTeile('Die ⟦Kaution⟧ für ⟦Ulm⟧.'), [
    { text: 'Die ', treffer: false },
    { text: 'Kaution', treffer: true },
    { text: ' für ', treffer: false },
    { text: 'Ulm', treffer: true },
    { text: '.', treffer: false },
  ])
  assertEquals(ausschnittTeile('ohne Treffer'), [{ text: 'ohne Treffer', treffer: false }])
  assertEquals(ausschnittTeile('⟦offen'), [{ text: 'offen', treffer: true }])
  assertEquals(ausschnittTeile(null), [])
  assertEquals(ausschnittText('Die ⟦Kaution⟧'), 'Die Kaution')
})
