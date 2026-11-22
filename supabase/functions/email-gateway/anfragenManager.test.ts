import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import {
  bewerteObjekte,
  entscheide,
  kennungenAusText,
  kontaktAusText,
  type KiAntwort,
  type KiEingabe,
  type Kontext,
  type MailZeile,
  portalVon,
  pruefeNeueAnfragen,
  REGEL_ID,
} from './anfragenManager.ts'
import { pruefeAnlass } from './autoNachrichten.ts'

// ---------------------------------------------------------------------------------------------------
// Testmails (ausgedacht, aber im Aufbau wie echte Portal-Mails)
// ---------------------------------------------------------------------------------------------------

const SCOUT_TEXT = `Guten Tag,

Sie haben eine neue Kontaktanfrage zu Ihrem Objekt erhalten.

Objekt: Mehrfamilienhaus mit 6 Einheiten in Blaubeuren
Scout-ID: 151234567
Ihre Objekt-Nr.: MH-2026-07
Anschrift: Karlstraße 12, 89143 Blaubeuren

Kontaktdaten des Interessenten
Anrede: Herr
Vorname: Jonas
Nachname: Beispielmann
E-Mail: jonas.beispielmann@example.org
Telefon: 0171 2345678

Nachricht:
Guten Tag, ich interessiere mich für das Haus und hätte gerne das Exposé. Ist eine Besichtigung möglich?

Ihr ImmoScout24-Team`

const NEWSLETTER_TEXT = `Hallo,

die Marktdaten für November sind da: Die Angebotspreise in Ulm sind um 1,2 % gestiegen.
Jetzt Premium-Mitgliedschaft sichern und mehr Kontakte erhalten!

Ihr immowelt-Team · Abmelden`

const DIREKT_TEXT = `Sehr geehrte Damen und Herren,

ich habe gesehen, dass Sie das Haus in der Karlstr. 12 in Blaubeuren verkaufen. Ist es noch zu haben?
Ich hätte großes Interesse und würde mir gerne die Unterlagen ansehen.

Viele Grüße
Petra Probe
Tel. 0731 9876543`

function mail(id: string, felder: Partial<MailZeile> & { erstellt_am?: string }): Zeile {
  return {
    id,
    message_id: `<${id}@test>`,
    besitzer_email: null,
    ignoriert: false,
    zugewiesener_kunde_id: null,
    relevanz: 'nicht_relevant',
    mail_datum: new Date().toISOString(),
    erstellt_am: new Date(Date.now() - 60_000).toISOString(),
    ...felder,
  } as Zeile
}

const OBJEKTE: Zeile[] = [
  {
    id: 'o_ql_orhan-blaubeuren',
    bezeichnung: 'Blaubeuren – Haus mit 3 Wohnungen (Orhan)',
    adresse: 'Karlstraße 12, 89143 Blaubeuren',
    typ: 'MFH',
    kaufpreis: 690000,
    status: 'vermarktung',
    verantwortlich: 'Quirin Lutzenberger',
    privat_besitzer: null,
    anfrage_kennungen: ['151234567'],
    activities: [{ id: 'a0', text: 'alt' }],
    eigentuemer: { name: 'Orhan', email: 'orhan@example.net' },
  },
  {
    id: 'o_ql_villa-donaueschingen',
    bezeichnung: 'Villa Donaueschingen',
    adresse: 'Donaueschingen',
    typ: 'EFH',
    kaufpreis: 1450000,
    status: 'akquise',
    verantwortlich: 'Quirin Lutzenberger',
    privat_besitzer: null,
    anfrage_kennungen: null,
    activities: [],
  },
  {
    id: 'o_privat_1',
    bezeichnung: 'Privates Haus Karlstraße',
    adresse: 'Karlstraße 12, 89143 Blaubeuren',
    status: 'akquise',
    verantwortlich: 'Hasan Süslü',
    privat_besitzer: 'sueslue@hotmail.com',
    anfrage_kennungen: ['151234567'],
    activities: [],
  },
]

function grundstand(mails: Zeile[], extra: Record<string, Zeile[]> = {}): Record<string, Zeile[]> {
  return {
    eingegangene_emails: mails,
    objekte: structuredClone(OBJEKTE),
    mitarbeiter: [
      { name: 'Quirin Lutzenberger', email: 'immo@amayer-holding.com', aktiv: true, telegram_chat_id: 111 },
      { name: 'Hasan Süslü', email: 'sueslue@hotmail.com', aktiv: true, telegram_chat_id: 222 },
      { name: 'Eray Yesil', email: 'eray.yesil@fundament-it.de', aktiv: true, telegram_chat_id: 333 },
    ],
    auto_nachricht_regeln: [{ id: REGEL_ID, titel: 'Portal-Link nach einer Anfrage', aktiv: false, wartezeit_minuten: 10 }],
    kunden: [],
    objekt_freigaben: [],
    objekt_anfragen: [],
    auto_nachrichten: [],
    ...extra,
  }
}

/** Testdatenbank plus rpc('auto_nachricht_vormerken') wie in der echten Datenbank (inaktive Regel ⇒ nichts). */
function aufbau(tabellen: Record<string, Zeile[]>) {
  const db = falscheDatenbank(tabellen)
  const rpcAufrufe: { name: string; args: Record<string, unknown> }[] = []
  const admin = {
    from: (t: string) => {
      const q = db.from(t)
      if (t === 'objekt_anfragen') {
        // Primärschlüssel ist email_id: die Testdatenbank prüft Doppelte über `id`, also id = email_id.
        const einfuegen = q.insert.bind(q)
        q.insert = (z: Zeile | Zeile[]) => einfuegen(Array.isArray(z) ? z.map((x) => ({ ...x, id: x.email_id })) : { ...z, id: z.email_id })
      }
      return q
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcAufrufe.push({ name, args })
      if (name === 'auto_nachricht_vormerken') {
        const regel = db.tabellen.auto_nachricht_regeln.find((r) => r.id === args.p_regel)
        if (regel?.aktiv) db.tabelle('auto_nachrichten').push({ id: crypto.randomUUID(), regel: args.p_regel, freigabe_id: args.p_freigabe, status: 'geplant' })
        return Promise.resolve({ data: null, error: null })
      }
      return Promise.resolve({ data: null, error: { message: 'unbekannt' } })
    },
  }
  const telegramm: { chat: number | string | null; text: string }[] = []
  const sendeTelegram = (chat: number | string | null, text: string) => {
    telegramm.push({ chat, text })
    return Promise.resolve(true)
  }
  return { db, admin, rpcAufrufe, telegramm, sendeTelegram }
}

function kiMit(antwort: Partial<KiAntwort>, aufrufe: KiEingabe[] = []) {
  return (e: KiEingabe) => {
    aufrufe.push(e)
    return Promise.resolve({ ist_anfrage: true, objekt_id: '', sicherheit: 'hoch', name: '', email: '', telefon: '', begruendung: 'Test', ...antwort } as KiAntwort)
  }
}

const kiVerboten = () => Promise.reject(new Error('Die KI hätte hier nicht gefragt werden dürfen'))

// ---------------------------------------------------------------------------------------------------
// Feste Regeln
// ---------------------------------------------------------------------------------------------------

Deno.test('Kontaktblock einer Portal-Anfrage wird gelesen', () => {
  const k = kontaktAusText(SCOUT_TEXT)
  assertEquals(k, { name: 'Jonas Beispielmann', email: 'jonas.beispielmann@example.org', telefon: '0171 2345678' })
  assertEquals(kontaktAusText(DIREKT_TEXT).telefon, '0731 9876543')
})

Deno.test('Kennungen und Portale werden erkannt', () => {
  const k = kennungenAusText(SCOUT_TEXT)
  assert(k.includes('151234567'))
  assert(k.includes('mh202607'))
  assertEquals(portalVon('no-reply@immobilienscout24.de'), 'ImmoScout24')
  assertEquals(portalVon('anonym-abc123@mail.kleinanzeigen.de'), 'Kleinanzeigen')
  assertEquals(portalVon('kunde@gmx.de'), null)
})

Deno.test('Objektvergleich: Inserat-Nummer, Straße mit Hausnummer, Bezeichnung', () => {
  const objekte = OBJEKTE.filter((o) => !o.privat_besitzer) as never[]
  assertEquals(bewerteObjekte(objekte, 'Kontaktanfrage', SCOUT_TEXT)[0].punkte, 100)
  const direkt = bewerteObjekte(objekte, 'Anfrage', DIREKT_TEXT)
  assertEquals(direkt.length, 1)
  assertEquals(direkt[0].punkte, 80)
  assertEquals(bewerteObjekte(objekte, 'Anfrage zu Ihrem Inserat: Villa Donaueschingen', '')[0].objekt.id, 'o_ql_villa-donaueschingen')
  // Nur ein Ortsname reicht nicht.
  assertEquals(bewerteObjekte(objekte, 'Wohnung in Donaueschingen gesucht', '').length, 0)
})

Deno.test('KI-Angaben, die nicht in der Mail stehen, werden verworfen', async () => {
  const k: Kontext = { objekte: OBJEKTE as never[], mitarbeiterAdressen: new Set() }
  const m: MailZeile = { id: 'x', von: 'noreply@immowelt.de', von_name: 'immowelt', betreff: 'Neue Anfrage zu Ihrem Inserat', ausschnitt: 'Ein Interessent hat Interesse an Ihrem Angebot. Bitte loggen Sie sich ein, um die Nachricht zu lesen.' }
  const e = await entscheide(m, k, kiMit({ objekt_id: 'o_ql_villa-donaueschingen', email: 'erfunden@example.com', telefon: '0170 1111111', name: 'Erfundener Name' }))
  // Objekt sicher, aber kein Kontakt in der Mail ⇒ nichts anlegen.
  assertEquals(e.art, 'unklar')
  if (e.art === 'unklar') assertEquals(e.kontakt.email, '')
})

// ---------------------------------------------------------------------------------------------------
// Der Lauf
// ---------------------------------------------------------------------------------------------------

Deno.test('ImmoScout24-Anfrage: Akte, Zugang, Verlauf, Zuordnung, Nachricht an den Verantwortlichen — ohne KI', async () => {
  const t = aufbau(grundstand([mail('m1', { von: 'no-reply@immobilienscout24.de', von_name: 'ImmoScout24', betreff: 'Kontaktanfrage zu Ihrem Objekt (Scout-ID 151234567)', rohdaten: { plain: SCOUT_TEXT, 'headers[reply_to]': 'Jonas Beispielmann <jonas.beispielmann@example.org>' } })]))
  const r = await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiVerboten })
  assertEquals(r.angelegt, 1, JSON.stringify(r))
  assertEquals(r.fehler, 0)

  const kunden = t.db.tabellen.kunden
  assertEquals(kunden.length, 1)
  assertEquals(kunden[0].bereich, 'immobilienkunden')
  assertEquals(kunden[0].status, 'interessent')
  assertEquals(kunden[0].email, 'jonas.beispielmann@example.org')
  assertEquals(kunden[0].telefon, '0171 2345678')
  assertEquals(kunden[0].verantwortlich, 'Quirin Lutzenberger')
  // „automatisch angelegt“ verhindert die Willkommensnachricht (Datenbank-Auslöser).
  assertMatch(String((kunden[0].activities as Zeile[])[0].text), /automatisch angelegt/i)

  const f = t.db.tabellen.objekt_freigaben
  assertEquals(f.length, 1)
  assertEquals(f[0].objekt_id, 'o_ql_orhan-blaubeuren')
  assertEquals(f[0].kunde_id, kunden[0].id)
  assertEquals(f[0].quelle, 'anfrage')
  assertEquals(f[0].anfrage_email_id, 'm1')
  assertEquals(f[0].provision, '3 % des beurkundeten Kaufpreises zzgl. gesetzlicher Umsatzsteuer')
  assertMatch(String(f[0].token), /^[A-Za-z0-9_-]{43}$/)

  const objekt = t.db.tabellen.objekte.find((o) => o.id === 'o_ql_orhan-blaubeuren')!
  assertEquals((objekt.activities as Zeile[]).length, 2)
  assertMatch(String((objekt.activities as Zeile[])[0].text), /über ImmoScout24 von Jonas Beispielmann/)

  const m = t.db.tabellen.eingegangene_emails[0]
  assertEquals(m.zugewiesener_kunde_id, kunden[0].id)
  assertEquals(m.relevanz, 'kunde')

  assertEquals(t.rpcAufrufe, [{ name: 'auto_nachricht_vormerken', args: { p_regel: REGEL_ID, p_besichtigung: null, p_freigabe: f[0].id } }])
  // Regel aus ⇒ nichts vorgemerkt.
  assertEquals(t.db.tabellen.auto_nachrichten.length, 0)

  assertEquals(t.telegramm.length, 1)
  assertEquals(t.telegramm[0].chat, 111)
  assertMatch(t.telegramm[0].text, /Neue Anfrage zu „Blaubeuren – Haus mit 3 Wohnungen \(Orhan\)“ von Jonas Beispielmann \(über ImmoScout24\) — Portal-Link ist angelegt\./)
  assertMatch(t.telegramm[0].text, /ausgeschaltet/)

  const stand = t.db.tabellen.objekt_anfragen[0]
  assertEquals(stand.status, 'angelegt')
  assertEquals(stand.ki_genutzt, false)
  assertEquals(stand.gemeldet_an, ['Quirin Lutzenberger'])

  // Zweiter Lauf: dieselbe Mail wird nie noch einmal bearbeitet.
  const r2 = await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiVerboten })
  assertEquals(r2.geprueft, 0)
  assertEquals(t.db.tabellen.objekt_freigaben.length, 1)
  assertEquals(t.telegramm.length, 1)
})

Deno.test('Regel an: Nachricht wird vorgemerkt, Telegram nennt die Wartezeit', async () => {
  const stand = grundstand([mail('m1', { von: 'no-reply@immobilienscout24.de', von_name: 'ImmoScout24', betreff: 'Kontaktanfrage', rohdaten: { plain: SCOUT_TEXT } })])
  stand.auto_nachricht_regeln[0].aktiv = true
  const t = aufbau(stand)
  await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiVerboten })
  assertEquals(t.db.tabellen.auto_nachrichten.length, 1)
  assertMatch(t.telegramm[0].text, /geht in 10 Minuten von selbst hinaus/)
})

Deno.test('Direkte Mail mit Adresse: KI bestätigt, vorhandene Akte wird genutzt', async () => {
  const kiAufrufe: KiEingabe[] = []
  const t = aufbau(
    grundstand([mail('m2', { von: 'petra.probe@gmx.de', von_name: 'Petra Probe', betreff: 'Haus in Blaubeuren', ausschnitt: DIREKT_TEXT })], {
      kunden: [{ id: 'k_alt', bereich: 'immobilienkunden', email: 'Petra.Probe@gmx.de', telefon: '', status: 'interessent', activities: [{ id: 'x', text: 'alt' }] }],
    }),
  )
  const r = await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiMit({ objekt_id: 'o_ql_orhan-blaubeuren', name: 'Petra Probe' }, kiAufrufe) })
  assertEquals(r.angelegt, 1, JSON.stringify(r))
  assertEquals(kiAufrufe.length, 1)
  // Nur das genannte Objekt geht an die KI, nie das private.
  assertEquals(kiAufrufe[0].objekte.map((o) => o.id), ['o_ql_orhan-blaubeuren'])
  assertEquals(t.db.tabellen.kunden.length, 1)
  const akte = t.db.tabellen.kunden[0]
  assertEquals((akte.activities as Zeile[]).length, 2)
  assertEquals(akte.telefon, '0731 9876543')
  assertEquals(t.db.tabellen.objekt_freigaben[0].kunde_id, 'k_alt')
  assertEquals(t.db.tabellen.objekt_freigaben[0].email, 'petra.probe@gmx.de')
  assertMatch(t.telegramm[0].text, /Die Akte gab es schon/)
  assertEquals(t.db.tabellen.objekt_anfragen[0].ki_genutzt, true)
})

Deno.test('Newsletter und Mails ohne Objektbezug: still, ohne KI', async () => {
  const t = aufbau(
    grundstand([
      mail('n1', { von: 'newsletter@immowelt.de', von_name: 'immowelt', betreff: 'Ihre Marktdaten im November', ausschnitt: NEWSLETTER_TEXT }),
      mail('n2', { von: 'rechnung@telefonanbieter.de', von_name: 'Telefonanbieter', betreff: 'Ihre Rechnung November', ausschnitt: 'Ihre Rechnung über 39,99 € liegt bereit.' }),
      mail('n3', { von: 'immo@amayer-holding.com', von_name: 'Quirin', betreff: 'Anfrage Karlstraße 12', ausschnitt: 'Interne Notiz zur Anfrage.' }),
    ]),
  )
  const r = await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiVerboten })
  assertEquals(r.keine, 3, JSON.stringify(r))
  assertEquals(t.telegramm.length, 0)
  assertEquals(t.db.tabellen.kunden.length, 0)
  assertEquals(t.db.tabellen.objekt_freigaben.length, 0)
  assertEquals(t.db.tabellen.objekt_anfragen.map((z) => z.status), ['keine_anfrage', 'keine_anfrage', 'keine_anfrage'])
})

Deno.test('Portal-Anfrage ohne erkennbares Objekt: nichts anlegen, eine Nachricht an den Hauptzuständigen', async () => {
  const text = SCOUT_TEXT.replace('Scout-ID: 151234567', 'Scout-ID: 999999999').replace('Ihre Objekt-Nr.: MH-2026-07\n', '').replace('Anschrift: Karlstraße 12, 89143 Blaubeuren', 'Anschrift: Bahnhofstraße 1, 89073 Ulm')
  const t = aufbau(grundstand([mail('u1', { von: 'no-reply@immobilienscout24.de', von_name: 'ImmoScout24', betreff: 'Kontaktanfrage zu Ihrem Objekt', rohdaten: { plain: text } })]))
  const r = await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiMit({ objekt_id: '', sicherheit: 'niedrig', begruendung: 'Kein Objekt passt' }) })
  assertEquals(r.unklar, 1, JSON.stringify(r))
  assertEquals(t.db.tabellen.kunden.length, 0)
  assertEquals(t.db.tabellen.objekt_freigaben.length, 0)
  assertEquals(t.telegramm.length, 1)
  assertEquals(t.telegramm[0].chat, 111)
  assertMatch(t.telegramm[0].text, /Mögliche Anfrage über ImmoScout24 von Jonas Beispielmann/)
  assertMatch(t.telegramm[0].text, /Es wurde nichts angelegt/)
})

Deno.test('Gibt es schon einen offenen Zugang, entsteht nichts Neues und es kommt keine Nachricht', async () => {
  const t = aufbau(
    grundstand([mail('v1', { von: 'no-reply@immobilienscout24.de', betreff: 'Kontaktanfrage', rohdaten: { plain: SCOUT_TEXT } })], {
      objekt_freigaben: [{ id: 'f_alt', objekt_id: 'o_ql_orhan-blaubeuren', email: 'jonas.beispielmann@example.org', status: 'eingeladen' }],
    }),
  )
  const r = await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiVerboten })
  assertEquals(r.vorhanden, 1)
  assertEquals(t.db.tabellen.objekt_freigaben.length, 1)
  assertEquals(t.db.tabellen.kunden.length, 0)
  assertEquals(t.telegramm.length, 0)
})

Deno.test('Zwei gleichzeitige Läufe bearbeiten jede Mail nur einmal', async () => {
  const t = aufbau(grundstand([mail('p1', { von: 'no-reply@immobilienscout24.de', betreff: 'Kontaktanfrage', rohdaten: { plain: SCOUT_TEXT } })]))
  const [a, b] = await Promise.all([
    pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiVerboten }),
    pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiVerboten }),
  ])
  assertEquals(a.geprueft + b.geprueft, 1)
  assertEquals(t.db.tabellen.objekt_freigaben.length, 1)
  assertEquals(t.db.tabellen.kunden.length, 1)
  assertEquals(t.telegramm.length, 1)
})

Deno.test('Alte Mails, Mails vor dem Start, private und ausgeblendete Mails bleiben unberührt', async () => {
  const alt = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()
  const t = aufbau(
    grundstand(
      [
        mail('a1', { von: 'no-reply@immobilienscout24.de', betreff: 'Kontaktanfrage', rohdaten: { plain: SCOUT_TEXT }, erstellt_am: alt }),
        mail('a2', { von: 'no-reply@immobilienscout24.de', betreff: 'Kontaktanfrage', rohdaten: { plain: SCOUT_TEXT } }),
        mail('a3', { von: 'no-reply@immobilienscout24.de', betreff: 'Kontaktanfrage', rohdaten: { plain: SCOUT_TEXT }, besitzer_email: 'immo@amayer-holding.com' }),
        mail('a4', { von: 'no-reply@immobilienscout24.de', betreff: 'Kontaktanfrage', rohdaten: { plain: SCOUT_TEXT }, ignoriert: true }),
      ],
      { objekt_anfragen: [{ id: 'a2', email_id: 'a2', status: 'vor_start', versuche: 0, aktualisiert_am: new Date().toISOString() }] },
    ),
  )
  const r = await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiVerboten })
  assertEquals(r.geprueft, 1, JSON.stringify(r))
  assertEquals(r.keine, 1)
  assertEquals(t.db.tabellen.objekt_anfragen.find((z) => z.email_id === 'a4')?.status, 'keine_anfrage')
  assertEquals(t.db.tabellen.objekt_freigaben.length, 0)
  assertEquals(t.telegramm.length, 0)
})

Deno.test('Fehler des KI-Dienstes: später noch einmal, nach drei Versuchen „fehler“', async () => {
  const t = aufbau(grundstand([mail('e1', { von: 'petra.probe@gmx.de', von_name: 'Petra Probe', betreff: 'Haus in Blaubeuren', ausschnitt: DIREKT_TEXT })]))
  const kaputt = () => Promise.reject(new Error('KI-Dienst antwortet mit 529'))
  const r1 = await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kaputt })
  assertEquals(r1.fehler, 1)
  assertEquals(t.db.tabellen.objekt_anfragen[0].status, 'wiederholen')
  await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kaputt })
  await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kaputt })
  assertEquals(t.db.tabellen.objekt_anfragen[0].status, 'fehler')
  assertEquals(t.db.tabellen.objekt_anfragen[0].versuche, 3)
  const r4 = await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kaputt })
  assertEquals(r4.geprueft, 0)
  // Von Hand „erneut prüfen“ geht trotzdem.
  const r5 = await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiMit({ objekt_id: 'o_ql_orhan-blaubeuren' }) }, { emailId: 'e1', erneut: true })
  assertEquals(r5.angelegt, 1, JSON.stringify(r5))
  assertEquals(t.telegramm.length, 1)
})

Deno.test('Kleinanzeigen: weitergeleitete Absenderadresse gilt als Kontakt, der Eigentümer nie als Interessent', async () => {
  const text = `Nutzer-Anfrage zu deiner Anzeige "Mehrfamilienhaus Blaubeuren"\nAnzeigennummer: 151234567\n\nHallo, ist das Haus noch verfügbar? Ich würde es gerne besichtigen.\nGruß Lena`
  const t = aufbau(
    grundstand([
      mail('k1', { von: 'anonym-7f3a9c@mail.kleinanzeigen.de', von_name: 'Lena K. über Kleinanzeigen', betreff: 'Nutzer-Anfrage zu deiner Anzeige', ausschnitt: text }),
      mail('k2', { von: 'orhan@example.net', von_name: 'Orhan', betreff: 'Anfrage wegen Karlstraße 12', ausschnitt: 'Gibt es schon Interesse an meinem Haus in der Karlstraße 12? Bitte um Rückmeldung zur Besichtigung.' }),
    ]),
  )
  const r = await pruefeNeueAnfragen(t.admin, { sendeTelegram: t.sendeTelegram, ki: kiVerboten })
  assertEquals(r.angelegt, 1, JSON.stringify(r))
  assertEquals(r.keine, 1)
  assertEquals(t.db.tabellen.objekt_freigaben[0].email, 'anonym-7f3a9c@mail.kleinanzeigen.de')
  assertEquals(t.db.tabellen.objekt_freigaben[0].name, 'Lena K.')
})

Deno.test('Versand-Prüfung der neuen Regel: nur offener, noch nicht zugestimmter Zugang', async () => {
  const db = falscheDatenbank({
    objekte: [{ id: 'o1', privat_besitzer: null }],
    objekt_freigaben: [
      { id: 'f1', status: 'eingeladen', widerrufen_am: null, gueltig_bis: new Date(Date.now() + 86400_000).toISOString() },
      { id: 'f2', status: 'zugestimmt', widerrufen_am: null, gueltig_bis: new Date(Date.now() + 86400_000).toISOString() },
      { id: 'f3', status: 'widerrufen', widerrufen_am: new Date().toISOString(), gueltig_bis: null },
      { id: 'f4', status: 'eingeladen', widerrufen_am: null, gueltig_bis: new Date(Date.now() - 1000).toISOString() },
    ],
  })
  const z = (freigabe_id: string) => ({ regel: REGEL_ID, objekt_id: 'o1', freigabe_id })
  assertEquals(await pruefeAnlass(db, z('f1')), null)
  assertEquals(await pruefeAnlass(db, z('f2')), 'Interessent hat schon zugestimmt')
  assertEquals(await pruefeAnlass(db, z('f3')), 'Zugang zum Portal wurde beendet')
  assertEquals(await pruefeAnlass(db, z('f4')), 'Link ist abgelaufen')
  assertEquals(await pruefeAnlass(db, z('f9')), 'Zugang zum Portal gibt es nicht mehr')
})
