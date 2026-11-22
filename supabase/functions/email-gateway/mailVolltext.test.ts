import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  _setzeMinutenZustandZurueck,
  besserer,
  datenbankSpeicher,
  istAbgeschnitten,
  type Kandidat,
  ladeVolltexteNach,
  oeffneImapQuelle,
  textAusWeiterleitung,
  type TextQuelle,
  type Vermerk,
  volltextMinutenSchritt,
  type VolltextSpeicher,
  VORAUSWAHL_MUSTER,
} from './mailVolltext.ts'
import { falscheDatenbank } from '../_shared/testDoppel.ts'

const LANG = 'Sehr geehrte Damen und Herren, '.repeat(40) // > 500 Zeichen
const ABGESCHNITTEN = LANG.trim().slice(0, 500)
const SIGNATUR = '\n\nMit freundlichen Grüßen\nErika Muster\nTel. 0731 123456\nMusterstraße 1, 89073 Ulm'

// ---------- reine Hilfen ----------

Deno.test('istAbgeschnitten: genau 499/500 Zeichen (JavaScript-Zählung), sonst nicht', () => {
  assert(istAbgeschnitten('x'.repeat(500)))
  assert(istAbgeschnitten('x'.repeat(499)))
  assert(!istAbgeschnitten('x'.repeat(498)))
  assert(!istAbgeschnitten('x'.repeat(501)))
  assert(!istAbgeschnitten(null))
  // Emoji zählt in JavaScript doppelt: 498 Zeichen + 1 Emoji = 500
  assert(istAbgeschnitten('x'.repeat(498) + '😀'))
  assertEquals(VORAUSWAHL_MUSTER.length, 471)
})

Deno.test('textAusWeiterleitung: plain vor reply_plain vor html', () => {
  assertEquals(textAusWeiterleitung({ plain: '  Hallo  ', reply: 'R', html: '<p>H</p>' }), 'Hallo')
  assertEquals(textAusWeiterleitung({ plain: '', reply: 'Antwort', html: '<p>H</p>' }), 'Antwort')
  assertEquals(textAusWeiterleitung({ html: '<style>x{}</style><p>Zeile 1</p><p>Zeile&nbsp;2</p>' }), 'Zeile 1\n Zeile 2')
  assertEquals(textAusWeiterleitung(null), '')
})

Deno.test('besserer: nur wenn länger, höchstens 20 000 Zeichen', () => {
  assertEquals(besserer('abc', 'ab'), null)
  assertEquals(besserer('abc', '  abc  '), null)
  assertEquals(besserer('abc', 'abcdef'), 'abcdef')
  assertEquals(besserer('a', 'x'.repeat(30000))!.length, 20000)
})

// ---------- Lauf mit nachgebauter Datenbank und nachgebautem Mail-Server ----------

type Zeile = Kandidat & { erstellt: string; roh: { plain?: string; reply?: string; html?: string }; volltext?: Vermerk }

function speicherAus(zeilen: Zeile[]): VolltextSpeicher & { schreibvorgaenge: number } {
  const s = {
    schreibvorgaenge: 0,
    kandidaten(art: string, grenze: number, ab = 0) {
      const offen = zeilen.filter((z) => z.art === art && !z.volltext && z.ausschnitt.length >= 470 && z.ausschnitt.length <= 500).sort((a, b) => a.erstellt.localeCompare(b.erstellt))
      return Promise.resolve(offen.slice(ab, ab + grenze).map((z) => ({ id: z.id, art: z.art, message_id: z.message_id, betreff: z.betreff, ausschnitt: z.ausschnitt, uid: z.uid })))
    },
    offen(art: string) {
      return Promise.resolve(zeilen.filter((z) => z.art === art && !z.volltext && z.ausschnitt.length >= 470 && z.ausschnitt.length <= 500).length)
    },
    weiterleitung(id: string) {
      return Promise.resolve(zeilen.find((z) => z.id === id)?.roh ?? null)
    },
    vermerke(id: string, vermerk: Vermerk, ausschnitt?: string) {
      const z = zeilen.find((x) => x.id === id)!
      s.schreibvorgaenge++
      z.volltext = vermerk
      if (ausschnitt !== undefined) z.ausschnitt = ausschnitt
      return Promise.resolve()
    },
  }
  return s as VolltextSpeicher & { schreibvorgaenge: number }
}

function quelleAus(texte: Record<string, string | null>, opts: { kaputtBei?: string } = {}): { quelle: () => Promise<TextQuelle>; geoeffnet: () => number; geholt: string[] } {
  let geoeffnet = 0
  const geholt: string[] = []
  let nutzbar = true
  return {
    geoeffnet: () => geoeffnet,
    geholt,
    quelle: () => {
      geoeffnet++
      return Promise.resolve({
        nutzbar: () => nutzbar,
        hole(k: Kandidat) {
          geholt.push(k.id)
          if (opts.kaputtBei === k.id) {
            nutzbar = false
            return Promise.reject(new Error('Verbindung getrennt'))
          }
          const t = texte[k.message_id]
          return Promise.resolve(t === null || t === undefined ? { fehlt: true as const } : { text: t })
        },
        schliesse: () => Promise.resolve(),
      })
    },
  }
}

function bestand(): Zeile[] {
  return [
    { id: 'w1', art: 'weiterleitung', message_id: '<w1@x>', betreff: 'Anfrage', ausschnitt: ABGESCHNITTEN, uid: null, erstellt: '2026-11-01', roh: { plain: LANG + SIGNATUR } },
    { id: 'w2', art: 'weiterleitung', message_id: '<w2@x>', betreff: 'Kurz', ausschnitt: 'k'.repeat(480), uid: null, erstellt: '2026-11-02', roh: { plain: 'k'.repeat(480) } },
    {
      id: 'w3',
      art: 'weiterleitung',
      message_id: '<w3@x>',
      betreff: 'Nur HTML',
      ausschnitt: 'h'.repeat(500),
      uid: null,
      erstellt: '2026-11-03',
      roh: { html: `<p>${'h'.repeat(600)}</p><p>Gruß</p>` },
    },
    { id: 'm1', art: 'migration', message_id: '<m1@x>', betreff: 'Altmail', ausschnitt: ABGESCHNITTEN, uid: 101, erstellt: '2026-10-23', roh: {} },
    { id: 'm2', art: 'migration', message_id: '<m2@x>', betreff: 'Gelöscht', ausschnitt: ABGESCHNITTEN, uid: 102, erstellt: '2026-10-24', roh: {} },
    { id: 'm3', art: 'migration', message_id: '<m3@x>', betreff: 'Kurz', ausschnitt: 'Danke!', uid: 103, erstellt: '2026-10-25', roh: {} },
  ]
}

Deno.test('Trockenlauf: zählt, lädt eine Probe nach, schreibt nichts', async () => {
  const zeilen = bestand()
  const speicher = speicherAus(zeilen)
  const q = quelleAus({ '<m1@x>': LANG + SIGNATUR, '<m2@x>': null })
  const r = await ladeVolltexteNach(null, { trockenlauf: true, speicher, quelle: q.quelle })
  assertEquals(speicher.schreibvorgaenge, 0)
  assertEquals(r.abgeschnitten, { migration: 2, weiterleitung: 2 })
  assertEquals(r.vollstaendig, { migration: 0, weiterleitung: 1 }) // m3 ist zu kurz für die Vorauswahl
  assertEquals(r.probe!.map((p) => `${p.id}:${p.ergebnis}`), ['w1:ergaenzt', 'w3:ergaenzt', 'm1:ergaenzt', 'm2:nicht_gefunden'])
  assertMatch(r.probe![0].ende!, /89073 Ulm$/)
  assertEquals(r.fehler, [])
  assertEquals(zeilen.find((z) => z.id === 'w1')!.ausschnitt, ABGESCHNITTEN)
})

Deno.test('Lauf: ergänzt gekürzte Texte, vermerkt jede Mail einmal, zweiter Lauf hat nichts mehr zu tun', async () => {
  const zeilen = bestand()
  const speicher = speicherAus(zeilen)
  const q = quelleAus({ '<m1@x>': LANG + SIGNATUR, '<m2@x>': null })
  const r = await ladeVolltexteNach(null, { speicher, quelle: q.quelle })
  assertEquals(r.fehler, [])
  assertEquals([r.ergaenzt, r.unveraendert, r.nichtGefunden, r.offen], [3, 1, 1, 0])
  const w1 = zeilen.find((z) => z.id === 'w1')!
  assertMatch(w1.ausschnitt, /Tel\. 0731 123456/)
  assertEquals(w1.volltext!.ergebnis, 'ergaenzt')
  assertEquals(w1.volltext!.vorher, 500)
  assertEquals(zeilen.find((z) => z.id === 'w2')!.volltext!.ergebnis, 'vollstaendig')
  assertEquals(zeilen.find((z) => z.id === 'w2')!.ausschnitt, 'k'.repeat(480))
  assertMatch(zeilen.find((z) => z.id === 'w3')!.ausschnitt, /Gruß$/)
  assertMatch(zeilen.find((z) => z.id === 'm1')!.ausschnitt, /89073 Ulm$/)
  assertEquals(zeilen.find((z) => z.id === 'm2')!.volltext!.ergebnis, 'nicht_gefunden')
  assertEquals(zeilen.find((z) => z.id === 'm2')!.ausschnitt, ABGESCHNITTEN)
  assertEquals(zeilen.find((z) => z.id === 'm3')!.volltext, undefined) // nie Kandidat
  assertEquals(q.geoeffnet(), 1)

  const vorher = speicher.schreibvorgaenge
  const r2 = await ladeVolltexteNach(null, { speicher, quelle: q.quelle })
  assertEquals([r2.ergaenzt, r2.unveraendert, r2.nichtGefunden, r2.offen], [0, 0, 0, 0])
  assertEquals(speicher.schreibvorgaenge, vorher)
  assertEquals(q.geoeffnet(), 1) // ohne offene Umzugs-Mail kein Mail-Server
})

Deno.test('Lauf: portionsweise (Grenzen je Art) und fortsetzbar', async () => {
  const zeilen = bestand()
  const speicher = speicherAus(zeilen)
  const q = quelleAus({ '<m1@x>': LANG + SIGNATUR, '<m2@x>': null })
  const r1 = await ladeVolltexteNach(null, { speicher, quelle: q.quelle, weiterleitungen: 1, migrationen: 1 })
  assertEquals(r1.ergaenzt, 2)
  assertEquals(r1.offen, 3)
  const r2 = await ladeVolltexteNach(null, { speicher, quelle: q.quelle, weiterleitungen: 1, migrationen: 1 })
  assertEquals(r2.offen, 1)
  const r3 = await ladeVolltexteNach(null, { speicher, quelle: q.quelle, weiterleitungen: 1, migrationen: 1 })
  assertEquals(r3.offen, 0)
  assertEquals(q.geholt, ['m1', 'm2'])
})

Deno.test('Lauf: Verbindung weg → nichts vermerkt, Abbruch, nächster Lauf macht weiter', async () => {
  const zeilen = bestand()
  const speicher = speicherAus(zeilen)
  const kaputt = quelleAus({ '<m1@x>': LANG }, { kaputtBei: 'm1' })
  const r = await ladeVolltexteNach(null, { speicher, quelle: kaputt.quelle })
  assertEquals(r.fehler.length, 1)
  assertMatch(r.fehler[0], /^Mail-Server: Verbindung getrennt/)
  assertEquals(kaputt.geholt, ['m1']) // m2 nicht mehr versucht
  assertEquals(zeilen.find((z) => z.id === 'm1')!.volltext, undefined)
  assertEquals(r.offen, 2)
  const r2 = await ladeVolltexteNach(null, { speicher, quelle: quelleAus({ '<m1@x>': LANG, '<m2@x>': LANG }).quelle })
  assertEquals(r2.ergaenzt, 2)
  assertEquals(r2.offen, 0)
})

Deno.test('Lauf: Mail-Server nicht erreichbar → Weiterleitungs-Mails trotzdem erledigt', async () => {
  const zeilen = bestand()
  const speicher = speicherAus(zeilen)
  const r = await ladeVolltexteNach(null, { speicher, quelle: () => Promise.reject(new Error('Der Mail-Server hat nach 20 Sekunden nicht geantwortet.')) })
  assertEquals(r.ergaenzt, 2) // w1, w3
  assertEquals(r.fehler.length, 1)
  assertMatch(r.fehler[0], /^Mail-Server:/)
  assertEquals(zeilen.filter((z) => z.art === 'migration' && z.volltext).length, 0)
})

Deno.test('Minutentakt: nach getaner Arbeit 30 Minuten Ruhe, nach Server-Fehler 10 Minuten', async () => {
  _setzeMinutenZustandZurueck()
  const zeilen = bestand()
  const speicher = speicherAus(zeilen)
  const r = await volltextMinutenSchritt(null, { speicher, quelle: quelleAus({ '<m1@x>': LANG, '<m2@x>': null }).quelle })
  assertEquals(r!.offen, 0)
  assertEquals(await volltextMinutenSchritt(null, { speicher }), null) // ruht
  _setzeMinutenZustandZurueck()
  const r2 = await volltextMinutenSchritt(null, { speicher: speicherAus(bestand()), quelle: () => Promise.reject(new Error('nicht geantwortet')) })
  assert(r2!.fehler[0].startsWith('Mail-Server:'))
  assertEquals(await volltextMinutenSchritt(null, { speicher: speicherAus(bestand()) }), null)
  _setzeMinutenZustandZurueck()
})

// ---------- echte Text-Quelle über einen nachgebauten IMAP-Server ----------

type FalscheMail = { uid: number; messageId?: string; text?: string; html?: string }

function falscherServer(mails: FalscheMail[]) {
  const protokoll: string[] = []
  // deno-lint-ignore no-explicit-any
  const struktur = (m: FalscheMail): any =>
    m.text && m.html
      ? { type: 'multipart/alternative', childNodes: [{ type: 'text/plain', part: '1', parameters: { charset: 'utf-8' } }, { type: 'text/html', part: '2' }] }
      : m.text
      ? { type: 'text/plain', part: '1' }
      : { type: 'text/html', part: '1' }
  const client = {
    usable: true,
    on: () => {},
    connect: () => Promise.resolve(),
    getMailboxLock: (pfad: string, o: { readOnly?: boolean }) => {
      protokoll.push(`lock ${pfad} readOnly=${o?.readOnly}`)
      return Promise.resolve({ release: () => protokoll.push('release') })
    },
    fetchOne: (uid: string) => {
      const m = mails.find((x) => String(x.uid) === uid)
      protokoll.push(`fetchOne ${uid}`)
      return Promise.resolve(m ? { uid: m.uid, envelope: { messageId: m.messageId }, bodyStructure: struktur(m) } : false)
    },
    search: (q: { header: Record<string, string> }) => {
      protokoll.push(`search ${q.header['message-id']}`)
      return Promise.resolve(mails.filter((m) => m.messageId?.toLowerCase().includes(q.header['message-id'].toLowerCase())).map((m) => m.uid))
    },
    download: (uid: string, part: string) => {
      const m = mails.find((x) => String(x.uid) === uid)!
      const inhalt = m.text && m.html ? (part === '1' ? m.text : m.html) : (m.text ?? m.html ?? '')
      protokoll.push(`download ${uid}/${part}`)
      return Promise.resolve({
        meta: { charset: 'utf-8' },
        content: (async function* () {
          yield new TextEncoder().encode(inhalt)
        })(),
      })
    },
    logout: () => {
      protokoll.push('logout')
      return Promise.resolve()
    },
  }
  return { client, protokoll }
}

function adminMitPostfach() {
  return falscheDatenbank({
    postfaecher: [{
      id: 'standard',
      adresse: 'info@amayer-holding.com',
      besitzer_email: null,
      imap_host: 'imap.test',
      imap_port: 993,
      benutzer: 'info@amayer-holding.com',
      geheimnis_name: 'TEST_POSTFACH_PASSWORT',
      aktiv: true,
    }],
  })
}

Deno.test('IMAP-Quelle: Nummer passt → Text; Nummer vergeben an andere Mail → Suche über Message-ID; fehlt → nicht gefunden; nur lesend', async () => {
  Deno.env.set('TEST_POSTFACH_PASSWORT', 'geheim-123')
  try {
    const { client, protokoll } = falscherServer([
      { uid: 101, messageId: '<m1@x>', text: 'Voller Text\nTel. 0731 1', html: '<p>egal</p>' },
      { uid: 102, messageId: '<andere@x>', text: 'Falsche Mail' },
      { uid: 250, messageId: '<M2@x>', html: '<div>Verschoben</div><div>Gruß</div>' },
    ])
    let gesehenesPasswort = ''
    const quelle = await oeffneImapQuelle(adminMitPostfach(), (_p, passwort) => {
      gesehenesPasswort = passwort
      return client
    })
    assertEquals(gesehenesPasswort, 'geheim-123')
    const k = (id: string, mid: string, uid: number | null): Kandidat => ({ id, art: 'migration', message_id: mid, betreff: '', ausschnitt: '', uid })
    assertEquals(await quelle.hole(k('m1', '<m1@x>', 101)), { text: 'Voller Text\nTel. 0731 1' })
    assertEquals(await quelle.hole(k('m2', '<m2@x>', 102)), { text: 'Verschoben\n Gruß' })
    assertEquals(await quelle.hole(k('m4', '<weg@x>', 104)), { fehlt: true })
    await quelle.schliesse()
    assertEquals(protokoll[0], 'lock INBOX readOnly=true')
    assert(protokoll.includes('search <m2@x>'))
    assert(!protokoll.some((z) => z.startsWith('download 102'))) // falsche Mail nie geladen
    assertEquals(protokoll.slice(-2), ['release', 'logout'])
  } finally {
    Deno.env.delete('TEST_POSTFACH_PASSWORT')
  }
})

Deno.test('IMAP-Quelle: ohne hinterlegtes Passwort klare Meldung ohne Geheimnis', async () => {
  let fehler = ''
  try {
    await oeffneImapQuelle(adminMitPostfach(), () => falscherServer([]).client)
  } catch (err) {
    fehler = (err as Error).message
  }
  assertMatch(fehler, /kein Passwort hinterlegt/)
})

// ---------- Datenbank-Abfragen (Filter wie gedacht) ----------

Deno.test('datenbankSpeicher: Filter auf gemeinsames Postfach, ohne Vermerk, Vorauswahl, Art; Vermerk führt Rohdaten zusammen', async () => {
  const aufrufe: string[] = []
  // Kleiner Aufzeichner der Abfragekette (nur was datenbankSpeicher benutzt).
  // deno-lint-ignore no-explicit-any
  const kette = (tabelle: string, antwort: () => any): any => {
    const k: Record<string, unknown> = {}
    for (const m of ['select', 'is', 'like', 'not', 'eq', 'lt', 'order', 'range', 'update']) {
      k[m] = (...a: unknown[]) => {
        aufrufe.push(`${tabelle}.${m}(${a.map((x) => (typeof x === 'string' && x.length > 60 ? `${x.slice(0, 10)}…(${x.length})` : JSON.stringify(x))).join(',')})`)
        return k
      }
    }
    k.maybeSingle = () => Promise.resolve(antwort())
    k.then = (ok: (v: unknown) => unknown, nein: (e: unknown) => unknown) => Promise.resolve(antwort()).then(ok, nein)
    return k
  }
  const admin = {
    from: (t: string) =>
      kette(
        t,
        () => ({
          data: aufrufe.some((a) => a.includes('update'))
            ? null
            : aufrufe.some((a) => a.includes('select("rohdaten")'))
            ? { rohdaten: { quelle: 'imap-migration', uid: 7 } }
            : [{ id: 'a', message_id: '<a@x>', betreff: 'B', ausschnitt: 'x', uid: '7' }],
          error: null,
          count: 3,
        }),
      ),
  }
  const s = datenbankSpeicher(admin, () => Date.parse('2026-11-22T12:00:00Z'))
  const liste = await s.kandidaten('migration', 10, 20)
  assertEquals(liste, [{ id: 'a', art: 'migration', message_id: '<a@x>', betreff: 'B', ausschnitt: 'x', uid: 7 }])
  assert(aufrufe.includes('eingegangene_emails.is("besitzer_email",null)'))
  assert(aufrufe.includes('eingegangene_emails.is("rohdaten->volltext",null)'))
  assert(aufrufe.includes('eingegangene_emails.like("ausschnitt",__________…(471))'))
  assert(aufrufe.includes('eingegangene_emails.not("ausschnitt","like",__________…(502))'))
  assert(aufrufe.includes('eingegangene_emails.eq("rohdaten->>quelle","imap-migration")'))
  assert(aufrufe.includes('eingegangene_emails.range(20,29)'))
  aufrufe.length = 0
  await s.kandidaten('weiterleitung', 5)
  assert(aufrufe.includes('eingegangene_emails.is("rohdaten->>quelle",null)'))
  assert(aufrufe.includes('eingegangene_emails.lt("erstellt_am","2026-11-22T11:50:00.000Z")'))
  assertEquals(await s.offen('migration'), 3)
  aufrufe.length = 0
  await s.vermerke('a', { am: '2026-11-22T12:00:00Z', ergebnis: 'ergaenzt', vorher: 500, nachher: 900 }, 'neuer Text')
  const update = aufrufe.find((a) => a.includes('.update('))!
  assertMatch(update, /"quelle":"imap-migration","uid":7,"volltext":\{"am":"2026-11-22T12:00:00Z","ergebnis":"ergaenzt","vorher":500,"nachher":900\}/)
  assertMatch(update, /"ausschnitt":"neuer Text"/)
  assert(aufrufe.at(-1) === 'eingegangene_emails.is("rohdaten->volltext",null)')
})
