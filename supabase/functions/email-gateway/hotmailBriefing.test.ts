// Hotmail-Teil der Morgen-Übersicht gegen nachgebautes Microsoft und Datenbank im Speicher.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { falscheDatenbank, falschesMicrosoft, TEST_DIENST_SCHLUESSEL, verbundenesKonto } from '../_shared/testDoppel.ts'
import { hotmailAbschnitte, seitWann } from './hotmailBriefing.ts'

Deno.env.set('MS_CLIENT_ID', 'test-client-id')
Deno.env.set('MS_CLIENT_SECRET', 'test-client-geheim')
Deno.env.set('SUPABASE_URL', 'https://test-projekt.supabase.invalid')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', TEST_DIENST_SCHLUESSEL)

const ICH = 'hasan.test@hotmail.com'
const adr = (a: string) => ({ emailAddress: { name: a, address: a } })
const mail = (id: string, von: string, subject: string, extra: Record<string, unknown> = {}) => ({
  id,
  conversationId: `K-${id}`,
  subject,
  from: adr(von),
  sender: adr(von),
  toRecipients: [adr(ICH)],
  ccRecipients: [],
  receivedDateTime: '2026-11-20T06:00:00Z',
  bodyPreview: '',
  isRead: false,
  flag: { flagStatus: 'notFlagged' },
  inferenceClassification: 'focused',
  ...extra,
})

async function db() {
  const d = falscheDatenbank({ postfaecher: [{ id: 'standard', adresse: 'info@amayer-holding.com' }], mitarbeiter: [{ email: ICH }, { email: 'kollege@amayer-holding.com' }], privat_einstellungen: [] })
  await verbundenesKonto(d, ICH, { konto: { stand: { mayerStand: new Date().toISOString(), mayerUnterhaltungen: [] } } })
  return d
}

Deno.test('Morgen-Übersicht: dringend, Rechnung, wichtig, markiert — ohne Beträge, Codes und Mayer', async () => {
  Deno.env.set('MS_ERLAUBT', ICH)
  const d = await db()
  const ms = falschesMicrosoft((a) => {
    if (a.weg === '/me/mailFolders/inbox/messages')
      return {
        value: [
          mail('1', 'amt@finanzamt.de', 'Mahnung: Zahlung von 1.234,56 € fällig', { inferenceClassification: 'other' }),
          mail('2', 'shop@x.de', 'Ihre Rechnung über 99 EUR'),
          mail('3', 'freund@gmx.de', 'Treffen am Samstag?'),
          mail('4', 'login@bank.de', 'Ihr Bestätigungscode 123456'),
          mail('5', 'kollege@amayer-holding.com', 'Mahnung Kunde Müller'),
          mail('6', 'newsletter@x.de', 'Newsletter November', { inferenceClassification: 'other' }),
          mail('7', 'freund@gmx.de', 'Gelesenes', { isRead: true }),
        ],
      }
    if (a.weg === '/me/messages') return { value: [mail('8', 'x@y.de', 'Markiert', { flag: { flagStatus: 'flagged' } }), mail('9', 'kollege@amayer-holding.com', 'Mayer markiert', { flag: { flagStatus: 'flagged' } })] }
  })
  try {
    const abschnitte = await hotmailAbschnitte(d, ICH, new Date('2026-11-20T07:30:00Z'))
    const text = JSON.stringify(abschnitte)
    assertEquals(abschnitte.map((a) => a.titel.split(' — ')[1]?.split(' (')[0]), ['dringend', 'neue Rechnungen', '1 neue wichtige Mail', '1 markierte Mail noch offen'])
    assert(text.includes('Mahnung: Zahlung von [Betrag] fällig'), text)
    assert(!text.includes('1.234') && !text.includes('99 EUR'), 'keine Beträge')
    assert(!text.includes('Bestätigungscode'), 'keine Codes')
    assert(!text.includes('Müller') && !text.includes('Mayer markiert'), 'kein Mayer-Geschäft')
    assert(!text.includes('Newsletter') && !text.includes('Gelesenes'))
  } finally {
    ms()
  }
})

Deno.test('Ohne Freischaltung oder ohne Konto: nichts, und kein Aufruf bei Microsoft', async () => {
  const d = await db()
  const ms = falschesMicrosoft(() => ({ value: [] }))
  try {
    Deno.env.set('MS_ERLAUBT', '')
    assertEquals(await hotmailAbschnitte(d, ICH), [])
    Deno.env.set('MS_ERLAUBT', 'andere@x.de')
    assertEquals(await hotmailAbschnitte(d, 'andere@x.de'), [])
    assertEquals(ms.aufrufe.length, 0)
  } finally {
    ms()
  }
})

Deno.test('Microsoft nicht erreichbar: eine Hinweiszeile statt Absturz', async () => {
  Deno.env.set('MS_ERLAUBT', ICH)
  const d = await db()
  const ms = falschesMicrosoft(() => new Response(JSON.stringify({ error: { message: 'kaputt' } }), { status: 400 }))
  try {
    const a = await hotmailAbschnitte(d, ICH)
    assertEquals(a.length, 1)
    assert(a[0].titel.includes('nicht erreichbar'))
  } finally {
    ms()
  }
})

Deno.test('Montags zählt das Wochenende mit', () => {
  assertEquals(seitWann(new Date('2026-11-23T07:30:00Z')).toISOString(), '2026-11-20T07:30:00.000Z')
  assertEquals(seitWann(new Date('2026-11-24T07:30:00Z')).toISOString(), '2026-11-23T07:30:00.000Z')
})
