// Prüft das Termin-Briefing (ohne Netz, ohne echtes Telegram, ohne echte KI): Zeitfenster und Vorlauf je
// Mitarbeiter, einmal je Termin und Empfänger, Rechte und private Akten, Bezug über Gast-Adresse und Titel,
// Inhalt (Stand, Kontakte, Wiedervorlagen, fehlende Unterlagen, Rechnungen), Gesprächspunkte und deren
// Ausfall, Morgenübersicht.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { istFaellig, gueltigerVorlauf, sendeTerminBriefings, type BriefingOptionen } from './terminBriefing.ts'
import { findeBezug, darfBezug, kontaktAusVerlauf, normName, type BriefingTermin } from '../_shared/terminBriefingKern.ts'
import { FalscheDatenbank } from '../_shared/testDoppel.ts'

// Freitag, 27.11.2026, 13:00 Uhr in Berlin (UTC+1) — der Termin mit Josef Lehle beginnt um 14:00 Uhr.
const JETZT = new Date('2026-11-27T12:00:00Z')
const BEGINN = '2026-11-27T13:00:00.000Z'
const ENDE = '2026-11-27T14:00:00.000Z'

const ANDREAS = 'andreas@mayer.test'
const HASAN = 'hasan@mayer.test'
const QUIRIN = 'quirin@mayer.test'

function termin(t: Partial<BriefingTermin> & Record<string, unknown> = {}) {
  return {
    id: 't1',
    titel: 'Josef Lehle kommt nach Ulm',
    ort: 'Schwabstraße 3, Ulm',
    beginn: BEGINN,
    ende: ENDE,
    ganztags: false,
    besitzer_email: ANDREAS,
    teilnehmer: [HASAN, QUIRIN],
    kunde_id: 'k_lehle',
    kunde_bereich: 'erben',
    kunde_name: 'Josef Lehle',
    quelle: 'crm',
    gast: null,
    ms_teilnehmer: null,
    erinnert: {},
    ...t,
  }
}

function db(o: { termine?: Record<string, unknown>[]; einstellungen?: Record<string, unknown>[]; kunden?: Record<string, unknown>[] } = {}) {
  return new FalscheDatenbank({
    termine: o.termine ?? [termin()],
    kalender_einstellungen: o.einstellungen ?? [],
    termin_briefings: [],
    mitarbeiter: [
      { id: 'a', name: 'Andreas Mayer', email: ANDREAS, rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], telegram_chat_id: 111, aktiv: true },
      { id: 'h', name: 'Hasan Süslü', email: HASAN, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['erben', 'beratung'], telegram_chat_id: 222, aktiv: true },
      { id: 'q', name: 'Quirin Lutzenberger', email: QUIRIN, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'], telegram_chat_id: 333, aktiv: true },
    ],
    kunden: o.kunden ?? [
      {
        id: 'k_lehle',
        bereich: 'erben',
        firma: 'Josef Lehle',
        ansprechpartner: 'Josef Lehle',
        email: 'josef_lehle@beispiel.test',
        verantwortlich: 'Andreas Mayer',
        verantwortlich_email: null,
        status: 'erstkontakt',
        follow_up: { date: '2026-11-23', done: false, note: 'Josef Lehle anrufen, Erstgespräch vereinbaren' },
        sachverhalt: 'Herr Lehle möchte seine Nachfolge regeln. Es geht um Testament und Vor- und Nacherbschaft. Die Kinder sind noch minderjährig.',
        naechste_schritte: 'Mandantenfragebogen besprechen',
        activities: [
          { date: '2026-11-22', text: 'Per Telegram von Andreas Mayer abgelegt: „Mail_Lehle.jpg — E-Mail“', user: 'Andreas Mayer' },
          { date: '2026-11-20', text: 'Notiz: Telefonat mit Herrn Lehle, er bringt das alte Testament mit', user: 'Andreas Mayer' },
          { date: '2026-11-16', text: 'Aufgabe gesetzt: „Josef Lehle anrufen (9:00 Uhr)“ (fällig 17.11.2026)', user: 'Andreas Mayer' },
        ],
        dokumente: [],
        unterlagen_anforderungen: [{ datum: '2026-11-18', art: 'anforderung', punkte: ['Personalausweis', 'Grundbuchauszug'], token: 'x', eingang: [{ punkt: 'Grundbuchauszug', datum: '2026-11-19', name: 'gb.pdf', dokumentId: 'd1' }] }],
      },
      { id: 'k_privat', bereich: 'privat', firma: 'Privatkontakt Huber', ansprechpartner: 'Max Huber', email: 'huber@privat.test', verantwortlich_email: HASAN, status: 'neu', activities: [] },
      { id: 'k_intern_holding', bereich: 'beratung', firma: 'Intern', email: 'info@mayer.test' },
    ],
    wiedervorlagen: [
      { id: 'w1', kunde_id: 'k_lehle', bereich: 'erben', titel: 'Josef Lehle anrufen, Erstgespräch vereinbaren', faellig: '2026-11-23', erledigt_am: null },
      { id: 'w2', kunde_id: 'k_lehle', bereich: 'erben', titel: 'Alt und erledigt', faellig: '2026-11-01', erledigt_am: '2026-11-02T10:00:00Z' },
    ],
    eingegangene_emails: [
      { id: 'e1', zugewiesener_kunde_id: 'k_lehle', besitzer_email: null, von: 'josef_lehle@beispiel.test', von_name: 'Josef Lehle', betreff: 'Re: Abstimmung zum weiteren Vorgehen', mail_datum: '2026-11-22T09:30:00Z', ignoriert: false },
      { id: 'e2', zugewiesener_kunde_id: 'k_lehle', besitzer_email: HASAN, von: 'x@y.test', von_name: 'Privat', betreff: 'Private Mail', mail_datum: '2026-11-26T09:30:00Z', ignoriert: false },
    ],
    gesendete_emails: [{ id: 'g1', kunde_id: 'k_lehle', besitzer_email: null, an: 'josef_lehle@beispiel.test', an_name: 'Josef Lehle', betreff: 'Unterlagen für unser Gespräch', gesendet_am: '2026-11-18T10:00:00Z' }],
    protokolle: [{ id: 'p1', kunde_id: 'k_lehle', datum: '2026-11-10', betreff: 'Erstes Telefonat', teilnehmer: 'Andreas Mayer' }],
    rechnungen: [
      { id: 'r1', kunde_id: 'k_lehle', nummer: 'ER-2026-01', betrag_brutto: 1190, status: 'Versendet', versendet_am: '2026-11-15' },
      { id: 'r2', kunde_id: 'k_lehle', nummer: 'ER-2026-00', betrag_brutto: 500, status: 'Bezahlt' },
    ],
    kostenvoranschlaege: [],
    besichtigungen: [],
    objekte: [{ id: 'o_lager', bezeichnung: 'Lagerhalle Neu-Ulm', adresse: 'Neu-Ulm', status: 'vermarktung', privat_besitzer: null, activities: [], dokumente: {}, unterlagen_anforderungen: [] }],
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.test/' }],
  })
}

type Gesendet = { chat: number | string; text: string; bot: 'mayer' | 'privat' }

function optionen(o: { punkte?: string[] | 'fehler'; privatAktiv?: string[]; jetzt?: Date } = {}): BriefingOptionen & { gesendet: Gesendet[]; kiAufrufe: string[] } {
  const gesendet: Gesendet[] = []
  const kiAufrufe: string[] = []
  return {
    jetzt: o.jetzt ?? JETZT,
    sende: (chat, text) => (gesendet.push({ chat, text, bot: 'mayer' }), Promise.resolve(true)),
    sendePrivat: (chat, text) => (gesendet.push({ chat, text, bot: 'privat' }), Promise.resolve(true)),
    privatAktiv: (email) => Promise.resolve((o.privatAktiv ?? []).includes(email)),
    apiKey: 'test',
    ki: (_f, _u, init) => {
      kiAufrufe.push(String(init.body))
      if (o.punkte === 'fehler') return Promise.resolve(new Response('kaputt', { status: 500 }))
      const punkte = o.punkte ?? ['Fehlenden Personalausweis ansprechen.', 'Offene Rechnung ER-2026-01 klären.']
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'gespraechspunkte', input: { punkte } }] }), { status: 200 }))
    },
    gesendet,
    kiAufrufe,
  }
}

Deno.test('Fenster: Vorlauf 60 → zwischen 65 und mehr als 5 Minuten vorher fällig', () => {
  assert(istFaellig(60, 60))
  assert(istFaellig(65, 60))
  assert(!istFaellig(66, 60))
  assert(istFaellig(30, 60))
  assert(!istFaellig(5, 60))
  assertEquals(gueltigerVorlauf(null), 60)
  assertEquals(gueltigerVorlauf(500), 60)
  assertEquals(gueltigerVorlauf(30), 30)
})

Deno.test('Briefing: an alle Beteiligten mit Rechten, Inhalt vollständig, einmal je Termin und Empfänger', async () => {
  const d = db()
  const o = optionen()
  const r = await sendeTerminBriefings(d, o)
  assertEquals(r.fehler, [])
  // Quirin hat den Bereich Erben nicht → kein Briefing.
  assertEquals(o.gesendet.map((g) => g.chat).sort(), [111, 222])
  assertEquals(r.gesendet, 2)
  const text = o.gesendet[0].text
  assertStringIncludes(text, '📋 Briefing zum Termin in einer Stunde')
  assertStringIncludes(text, 'Josef Lehle kommt nach Ulm')
  assertStringIncludes(text, '14:00–15:00 Uhr')
  assertStringIncludes(text, 'Ort: Schwabstraße 3, Ulm')
  assertStringIncludes(text, 'Dabei: Andreas Mayer, Hasan Süslü, Quirin Lutzenberger')
  assertStringIncludes(text, 'Akte: Josef Lehle (Erben)')
  assertStringIncludes(text, 'Stand: Erstkontakt')
  // Sachverhalt: höchstens zwei Sätze.
  assertStringIncludes(text, 'Sachverhalt: Herr Lehle möchte seine Nachfolge regeln. Es geht um Testament und Vor- und Nacherbschaft.')
  assert(!text.includes('minderjährig'))
  // Letzte drei Kontakte, neueste zuerst; private Mail eines Kollegen und Ablage-Meldungen nicht.
  assertStringIncludes(text, '• 22.11. Mail von Josef Lehle: „Re: Abstimmung zum weiteren Vorgehen“')
  assertStringIncludes(text, '• 20.11. Notiz: Telefonat mit Herrn Lehle')
  assertStringIncludes(text, '• 18.11. Mail an Josef Lehle: „Unterlagen für unser Gespräch“')
  assert(!text.includes('Private Mail'))
  assert(!text.includes('Erstes Telefonat'), 'nur drei Kontakte')
  assert(!text.includes('abgelegt'))
  // Offene Wiedervorlage (überfällig), Follow-up nicht doppelt, erledigte nicht.
  assertStringIncludes(text, 'Wiedervorlage 23.11. (überfällig): Josef Lehle anrufen, Erstgespräch vereinbaren')
  assert(!text.includes('Nächster Schritt 23.11.'))
  assert(!text.includes('Alt und erledigt'))
  // Fehlend: nur der Personalausweis (Grundbuchauszug ist eingegangen).
  assertStringIncludes(text, 'Fehlende Unterlagen: Personalausweis (angefordert am 18.11.)')
  assertStringIncludes(text, 'Rechnung ER-2026-01 über 1.190,00 €')
  assert(!text.includes('ER-2026-00'))
  assertStringIncludes(text, 'Gesprächspunkte (Vorschlag):\n• Fehlenden Personalausweis ansprechen.')
  assertStringIncludes(text, 'Akte öffnen: https://crm.test/#/erben/mandanten/k_lehle')
  // Eine KI-Anfrage für beide Empfänger, nur mit dem Material der Akte, Haiku 5.5.
  assertEquals(o.kiAufrufe.length, 1)
  const anfrage = JSON.parse(o.kiAufrufe[0])
  assertEquals(anfrage.model, 'claude-haiku-5-5')
  assertStringIncludes(anfrage.messages[0].content, 'Personalausweis')

  // Zweiter Lauf eine Minute später: nichts mehr.
  const o2 = optionen({ jetzt: new Date(JETZT.getTime() + 60000) })
  const r2 = await sendeTerminBriefings(d, o2)
  assertEquals(r2.gesendet, 0)
  assertEquals(o2.gesendet.length, 0)
  assertEquals(o2.kiAufrufe.length, 0)
  assertEquals(d.tabelle('termin_briefings').length, 2)
  assert(d.tabelle('termin_briefings').every((z) => z.zugestellt === true))
})

Deno.test('Verschobener Termin bekommt zum neuen Beginn ein neues Briefing', async () => {
  const d = db()
  await sendeTerminBriefings(d, optionen())
  d.tabelle('termine')[0].beginn = '2026-11-27T13:30:00.000Z'
  d.tabelle('termine')[0].ende = '2026-11-27T14:30:00.000Z'
  const o = optionen({ jetzt: new Date('2026-11-27T12:30:00Z') })
  const r = await sendeTerminBriefings(d, o)
  assertEquals(r.gesendet, 2)
})

Deno.test('Einstellungen: abgeschaltet, eigener Vorlauf; zu früh nichts', async () => {
  const d = db({ einstellungen: [{ email: ANDREAS, briefing_an: false, briefing_vorlauf: 60, briefing_morgen: false }, { email: HASAN, briefing_an: true, briefing_vorlauf: 30, briefing_morgen: false }] })
  const o = optionen()
  assertEquals((await sendeTerminBriefings(d, o)).gesendet, 0)
  // 30 Minuten vorher: Hasan (Vorlauf 30) ist dran, Andreas hat es abgeschaltet.
  const o2 = optionen({ jetzt: new Date('2026-11-27T12:30:00Z') })
  assertEquals((await sendeTerminBriefings(d, o2)).gesendet, 1)
  assertEquals(o2.gesendet[0].chat, 222)
  assertStringIncludes(o2.gesendet[0].text, 'in 30 Minuten')
})

Deno.test('KI fällt aus → Briefing ohne Gesprächspunkte', async () => {
  const d = db()
  const o = optionen({ punkte: 'fehler' })
  const r = await sendeTerminBriefings(d, o)
  assertEquals(r.gesendet, 2)
  assert(!o.gesendet[0].text.includes('Gesprächspunkte'))
  assertStringIncludes(o.gesendet[0].text, 'Fehlende Unterlagen')
})

Deno.test('Ohne Bezug, ganztägig oder abgesagt: kein Briefing', async () => {
  const d = db({
    termine: [
      termin({ id: 'a', kunde_id: null, titel: 'Blocker', teilnehmer: [] }),
      termin({ id: 'b', ganztags: true }),
      termin({ id: 'c', titel: 'Abgesagt: Josef Lehle kommt nach Ulm' }),
    ],
  })
  const o = optionen()
  assertEquals((await sendeTerminBriefings(d, o)).gesendet, 0)
  assertEquals(d.tabelle('termin_briefings').length, 0)
})

Deno.test('Private Akte: nur der Besitzer, über den privaten Assistenten, wenn er ihn nutzt', async () => {
  const d = db({ termine: [termin({ id: 'tp', kunde_id: 'k_privat', kunde_bereich: 'privat', besitzer_email: HASAN, teilnehmer: [ANDREAS], titel: 'Huber' })] })
  const o = optionen({ privatAktiv: [HASAN] })
  const r = await sendeTerminBriefings(d, o)
  assertEquals(r.gesendet, 1)
  assertEquals(o.gesendet[0], { chat: 222, text: o.gesendet[0].text, bot: 'privat' })
  assertStringIncludes(o.gesendet[0].text, 'https://crm.test/#/privat/kontakte/k_privat')
})

Deno.test('Bezug über Gast-Adresse (Outlook) und über den Titel', async () => {
  const d = db()
  const team = new Set([ANDREAS, HASAN, QUIRIN])
  const teamNamen = ['Andreas Mayer', 'Hasan Süslü', 'Quirin Lutzenberger']
  const outlook = { ...termin({ kunde_id: null, quelle: 'outlook', titel: 'Abstimmung', ms_teilnehmer: [{ email: 'Josef_Lehle@beispiel.test' }, { email: HASAN }] }) } as BriefingTermin
  assertEquals((await findeBezug(d, outlook, { team, teamNamen }))?.id, 'k_lehle')
  // Outlook-Titel allein reicht nicht.
  const outlookTitel = { ...termin({ kunde_id: null, quelle: 'outlook', titel: 'Josef Lehle' }) } as BriefingTermin
  assertEquals(await findeBezug(d, outlookTitel, { team, teamNamen }), null)
  // Im CRM: voller Name, Nachname allein, Objekt-Bezeichnung.
  for (const [titel, id] of [['Termin mit Josef Lehle', 'k_lehle'], ['Lehle in Ulm', 'k_lehle'], ['Besichtigung Lagerhalle Neu-Ulm', 'o_lager'], ['Mayer im Büro', null]] as const) {
    const b = await findeBezug(d, { ...termin({ kunde_id: null, titel }) } as BriefingTermin, { team, teamNamen })
    assertEquals(b?.id ?? null, id, titel)
  }
  // Privater Kontakt eines Kollegen: über den Titel nicht für Andreas' Termin.
  assertEquals(await findeBezug(d, { ...termin({ kunde_id: null, titel: 'Treffen Max Huber' }) } as BriefingTermin, { team, teamNamen }), null)
  assertEquals((await findeBezug(d, { ...termin({ kunde_id: null, titel: 'Treffen Max Huber', besitzer_email: HASAN }) } as BriefingTermin, { team, teamNamen }))?.id, 'k_privat')
  // Sammelakte als Verknüpfung zählt nicht.
  assertEquals(await findeBezug(d, { ...termin({ kunde_id: 'k_intern_holding', titel: 'Intern' }) } as BriefingTermin, { team, teamNamen }), null)
})

Deno.test('Rechte: Bereiche, Geschäftsführung, privat', () => {
  const erben = { art: 'kunde' as const, id: 'k', bereich: 'erben', verantwortlichEmail: null, wie: 'verknuepft' as const }
  assert(darfBezug({ email: ANDREAS, rolle: 'geschaeftsfuehrung' }, erben))
  assert(darfBezug({ email: HASAN, bereiche: ['erben'] }, erben))
  assert(!darfBezug({ email: QUIRIN, bereiche: ['immobilien'] }, erben))
  const privat = { art: 'kunde' as const, id: 'p', bereich: 'privat', verantwortlichEmail: HASAN, wie: 'verknuepft' as const }
  assert(!darfBezug({ email: ANDREAS, rolle: 'geschaeftsfuehrung' }, privat))
  assert(darfBezug({ email: HASAN }, privat))
  const objekt = { art: 'objekt' as const, id: 'o', privatBesitzer: null, wie: 'titel' as const }
  assert(darfBezug({ email: QUIRIN, bereiche: ['immobilien'] }, objekt))
  assert(!darfBezug({ email: HASAN, bereiche: ['erben'] }, objekt))
  assert(!darfBezug({ email: HASAN, bereiche: ['immobilien'], nurPrivat: true }, objekt))
})

Deno.test('Verlauf: nur echte Kontakte', () => {
  assertEquals(kontaktAusVerlauf({ date: '2026-11-20', text: 'Notiz per Telegram: Anruf, Kunde ruft zurück' })?.text, 'Notiz: Anruf, Kunde ruft zurück')
  assertEquals(kontaktAusVerlauf({ date: '2026-11-20', text: 'E-Mail automatisch zugeordnet: „Telefonat“ von X' }), null)
  assertEquals(kontaktAusVerlauf({ date: '2026-11-20', text: 'Unternehmensbewertung erfasst' }), null)
  assertEquals(normName('Lagerhalle (Exposé) Neu-Ulm'), 'lagerhalle neu ulm')
})

Deno.test('Morgenübersicht: nur wer sie will, ab 7:30, einmal am Tag, nur Kundentermine', async () => {
  const d = db({
    einstellungen: [{ email: HASAN, briefing_an: true, briefing_vorlauf: 60, briefing_morgen: true }],
    termine: [termin(), termin({ id: 't2', kunde_id: null, titel: 'Blocker', beginn: '2026-11-27T10:00:00.000Z', ende: '2026-11-27T11:00:00.000Z', besitzer_email: HASAN, teilnehmer: [] })],
  })
  // 7:20 Uhr: noch nicht.
  const frueh = optionen({ jetzt: new Date('2026-11-27T06:20:00Z') })
  assertEquals((await sendeTerminBriefings(d, frueh)).morgen, 0)
  const o = optionen({ jetzt: new Date('2026-11-27T06:31:00Z') })
  const r = await sendeTerminBriefings(d, o)
  assertEquals(r.morgen, 1)
  assertEquals(o.gesendet.length, 1)
  assertEquals(o.gesendet[0].chat, 222)
  assertStringIncludes(o.gesendet[0].text, 'Deine Kundentermine heute (1)')
  assertStringIncludes(o.gesendet[0].text, '14:00 Uhr – Josef Lehle kommt nach Ulm')
  assertStringIncludes(o.gesendet[0].text, '1 Unterlage fehlt noch')
  assert(!o.gesendet[0].text.includes('Blocker'))
  assertEquals(o.kiAufrufe.length, 0, 'Morgenübersicht ohne KI')
  const o2 = optionen({ jetzt: new Date('2026-11-27T06:45:00Z') })
  assertEquals((await sendeTerminBriefings(d, o2)).morgen, 0)
})

Deno.test('Ohne Tabelle oder Spalten: nichts senden', async () => {
  const d = db()
  const urspruenglich = d.from.bind(d)
  // deno-lint-ignore no-explicit-any
  d.from = ((t: string) => {
    const q = urspruenglich(t)
    if (t === 'termin_briefings') {
      // deno-lint-ignore no-explicit-any
      ;(q as any).insert = () => ({ then: (ok: (e: unknown) => unknown) => Promise.resolve(ok({ data: null, error: { code: '42P01', message: 'relation does not exist' } })) })
    }
    return q
  }) as any
  const o = optionen()
  const r = await sendeTerminBriefings(d, o)
  assertEquals(o.gesendet.length, 0)
  assert(r.fehler.some((f) => f.includes('nicht gesendet')))
})

// ---------------------------------------------------------------------------------------------
// Runde 5: Direkt-Link in die Gesprächs-App und Erinnerung zum Terminbeginn

Deno.test('Briefing endet mit dem Direkt-Link zur Aufnahme (Termin und Akte)', async () => {
  const d = db()
  const o = optionen()
  await sendeTerminBriefings(d, o)
  const text = o.gesendet[0].text
  assert(text.endsWith('🎙️ Gespräch aufnehmen: https://crm.test/gespraech/#/aufnehmen?termin=t1&kunde=k_lehle'), text.slice(-200))
  assertStringIncludes(text, 'Akte öffnen: https://crm.test/#/erben/mandanten/k_lehle')
})

// Terminbeginn 14:00 Uhr Berlin = 13:00 UTC.
const BEIM_BEGINN = new Date('2026-11-27T13:02:00Z')

Deno.test('Erinnerung zum Terminbeginn: Standard aus — nichts', async () => {
  const d = db()
  const o = optionen({ jetzt: BEIM_BEGINN })
  const r = await sendeTerminBriefings(d, o)
  assertEquals(r.aufnahme, 0)
  assertEquals(o.gesendet.length, 0)
})

Deno.test('Erinnerung zum Terminbeginn: eingeschaltet → einmal mit Link, nur mit Rechten, nicht doppelt', async () => {
  const d = db({ einstellungen: [{ email: ANDREAS, gespraech_erinnerung: true }, { email: QUIRIN, gespraech_erinnerung: true }] })
  const o = optionen({ jetzt: BEIM_BEGINN })
  const r = await sendeTerminBriefings(d, o)
  assertEquals(r.fehler, [])
  assertEquals(r.aufnahme, 1)
  // Quirin darf die Erben-Akte nicht sehen, Hasan hat es nicht eingeschaltet.
  assertEquals(o.gesendet.map((g) => g.chat), [111])
  assertEquals(
    o.gesendet[0].text,
    '🎙️ Dein Termin „Josef Lehle kommt nach Ulm“ (14:00 Uhr) mit Josef Lehle beginnt.\nGespräch aufnehmen: https://crm.test/gespraech/#/aufnehmen?termin=t1&kunde=k_lehle',
  )
  assertEquals(o.kiAufrufe.length, 0, 'ohne KI')
  const vermerk = d.tabelle('termin_briefings').find((z) => z.art === 'aufnahme')
  assertEquals(vermerk?.id, 'aufnahme|t1|andreas@mayer.test|2026-11-27T13:00:00.000Z')
  assertEquals(vermerk?.zugestellt, true)
  // Eine Minute später: nichts mehr.
  const o2 = optionen({ jetzt: new Date(BEIM_BEGINN.getTime() + 60000) })
  assertEquals((await sendeTerminBriefings(d, o2)).aufnahme, 0)
  assertEquals(o2.gesendet.length, 0)
})

Deno.test('Erinnerung zum Terminbeginn: Fenster 1 Minute vor bis 5 Minuten nach Beginn', async () => {
  const einst = [{ email: ANDREAS, gespraech_erinnerung: true }]
  for (const [jetzt, erwartet] of [['2026-11-27T12:58:30Z', 0], ['2026-11-27T12:59:00Z', 1], ['2026-11-27T13:05:00Z', 1], ['2026-11-27T13:05:30Z', 0]] as const) {
    const o = optionen({ jetzt: new Date(jetzt) })
    assertEquals((await sendeTerminBriefings(db({ einstellungen: einst }), o)).aufnahme, erwartet, jetzt)
  }
})

Deno.test('Erinnerung zum Terminbeginn: läuft schon eine Aufnahme zum Termin → keine Erinnerung (verworfene zählen nicht)', async () => {
  const d = db({ einstellungen: [{ email: ANDREAS, gespraech_erinnerung: true }] })
  d.tabelle('gespraech_aufnahmen').push({ id: 'g1', termin_id: 't1', mitarbeiter_email: HASAN, status: 'aufnahme' })
  const o = optionen({ jetzt: BEIM_BEGINN })
  assertEquals((await sendeTerminBriefings(d, o)).aufnahme, 0)
  assertEquals(d.tabelle('termin_briefings').length, 0)
  d.tabelle('gespraech_aufnahmen')[0].status = 'verworfen'
  assertEquals((await sendeTerminBriefings(d, optionen({ jetzt: BEIM_BEGINN }))).aufnahme, 1)
})

Deno.test('Erinnerung zum Terminbeginn: ohne Akte keine Nachricht; private Akte über den privaten Assistenten', async () => {
  const einst = [{ email: ANDREAS, gespraech_erinnerung: true }, { email: HASAN, gespraech_erinnerung: true }]
  const ohne = db({ einstellungen: einst, termine: [termin({ id: 'a', kunde_id: null, titel: 'Blocker', teilnehmer: [] })] })
  assertEquals((await sendeTerminBriefings(ohne, optionen({ jetzt: BEIM_BEGINN }))).aufnahme, 0)
  const privat = db({ einstellungen: einst, termine: [termin({ id: 'tp', kunde_id: 'k_privat', kunde_bereich: 'privat', besitzer_email: HASAN, teilnehmer: [ANDREAS], titel: 'Huber' })] })
  const o = optionen({ jetzt: BEIM_BEGINN, privatAktiv: [HASAN] })
  assertEquals((await sendeTerminBriefings(privat, o)).aufnahme, 1)
  assertEquals(o.gesendet.map((g) => [g.chat, g.bot]), [[222, 'privat']])
  assertStringIncludes(o.gesendet[0].text, 'mit Max Huber beginnt.\nGespräch aufnehmen: https://crm.test/gespraech/#/aufnehmen?termin=tp&kunde=k_privat')
})

Deno.test('Erinnerung zum Terminbeginn: Objekt-Termin → „zu <Objekt>“ und objekt= im Link', async () => {
  const d = db({
    einstellungen: [{ email: QUIRIN, gespraech_erinnerung: true }],
    termine: [termin({ id: 'to', kunde_id: null, kunde_bereich: null, kunde_name: null, besitzer_email: QUIRIN, teilnehmer: [], titel: 'Besichtigung Lagerhalle Neu-Ulm' })],
  })
  d.tabelle('besichtigungen').push({ id: 'b1', objekt_id: 'o_lager', kalender_termin_id: 'to' })
  const o = optionen({ jetzt: BEIM_BEGINN })
  const r = await sendeTerminBriefings(d, o)
  assertEquals(r.aufnahme, 1)
  assertEquals(o.gesendet[0].chat, 333)
  assertStringIncludes(o.gesendet[0].text, 'zu Lagerhalle Neu-Ulm beginnt.')
  assertStringIncludes(o.gesendet[0].text, 'aufnehmen?termin=to&objekt=o_lager')
})
