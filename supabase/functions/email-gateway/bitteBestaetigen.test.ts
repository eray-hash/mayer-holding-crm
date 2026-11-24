// Prüft den täglichen Versand „Bitte bestätigen“ (bitteBestaetigen.ts) ohne Netz: Schalter (Standard AUS) und
// Empfängerliste, Zeitfenster, höchstens 5 je Person reihum aus den Quellen, einmal am Tag, nichts doppelt gefragt,
// Bereichsrechte, Trockenlauf ohne Schreiben, und die Übertragung der Vorschläge für „Ungeklärte Eingänge“.
//
//   npx -y deno test --allow-all --no-check email-gateway/bitteBestaetigen.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { leseKnopf } from '../_shared/bestaetigenKern.ts'
import { haeufigkeitAus, merkmaleAus, ordnerFuer, vorschlaegeFuer } from '../_shared/eingangVorschlagKern.ts'
import { imFenster, reihum, sendeBitteBestaetigen } from './bitteBestaetigen.ts'

const ERAY = { name: 'Eray Yesil', email: 'eray.yesil@fundament-it.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], aktiv: true, telegram_chat_id: 333, ist_superuser: true }
const HASAN = { name: 'Hasan Süslü', email: 'privat.gf@beispiel.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], aktiv: true, telegram_chat_id: 111, ist_superuser: false }
const QUIRIN = { name: 'Quirin Lutzenberger', email: 'immo@amayer-holding.com', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'], aktiv: true, telegram_chat_id: 222, ist_superuser: false }

// Dienstag, 24.11.2026, 8:30 Uhr in Berlin.
const DIENSTAG = new Date('2026-11-24T07:30:00Z')

function einstellung(daten: Record<string, unknown>): Zeile {
  return { id: 'einstellung', empfaenger_email: '-', art: 'lauf', bezug_id: '-', code: '-', status: 'erledigt', daten }
}

function vorschlagTermin(kundeId: string, name: string, bereich = 'beratung') {
  return { stand: 'vorschlag', kunde_id: kundeId, bereich, name, wie: 'titel' }
}

function aufbau(tabellen: Record<string, Zeile[]> = {}) {
  const db = new FalscheDatenbank({
    mitarbeiter: [ERAY, HASAN, QUIRIN],
    kunden: [
      { id: 'k_caras', bereich: 'beratung', firma: 'Caras', ansprechpartner: 'Herr Caras', verantwortlich: 'Eray Yesil', verantwortlich_email: ERAY.email },
      { id: 'k_mueller', bereich: 'beratung', firma: 'Müller GmbH', ansprechpartner: 'Frau Müller', verantwortlich: null, verantwortlich_email: HASAN.email },
      { id: 'k_immo', bereich: 'immobilienkunden', firma: 'HD-IMMO', ansprechpartner: 'Helmut Dick', verantwortlich: null, verantwortlich_email: QUIRIN.email },
      { id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: 'Ungeklärte Eingänge', ansprechpartner: '', verantwortlich: null, verantwortlich_email: null,
        dokumente: [{ id: 'dok1', name: 'Grundbuch_Wolkenstein.pdf', typ: 'application/pdf', datum: '2026-11-23', url: 'telegram/dok1.pdf' }, { id: 'dok2', name: 'Scan_0001.pdf', typ: 'application/pdf', datum: '2026-11-23' }],
        activities: [{ id: 'a1', date: '2026-11-23', user: 'Eray Yesil', text: 'Per Telegram von Eray Yesil abgelegt: „Grundbuch_Wolkenstein.pdf — Grundbuch"' }] },
      { id: 'k_intern_holding', bereich: 'beratung', firma: 'Mayer Holding', ansprechpartner: 'intern', verantwortlich: null, verantwortlich_email: null },
    ],
    objekte: [{ id: 'obj1', bezeichnung: 'MFH Wolkenstein', adresse: 'Am Ring 5, Ulm', verantwortlich: 'Quirin Lutzenberger', privat_besitzer: null }],
    termine: [
      { id: 't_bald', titel: 'Caras', beginn: '2026-11-26T09:00:00Z', ganztags: false, besitzer_email: ERAY.email, kunde_id: null, zuordnung_vorschlag: vorschlagTermin('k_caras', 'Caras') },
      { id: 't_vorbei', titel: 'Müller', beginn: '2026-11-20T09:00:00Z', ganztags: false, besitzer_email: ERAY.email, kunde_id: null, zuordnung_vorschlag: vorschlagTermin('k_mueller', 'Müller GmbH') },
      { id: 't_hasan', titel: 'Caras Folge', beginn: '2026-11-27T09:00:00Z', ganztags: false, besitzer_email: HASAN.email, kunde_id: null, zuordnung_vorschlag: vorschlagTermin('k_caras', 'Caras') },
      { id: 't_quirin', titel: 'Caras bei Quirin', beginn: '2026-11-27T09:00:00Z', ganztags: false, besitzer_email: QUIRIN.email, kunde_id: null, zuordnung_vorschlag: vorschlagTermin('k_caras', 'Caras') },
      { id: 't_zu', titel: 'Erledigt', beginn: '2026-11-27T09:00:00Z', ganztags: false, besitzer_email: ERAY.email, kunde_id: 'k_caras', zuordnung_vorschlag: { stand: 'hand' } },
    ],
    eingegangene_emails: [
      { id: 'm_privat', message_id: 'pf:<1>', von: 'info@hdimmo.de', von_name: 'HD', betreff: 'Exposé Hirsch', mail_datum: '2026-11-23T10:00:00Z', erstellt_am: '2026-11-23T10:00:00Z', ignoriert: false, besitzer_email: ERAY.email, zugewiesener_kunde_id: null, zuordnung_vorschlag: { art: 'privat', status: 'privat_offen', kandidaten: [{ kundeId: 'k_immo', bereich: 'immobilienkunden', name: 'HD-IMMO', grund: 'Absenderadresse ist in der Akte hinterlegt', sicher: true }] } },
      { id: 'm_rund', message_id: 'pf:<2>', von: 'news@shop.de', betreff: 'Angebot', mail_datum: '2026-11-23T09:00:00Z', erstellt_am: '2026-11-23T09:00:00Z', ignoriert: false, besitzer_email: ERAY.email, zugewiesener_kunde_id: null, zuordnung_vorschlag: { art: 'privat', status: 'privat_rundschreiben' } },
      { id: 'm_gemeinsam', message_id: '<3>', von: 'caras@firma.de', von_name: 'Herr Caras', betreff: 'Rückfrage', mail_datum: '2026-11-23T08:00:00Z', erstellt_am: '2026-11-23T08:00:00Z', ignoriert: false, besitzer_email: null, zugewiesener_kunde_id: null, zuordnung_vorschlag: { status: 'offen', kandidaten: [{ kundeId: 'k_caras', bereich: 'beratung', name: 'Caras', grund: 'Name steht im Betreff' }] } },
    ],
    dokument_inhalte: [],
    ...tabellen,
  })
  const gesendet: Record<string, unknown>[] = []
  const telegram = (methode: string, daten: Record<string, unknown>) => {
    if (methode === 'sendMessage') gesendet.push(daten)
    return Promise.resolve({ message_id: 500 + gesendet.length })
  }
  return { db, gesendet, telegram }
}

const vorschlaege = (db: FalscheDatenbank) => db.tabelle('telegram_vorschlaege').filter((z) => z.art !== 'lauf')

Deno.test('Schalter fehlt oder AUS: nichts gesendet, nichts geschrieben', async () => {
  const t = aufbau()
  const r = await sendeBitteBestaetigen(t.db, { telegram: t.telegram, jetzt: DIENSTAG })
  assertEquals(r.gesendet, 0)
  assertEquals(t.gesendet.length, 0)
  assertEquals(t.db.tabelle('telegram_vorschlaege').length, 0)

  const t2 = aufbau({ telegram_vorschlaege: [einstellung({ zuordnung_an: false, empfaenger: ['*'] })] })
  await sendeBitteBestaetigen(t2.db, { telegram: t2.telegram, jetzt: DIENSTAG })
  assertEquals(t2.gesendet.length, 0)
})

Deno.test('Schalter AN, nur Eray: höchstens 5, reihum aus den Quellen, mit Knöpfen; Hasan bekommt nichts', async () => {
  const t = aufbau({ telegram_vorschlaege: [einstellung({ zuordnung_an: true, empfaenger: ['eray.yesil@fundament-it.de'] })] })
  const r = await sendeBitteBestaetigen(t.db, { telegram: t.telegram, jetzt: DIENSTAG })
  assertEquals(r.fehler, [])
  assertEquals(r.gesendet, 5)
  assert(t.gesendet.every((n) => n.chat_id === 333))
  const zeilen = vorschlaege(t.db)
  assertEquals(zeilen.map((z) => `${z.art}:${z.bezug_id}`), ['termin:t_bald', 'mail_privat:m_privat', 'mail:m_gemeinsam', 'eingang:dok1', 'termin:t_vorbei'])
  // Erste Nachricht: Text und Knöpfe passen zur Zeile.
  const erste = t.gesendet[0]
  assertStringIncludes(String(erste.text), 'Bitte bestätigen (1 von 5): Termin → Akte')
  assertStringIncludes(String(erste.text), 'Termin: „Caras“ am Do 26.11. um 10:00')
  assertStringIncludes(String(erste.text), 'Vorschlag: Akte „Caras“ (Unternehmensberatung)')
  const knoepfe = (erste.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.flat()
  assertEquals(knoepfe.map((k) => k.text), ['✅ Ja, zu Caras', 'Andere Akte', 'Ignorieren'])
  const k = leseKnopf(knoepfe[0].callback_data)!
  assertEquals(k.id, zeilen[0].id)
  assertEquals(k.code, zeilen[0].code)
  assertEquals((zeilen[0].telegram_nachricht as { id: number }).id, 501)
  // Private Mail an eine Holding-Akte: Hinweis auf die Übergabe.
  assertStringIncludes(String(t.gesendet[1].text), 'Mit „Ja“ wird die Mail ins CRM übernommen')
  assertStringIncludes(String(t.gesendet[1].text), 'Sehr wahrscheinlich.')
  // Datei: Objekt mit Ordner.
  assertStringIncludes(String(t.gesendet[3].text), 'Objekt „MFH Wolkenstein“, Ordner Grundbuch')
  assert(!zeilen.some((z) => z.bezug_id === 't_hasan' || z.bezug_id === 'm_rund' || z.bezug_id === 't_zu'))
})

Deno.test('Einmal am Tag und nichts doppelt: zweiter Takt nichts, nächster Tag nur Neues', async () => {
  const t = aufbau({ telegram_vorschlaege: [einstellung({ zuordnung_an: true, empfaenger: ['eray.yesil@fundament-it.de'] })] })
  await sendeBitteBestaetigen(t.db, { telegram: t.telegram, jetzt: DIENSTAG })
  await sendeBitteBestaetigen(t.db, { telegram: t.telegram, jetzt: new Date(DIENSTAG.getTime() + 60_000) })
  assertEquals(t.gesendet.length, 5)
  // Mittwoch: alles schon gefragt — bis auf einen neuen Terminvorschlag.
  t.db.tabelle('termine').push({ id: 't_neu', titel: 'Müller GmbH Folgetermin', beginn: '2026-11-30T09:00:00Z', ganztags: false, besitzer_email: ERAY.email, kunde_id: null, zuordnung_vorschlag: vorschlagTermin('k_mueller', 'Müller GmbH') })
  const r = await sendeBitteBestaetigen(t.db, { telegram: t.telegram, jetzt: new Date('2026-11-25T07:30:00Z') })
  assertEquals(r.gesendet, 1)
  assertEquals(vorschlaege(t.db).at(-1)!.bezug_id, 't_neu')
  assertStringIncludes(String(t.gesendet.at(-1)!.text), 'Bitte bestätigen: Termin → Akte')
})

Deno.test('Zeitfenster: werktags 8:20 bis 11 Uhr', () => {
  assert(imFenster(DIENSTAG))
  assert(!imFenster(new Date('2026-11-24T07:10:00Z'))) // 8:10
  assert(!imFenster(new Date('2026-11-24T10:00:00Z'))) // 11:00
  assert(!imFenster(new Date('2026-11-28T08:00:00Z'))) // Samstag
})

Deno.test('Alle Empfänger: Bereichsrechte — Quirin bekommt keinen Vorschlag zu einer Beratungsakte', async () => {
  const t = aufbau({ telegram_vorschlaege: [einstellung({ zuordnung_an: true, empfaenger: ['*'] })] })
  await sendeBitteBestaetigen(t.db, { telegram: t.telegram, jetzt: DIENSTAG })
  const anQuirin = vorschlaege(t.db).filter((z) => z.empfaenger_email === QUIRIN.email)
  assertEquals(anQuirin.length, 0)
  const anHasan = vorschlaege(t.db).filter((z) => z.empfaenger_email === HASAN.email)
  assertEquals(anHasan.map((z) => z.bezug_id), ['t_hasan'])
})

Deno.test('Datei ohne Schicker mit Recht: an den Verantwortlichen des Objekts', async () => {
  const t = aufbau({ telegram_vorschlaege: [einstellung({ zuordnung_an: true, empfaenger: ['*'] })] })
  const sammel = t.db.tabelle('kunden').find((k) => k.id === 'k_eingang_ungeklaert')!
  sammel.activities = []
  await sendeBitteBestaetigen(t.db, { telegram: t.telegram, jetzt: DIENSTAG })
  const datei = vorschlaege(t.db).find((z) => z.art === 'eingang')!
  assertEquals(datei.empfaenger_email, QUIRIN.email)
})

Deno.test('Trockenlauf: Texte für eine Person, ohne Schalter, ohne Schreiben, ohne Senden', async () => {
  const t = aufbau()
  const r = await sendeBitteBestaetigen(t.db, { telegram: t.telegram, jetzt: new Date('2026-11-28T15:00:00Z'), trockenFuer: 'PRIVAT.GF@beispiel.de' })
  assertEquals(t.gesendet.length, 0)
  assertEquals(t.db.tabelle('telegram_vorschlaege').length, 0)
  assertEquals(r.vorschau?.length, 1)
  assertStringIncludes(r.vorschau![0].text, 'Caras Folge')
  assertEquals(r.vorschau![0].knoepfe, ['✅ Ja, zu Caras', 'Andere Akte', 'Ignorieren'])
})

Deno.test('reihum: je Quelle einer, ohne schon Gefragtes', () => {
  const k = (art: 'termin' | 'mail', id: string) => ({ art, bezugId: id, kundeId: 'k', daten: { titel: id, ziel: { art: 'kunde' as const, id: 'k', name: 'K' } } })
  const aus = reihum([[k('termin', 'a'), k('termin', 'b'), k('termin', 'c')], [k('mail', 'x')]], new Set(['termin|a']), 3)
  assertEquals(aus.map((x) => x.bezugId), ['b', 'x', 'c'])
})

Deno.test('Ungeklärte Eingänge: wie die Seite — Allerweltswörter zählen nicht, mehrdeutig = kein Vorschlag', () => {
  const sperre = new Set<string>()
  const m = [
    merkmaleAus({ art: 'kunde', id: 'k1', bereich: 'beratung', name: 'Bäckerei Brot' }, 'Bäckerei Brot GmbH', 'Max Brotmann', sperre),
    merkmaleAus({ art: 'kunde', id: 'k2', bereich: 'beratung', name: 'Schmid Immobilien' }, 'Schmid Immobilien', 'Anna Schmid', sperre),
    merkmaleAus({ art: 'objekt', id: 'o1', name: 'MFH Hauptstraße' }, 'MFH Hauptstraße 5 Ulm', '', sperre),
  ]
  const h = haeufigkeitAus(m)
  assertEquals(vorschlaegeFuer('Rechnung_Baeckerei_Brot.pdf', '', m, h).map((x) => x.id), ['k1'])
  assertEquals(vorschlaegeFuer('Immobilien_Rechnung.pdf', '', m, h), [])
  assertEquals(vorschlaegeFuer('Scan.pdf', 'Schreiben von Anna Schmid wegen Brotmann', m, h).length > 0, true)
  assertEquals(ordnerFuer({ name: 'Energieausweis.pdf' }), 'Energieausweis')
  assertEquals(ordnerFuer({ name: 'IMG_1.jpg', typ: 'image/jpeg' }), 'Bilder')
  assertEquals(ordnerFuer({ name: 'irgendwas.pdf' }), 'Sonstiges')
})
