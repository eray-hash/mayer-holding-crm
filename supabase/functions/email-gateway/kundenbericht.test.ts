// Prüft die wöchentliche Erinnerung zum Statusbericht (ohne Netz, ohne echtes Telegram): Zeitfenster,
// Schalter für alle, Wochentag, höchstens einmal am Tag, Empfänger und Inhalt der Nachricht.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { berlinJetzt, pruefeKundenberichte } from './kundenbericht.ts'
import { FalscheDatenbank } from '../_shared/testDoppel.ts'

// Montag, 23.11.2026, 8:05 Uhr in Berlin (Winterzeit = UTC+1).
const MONTAG_8_05 = new Date('2026-11-23T07:05:00Z')

function stand(o: { schalter?: boolean; wochentag?: number; verantwortlich?: string; status?: string } = {}) {
  return new FalscheDatenbank({
    kundenbericht_schalter: [{ id: 1, aktiv: o.schalter ?? true }],
    kundenbericht_einstellung: [{ id: 'k1', kunde_id: 'k1', bereich: 'beratung', aktiv: true, wochentag: o.wochentag ?? 1, letzter_versand: '2026-11-16', letzter_hinweis: null, geaendert_von: 'Eray Yesil' }],
    kunden: [
      {
        id: 'k1',
        bereich: 'beratung',
        firma: 'Muster GmbH',
        ansprechpartner: 'Thomas Beispiel',
        email: 'kunde@beispiel.de',
        verantwortlich: o.verantwortlich ?? 'Hasan Süslü',
        status: o.status ?? 'konzept',
        activities: [],
        dokumente: [],
        unterlagen_anforderungen: [{ datum: '2026-11-10', art: 'anforderung', punkte: ['Personalausweis'], token: 't', eingang: [] }],
      },
    ],
    mitarbeiter: [
      { id: 'm1', name: 'Hasan Süslü', aktiv: true, telegram_chat_id: 111 },
      { id: 'm2', name: 'Eray Yesil', aktiv: true, telegram_chat_id: 222 },
      { id: 'm3', name: 'Quirin Lutzenberger', aktiv: true, telegram_chat_id: null },
    ],
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.test/' }],
    wiedervorlagen: [],
    gesendete_emails: [],
    termine: [],
    kostenvoranschlaege: [],
    rechnungen: [],
  })
}

function fangeTelegram() {
  const gesendet: { chat: number | string; text: string }[] = []
  return { gesendet, sende: (chat: number | string, text: string) => (gesendet.push({ chat, text }), Promise.resolve(true)) }
}

Deno.test('Berliner Zeit und Wochentag', () => {
  assertEquals(berlinJetzt(MONTAG_8_05), { datum: '2026-11-23', stunde: 8, wochentag: 1 })
  assertEquals(berlinJetzt(new Date('2026-11-22T22:30:00Z')).wochentag, 7)
})

Deno.test('außerhalb von 8 bis 11 Uhr: kein Datenbankzugriff', async () => {
  const db = { from: () => { throw new Error('kein Zugriff erwartet') } }
  const t = fangeTelegram()
  const r = await pruefeKundenberichte(db, t.sende, new Date('2026-11-23T06:59:00Z'))
  assertEquals(r.gelaufen, false)
  assertEquals(t.gesendet.length, 0)
  const r2 = await pruefeKundenberichte(db, t.sende, new Date('2026-11-23T10:00:00Z'))
  assertEquals(r2.gelaufen, false)
})

Deno.test('Schalter für alle aus: nichts', async () => {
  const t = fangeTelegram()
  const r = await pruefeKundenberichte(stand({ schalter: false }), t.sende, MONTAG_8_05)
  assertEquals(r.gelaufen, false)
  assertEquals(t.gesendet.length, 0)
})

Deno.test('am Wochentag: eine Nachricht an den Verantwortlichen, nie an den Kunden, nur einmal am Tag', async () => {
  const db = stand()
  const t = fangeTelegram()
  const r = await pruefeKundenberichte(db, t.sende, MONTAG_8_05)
  assertEquals(r.erinnert, 1, r.meldungen.join('\n'))
  assertEquals(t.gesendet.length, 1)
  assertEquals(t.gesendet[0].chat, 111)
  const text = t.gesendet[0].text
  assertStringIncludes(text, 'Statusbericht für Muster GmbH (Thomas Beispiel) ist fertig — bitte prüfen und senden.')
  assertStringIncludes(text, 'Seit 17.11.2026:')
  assertStringIncludes(text, '1 Punkt offen beim Kunden')
  assertStringIncludes(text, 'https://crm.test/#/beratung/kunden/k1?tab=uebersicht&statusbericht=1')
  assertStringIncludes(text, 'An den Kunden geht nichts von selbst')
  assertEquals(db.tabelle('kundenbericht_einstellung')[0].letzter_hinweis, '2026-11-23')
  assertEquals(db.tabelle('gesendete_emails').length, 0)
  // Zweiter Takt am selben Tag: nichts mehr.
  const r2 = await pruefeKundenberichte(db, t.sende, new Date('2026-11-23T07:06:00Z'))
  assertEquals(r2.erinnert, 0)
  assertEquals(t.gesendet.length, 1)
})

Deno.test('anderer Wochentag: nichts', async () => {
  const t = fangeTelegram()
  const r = await pruefeKundenberichte(stand({ wochentag: 3 }), t.sende, MONTAG_8_05)
  assertEquals(r.erinnert, 0)
  assertEquals(t.gesendet.length, 0)
})

Deno.test('Verantwortlicher ohne Telegram: an den, der es eingeschaltet hat', async () => {
  const t = fangeTelegram()
  const r = await pruefeKundenberichte(stand({ verantwortlich: 'Quirin Lutzenberger' }), t.sende, MONTAG_8_05)
  assertEquals(r.erinnert, 1)
  assertEquals(t.gesendet[0].chat, 222)
})

Deno.test('niemand erreichbar oder Fall abgeschlossen: keine Nachricht', async () => {
  const db = stand({ verantwortlich: 'Quirin Lutzenberger' })
  db.tabelle('kundenbericht_einstellung')[0].geaendert_von = 'Unbekannt'
  const t = fangeTelegram()
  const r = await pruefeKundenberichte(db, t.sende, MONTAG_8_05)
  assertEquals(r.ohneEmpfaenger, 1)
  assertEquals(t.gesendet.length, 0)
  const t2 = fangeTelegram()
  const r2 = await pruefeKundenberichte(stand({ status: 'verloren' }), t2.sende, MONTAG_8_05)
  assertEquals(r2.erinnert, 0)
  assert(t2.gesendet.length === 0)
})
