// Erinnerungs-Werkzeuge und Knöpfe (erinnerungWerkzeuge.ts).
//   npx -y deno test --allow-all --no-check telegram-gateway/erinnerungWerkzeuge.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehreErinnerungWerkzeugAus, verarbeiteErinnerungKnopf } from './erinnerungWerkzeuge.ts'

const JETZT = Date.parse('2026-11-25T08:00:00.000Z') // 09:00 Berlin
const ERIKA = { id: 'm1', name: 'Erika Beispiel', email: 'erika@firma.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] as string[] }

function db(extra: Record<string, Record<string, unknown>[]> = {}) {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', name: 'Erika Beispiel', email: 'erika@firma.de', telegram_chat_id: 101, aktiv: true },
      { id: 'm2', name: 'Max Muster', email: 'max@firma.de', telegram_chat_id: 202, aktiv: true },
      { id: 'm3', name: 'Paula Ohne', email: 'paula@firma.de', telegram_chat_id: null, aktiv: true },
    ],
    kunden: [
      { id: 'k1', bereich: 'beratung', firma: 'Muster GmbH', verantwortlich_email: 'erika@firma.de' },
      { id: 'k2', bereich: 'privat', firma: 'Privatkontakt', verantwortlich_email: 'erika@firma.de' },
    ],
    erinnerungen: [],
    ...extra,
  })
}

function ctx(d: ReturnType<typeof db>, privat = false) {
  const aktionen: string[] = []
  return { k: { supabase: d, mitarbeiter: privat ? { ...ERIKA, nurPrivat: true } : ERIKA, protokolliere: (t: string) => aktionen.push(t), privat, jetzt: JETZT }, aktionen }
}

Deno.test('erinnerung_anlegen für einen Kollegen: Zeile mit von/fuer, keine To-do, Bestätigungstext', async () => {
  const d = db()
  const { k } = ctx(d)
  const r = await fuehreErinnerungWerkzeugAus('erinnerung_anlegen', { text: 'Bestätigungsschreiben prüfen', wann: '2026-11-25T12:00', fuer: 'Max', kunde_id: 'k1' }, k)
  assertStringIncludes(r, 'ERINNERUNG GESPEICHERT (kein To-do)')
  assertStringIncludes(r, '(von Erika)')
  const z = d.tabelle('erinnerungen')
  assertEquals(z.length, 1)
  assertEquals([z[0].fuer_email, z[0].von_email, z[0].faellig_um, z[0].kunde_id, z[0].privat, z[0].quelle], ['max@firma.de', 'erika@firma.de', '2026-11-25T11:00:00.000Z', 'k1', false, 'telegram'])
  assertEquals(d.tabelle('todos').length, 0)
})

Deno.test('erinnerung_anlegen: Vergangenheit, Kollege ohne Telegram, private Akte für Kollegen → nicht angelegt', async () => {
  const d = db()
  const { k } = ctx(d)
  assertStringIncludes(await fuehreErinnerungWerkzeugAus('erinnerung_anlegen', { text: 'x', wann: '2026-11-25T08:00' }, k), 'Vergangenheit')
  assertStringIncludes(await fuehreErinnerungWerkzeugAus('erinnerung_anlegen', { text: 'x', wann: '2026-11-25T12:00', fuer: 'Paula' }, k), 'nicht mit Telegram verbunden')
  assertStringIncludes(await fuehreErinnerungWerkzeugAus('erinnerung_anlegen', { text: 'x', wann: '2026-11-25T12:00', fuer: 'Max', kunde_id: 'k2' }, k), 'privater Kontakt')
  assertStringIncludes(await fuehreErinnerungWerkzeugAus('erinnerung_anlegen', { text: 'x', wann: '2026-11-25T12:00', fuer: 'Niemand' }, k), 'kein eindeutiger Kollege')
  assertEquals(d.tabelle('erinnerungen').length, 0)
})

Deno.test('Privater Assistent: eigene Erinnerung privat, keine für Kollegen; Mayer-Seite sieht private nicht', async () => {
  const d = db()
  const p = ctx(d, true)
  assertStringIncludes(await fuehreErinnerungWerkzeugAus('erinnerung_anlegen', { text: 'x', wann: '2026-11-25T12:00', fuer: 'Max' }, p.k), 'nur Erinnerungen für dich selbst')
  assertStringIncludes(await fuehreErinnerungWerkzeugAus('erinnerung_anlegen', { text: 'Arzttermin', wann: '2026-11-25T12:00', fuer: 'ich' }, p.k), 'GESPEICHERT')
  assertEquals(d.tabelle('erinnerungen')[0].privat, true)
  assertStringIncludes(await fuehreErinnerungWerkzeugAus('erinnerungen_zeigen', {}, p.k), 'Arzttermin')
  const m = ctx(d, false)
  assertEquals(await fuehreErinnerungWerkzeugAus('erinnerungen_zeigen', {}, m.k), 'Keine offenen Erinnerungen.')
})

Deno.test('zeigen, verschieben, löschen', async () => {
  const d = db()
  const { k } = ctx(d)
  await fuehreErinnerungWerkzeugAus('erinnerung_anlegen', { text: 'Bank anrufen', wann: '2026-11-25T12:00' }, k)
  await fuehreErinnerungWerkzeugAus('erinnerung_anlegen', { text: 'Vertrag prüfen', wann: '2026-11-26T09:00', fuer: 'Max' }, k)
  const liste = await fuehreErinnerungWerkzeugAus('erinnerungen_zeigen', {}, k)
  assertStringIncludes(liste, 'An dich (1)')
  assertStringIncludes(liste, 'für Max Muster')
  d.tabelle('erinnerungen')[0].gesendet_am = '2026-11-25T11:00:00.000Z'
  assertStringIncludes(await fuehreErinnerungWerkzeugAus('erinnerung_verschieben', { suchbegriff: 'bank', wann: '2026-11-25T15:00' }, k), 'Verschoben')
  assertEquals([d.tabelle('erinnerungen')[0].faellig_um, d.tabelle('erinnerungen')[0].gesendet_am], ['2026-11-25T14:00:00.000Z', null])
  assertStringIncludes(await fuehreErinnerungWerkzeugAus('erinnerung_loeschen', { suchbegriff: 'vertrag' }, k), 'Gelöscht')
  assertEquals(d.tabelle('erinnerungen').length, 1)
})

const ID = '11111111-1111-4111-8111-111111111111'
function knopfDb(z: Record<string, unknown> = {}) {
  return db({ erinnerungen: [{ id: ID, fuer_email: 'max@firma.de', von_email: 'erika@firma.de', von_name: 'Erika Beispiel', text: 'Vertrag prüfen', faellig_um: '2026-11-25T08:00:00.000Z', gesendet_am: '2026-11-25T08:00:10.000Z', erledigt_am: null, wiederholung: '', privat: false, ...z }] })
}
function knopf(daten: string, chat = 202) {
  return { id: 'cb1', data: daten, message: { message_id: 5, chat: { id: chat }, text: '⏰ Erinnerung: Vertrag prüfen' } }
}

Deno.test('Knopf Erledigt / In 1 Stunde: nur der Empfänger, Nachricht ohne Knöpfe ersetzt', async () => {
  const d = knopfDb()
  const antworten: string[] = []
  const telegram: [string, Record<string, unknown>][] = []
  const k = { supabase: d, antworte: async (t: string) => antworten.push(t), telegram: async (m: string, x: Record<string, unknown>) => (telegram.push([m, x]), null), jetzt: JETZT }
  await verarbeiteErinnerungKnopf({ ...k, knopf: knopf(`er:s:${ID}`, 101) })
  assertEquals(antworten.pop(), 'Diese Erinnerung gibt es nicht mehr.')
  await verarbeiteErinnerungKnopf({ ...k, knopf: knopf(`er:s:${ID}`) })
  assertEquals(antworten.pop(), '→ kommt um 10:00 Uhr nochmal')
  assertEquals([d.tabelle('erinnerungen')[0].faellig_um, d.tabelle('erinnerungen')[0].gesendet_am], ['2026-11-25T09:00:00.000Z', null])
  assertEquals(telegram[0][0], 'editMessageText')
  assertEquals((telegram[0][1].reply_markup as { inline_keyboard: unknown[] }).inline_keyboard, [])
  await verarbeiteErinnerungKnopf({ ...k, knopf: knopf(`er:e:${ID}`) })
  assert(d.tabelle('erinnerungen')[0].erledigt_am)
})

Deno.test('Knopf bei Wiederholung: später = einmalige Kopie, Reihe bleibt', async () => {
  const d = knopfDb({ wiederholung: 'taeglich', gesendet_am: null, faellig_um: '2026-11-26T08:00:00.000Z' })
  const k = { supabase: d, antworte: async () => undefined, telegram: async () => null, jetzt: JETZT }
  await verarbeiteErinnerungKnopf({ ...k, knopf: knopf(`er:s:${ID}`) })
  const alle = d.tabelle('erinnerungen')
  assertEquals(alle.length, 2)
  assertEquals(alle[0].faellig_um, '2026-11-26T08:00:00.000Z')
  assertEquals([alle[1].faellig_um, alle[1].wiederholung], ['2026-11-25T09:00:00.000Z', ''])
  await verarbeiteErinnerungKnopf({ ...k, knopf: knopf(`er:e:${ID}`) })
  assertEquals(alle[0].erledigt_am, null)
})
