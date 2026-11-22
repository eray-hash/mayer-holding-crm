// Prüft die Nachfrage nach Kundenterminen (ohne Netz, ohne echtes Telegram): Zeitfenster nach dem Ende, Einstellung
// je Mitarbeiter, einmal je Termin, kein Protokoll am selben Tag, Rechte und private Akten, höchstens eine Nachfrage
// je Mitarbeiter und Lauf, Tagesgrenze, Zustellung über telegram-gateway.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { frageNachTerminen, frageUeberAssistent, HOECHSTENS_JE_TAG, istFaellig, nachfrageText, vonText, type NachfrageOptionen } from './nachTermin.ts'
import { FalscheDatenbank } from '../_shared/testDoppel.ts'

// Freitag, 27.11.2026, 13:00 Uhr in Berlin (UTC+1). Der Termin endete um 12:48 Uhr, also vor 12 Minuten.
const JETZT = new Date('2026-11-27T12:00:00Z')
const ANDREAS = 'andreas@mayer.test'
const HASAN = 'hasan@mayer.test'
const QUIRIN = 'quirin@mayer.test'

function termin(t: Record<string, unknown> = {}) {
  return {
    id: 't1',
    titel: 'Erstgespräch Lehle',
    ort: 'Ulm',
    beginn: '2026-11-27T11:00:00.000Z',
    ende: '2026-11-27T11:48:00.000Z',
    ganztags: false,
    besitzer_email: ANDREAS,
    teilnehmer: [],
    kunde_id: 'k_lehle',
    kunde_bereich: 'erben',
    kunde_name: 'Josef Lehle',
    quelle: 'crm',
    gast: null,
    ms_teilnehmer: null,
    ...t,
  }
}

function db(o: { termine?: Record<string, unknown>[]; einstellungen?: Record<string, unknown>[]; protokolle?: Record<string, unknown>[]; briefings?: Record<string, unknown>[] } = {}) {
  return new FalscheDatenbank({
    termine: o.termine ?? [termin()],
    kalender_einstellungen: o.einstellungen ?? [],
    termin_briefings: o.briefings ?? [],
    mitarbeiter: [
      { id: 'a', name: 'Andreas Mayer', email: ANDREAS, rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], telegram_chat_id: 111, aktiv: true },
      { id: 'h', name: 'Hasan Süslü', email: HASAN, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['erben', 'beratung'], telegram_chat_id: 222, aktiv: true },
      { id: 'q', name: 'Quirin Lutzenberger', email: QUIRIN, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'], telegram_chat_id: 333, aktiv: true },
    ],
    kunden: [
      { id: 'k_lehle', bereich: 'erben', firma: 'Josef Lehle', ansprechpartner: 'Josef Lehle', email: 'lehle@beispiel.test', verantwortlich_email: null },
      { id: 'k_huber', bereich: 'beratung', firma: 'Huber GmbH', ansprechpartner: 'Anna Huber', email: 'huber@beispiel.test', verantwortlich_email: null },
      { id: 'k_privat', bereich: 'privat', firma: 'Max Privat', ansprechpartner: 'Max Privat', email: 'max@privat.test', verantwortlich_email: HASAN },
      { id: 'k_intern_holding', bereich: 'beratung', firma: 'Intern', email: 'info@mayer.test' },
    ],
    protokolle: o.protokolle ?? [{ id: 'p_alt', kunde_id: 'k_lehle', datum: '2026-11-10', betreff: 'Erstes Telefonat' }],
    besichtigungen: [],
    objekte: [{ id: 'o_lager', bezeichnung: 'Lagerhalle Neu-Ulm', privat_besitzer: null }],
  })
}

type Gesendet = { mitarbeiterId: string; text: string; von: string }

function optionen(gesendet: Gesendet[], extra: Partial<NachfrageOptionen> = {}): NachfrageOptionen {
  return {
    jetzt: JETZT,
    frage: (mitarbeiterId, text, von) => {
      gesendet.push({ mitarbeiterId, text, von })
      return Promise.resolve(true)
    },
    privatAktiv: () => Promise.resolve(false),
    ...extra,
  }
}

Deno.test('Zeitfenster: 10 bis 20 Minuten nach dem Ende', () => {
  assertEquals(istFaellig('2026-11-27T11:50:00Z', JETZT), true)
  assertEquals(istFaellig('2026-11-27T11:40:00Z', JETZT), true)
  assertEquals(istFaellig('2026-11-27T11:51:00Z', JETZT), false)
  assertEquals(istFaellig('2026-11-27T11:39:00Z', JETZT), false)
})

Deno.test('Text und Absenderfeld', () => {
  const text = nachfrageText('Josef Lehle', termin())
  assertStringIncludes(text, 'Wie lief der Termin mit Josef Lehle („Erstgespräch Lehle“, 12:00–12:48 Uhr)?')
  assertStringIncludes(text, 'ich lege das Protokoll an')
  assertEquals(vonText('k_b91d4e3d4806', '2026-11-27'), 'Nachfrage nach Kundentermin (Akte k_b91d4e3d4806, 27.11.2026)')
  assert(vonText('k_' + 'x'.repeat(70), '2026-11-27').length <= 80)
})

Deno.test('fragt den Besitzer einmal und vermerkt es', async () => {
  const d = db()
  const gesendet: Gesendet[] = []
  const r = await frageNachTerminen(d, optionen(gesendet))
  assertEquals(r.fehler, [])
  assertEquals(r.gefragt, 1)
  assertEquals(gesendet.length, 1)
  assertEquals(gesendet[0].mitarbeiterId, 'a')
  assertStringIncludes(gesendet[0].text, 'Josef Lehle')
  assertStringIncludes(gesendet[0].von, 'Akte k_lehle')
  const vermerk = d.tabelle('termin_briefings')[0]
  assertEquals(vermerk.id, 'nachfrage|t1')
  assertEquals(vermerk.art, 'nachfrage')
  assertEquals(vermerk.empfaenger, ANDREAS)
  assertEquals(vermerk.zugestellt, true)
  // Nächster Takt (eine Minute später, noch im Fenster): keine Wiederholung.
  const r2 = await frageNachTerminen(d, optionen(gesendet, { jetzt: new Date(JETZT.getTime() + 60000) }))
  assertEquals(r2.gefragt, 0)
  assertEquals(gesendet.length, 1)
})

Deno.test('zu früh, zu spät, ganztägig oder abgesagt: keine Nachfrage', async () => {
  for (const t of [
    termin({ ende: '2026-11-27T11:55:00.000Z' }),
    termin({ ende: '2026-11-27T11:30:00.000Z' }),
    termin({ ganztags: true }),
    termin({ titel: 'Abgesagt: Erstgespräch Lehle' }),
  ]) {
    const gesendet: Gesendet[] = []
    await frageNachTerminen(db({ termine: [t] }), optionen(gesendet))
    assertEquals(gesendet.length, 0, JSON.stringify(t))
  }
})

Deno.test('Einstellung aus: keine Nachfrage; andere Einstellungen ohne Wirkung', async () => {
  const gesendet: Gesendet[] = []
  await frageNachTerminen(db({ einstellungen: [{ email: ANDREAS, nachfrage_an: false }] }), optionen(gesendet))
  assertEquals(gesendet.length, 0)
  await frageNachTerminen(db({ einstellungen: [{ email: ANDREAS, nachfrage_an: true, briefing_an: false }] }), optionen(gesendet))
  assertEquals(gesendet.length, 1)
})

Deno.test('Einstellungen nicht lesbar (Spalte fehlt): gar nichts senden', async () => {
  const d = db()
  const echt = d.from.bind(d)
  // deno-lint-ignore no-explicit-any
  ;(d as any).from = (tabelle: string) => {
    if (tabelle !== 'kalender_einstellungen') return echt(tabelle)
    return { select: () => Promise.resolve({ data: null, error: { message: 'column kalender_einstellungen.nachfrage_an does not exist' } }) }
  }
  const gesendet: Gesendet[] = []
  const r = await frageNachTerminen(d, optionen(gesendet))
  assertEquals(gesendet.length, 0)
  assertStringIncludes(r.fehler.join(' '), 'Einstellungen nicht lesbar')
})

Deno.test('heute schon ein Protokoll zur Akte: keine Nachfrage', async () => {
  const gesendet: Gesendet[] = []
  await frageNachTerminen(db({ protokolle: [{ id: 'p1', kunde_id: 'k_lehle', datum: '2026-11-27', betreff: 'Telefonat' }] }), optionen(gesendet))
  assertEquals(gesendet.length, 0)
})

Deno.test('ohne Kundenakte, Sammelakte oder nur Objekt: keine Nachfrage', async () => {
  for (const t of [
    termin({ kunde_id: null, titel: 'Zahnarzt' }),
    termin({ kunde_id: 'k_intern_holding', titel: 'Teambesprechung' }),
    termin({ kunde_id: null, titel: 'Besichtigung Lagerhalle Neu-Ulm' }),
  ]) {
    const gesendet: Gesendet[] = []
    await frageNachTerminen(db({ termine: [t] }), optionen(gesendet))
    assertEquals(gesendet.length, 0, String(t.titel))
  }
})

Deno.test('Bezug über den Titel (nur ein Kunde passt)', async () => {
  const gesendet: Gesendet[] = []
  await frageNachTerminen(db({ termine: [termin({ kunde_id: null, titel: 'Termin mit Anna Huber' })] }), optionen(gesendet))
  assertEquals(gesendet.length, 1)
  assertStringIncludes(gesendet[0].text, 'Anna Huber')
  assertStringIncludes(gesendet[0].von, 'k_huber')
})

Deno.test('Besitzer darf die Akte nicht sehen: keine Nachfrage', async () => {
  const gesendet: Gesendet[] = []
  await frageNachTerminen(db({ termine: [termin({ besitzer_email: QUIRIN })] }), optionen(gesendet))
  assertEquals(gesendet.length, 0)
})

Deno.test('private Akte: nur ohne privaten Assistenten über den Mayer-Bot', async () => {
  const t = termin({ besitzer_email: HASAN, kunde_id: 'k_privat', titel: 'Kaffee mit Max' })
  const mitPrivat: Gesendet[] = []
  await frageNachTerminen(db({ termine: [t] }), optionen(mitPrivat, { privatAktiv: () => Promise.resolve(true) }))
  assertEquals(mitPrivat.length, 0)
  const ohnePrivat: Gesendet[] = []
  await frageNachTerminen(db({ termine: [t] }), optionen(ohnePrivat))
  assertEquals(ohnePrivat.length, 1)
  assertEquals(ohnePrivat[0].mitarbeiterId, 'h')
})

Deno.test('je Mitarbeiter höchstens eine Nachfrage je Lauf, die zweite im nächsten Takt', async () => {
  const d = db({
    termine: [
      termin(),
      termin({ id: 't2', kunde_id: 'k_huber', titel: 'Huber', beginn: '2026-11-27T11:20:00.000Z', ende: '2026-11-27T11:45:00.000Z' }),
      termin({ id: 't3', kunde_id: 'k_huber', besitzer_email: HASAN, titel: 'Huber mit Hasan' }),
    ],
  })
  const gesendet: Gesendet[] = []
  await frageNachTerminen(d, optionen(gesendet))
  assertEquals(gesendet.map((g) => g.mitarbeiterId).sort(), ['a', 'h'])
  await frageNachTerminen(d, optionen(gesendet, { jetzt: new Date(JETZT.getTime() + 60000) }))
  assertEquals(gesendet.length, 3)
  assertEquals(gesendet.filter((g) => g.mitarbeiterId === 'a').length, 2)
})

Deno.test('Tagesgrenze je Mitarbeiter', async () => {
  const briefings = Array.from({ length: HOECHSTENS_JE_TAG }, (_, i) => ({ id: `nachfrage|alt${i}`, termin_id: null, empfaenger: ANDREAS, art: 'nachfrage', gesendet_am: '2026-11-27T08:00:00.000Z', zugestellt: true }))
  const gesendet: Gesendet[] = []
  await frageNachTerminen(db({ briefings }), optionen(gesendet))
  assertEquals(gesendet.length, 0)
  // Vom Vortag zählt nicht.
  const gestern = briefings.map((b) => ({ ...b, gesendet_am: '2026-11-26T08:00:00.000Z' }))
  await frageNachTerminen(db({ briefings: gestern }), optionen(gesendet))
  assertEquals(gesendet.length, 1)
})

Deno.test('Senden klappt nicht: vermerkt, nicht wiederholt', async () => {
  const d = db()
  let versuche = 0
  const o = optionen([], {
    frage: () => {
      versuche++
      return Promise.resolve(false)
    },
  })
  const r = await frageNachTerminen(d, o)
  assertEquals(r.gefragt, 0)
  assertEquals(d.tabelle('termin_briefings')[0].zugestellt, false)
  await frageNachTerminen(d, { ...o, jetzt: new Date(JETZT.getTime() + 60000) })
  assertEquals(versuche, 1)
})

Deno.test('Besitzer ohne Telegram: keine Nachfrage, kein Vermerk', async () => {
  const d = db()
  d.tabelle('mitarbeiter')[0].telegram_chat_id = null
  const gesendet: Gesendet[] = []
  await frageNachTerminen(d, optionen(gesendet))
  assertEquals(gesendet.length, 0)
  assertEquals(d.tabelle('termin_briefings').length, 0)
})

Deno.test('frageUeberAssistent: interner Aufruf mit Dienst-Schlüssel, art mitteilung', async () => {
  const aufrufe: { url: string; init: RequestInit }[] = []
  const holen = ((url: string, init: RequestInit) => {
    aufrufe.push({ url, init })
    return Promise.resolve(new Response(JSON.stringify({ ok: true, an: 'Andreas Mayer' })))
  }) as unknown as typeof fetch
  const ok = await frageUeberAssistent('https://projekt.supabase.co', 'dienst', holen)('a', 'Wie lief der Termin?', 'Nachfrage nach Kundentermin (Akte k_lehle, 27.11.2026)')
  assertEquals(ok, true)
  assertEquals(aufrufe[0].url, 'https://projekt.supabase.co/functions/v1/telegram-gateway')
  assertEquals((aufrufe[0].init.headers as Record<string, string>).authorization, 'Bearer dienst')
  assertEquals(JSON.parse(String(aufrufe[0].init.body)), { intern: 'rueckfrage', art: 'mitteilung', mitarbeiterId: 'a', text: 'Wie lief der Termin?', von: 'Nachfrage nach Kundentermin (Akte k_lehle, 27.11.2026)' })
  const abgelehnt = await frageUeberAssistent('https://x', 'k', (() => Promise.resolve(new Response('nein', { status: 409 }))) as unknown as typeof fetch)('a', 't', 'v')
  assertEquals(abgelehnt, false)
})
