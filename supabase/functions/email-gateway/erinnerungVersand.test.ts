// Versand fälliger Erinnerungen (erinnerungVersand.ts): Empfänger, Doppelversand-Schutz, Fehlschlag, Wiederholung, privat.
//   npx -y deno test --allow-all --no-check email-gateway/erinnerungVersand.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { beanspruche, sendeFaelligeErinnerungen } from './erinnerungVersand.ts'

const JETZT = Date.parse('2026-11-25T11:00:30.000Z') // 12:00:30 Berlin
const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

function db(erinnerungen: Record<string, unknown>[]) {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', name: 'Erika Beispiel', email: 'erika@firma.de', telegram_chat_id: 101, aktiv: true },
      { id: 'm2', name: 'Max Muster', email: 'max@firma.de', telegram_chat_id: 202, aktiv: true },
      { id: 'm3', name: 'Ohne Telegram', email: 'ohne@firma.de', telegram_chat_id: null, aktiv: true },
    ],
    kunden: [{ id: 'k1', firma: 'Muster GmbH', ansprechpartner: null }],
    erinnerungen,
  })
}

function zeile(z: Record<string, unknown>) {
  return { fuer_email: 'erika@firma.de', von_email: 'max@firma.de', von_name: 'Max Muster', text: 'Schreiben prüfen', faellig_um: '2026-11-25T11:00:00.000Z', gesendet_am: null, erledigt_am: null, wiederholung: '', privat: false, kunde_id: null, ...z }
}

function wege(gesendet: { chat: unknown; text: string; ohneInhalt?: boolean; privat?: boolean }[], ok = true) {
  return {
    jetzt: () => JETZT,
    sende: async (chat: number | string, text: string, ohneInhalt: boolean) => {
      gesendet.push({ chat, text, ohneInhalt })
      return ok
    },
    sendePrivat: async (chat: number | string, text: string) => {
      gesendet.push({ chat, text, privat: true })
      return ok
    },
    hatPrivatBot: async () => true,
  }
}

Deno.test('Fällige Erinnerung geht einmal an den Empfänger, mit Akte und „(von Max)“, Inhalt im Protokoll', async () => {
  const d = db([zeile({ id: ID1, kunde_id: 'k1' }), zeile({ id: ID2, faellig_um: '2026-11-25T11:05:00.000Z' })])
  const gesendet: { chat: unknown; text: string; ohneInhalt?: boolean }[] = []
  const r = await sendeFaelligeErinnerungen(d, wege(gesendet))
  assertEquals(r.gesendet, 1)
  assertEquals(gesendet, [{ chat: 101, text: '⏰ Erinnerung: Schreiben prüfen\nAkte: Muster GmbH\n(von Max)', ohneInhalt: false }])
  assert(d.tabelle('erinnerungen').find((z) => z.id === ID1)?.gesendet_am)
  assertEquals(d.tabelle('erinnerungen').find((z) => z.id === ID2)?.gesendet_am, null)
  // Zweiter Lauf in derselben Minute: nichts mehr.
  const r2 = await sendeFaelligeErinnerungen(d, wege(gesendet))
  assertEquals(r2.gesendet, 0)
  assertEquals(gesendet.length, 1)
})

Deno.test('Doppelt-sicher: Wer zuerst beansprucht, sendet; ein zweiter Anspruch auf dieselbe Zeile scheitert', async () => {
  const d = db([zeile({ id: ID1 })])
  const z = { id: ID1, faellig_um: '2026-11-25T11:00:00.000Z' }
  assertEquals(await beanspruche(d, z, '2026-11-25T11:00:30.000Z'), true)
  assertEquals(await beanspruche(d, z, '2026-11-25T11:00:31.000Z'), false)
  // Wurde zwischendurch verschoben (andere faellig_um), gilt der alte Anspruch nicht.
  const d2 = db([zeile({ id: ID1, faellig_um: '2026-11-25T12:00:00.000Z' })])
  assertEquals(await beanspruche(d2, z, '2026-11-25T11:00:30.000Z'), false)
})

Deno.test('Eigene Erinnerung: ohne Inhalt im Protokoll, ohne „(von …)“', async () => {
  const d = db([zeile({ id: ID1, von_email: 'erika@firma.de', von_name: 'Erika Beispiel' })])
  const gesendet: { chat: unknown; text: string; ohneInhalt?: boolean }[] = []
  await sendeFaelligeErinnerungen(d, wege(gesendet))
  assertEquals(gesendet, [{ chat: 101, text: '⏰ Erinnerung: Schreiben prüfen', ohneInhalt: true }])
})

Deno.test('Versand scheitert → Vermerk zurück, nächster Lauf versucht erneut', async () => {
  const d = db([zeile({ id: ID1 })])
  const gesendet: { chat: unknown; text: string }[] = []
  assertEquals((await sendeFaelligeErinnerungen(d, wege(gesendet, false))).gesendet, 0)
  assertEquals(d.tabelle('erinnerungen')[0].gesendet_am, null)
  assertEquals((await sendeFaelligeErinnerungen(d, wege(gesendet, true))).gesendet, 1)
  assertEquals(gesendet.length, 2)
})

Deno.test('Ohne Telegram oder über 2 Tage alt: still abgehakt, nichts gesendet', async () => {
  const d = db([zeile({ id: ID1, fuer_email: 'ohne@firma.de' }), zeile({ id: ID2, faellig_um: '2026-11-22T11:00:00.000Z' })])
  const gesendet: { chat: unknown; text: string }[] = []
  const r = await sendeFaelligeErinnerungen(d, wege(gesendet))
  assertEquals(r, { gesendet: 0, abgehakt: 2 })
  assertEquals(gesendet.length, 0)
  assert(d.tabelle('erinnerungen').every((z) => z.gesendet_am))
})

Deno.test('Wiederholung: nach dem Versand auf den nächsten Tag gerückt und wieder frei', async () => {
  const d = db([zeile({ id: ID1, wiederholung: 'taeglich' })])
  const gesendet: { chat: unknown; text: string }[] = []
  await sendeFaelligeErinnerungen(d, wege(gesendet))
  const z = d.tabelle('erinnerungen')[0]
  assertEquals(z.faellig_um, '2026-11-26T11:00:00.000Z')
  assertEquals(z.gesendet_am, null)
  assertEquals(gesendet.length, 1)
})

Deno.test('Privat angelegt: nur über den privaten Bot', async () => {
  const d = db([zeile({ id: ID1, von_email: 'erika@firma.de', privat: true })])
  const gesendet: { chat: unknown; text: string; privat?: boolean }[] = []
  await sendeFaelligeErinnerungen(d, wege(gesendet))
  assertEquals(gesendet, [{ chat: 101, text: '⏰ Erinnerung: Schreiben prüfen', privat: true }])
})
