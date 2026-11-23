// Prüft die beiden kleinen Eingangs-Regeln aus Runde 6 ohne Netz:
// - reine Bestätigungen („ok“, „danke“, 👍) bekommen nur eine 👍-Reaktion, wenn der Assistent auf keine Antwort wartet,
// - vorläufige Termine „(Uhrzeit offen)“: Titel/Notiz setzen und wieder entfernen.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { istReineBestaetigung, letzteAssistentText, nurDaumen, reagiereMitDaumen, wartetAufAntwort } from './bestaetigung.ts'
import { hatUhrzeit, istVorlaeufig, NOTIZ_ZEILE, notizOhneHinweis, ohneZusatz, vorlaeufigeNotiz, vorlaeufigerTitel } from './uhrzeitOffen.ts'

const zustand = (assistent: string, extra: Record<string, unknown> = {}) => ({
  zuege: [{ msgs: [{ role: 'user', content: 'Leg die Akte Maier an' }, { role: 'assistant', content: [{ type: 'text', text: assistent }] }] }],
  ...extra,
})

Deno.test('reine Bestätigungen werden erkannt', () => {
  for (const t of ['ok', 'Ok!', 'okay danke', 'Danke', 'danke schön', 'Vielen Dank!', 'passt', 'Passt so.', 'alles klar', 'Super, danke', '👍', '👍🏼', '🙏', 'Top 👍', 'merci']) {
    assert(istReineBestaetigung(t), `nicht erkannt: ${t}`)
  }
  for (const t of ['ok, und schick ihm die Mail', 'danke, was steht morgen an?', 'ok?', 'passt nicht', 'erledigt', 'ja', 'nein', 'Maier: 0731 12345', '', 'Kannst du mir helfen 👍']) {
    assert(!istReineBestaetigung(t), `fälschlich erkannt: ${t}`)
  }
})

Deno.test('wartet der Assistent auf eine Antwort? Frage am Ende oder offene Rückfrage', () => {
  assert(!wartetAufAntwort({}))
  assert(!wartetAufAntwort(zustand('Angelegt: Bäckerei Maier.')))
  assert(wartetAufAntwort(zustand('Soll ich die Mail so senden?')))
  assert(wartetAufAntwort(zustand('Weißt du die Nummer? Schreib sie mir einfach.')))
  assert(wartetAufAntwort(zustand('Fertig.', { mail_anfrage: { id: 'm1' } })))
  assert(wartetAufAntwort(zustand('Fertig.', { loesch_anfrage: { kunde_id: 'k1' } })))
  assertEquals(letzteAssistentText(zustand('Hallo')), 'Hallo')
})

Deno.test('nurDaumen: nur Bestätigung und keine offene Frage', () => {
  assert(nurDaumen('danke', zustand('Angelegt.')))
  assert(!nurDaumen('ok', zustand('Soll ich senden?')))
  assert(!nurDaumen('was noch?', zustand('Angelegt.')))
})

Deno.test('reagiereMitDaumen ruft setMessageReaction mit 👍 auf und wirft nie', async () => {
  const aufrufe: { url: string; body: unknown }[] = []
  const holen = ((url: string, init?: RequestInit) => {
    aufrufe.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }))
  }) as typeof fetch
  assert(await reagiereMitDaumen('T', 42, 7, holen))
  assertEquals(aufrufe[0].url, 'https://api.telegram.org/botT/setMessageReaction')
  assertEquals(aufrufe[0].body, { chat_id: 42, message_id: 7, reaction: [{ type: 'emoji', emoji: '👍' }] })
  assertEquals(await reagiereMitDaumen(undefined, 42, 7, holen), false)
  const kaputt = (() => Promise.reject(new Error('offline'))) as typeof fetch
  assertEquals(await reagiereMitDaumen('T', 42, 7, kaputt), false)
})

Deno.test('Uhrzeit offen: Titel und Notiz setzen und wieder entfernen', () => {
  const t = vorlaeufigerTitel('Termin mit Maier')
  assertEquals(t, 'Termin mit Maier (Uhrzeit offen)')
  assertEquals(vorlaeufigerTitel(t), t)
  assert(istVorlaeufig(t))
  assertEquals(ohneZusatz(t), 'Termin mit Maier')
  assertEquals(vorlaeufigerTitel(''), 'Termin (Uhrzeit offen)')
  const n = vorlaeufigeNotiz('Unterlagen mitbringen')
  assertEquals(n, `${NOTIZ_ZEILE}\nUnterlagen mitbringen`)
  assertEquals(vorlaeufigeNotiz(n), n)
  assertEquals(notizOhneHinweis(n), 'Unterlagen mitbringen')
  assertEquals(notizOhneHinweis(vorlaeufigeNotiz('')), '')
  assert(hatUhrzeit('2026-11-27T10:00'))
  assert(!hatUhrzeit('2026-11-27'))
})
