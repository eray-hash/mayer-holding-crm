// Prüft die Absicherung der Speicherpfade (Prüfung vom 20.11.2026).
import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { eigenerSpeicher, istSichererPfad, pruefeSpeicherPfad } from './speicherPfad.ts'

Deno.test('sichere Pfade', () => {
  for (const ok of ['k_1/dok_a_Vertrag 2023.pdf', 'telegram/1795_h1_foto.jpg', 'k_eingang_ungeklaert/dok_x_Zahlungsliste_vom_17.11.2026_.pdf', 'ä/ö ü.pdf']) assertEquals(istSichererPfad(ok), true, ok)
  for (const boese of ['', '../x', 'a/../b', 'a/./b', '/a', 'a//b', 'a/b?x', 'a#b', 'a\\b', 'a/%2e%2e/b', 'a\u0000b', 'a/b/']) assertEquals(istSichererPfad(boese), false, JSON.stringify(boese))
})

Deno.test('nur bekannte Eimer', () => {
  assertEquals(pruefeSpeicherPfad('kunden-dokumente', 'k/x.pdf'), 'k/x.pdf')
  assertThrows(() => pruefeSpeicherPfad('geheim', 'k/x.pdf'))
  assertThrows(() => pruefeSpeicherPfad('kunden-dokumente', '../rest/v1/x'))
})

Deno.test('eigener Speicher nur bei gleichem Ursprung', () => {
  const b = 'https://p.supabase.co'
  assertEquals(eigenerSpeicher(`${b}/storage/v1/object/public/email-anhaenge/a%20b.pdf`, b), { eimer: 'email-anhaenge', pfad: 'a b.pdf' })
  assertEquals(eigenerSpeicher(`${b}/storage/v1/object/sign/kunden-dokumente/k/x.pdf?token=1`, b), { eimer: 'kunden-dokumente', pfad: 'k/x.pdf' })
  assertEquals(eigenerSpeicher('https://p.supabase.co.boese.tld/storage/v1/object/public/email-anhaenge/a.pdf', b), null)
  assertEquals(eigenerSpeicher(`${b}/storage/v1/object/public/email-anhaenge/../../../rest/v1/mitarbeiter`, b), null)
  assertEquals(eigenerSpeicher(`${b}/storage/v1/object/public/email-anhaenge/%2e%2e/%2e%2e/auth/v1/admin/users`, b), null)
  assertEquals(eigenerSpeicher('http://169.254.169.254/latest/meta-data', b), null)
})
