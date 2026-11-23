// Sicherheitsprüfung 23.11.2026 — Rechte im Assistenten, die vorher fehlten:
//  1. Unabgelegte Dateien aus dem privaten Assistenten (Besitzer-Marke „_pv…“, dateiBesitz.ts) sieht kein Kollege
//     (unzugeordnete_dateien, datei_lesen, dateien_ablegen, dateien_aussortieren, dateien_ins_objekt, Doppelt-Erkennung).
//  2. kunden_aus_liste verrät in der Vorschau nicht, dass es den privaten Kontakt eines Kollegen gibt.
//  3. termin_absagen nennt fremde Termine nicht (Titel/Zeit) und handelt nicht für sie.
//  4. Rechnungen nur mit dem Bereich Unternehmensberatung (kundenakte_lesen, rechnung_erfassen, rechnung_status_setzen).
//  5. Telegram-Weg ohne eingerichtetes Geheimnis nimmt nichts an.
//  6. Tagesplan eines Kollegen: Termine, bei denen der Fragende nicht dabei ist, nur als „Termin (belegt)“.
//
//   npx -y deno test --allow-all telegram-gateway/telegramRechte.test.ts
import { assert, assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { anzeigeNameAusOrdner, besitzerMarkeAusName, fremdPruefer, MARKE_MUSTER, privatMarke, unzugeordnetFremd } from './dateiBesitz.ts'
import { telegramAnzeigeName } from './objektWerkzeuge.ts'
import { fuehreAbgleichWerkzeugAus } from './abgleichWerkzeug.ts'
import { fuehreTagesplanWerkzeugAus, ohneFremdeTermine } from './tagesplanWerkzeuge.ts'
import type { PlanTag } from '../_shared/tagesplanKern.ts'

// index.ts startet beim Laden seinen Server; für den Test genügt ein stiller Ersatz.
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = () => ({ finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: 'localhost', port: 0 } })
const { anzeigeName, bearbeiteAnfrage, fuehreWerkzeugAus, werteDateiAus } = await import('./index.ts')
type Kontext = Parameters<typeof fuehreWerkzeugAus>[2]

// ---------------------------------------------------------------------------------------------
// Personen und Daten
// ---------------------------------------------------------------------------------------------

const HASAN = { id: 'm_h', name: 'Hasan Haber', email: 'Hasan@Firma.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] as string[] }
const HASAN_PRIVAT = { ...HASAN, nurPrivat: true }
const CARL = { id: 'm_c', name: 'Carl Kollege', email: 'carl@firma.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung', 'immobilien'] }
const IMMO = { id: 'm_i', name: 'Ida Immo', email: 'ida@firma.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }

const MARKE_HASAN = await privatMarke(HASAN)
const PRIVAT_DATEI = `1700000000000_haaaaaaaaaaaa_${MARKE_HASAN}_hasan_geheim.pdf`
const MAYER_DATEI = '1700000000001_hbbbbbbbbbbbb_mayer_rechnung.pdf'
const ABGELEGT_DATEI = `1700000000002_hcccccccccccc_${MARKE_HASAN}_jetzt_bei_mayer.pdf`
const URL = (name: string) => `https://test.local/storage/v1/object/public/email-anhaenge/telegram/${name}`

function daten(): Record<string, Zeile[]> {
  return {
    mitarbeiter: [HASAN, CARL, IMMO].map((m) => ({ ...m, email: m.email.toLowerCase(), aktiv: true })),
    kunden: [
      {
        id: 'k_mayer', bereich: 'beratung', privat_art: null, firma: 'Mayer Kunde GmbH', ansprechpartner: 'Max Kunde', email: 'max@kunde.de', telefon: '',
        status: 'lead', prioritaet: 'Mittel', verantwortlich: 'Carl Kollege', verantwortlich_email: null, follow_up: null, activities: [],
        dokumente: [{ id: 'd_ab', name: 'jetzt_bei_mayer.pdf', typ: 'application/pdf', datum: '2026-11-01', groesse: '1 KB', url: URL(ABGELEGT_DATEI) }],
      },
      {
        id: 'k_immo', bereich: 'immobilienkunden', privat_art: null, firma: 'Immo Käufer', ansprechpartner: 'Ina Käufer', email: 'ina@kaeufer.de', telefon: '',
        status: 'lead', prioritaet: 'Mittel', verantwortlich: 'Ida Immo', verantwortlich_email: null, follow_up: null, activities: [], dokumente: [],
      },
      {
        id: 'k_priv_h', bereich: 'privat', privat_art: null, firma: 'Zebra Privatkontakt', ansprechpartner: 'Zora Zebra', email: 'zora@privat.de', telefon: '',
        status: 'neu', prioritaet: 'Mittel', verantwortlich: 'Hasan Haber', verantwortlich_email: 'hasan@firma.de', follow_up: null, activities: [], dokumente: [],
      },
    ],
    objekte: [{ id: 'o_mayer', bezeichnung: 'Haus Ulm', adresse: 'Ulm', typ: 'Haus', status: 'akquise', kaufpreis: 0, verantwortlich: 'Ida Immo', privat_besitzer: null, dokumente: {}, activities: [] }],
    rechnungen: [{ id: 'r1', nummer: 'RE-2026-077', kunde_id: 'k_immo', datum: '2026-11-01', betrag_netto: 100, betrag_brutto: 119, status: 'Versendet', zahlungsziel: '2026-11-15' }],
    protokolle: [],
    termine: [
      { id: '00000000-0000-4000-8000-000000000001', titel: 'Geheimes Outlook-Treffen', beginn: '2030-01-10T09:00:00.000Z', ende: '2030-01-10T10:00:00.000Z', ganztags: false, besitzer_email: 'hasan@firma.de', teilnehmer: [], ms_id: 'AAMk1' },
      { id: '00000000-0000-4000-8000-000000000002', titel: 'Gemeinsame Besichtigung', beginn: '2030-01-10T11:00:00.000Z', ende: '2030-01-10T12:00:00.000Z', ganztags: false, besitzer_email: 'hasan@firma.de', teilnehmer: ['carl@firma.de'], ms_id: null },
    ],
  }
}

/** Datenbank im Speicher plus die Ablage-Funktionen, die die Testablage nicht kennt (list, move, getPublicUrl). */
function client(db: FalscheDatenbank) {
  const fach = (eimer: string) => {
    if (!db.ablage.has(eimer)) db.ablage.set(eimer, new Map())
    return db.ablage.get(eimer)!
  }
  return {
    from: (t: string) => db.from(t),
    storage: {
      from: (eimer: string) => ({
        ...db.storage.from(eimer),
        list: (ordner: string) =>
          Promise.resolve({
            data: [...fach(eimer).entries()]
              .filter(([p]) => p.startsWith(`${ordner}/`) && !p.slice(ordner.length + 1).includes('/'))
              .map(([p, d]) => ({ name: p.slice(ordner.length + 1), created_at: new Date().toISOString(), metadata: { size: d.bytes.length, mimetype: d.contentType } })),
            error: null,
          }),
        move: (von: string, nach: string) => {
          const d = fach(eimer).get(von)
          if (!d) return Promise.resolve({ data: null, error: { message: 'Object not found' } })
          fach(eimer).delete(von)
          fach(eimer).set(nach, d)
          return Promise.resolve({ data: {}, error: null })
        },
        getPublicUrl: (pfad: string) => ({ data: { publicUrl: `https://test.local/storage/v1/object/public/${eimer}/${pfad}` } }),
      }),
    },
  }
}

function neueDb(): FalscheDatenbank {
  const db = falscheDatenbank(daten())
  const fach = new Map()
  for (const name of [PRIVAT_DATEI, MAYER_DATEI, ABGELEGT_DATEI]) fach.set(`telegram/${name}`, { bytes: new TextEncoder().encode(name), contentType: 'application/pdf' })
  db.ablage.set('email-anhaenge', fach)
  return db
}

function kontext(db: FalscheDatenbank, m: Kontext['mitarbeiter']): Kontext {
  return { supabase: client(db) as unknown as Kontext['supabase'], mitarbeiter: m, state: { v: 3, zuege: [], aktionen: [] }, vorherigeLoeschAnfrage: undefined, vorherigeMailAnfrage: undefined }
}

/** Mit stummer Konsole (Inhalte nachschlagen und Lesen anstoßen gehen im Test ohne Netz ins Leere). */
async function still<T>(f: () => Promise<T>): Promise<T> {
  const alt = console.error
  console.error = () => {}
  try {
    return await f()
  } finally {
    console.error = alt
  }
}

// deno-lint-ignore no-explicit-any
const rufe = (db: FalscheDatenbank, m: Kontext['mitarbeiter'], werkzeug: string, eingabe: any) => still(() => fuehreWerkzeugAus(werkzeug, eingabe, kontext(db, m)))

async function mitUmgebung<T>(werte: Record<string, string | undefined>, f: () => Promise<T>): Promise<T> {
  const alt: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(werte)) {
    alt[k] = Deno.env.get(k)
    if (v === undefined) Deno.env.delete(k)
    else Deno.env.set(k, v)
  }
  try {
    return await f()
  } finally {
    for (const [k, v] of Object.entries(alt)) {
      if (v === undefined) Deno.env.delete(k)
      else Deno.env.set(k, v)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 1. Besitzer-Marke
// ---------------------------------------------------------------------------------------------

Deno.test('Besitzer-Marke: Muster, Anzeigename und Marke aus Namen, Pfad oder Adresse', async () => {
  assertMatch(MARKE_HASAN, /^pv[0-9a-f]{8}$/)
  assertEquals(await privatMarke({ email: ' hasan@firma.DE ' }), MARKE_HASAN, 'ohne Groß-/Kleinschreibung und Leerraum')
  assert((await privatMarke({ email: 'carl@firma.de' })) !== MARKE_HASAN)
  assertEquals(PRIVAT_DATEI.match(MARKE_MUSTER)?.[1], 'haaaaaaaaaaaa')
  assertEquals(`1700000000000_haaaaaaaaaaaap3-5_${MARKE_HASAN}_teil.pdf`.match(MARKE_MUSTER)?.[1], 'haaaaaaaaaaaap3-5', 'Seitenbereich bleibt Teil des Abdrucks')
  for (const f of [anzeigeNameAusOrdner, anzeigeName, telegramAnzeigeName]) {
    assertEquals(f(PRIVAT_DATEI), 'hasan_geheim.pdf')
    assertEquals(f(MAYER_DATEI), 'mayer_rechnung.pdf')
    assertEquals(f('1700000000000_ohne_abdruck.pdf'), 'ohne_abdruck.pdf')
  }
  assertEquals(besitzerMarkeAusName(PRIVAT_DATEI), MARKE_HASAN)
  assertEquals(besitzerMarkeAusName(`telegram/${PRIVAT_DATEI}`), MARKE_HASAN)
  assertEquals(besitzerMarkeAusName(`${URL(PRIVAT_DATEI)}?x=1`), MARKE_HASAN)
  assertEquals(besitzerMarkeAusName(MAYER_DATEI), null)
  // Ein Dateiname, der zufällig mit „pv…“ beginnt, ist keine Marke, wenn sie nicht direkt hinter dem Abdruck steht.
  assertEquals(besitzerMarkeAusName('1700000000001_hbbbbbbbbbbbb_pv12345678.pdf'), null)
})

Deno.test('unzugeordnetFremd: Mayer-Assistent verbirgt fremde Marken, privater Assistent zeigt nur die eigene', async () => {
  assert(await unzugeordnetFremd(CARL, PRIVAT_DATEI))
  assert(!(await unzugeordnetFremd(CARL, MAYER_DATEI)))
  assert(!(await unzugeordnetFremd(HASAN, PRIVAT_DATEI)), 'Hasan sieht seine eigene Datei auch im Mayer-Assistenten')
  assert(!(await unzugeordnetFremd(HASAN_PRIVAT, PRIVAT_DATEI)))
  assert(await unzugeordnetFremd(HASAN_PRIVAT, MAYER_DATEI), 'Eingänge der Holding gibt es im privaten Assistenten nicht')
  const carlPrivat = await fremdPruefer({ ...CARL, nurPrivat: true })
  assert(carlPrivat(PRIVAT_DATEI) && carlPrivat(MAYER_DATEI))
})

Deno.test('unzugeordnete_dateien: Hasans private Datei nur bei Hasan, im privaten Assistenten nur sie', async () => {
  const db = neueDb()
  const carl = await rufe(db, CARL, 'unzugeordnete_dateien', {})
  assert(!carl.includes('hasan_geheim'), carl)
  assertStringIncludes(carl, 'mayer_rechnung.pdf')
  assert(!carl.includes('jetzt_bei_mayer'), 'abgelegte Dateien stehen nicht in der Liste')
  const hasan = await rufe(db, HASAN, 'unzugeordnete_dateien', {})
  assertStringIncludes(hasan, 'hasan_geheim.pdf')
  assertStringIncludes(hasan, 'mayer_rechnung.pdf')
  const privat = await rufe(db, HASAN_PRIVAT, 'unzugeordnete_dateien', {})
  assertStringIncludes(privat, 'hasan_geheim.pdf')
  assert(!privat.includes('mayer_rechnung'), privat)
})

Deno.test('datei_lesen: fremde private Datei gibt es nicht; abgelegt in einer sichtbaren Akte schon', async () => {
  const db = neueDb()
  assertStringIncludes(await rufe(db, CARL, 'datei_lesen', { pfad: `telegram/${PRIVAT_DATEI}` }), 'gibt es in der Ablage nicht')
  assertStringIncludes(await rufe(db, HASAN_PRIVAT, 'datei_lesen', { pfad: `telegram/${MAYER_DATEI}` }), 'gibt es in der Ablage nicht')
  for (const [m, name] of [[CARL, MAYER_DATEI], [HASAN, PRIVAT_DATEI], [HASAN_PRIVAT, PRIVAT_DATEI], [CARL, ABGELEGT_DATEI]] as const) {
    const r = await rufe(db, m, 'datei_lesen', { pfad: `telegram/${name}` })
    assert(!r.includes('gibt es in der Ablage nicht'), `${m.name} / ${name}: ${r}`)
  }
})

Deno.test('dateien_ablegen / dateien_aussortieren: fremde private Datei weder ablegen noch verschieben', async () => {
  const db = neueDb()
  const ab = await rufe(db, CARL, 'dateien_ablegen', { kunde_id: 'k_mayer', dateien: [{ pfad: `telegram/${PRIVAT_DATEI}` }] })
  assertStringIncludes(ab, 'gibt es in der Ablage nicht')
  assertEquals((db.tabellen.kunden.find((k) => k.id === 'k_mayer')!.dokumente as unknown[]).length, 1, 'nichts abgelegt')
  const weg = await rufe(db, CARL, 'dateien_aussortieren', { pfade: [`telegram/${PRIVAT_DATEI}`] })
  assertStringIncludes(weg, 'kein gültiger Pfad')
  assert(db.ablage.get('email-anhaenge')!.has(`telegram/${PRIVAT_DATEI}`), 'Datei liegt noch da')
  // Hasan selbst darf seine Datei in eine Akte der Holding legen.
  const hasan = await rufe(db, HASAN, 'dateien_ablegen', { kunde_id: 'k_mayer', dateien: [{ pfad: `telegram/${PRIVAT_DATEI}` }] })
  assert(!hasan.includes('gibt es in der Ablage nicht'), hasan)
  assertEquals((db.tabellen.kunden.find((k) => k.id === 'k_mayer')!.dokumente as unknown[]).length, 2)
})

Deno.test('dateien_ins_objekt: fremde private Datei wird nicht übernommen, Datei der Holding schon', async () => {
  const db = neueDb()
  const r = await rufe(db, IMMO, 'dateien_ins_objekt', { objekt_id: 'o_mayer', dateien: [{ pfad: `telegram/${PRIVAT_DATEI}`, ordner: 'Sonstiges' }, { pfad: `telegram/${MAYER_DATEI}`, ordner: 'Sonstiges' }] })
  assertStringIncludes(r, `„telegram/${PRIVAT_DATEI}“: Diese Datei gibt es in der Ablage nicht`)
  const imObjekt = Object.values((db.tabellen.objekte[0].dokumente ?? {}) as Record<string, { name: string }[]>).flat()
  assertEquals(imObjekt.map((d) => d.name), ['mayer_rechnung.pdf'])
})

Deno.test('werteDateiAus: privater Assistent speichert mit Besitzer-Marke; gleiche Datei im Mayer-Assistenten bekommt eine eigene Kopie', async () => {
  const db = neueDb()
  const supa = client(db) as unknown as Parameters<typeof werteDateiAus>[0]
  const bytes = new TextEncoder().encode('Hasans Steuerbescheid')
  const privat = await still(() => werteDateiAus(supa, bytes, 'bescheid.zip', 'application/zip', '', 'h0123456789ab', HASAN_PRIVAT))
  const pfadPrivat = /pfad=(telegram\/\S+)/.exec(privat)?.[1] ?? ''
  assertMatch(pfadPrivat, new RegExp(`^telegram/\\d+_h0123456789ab_${MARKE_HASAN}_bescheid\\.zip$`))
  // Carl schickt zufällig dieselbe Datei: kein „schon einmal geschickt“, sondern normal gespeichert (ohne Marke).
  const mayer = await still(() => werteDateiAus(supa, bytes, 'bescheid.zip', 'application/zip', '', 'h0123456789ab', CARL))
  assert(!/bereits/.test(mayer), mayer)
  const pfadMayer = /pfad=(telegram\/\S+)/.exec(mayer)?.[1] ?? ''
  assertMatch(pfadMayer, /^telegram\/\d+_h0123456789ab_bescheid\.zip$/)
  // Hasan im privaten Assistenten noch einmal: erkennt seine eigene frühere Datei, nicht die von Carl.
  const nochmal = await still(() => werteDateiAus(supa, bytes, 'bescheid.zip', 'application/zip', '', 'h0123456789ab', HASAN_PRIVAT))
  assertStringIncludes(nochmal, 'NICHT noch einmal gespeichert')
  assertStringIncludes(nochmal, pfadPrivat)
  assert(!nochmal.includes(pfadMayer), nochmal)
})

Deno.test('kontoauszug_abgleichen: fremde private Datei gibt es nicht, außer sie liegt in einer sichtbaren Akte', async () => {
  const db = neueDb()
  const gelesen: string[] = []
  const k = (m: typeof CARL) => ({
    supabase: client(db),
    mitarbeiter: m,
    protokolliere: () => {},
    heute: '2026-11-23',
    leseAuszug: (d: { pfad: string }) => {
      gelesen.push(d.pfad)
      return Promise.resolve({ ok: false as const, fehler: 'Testauszug nicht lesbar' })
    },
  })
  assertEquals(await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: `telegram/${PRIVAT_DATEI}` }, k(CARL)), 'Fehler: Diese Datei gibt es in der Ablage nicht.')
  assertEquals(gelesen.length, 0, 'fremde Datei wurde nicht gelesen')
  assertEquals(await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: `telegram/${ABGELEGT_DATEI}` }, k(CARL)), 'Fehler: Testauszug nicht lesbar')
  assertEquals(await fuehreAbgleichWerkzeugAus('kontoauszug_abgleichen', { pfad: `telegram/${PRIVAT_DATEI}` }, k(HASAN)), 'Fehler: Testauszug nicht lesbar')
  assertEquals(gelesen, [`telegram/${ABGELEGT_DATEI}`, `telegram/${PRIVAT_DATEI}`])
})

// ---------------------------------------------------------------------------------------------
// 2. kunden_aus_liste
// ---------------------------------------------------------------------------------------------

Deno.test('kunden_aus_liste: Vorschau verrät den privaten Kontakt eines Kollegen nicht', async () => {
  const db = neueDb()
  const r = await rufe(db, CARL, 'kunden_aus_liste', { eintraege: [{ name: 'Zebra Privatkontakt', bereich: 'beratung' }, { name: 'Mayer Kunde GmbH', bereich: 'beratung' }] })
  const [zebra, mayer] = r.split('\n').filter((z) => /^\d+\. /.test(z))
  assert(!zebra.includes('gibt es schon'), zebra)
  assertStringIncludes(mayer, 'gibt es schon (kunde_id=k_mayer)')
  // Hasan sieht seinen eigenen privaten Kontakt als vorhanden.
  assertStringIncludes(await rufe(db, HASAN, 'kunden_aus_liste', { eintraege: [{ name: 'Zebra Privatkontakt', bereich: 'beratung' }] }), 'gibt es schon (kunde_id=k_priv_h)')
})

// ---------------------------------------------------------------------------------------------
// 3. termin_absagen
// ---------------------------------------------------------------------------------------------

Deno.test('termin_absagen: fremder Termin gibt es nicht (ohne Titel), beim eigenen bzw. gemeinsamen geht es weiter', async () => {
  const db = neueDb()
  const altFetch = globalThis.fetch
  const aufrufe: unknown[] = []
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    aufrufe.push(JSON.parse(String(init?.body ?? '{}')))
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  }) as typeof fetch
  try {
    await mitUmgebung({ MS_ERLAUBT: 'carl@firma.de' }, async () => {
      const fremd = await rufe(db, CARL, 'termin_absagen', { termin_id: '00000000-0000-4000-8000-000000000001' })
      assertStringIncludes(fremd, 'Diesen Termin gibt es nicht')
      assert(!fremd.includes('Outlook-Treffen'), fremd)
      assertEquals(aufrufe.length, 0, 'nichts vorgemerkt')
      const gemeinsam = await rufe(db, CARL, 'termin_absagen', { termin_id: '00000000-0000-4000-8000-000000000002' })
      assertStringIncludes(gemeinsam, 'VORGEMERKT')
      assertStringIncludes(gemeinsam, 'Gemeinsame Besichtigung')
      assertEquals(aufrufe.length, 1)
    })
    await mitUmgebung({ MS_ERLAUBT: undefined }, async () => {
      assertStringIncludes(await rufe(db, IMMO, 'termin_absagen', { termin_id: '00000000-0000-4000-8000-000000000002' }), 'Diesen Termin gibt es nicht')
      assertEquals(aufrufe.length, 1, 'kein Absage-Aufruf für einen fremden Termin')
    })
  } finally {
    globalThis.fetch = altFetch
  }
})

// ---------------------------------------------------------------------------------------------
// 4. Rechnungen nur mit Unternehmensberatung
// ---------------------------------------------------------------------------------------------

Deno.test('Rechnungen: ohne Bereich Unternehmensberatung weder lesen noch erfassen noch Status setzen', async () => {
  const db = neueDb()
  const ida = await rufe(db, IMMO, 'kundenakte_lesen', { kunde_id: 'k_immo' })
  assertStringIncludes(ida, 'Kunde: Immo Käufer')
  assert(!ida.includes('RE-2026-077') && !ida.includes('Rechnungen an den Kunden'), ida)
  assertStringIncludes(await rufe(db, CARL, 'kundenakte_lesen', { kunde_id: 'k_immo' }), 'RE-2026-077')

  const status = await rufe(db, IMMO, 'rechnung_status_setzen', { nummer: 'RE-2026-077', status: 'Bezahlt' })
  assertStringIncludes(status, 'Nicht freigegeben: Der Bereich Unternehmensberatung')
  assertEquals(db.tabellen.rechnungen[0].status, 'Versendet')

  const neu = await rufe(db, IMMO, 'rechnung_erfassen', { kunde_id: 'k_immo', nummer: 'RE-2026-099', datum: '2026-11-20', betrag_brutto: 119, status: 'Versendet' })
  assertStringIncludes(neu, 'Nicht freigegeben: Der Bereich Unternehmensberatung')
  assertEquals(db.tabellen.rechnungen.length, 1)
  // Gleiche Nummer abfragen verrät auch nichts über vorhandene Rechnungen.
  assert(!(await rufe(db, IMMO, 'rechnung_erfassen', { kunde_id: 'k_immo', nummer: 'RE-2026-077', datum: '2026-11-20', betrag_brutto: 119, status: 'Versendet' })).includes('bereits'))

  // Mit dem Bereich wie bisher.
  assertStringIncludes(await rufe(db, CARL, 'rechnung_status_setzen', { nummer: 'RE-2026-077', status: 'Bezahlt' }), 'steht jetzt auf Bezahlt')
})

// ---------------------------------------------------------------------------------------------
// 5. Telegram-Weg ohne Geheimnis
// ---------------------------------------------------------------------------------------------

Deno.test('Telegram-Weg: ohne oder mit falschem Geheimnis 401 (auch wenn keines eingerichtet ist)', async () => {
  const anfrage = (kopf: Record<string, string>) =>
    new Request('https://test.local/functions/v1/telegram-gateway', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...kopf },
      body: JSON.stringify({ update_id: 1, message: { chat: { id: 4711 }, text: 'Hallo' } }),
    })
  assertEquals((await bearbeiteAnfrage(anfrage({}))).status, 401)
  assertEquals((await bearbeiteAnfrage(anfrage({ 'x-telegram-bot-api-secret-token': 'falsch' }))).status, 401)
  assertEquals((await bearbeiteAnfrage(anfrage({ 'x-telegram-bot-api-secret-token': '' }))).status, 401)
})

// ---------------------------------------------------------------------------------------------
// 6. Tagesplan eines Kollegen
// ---------------------------------------------------------------------------------------------

Deno.test('Tagesplan: fremde Termine im Plan eines Kollegen nur als „Termin (belegt)“', async () => {
  const datum = '2030-01-10'
  const plan: PlanTag = {
    id: `Hasan Haber|${datum}`, mitarbeiter: 'Hasan Haber', datum, anrufe: '', aktualisiertAm: '',
    zeilen: [
      { id: 'z1', block: 'frist', was: '10:00–11:00 Uhr: Geheimes Outlook-Treffen (Zebra Privatkontakt)', terminId: '00000000-0000-4000-8000-000000000001', bezug: { art: 'kunde', id: 'k_priv_h', name: 'Zebra Privatkontakt' } },
      { id: 'z2', block: 'frist', was: '12:00–13:00 Uhr: Gemeinsame Besichtigung', terminId: '00000000-0000-4000-8000-000000000002' },
      { id: 'z3', block: 'frist', was: 'ganztägig: Gelöschter Urlaub', terminId: '00000000-0000-4000-8000-00000000dead' },
      { id: 'z4', block: 'A', was: 'Bankgespräch vorbereiten' },
    ],
  } as PlanTag
  const db = falscheDatenbank({ ...daten(), abteilung_eintraege: [{ id: plan.id, art: 'tagesplan', daten: plan }] })

  const maskiert = await ohneFremdeTermine(db, plan, 'CARL@firma.de')
  assertEquals(maskiert.zeilen.map((z) => z.was), ['10:00–11:00 Uhr: Termin (belegt)', '12:00–13:00 Uhr: Gemeinsame Besichtigung', 'ganztägig: Termin (belegt)', 'Bankgespräch vorbereiten'])
  assertEquals(maskiert.zeilen[0].bezug, undefined)
  assertEquals((await ohneFremdeTermine(db, plan, 'hasan@firma.de')).zeilen.map((z) => z.was).slice(0, 2), [plan.zeilen[0].was, plan.zeilen[1].was], 'der Besitzer selbst (über ohneFremdeTermine) sieht seine Termine')

  const k = { supabase: db, mitarbeiter: CARL, protokolliere: () => {}, heute: datum }
  const text = await fuehreTagesplanWerkzeugAus('tag_zeigen', { wer: 'Hasan', datum }, k)
  assert(!text.includes('Outlook-Treffen') && !text.includes('Zebra') && !text.includes('Urlaub'), text)
  assertStringIncludes(text, 'Termin (belegt)')
  assertStringIncludes(text, 'Gemeinsame Besichtigung')
  assertStringIncludes(text, 'Bankgespräch vorbereiten')
  // Der eigene Plan bleibt unverändert.
  const eigen = await fuehreTagesplanWerkzeugAus('tag_zeigen', { datum }, { ...k, mitarbeiter: { ...HASAN, bereiche: ['immobilien'] } })
  assertStringIncludes(eigen, 'Geheimes Outlook-Treffen')
})
