// Privater Assistent (zweiter Telegram-Bot, privatBot.ts): Webhook-Prüfung, Schlüsselwahl im privaten
// Rahmen, Werkzeugliste, Rechte nur für eigene private Sachen und getrennter Gesprächszustand.
// Datenbank im Speicher (_shared/testDoppel.ts), kein Netz.
//
//   npx -y deno test --allow-env --allow-read --allow-net=localhost telegram-gateway/
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { darfAkte, darfBereich, darfObjekt, istFremdePrivatakte, siehtAlleBereiche } from './rechte.ts'
import { botToken, imPrivatBot, imPrivatBotErlaubt, mitBot, PRIVAT_BOT_WERKZEUGE } from './privatBot.ts'
import { fuehrePrivatWerkzeugAus, istPrivatWerkzeug } from './outlookWerkzeuge.ts'
import { merkePrivatBotAktiv, privatBotAktiv, privatWebhookGeheimnis } from '../_shared/telegramPrivat.ts'
import { falscheDatenbank, type FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'

// index.ts startet beim Laden seinen Server; für den Test genügt ein stiller Ersatz.
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = () => ({ finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: 'localhost', port: 0 } })
const { bearbeiteAnfrage, fuehreWerkzeugAus, ladeZustandRoh, speichereZustand, werkzeugListe } = await import('./index.ts')
type Kontext = Parameters<typeof fuehreWerkzeugAus>[2]

/** Umgebungsvariablen nur für die Dauer von `arbeit` setzen (undefined = entfernen). */
async function mitUmgebung<T>(werte: Record<string, string | undefined>, arbeit: () => Promise<T> | T): Promise<T> {
  const vorher = Object.fromEntries(Object.keys(werte).map((k) => [k, Deno.env.get(k)]))
  const setze = (w: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(w)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v)
  }
  setze(werte)
  try {
    return await arbeit()
  } finally {
    setze(vorher)
  }
}

const HASAN = { id: 'm_h', name: 'Hasan Haber', email: 'hasan@firma.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] as string[] }
const HASAN_PRIVAT = { ...HASAN, nurPrivat: true }
const CARL = { id: 'm_c', name: 'Carl Kollege', email: 'carl@firma.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }

// ---------------------------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------------------------

function webhook(geheimnis?: string, body: unknown = { update_id: 1 }): Request {
  return new Request('https://test.local/functions/v1/telegram-gateway?bot=privat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(geheimnis ? { 'x-telegram-bot-api-secret-token': geheimnis } : {}) },
    body: JSON.stringify(body),
  })
}

Deno.test('Webhook des privaten Bots: ohne Schlüssel 404, falsches oder fehlendes Geheimnis 401, richtiges 200', async () => {
  await mitUmgebung({ PRIVAT_TELEGRAM_BOT_TOKEN: undefined, SUPABASE_SERVICE_ROLE_KEY: 'dienst-schluessel-fuer-den-test-1234567890' }, async () => {
    const geheimnis = (await privatWebhookGeheimnis())!
    assertEquals((await bearbeiteAnfrage(webhook(geheimnis))).status, 404, 'ohne PRIVAT_TELEGRAM_BOT_TOKEN gibt es den Weg nicht')
  })
  await mitUmgebung({ PRIVAT_TELEGRAM_BOT_TOKEN: '123:privat', SUPABASE_SERVICE_ROLE_KEY: 'dienst-schluessel-fuer-den-test-1234567890' }, async () => {
    const geheimnis = (await privatWebhookGeheimnis())!
    assertEquals(geheimnis.length, 48)
    assert(/^[0-9a-f]+$/.test(geheimnis), 'nur Zeichen, die Telegram als secret_token erlaubt')
    assertEquals((await bearbeiteAnfrage(webhook())).status, 401)
    assertEquals((await bearbeiteAnfrage(webhook('falsch'))).status, 401)
    // Ein einziges Zeichen anders.
    assertEquals((await bearbeiteAnfrage(webhook(`${geheimnis.slice(0, 47)}${geheimnis.endsWith('0') ? '1' : '0'}`))).status, 401)
    // Das Geheimnis des Mayer-Bots öffnet den privaten Weg nicht.
    assertEquals((await bearbeiteAnfrage(webhook(Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? 'mayer-geheimnis'))).status, 401)
    const ok = await bearbeiteAnfrage(webhook(geheimnis))
    assertEquals(ok.status, 200)
    assertEquals(await ok.text(), 'ok')
  })
  // Anderer Dienst-Schlüssel → anderes Geheimnis.
  const a = await mitUmgebung({ SUPABASE_SERVICE_ROLE_KEY: 'schluessel-a-xxxxxxxxxxxxxxxxxxxxxxxxxx' }, () => privatWebhookGeheimnis())
  const b = await mitUmgebung({ SUPABASE_SERVICE_ROLE_KEY: 'schluessel-b-xxxxxxxxxxxxxxxxxxxxxxxxxx' }, () => privatWebhookGeheimnis())
  assert(a && b && a !== b)
})

// ---------------------------------------------------------------------------------------------
// Schlüsselwahl im Rahmen
// ---------------------------------------------------------------------------------------------

Deno.test('botToken: privater Schlüssel nur im privaten Rahmen, auch nach await', async () => {
  await mitUmgebung({ PRIVAT_TELEGRAM_BOT_TOKEN: '123:privat' }, async () => {
    assertEquals(botToken('456:mayer'), '456:mayer')
    assert(!imPrivatBot())
    assertEquals(mitBot(true, () => botToken('456:mayer')), '123:privat')
    const spaeter = await mitBot(true, async () => {
      await new Promise((r) => setTimeout(r, 5))
      await Promise.resolve()
      return [imPrivatBot(), botToken('456:mayer')] as const
    })
    assertEquals(spaeter, [true, '123:privat'])
    // Ausdrücklich zurück zum Mayer-Bot (Nachrichten an Kollegen).
    assertEquals(mitBot(true, () => mitBot(false, () => botToken('456:mayer'))), '456:mayer')
    assertEquals(botToken('456:mayer'), '456:mayer', 'nach dem Rahmen wieder der Mayer-Bot')
  })
})

// ---------------------------------------------------------------------------------------------
// Werkzeugliste
// ---------------------------------------------------------------------------------------------

Deno.test('Werkzeuge: privater Assistent bekommt nur seine Liste, Mayer-Werkzeuge nie', () => {
  const voll = werkzeugListe({ briefe: true, outlook: true }, false)
  const privat = werkzeugListe({ briefe: true, outlook: true }, true)
  const namen = privat.map((w) => w.name)
  // Jeder Name der Liste gibt es wirklich (kein Tippfehler, der still ein Werkzeug verschwinden ließe).
  for (const n of PRIVAT_BOT_WERKZEUGE) assert(voll.some((w) => w.name === n), `Werkzeug ${n} gibt es nicht`)
  for (const n of ['kunden_suchen', 'in_oeffentlich_holen', 'objekt_ins_mayer_crm', 'outlook_suche', 'outlook_mail_vorbereiten', 'brief_erstellen', 'todo_anlegen', 'termine_zeigen', 'kunde_loeschen', 'kunden_aus_liste']) {
    assert(namen.includes(n), `${n} fehlt im privaten Assistenten`)
  }
  for (const n of ['gemeinsames_postfach', 'mail_lesen', 'mail_vorbereiten', 'mail_senden', 'kollegen_benachrichtigen', 'firmenueberblick', 'rechnung_erfassen', 'unzugeordnete_dateien', 'kunde_bereich_wechseln', 'kunden_zusammenfuehren', 'gesendete_mails', 'mail_zuordnen']) {
    assert(!namen.includes(n), `${n} darf der private Assistent nicht haben`)
    assert(!imPrivatBotErlaubt(n, istPrivatWerkzeug), `${n} darf im privaten Assistenten nicht ausgeführt werden`)
  }
  // Keine Sammelakten, neue Kontakte nur privat, keine Kollegen im Kalender.
  // deno-lint-ignore no-explicit-any
  const schema = (n: string) => (privat.find((w) => w.name === n) as any).input_schema.properties
  assert(!('ziel' in schema('dateien_ablegen')) && !('ziel' in schema('notiz_speichern')))
  assertEquals(schema('kunde_anlegen').bereich.enum, ['privat'])
  assert(!('teilnehmer' in schema('termin_anlegen')) && !('person' in schema('termine_zeigen')))
  // Die volle Liste bleibt unverändert (Kopie, nicht verändert).
  // deno-lint-ignore no-explicit-any
  assert('ziel' in (voll.find((w) => w.name === 'dateien_ablegen') as any).input_schema.properties)
  assert(voll.some((w) => w.name === 'gemeinsames_postfach'))
  // objekt_ins_mayer_crm im Mayer-Bot nur für Freigeschaltete.
  assert(voll.some((w) => w.name === 'objekt_ins_mayer_crm'))
  assert(!werkzeugListe({ briefe: false, outlook: false }, false).some((w) => w.name === 'objekt_ins_mayer_crm'))
  // Ohne Hotmail-Konto keine Hotmail-Werkzeuge, auch privat nicht.
  assert(!werkzeugListe({ briefe: true, outlook: false }, true).some((w) => w.name === 'outlook_suche'))
})

// ---------------------------------------------------------------------------------------------
// Rechte mit nurPrivat
// ---------------------------------------------------------------------------------------------

Deno.test('darfAkte / darfObjekt mit nurPrivat: nur eigene private Sachen, keine Holding, keine Sammelakten', () => {
  const eigene = { id: 'k_priv_h', bereich: 'privat', verantwortlich_email: 'Hasan@Firma.de' }
  const fremde = { id: 'k_priv_c', bereich: 'privat', verantwortlich_email: 'carl@firma.de' }
  // Ohne nurPrivat sieht die Geschäftsführung die Holding (Gegenprobe).
  assert(darfAkte(HASAN, { id: 'k1', bereich: 'beratung' }))
  assert(darfAkte(HASAN, { id: 'k_eingang_ungeklaert', bereich: 'beratung' }))

  assert(darfAkte(HASAN_PRIVAT, eigene))
  assert(!darfAkte(HASAN_PRIVAT, fremde))
  for (const akte of [{ id: 'k1', bereich: 'beratung' }, { id: 'k2', bereich: 'immobilienkunden' }, { id: 'k_eingang_ungeklaert', bereich: 'beratung' }, { id: 'k_intern_holding', bereich: 'beratung' }]) {
    assert(!darfAkte(HASAN_PRIVAT, akte), `${akte.id} darf es im privaten Assistenten nicht geben`)
    assert(istFremdePrivatakte(HASAN_PRIVAT, akte), `${akte.id} soll „nicht gefunden“ sein, nicht „nicht freigegeben“`)
  }
  assert(!siehtAlleBereiche(HASAN_PRIVAT))
  for (const b of ['beratung', 'immobilien', 'erben', 'privat']) assert(!darfBereich(HASAN_PRIVAT, b))
  assert(darfObjekt(HASAN_PRIVAT, { privat_besitzer: 'hasan@firma.de' }))
  assert(!darfObjekt(HASAN_PRIVAT, { privat_besitzer: null }))
  assert(!darfObjekt(HASAN_PRIVAT, { privat_besitzer: 'carl@firma.de' }))
})

function daten(): Record<string, Zeile[]> {
  const fu = (note: string) => ({ date: '2026-01-05', note, done: false })
  return {
    mitarbeiter: [HASAN, CARL].map((m) => ({ ...m, aktiv: true, telegram_pending: null })),
    kunden: [
      { id: 'k_priv_h', bereich: 'privat', privat_art: 'erben', firma: 'Zebra Privat Hasan', ansprechpartner: 'Zora', email: '', telefon: '', status: 'erstkontakt', prioritaet: 'Mittel', verantwortlich: 'Hasan Haber', verantwortlich_email: 'hasan@firma.de', follow_up: fu('Hasans Rückruf'), activities: [], dokumente: [] },
      { id: 'k_mayer', bereich: 'beratung', privat_art: null, firma: 'Zebra GmbH', ansprechpartner: 'Zacharias', email: '', telefon: '', status: 'lead', prioritaet: 'Mittel', verantwortlich: 'Hasan Haber', verantwortlich_email: null, follow_up: fu('Mayer-Angebot nachfassen'), activities: [], dokumente: [] },
      { id: 'k_eingang_ungeklaert', bereich: 'beratung', privat_art: null, firma: 'Ungeklärte Eingänge', ansprechpartner: '', email: '', telefon: '', status: 'lead', prioritaet: 'Hoch', verantwortlich: '', verantwortlich_email: null, follow_up: null, activities: [], dokumente: [] },
    ],
    objekte: [
      { id: 'o_mayer', bezeichnung: 'Zebrahaus Ulm', adresse: 'Ulm', typ: 'Haus', status: 'akquise', kaufpreis: 0, verantwortlich: 'Hasan Haber', privat_besitzer: null, dokumente: {}, activities: [] },
      { id: 'o_priv_h', bezeichnung: 'Zebrahof Hasan', adresse: 'Blaubeuren', typ: 'Hof', status: 'akquise', kaufpreis: 0, verantwortlich: 'Hasan Haber', privat_besitzer: 'Hasan@firma.de', dokumente: {}, activities: [{ id: 'a0', date: '2026-01-01', text: 'Angelegt', user: 'Hasan Haber' }] },
      { id: 'o_priv_c', bezeichnung: 'Zebravilla Carls', adresse: 'Neu-Ulm', typ: 'Villa', status: 'akquise', kaufpreis: 0, verantwortlich: 'Carl Kollege', privat_besitzer: 'carl@firma.de', dokumente: {}, activities: [] },
    ],
    privat_einstellungen: [],
    ms_konten: [],
  }
}

function client(db: FalscheDatenbank) {
  return {
    from: (t: string) => db.from(t),
    storage: {
      from: (eimer: string) => ({
        ...db.storage.from(eimer),
        list: () => Promise.resolve({ data: [], error: null }),
        getPublicUrl: (pfad: string) => ({ data: { publicUrl: `https://test.local/storage/v1/object/public/${eimer}/${pfad}` } }),
      }),
    },
  }
}

// deno-lint-ignore no-explicit-any
async function rufe(db: FalscheDatenbank, m: Kontext['mitarbeiter'], werkzeug: string, eingabe: any): Promise<string> {
  const alt = console.error
  console.error = () => {}
  try {
    const kontext: Kontext = { supabase: client(db) as unknown as Kontext['supabase'], mitarbeiter: m, state: { v: 3, zuege: [], aktionen: [] }, vorherigeLoeschAnfrage: undefined, vorherigeMailAnfrage: undefined }
    return await fuehreWerkzeugAus(werkzeug, eingabe, kontext)
  } finally {
    console.error = alt
  }
}

const KEIN_KUNDE = 'Es gibt keinen Kunden mit dieser kunde_id'

Deno.test('Werkzeuge mit nurPrivat: Mayer-Akten, Sammelakten und Mayer-Objekte gibt es nicht', async () => {
  const db = falscheDatenbank(daten())
  const suche = await rufe(db, HASAN_PRIVAT, 'kunden_suchen', { suchbegriff: 'Zebra' })
  assertStringIncludes(suche, 'k_priv_h')
  assert(!suche.includes('k_mayer'), 'Mayer-Kunde im privaten Assistenten')
  assertStringIncludes(await rufe(db, HASAN_PRIVAT, 'kunden_suchen', { suchbegriff: 'Zacharias' }), 'Keine Treffer unter seinen privaten Kontakten')
  for (const [werkzeug, eingabe] of [
    ['kundenakte_lesen', { kunde_id: 'k_mayer' }],
    ['notiz_speichern', { kunde_id: 'k_mayer', text: 'x' }],
    ['notiz_speichern', { ziel: 'ungeklaert', text: 'x' }],
    ['dateien_ablegen', { ziel: 'intern', dateien: [{ pfad: 'telegram/x.pdf' }] }],
    ['kunde_aendern', { kunde_id: 'k_mayer', telefon: '1' }],
  ] as const) {
    const text = await rufe(db, HASAN_PRIVAT, werkzeug, eingabe)
    assertStringIncludes(text, KEIN_KUNDE, `${werkzeug} ${JSON.stringify(eingabe)}`)
    assert(!text.includes('Nicht freigegeben'), `${werkzeug}: „nicht freigegeben“ verrät, dass es die Akte gibt`)
  }
  const objekte = await rufe(db, HASAN_PRIVAT, 'objekte_suchen', { suchbegriff: 'Zebra' })
  assertStringIncludes(objekte, 'o_priv_h')
  assert(!objekte.includes('o_mayer') && !objekte.includes('o_priv_c'))
  assertStringIncludes(await rufe(db, HASAN_PRIVAT, 'objektakte_lesen', { objekt_id: 'o_mayer' }), 'Es gibt kein Objekt')
  assertStringIncludes(await rufe(db, HASAN_PRIVAT, 'dokument_inhalt', { objekt_id: 'o_mayer', dokument_id: 'x' }), 'Es gibt kein Objekt')
  // Aufgaben: nur die eigenen privaten, keine der Holding.
  const aufgaben = await rufe(db, HASAN_PRIVAT, 'aufgaben_uebersicht', {})
  assertStringIncludes(aufgaben, 'Hasans Rückruf')
  assert(!aufgaben.includes('Mayer-Angebot'), 'Mayer-Follow-up im privaten Assistenten')
  // Gegenprobe ohne nurPrivat: dieselbe Person sieht im Mayer-Assistenten die Holding.
  assertStringIncludes(await rufe(db, HASAN, 'kunden_suchen', { suchbegriff: 'Zebra' }), 'k_mayer')
  // Nichts wurde geschrieben.
  assertEquals(db.tabelle('kunden').find((k) => k.id === 'k_mayer'), daten().kunden[1])
})

Deno.test('kunde_anlegen mit nurPrivat: immer privater Kontakt; in_oeffentlich_holen mit seinen Bereichsrechten', async () => {
  const db = falscheDatenbank(daten())
  assertStringIncludes(await rufe(db, HASAN_PRIVAT, 'kunde_anlegen', { bereich: 'beratung', name: 'Yak Privat' }), 'Angelegt: Yak Privat')
  const yak = db.tabelle('kunden').find((k) => k.firma === 'Yak Privat')!
  assertEquals([yak.bereich, yak.verantwortlich_email], ['privat', 'hasan@firma.de'])
  // Rüber ins Mayer-CRM: Ziel ist ein Bereich der Holding — dafür zählen seine Rechte als Geschäftsführung.
  assertStringIncludes(await rufe(db, HASAN_PRIVAT, 'in_oeffentlich_holen', { art: 'kontakt', kennung: 'k_priv_h' }), 'Bereich Erben')
  const zeile = db.tabelle('kunden').find((k) => k.id === 'k_priv_h')!
  assertEquals([zeile.bereich, zeile.verantwortlich_email], ['erben', null])
  // Danach gibt es ihn im privaten Assistenten nicht mehr.
  assertStringIncludes(await rufe(db, HASAN_PRIVAT, 'kundenakte_lesen', { kunde_id: 'k_priv_h' }), KEIN_KUNDE)
})

Deno.test('objekt_ins_mayer_crm: nur das eigene private Objekt, Besitzer geleert, Verlauf ergänzt', async () => {
  await mitUmgebung({ MS_ERLAUBT: 'hasan@firma.de' }, async () => {
    const db = falscheDatenbank(daten())
    const protokoll: string[] = []
    const k = { supabase: client(db), email: 'hasan@firma.de', name: 'Hasan Haber', protokolliere: (t: string) => protokoll.push(t) }
    for (const id of ['o_priv_c', 'o_mayer', 'gibtsnicht']) {
      assertStringIncludes(String(await fuehrePrivatWerkzeugAus('objekt_ins_mayer_crm', { objekt_id: id }, k)), 'gibt es bei diesem Mitarbeiter nicht')
    }
    assertEquals(db.tabelle('objekte').find((o) => o.id === 'o_priv_c')!.privat_besitzer, 'carl@firma.de')
    assertStringIncludes(String(await fuehrePrivatWerkzeugAus('objekt_ins_mayer_crm', { objekt_id: 'o_priv_h' }, k)), 'Übernommen')
    const o = db.tabelle('objekte').find((x) => x.id === 'o_priv_h')!
    assertEquals(o.privat_besitzer, null)
    const verlauf = o.activities as { text: string; user: string }[]
    assertEquals(verlauf.length, 2)
    assertStringIncludes(verlauf[0].text, 'ins Mayer-CRM übernommen')
    assertEquals(verlauf[0].user, 'Hasan Haber')
    assertEquals(protokoll.length, 1)
    // Nicht freigeschaltet: gar nicht.
    await mitUmgebung({ MS_ERLAUBT: '' }, async () => {
      assertStringIncludes(String(await fuehrePrivatWerkzeugAus('objekt_ins_mayer_crm', { objekt_id: 'o_priv_h' }, k)), 'nicht freigeschaltet')
    })
  })
})

// ---------------------------------------------------------------------------------------------
// Getrennter Gesprächszustand und Aktiv-Vermerk
// ---------------------------------------------------------------------------------------------

Deno.test('Zustand: im privaten Rahmen in privat_einstellungen.telegram_zustand, sonst mitarbeiter.telegram_pending', async () => {
  const db = falscheDatenbank(daten())
  const supabase = client(db) as unknown as Kontext['supabase']
  const zustand = (text: string) => ({ v: 3 as const, zuege: [{ z: new Date().toISOString(), msgs: [{ role: 'user' as const, content: text }] }], aktionen: [] })

  await mitBot(true, () => speichereZustand(supabase, 'm_h', zustand('privat')))
  const zeile = db.tabelle('privat_einstellungen').find((z) => z.login_email === 'hasan@firma.de')
  assert(zeile, 'Zeile in privat_einstellungen angelegt')
  assertStringIncludes(JSON.stringify(zeile!.telegram_zustand), 'privat')
  assertEquals(db.tabelle('mitarbeiter').find((m) => m.id === 'm_h')!.telegram_pending, null, 'Mayer-Zustand unberührt')

  await mitBot(false, () => speichereZustand(supabase, 'm_h', zustand('mayer')))
  assertStringIncludes(JSON.stringify(db.tabelle('mitarbeiter').find((m) => m.id === 'm_h')!.telegram_pending), 'mayer')
  assert(!JSON.stringify(db.tabelle('privat_einstellungen')[0].telegram_zustand).includes('mayer'), 'privater Zustand unberührt')

  // Lesen folgt demselben Rahmen.
  assertStringIncludes(JSON.stringify(await mitBot(true, () => ladeZustandRoh(supabase, 'm_h'))), 'privat')
  assertStringIncludes(JSON.stringify(await ladeZustandRoh(supabase, 'm_h')), 'mayer')
})

Deno.test('privatBotAktiv: nur mit Schlüssel, Freischaltung und Vermerk; Vermerk behält übrige Einstellungen', async () => {
  const db = falscheDatenbank({ privat_einstellungen: [{ login_email: 'hasan@firma.de', briefing: { andere: 1 }, mayer_adressen: ['x@y.de'] }] })
  await mitUmgebung({ PRIVAT_TELEGRAM_BOT_TOKEN: undefined, MS_ERLAUBT: 'hasan@firma.de' }, async () => {
    await merkePrivatBotAktiv(db, 'Hasan@Firma.de')
    assert(!(await privatBotAktiv(db, 'hasan@firma.de')), 'ohne Schlüssel nie')
  })
  await mitUmgebung({ PRIVAT_TELEGRAM_BOT_TOKEN: '123:privat', MS_ERLAUBT: 'hasan@firma.de' }, async () => {
    assert(await privatBotAktiv(db, 'HASAN@firma.de'))
    assert(!(await privatBotAktiv(db, 'carl@firma.de')))
    const zeile = db.tabelle('privat_einstellungen')[0]
    assertEquals(zeile.briefing, { andere: 1, privatBot: true })
    assertEquals(zeile.mayer_adressen, ['x@y.de'])
  })
  await mitUmgebung({ PRIVAT_TELEGRAM_BOT_TOKEN: '123:privat', MS_ERLAUBT: 'carl@firma.de' }, async () => {
    assert(!(await privatBotAktiv(db, 'hasan@firma.de')), 'ohne Freischaltung nie')
  })
})
