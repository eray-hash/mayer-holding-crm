import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { kiFehlerText } from './kiFehler.ts'

Deno.test('KI-Sperre wird deutsch erklärt, anderes bleibt', () => {
  assertStringIncludes(kiFehlerText('{"message":"You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC."}', 'x'), 'ab 01.12.2026')
  assertStringIncludes(kiFehlerText('Your credit balance is too low', 'x'), 'Guthaben')
  assertEquals(kiFehlerText('overloaded', 'Anthropic-API-Fehler (529): overloaded'), 'Anthropic-API-Fehler (529): overloaded')
})
