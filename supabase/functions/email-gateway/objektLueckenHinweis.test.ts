// Prüft den Montags-Hinweis „Was fehlt in deinen Objektakten?“ mit der Testdatenbank (ohne Netz und ohne
// Telegram): Zeitfenster, nur Vorbereitung/Vermarktung, Empfänger je Verantwortlichem, Einstellung aus,
// höchstens einmal pro Woche, private Objekte nur an den Besitzer.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { imHinweisFenster, pruefeObjektLueckenHinweis } from './objektLueckenHinweis.ts'

// 23.11.2026 ist ein Montag; Berlin = UTC+1 im November.
const MONTAG_0835 = new Date('2026-11-23T07:35:00Z')
const MONTAG_0825 = new Date('2026-11-23T07:25:00Z')
const MONTAG_1100 = new Date('2026-11-23T10:00:00Z')
const DIENSTAG_0900 = new Date('2026-11-24T08:00:00Z')
const NAECHSTER_MONTAG = new Date('2026-11-30T08:00:00Z')

function daten(hinweis: Record<string, unknown>[] = []) {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', name: 'Quirin Lutzenberger', email: 'quirin@mayer.de', rolle: 'mitarbeiter', ist_admin: false, aktiv: true, bereiche: ['immobilien'], telegram_chat_id: 111 },
      { id: 'm2', name: 'Andreas Mayer', email: 'andreas@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: false, aktiv: true, bereiche: [], telegram_chat_id: 222 },
      { id: 'm3', name: 'Petra Beratung', email: 'petra@mayer.de', rolle: 'mitarbeiter', ist_admin: false, aktiv: true, bereiche: ['beratung'], telegram_chat_id: 333 },
    ],
    objekte: [
      { id: 'o_lorch', bezeichnung: 'MFH Lorch', status: 'vermarktung', typ: 'Haus', kaufpreis: 0, adresse: 'Teckstraße 62, 73547 Lorch', verantwortlich: 'Quirin', dokumente: {}, privat_besitzer: null },
      { id: 'o_geis', bezeichnung: 'Geislingen', status: 'akquise', typ: 'Haus', kaufpreis: 0, adresse: '', verantwortlich: 'Quirin', dokumente: {}, privat_besitzer: null },
      { id: 'o_beratung', bezeichnung: 'Objekt Petra', status: 'vorbereitung', typ: 'Haus', kaufpreis: 0, adresse: '', verantwortlich: 'Petra Beratung', dokumente: {}, privat_besitzer: null },
      { id: 'o_priv', bezeichnung: 'Privat Andreas', status: 'vorbereitung', typ: 'Wohnung', kaufpreis: 0, adresse: '', verantwortlich: 'Quirin', dokumente: {}, privat_besitzer: 'andreas@mayer.de' },
    ],
    objekt_luecken_hinweis: hinweis,
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.example/' }],
  })
}

function sender() {
  const gesendet: { chat: number | string; text: string }[] = []
  return { gesendet, sende: (chat: number | string, text: string) => (gesendet.push({ chat, text }), Promise.resolve(true)) }
}

Deno.test('Zeitfenster: nur montags 8:30 bis 10:59 Uhr', () => {
  assert(imHinweisFenster(MONTAG_0835))
  assert(!imHinweisFenster(MONTAG_0825))
  assert(!imHinweisFenster(MONTAG_1100))
  assert(!imHinweisFenster(DIENSTAG_0900))
})

Deno.test('außerhalb des Fensters kein Datenbankzugriff', async () => {
  const db = daten()
  const s = sender()
  const r = await pruefeObjektLueckenHinweis(db, s.sende, DIENSTAG_0900)
  assertEquals(r.gelaufen, false)
  assertEquals(db.protokoll.length, 0)
  assertEquals(s.gesendet.length, 0)
})

Deno.test('je Verantwortlichem eine Nachricht, nur Vorbereitung/Vermarktung, private nur an den Besitzer', async () => {
  const db = daten()
  const s = sender()
  const r = await pruefeObjektLueckenHinweis(db, s.sende, MONTAG_0835)
  assertEquals(r.gesendet, 2)
  const quirin = s.gesendet.find((g) => g.chat === 111)!
  assertStringIncludes(quirin.text, 'MFH Lorch (Vermarktung')
  assertStringIncludes(quirin.text, 'Kaufpreis')
  assertStringIncludes(quirin.text, 'https://crm.example/#/immobilien?unvollstaendig=1')
  assert(!quirin.text.includes('Geislingen'), 'Akquise gehört nicht in den Hinweis')
  assert(!quirin.text.includes('Privat Andreas'), 'privates Objekt nur an den Besitzer')
  const andreas = s.gesendet.find((g) => g.chat === 222)!
  assertStringIncludes(andreas.text, 'Privat Andreas')
  // Petra hat keine Rechte für Immobilien
  assert(!s.gesendet.some((g) => g.chat === 333))
  // Woche vermerkt
  const zeilen = db.tabelle('objekt_luecken_hinweis')
  assertEquals(zeilen.map((z) => z.email).sort(), ['andreas@mayer.de', 'quirin@mayer.de'])
  assert(zeilen.every((z) => z.letzte_woche === '2026-11-23'))
})

Deno.test('höchstens einmal pro Woche; nächste Woche wieder', async () => {
  const db = daten()
  const s = sender()
  await pruefeObjektLueckenHinweis(db, s.sende, MONTAG_0835)
  await pruefeObjektLueckenHinweis(db, s.sende, new Date('2026-11-23T08:10:00Z'))
  assertEquals(s.gesendet.length, 2)
  await pruefeObjektLueckenHinweis(db, s.sende, NAECHSTER_MONTAG)
  assertEquals(s.gesendet.length, 4)
})

Deno.test('ausgeschaltet: keine Nachricht', async () => {
  const db = daten([{ email: 'quirin@mayer.de', aktiv: false, letzte_woche: null }])
  const s = sender()
  await pruefeObjektLueckenHinweis(db, s.sende, MONTAG_0835)
  assert(!s.gesendet.some((g) => g.chat === 111))
  assertEquals(db.tabelle('objekt_luecken_hinweis').find((z) => z.email === 'quirin@mayer.de')?.letzte_woche, null)
})

Deno.test('nichts offen: keine Nachricht, nichts vermerkt', async () => {
  const db = daten()
  db.tabellen.objekte = db.tabellen.objekte.filter((o) => o.status === 'akquise')
  const s = sender()
  const r = await pruefeObjektLueckenHinweis(db, s.sende, MONTAG_0835)
  assertEquals(r.gesendet, 0)
  assertEquals(s.gesendet.length, 0)
  assertEquals(db.tabelle('objekt_luecken_hinweis').length, 0)
})
