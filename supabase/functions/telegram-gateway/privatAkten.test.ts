// Private Akten im Assistenten: Der Besitzer arbeitet mit seinen privaten Kontakten und Objekten wie mit
// Akten der Holding; Kollegen — auch Geschäftsführung und Admins — finden, lesen und ändern sie über kein
// Werkzeug. Teil 1 prüft die reinen Rechte-Helfer (rechte.ts), Teil 2 ruft fuehreWerkzeugAus aus index.ts
// gegen eine Datenbank im Speicher (_shared/testDoppel.ts) auf.
//
//   npx -y deno test --allow-env --allow-read --allow-net=localhost telegram-gateway/
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { darfAkte, darfBereich, darfObjekt, darfObjekte, istFremdePrivatakte, type RechteMitarbeiter } from './rechte.ts'
import { falscheDatenbank, type FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'

// ---------------------------------------------------------------------------------------------
// Personen
// ---------------------------------------------------------------------------------------------

const ANNA = { id: 'm_a', name: 'Anna Alt', email: 'anna@firma.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }
const CARL = { id: 'm_c', name: 'Carl Kollege', email: 'carl@firma.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung', 'immobilien'] }
const BERND_GF = { id: 'm_b', name: 'Bernd Boss', email: 'bernd@firma.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] as string[] }
const ADMIN = { id: 'm_x', name: 'Xaver Admin', email: 'xaver@firma.de', rolle: 'mitarbeiter', ist_admin: true, bereiche: [] as string[] }
const OHNE_MAIL = { id: 'm_o', name: 'Otto Ohne', email: null, rolle: 'geschaeftsfuehrung', ist_admin: true, bereiche: [] as string[] }

const PRIV_ANNA = { id: 'k_priv_a', bereich: 'privat', verantwortlich_email: 'Anna@Firma.de ' }

// ---------------------------------------------------------------------------------------------
// Teil 1: reine Rechte-Helfer
// ---------------------------------------------------------------------------------------------

Deno.test('darfAkte: privater Kontakt nur für den Besitzer (ohne Groß-/Kleinschreibung)', () => {
  assert(darfAkte(ANNA, PRIV_ANNA))
  assert(!darfAkte(CARL, PRIV_ANNA))
  assert(!darfAkte(BERND_GF, PRIV_ANNA), 'Geschäftsführung sieht private Kontakte von Kollegen nicht')
  assert(!darfAkte(ADMIN, PRIV_ANNA), 'Admins sehen private Kontakte von Kollegen nicht')
  assert(!darfAkte(OHNE_MAIL, PRIV_ANNA), 'ohne eigene Adresse keine privaten Akten')
})

Deno.test('darfAkte: private Akte ohne bekannten Besitzer sieht niemand', () => {
  for (const m of [ANNA, CARL, BERND_GF, ADMIN]) {
    assert(!darfAkte(m, { id: 'k_x', bereich: 'privat' }))
    assert(!darfAkte(m, { id: 'k_x', bereich: 'privat', verantwortlich_email: '' }))
    assert(!darfAkte(m, { id: 'k_x', bereich: 'privat', verantwortlich_email: null }))
  }
  // Ein Mitarbeiter ohne Adresse passt nicht auf eine Akte ohne Adresse.
  assert(!darfAkte({ email: '' }, { id: 'k_x', bereich: 'privat', verantwortlich_email: '' }))
})

Deno.test('darfAkte: Akten der Holding wie bisher nach Bereichsrechten, Sammelakten immer', () => {
  assert(darfAkte(ANNA, { id: 'k1', bereich: 'beratung' }))
  assert(!darfAkte(ANNA, { id: 'k2', bereich: 'erben' }))
  assert(!darfAkte(ANNA, { id: 'k3', bereich: 'immobilienkunden' }))
  assert(darfAkte(CARL, { id: 'k3', bereich: 'immobilienkunden' }))
  assert(darfAkte(BERND_GF, { id: 'k2', bereich: 'erben' }))
  assert(darfAkte(ADMIN, { id: 'k2', bereich: 'erben' }))
  assert(darfAkte(ANNA, { id: 'k_eingang_ungeklaert', bereich: 'beratung' }))
  assert(darfAkte({ bereiche: [] }, { id: 'k_intern_holding', bereich: 'beratung' }))
  // verantwortlich_email spielt bei Akten der Holding keine Rolle.
  assert(!darfAkte(ANNA, { id: 'k2', bereich: 'erben', verantwortlich_email: 'anna@firma.de' }))
})

Deno.test('darfBereich: "privat" ist nie ein ganzer Bereich, auch nicht für die Geschäftsführung', () => {
  for (const m of [ANNA, CARL, BERND_GF, ADMIN]) assert(!darfBereich(m, 'privat'))
})

Deno.test('istFremdePrivatakte: nur private Akten anderer', () => {
  assert(istFremdePrivatakte(CARL, PRIV_ANNA))
  assert(istFremdePrivatakte(BERND_GF, PRIV_ANNA))
  assert(!istFremdePrivatakte(ANNA, PRIV_ANNA))
  assert(!istFremdePrivatakte(ANNA, { id: 'k2', bereich: 'erben' }), 'nicht freigegebener Bereich ist keine fremde Privatakte')
})

Deno.test('darfObjekt: Objekte der Holding mit Immobilien-Rechten, private nur der Besitzer', () => {
  const mayer = { privat_besitzer: null }
  const vonAnna = { privat_besitzer: 'ANNA@firma.de' }
  assert(!darfObjekte(ANNA))
  assert(!darfObjekt(ANNA, mayer))
  assert(darfObjekt(ANNA, vonAnna), 'eigenes privates Objekt auch ohne Immobilien-Rechte')
  assert(darfObjekt(CARL, mayer))
  assert(!darfObjekt(CARL, vonAnna))
  assert(darfObjekt(BERND_GF, mayer))
  assert(!darfObjekt(BERND_GF, vonAnna))
  assert(!darfObjekt(ADMIN, vonAnna))
  assert(!darfObjekt(OHNE_MAIL, vonAnna))
  assert(darfObjekt(CARL, { privat_besitzer: '  ' }), 'leerer Besitzer = Objekt der Holding')
})

// ---------------------------------------------------------------------------------------------
// Teil 2: Werkzeuge gegen eine Datenbank im Speicher
// ---------------------------------------------------------------------------------------------

// index.ts startet beim Laden seinen Server; für den Test genügt ein stiller Ersatz.
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = () => ({ finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: 'localhost', port: 0 } })
const { fuehreWerkzeugAus } = await import('./index.ts')
type Kontext = Parameters<typeof fuehreWerkzeugAus>[2]

const URL_PRIVAT = 'https://test.local/storage/v1/object/public/email-anhaenge/telegram/1700000000000_haaaaaaaaaaaa_geheim.pdf'

function daten(): Record<string, Zeile[]> {
  const fu = (note: string) => ({ date: '2026-01-05', note, done: false })
  return {
    mitarbeiter: [ANNA, CARL, BERND_GF].map((m) => ({ ...m, aktiv: true })),
    kunden: [
      {
        id: 'k_priv_a', bereich: 'privat', privat_art: 'erben', firma: 'Zebra Privatkontakt', ansprechpartner: 'Zora Zebra', email: 'zora@privat.de', telefon: '',
        status: 'erstkontakt', prioritaet: 'Mittel', verantwortlich: 'Anna Alt', verantwortlich_email: 'Anna@Firma.de', follow_up: fu('Geheimer Rückruf'),
        activities: [{ id: 'a1', date: '2026-01-01', text: 'Geheime Notiz', user: 'Anna Alt' }],
        dokumente: [{ id: 'd1', name: 'Geheim.pdf', typ: 'application/pdf', datum: '2026-01-01', groesse: '1 KB', url: URL_PRIVAT }],
      },
      {
        id: 'k_priv_c', bereich: 'privat', privat_art: null, firma: 'Zebra Kollegenkontakt', ansprechpartner: 'Zeno Zebra', email: 'zeno@privat.de', telefon: '',
        status: 'neu', prioritaet: 'Mittel', verantwortlich: 'Carl Kollege', verantwortlich_email: 'carl@firma.de', follow_up: fu('Carls Privatsache'), activities: [], dokumente: [],
      },
      {
        id: 'k_mayer', bereich: 'beratung', privat_art: null, firma: 'Zebra GmbH', ansprechpartner: 'Zacharias Zebra', email: 'info@zebra-gmbh.de', telefon: '',
        status: 'lead', prioritaet: 'Mittel', verantwortlich: 'Carl Kollege', verantwortlich_email: null, follow_up: fu('Angebot nachfassen'), activities: [], dokumente: [],
      },
    ],
    objekte: [
      { id: 'o_mayer', bezeichnung: 'Zebrahaus Ulm', adresse: 'Ulm', typ: 'Haus', status: 'akquise', kaufpreis: 0, verantwortlich: 'Carl Kollege', privat_besitzer: null, dokumente: {} },
      { id: 'o_priv_a', bezeichnung: 'Zebrahof Annas', adresse: 'Blaubeuren', typ: 'Hof', status: 'akquise', kaufpreis: 0, verantwortlich: 'Anna Alt', privat_besitzer: 'anna@firma.de', dokumente: {} },
      { id: 'o_priv_c', bezeichnung: 'Zebravilla Carls', adresse: 'Neu-Ulm', typ: 'Villa', status: 'akquise', kaufpreis: 0, verantwortlich: 'Carl Kollege', privat_besitzer: 'carl@firma.de', dokumente: {} },
    ],
    protokolle: [],
    rechnungen: [],
    abteilung_eintraege: [],
    todos: [],
    todo_freigaben: [],
    projekte: [],
    kalender_einstellungen: [],
    termine: [
      {
        id: 't1', titel: 'Treffen am Vormittag', ort: '', beginn: '2030-01-10T09:00:00.000Z', ende: '2030-01-10T10:00:00.000Z', ganztags: false,
        besitzer_email: 'anna@firma.de', teilnehmer: ['carl@firma.de'], kunde_id: 'k_priv_a', kunde_bereich: 'privat', kunde_name: 'Zebra Privatkontakt (Zora Zebra)',
      },
    ],
    eingegangene_emails: [
      {
        id: '11111111-1111-1111-1111-111111111111', message_id: '<geheim@privat.de>', von: 'zora@privat.de', von_name: 'Zora Zebra', betreff: 'Unser Geheimnis', mail_datum: new Date().toISOString(),
        ausschnitt: 'Geheimer Inhalt', anhaenge: [], rohdaten: {}, besitzer_email: null, postfach_id: null, relevanz: null,
        zugewiesener_kunde_id: 'k_priv_a', zugewiesener_kunde_name: 'Zebra Privatkontakt (Zora Zebra)', zugewiesener_bereich: 'privat',
      },
    ],
    gesendete_emails: [
      {
        id: '22222222-2222-2222-2222-222222222222', an: 'zora@privat.de', an_name: 'Zora Zebra', betreff: 'Antwort zum Geheimnis', text: 'Geheimer Text', gesendet_am: new Date().toISOString(),
        kunde_id: 'k_priv_a', kunde_bereich: 'privat', kunde_name: 'Zebra Privatkontakt (Zora Zebra)', besitzer_email: null, von: 'info@firma.de', quelle: 'crm', postfach_id: null,
      },
    ],
  }
}

/** Datenbank im Speicher plus die Ablage-Funktionen (list, getPublicUrl), die die Testablage nicht kennt. */
function client(db: FalscheDatenbank) {
  return {
    from: (t: string) => db.from(t),
    storage: {
      from: (eimer: string) => ({
        ...db.storage.from(eimer),
        list: () => Promise.resolve({ data: [{ name: '1700000000000_haaaaaaaaaaaa_geheim.pdf', created_at: new Date().toISOString(), metadata: { size: 1000, mimetype: 'application/pdf' } }], error: null }),
        getPublicUrl: (pfad: string) => ({ data: { publicUrl: `https://test.local/storage/v1/object/public/${eimer}/${pfad}` } }),
      }),
    },
  }
}

function kontext(db: FalscheDatenbank, m: typeof ANNA): Kontext {
  return {
    supabase: client(db) as unknown as Kontext['supabase'],
    mitarbeiter: m,
    state: { v: 3, zuege: [], aktionen: [] },
    vorherigeLoeschAnfrage: undefined,
    vorherigeMailAnfrage: undefined,
  }
}

// Ein Werkzeug mit stummgeschalteter Konsole aufrufen (Fehlermeldungen beim Inhalte-Nachschlagen ohne Netz).
// deno-lint-ignore no-explicit-any
async function rufe(db: FalscheDatenbank, m: typeof ANNA, werkzeug: string, eingabe: any): Promise<string> {
  const alt = console.error
  console.error = () => {}
  try {
    return await fuehreWerkzeugAus(werkzeug, eingabe, kontext(db, m))
  } finally {
    console.error = alt
  }
}

const FREMD = ['Zebra Privatkontakt', 'Zora', 'k_priv_a', 'Geheim']

function nichtsVonAnna(text: string, wo: string) {
  for (const w of FREMD) assert(!text.includes(w), `${wo}: „${w}" darf nicht vorkommen:\n${text}`)
}

const KEIN_KUNDE = 'Es gibt keinen Kunden mit dieser kunde_id'

Deno.test('kunden_suchen: Besitzer findet seinen privaten Kontakt, Kollegen und GF nie', async () => {
  const db = falscheDatenbank(daten())
  const anna = await rufe(db, ANNA, 'kunden_suchen', { suchbegriff: 'Zebra' })
  assertStringIncludes(anna, 'k_priv_a')
  assertStringIncludes(anna, 'k_mayer')
  assertStringIncludes(anna, 'Privat (nur für dich sichtbar, Ablauf wie Erben)')
  assertStringIncludes(anna, 'Erstkontakt', 'Status aus dem Erben-Netz')
  assert(!anna.includes('k_priv_c'), 'Carls privater Kontakt nicht bei Anna')
  for (const m of [CARL, BERND_GF]) {
    const text = await rufe(db, m, 'kunden_suchen', { suchbegriff: 'Zebra' })
    nichtsVonAnna(text, `kunden_suchen als ${m.name}`)
    assertStringIncludes(text, 'k_mayer')
  }
  assertStringIncludes(await rufe(db, BERND_GF, 'kunden_suchen', { suchbegriff: 'Zora' }), 'Keine Treffer')
})

Deno.test('kundenakte_lesen / dokument_inhalt: fremde Privatakte gibt es nicht, ohne Bereichsnennung', async () => {
  const db = falscheDatenbank(daten())
  for (const m of [CARL, BERND_GF]) {
    for (const [werkzeug, eingabe] of [
      ['kundenakte_lesen', { kunde_id: 'k_priv_a' }],
      ['dokument_inhalt', { kunde_id: 'k_priv_a', dokument_id: 'd1' }],
      ['notiz_speichern', { kunde_id: 'k_priv_a', text: 'Hallo' }],
      ['aufgabe_setzen', { kunde_id: 'k_priv_a', titel: 'Hallo' }],
      ['kunde_aendern', { kunde_id: 'k_priv_a', telefon: '123' }],
      ['gespraechsprotokoll_anlegen', { kunde_id: 'k_priv_a', betreff: 'x', text: 'y' }],
      ['dateien_ablegen', { kunde_id: 'k_priv_a', dateien: [{ pfad: 'telegram/1700000000000_haaaaaaaaaaaa_geheim.pdf' }] }],
      ['dokument_erstellen', { kunde_id: 'k_priv_a', titel: 'Merkblatt', inhalt: 'Text' }],
      ['rechnung_erfassen', { kunde_id: 'k_priv_a', nummer: 'R-1', datum: '2026-01-01', betrag_brutto: 10, status: 'Versendet' }],
    ] as const) {
      const text = await rufe(db, m, werkzeug, eingabe)
      assertStringIncludes(text, KEIN_KUNDE, `${werkzeug} als ${m.name}`)
      assert(!text.includes('Privat'), `${werkzeug} als ${m.name} nennt den Bereich Privat: ${text}`)
      nichtsVonAnna(text, `${werkzeug} als ${m.name}`)
    }
  }
  // Löschen darf nur die Geschäftsführung — eine fremde Privatakte aber auch sie nicht.
  assertStringIncludes(await rufe(db, BERND_GF, 'kunde_loeschen', { kunde_id: 'k_priv_a' }), KEIN_KUNDE)
  // Nichts wurde geschrieben.
  assertEquals(daten().kunden[0], db.tabelle('kunden').find((k) => k.id === 'k_priv_a'))
  assertEquals(db.tabelle('protokolle').length, 0)
  assertEquals(db.tabelle('rechnungen').length, 0)
})

Deno.test('kundenakte_lesen, Notiz, Aufgabe, Status: Besitzer arbeitet mit seiner Privatakte wie mit jeder Akte', async () => {
  const db = falscheDatenbank(daten())
  const akte = await rufe(db, ANNA, 'kundenakte_lesen', { kunde_id: 'k_priv_a' })
  assertStringIncludes(akte, 'Zebra Privatkontakt')
  assertStringIncludes(akte, 'Geheime Notiz')
  assertStringIncludes(akte, 'Status: erstkontakt (Erstkontakt)')

  assertStringIncludes(await rufe(db, ANNA, 'notiz_speichern', { kunde_id: 'k_priv_a', text: 'Neue Notiz' }), 'gespeichert')
  assertStringIncludes(await rufe(db, ANNA, 'aufgabe_setzen', { kunde_id: 'k_priv_a', titel: 'Anrufen', faellig_am: '2026-12-01' }), 'gesetzt')
  // Status aus dem Netz der privat_art (Erben) …
  assertStringIncludes(await rufe(db, ANNA, 'kunde_aendern', { kunde_id: 'k_priv_a', status: 'bedarfsanalyse' }), 'Bedarfsanalyse')
  // … aber nicht aus einem anderen Netz.
  assertStringIncludes(await rufe(db, ANNA, 'kunde_aendern', { kunde_id: 'k_priv_a', status: 'lead' }), 'ungültiger Status für erben')
  // Zuständigkeit bleibt beim Besitzer.
  assertStringIncludes(await rufe(db, ANNA, 'kunde_aendern', { kunde_id: 'k_priv_a', verantwortlich: 'Carl' }), 'Nicht geändert')
  const zeile = db.tabelle('kunden').find((k) => k.id === 'k_priv_a')!
  assertEquals(zeile.status, 'bedarfsanalyse')
  assertEquals(zeile.verantwortlich, 'Anna Alt')
  assertEquals((zeile.follow_up as { note: string }).note, 'Anrufen')
  assertEquals((zeile.activities as { text: string }[]).some((a) => a.text === 'Neue Notiz'), true)
  // Ohne privat_art gilt das schlichte Privat-Netz (Carls Kontakt, von Carl geändert).
  assertStringIncludes(await rufe(db, CARL, 'kunde_aendern', { kunde_id: 'k_priv_c', status: 'in_kontakt' }), 'In Kontakt')
  assertStringIncludes(await rufe(db, CARL, 'kunde_aendern', { kunde_id: 'k_priv_c', status: 'bedarfsanalyse' }), 'ungültiger Status für privat')
})

Deno.test('kunde_anlegen privat: Besitzer, Name und Anfangsstatus des gewählten Ablaufs', async () => {
  const db = falscheDatenbank(daten())
  const mitArt = await rufe(db, CARL, 'kunde_anlegen', { bereich: 'privat', privat_art: 'akademie', name: 'Yak Yoga' })
  assertStringIncludes(mitArt, 'Angelegt: Yak Yoga')
  const yak = db.tabelle('kunden').find((k) => k.firma === 'Yak Yoga')!
  assertEquals([yak.bereich, yak.privat_art, yak.verantwortlich_email, yak.verantwortlich, yak.status], ['privat', 'akademie', 'carl@firma.de', 'Carl Kollege', 'interessent'])

  await rufe(db, CARL, 'kunde_anlegen', { bereich: 'privat', name: 'Xylo Privat' })
  const xylo = db.tabelle('kunden').find((k) => k.firma === 'Xylo Privat')!
  assertEquals([xylo.privat_art, xylo.status], [null, 'neu'])

  // Ungültige Art wird abgelehnt.
  assertStringIncludes(await rufe(db, CARL, 'kunde_anlegen', { bereich: 'privat', privat_art: 'privat', name: 'Falsch' }), 'ungültige privat_art')
  // Dublette im eigenen privaten Bereich wird erkannt …
  assertStringIncludes(await rufe(db, CARL, 'kunde_anlegen', { bereich: 'beratung', name: 'Yak Yoga' }), 'Es gibt bereits')
  // … ein privater Kontakt eines Kollegen zählt dagegen nicht und wird nicht erwähnt.
  const neu = await rufe(db, CARL, 'kunde_anlegen', { bereich: 'beratung', name: 'Zebra Privatkontakt' })
  assertStringIncludes(neu, 'Angelegt: Zebra Privatkontakt, Bereich Unternehmensberatung')
})

Deno.test('in_oeffentlich_holen: Ziel ist ohne Angabe die privat_art, privat_art wird geleert, Status bleibt', async () => {
  const db = falscheDatenbank(daten())
  // Ein Kollege kann Annas Kontakt nicht holen.
  assertStringIncludes(await rufe(db, CARL, 'in_oeffentlich_holen', { art: 'kontakt', kennung: 'k_priv_a', bereich: 'beratung' }), 'gibt es bei diesem Mitarbeiter nicht')
  // Anna ohne Erben-Recht: Ziel Erben ist für sie nicht freigegeben.
  assertStringIncludes(await rufe(db, ANNA, 'in_oeffentlich_holen', { art: 'kontakt', kennung: 'k_priv_a' }), 'Nicht freigegeben')
  const annaMitErben = { ...ANNA, bereiche: ['beratung', 'erben'] }
  assertStringIncludes(await rufe(db, annaMitErben, 'in_oeffentlich_holen', { art: 'kontakt', kennung: 'k_priv_a' }), 'Bereich Erben')
  const zeile = db.tabelle('kunden').find((k) => k.id === 'k_priv_a')!
  assertEquals([zeile.bereich, zeile.privat_art, zeile.verantwortlich_email, zeile.status], ['erben', null, null, 'erstkontakt'])
})

Deno.test('firmenueberblick / aufgaben_uebersicht: private Kontakte und Objekte nur beim Besitzer', async () => {
  const db = falscheDatenbank(daten())
  for (const m of [CARL, BERND_GF]) {
    for (const werkzeug of ['firmenueberblick', 'aufgaben_uebersicht']) {
      const text = await rufe(db, m, werkzeug, {})
      nichtsVonAnna(text, `${werkzeug} als ${m.name}`)
      assert(!text.includes('Zebrahof'), `${werkzeug} als ${m.name} zeigt Annas privates Objekt`)
    }
  }
  const ueberblick = await rufe(db, ANNA, 'firmenueberblick', {})
  assertStringIncludes(ueberblick, 'Zebra Privatkontakt')
  assertStringIncludes(ueberblick, 'Zebrahof Annas')
  assert(!ueberblick.includes('Zebrahaus Ulm'), 'Anna hat keine Immobilien-Rechte')
  assert(!ueberblick.includes('Carls Privatsache') && !ueberblick.includes('Zebra Kollegenkontakt'))
  const aufgaben = await rufe(db, ANNA, 'aufgaben_uebersicht', { mitarbeiter: 'ich' })
  assertStringIncludes(aufgaben, 'Geheimer Rückruf')
  assert(!aufgaben.includes('Carls Privatsache'))
})

Deno.test('objekte_suchen / objektakte_lesen / dokument_inhalt: private Objekte nur beim Besitzer', async () => {
  const db = falscheDatenbank(daten())
  const anna = await rufe(db, ANNA, 'objekte_suchen', { suchbegriff: 'Zebra' })
  assertStringIncludes(anna, 'o_priv_a')
  assert(!anna.includes('o_mayer') && !anna.includes('o_priv_c'))
  const gf = await rufe(db, BERND_GF, 'objekte_suchen', { suchbegriff: 'Zebra' })
  assertStringIncludes(gf, 'o_mayer')
  assert(!gf.includes('o_priv_a') && !gf.includes('o_priv_c'))
  for (const m of [CARL, BERND_GF]) {
    assertStringIncludes(await rufe(db, m, 'objektakte_lesen', { objekt_id: 'o_priv_a' }), 'Es gibt kein Objekt')
    assertStringIncludes(await rufe(db, m, 'dokument_inhalt', { objekt_id: 'o_priv_a', dokument_id: 'x' }), 'Es gibt kein Objekt')
  }
  assertStringIncludes(await rufe(db, ANNA, 'objektakte_lesen', { objekt_id: 'o_priv_a' }), 'PRIVATES OBJEKT')
  assertStringIncludes(await rufe(db, ANNA, 'objektakte_lesen', { objekt_id: 'o_mayer' }), 'Nicht freigegeben')
})

Deno.test('Mails, Termine, Dateien: nichts von Annas Privatakte bei Kollegen', async () => {
  const db = falscheDatenbank(daten())
  for (const m of [CARL, BERND_GF]) {
    const postfach = await rufe(db, m, 'gemeinsames_postfach', {})
    nichtsVonAnna(postfach, `gemeinsames_postfach als ${m.name}`)
    for (const [werkzeug, eingabe] of [
      ['gemeinsames_postfach', { mail_id: '11111111-1111-1111-1111-111111111111' }],
      ['mail_lesen', { mail_id: '11111111-1111-1111-1111-111111111111' }],
      ['gesendete_mails', { mail_id: '22222222-2222-2222-2222-222222222222' }],
      ['gesendete_mails', { kunde_id: 'k_priv_a' }],
      ['gesendete_mails', {}],
      ['mail_zuordnen', { mail_id: '11111111-1111-1111-1111-111111111111', kunde_id: 'k_mayer' }],
      ['mail_zuordnen', { mail_id: 'x', kunde_id: 'k_priv_a' }],
      ['termine_zeigen', { von: '2030-01-09', bis: '2030-01-11' }],
      ['termin_anlegen', { titel: 'x', beginn: '2030-01-12T10:00', kunde_id: 'k_priv_a' }],
      ['datei_lesen', { pfad: 'telegram/1700000000000_haaaaaaaaaaaa_geheim.pdf' }],
    ] as const) {
      const text = await rufe(db, m, werkzeug, eingabe)
      nichtsVonAnna(text, `${werkzeug} als ${m.name}`)
      assert(!/Bereich Privat/.test(text), `${werkzeug} als ${m.name} nennt den Bereich Privat: ${text}`)
    }
  }
  // Carl ist beim Termin dabei, sieht ihn — aber ohne Annas Kontakt.
  assertStringIncludes(await rufe(db, CARL, 'termine_zeigen', { von: '2030-01-09', bis: '2030-01-11' }), 'Treffen am Vormittag')
  // Anna selbst sieht alles.
  assertStringIncludes(await rufe(db, ANNA, 'gemeinsames_postfach', {}), 'Unser Geheimnis')
  assertStringIncludes(await rufe(db, ANNA, 'mail_lesen', { mail_id: '11111111-1111-1111-1111-111111111111' }), 'Geheimer Inhalt')
  assertStringIncludes(await rufe(db, ANNA, 'gesendete_mails', { kunde_id: 'k_priv_a' }), 'Antwort zum Geheimnis')
  assertStringIncludes(await rufe(db, ANNA, 'termine_zeigen', { von: '2030-01-09', bis: '2030-01-11' }), 'Zebra Privatkontakt')
  assert(!(await rufe(db, ANNA, 'datei_lesen', { pfad: 'telegram/1700000000000_haaaaaaaaaaaa_geheim.pdf' })).includes('gibt es in der Ablage nicht'))
})

Deno.test('Pflege-Werkzeuge: private Akten weder verschieben noch zusammenführen; fremde gibt es nicht', async () => {
  const db = falscheDatenbank(daten())
  assertStringIncludes(await rufe(db, BERND_GF, 'kunde_bereich_wechseln', { kunde_id: 'k_priv_a', nach_bereich: 'erben' }), KEIN_KUNDE)
  assertStringIncludes(await rufe(db, BERND_GF, 'kunden_zusammenfuehren', { behalte_id: 'k_mayer', entferne_id: 'k_priv_a' }), KEIN_KUNDE)
  const gfMitPrivat = { ...BERND_GF, email: 'anna@firma.de' }
  assertStringIncludes(await rufe(db, gfMitPrivat, 'kunde_bereich_wechseln', { kunde_id: 'k_priv_a', nach_bereich: 'erben' }), 'in_oeffentlich_holen')
  assertEquals(db.tabelle('kunden').find((k) => k.id === 'k_priv_a')!.bereich, 'privat')
})
