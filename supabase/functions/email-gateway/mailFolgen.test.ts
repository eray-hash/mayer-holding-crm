// Mail-Folgen (unbeantwortete Mails, Zusagen) gegen nachgebautes Microsoft, Datenbank im Speicher und eine KI-Attrappe — ohne Netz.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, falschesMicrosoft, TEST_DIENST_SCHLUESSEL, verbundenesKonto } from '../_shared/testDoppel.ts'
import {
  ausschlussGrund, findeUnbeantwortete, type FolgeMail, istMassenversand, istZusageKandidat, KI_HOECHSTENS, MARKE, PRUEF_TABELLE, pruefeZusagen,
  unbeantwortetAlsZeilen, unbeantworteteZeilen, werteZusageAntwort, zusageErinnerung, zusageTodoAusfuehrer,
} from './mailFolgen.ts'

Deno.env.set('MS_CLIENT_ID', 'test-client-id')
Deno.env.set('MS_CLIENT_SECRET', 'test-client-geheim')
Deno.env.set('SUPABASE_URL', 'https://test-projekt.supabase.invalid')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', TEST_DIENST_SCHLUESSEL)

const ICH = 'hasan.test@hotmail.com'
const JETZT = new Date('2026-11-24T06:00:00Z') // Dienstag, 7 Uhr in Berlin
const ICH_SET = new Set([ICH])
const adr = (a: string, name = '') => ({ emailAddress: { name, address: a } })
const tageVorher = (t: number, stunde = 9) => new Date(Date.parse(`2026-11-24T${String(stunde).padStart(2, '0')}:00:00Z`) - t * 86_400_000).toISOString()

/** Posteingangs-Mail: Standard eine Person, Hasan in An, vor 4 Tagen. */
const ein = (id: string, von: string, subject: string, extra: Partial<FolgeMail> = {}): FolgeMail => ({
  id,
  internetMessageId: `<${id}@test>`,
  conversationId: `K-${id}`,
  subject,
  from: adr(von, 'Max Muster'),
  sender: adr(von, 'Max Muster'),
  toRecipients: [adr(ICH)],
  ccRecipients: [],
  receivedDateTime: tageVorher(4),
  bodyPreview: 'Hallo, können Sie mir bitte kurz Bescheid geben, wie es weitergeht?',
  inferenceClassification: 'focused',
  internetMessageHeaders: [{ name: 'Received', value: 'from mx.beispiel.de' }],
  ...extra,
})

/** Gesendete Mail. */
const aus = (id: string, an: string, subject: string, extra: Partial<FolgeMail> = {}): FolgeMail => ({
  id,
  internetMessageId: `<${id}@test>`,
  conversationId: `K-${id}`,
  subject,
  from: adr(ICH),
  toRecipients: [adr(an, 'Max Muster')],
  ccRecipients: [],
  sentDateTime: '2026-11-23T15:00:00Z',
  bodyPreview: '',
  ...extra,
})

// ---------- (A) Erkennung ----------

Deno.test('Unbeantwortet: Werbung, Newsletter, noreply, Netzwerk, Rechnungen und Systemmails fallen raus', () => {
  const g = (m: FolgeMail) => ausschlussGrund(m, ICH_SET)
  assertEquals(g(ein('1', 'max.muster@beispiel.de', 'Frage zum Vertrag')), null)
  assertEquals(g(ein('2', 'noreply@shop-beispiel.de', 'Ihre Bestellung')), 'maschine')
  assertEquals(g(ein('3', 'newsletter@beispiel.de', 'Neuigkeiten')), 'maschine')
  assertEquals(g(ein('4', 'messages-noreply@linkedin.com', 'Max Muster hat Ihnen geschrieben')), 'maschine')
  assertEquals(g(ein('5', 'einladung@xing.com', 'Neue Kontaktanfrage')), 'plattform')
  assertEquals(g(ein('6', 'max@laden-beispiel.de', 'Unser Herbstprogramm', { internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<mailto:ab@x.de>' }] })), 'massenversand')
  assertEquals(g(ein('7', 'max@laden-beispiel.de', 'Info', { internetMessageHeaders: [{ name: 'Precedence', value: 'bulk' }] })), 'massenversand')
  assertEquals(g(ein('8', 'max.muster@beispiel.de', 'Automatische Antwort: Urlaub')), 'automatisch')
  assertEquals(g(ein('9', 'buero@handwerk-beispiel.de', 'Ihre Rechnung Nr. 4711')), 'rechnung')
  assertEquals(g(ein('10', 'max@laden-beispiel.de', '20 % Rabatt nur heute')), 'werbung')
  assertEquals(g(ein('11', 'konto@bank-beispiel.de', 'Ihr Bestätigungscode 123456')), 'maschine')
  assertEquals(g(ein('12', 'max.muster@beispiel.de', 'Hallo', { inferenceClassification: 'other' })), 'sonstige')
  assertEquals(ausschlussGrund(ein('12', 'max.muster@beispiel.de', 'Hallo', { inferenceClassification: 'other' }), ICH_SET, new Set(['max.muster@beispiel.de'])), null, 'bekannter Kontakt zählt trotz „Sonstige“')
  assertEquals(g(ein('13', 'max.muster@beispiel.de', 'Ihr Angebot vom 10.11.')), null, '„Angebot“ allein ist keine Werbung')
  assertEquals(g(ein('14', 'max.muster@beispiel.de', 'Re: Unterlagen', { bodyPreview: 'Vielen Dank, alles angekommen!' })), 'nur_dank')
  assertEquals(g(ein('15', ICH, 'Notiz an mich')), 'eigene')
  assertEquals(istMassenversand([{ name: 'Auto-Submitted', value: 'no' }]), false)
  assertEquals(istMassenversand([{ name: 'Auto-Submitted', value: 'auto-generated' }]), true)
})

Deno.test('Unbeantwortet: nur in Kopie fällt raus, in An bleibt', () => {
  const kopie = ein('C1', 'max.muster@beispiel.de', 'Zur Info', { toRecipients: [adr('erika.muster@beispiel.de')], ccRecipients: [adr(ICH)] })
  assertEquals(ausschlussGrund(kopie, ICH_SET), 'kopie')
  const beide = ein('C2', 'max.muster@beispiel.de', 'Frage', { toRecipients: [adr('erika.muster@beispiel.de'), adr(ICH.toUpperCase())] })
  assertEquals(ausschlussGrund(beide, ICH_SET), null)
})

Deno.test('Unbeantwortet: beantwortete Unterhaltung fällt raus, Zeitfenster 3 bis 14 Tage, je Unterhaltung nur die jüngste', () => {
  const posteingang = [
    ein('U1', 'max.muster@beispiel.de', 'Offene Frage', { receivedDateTime: tageVorher(5) }),
    ein('U2', 'erika.muster@beispiel.de', 'Schon beantwortet', { receivedDateTime: tageVorher(6) }),
    ein('U3', 'paul.beispiel@beispiel.de', 'Zu frisch', { receivedDateTime: tageVorher(1) }),
    ein('U4', 'paul.beispiel@beispiel.de', 'Zu alt', { receivedDateTime: tageVorher(20) }),
    // Antwort kam VOR der Mail → noch offen.
    ein('U5', 'anna.beispiel@beispiel.de', 'AW: Nachfrage', { receivedDateTime: tageVorher(4) }),
    // Zwei Mails derselben Unterhaltung: nur die jüngere zählt.
    ein('U6a', 'otto.beispiel@beispiel.de', 'Termin', { conversationId: 'K-U6', receivedDateTime: tageVorher(10) }),
    ein('U6b', 'otto.beispiel@beispiel.de', 'Re: Termin', { conversationId: 'K-U6', receivedDateTime: tageVorher(7) }),
  ]
  const gesendet = [
    aus('S2', 'erika.muster@beispiel.de', 'Re: Schon beantwortet', { conversationId: 'K-U2', sentDateTime: tageVorher(5) }),
    aus('S5', 'anna.beispiel@beispiel.de', 'Nachfrage', { conversationId: 'K-U5', sentDateTime: tageVorher(8) }),
  ]
  const liste = findeUnbeantwortete(posteingang, gesendet, ICH_SET, JETZT)
  assertEquals(liste.map((u) => u.mailId), ['U6b', 'U1', 'U5'])
  assertEquals(liste[0].betreff, 'Termin', 'Re:/AW: wird abgeschnitten')
  assertEquals(liste.map((u) => u.tage), [7, 5, 4])
})

Deno.test('Unbeantwortet: Zeilenformat mit Überschrift, höchstens 5 Zeilen, „… und N weitere“', () => {
  assertEquals(unbeantwortetAlsZeilen([]), [])
  const u = (i: number) => ({ mailId: `m${i}`, name: 'Max Muster', adresse: 'max.muster@beispiel.de', betreff: `Frage ${i}`, eingang: '2026-11-20', tage: i === 0 ? 1 : 4 })
  assertEquals(unbeantwortetAlsZeilen([u(0)]), ['Noch unbeantwortet', '• Max Muster (vor 1 Tag): Frage 0'])
  const z = unbeantwortetAlsZeilen(Array.from({ length: 8 }, (_, i) => u(i + 1)))
  assertEquals(z.length, 7)
  assertEquals(z[0], 'Noch unbeantwortet')
  assertEquals(z[1], '• Max Muster (vor 4 Tagen): Frage 1')
  assertEquals(z[6], '… und 3 weitere')
})

Deno.test('Unbeantwortet: ganzer Weg über Microsoft — Mayer ausgeblendet, Gesendet einmal geladen, Name aus Absender', async () => {
  Deno.env.set('MS_ERLAUBT', ICH)
  const d = falscheDatenbank({ postfaecher: [{ id: 'standard', adresse: 'info@amayer-holding.com' }], mitarbeiter: [{ email: ICH }, { email: 'kollege@amayer-holding.com' }], privat_einstellungen: [] })
  await verbundenesKonto(d, ICH, { konto: { stand: { mayerStand: new Date().toISOString(), mayerUnterhaltungen: [] } } })
  const posteingang = [
    ein('M1', 'max.muster@beispiel.de', 'Frage zur Wohnung', { from: adr('max.muster@beispiel.de', 'Muster, Max') }),
    ein('M2', 'kollege@amayer-holding.com', 'Kunde wartet'),
    ein('M3', 'noreply@beispiel.de', 'Systemmail'),
    ein('M4', 'erika.muster@beispiel.de', 'Schon erledigt'),
  ]
  const gesendet = [aus('G4', 'erika.muster@beispiel.de', 'Re: Schon erledigt', { conversationId: 'K-M4', sentDateTime: tageVorher(2) })]
  const ms = falschesMicrosoft((a) => {
    if (a.weg === '/me/mailFolders/inbox/messages') return { value: posteingang }
    if (a.weg === '/me/mailFolders/sentitems/messages') return { value: gesendet }
  })
  try {
    const zeilen = await unbeantworteteZeilen(d, ICH, JETZT)
    assertEquals(zeilen, ['Noch unbeantwortet', '• Max Muster (vor 4 Tagen): Frage zur Wohnung'])
    const wege = ms.aufrufe.filter((a) => a.art === 'graph').map((a) => a.weg)
    assertEquals(wege.filter((w) => w === '/me/mailFolders/sentitems/messages').length, 1, 'Gesendet nur einmal')
    const post = ms.aufrufe.find((a) => a.weg === '/me/mailFolders/inbox/messages')!
    assertStringIncludes(post.pfad, 'internetMessageHeaders')
    assertStringIncludes(post.pfad, 'receivedDateTime le ')
  } finally {
    ms()
  }
  // Ohne Freischaltung: nichts, kein Fehler.
  Deno.env.set('MS_ERLAUBT', 'jemand@anders.de')
  assertEquals(await unbeantworteteZeilen(d, ICH, JETZT), [])
})

Deno.test('Unbeantwortet: Postfach lehnt Kopfzeilen ab (400) → ohne Kopfzeilen weiter; Microsoft-Fehler → leere Liste', async () => {
  Deno.env.set('MS_ERLAUBT', ICH)
  const d = falscheDatenbank({ postfaecher: [], mitarbeiter: [{ email: ICH }], privat_einstellungen: [] })
  await verbundenesKonto(d, ICH, { konto: { stand: { mayerStand: new Date().toISOString(), mayerUnterhaltungen: [] } } })
  const ms = falschesMicrosoft((a) => {
    if (a.weg === '/me/mailFolders/inbox/messages') {
      if (a.pfad.includes('internetMessageHeaders')) return new Response('{"error":{"code":"BadRequest","message":"nein"}}', { status: 400 })
      return { value: [ein('K1', 'max.muster@beispiel.de', 'Frage', { internetMessageHeaders: undefined })] }
    }
    if (a.weg === '/me/mailFolders/sentitems/messages') return { value: [] }
  })
  try {
    assertEquals(await unbeantworteteZeilen(d, ICH, JETZT), ['Noch unbeantwortet', '• Max Muster (vor 4 Tagen): Frage'])
  } finally {
    ms()
  }
  const kaputt = falschesMicrosoft(() => new Response('{"error":{"message":"weg"}}', { status: 500 }))
  try {
    assertEquals(await unbeantworteteZeilen(d, ICH, JETZT), [])
  } finally {
    kaputt()
  }
})

// ---------- (B) Zusagen: Vorfilter und KI-Antwort ----------

Deno.test('Zusage-Vorfilter: typische Formulierungen ja, Alltägliches nein', () => {
  const mit = (text: string, extra: Partial<FolgeMail> = {}) => istZusageKandidat(aus('Z', 'max.muster@beispiel.de', 'Re: Wohnung', { bodyPreview: text, ...extra }))
  assert(mit('Ich melde mich morgen bei Ihnen.'))
  assert(mit('Das Angebot schicke ich Ihnen bis Freitag.'))
  assert(mit('Ich kümmere mich darum.'))
  assert(mit('Wir sprechen nächste Woche darüber.'))
  assert(mit('Ich sende Ihnen die Unterlagen zu.'))
  assert(mit('Ich rufe Sie zurück.'))
  assert(!mit('Vielen Dank für Ihre Nachricht. Viele Grüße'))
  assert(!mit('Anbei die Bilder vom Wochenende.'))
  // uniqueBody (nur der eigene Text) geht vor der Vorschau; Zitate unten zählen nicht.
  assert(!mit('Danke!', { uniqueBody: { content: 'Danke, passt so.' } }))
  assert(mit('', { uniqueBody: { content: '<p>Hallo,</p><p>ich melde mich bis Montag.</p>' } }))
  assert(!mit('Ich melde mich.', { subject: 'Automatische Antwort: Abwesend' }))
})

Deno.test('Zusage-KI-Antwort: JSON im Text und als Objekt; kaputtes JSON → null; Beträge raus', () => {
  const gut = werteZusageAntwort('```json\n{"hat_zusage": true, "was": "Angebot über 2.500,00 € schicken.", "bis_datum": "2026-11-28", "an_wen": "Herr Muster"}\n```')
  assert(gut)
  assertEquals(gut, { hat_zusage: true, was: 'Angebot über [Betrag] schicken', bis_datum: '2026-11-28', an_wen: 'Herr Muster' })
  assertEquals(werteZusageAntwort('{"hat_zusage": true, "was": "x"'), null)
  assertEquals(werteZusageAntwort('Keine Zusage.'), null)
  assertEquals(werteZusageAntwort('{"was": "x"}'), null)
  assertEquals(werteZusageAntwort('[1]'), null)
  const ohne = werteZusageAntwort({ hat_zusage: 'ja', was: 'Zurückrufen', bis_datum: '', an_wen: 'Frau Muster' })
  assertEquals([ohne?.hat_zusage, ohne?.bis_datum], [true, null])
  assertEquals(werteZusageAntwort({ hat_zusage: true, was: '', bis_datum: '2026-11-28', an_wen: 'X' })?.hat_zusage, false)
  assertEquals(werteZusageAntwort({ hat_zusage: true, was: 'X tun', bis_datum: '2026-02-30', an_wen: 'X' })?.bis_datum, null)
})

Deno.test('Zusage-Erinnerung: am Fälligkeitstag 9 Uhr Berlin, ohne Datum in 2 Tagen 9 Uhr', () => {
  assertEquals(zusageErinnerung('2026-11-28', JETZT), '2026-11-28T08:00:00.000Z')
  assertEquals(zusageErinnerung(null, JETZT), '2026-11-26T08:00:00.000Z')
  assertEquals(zusageErinnerung('2026-11-24', new Date('2026-11-24T09:00:00Z')), '2026-11-24T10:00:00.000Z') // heute, 9 Uhr vorbei
})

// ---------- (B) Zusagen: ganzer Lauf ----------

type Vorgemerkt = { art: string; beschreibung: string; parameter: Record<string, unknown>; quelle?: string }

async function aufbau(mails: FolgeMail[], antworten: Record<string, unknown>) {
  Deno.env.set('MS_ERLAUBT', ICH)
  const d = falscheDatenbank({ postfaecher: [{ id: 'standard', adresse: 'info@amayer-holding.com' }], mitarbeiter: [{ email: ICH }, { email: 'kollege@amayer-holding.com' }], privat_einstellungen: [] })
  await verbundenesKonto(d, ICH, { konto: { stand: { mayerStand: new Date().toISOString(), mayerUnterhaltungen: [] } } })
  const ms = falschesMicrosoft((a) => {
    if (a.weg === '/me/mailFolders/sentitems/messages') return { value: mails }
    const m = a.weg.match(/^\/me\/messages\/(.+)$/)
    if (m) return { uniqueBody: { contentType: 'text', content: `Text der Mail ${m[1]}` } }
  })
  const fragen: string[] = []
  const vorgemerkt: Vorgemerkt[] = []
  const abhaengig = {
    jetzt: JETZT,
    frageKi: (prompt: string) => {
      fragen.push(prompt)
      const id = prompt.match(/Text der Mail (\S+)/)?.[1] ?? prompt.match(/Kennung (\S+)/)?.[1] ?? ''
      const a = antworten[id]
      if (a instanceof Error) return Promise.reject(a)
      return Promise.resolve(a ?? '{"hat_zusage": false, "was": "", "bis_datum": "", "an_wen": ""}')
    },
    // deno-lint-ignore no-explicit-any
    merkeVor: (_admin: any, ich: string, e: Vorgemerkt) => {
      assertEquals(ich, ICH)
      vorgemerkt.push(e)
      return Promise.resolve({ id: `vm_${vorgemerkt.length}`, telegram: true })
    },
  }
  return { d, ms, fragen, vorgemerkt, abhaengig }
}

const zusage = (was: string, bis: string, an: string) => JSON.stringify({ hat_zusage: true, was, bis_datum: bis, an_wen: an })

Deno.test('Zusagen-Lauf: nur Kandidaten zur KI, ohne Mayer; Zusage vorgemerkt; kaputtes JSON gemerkt; jede Mail nur einmal', async () => {
  const mails = [
    aus('A1', 'max.muster@beispiel.de', 'Re: Wohnung', { bodyPreview: 'Das Angebot schicke ich Ihnen bis Freitag.' }),
    aus('A2', 'erika.muster@beispiel.de', 'Fotos', { bodyPreview: 'Anbei die Fotos.' }),
    aus('A3', 'kollege@amayer-holding.com', 'Kunde', { bodyPreview: 'Ich melde mich morgen.' }),
    aus('A4', 'paul.beispiel@beispiel.de', 'Rückruf', { bodyPreview: 'Ich rufe Sie zurück.' }),
    aus('A5', 'anna.beispiel@beispiel.de', 'Unterlagen', { bodyPreview: 'Ich kümmere mich darum.' }),
  ]
  const t = await aufbau(mails, {
    A1: zusage('Angebot über 1.200 € schicken', '2026-11-27', 'Herr Muster'),
    A4: 'kaputt {',
  })
  try {
    const r = await pruefeZusagen(t.d, ICH, t.abhaengig)
    assertEquals(r.fehler, [])
    assertEquals(r.mails, 4) // Mayer-Mail ausgeblendet
    assertEquals([r.kandidaten, r.geprueft, r.zusagen], [3, 3, 1])
    assert(!t.fragen.some((p) => p.includes('Text der Mail A2') || p.includes('Text der Mail A3')))
    assertStringIncludes(t.fragen[0], 'Heute ist Dienstag, 2026-11-24')
    assertEquals(t.vorgemerkt.length, 1)
    const v = t.vorgemerkt[0]
    assertEquals(v.art, 'zusage_todo')
    assertEquals(v.beschreibung, 'Zusage an Herrn Muster: Angebot über [Betrag] schicken — bis 27.11.')
    assertEquals(v.parameter.aufgabe, 'Angebot über [Betrag] schicken (an Herrn Muster)')
    assertEquals(v.parameter.erledigen_bis, '2026-11-27')
    assertEquals(v.parameter.erinnern_um, '2026-11-27T08:00:00.000Z')
    assertEquals(v.parameter.mailId, 'A1')
    assertStringIncludes(String(v.parameter.bezug), 'Gesendete Mail: „Re: Wohnung“')
    assert(!JSON.stringify(v).includes('1.200'), 'kein Betrag')
    const zeilen = t.d.tabelle(PRUEF_TABELLE)
    assertEquals(zeilen.map((z) => z.ergebnis).sort(), ['keine_zusage', 'unlesbar', 'zusage'])
    assert(zeilen.every((z) => z.art === 'zusage' && z.login_email === ICH))
    assertEquals(zeilen.find((z) => z.ergebnis === 'zusage')?.vormerkung_id, 'vm_1')
    assertEquals(zeilen.find((z) => z.ergebnis === 'zusage')?.mail_id, '<A1@test>')

    // Zweiter Lauf: nichts mehr zur KI, nichts doppelt vorgemerkt.
    const r2 = await pruefeZusagen(t.d, ICH, t.abhaengig)
    assertEquals([r2.kandidaten, r2.geprueft, r2.zusagen], [0, 0, 0])
    assertEquals(t.fragen.length, 3)
    assertEquals(t.vorgemerkt.length, 1)
  } finally {
    t.ms()
  }
})

Deno.test('Zusagen-Lauf: Termin-Zeilen derselben Mail stören nicht; ohne Datum Erinnerung in 2 Tagen; höchstens 10 KI-Prüfungen; Fehler wird wiederholt', async () => {
  const viele = Array.from({ length: 13 }, (_, i) =>
    aus(`B${i}`, 'max.muster@beispiel.de', `Sache ${i}`, { bodyPreview: 'Ich melde mich nächste Woche.', sentDateTime: `2026-11-23T${String(i + 5).padStart(2, '0')}:00:00Z` }))
  const t = await aufbau(viele, {
    B12: zusage('Rückmeldung geben', '', 'Frau Muster'),
    B11: new Error('KI-Dienst antwortet mit 529'),
    B10: zusage('Unterlagen schicken', '2026-11-20', 'Herr Muster'), // schon vorbei
  })
  // Der Termin-Baustein hat B12 schon geprüft — andere art, darf die Zusage-Prüfung nicht verhindern.
  t.d.tabelle(PRUEF_TABELLE).push({ id: 'fremd', login_email: ICH, art: 'termin', mail_id: '<B12@test>', geprueft_am: JETZT.toISOString(), ergebnis: 'kein_termin' })
  try {
    const r = await pruefeZusagen(t.d, ICH, t.abhaengig)
    assertEquals(t.fragen.length, KI_HOECHSTENS)
    assertEquals([r.kandidaten, r.geprueft, r.uebrig, r.zusagen], [13, 9, 3, 1])
    assertEquals(r.fehler.length, 1)
    const v = t.vorgemerkt[0]
    assertEquals(v.beschreibung, 'Zusage an Frau Muster: Rückmeldung geben')
    assertEquals(v.parameter.erledigen_bis, null)
    assertEquals(v.parameter.erinnern_um, '2026-11-26T08:00:00.000Z')
    const eigene = t.d.tabelle(PRUEF_TABELLE).filter((z) => z.art === 'zusage')
    assertEquals(eigene.length, 9) // die fehlgeschlagene Mail ist wieder freigegeben
    assertEquals(eigene.filter((z) => z.ergebnis === 'vergangen').length, 1)

    const vorher = t.fragen.length
    const r2 = await pruefeZusagen(t.d, ICH, { ...t.abhaengig, frageKi: (p: string) => t.abhaengig.frageKi(p.replace('B11', 'B11-ok')) })
    assertEquals(t.fragen.length - vorher, 4) // 3 übrige + die fehlgeschlagene
    assertEquals(r2.geprueft, 4)
    assertEquals(t.vorgemerkt.length, 1)
  } finally {
    t.ms()
  }
})

Deno.test('Zusagen-Lauf: ohne Freischaltung oder ohne Konto passiert nichts', async () => {
  Deno.env.set('MS_ERLAUBT', 'jemand@anders.de')
  const d = falscheDatenbank()
  const r = await pruefeZusagen(d, ICH, { frageKi: () => Promise.reject(new Error('darf nicht')) })
  assertEquals(r.hinweis, 'Microsoft für diesen Login nicht freigeschaltet.')
  Deno.env.set('MS_ERLAUBT', ICH)
  const r2 = await pruefeZusagen(d, ICH, { frageKi: () => Promise.reject(new Error('darf nicht')) })
  assertEquals(r2.hinweis, 'Kein Microsoft-Konto verbunden.')
})

// ---------- (B) Ausführer ----------

Deno.test('Zusage-Ausführer: legt genau ein To-do in der eigenen Liste an, auch bei zweitem Klick', async () => {
  const d = falscheDatenbank({ todos: [{ id: 'todo_alt', besitzer_email: ICH, bereich: null, reihenfolge: 3, aufgabe: 'Altes' }, { id: 'todo_ber', besitzer_email: ICH, bereich: 'beratung', reihenfolge: 40 }] })
  const p = {
    aufgabe: 'Angebot schicken (an Herrn Muster)',
    erledigen_bis: '2026-11-28',
    erinnern_um: '2026-11-20T08:00:00.000Z', // inzwischen vorbei → neu gerechnet
    mailId: 'A1',
    mailSchluessel: '<A1@test>',
    an_wen: 'Herr Muster',
    betreff: 'Re: Wohnung für 300.000 €',
    gesendet: '2026-11-23',
  }
  const text = await zusageTodoAusfuehrer(d, ICH, p, JETZT)
  assertStringIncludes(text, 'To-do angelegt')
  assertStringIncludes(text, '28.11.2026')
  const zweit = await zusageTodoAusfuehrer(d, ICH.toUpperCase(), p, JETZT)
  assertStringIncludes(zweit, 'Schon in deiner To-do-Liste')
  const neu = d.tabelle('todos').filter((z) => String(z.id).startsWith('todo_zusage'))
  assertEquals(neu.length, 1)
  const t = neu[0]
  assertEquals([t.besitzer_email, t.bereich, t.reihenfolge, t.erledigen_bis], [ICH, null, 4, '2026-11-28'])
  assertEquals(t.erinnern_um, '2026-11-28T08:00:00.000Z')
  assertEquals(t.aktueller_stand, `${MARKE}Herr Muster vom 23.11.2026: „Re: Wohnung für [Betrag]“`)
  // Ohne Datum: kein erledigen_bis, Erinnerung in 2 Tagen.
  await zusageTodoAusfuehrer(d, ICH, { aufgabe: 'Zurückrufen', mailSchluessel: '<A9@test>', an_wen: 'Frau Muster' }, JETZT)
  const ohne = d.tabelle('todos').filter((z) => String(z.id).startsWith('todo_zusage')).find((z) => z.aufgabe === 'Zurückrufen')!
  assertEquals([ohne.erledigen_bis, ohne.erinnern_um], [null, '2026-11-26T08:00:00.000Z'])
})
