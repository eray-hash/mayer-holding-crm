// Prüft das Ergänzen der Stammdaten aus Signaturen mit einer Datenbank im Speicher (ohne Netz):
// nur leere Felder füllen, nie überschreiben, Vorschläge ohne Doppelte, Takt und Reihum-Zeiger,
// private Akten/Postfächer, Mitarbeiter-Mails und der Nachtrag mit Vorschau (nur Geschäftsführung).
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { alsVorschlaege } from '../_shared/stammdatenVorschlag.ts'
import { nachtragVorschau, pruefeStammdaten, STAND_ID, stammdatenNachtragAktion } from './stammdatenErgaenzen.ts'

const MITARBEITER: Zeile[] = [
  { id: 'm1', name: 'Andreas Mayer', email: 'info@amayer-holding.com', telefon: '0731 1234567', signatur_html: null },
  { id: 'm2', name: 'Quirin Lutzenberger', email: 'immo@amayer-holding.com', telefon: null, signatur_html: null },
]

// deno-lint-ignore no-explicit-any
type Lose = Record<string, any>
type Db = ReturnType<typeof falscheDatenbank>
const kunde = (db: Db, id: string): Lose => db.tabelle('kunden').find((k) => k.id === id) as Lose
const stand = (db: Db): Lose => (db.tabelle('abteilung_eintraege').find((z) => z.id === STAND_ID) as Lose).daten

function akte(id: string, felder: Partial<Zeile> = {}): Zeile {
  return { id, bereich: 'beratung', firma: `Firma ${id}`, ansprechpartner: '', email: '', telefon: '', anschrift: null, activities: [], stammdaten_vorschlaege: null, ...felder }
}

function mail(id: string, von: string, text: string, felder: Partial<Zeile> = {}): Zeile {
  return { id, message_id: `<${id}>`, von, von_name: '', mail_datum: '2026-11-10T09:00:00+00:00', ausschnitt: text, rohdaten: {}, besitzer_email: null, zugewiesener_kunde_id: null, ...felder }
}

const SIGNATUR_MAX = `Hallo Herr Mayer,
anbei die Unterlagen.

Mit freundlichen Grüßen
Max Muster
Muster Bau GmbH
Hauptstr. 5
89073 Ulm
Tel. 0731 987650
Mobil 0171 2345678`

function datenbank(): Db {
  return falscheDatenbank({
    mitarbeiter: MITARBEITER,
    kunden: [
      akte('k_a', { email: 'max@muster-bau.de' }), // alles leer → ergänzen
      akte('k_b', { email: 'eva@beispiel.de', telefon: '0731 111111', anschrift: 'Altweg 1\n89073 Ulm' }), // Widerspruch → Vorschlag
      akte('k_c', { email: 'otto@privat.de', bereich: 'privat', verantwortlich_email: 'info@amayer-holding.com' }), // privat → nie
      akte('k_d', { email: '', ansprechpartner: 'Lena Lustig', firma: 'Lustig Design' }), // ohne Adresse → Absender per Name
      akte('k_e', { email: 'max@muster-bau.de', telefon: '0171 2345678', anschrift: 'Hauptstraße 5, 89073 Ulm' }), // vollständig und bekannt
    ],
    eingegangene_emails: [
      mail('e1', 'Max@Muster-Bau.de', SIGNATUR_MAX, { zugewiesener_kunde_id: 'k_a' }),
      mail('e2', 'eva@beispiel.de', 'Hallo\nViele Grüße\nEva Beispiel\nTel.: 0731 222222\nNeuer Weg 7\n89077 Ulm', { zugewiesener_kunde_id: 'k_b', mail_datum: '2026-11-12T08:00:00+00:00' }),
      mail('e3', 'otto@privat.de', 'Gruß\nOtto\nTel. 0731 333333', { zugewiesener_kunde_id: 'k_c' }),
      mail('e4', 'lena@lustig-design.de', 'Hallo\nLG\nLena Lustig\nTelefon 089 4444444', { zugewiesener_kunde_id: 'k_d', von_name: 'Lena Lustig' }),
      mail('e7', 'max@muster-bau.de', SIGNATUR_MAX, { zugewiesener_kunde_id: 'k_e' }),
      mail('e5', 'info@amayer-holding.com', 'Hallo\nMit freundlichen Grüßen\nAndreas Mayer\nTel. 0731 9999999', { zugewiesener_kunde_id: 'k_a' }),
      // persönliches Postfach, nicht zugeordnet: zählt nicht
      mail('e6', 'max@muster-bau.de', 'Hallo\nGruß\nMax\nTel. 0731 555555', { besitzer_email: 'immo@amayer-holding.com', mail_datum: '2026-11-20T08:00:00+00:00' }),
    ],
    gesendete_emails: [],
    abteilung_eintraege: [],
  })
}

Deno.test('Leere Felder werden ergänzt (mit Verlauf), gefüllte nie überschrieben, Widerspruch wird Vorschlag', async () => {
  const db = datenbank()
  const r = await pruefeStammdaten(db, { jetzt: new Date('2026-11-22T10:00:00Z') })
  assert(r.gelaufen)
  assertEquals(r.geprueft, 4) // k_a, k_b, k_d, k_e (k_c privat)

  const a = kunde(db, 'k_a')
  assertEquals(a.telefon, '0731 987650')
  assertEquals(a.anschrift, 'Hauptstr. 5\n89073 Ulm')
  assertEquals(a.activities.length, 2)
  assertStringIncludes(a.activities.map((x: Lose) => x.text).join('|'), 'Telefon aus E-Mail-Signatur vom 10.11.2026 ergänzt: 0731 987650 (außerdem genannt: 0171 2345678)')
  assertEquals(a.activities[0].user, 'automatisch')
  assertEquals(a.activities[0].date, '2026-11-22')
  assertEquals(a.stammdaten_vorschlaege, null)

  const b = kunde(db, 'k_b')
  assertEquals(b.telefon, '0731 111111')
  assertEquals(b.anschrift, 'Altweg 1\n89073 Ulm')
  const v = alsVorschlaege(b.stammdaten_vorschlaege)
  assertEquals(v.map((x) => [x.feld, x.wert, x.bisher, x.status, x.mailDatum]), [
    ['telefon', '0731 222222', '0731 111111', 'offen', '2026-11-12'],
    ['anschrift', 'Neuer Weg 7\n89077 Ulm', 'Altweg 1\n89073 Ulm', 'offen', '2026-11-12'],
  ])
  assertEquals(b.activities, [])

  const c = kunde(db, 'k_c')
  assertEquals(c.telefon, '')

  const d = kunde(db, 'k_d')
  assertEquals(d.email, 'lena@lustig-design.de')
  assertEquals(d.telefon, '089 4444444')

  const e = kunde(db, 'k_e')
  assertEquals(e.activities, [])
  assertEquals(e.stammdaten_vorschlaege, null)

  // Zweiter Lauf (nach dem Takt): keine doppelten Vorschläge, keine weiteren Verlaufseinträge.
  const r2 = await pruefeStammdaten(db, { jetzt: new Date('2026-11-22T10:31:00Z') })
  assert(r2.gelaufen)
  assertEquals(r2.ergaenzt + r2.vorgeschlagen, 0)
  assertEquals(alsVorschlaege(kunde(db, 'k_b').stammdaten_vorschlaege).length, 2)
})

Deno.test('Verworfene Vorschläge kommen nicht wieder; eine bekannte Nummer der Akte ist kein Widerspruch', async () => {
  const db = datenbank()
  const b = kunde(db, 'k_b')
  b.stammdaten_vorschlaege = [{ id: 'sv_alt', feld: 'telefon', wert: '+49 731 222222', bisher: '0731 111111', mailDatum: '2026-11-01', erstellt: '2026-11-01T00:00:00Z', status: 'verworfen' }]
  b.telefon = '0731 111111 / mobil 0731 222222'
  await pruefeStammdaten(db, { ohneTakt: true })
  const v = alsVorschlaege(kunde(db, 'k_b').stammdaten_vorschlaege)
  assertEquals(v.map((x) => x.feld), ['telefon', 'anschrift'])
  assertEquals(v[0].id, 'sv_alt')
})

Deno.test('Takt: höchstens alle 30 Minuten; Zeiger läuft reihum', async () => {
  const db = datenbank()
  const r1 = await pruefeStammdaten(db, { jetzt: new Date('2026-11-22T10:00:00Z'), hoechstens: 2 })
  assertEquals([r1.gelaufen, r1.geprueft], [true, 2])
  assertEquals(stand(db).zeiger, 'k_b')
  const r2 = await pruefeStammdaten(db, { jetzt: new Date('2026-11-22T10:10:00Z'), hoechstens: 2 })
  assertEquals(r2.gelaufen, false)
  const r3 = await pruefeStammdaten(db, { jetzt: new Date('2026-11-22T10:40:00Z'), hoechstens: 2 })
  assertEquals([r3.gelaufen, r3.geprueft], [true, 2])
  assertEquals(stand(db).zeiger, 'k_e')
  // k_d wurde im zweiten Stapel ergänzt
  assertEquals(kunde(db, 'k_d').telefon, '089 4444444')
})

Deno.test('Zitierte Kundenantwort in einer gesendeten Mail und nicht zugeordnete Mail im gemeinsamen Postfach zählen', async () => {
  const db = falscheDatenbank({
    mitarbeiter: MITARBEITER,
    kunden: [akte('k_r', { email: 'robin@example.de' })],
    eingegangene_emails: [mail('e9', 'robin@example.de', 'Hallo\nLG\nRobin\nWaldweg 3\n74336 Brackenheim')],
    gesendete_emails: [
      {
        id: 'g1', von: 'info@amayer-holding.com', an: 'robin@example.de', kunde_id: 'k_r', besitzer_email: null, gesendet_am: '2026-10-12T16:00:00Z',
        text: 'Hallo,\nMittwoch passt.\nGruß\nAndreas Mayer\nTel. 0731 1234567\n\n> Am 12.10.2026 um 15:26 schrieb Robin <robin@example.de>:\n> Wäre Mittwoch möglich?\n> Gerne kurzen Rückruf unter 015228467862\n> Lg robin',
      },
    ],
  })
  const vorschau = await nachtragVorschau(db)
  assertEquals(vorschau.zeilen.length, 1)
  assertEquals(vorschau.zeilen[0].ergaenzen.map((e) => [e.feld, e.wert, e.mailDatum]), [
    ['telefon', '015228467862', '2026-10-12'],
    ['anschrift', 'Waldweg 3, 74336 Brackenheim', '2026-11-10'],
  ])
  // Vorschau schreibt nichts
  assertEquals(kunde(db, 'k_r').telefon, '')
})

Deno.test('Nachtrag: nur Geschäftsführung; Vorschau listet, Ausführen rechnet neu und schreibt', async () => {
  const db = datenbank()
  const nein = await stammdatenNachtragAktion(db, { email: 'immo@amayer-holding.com', name: 'Quirin', istGf: false }, { schritt: 'vorschau' })
  assertEquals(nein.status, 403)
  const vorschau = await stammdatenNachtragAktion(db, { email: 'info@amayer-holding.com', name: 'Andreas Mayer', istGf: true }, { schritt: 'vorschau' })
  assertEquals(vorschau.status, 200)
  const zeilen = vorschau.daten.zeilen as { kundeId: string }[]
  assertEquals(zeilen.map((z) => z.kundeId), ['k_a', 'k_b', 'k_d'])
  assertEquals(kunde(db, 'k_a').telefon, '')

  const leer = await stammdatenNachtragAktion(db, { email: 'info@amayer-holding.com', name: 'Andreas Mayer', istGf: true }, { schritt: 'ausfuehren', kundeIds: [] })
  assertEquals(leer.status, 400)
  const aus = await stammdatenNachtragAktion(db, { email: 'info@amayer-holding.com', name: 'Andreas Mayer', istGf: true }, { schritt: 'ausfuehren', kundeIds: ['k_a', 'k_c'] })
  assertEquals(aus.status, 200)
  assertEquals(aus.daten.akten, 1)
  const a = kunde(db, 'k_a')
  assertEquals(a.telefon, '0731 987650')
  assertEquals(a.activities[0].user, 'Andreas Mayer')
  assertEquals(kunde(db, 'k_c').telefon, '')
  assertEquals(kunde(db, 'k_d').telefon, '')
})
