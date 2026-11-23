// Abend-Rückblick im Mayer-Bot (abendRueckblickWerkzeug.ts): Werkzeug „Abend-Rückblick aus/an“ und Knopf mit
// Ersetzen der Nachricht. Kein Netz: Testdatenbank und ein Telegram-Ersatz.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehreAbendRueckblickWerkzeugAus, istAbendRueckblickWerkzeug, verarbeiteAbendKnopf } from './abendRueckblickWerkzeug.ts'

const MO_1740 = new Date('2026-11-23T16:40:00Z')

function welt() {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm_e', name: 'Eray Yesil', email: 'e@x.de', rolle: 'mitarbeiter', ist_admin: true, bereiche: [], telegram_chat_id: 333, aktiv: true },
      { id: 'm_q', name: 'Quirin Lutzenberger', email: 'q@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'], telegram_chat_id: 111, aktiv: true },
    ],
    assistent_hinweise: [],
    todos: [
      { id: 't1', aufgabe: 'Angebot nachfassen', besitzer_email: 'e@x.de', bereich: null, zustaendig: null, erledigt_am: null, erledigen_bis: '2026-11-20', geplante_wiedervorlage: null, ms_id: null },
      { id: 't2', aufgabe: 'Rückruf', besitzer_email: 'e@x.de', bereich: null, zustaendig: null, erledigt_am: null, erledigen_bis: '2026-11-23', geplante_wiedervorlage: null, ms_id: null },
    ],
  })
}

const NACHRICHT = {
  message_id: 77,
  chat: { id: 333 },
  text: '🌙 Rückblick Montag, 23.11.\n✓ Heute erledigt: 0\nNoch offen (2):\n1. Angebot nachfassen – überfällig seit 20.11.\n2. Rückruf – fällig heute\nMorgen: keine Termine, keine Wiedervorlagen',
  reply_markup: {
    inline_keyboard: [
      [{ text: '✓ Erledigt (1)', callback_data: 'ar:e:t1' }, { text: '→ Morgen (1)', callback_data: 'ar:m:t1' }],
      [{ text: '✓ Erledigt (2)', callback_data: 'ar:e:t2' }, { text: '→ Morgen (2)', callback_data: 'ar:m:t2' }],
    ],
  },
}

function umgebung() {
  const antworten: string[] = []
  const aufrufe: { methode: string; daten: Record<string, unknown> }[] = []
  return {
    antworten,
    aufrufe,
    antworte: (t: string) => (antworten.push(t), Promise.resolve()),
    telegram: (methode: string, daten: Record<string, unknown>) => (aufrufe.push({ methode, daten }), Promise.resolve({})),
  }
}

Deno.test('Werkzeug: an/aus nur für sich, nicht im privaten Assistenten', async () => {
  assert(istAbendRueckblickWerkzeug('abend_rueckblick_einstellen'))
  const db = welt()
  const protokoll: string[] = []
  const k = { supabase: db, mitarbeiter: { name: 'Eray Yesil', email: 'E@x.de', rolle: 'mitarbeiter', ist_admin: true, bereiche: [] }, protokolliere: (t: string) => void protokoll.push(t) }
  assertStringIncludes(await fuehreAbendRueckblickWerkzeugAus('abend_rueckblick_einstellen', { an: false }, k), 'ist für dich aus')
  assertEquals(db.tabelle('assistent_hinweise').map((z) => [z.email, z.abend_rueckblick]), [['e@x.de', false]])
  assertStringIncludes(await fuehreAbendRueckblickWerkzeugAus('abend_rueckblick_einstellen', { an: true }, k), 'ist für dich an')
  assertEquals(db.tabelle('assistent_hinweise').map((z) => z.abend_rueckblick), [true])
  assertEquals(protokoll, ['Abend-Rückblick ausgeschaltet', 'Abend-Rückblick eingeschaltet'])
  assertStringIncludes(await fuehreAbendRueckblickWerkzeugAus('abend_rueckblick_einstellen', {}, k), 'Fehler')
  const privat = { ...k, mitarbeiter: { ...k.mitarbeiter, nurPrivat: true } }
  assertStringIncludes(await fuehreAbendRueckblickWerkzeugAus('abend_rueckblick_einstellen', { an: false }, privat), 'privaten Assistenten')
})

Deno.test('Knopf: erledigt, Antwort am Knopf, Nachricht ersetzt (Zeile mit Vermerk, nur ihre Knöpfe weg)', async () => {
  const db = welt()
  const u = umgebung()
  await verarbeiteAbendKnopf({ supabase: db, knopf: { id: 'k1', data: 'ar:e:t2', message: NACHRICHT }, antworte: u.antworte, telegram: u.telegram, jetzt: MO_1740 })
  assertEquals(u.antworten, ['Erledigt: „Rückruf“'])
  assertEquals(db.tabelle('todos').find((t) => t.id === 't2')?.erledigt_am, '2026-11-23')
  assertEquals(u.aufrufe.length, 1)
  assertEquals(u.aufrufe[0].methode, 'editMessageText')
  assertEquals(u.aufrufe[0].daten.message_id, 77)
  assertStringIncludes(String(u.aufrufe[0].daten.text), '2. Rückruf – fällig heute — ✓ erledigt')
  assertEquals((u.aufrufe[0].daten.reply_markup as { inline_keyboard: unknown[] }).inline_keyboard, [NACHRICHT.reply_markup.inline_keyboard[0]])
})

Deno.test('Knopf: fremder Chat darf Erays Aufgabe nicht anfassen; unbekannter Chat bekommt nur einen Hinweis', async () => {
  const db = welt()
  const u = umgebung()
  await verarbeiteAbendKnopf({ supabase: db, knopf: { id: 'k2', data: 'ar:e:t1', message: { ...NACHRICHT, chat: { id: 111 } } }, antworte: u.antworte, telegram: u.telegram, jetzt: MO_1740 })
  assertEquals(u.antworten, ['Diese Aufgabe gibt es in deinen Listen nicht.'])
  assertEquals(u.aufrufe.length, 0)
  assertEquals(db.tabelle('todos').find((t) => t.id === 't1')?.erledigt_am, null)

  const u2 = umgebung()
  await verarbeiteAbendKnopf({ supabase: db, knopf: { id: 'k3', data: 'ar:e:t1', message: { ...NACHRICHT, chat: { id: 999 } } }, antworte: u2.antworte, telegram: u2.telegram, jetzt: MO_1740 })
  assertEquals(u2.antworten, ['Dieser Chat ist mit keinem CRM-Zugang verbunden.'])
})
