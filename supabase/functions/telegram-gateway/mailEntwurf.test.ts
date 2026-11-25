import { assertEquals } from 'jsr:@std/assert@1'
import { behaeltMailEntwurf } from './mailEntwurf.ts'

Deno.test('Mail-Entwurf bleibt nach einer Zwischenfrage freigebbar', () => {
  assertEquals(behaeltMailEntwurf('Mailadresse von Uwe?', true, false, false), true)
  assertEquals(behaeltMailEntwurf('[Datei-Eingang per Telegram — Systemmeldung]', true, false, false), true)
})

Deno.test('Mail-Entwurf verfällt bei Ablehnung, neuer Fassung, Versand oder ohne Entwurf', () => {
  assertEquals(behaeltMailEntwurf('Nein, noch nicht', true, false, false), false)
  assertEquals(behaeltMailEntwurf('[Sprachnachricht des Mitarbeiters, automatisch abgehört]\nlass es', true, false, false), false)
  assertEquals(behaeltMailEntwurf('doch nicht senden', true, false, false), false)
  assertEquals(behaeltMailEntwurf('Ändere den Betreff', true, true, false), false)
  assertEquals(behaeltMailEntwurf('Ja', true, false, true), false)
  assertEquals(behaeltMailEntwurf('Hallo', false, false, false), false)
})
