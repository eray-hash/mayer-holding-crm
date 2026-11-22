// Prüft das Auslesen für den Zahlungsabgleich ohne Netz: erlaubte Ablageorte, CSV ohne KI, Foto über
// eine falsche KI, Zusammenführen der Blöcke.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { erlaubterOrt, fuegeAbgleichZusammen, leseAbgleichAntwort, lieseAuszugFuerAbgleich } from './abgleichAuslesen.ts'

const helfer = (antwort: string, aufrufe: { n: number }) => ({
  callClaudeResearch: () => {
    aufrufe.n++
    return Promise.resolve(antwort)
  },
  restMs: () => 300_000,
  hoechstensMs: 150_000,
})

Deno.test('Nur die beiden erlaubten Ordner', () => {
  assert(erlaubterOrt({ eimer: 'kunden-dokumente', pfad: 'kontoauszug-abgleich/ka_1_auszug.pdf' }))
  assert(erlaubterOrt({ eimer: 'email-anhaenge', pfad: 'telegram/auszug.pdf' }))
  assertEquals(erlaubterOrt({ eimer: 'kunden-dokumente', pfad: 'k_1/ausweis.pdf' }), null)
  assertEquals(erlaubterOrt({ eimer: 'email-anhaenge', pfad: 'telegram/../x.pdf' }), null)
  assertEquals(erlaubterOrt({ eimer: 'objekt-dokumente', pfad: 'telegram/x.pdf' }), null)
})

Deno.test('CSV ohne KI', async () => {
  const db = falscheDatenbank()
  await db.storage.from('kunden-dokumente').upload('kontoauszug-abgleich/a.csv', 'Buchungstag;Verwendungszweck;Betrag\n10.11.2026;RE-2026-010;1.190,00\n')
  const aufrufe = { n: 0 }
  const e = await lieseAuszugFuerAbgleich(db, { datei: { eimer: 'kunden-dokumente', pfad: 'kontoauszug-abgleich/a.csv', name: 'a.csv' } }, helfer('', aufrufe))
  assert(e.ok)
  if (e.ok) assertEquals(e.buchungen[0].betrag, 1190)
  assertEquals(aufrufe.n, 0)
})

Deno.test('Foto über die KI, Verwendungszweck bleibt vollständig', async () => {
  const db = falscheDatenbank()
  await db.storage.from('email-anhaenge').upload('telegram/foto.jpg', new Uint8Array([1, 2, 3]))
  const aufrufe = { n: 0 }
  const antwort = '```json\n{"bank":"Sparkasse","iban":"DE12 3456","von":"2026-11-01","bis":"2026-11-30","buchungen":[{"d":"2026-11-10","z":"RE-2026-010 Kd-Nr 4711","g":"Brot GmbH","i":"DE89 3704","b":1190},{"d":"2026-11-11","z":"x","g":null,"i":null,"b":"12,50 S"},{"d":"2026-11-12","z":"ohne","g":"y","b":null}]}\n```'
  const e = await lieseAuszugFuerAbgleich(db, { datei: { eimer: 'email-anhaenge', pfad: 'telegram/foto.jpg', name: 'foto.jpg' } }, helfer(antwort, aufrufe))
  assert(e.ok)
  if (!e.ok) return
  assertEquals(aufrufe.n, 1)
  assertEquals(e.buchungen.map((b) => b.betrag), [1190, -12.5])
  assertEquals(e.buchungen[0].verwendungszweck, 'RE-2026-010 Kd-Nr 4711')
  assertEquals(e.buchungen[0].gegenIban, 'DE893704')
  assertEquals(e.datei.iban, 'DE123456')
  assert(e.datei.fehler?.includes('ohne lesbaren Betrag'))
})

Deno.test('Fremder Ablageort wird abgelehnt', async () => {
  const e = await lieseAuszugFuerAbgleich(falscheDatenbank(), { datei: { eimer: 'kunden-dokumente', pfad: 'k_1/x.pdf' } }, helfer('', { n: 0 }))
  assertEquals(e.ok, false)
  if (!e.ok) assertEquals(e.status, 403)
})

Deno.test('Blöcke zusammenführen ohne Doppelte an der Grenze', () => {
  const a = leseAbgleichAntwort('{"buchungen":[{"d":"2026-11-01","z":"a","g":"A","b":1},{"d":"2026-11-02","z":"b","g":"B","b":2}]}')
  const b = leseAbgleichAntwort('{"buchungen":[{"d":"2026-11-02","z":"b","g":"B","b":2},{"d":"2026-11-03","z":"c","g":"C","b":3}]}')
  assertEquals(fuegeAbgleichZusammen([a, b]).zeilen.map((z) => z.betrag), [1, 2, 3])
})
