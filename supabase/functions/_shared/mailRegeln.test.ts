import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import {
  beteiligteAdressen,
  domainVon,
  einordnen,
  filtereMayer,
  type GraphMail,
  istMayerAdresse,
  istMayerMail,
  type MayerRegel,
  mayerUnterhaltungenAus,
  offenerPunkt,
  ohneBetraege,
  standardMayerDomains,
} from './mailRegeln.ts'

const adr = (address: string, name = '') => ({ emailAddress: { name, address } })

const regel = (): MayerRegel => ({
  domains: ['amayer-holding.com'],
  adressen: ['Partner@Extern-Buero.de'],
  unterhaltungen: new Set(['konv-mayer']),
})

function mail(teil: Partial<GraphMail> = {}): GraphMail {
  return {
    id: 'm1',
    conversationId: 'konv-1',
    subject: 'Hallo',
    from: adr('freund@web.de'),
    toRecipients: [adr('hasan@hotmail.de')],
    ccRecipients: [],
    bccRecipients: [],
    bodyPreview: '',
    isRead: true,
    flag: { flagStatus: 'notFlagged' },
    inferenceClassification: 'focused',
    ...teil,
  }
}

Deno.test('domainVon: klein, getrimmt, „Name <a@b>“, ohne @ → leer', () => {
  assertEquals(domainVon('  Info@AMayer-Holding.COM '), 'amayer-holding.com')
  assertEquals(domainVon('Andreas Mayer <a.mayer@Mail.AMayer-Holding.com>'), 'mail.amayer-holding.com')
  assertEquals(domainVon('keine-adresse'), '')
  assertEquals(domainVon(''), '')
})

Deno.test('beteiligteAdressen: alle Felder, klein, ohne Doppelte', () => {
  const m = mail({
    from: adr('Kunde@Firma.de'),
    sender: adr('kunde@firma.de'),
    replyTo: [adr('Antwort@Firma.de')],
    toRecipients: [adr('hasan@hotmail.de')],
    ccRecipients: [adr('CC@x.de')],
    bccRecipients: [adr('bcc@y.de'), { emailAddress: null }],
  })
  assertEquals(beteiligteAdressen(m), ['kunde@firma.de', 'antwort@firma.de', 'hasan@hotmail.de', 'cc@x.de', 'bcc@y.de'])
})

Deno.test('istMayerAdresse: Subdomain ja, ähnlich klingende Domain nein', () => {
  const r = regel()
  assert(istMayerAdresse('info@amayer-holding.com', r))
  assert(istMayerAdresse('immo@mail.amayer-holding.com', r))
  assert(istMayerAdresse('IMMO@AMAYER-HOLDING.COM', r))
  assertFalse(istMayerAdresse('info@notamayer-holding.com', r))
  assertFalse(istMayerAdresse('info@amayer-holding.com.evil.de', r))
  assertFalse(istMayerAdresse('', r))
})

Deno.test('istMayerAdresse: einzelne Adresse genau, mit „Name <…>“ und Groß-/Kleinschreibung', () => {
  const r = regel()
  assert(istMayerAdresse('Herr Partner <partner@extern-buero.de>', r))
  assertFalse(istMayerAdresse('anderer@extern-buero.de', r))
})

Deno.test('Regel-Domain mit @ oder Großbuchstaben wird trotzdem erkannt', () => {
  const r: MayerRegel = { domains: ['@AMayer-Holding.com'], adressen: [], unterhaltungen: new Set() }
  assert(istMayerAdresse('info@amayer-holding.com', r))
})

Deno.test('istMayerMail: über Empfänger in Cc', () => {
  assert(istMayerMail(mail({ ccRecipients: [adr('Info@AMayer-Holding.com')] }), regel()))
  assertFalse(istMayerMail(mail(), regel()))
})

Deno.test('istMayerMail: bekannte Unterhaltung wird ausgeblendet, auch ohne Mayer-Beteiligte', () => {
  const kundenmail = mail({ conversationId: 'konv-mayer', from: adr('kunde@gmail.com') })
  assert(istMayerMail(kundenmail, regel()))
})

Deno.test('filtereMayer: sichtbar und Zahl der ausgeblendeten', () => {
  const mails = [
    mail({ id: 'a' }),
    mail({ id: 'b', from: adr('immo@amayer-holding.com') }),
    mail({ id: 'c', conversationId: 'konv-mayer' }),
    mail({ id: 'd', from: adr('x@notamayer-holding.com') }),
  ]
  const { sichtbar, ausgeblendet } = filtereMayer(mails, regel())
  assertEquals(sichtbar.map((m) => m.id), ['a', 'd'])
  assertEquals(ausgeblendet, 2)
})

Deno.test('mayerUnterhaltungenAus: nur an Mayer gesendete, ohne Doppelte', () => {
  const gesendete = [
    mail({ conversationId: 'k1', from: adr('hasan@hotmail.de'), toRecipients: [adr('Info@AMayer-Holding.com')] }),
    mail({ conversationId: 'k1', from: adr('hasan@hotmail.de'), toRecipients: [adr('immo@amayer-holding.com')] }),
    mail({ conversationId: 'k2', from: adr('hasan@hotmail.de'), toRecipients: [adr('freund@web.de')] }),
    mail({ conversationId: 'k3', from: adr('hasan@hotmail.de'), toRecipients: [adr('freund@web.de')], bccRecipients: [adr('partner@extern-buero.de')] }),
    mail({ conversationId: null, toRecipients: [adr('info@amayer-holding.com')] }),
  ]
  assertEquals(mayerUnterhaltungenAus(gesendete, regel()), ['k1', 'k3'])
})

Deno.test('standardMayerDomains: Freemail und ausgeschlossene Domains fallen weg, sortiert, ohne Doppelte', () => {
  const ergebnis = standardMayerDomains(
    ['info@amayer-holding.com', 'Immo <immo@AMayer-Holding.com>', 'kanzlei@ulmer-wirtschaftskanzlei.de', 'privat@gmail.com'],
    [
      'hasan@hotmail.de', 'x@hotmail.co.uk', 'y@outlook.com', 'z@live.de', 'a@gmx.net', 'b@web.de', 'c@t-online.de',
      'd@yahoo.com.br', 'e@icloud.com', 'f@posteo.de', 'g@protonmail.ch', 'h@proton.me', 'i@1und1.de', 'j@online.de',
      'eray@fundament-it.de', 'k@mail.fundament-it.de', 'kaputt', '',
    ],
    ['Fundament-IT.de'],
  )
  assertEquals(ergebnis, ['amayer-holding.com', 'ulmer-wirtschaftskanzlei.de'])
})

Deno.test('standardMayerDomains: Firmendomain, die nur ähnlich wie Freemail aussieht, bleibt', () => {
  assertEquals(standardMayerDomains(['info@live-events.de', 'a@outlook-beratung.de'], []), ['live-events.de', 'outlook-beratung.de'])
})

// ---------------------------------------------------------------------------------------------------
// einordnen

Deno.test('einordnen: Code geht vor allem anderen', () => {
  assertEquals(einordnen(mail({ subject: 'Ihr Anmeldecode für Ihr Konto' })), 'code')
  assertEquals(einordnen(mail({ subject: 'Mahnung', bodyPreview: 'Ihr Bestätigungs-Code lautet 123456' })), 'code')
  assertEquals(einordnen(mail({ subject: 'Your verification code' })), 'code')
  assertEquals(einordnen(mail({ subject: 'Ihr OTP' })), 'code')
  assertEquals(einordnen(mail({ subject: 'Hotpot-Abend', isRead: false })), 'wichtig') // „otp“ mitten im Wort ist kein OTP
})

Deno.test('einordnen: dringend, auch wenn Outlook die Mahnung unter „Sonstige“ einsortiert', () => {
  assertEquals(einordnen(mail({ subject: 'MAHNUNG zur Rechnung 4711', inferenceClassification: 'other' })), 'dringend')
  assertEquals(einordnen(mail({ subject: 'Hinweis', bodyPreview: 'Ihr Kontostand ist sehr niedrig' })), 'dringend')
  assertEquals(einordnen(mail({ subject: 'Schreiben vom Finanzamt Ulm' })), 'dringend')
  assertEquals(einordnen(mail({ subject: 'KÜNDIGUNG Ihres Vertrags' })), 'dringend')
})

Deno.test('einordnen: Rechnung, auch mit „Angebot“ im Text und unter „Sonstige“', () => {
  assertEquals(einordnen(mail({ subject: 'Ihre Rechnung zum Angebot 2026-11', inferenceClassification: 'other' })), 'rechnung')
  assertEquals(einordnen(mail({ subject: 'Invoice #123' })), 'rechnung')
  assertEquals(einordnen(mail({ subject: 'Info', bodyPreview: 'Die Lastschrift wird am 01.12. eingezogen' })), 'rechnung')
})

Deno.test('einordnen: Zahlungsinfo', () => {
  assertEquals(einordnen(mail({ subject: 'Ihre Überweisung ist abgeschlossen' })), 'zahlung')
  assertEquals(einordnen(mail({ subject: 'Zahlungsbeleg von PayPal' })), 'zahlung')
})

Deno.test('einordnen: Werbung über „Sonstige“ oder Werbemuster', () => {
  assertEquals(einordnen(mail({ subject: 'Neues von uns', inferenceClassification: 'other', isRead: false })), 'werbung')
  assertEquals(einordnen(mail({ subject: 'Unser Newsletter im November', isRead: false })), 'werbung')
  assertEquals(einordnen(mail({ subject: 'Exklusives Angebot nur heute' })), 'werbung')
  assertEquals(einordnen(mail({ subject: 'Black Friday: 30% off' })), 'werbung')
})

Deno.test('einordnen: wichtig (markiert oder relevant + ungelesen), sonst unwichtig', () => {
  assertEquals(einordnen(mail({ subject: 'Treffen morgen?', isRead: false })), 'wichtig')
  assertEquals(einordnen(mail({ subject: 'Treffen morgen?', flag: { flagStatus: 'flagged' } })), 'wichtig')
  assertEquals(einordnen(mail({ subject: 'Treffen morgen?', isRead: true })), 'unwichtig')
})

Deno.test('einordnen: nur die ersten 200 Zeichen der Vorschau zählen', () => {
  const hinten = 'x'.repeat(200) + ' Mahnung'
  assertEquals(einordnen(mail({ subject: 'Hallo', bodyPreview: hinten })), 'unwichtig')
  assertEquals(einordnen(mail({ subject: 'Hallo', bodyPreview: 'x'.repeat(150) + ' Mahnung' })), 'dringend')
})

Deno.test('offenerPunkt: dringend/Rechnung/markiert, nie Code, nie erledigt', () => {
  assert(offenerPunkt(mail({ subject: 'Zahlungserinnerung' })))
  assert(offenerPunkt(mail({ subject: 'Rechnung November' })))
  assert(offenerPunkt(mail({ subject: 'Bitte anschauen', flag: { flagStatus: 'flagged' } })))
  assertFalse(offenerPunkt(mail({ subject: 'Ihr Sicherheitscode', flag: { flagStatus: 'flagged' } })))
  assertFalse(offenerPunkt(mail({ subject: 'Mahnung', bodyPreview: 'Einmalcode 1234' })))
  assertFalse(offenerPunkt(mail({ subject: 'Rechnung November', flag: { flagStatus: 'complete' } })))
  assertFalse(offenerPunkt(mail({ subject: 'Zahlungsbeleg' })))
  assertFalse(offenerPunkt(mail({ subject: 'Treffen morgen?', isRead: false })))
})

// ---------------------------------------------------------------------------------------------------
// ohneBetraege

Deno.test('ohneBetraege: Beträge in verschiedenen Schreibweisen', () => {
  assertEquals(ohneBetraege('Offen: 1.234,56 € bis Freitag'), 'Offen: [Betrag] bis Freitag')
  assertEquals(ohneBetraege('Bitte € 12 zahlen'), 'Bitte [Betrag] zahlen')
  assertEquals(ohneBetraege('Nur 12 EUR'), 'Nur [Betrag]')
  assertEquals(ohneBetraege('EUR 1.000.000,00 und 49,99€ und 5,- Euro'), '[Betrag] und [Betrag] und [Betrag]')
  assertEquals(ohneBetraege('Abo $9.99 monatlich'), 'Abo [Betrag] monatlich')
})

Deno.test('ohneBetraege: IBAN und Kontonummer', () => {
  assertEquals(ohneBetraege('IBAN DE89 3704 0044 0532 0130 00 belastet'), 'IBAN [Konto] belastet')
  assertEquals(ohneBetraege('IBAN: DE89370400440532013000'), 'IBAN: [Konto]')
  assertEquals(ohneBetraege('Kontonummer: 1234567890'), '[Konto]')
})

Deno.test('ohneBetraege: Daten, Rechnungsnummern und normale Zahlen bleiben', () => {
  const text = 'Rechnung 4711 vom 20.11.2026, Frist 14 Tage, Europa'
  assertEquals(ohneBetraege(text), text)
})
