// Mahnen in Telegram und Follow-up vorführen — mit nachgebauter Datenbank (ohne Netz, erfundene Namen):
// mahnung_erstellen bereitet nur vor (Rechnung unverändert), nach dem Versand Eintrag wie im CRM + Vorschlag erledigt +
// Vermerk, nächste Stufe automatisch, Grenzen (Entwurf, nach der 2. Mahnung, Rechte), Postversand; followup_durchspielen
// schreibt nichts, schickt drei Vorschau-PDFs in den Chat und zeigt die echten Nachrichten mit angenommenem Datum.
//
//   npx -y deno test --allow-all telegram-gateway/mahnungWerkzeuge.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { type Daten, morgenText, type Person } from '../email-gateway/tagesmeldung.ts'
import { folgeNachMahnung, fuehreMahnungWerkzeugAus, type MahnungKontext, type MahnungMailEntwurf, mahnungNachVersand, naechsterWerktag } from './mahnungWerkzeuge.ts'

const HEUTE = '2026-12-11'
const gf = { id: 'm_gf', name: 'Erika Beispiel', email: 'gf@x.de', rolle: 'geschaeftsfuehrung', bereiche: [] as string[] }
const immo = { id: 'm_im', name: 'Ingo Immo', email: 'i@x.de', rolle: 'mitarbeiter', bereiche: ['immobilien'] }

const tabellen = (): Record<string, Zeile[]> => ({
  kunden: [
    { id: 'k_ls', bereich: 'beratung', status: 'kunde', firma: 'Lukas Sommerfeld', ansprechpartner: 'Lukas Sommerfeld', anschrift: 'Musterweg 5\n89073 Ulm', email: 'lukas@beispiel.example', verantwortlich: 'Erika Beispiel', verantwortlich_email: null, dokumente: [], activities: [] },
  ],
  rechnungen: [
    { id: 'r_1', nummer: 'LSA-001', kunde_id: 'k_ls', datum: '2026-11-24', zahlungsziel: '2026-12-08', status: 'Versendet', betrag_netto: 5000, betrag_brutto: 5950, mahnstufe: null, zahlungen: [], mahnungen: [], anschrift: 'Musterweg 5\n89073 Ulm', versendet_am: '2026-11-24' },
    { id: 'r_2', nummer: 'LSA-002', kunde_id: 'k_ls', datum: '2026-12-10', zahlungsziel: '2026-12-24', status: 'Entwurf', betrag_netto: 100, betrag_brutto: 119, mahnstufe: null, zahlungen: [], mahnungen: [] },
  ],
  mitarbeiter: [{ id: 'm_gf', email: 'gf@x.de', telegram_chat_id: 4711 }],
  wiedervorlage_regeln: [{ id: 'allg_geldeingang', ausloeser: 'ereignis:rechnung', bereich: null, titel: 'Geldeingang prüfen', tage: 0, aktiv: true }],
  wiedervorlagen: [],
  mahn_einstellung: [{ id: 1, aktiv: true, tage_erinnerung: 3, tage_mahnung1: 14, tage_mahnung2: 28, ruhe_tage_zahlung: 3 }],
  mahn_vorschlaege: [{ id: 'r_1:erinnerung', rechnung_id: 'r_1', stufe: 'erinnerung', status: 'offen', zurueckgestellt_bis: null }],
  willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.beispiel.example/' }],
})

function umgebung(mitarbeiter: Zeile = gf, db = falscheDatenbank(tabellen())) {
  const entwuerfe: MahnungMailEntwurf[] = []
  const gesendet: { url: string; name: string }[] = []
  const k: MahnungKontext = {
    supabase: db,
    // deno-lint-ignore no-explicit-any
    mitarbeiter: mitarbeiter as any,
    protokolliere: () => {},
    heute: HEUTE,
    merkeMailEntwurf: (e) => entwuerfe.push(e),
    botToken: 'test-token',
    abruf: (async (url: string, init: RequestInit) => {
      const f = init.body as FormData
      gesendet.push({ url: String(url), name: (f.get('document') as File).name })
      return new Response(JSON.stringify({ ok: true }))
    }) as unknown as typeof fetch,
  }
  return { db, k, entwuerfe, gesendet }
}

Deno.test('mahnung_erstellen: nur vorbereitet; nach dem Versand Eintrag wie im CRM, Vorschlag erledigt, Vermerk', async () => {
  const { db, k, entwuerfe } = umgebung()
  const text = await fuehreMahnungWerkzeugAus('mahnung_erstellen', { nummer: 'lsa-001' }, k)
  assertStringIncludes(text, 'NOCH NICHT GESENDET')
  assertStringIncludes(text, 'Zahlungserinnerung zu Rechnung LSA-001')
  assertStringIncludes(text, 'offen 5.950,00 €, neue Frist 18.12.2026')
  assertStringIncludes(text, 'Guten Tag Lukas Sommerfeld,\n\nanbei erhalten Sie unsere Zahlungserinnerung zu Rechnung Nr. LSA-001 vom 24.11.2026.')
  const r = () => db.tabelle('rechnungen').find((x) => x.id === 'r_1')!
  assertEquals([r().mahnstufe, (r().mahnungen as Zeile[]).length, r().status], [null, 0, 'Versendet'])
  const akte = () => db.tabelle('kunden')[0]
  const dok = (akte().dokumente as Zeile[])[0]
  assertEquals(dok.name, 'Zahlungserinnerung zu Rechnung LSA-001 (11.12.2026).pdf')
  const e = entwuerfe[0]
  assertEquals([e.betreff, e.empfaenger[0].email, e.anhaenge[0].pfad, e.mahnung.stufe], ['Zahlungserinnerung zu Rechnung LSA-001', 'lukas@beispiel.example', dok.url, 'erinnerung'])
  assert(!('rechnung' in e), 'kein Rechnungsbezug — sonst XRechnung und Rechnungsstatus')

  await mahnungNachVersand(db, e.mahnung, 'lukas@beispiel.example', 'Erika Beispiel', HEUTE)
  await mahnungNachVersand(db, e.mahnung, 'lukas@beispiel.example', 'Erika Beispiel', HEUTE) // doppelt: nichts doppelt
  const m = r().mahnungen as Zeile[]
  assertEquals(m.length, 1)
  assertEquals([m[0].stufe, m[0].datum, m[0].gebuehr, m[0].neueFrist, m[0].weg, m[0].an, m[0].dokumentName, m[0].von], ['erinnerung', HEUTE, 0, '2026-12-18', 'email', 'lukas@beispiel.example', dok.name, 'Erika Beispiel'])
  assertEquals([r().mahnstufe, r().status], ['erinnerung', 'Überfällig'])
  const v = db.tabelle('mahn_vorschlaege')[0]
  assertEquals([v.status, v.erledigt_von], ['gesendet', 'Erika Beispiel'])
  const vermerke = (akte().activities as Zeile[]).map((a) => String(a.text))
  assertEquals(vermerke.filter((t) => t.startsWith('Zahlungserinnerung zu Rechnung LSA-001 per E-Mail an lukas@beispiel.example gesendet — neue Frist 18.12.2026')).length, 1)
  const folge = await folgeNachMahnung(db, e.mahnung, HEUTE)
  assertStringIncludes(folge, '1. Mahnung zu LSA-001')

  // Nächste Stufe automatisch: 1. Mahnung mit 5 € Gebühr.
  const zweite = await fuehreMahnungWerkzeugAus('mahnung_erstellen', { rechnung_id: 'r_1' }, k)
  assertStringIncludes(zweite, '1. Mahnung zu Rechnung LSA-001')
  assertStringIncludes(zweite, '+ Mahngebühr 5,00 € = 5.955,00 €')
  assertStringIncludes(zweite, 'erst ab 22.12.2026 dran') // laut Regel noch nicht fällig
  // Dieselbe Stufe noch einmal nur mit erneut.
  assertStringIncludes(await fuehreMahnungWerkzeugAus('mahnung_erstellen', { rechnung_id: 'r_1', stufe: 'erinnerung' }, k), 'hat die Zahlungserinnerung schon (am 11.12.2026)')
})

Deno.test('mahnung_erstellen: Entwurf, nach der 2. Mahnung, Rechte, Postversand', async () => {
  const { db, k } = umgebung()
  assertStringIncludes(await fuehreMahnungWerkzeugAus('mahnung_erstellen', { nummer: 'LSA-002' }, k), 'noch ein Entwurf')
  assertStringIncludes(await fuehreMahnungWerkzeugAus('mahnung_erstellen', { nummer: 'LSA-001' }, umgebung(immo, db).k), 'Unternehmensberatung')
  db.tabelle('rechnungen')[0].mahnstufe = 'mahnung2'
  assertStringIncludes(await fuehreMahnungWerkzeugAus('mahnung_erstellen', { nummer: 'LSA-001' }, k), 'entscheidet die Geschäftsführung')
  db.tabelle('rechnungen')[0].mahnstufe = 'erinnerung'
  const post = await fuehreMahnungWerkzeugAus('mahnung_erstellen', { nummer: 'LSA-001', nur_pdf: true }, k)
  assertStringIncludes(post, '1. Mahnung zu Rechnung LSA-001 als PDF erstellt (für den Postversand) und an der Rechnung vermerkt')
  const m = db.tabelle('rechnungen')[0].mahnungen as Zeile[]
  assertEquals([m[0].stufe, m[0].weg, m[0].gebuehr], ['mahnung1', 'pdf', 5])
})

Deno.test('followup_durchspielen: schreibt nichts, drei Vorschau-PDFs in den Chat, echte Nachrichten mit Datum', async () => {
  const db = falscheDatenbank(tabellen())
  db.tabelle('mahn_vorschlaege').length = 0
  const { k, gesendet } = umgebung(gf, db)
  k.heute = '2026-11-24'
  const vorher = db.protokoll.length
  const text = await fuehreMahnungWerkzeugAus('followup_durchspielen', { nummer: 'LSA-001' }, k)
  const schreibend = db.protokoll.slice(vorher).filter((p) => p.art !== 'select')
  assertEquals(schreibend, [])
  assertEquals(db.ablage.size === 0 || [...db.ablage.values()].every((f) => f.size === 0), true)
  assertEquals(gesendet.map((g) => g.name), [
    'VORSCHAU Zahlungserinnerung zu Rechnung LSA-001 (11.12.2026).pdf',
    'VORSCHAU 1. Mahnung zu Rechnung LSA-001 (22.12.2026).pdf',
    'VORSCHAU 2. Mahnung zu Rechnung LSA-001 (05.01.2027).pdf',
  ])
  assert(gesendet.every((g) => g.url.endsWith('/sendDocument')))
  assertStringIncludes(text, 'nichts wurde gesendet oder geändert')
  assertStringIncludes(text, 'Di 08.12.2026: Zahlungsziel — Wiedervorlage „Geldeingang prüfen“')
  assertStringIncludes(text, '» Guten Morgen Erika, das steht heute an (Dienstag, 08.12.):')
  assertStringIncludes(text, '» • Geldeingang prüfen: Lukas Sommerfeld – heute')
  assertStringIncludes(text, 'Fr 11.12.2026: Zahlungserinnerung fällig (3 Tage nach dem Zahlungsziel)')
  assertStringIncludes(text, '» Rechnung LSA-001 (Lukas Sommerfeld) ist 3 Tage überfällig — Zahlungserinnerung vorbereitet')
  assertStringIncludes(text, '» Antworte z. B. „Zahlungserinnerung LSA-001 senden“, dann bereite ich sie hier vor')
  assertStringIncludes(text, 'Di 22.12.2026: 1. Mahnung fällig')
  assertStringIncludes(text, 'Di 05.01.2027: 2. Mahnung fällig')
  assertStringIncludes(text, '5.960,00 € inkl. 5,00 € Gebühr, neue Frist 15.01.2027')
  assertStringIncludes(text, 'Sa 16.01.2027: Frist der 2. Mahnung abgelaufen')
  assert(text.length < 4096)
  // An der Rechnung hat sich nichts geändert.
  assertEquals(db.tabelle('rechnungen')[0].mahnungen, [])
})

Deno.test('Morgen-Übersicht: „Geldeingang prüfen“ ohne Verantwortlichen geht an die Geschäftsführung', () => {
  const daten: Daten = {
    kunden: [{ id: 'k1', bereich: 'beratung', firma: 'Musterbau GmbH', verantwortlich: '' }],
    objekte: [],
    termine: [],
    todos: [],
    treffer: [],
    fragen: [],
    ungeklaert: 0,
    trefferErststand: null,
    wiedervorlagen: [
      { id: 'w1', kunde_id: 'k1', bereich: 'beratung', titel: 'Geldeingang prüfen', faellig: '2026-12-08', verantwortlich: null, regel: 'allg_geldeingang', rechnung: true },
      { id: 'w2', kunde_id: 'k1', bereich: 'beratung', titel: 'Neuanfrage prüfen', faellig: '2026-12-08', verantwortlich: null, regel: 'x', rechnung: false },
    ],
  }
  const jetzt = new Date('2026-12-08T08:00:00+01:00')
  const chef: Person = { email: 'gf@x.de', name: 'Erika Beispiel', chat: 1, gf: true, bereiche: [] }
  const text = morgenText(chef, daten, jetzt) ?? ''
  assertStringIncludes(text, '• Geldeingang prüfen: Musterbau GmbH – heute')
  assert(!text.includes('Neuanfrage prüfen'))
  assertEquals(morgenText({ ...chef, gf: false, bereiche: ['beratung'] }, daten, jetzt), null)
  assertEquals(naechsterWerktag('2026-12-12'), '2026-12-14')
})
