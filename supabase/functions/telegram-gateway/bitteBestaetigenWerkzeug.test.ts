// Prüft „Bitte bestätigen“ (bitteBestaetigenWerkzeug.ts) ohne Netz: Knöpfe nur im Chat des Empfängers und mit dem
// richtigen Code, Ja/Ignorieren/Andere Akte je Art mit denselben Funktionen wie im Browser (Termin über ordneVonHandZu,
// Mails und Dateien über die Mail-Funktion im Auftrag des Mitarbeiters, private Post über meine_post_vorschlaege),
// Statuswechsel nur vorwärts aus dem Stand des Vorschlags und mit Recht, Doppelklick, Werkzeug vorschlaege_bestaetigen.
//
//   npx -y deno test --allow-all --no-check telegram-gateway/bitteBestaetigenWerkzeug.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { knopfDaten } from '../_shared/bestaetigenKern.ts'
import { entscheideVorschlag, fuehreBestaetigenWerkzeugAus, type Mitarbeiter, verarbeiteBestaetigenKnopf } from './bitteBestaetigenWerkzeug.ts'

const HASAN: Mitarbeiter & { telegram_chat_id: number; aktiv: boolean; id: string } = { id: 'm_hasan', name: 'Hasan Süslü', email: 'sueslue@hotmail.com', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], telegram_chat_id: 111, aktiv: true }
const QUIRIN: Mitarbeiter & { telegram_chat_id: number; aktiv: boolean; id: string } = { id: 'm_quirin', name: 'Quirin Lutzenberger', email: 'immo@amayer-holding.com', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'], telegram_chat_id: 222, aktiv: true }
const JETZT = new Date('2026-11-24T08:00:00Z')

function zeile(z: Partial<Zeile> & { id: string; art: string }): Zeile {
  return { empfaenger_email: HASAN.email, bezug_id: 'x', kunde_id: null, daten: {}, code: 'CODE12345', status: 'offen', telegram_nachricht: { chat: 111, id: 900 }, erstellt_am: '2026-11-24T07:20:00Z', ...z }
}

function aufbau(extra: Record<string, Zeile[]> = {}) {
  const db = new FalscheDatenbank({
    mitarbeiter: [HASAN, QUIRIN].map((m) => ({ ...m, telegram_pending: null })),
    kunden: [
      { id: 'k_caras', bereich: 'beratung', firma: 'Caras', ansprechpartner: 'Herr Caras', status: 'lead', verantwortlich_email: HASAN.email, activities: [{ id: 'alt', text: 'alt' }] },
      { id: 'k_mueller', bereich: 'beratung', firma: 'Müller GmbH', ansprechpartner: 'Frau Müller', status: 'lead', verantwortlich_email: HASAN.email, activities: [] },
      { id: 'k_immo', bereich: 'immobilienkunden', firma: 'HD-IMMO', ansprechpartner: 'Helmut Dick', status: 'interessent', verantwortlich_email: QUIRIN.email, activities: [] },
      { id: 'k_erben', bereich: 'erben', firma: 'Erbe Fritz', ansprechpartner: '', status: 'erstkontakt', verantwortlich_email: HASAN.email, activities: [] },
    ],
    termine: [
      { id: 't1', titel: 'Caras', beginn: '2026-11-27T09:00:00Z', besitzer_email: HASAN.email, teilnehmer: [], kunde_id: null, kunde_bereich: null, kunde_name: null, zuordnung_vorschlag: { stand: 'vorschlag', kunde_id: 'k_caras', bereich: 'beratung', name: 'Caras', wie: 'titel' } },
    ],
    eingegangene_emails: [
      { id: '00000000-0000-4000-8000-000000000001', message_id: '<m1@x>', betreff: 'Unterlagen', besitzer_email: null, zugewiesener_kunde_id: null, zuordnung_vorschlag: { status: 'offen', kandidaten: [{ kundeId: 'k_mueller', bereich: 'beratung', name: 'Müller GmbH', grund: 'Name in der Mail' }] } },
      { id: '00000000-0000-4000-8000-000000000002', message_id: 'pf_q:<p1@x>', von: 'info@hdimmo.de', von_name: 'HD', betreff: 'Exposé', mail_datum: '2026-11-23T10:00:00Z', ignoriert: false, besitzer_email: QUIRIN.email, zugewiesener_kunde_id: null, zuordnung_vorschlag: { art: 'privat', status: 'privat_offen', kandidaten: [{ kundeId: 'k_immo', bereich: 'immobilienkunden', name: 'HD-IMMO', grund: 'Absender', privat: false }] } },
    ],
    telegram_vorschlaege: [
      zeile({ id: 'tv_termin0001', art: 'termin', bezug_id: 't1', kunde_id: 'k_caras', daten: { titel: 'Caras', wann: '2026-11-27T09:00:00Z', ziel: { art: 'kunde', id: 'k_caras', name: 'Caras', bereich: 'beratung' } } }),
      zeile({ id: 'tv_mail000001', art: 'mail', bezug_id: '00000000-0000-4000-8000-000000000001', kunde_id: 'k_mueller', daten: { titel: 'Unterlagen', ziel: { art: 'kunde', id: 'k_mueller', name: 'Müller GmbH', bereich: 'beratung' } } }),
      zeile({ id: 'tv_privat0001', art: 'mail_privat', empfaenger_email: QUIRIN.email, telegram_nachricht: { chat: 222, id: 901 }, bezug_id: '00000000-0000-4000-8000-000000000002', kunde_id: 'k_immo', daten: { titel: 'Exposé', ziel: { art: 'kunde', id: 'k_immo', name: 'HD-IMMO', bereich: 'immobilienkunden' }, uebergabe: true } }),
      zeile({ id: 'tv_eingang001', art: 'eingang', bezug_id: 'dok1', kunde_id: 'obj1', daten: { titel: 'Grundbuch_Hauptstr.pdf', ziel: { art: 'objekt', id: 'obj1', name: 'Hauptstr. 5', ordner: 'Grundbuch' } } }),
      zeile({ id: 'tv_status0001', art: 'status', bezug_id: 'k_mueller', kunde_id: 'k_mueller', daten: { name: 'Müller GmbH', bereich: 'beratung', netz: 'beratung', von: 'lead', nach: 'termin', vonName: 'Lead / Neuanfrage', nachName: 'Erstgespräch terminiert', ereignis: 'termin', anlass: 'Termin.' } }),
    ],
    ...extra,
  })
  const aufrufe: { action: string; body: Record<string, unknown> }[] = []
  const telegramAufrufe: { methode: string; daten: Record<string, unknown> }[] = []
  const mailFunktion = (action: string, body: Record<string, unknown>) => {
    aufrufe.push({ action, body })
    if (action === 'mail_zuordnen') return Promise.resolve({ ok: true, betreff: 'Unterlagen', kundeName: 'Müller GmbH', abgelegt: 1 })
    if (action === 'eingang_ablegen') return Promise.resolve({ abgelegt: ['Grundbuch_Hauptstr.pdf'], uebersprungen: [], nichtAbgelegt: [], ziel: { name: 'Hauptstr. 5' } })
    return Promise.resolve({ ok: true })
  }
  const telegram = (methode: string, daten: Record<string, unknown>) => {
    telegramAufrufe.push({ methode, daten })
    return Promise.resolve({ message_id: 1 })
  }
  return { db, aufrufe, telegramAufrufe, mailFunktion, telegram }
}

function kontext(t: ReturnType<typeof aufbau>, m: Mitarbeiter = HASAN) {
  return { supabase: t.db, mitarbeiter: m, heute: '2026-11-24', mailFunktion: t.mailFunktion, telegram: t.telegram, jetzt: JETZT }
}

function vorschlag(t: ReturnType<typeof aufbau>, id: string): Zeile {
  return t.db.tabelle('telegram_vorschlaege').find((z) => z.id === id)!
}

async function druecke(t: ReturnType<typeof aufbau>, chat: number, daten: string, wege = { ladeState: () => ({ zuege: [] as unknown[] }), speichereZustand: () => Promise.resolve() }) {
  const antworten: string[] = []
  await verarbeiteBestaetigenKnopf({ supabase: t.db, knopf: { id: 'cb', data: daten, message: { chat: { id: chat } } }, antworte: (x) => Promise.resolve(antworten.push(x)), telegram: t.telegram, mailFunktion: t.mailFunktion, wege, heute: '2026-11-24', jetzt: JETZT })
  return antworten
}

Deno.test('Knopf Ja (Termin): ordnet zu wie der Kalender, Vorschlag erledigt, Nachricht ohne Knöpfe', async () => {
  const t = aufbau()
  const antworten = await druecke(t, 111, knopfDaten('tv_termin0001', 'ja', 'CODE12345'))
  const termin = t.db.tabelle('termine')[0]
  assertEquals(termin.kunde_id, 'k_caras')
  assertEquals((termin.zuordnung_vorschlag as { stand: string }).stand, 'hand')
  assertEquals(vorschlag(t, 'tv_termin0001').status, 'erledigt')
  assertStringIncludes(antworten[0], 'Caras')
  const edit = t.telegramAufrufe.find((a) => a.methode === 'editMessageText')!
  assertEquals(edit.daten.message_id, 900)
  assert(!('reply_markup' in edit.daten))
  assertStringIncludes(String(edit.daten.text), '✅')
})

Deno.test('Knopf: fremder Chat oder falscher Code tut nichts', async () => {
  const t = aufbau()
  const a1 = await druecke(t, 222, knopfDaten('tv_termin0001', 'ja', 'CODE12345'))
  const a2 = await druecke(t, 111, knopfDaten('tv_termin0001', 'ja', 'FALSCH999'))
  const a3 = await druecke(t, 999, knopfDaten('tv_termin0001', 'ja', 'CODE12345'))
  assertStringIncludes(a1[0], 'gibt es nicht')
  assertStringIncludes(a2[0], 'gibt es nicht')
  assertStringIncludes(a3[0], 'keinem CRM-Zugang')
  assertEquals(t.db.tabelle('termine')[0].kunde_id, null)
  assertEquals(vorschlag(t, 'tv_termin0001').status, 'offen')
})

Deno.test('Doppelklick: der zweite Klick führt nichts mehr aus', async () => {
  const t = aufbau()
  await druecke(t, 111, knopfDaten('tv_mail000001', 'ja', 'CODE12345'))
  const zweiter = await druecke(t, 111, knopfDaten('tv_mail000001', 'ja', 'CODE12345'))
  assertEquals(t.aufrufe.filter((a) => a.action === 'mail_zuordnen').length, 1)
  assertStringIncludes(zweiter[0], 'schon erledigt')
})

Deno.test('Knopf Ignorieren (Termin): Vorschlag wird abgelehnt wie im Kalender', async () => {
  const t = aufbau()
  await druecke(t, 111, knopfDaten('tv_termin0001', 'ignorieren', 'CODE12345'))
  const termin = t.db.tabelle('termine')[0]
  assertEquals(termin.kunde_id, null)
  assertEquals((termin.zuordnung_vorschlag as { abgelehnt: string[] }).abgelehnt, ['k_caras'])
  assertEquals(vorschlag(t, 'tv_termin0001').status, 'ignoriert')
})

Deno.test('Termin schon von Hand zugeordnet: Ja ändert nichts (veraltet)', async () => {
  const t = aufbau()
  t.db.tabelle('termine')[0].kunde_id = 'k_erben'
  t.db.tabelle('termine')[0].kunde_name = 'Erbe Fritz'
  const a = await druecke(t, 111, knopfDaten('tv_termin0001', 'ja', 'CODE12345'))
  assertEquals(t.db.tabelle('termine')[0].kunde_id, 'k_erben')
  assertEquals(vorschlag(t, 'tv_termin0001').status, 'veraltet')
  assertStringIncludes(a[0], 'Erbe Fritz')
})

Deno.test('Knopf Ja (gemeinsames Postfach): mail_zuordnen im Auftrag, Vorschlag „uebernommen“', async () => {
  const t = aufbau()
  await druecke(t, 111, knopfDaten('tv_mail000001', 'ja', 'CODE12345'))
  assertEquals(t.aufrufe[0], { action: 'mail_zuordnen', body: { mailId: '00000000-0000-4000-8000-000000000001', kundeId: 'k_mueller', imAuftragVon: HASAN.email } })
  const mail = t.db.tabelle('eingegangene_emails')[0]
  assertEquals((mail.zuordnung_vorschlag as { status: string; erledigt_von: string }).status, 'uebernommen')
  assertEquals(vorschlag(t, 'tv_mail000001').status, 'erledigt')
})

Deno.test('Knopf Ignorieren (gemeinsames Postfach): Vorschlag „verworfen“, keine Zuordnung', async () => {
  const t = aufbau()
  await druecke(t, 111, knopfDaten('tv_mail000001', 'ignorieren', 'CODE12345'))
  assertEquals(t.aufrufe.length, 0)
  assertEquals((t.db.tabelle('eingegangene_emails')[0].zuordnung_vorschlag as { status: string }).status, 'verworfen')
})

Deno.test('Knopf Ja (persönliches Postfach, Holding-Akte): übergeben und zuordnen wie meine_post_vorschlaege', async () => {
  const t = aufbau()
  const a = await druecke(t, 222, knopfDaten('tv_privat0001', 'ja', 'CODE12345'))
  assertEquals(t.aufrufe.map((x) => x.action), ['mail_freigeben', 'mail_zuordnen'])
  assertEquals(t.aufrufe[0].body.imAuftragVon, QUIRIN.email)
  assertEquals(vorschlag(t, 'tv_privat0001').status, 'erledigt')
  assertStringIncludes(a[0], 'HD-IMMO')
})

Deno.test('Knopf Ja (Ungeklärte Eingänge): eingang_ablegen mit Objekt und Ordner', async () => {
  const t = aufbau()
  await druecke(t, 111, knopfDaten('tv_eingang001', 'ja', 'CODE12345'))
  assertEquals(t.aufrufe[0], { action: 'eingang_ablegen', body: { dokumentIds: ['dok1'], ziel: { art: 'objekt', id: 'obj1', ordner: 'Grundbuch' }, imAuftragVon: HASAN.email } })
  assertEquals(vorschlag(t, 'tv_eingang001').status, 'erledigt')
})

Deno.test('Statuswechsel Ja: Status vorwärts, Verlaufseintrag wie im CRM', async () => {
  const t = aufbau()
  const a = await druecke(t, 111, knopfDaten('tv_status0001', 'ja', 'CODE12345'))
  const k = t.db.tabelle('kunden').find((x) => x.id === 'k_mueller')!
  assertEquals(k.status, 'termin')
  assertEquals(k.letzte_aktivitaet, '2026-11-24')
  assertStringIncludes(String((k.activities as { text: string }[])[0].text), 'Status: Lead / Neuanfrage → Erstgespräch terminiert am 2026-11-24 durch Hasan Süslü')
  assertStringIncludes(a[0], 'Erstgespräch terminiert')
})

Deno.test('Statuswechsel: inzwischen geändert → nichts gemacht; Nein → abgelehnt', async () => {
  const t = aufbau()
  t.db.tabelle('kunden').find((x) => x.id === 'k_mueller')!.status = 'erstkontakt'
  await druecke(t, 111, knopfDaten('tv_status0001', 'ja', 'CODE12345'))
  assertEquals(t.db.tabelle('kunden').find((x) => x.id === 'k_mueller')!.status, 'erstkontakt')
  assertEquals(vorschlag(t, 'tv_status0001').status, 'veraltet')

  const t2 = aufbau()
  await druecke(t2, 111, knopfDaten('tv_status0001', 'nein', 'CODE12345'))
  assertEquals(vorschlag(t2, 'tv_status0001').status, 'nein')
  assertEquals(t2.db.tabelle('kunden').find((x) => x.id === 'k_mueller')!.status, 'lead')
})

Deno.test('Statuswechsel ohne Recht auf die Akte: nichts gemacht', async () => {
  const t = aufbau({
    telegram_vorschlaege: [
      zeile({ id: 'tv_status0002', art: 'status', empfaenger_email: QUIRIN.email, bezug_id: 'k_mueller', kunde_id: 'k_mueller', daten: { name: 'Müller GmbH', von: 'lead', nach: 'termin', vonName: 'Lead', nachName: 'Erstgespräch terminiert' } }),
    ],
  })
  const r = await entscheideVorschlag(kontext(t, QUIRIN), 'tv_status0002', 'ja')
  assert(!r.ok)
  assertEquals(t.db.tabelle('kunden').find((x) => x.id === 'k_mueller')!.status, 'lead')
})

Deno.test('Andere Akte: Frage in den Chat und Hinweis in den Verlauf, danach Werkzeug mit kunde_id', async () => {
  const t = aufbau()
  const state = { zuege: [] as { msgs: { role: string; content: string }[] }[] }
  let gespeichert = ''
  const a = await druecke(t, 111, knopfDaten('tv_termin0001', 'andere', 'CODE12345'), { ladeState: () => state, speichereZustand: (_s: unknown, id: string) => Promise.resolve(void (gespeichert = id)) })
  assertStringIncludes(a[0], 'Namen')
  assertEquals(gespeichert, 'm_hasan')
  assertStringIncludes(state.zuege[0].msgs[0].content, 'vorschlaege_bestaetigen')
  assertStringIncludes(state.zuege[0].msgs[0].content, 'tv_termin0001')
  assertStringIncludes(state.zuege[0].msgs[1].content, 'Zu welcher Akte gehört der Termin „Caras“')
  assertEquals(vorschlag(t, 'tv_termin0001').status, 'offen')
  assertStringIncludes(String(t.telegramAufrufe.find((x) => x.methode === 'sendMessage')!.daten.text), 'Schreib mir einfach den Namen')

  const antwort = await fuehreBestaetigenWerkzeugAus('vorschlaege_bestaetigen', { aktion: 'andere_akte', vorschlag_id: 'tv_termin0001', kunde_id: 'k_erben' }, kontext(t))
  assertStringIncludes(antwort, 'Erledigt')
  assertEquals(t.db.tabelle('termine')[0].kunde_id, 'k_erben')
})

Deno.test('Werkzeug: Liste nur eigene offene Vorschläge, Fehlerfälle', async () => {
  const t = aufbau()
  const liste = JSON.parse(await fuehreBestaetigenWerkzeugAus('vorschlaege_bestaetigen', { aktion: 'liste' }, kontext(t)))
  assertEquals(liste.offen, 4)
  assert(!liste.vorschlaege.some((v: { vorschlag_id: string }) => v.vorschlag_id === 'tv_privat0001'))
  const status = liste.vorschlaege.find((v: { vorschlag_id: string }) => v.vorschlag_id === 'tv_status0001')
  assertEquals(status.vorschlag, 'Erstgespräch terminiert')
  assertStringIncludes(await fuehreBestaetigenWerkzeugAus('vorschlaege_bestaetigen', { aktion: 'andere_akte', vorschlag_id: 'tv_termin0001' }, kontext(t)), 'kunde_id')
  assertStringIncludes(await fuehreBestaetigenWerkzeugAus('vorschlaege_bestaetigen', { aktion: 'ja', vorschlag_id: 'tv_privat0001' }, kontext(t)), 'gibt es nicht')
  assertStringIncludes(await fuehreBestaetigenWerkzeugAus('vorschlaege_bestaetigen', { aktion: 'ignorieren', vorschlag_id: 'tv_status0001' }, kontext(t)), 'Ja oder Nein')
  assertStringIncludes(await fuehreBestaetigenWerkzeugAus('vorschlaege_bestaetigen', { aktion: 'liste' }, kontext(t, { ...HASAN, nurPrivat: true })), 'nur im Mayer-Assistenten')
})
