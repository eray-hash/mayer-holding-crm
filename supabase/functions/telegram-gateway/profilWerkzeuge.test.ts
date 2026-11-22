// Prüft mein_profil_aendern (nur eigene Zeile, nur geänderte Felder, Prüfung der Nummer, Signatur als
// sicheres HTML) und die einmalige Nachfrage nach der Telefonnummer mit der Test-Datenbank (ohne Netz).
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { TELEFON_NACHFRAGE } from '../_shared/profilKern.ts'
import { fuehreProfilWerkzeugAus, istProfilWerkzeug, nachfrageAnhaengen, profilNachfrage } from './profilWerkzeuge.ts'

const ICH = '11111111-1111-1111-1111-111111111111'
const KOLLEGE = '22222222-2222-2222-2222-222222222222'

function db(extra: Record<string, Record<string, unknown>[]> = {}) {
  return falscheDatenbank({
    mitarbeiter: [
      { id: ICH, name: 'Quirin Test', email: 'q@x.de', aktiv: true, telefon: null, signatur_html: null },
      { id: KOLLEGE, name: 'Hasan Test', email: 'h@x.de', aktiv: true, telefon: '0731 1', signatur_html: '<p>H</p>' },
    ],
    mitarbeiter_profil: [],
    ...extra,
  })
}

function ctx(d: ReturnType<typeof db>) {
  const log: string[] = []
  return { supabase: d, mitarbeiter: { id: ICH, name: 'Quirin Test' }, protokolliere: (t: string) => log.push(t), log }
}

Deno.test('Werkzeugname wird erkannt', () => {
  assert(istProfilWerkzeug('mein_profil_aendern'))
  assert(!istProfilWerkzeug('kunde_anlegen'))
})

Deno.test('Ohne Angaben: Stand und Lücken, nichts geschrieben', async () => {
  const d = db()
  const c = ctx(d)
  const r = await fuehreProfilWerkzeugAus('mein_profil_aendern', {}, c)
  assertStringIncludes(r, 'Telefon: –')
  assertStringIncludes(r, 'Es fehlt noch: Telefonnummer, E-Mail-Signatur, Funktion')
  assertEquals(d.protokoll.filter((p) => p.art !== 'select').length, 0)
  assertEquals(c.log.length, 0)
})

Deno.test('Telefon und Funktion: nur eigene Zeile, nur geänderte Felder', async () => {
  const d = db()
  const c = ctx(d)
  const r = await fuehreProfilWerkzeugAus('mein_profil_aendern', { telefon: ' 0731  987 654 ', position: 'Immobilienberater' }, c)
  assertStringIncludes(r, 'Gespeichert: Telefon 0731 987 654, Funktion „Immobilienberater“')
  const ich = d.tabelle('mitarbeiter').find((m) => m.id === ICH)!
  const kollege = d.tabelle('mitarbeiter').find((m) => m.id === KOLLEGE)!
  assertEquals(ich.telefon, '0731 987 654')
  assertEquals(ich.signatur_html, null)
  assertEquals(kollege.telefon, '0731 1')
  const z = d.tabelle('mitarbeiter_profil')
  assertEquals(z.length, 1)
  assertEquals(z[0].id, ICH)
  assertEquals(z[0].position, 'Immobilienberater')
  assertEquals(c.log.length, 1)
  assertStringIncludes(c.log[0], 'Eigenes Profil geändert')
  // Gleiches noch einmal: nichts zu schreiben, kein Protokoll.
  const r2 = await fuehreProfilWerkzeugAus('mein_profil_aendern', { telefon: '0731 987 654' }, c)
  assertStringIncludes(r2, 'Schon so eingetragen')
  assertEquals(c.log.length, 1)
})

Deno.test('Ungültige Nummer: Fehler, nichts geschrieben', async () => {
  const d = db()
  const r = await fuehreProfilWerkzeugAus('mein_profil_aendern', { telefon: 'ruf mich an', position: 'X' }, ctx(d))
  assert(r.startsWith('Fehler: '))
  assertEquals(d.protokoll.filter((p) => p.art !== 'select').length, 0)
})

Deno.test('Signatur aus Text wird maskiert und mit Zeilenumbrüchen gespeichert', async () => {
  const d = db()
  await fuehreProfilWerkzeugAus('mein_profil_aendern', { signatur: 'Quirin <b>Test</b>\nImmobilien & mehr' }, ctx(d))
  const ich = d.tabelle('mitarbeiter').find((m) => m.id === ICH)!
  assertEquals(ich.signatur_html, 'Quirin &lt;b&gt;Test&lt;/b&gt;<br>Immobilien &amp; mehr')
})

Deno.test('Nachfrage: genau einmal, dann nie wieder', async () => {
  const d = db()
  assertEquals(await profilNachfrage(d, { id: ICH }), TELEFON_NACHFRAGE)
  assertEquals(await profilNachfrage(d, { id: ICH }), null)
  assert(d.tabelle('mitarbeiter_profil')[0].telefon_gefragt_am)
})

Deno.test('Nachfrage: bestehende Zeile ohne Merker wird beansprucht', async () => {
  const d = db({ mitarbeiter_profil: [{ id: ICH, mobil: null, position: 'X', profil_nachfrage: true, telefon_gefragt_am: null }] })
  assertEquals(await profilNachfrage(d, { id: ICH }), TELEFON_NACHFRAGE)
  assertEquals(await profilNachfrage(d, { id: ICH }), null)
})

Deno.test('Nachfrage: nicht bei vorhandener Nummer, Mobilnummer oder abgeschalteter Einstellung', async () => {
  assertEquals(await profilNachfrage(db(), { id: KOLLEGE }), null)
  assertEquals(await profilNachfrage(db({ mitarbeiter_profil: [{ id: ICH, mobil: '0176 1234567', profil_nachfrage: true, telefon_gefragt_am: null }] }), { id: ICH }), null)
  assertEquals(await profilNachfrage(db({ mitarbeiter_profil: [{ id: ICH, mobil: null, profil_nachfrage: false, telefon_gefragt_am: null }] }), { id: ICH }), null)
})

Deno.test('Nachfrage wird an Antwort und gespeicherten Verlauf gehängt', () => {
  const state = { zuege: [{ msgs: [{ role: 'user', content: 'Hallo' }, { role: 'assistant', content: 'Erledigt.' }] }] }
  const aus = nachfrageAnhaengen(state, 'Erledigt.', 'Frage?')
  assertEquals(aus, 'Erledigt.\n\nFrage?')
  assertEquals(state.zuege[0].msgs[1].content, 'Erledigt.\n\nFrage?')
})
