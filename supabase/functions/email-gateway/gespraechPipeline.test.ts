import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { falscheDatenbank, type FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { betrag, isoDatum, LISTEN_GRENZE, normalisiereAnalyse, uhrzeit } from '../_shared/gespraechSchema.ts'
import { AbschriftFehler } from '../_shared/transkription.ts'
import {
  abschriftHinweis,
  arbeiteGespraech,
  GESPRAECH_BUCKET,
  gespraechAktion,
  type GespraechHilfen,
  gespraechMinutentakt,
  type KiFunktion,
  loescheAbgelaufeneAudios,
  naechsteArbeit,
  SEGMENT_MAX_VERSUCHE,
  transkribiereSegment,
  wendeWechselAn,
  zerlegeInSaetze,
} from './gespraechPipeline.ts'

const HASAN = { email: 'hasan@mayer.de', name: 'Hasan Yilmaz' }
const QUIRIN = { email: 'quirin@mayer.de', name: 'Quirin Lang' }
const FREMD = { email: 'fremd@mayer.de', name: 'Fremd' }
const START = Date.parse('2026-11-22T10:00:00Z')

// deno-lint-ignore no-explicit-any
type Any = any

/** Testdatenbank mit Team, einer Akte, einem Termin — plus signierte Adressen im Speicher-Ersatz. */
function welt(extra: Record<string, Zeile[]> = {}) {
  const db = falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', name: HASAN.name, email: HASAN.email, aktiv: true, telegram_chat_id: 111 },
      { id: 'm2', name: QUIRIN.name, email: QUIRIN.email, aktiv: true, telegram_chat_id: 222 },
    ],
    kunden: [
      { id: 'k_1', bereich: 'unternehmensberatung', firma: 'Bäckerei Huber GmbH', ansprechpartner: 'Franz Huber', telefon: '0731 1', email: '', anschrift: '' },
      { id: 'k_privat', bereich: 'privat', firma: 'Tante Erna', verantwortlich_email: HASAN.email },
    ],
    objekte: [],
    termine: [{ id: '11111111-2222-4333-8444-555555555555', titel: 'Erstgespräch Huber', besitzer_email: HASAN.email, teilnehmer: [], kunde_id: 'k_1', kunde_bereich: 'unternehmensberatung' }],
    kalender_einstellungen: [],
    gespraech_aufnahmen: [],
    ...extra,
  })
  const echt = db.storage.from
  ;(db as Any).storage = {
    from: (eimer: string) => ({
      ...echt(eimer),
      createSignedUploadUrl: (pfad: string) => Promise.resolve({ data: { signedUrl: `https://speicher.test/upload/${pfad}?token=t1`, token: 't1', path: pfad }, error: null }),
      createSignedUrl: (pfad: string) => Promise.resolve({ data: { signedUrl: `https://speicher.test/lesen/${pfad}` }, error: null }),
    }),
  }
  return db
}

type Protokoll = { telegram: { chat: unknown; text: string }[]; privat: { chat: unknown; text: string }[]; angestossen: string[]; ki: string[]; abschrift: { name: string; hinweis: string }[] }

/** Hilfen mit Uhr, Hintergrund-Sammler und Fakes. `rechte`: welche Akten der Aufrufer sehen darf. */
function hilfen(o: { uhr: { t: number }; ki?: KiFunktion; schreibeAb?: GespraechHilfen['schreibeAb']; rechte?: string[]; privatBot?: boolean; dienst?: boolean } & { p?: Protokoll; laeufe?: Promise<unknown>[] }) {
  const p: Protokoll = o.p ?? { telegram: [], privat: [], angestossen: [], ki: [], abschrift: [] }
  const laeufe: Promise<unknown>[] = o.laeufe ?? []
  const h: GespraechHilfen = {
    dienst: o.dienst,
    jetzt: () => o.uhr.t,
    restMs: () => 300_000,
    imHintergrund: (a) => void laeufe.push(a),
    stosseAn: (id) => {
      p.angestossen.push(id)
      return Promise.resolve()
    },
    darfKunde: (id) => Promise.resolve((o.rechte ?? ['k_1', 'k_privat']).includes(id)),
    darfObjekt: () => Promise.resolve(false),
    schreibeAb: o.schreibeAb ?? ((_b, name, _m, hinweis) => {
      p.abschrift.push({ name, hinweis })
      return Promise.resolve({ text: TEXTE[name] ?? '', stuecke: [] })
    }),
    ki: o.ki ?? kiFake(p),
    sendeTelegram: (chat, text) => {
      p.telegram.push({ chat, text })
      return Promise.resolve(true)
    },
    sendePrivat: (chat, text) => {
      p.privat.push({ chat, text })
      return Promise.resolve(true)
    },
    privatBotAktiv: () => Promise.resolve(!!o.privatBot),
  }
  return { h, p, laeufe }
}

const TEXTE: Record<string, string> = {
  'seg_1.webm': 'Guten Tag Herr Huber, schön dass es klappt. Wie läuft die Bäckerei?',
  'seg_2.webm': 'Ganz gut, aber die Nachfolge ist offen. Ich schicke Ihnen die Bilanz bis Freitag.',
}

function kiFake(p: Protokoll, roh: Record<string, unknown> = {}): KiFunktion {
  return (a) => {
    p.ki.push(a.werkzeug.name)
    if (a.werkzeug.name === 'sprecher_zuordnen') return Promise.resolve({ personen: [{ kuerzel: 'K', name: 'Franz Huber', rolle: 'kunde' }], wechsel: ['1 M', '3 K'] })
    return Promise.resolve({
      zusammenfassung: 'Erstgespräch zur Nachfolge der Bäckerei.',
      kernthemen: ['Nachfolge', 'Nachfolge', ''],
      unterlagen_fehlen: ['Bilanz'],
      todos: [{ text: 'Bilanz prüfen', faellig: '28.11.2026' }],
      termine: [{ titel: 'Folgetermin', datum: 'irgendwann' }],
      mail_entwurf: { betreff: 'Unser Gespräch', text: 'Sehr geehrter Herr Huber,\n\nvielen Dank.\n\nMit freundlichen Grüßen\nHasan Yilmaz' },
      ...roh,
    })
  }
}

async function alleFertig(laeufe: Promise<unknown>[]): Promise<void> {
  while (laeufe.length) await laeufe.shift()
}

async function hochladen(db: FalscheDatenbank, pfad: string, inhalt = 'ton'): Promise<void> {
  await db.storage.from(GESPRAECH_BUCKET).upload(pfad, new TextEncoder().encode(inhalt), { contentType: 'audio/webm' })
}

function zeile(db: FalscheDatenbank, id: string): Any {
  return db.tabelle('gespraech_aufnahmen').find((z) => z.id === id)!
}

async function anlegen(db: FalscheDatenbank, h: GespraechHilfen, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await gespraechAktion(db, HASAN, { action: 'gespraech_anlegen', art: 'termin', kundeId: 'k_1', einwilligung: { bestaetigt: true, text: 'Einverstanden' }, ...extra }, h)
  assertEquals(r.status, 200, JSON.stringify(r.daten))
  return (r.daten as Any).id
}

// ---------- Schema ----------

Deno.test('Schema: Listen gekürzt, Leeres und Doppeltes entfernt, Daten/Uhrzeiten/Beträge vereinheitlicht', () => {
  const a = normalisiereAnalyse({
    zusammenfassung: '  Kurz.  ',
    kernthemen: [...Array.from({ length: 40 }, (_, i) => `Thema ${i}`), 'Thema 1', '', '-', 'unbekannt'],
    naechste_schritte: [{ text: 'Anrufen', faellig: '24.11.2026', wer: '' }, { text: '' }],
    termine: [
      { titel: 'Besichtigung', datum: '1.12.', uhrzeit: '9.30' },
      { titel: 'Ohne Tag', datum: 'nächste Woche' },
      { titel: 'Falsch', datum: '2026-02-30' },
    ],
    wiedervorlagen: [{ titel: 'Nachfassen', faellig: '2026-12-01T00:00:00Z' }, { titel: 'Ohne', faellig: '' }],
    zahlen: [{ was: 'Kaufpreis', betrag: '1.200.000 €' }, { was: 'Zins', betrag: '3,5 %' }, { was: 'Kaputt', betrag: 'viel' }],
    stammdaten: [{ feld: 'adresse', wert: 'Hauptstr. 1, Ulm' }, { feld: 'telefon', wert: '' }, { feld: 'quatsch', wert: 'x' }],
    sprecher: [{ label: 'Kunde', rolle: 'Interessent' }],
    chance_hinweis: { prozent: 150, begruendung: 'Will unterschreiben' },
    erfunden: 'weg',
  }, '2026-11-22')
  assertEquals(a.zusammenfassung, 'Kurz.')
  assertEquals(a.kernthemen.length, LISTEN_GRENZE)
  assertEquals(a.kernthemen.filter((t) => t === 'Thema 1').length, 1)
  assertEquals(a.naechste_schritte, [{ text: 'Anrufen', faellig: '2026-11-24' }])
  assertEquals(a.termine, [{ titel: 'Besichtigung', datum: '2026-12-01', uhrzeit: '09:30' }])
  assertEquals(a.wiedervorlagen, [{ titel: 'Nachfassen', faellig: '2026-12-01' }])
  assertEquals(a.zahlen, [{ was: 'Kaufpreis', betrag: 1200000, einheit: '€' }, { was: 'Zins', betrag: 3.5, einheit: '%' }])
  assertEquals(a.stammdaten, [{ feld: 'anschrift', wert: 'Hauptstr. 1, Ulm' }, { feld: 'sonstiges', wert: 'x' }])
  assertEquals(a.sprecher, [{ label: 'Kunde', rolle: 'kunde' }])
  assertEquals(a.chance_hinweis, { prozent: 100, begruendung: 'Will unterschreiben' })
  assertEquals(a.mail_entwurf, { betreff: '', text: '' })
  assertEquals(a.vereinbarungen, [])
  assert(!('erfunden' in a))
})

Deno.test('Schema: Hilfsfunktionen für Datum, Uhrzeit, Betrag', () => {
  assertEquals(isoDatum('5.1.', '2026-12-20'), '2027-01-05')
  assertEquals(isoDatum('20.12.', '2026-12-28'), '2026-12-20') // kurz zurück bleibt im Jahr
  assertEquals(isoDatum('3.4.27'), '2027-04-03')
  assertEquals(isoDatum('morgen'), null)
  assertEquals(uhrzeit('14 Uhr'), '14:00')
  assertEquals(uhrzeit('25:00'), null)
  assertEquals(betrag('1,2 Mio'), 1200000)
  assertEquals(betrag('250 Tsd.'), 250000)
  assertEquals(normalisiereAnalyse(null).kernthemen, [])
})

// ---------- Zusammensetzen ----------

Deno.test('Abschrift: Abschnitte in Reihenfolge, Satz über die Grenze, Lücken, Zeitmarken', () => {
  const r = zerlegeInSaetze([
    { nr: 3, pfad: '', mime: '', status: 'transkribiert', dauer_s: 60, text: 'Dritter Teil.' },
    { nr: 1, pfad: '', mime: '', status: 'transkribiert', dauer_s: 60, text: 'Erster Satz. Zweiter Satz geht', stuecke: [{ ab: 0, text: 'Erster Satz.' }, { ab: 30, text: 'Zweiter Satz geht' }] },
    { nr: 2, pfad: '', mime: '', status: 'transkribiert', dauer_s: 60, text: 'weiter bis hier. Ende zwei.', stuecke: [{ ab: 0, text: 'weiter bis hier.' }, { ab: 20, text: 'Ende zwei.' }] },
    { nr: 4, pfad: '', mime: '', status: 'fehler', dauer_s: 60 },
    { nr: 5, pfad: '', mime: '', status: 'transkribiert', dauer_s: 60, text: 'Fünf.' },
  ])
  assertEquals(r.saetze.map((s) => s.text), ['Erster Satz.', 'Zweiter Satz geht weiter bis hier.', 'Ende zwei.', 'Dritter Teil.', 'Fünf.'])
  assertEquals(r.saetze.map((s) => s.sek), [0, 30, 80, 120, 240])
  assertEquals(r.luecken, [4])
  assertMatch(r.text, /^Erster Satz\. Zweiter Satz geht weiter bis hier\. Ende zwei\. Dritter Teil\. \[Teil 4 konnte nicht abgeschrieben werden\] Fünf\.$/)
})

Deno.test('Sprecherwechsel: verschiedene Schreibweisen, Bereich, Fortsetzung', () => {
  assertEquals(wendeWechselAn(['1 M', '3: k', { nr: 5, kuerzel: 'S2' }, '99 K', 'Unsinn'], 0, 6, 'M'), ['M', 'M', 'K', 'K', 'S2', 'S2'])
  // Fenster ab Satz 4 (Index 3): ohne Angabe gilt der letzte Sprecher davor.
  assertEquals(wendeWechselAn(['6 M'], 3, 7, 'K'), ['K', 'K', 'M', 'M'])
})

Deno.test('Schreibhilfe: Namen aus Akte und Team, dann Ende des vorigen Abschnitts', () => {
  const t = abschriftHinweis({ besitzerName: 'Hasan Yilmaz', team: ['Hasan Yilmaz', 'Quirin Lang'], kunde: { firma: 'Bäckerei Huber GmbH', ansprechpartner: 'Franz Huber' }, objekt: null }, 'x'.repeat(500) + ' Ende.')
  assertMatch(t, /^Gespräch der Mayer Holding\. Namen: Franz Huber, Bäckerei Huber GmbH, Hasan Yilmaz, Quirin Lang\. x+ Ende\.$/)
  assert(t.length <= 600)
})

// ---------- Ganzer Ablauf ----------

Deno.test('Ablauf: anlegen → zwei Abschnitte (verkehrt herum fertig) → abschließen → Sprecher → Auswertung → eine Telegram-Nachricht', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p, laeufe } = hilfen({ uhr })
  const id = await anlegen(db, h, { terminId: '11111111-2222-4333-8444-555555555555', kundeId: undefined })
  const z0 = zeile(db, id)
  assertEquals(z0.kunde_id, 'k_1') // aus dem Termin übernommen
  assertEquals(z0.kunde_bereich, 'unternehmensberatung')
  assertEquals(z0.titel, 'Erstgespräch Huber')
  assertEquals(z0.aufbewahren_bis, '2026-12-22')

  for (const nr of [1, 2]) {
    const u = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr, mime: 'audio/webm;codecs=opus' }, h)
    assertEquals(u.status, 200)
    assertEquals((u.daten as Any).pfad, `hasan@mayer.de/${id}/seg_${nr}.webm`)
    assertMatch((u.daten as Any).signedUrl, /^https:\/\/speicher\.test\/upload\//)
    await hochladen(db, (u.daten as Any).pfad)
  }
  // Abschnitt 2 meldet sich zuerst fertig.
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_segment_fertig', id, nr: 2, dauer_s: 60, bytes: 3 }, h)).status, 200)
  await alleFertig(laeufe)
  assertEquals(zeile(db, id).segmente.find((s: Any) => s.nr === 2).status, 'transkribiert')
  assertEquals(zeile(db, id).status, 'aufnahme') // vor dem Abschließen keine Auswertung
  await gespraechAktion(db, HASAN, { action: 'gespraech_segment_fertig', id, nr: 1, dauer_s: 60, bytes: 3 }, h)
  await gespraechAktion(db, HASAN, { action: 'gespraech_marker', id, marker: [{ sek: 70, text: 'Bilanz!', art: 'aufgabe' }, { sek: 70, text: 'Bilanz!', art: 'aufgabe' }] }, h)
  const ab = await gespraechAktion(db, HASAN, { action: 'gespraech_abschliessen', id, dauer_s: 120 }, h)
  assertEquals(ab.status, 200)
  await alleFertig(laeufe)

  const z = zeile(db, id)
  assertEquals(z.status, 'fertig', JSON.stringify(z.bearbeitung))
  assertEquals(z.marker.length, 1)
  assertMatch(z.transkript, /^Guten Tag Herr Huber.*Bäckerei\? Ganz gut/)
  assertEquals(p.ki, ['sprecher_zuordnen', 'auswertung_speichern'])
  assertEquals(z.sprecher.map((a: Any) => [a.label, a.name, a.sek]), [['Mitarbeiter', 'Hasan Yilmaz', 0], ['Kunde', 'Franz Huber', 60]])
  assertEquals(z.analyse.kernthemen, ['Nachfolge'])
  assertEquals(z.analyse.todos, [{ text: 'Bilanz prüfen', faellig: '2026-11-28' }])
  assertEquals(z.analyse.termine, []) // ohne Tag entfällt
  assertEquals(z.analyse.sprecher.map((s: Any) => s.label), ['Mitarbeiter', 'Kunde'])
  // Schreibhilfe für Abschnitt 1 enthält die Namen; Abschnitt 2 wurde vor 1 abgeschrieben.
  assertEquals(p.abschrift.map((a) => a.name), ['seg_2.webm', 'seg_1.webm'])
  assertMatch(p.abschrift[1].hinweis, /Franz Huber/)
  assertEquals(p.telegram.length, 1)
  assertEquals(p.telegram[0].chat, 111)
  assertEquals(p.telegram[0].text, `🎙️ Die Auswertung zum Gespräch mit Franz Huber (Bäckerei Huber GmbH) ist fertig — prüfen und übernehmen:\nhttps://eray-hash.github.io/mayer-holding-crm/gespraech/#/aufnahme/${id}`)
  assert(z.gemeldet_am)
  // Kein zweites Mal — auch nicht über den Minutentakt.
  await gespraechMinutentakt(db, h)
  assertEquals(p.telegram.length, 1)
  // Stand ohne interne Felder.
  const st = await gespraechAktion(db, HASAN, { action: 'gespraech_stand', id }, h)
  const a = (st.daten as Any).aufnahme
  assertEquals(a.bearbeitung, undefined)
  assertEquals(a.stand, undefined)
  assertEquals(a.segmente[0].stuecke, undefined)
  assertEquals(a.besitzer, true)
})

Deno.test('Abschließen bevor alles hochgeladen ist: Status „hochladen“, dann weiter, sobald der letzte Abschnitt da ist', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, laeufe } = hilfen({ uhr })
  const id = await anlegen(db, h)
  const u = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 1, mime: 'audio/webm' }, h)
  await hochladen(db, (u.daten as Any).pfad)
  await gespraechAktion(db, HASAN, { action: 'gespraech_segment_fertig', id, nr: 1, dauer_s: 60 }, h)
  await gespraechAktion(db, HASAN, { action: 'gespraech_abschliessen', id, nummern: [1, 2] }, h)
  await alleFertig(laeufe)
  assertEquals(zeile(db, id).status, 'hochladen')
  assertEquals(naechsteArbeit(zeile(db, id), uhr.t), { art: 'warten' })
  const u2 = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 2, mime: 'audio/webm' }, h)
  await hochladen(db, (u2.daten as Any).pfad)
  await gespraechAktion(db, HASAN, { action: 'gespraech_segment_fertig', id, nr: 2, dauer_s: 60 }, h)
  await alleFertig(laeufe)
  assertEquals(zeile(db, id).status, 'fertig')
})

// ---------- Wiederholen und Sperren ----------

Deno.test('Wiederholen: Mengengrenze beim ersten Versuch, nach einer Minute klappt es über den Minutentakt', async () => {
  const db = welt()
  const uhr = { t: START }
  let aufrufe = 0
  const { h, p, laeufe } = hilfen({
    uhr,
    schreibeAb: (_b, name) => {
      aufrufe++
      if (aufrufe === 1) return Promise.reject(new AbschriftFehler('Der Abschrift-Dienst antwortet mit 429: zu viele', 429))
      return Promise.resolve({ text: TEXTE[name] ?? 'Text.', stuecke: [] })
    },
  })
  const id = await anlegen(db, h)
  const u = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 1, mime: 'audio/webm' }, h)
  await hochladen(db, (u.daten as Any).pfad)
  await gespraechAktion(db, HASAN, { action: 'gespraech_segment_fertig', id, nr: 1, dauer_s: 60 }, h)
  await alleFertig(laeufe)
  let s = zeile(db, id).segmente[0]
  assertEquals([s.status, s.versuche, s.seit], ['hochgeladen', 1, null])
  assertMatch(s.fehler, /429/)
  // Sofort: noch nicht wieder dran.
  await gespraechMinutentakt(db, h)
  assertEquals(p.angestossen, [])
  uhr.t += 61_000
  await gespraechMinutentakt(db, h)
  assertEquals(p.angestossen, [id])
  await arbeiteGespraech(db, id, h)
  s = zeile(db, id).segmente[0]
  assertEquals([s.status, s.fehler], ['transkribiert', null])
})

Deno.test('Wiederholen: nach allen Versuchen ist der Abschnitt eine Lücke, die Auswertung läuft trotzdem', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p, laeufe } = hilfen({ uhr, schreibeAb: () => Promise.reject(new Error('Netz weg')) })
  const id = await anlegen(db, h)
  const u = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 1, mime: 'audio/webm' }, h)
  await hochladen(db, (u.daten as Any).pfad)
  await gespraechAktion(db, HASAN, { action: 'gespraech_segment_fertig', id, nr: 1 }, h)
  await gespraechAktion(db, HASAN, { action: 'gespraech_abschliessen', id }, h)
  await alleFertig(laeufe)
  for (let i = 1; i < SEGMENT_MAX_VERSUCHE; i++) {
    uhr.t += 61_000
    await arbeiteGespraech(db, id, h)
  }
  assertEquals(zeile(db, id).segmente[0].status, 'fehler')
  assertEquals(zeile(db, id).segmente[0].versuche, SEGMENT_MAX_VERSUCHE)
  await arbeiteGespraech(db, id, h)
  const z = zeile(db, id)
  assertEquals(z.status, 'fertig')
  assertEquals(z.analyse.zusammenfassung, 'In der Aufnahme war nichts Verständliches zu hören.')
  assertMatch(z.transkript, /Teil 1 konnte nicht abgeschrieben werden/)
  assertEquals(p.ki, []) // nichts zu verstehen → keine KI
})

Deno.test('Sperre: ein laufender Abschnitt wird nicht doppelt abgeschrieben, ein abgebrochener nach 150 s übernommen', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p } = hilfen({ uhr })
  const id = await anlegen(db, h)
  const u = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 1, mime: 'audio/webm' }, h)
  await hochladen(db, (u.daten as Any).pfad)
  const z = zeile(db, id)
  z.segmente = [{ ...z.segmente[0], status: 'hochgeladen', seit: new Date(START - 10_000).toISOString(), versuche: 1 }]
  assertEquals(await transkribiereSegment(db, id, 1, h), 'nichts')
  assertEquals(naechsteArbeit(zeile(db, id), uhr.t), null) // vor dem Abschließen, Abschnitt gesperrt
  assertEquals(p.abschrift.length, 0)
  uhr.t += 150_000
  assertEquals(await transkribiereSegment(db, id, 1, h), 'ok')
  assertEquals(zeile(db, id).segmente[0].versuche, 2)
})

Deno.test('Sperre: zwei gleichzeitige Läufe rufen jeden KI-Schritt nur einmal auf', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p, laeufe } = hilfen({ uhr })
  const id = await anlegen(db, h)
  const u = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 1, mime: 'audio/webm' }, h)
  await hochladen(db, (u.daten as Any).pfad)
  const z = zeile(db, id)
  // Abschnitt schon abgeschrieben, abgeschlossen — beide Läufe wollen Sprecher und Auswertung machen.
  z.segmente = [{ ...z.segmente[0], status: 'hochgeladen' }]
  z.abgeschlossen_am = new Date(START).toISOString()
  z.status = 'transkription'
  await Promise.all([arbeiteGespraech(db, id, h), arbeiteGespraech(db, id, h), arbeiteGespraech(db, id, h)])
  await alleFertig(laeufe)
  assertEquals(p.abschrift.length, 1)
  assertEquals(p.ki.filter((k) => k === 'sprecher_zuordnen').length <= 1, true)
  // Läufe, die zu spät kommen, sehen „warten“ oder nichts; der Minutentakt erledigt den Rest.
  for (let i = 0; i < 3 && zeile(db, id).status !== 'fertig'; i++) await arbeiteGespraech(db, id, h)
  assertEquals(zeile(db, id).status, 'fertig')
  assertEquals(p.ki, ['sprecher_zuordnen', 'auswertung_speichern'])
  assertEquals(p.telegram.length, 1)
})

Deno.test('KI-Fehler: drei Fehlschläge → Status „fehler“ und genau eine Nachricht; „Neu auswerten“ startet von vorn', async () => {
  const db = welt()
  const uhr = { t: START }
  let kaputt = true
  const p: Protokoll = { telegram: [], privat: [], angestossen: [], ki: [], abschrift: [] }
  const gut = kiFake(p)
  const { h, laeufe } = hilfen({ uhr, p, ki: (a) => (kaputt ? Promise.reject(new Error('Der KI-Dienst antwortet mit 529: überlastet')) : gut(a)) })
  const id = await anlegen(db, h)
  const u = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 1, mime: 'audio/webm' }, h)
  await hochladen(db, (u.daten as Any).pfad)
  await gespraechAktion(db, HASAN, { action: 'gespraech_segment_fertig', id, nr: 1, dauer_s: 60 }, h)
  await gespraechAktion(db, HASAN, { action: 'gespraech_abschliessen', id }, h)
  await alleFertig(laeufe)
  for (let i = 0; i < 4; i++) {
    uhr.t += 61_000
    await arbeiteGespraech(db, id, h)
  }
  const z = zeile(db, id)
  assertEquals(z.status, 'fehler')
  assertMatch(z.fehler, /529/)
  assertEquals(p.telegram.length, 1)
  assertMatch(p.telegram[0].text, /nicht gelungen/)
  kaputt = false
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_neu_auswerten', id }, h)).status, 200)
  await alleFertig(laeufe)
  assertEquals(zeile(db, id).status, 'fertig')
  assertEquals(p.telegram.length, 2)
})

Deno.test('Abgebrochener Worker: Schritt bleibt gesperrt, nach Ablauf übernimmt der nächste Lauf; zu oft → aufgeben', () => {
  const basis = { status: 'analyse', abgeschlossen_am: new Date(START).toISOString(), segmente: [{ nr: 1, status: 'transkribiert', text: 'Hallo.' }] }
  const seit = new Date(START).toISOString()
  assertEquals(naechsteArbeit({ ...basis, bearbeitung: { schritt: 'analyse', seit, versuche: 1 } }, START + 60_000), { art: 'warten' })
  assertEquals(naechsteArbeit({ ...basis, bearbeitung: { schritt: 'analyse', seit, versuche: 1, letzter_versuch: seit } }, START + 151_000), { art: 'analyse' })
  assertEquals(naechsteArbeit({ ...basis, bearbeitung: { schritt: 'analyse', seit, versuche: 3, letzter_versuch: seit } }, START + 151_000)?.art, 'aufgeben')
  assertEquals(naechsteArbeit({ ...basis, status: 'fertig' }, START), null)
})

// ---------- Löschfrist ----------

Deno.test('Löschfrist: abgelaufenes Audio wird gelöscht, Abschrift bleibt; laufende Frist und „unbegrenzt“ bleiben', async () => {
  const db = welt({
    gespraech_aufnahmen: [
      { id: 'a1', status: 'fertig', aufbewahren_bis: '2026-11-21', audio_geloescht_am: null, transkript: 'bleibt', segmente: [{ nr: 1, pfad: 'h@m.de/a1/seg_1.webm', status: 'transkribiert' }], bearbeitung: {} },
      { id: 'a2', status: 'fertig', aufbewahren_bis: '2026-11-22', audio_geloescht_am: null, segmente: [{ nr: 1, pfad: 'h@m.de/a2/seg_1.webm', status: 'transkribiert' }], bearbeitung: {} },
      { id: 'a3', status: 'fertig', aufbewahren_bis: null, audio_geloescht_am: null, segmente: [{ nr: 1, pfad: 'h@m.de/a3/seg_1.webm', status: 'transkribiert' }], bearbeitung: {} },
    ],
  })
  for (const p of ['h@m.de/a1/seg_1.webm', 'h@m.de/a2/seg_1.webm', 'h@m.de/a3/seg_1.webm']) await hochladen(db, p)
  assertEquals(await loescheAbgelaufeneAudios(db, START), 1)
  const fach = db.ablage.get(GESPRAECH_BUCKET)!
  assertEquals([...fach.keys()].sort(), ['h@m.de/a2/seg_1.webm', 'h@m.de/a3/seg_1.webm'])
  assert(zeile(db, 'a1').audio_geloescht_am)
  assertEquals(zeile(db, 'a1').transkript, 'bleibt')
  assertEquals(await loescheAbgelaufeneAudios(db, START), 0) // nichts doppelt
  // Am nächsten Tag ist a2 dran.
  assertEquals(await loescheAbgelaufeneAudios(db, START + 86400e3), 1)
})

Deno.test('Löschfrist: je Aufnahme einstellbar; Verwerfen löscht Audio, Fotos und Inhalte sofort', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h } = hilfen({ uhr })
  const id = await anlegen(db, h, { aufbewahrenTage: 7 })
  assertEquals(zeile(db, id).aufbewahren_bis, '2026-11-29')
  await gespraechAktion(db, HASAN, { action: 'gespraech_notiz', id, aufbewahrenTage: 90 }, h)
  assertEquals(zeile(db, id).aufbewahren_bis, '2027-02-20')
  const u = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 1, mime: 'audio/mp4' }, h)
  await hochladen(db, (u.daten as Any).pfad)
  const f = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 1, mime: 'image/jpeg' }, h)
  assertEquals((f.daten as Any).pfad, `hasan@mayer.de/${id}/foto_1.jpg`)
  await hochladen(db, (f.daten as Any).pfad)
  await gespraechAktion(db, HASAN, { action: 'gespraech_notiz', id, fotos: [{ pfad: (f.daten as Any).pfad, name: 'Tafel' }, { pfad: 'fremd@mayer.de/x/foto_1.jpg', name: 'fremd' }] }, h)
  assertEquals(zeile(db, id).fotos.length, 1)
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_verwerfen', id }, h)).status, 200)
  assertEquals(db.ablage.get(GESPRAECH_BUCKET)!.size, 0)
  const z = zeile(db, id)
  assertEquals([z.status, z.transkript, z.fotos.length], ['verworfen', null, 0])
  assert(z.audio_geloescht_am)
})

// ---------- Rechte ----------

Deno.test('Rechte: nur der Besitzer schreibt; wer die Akte sehen darf, liest ohne Audio; andere gar nicht', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, laeufe } = hilfen({ uhr })
  const id = await anlegen(db, h)
  const u = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 1, mime: 'audio/webm' }, h)
  await hochladen(db, (u.daten as Any).pfad)
  await gespraechAktion(db, HASAN, { action: 'gespraech_segment_fertig', id, nr: 1, dauer_s: 60 }, h)
  await alleFertig(laeufe)

  const leser = hilfen({ uhr, rechte: ['k_1'] }).h
  const st = await gespraechAktion(db, QUIRIN, { action: 'gespraech_stand', id }, leser)
  assertEquals(st.status, 200)
  assertEquals((st.daten as Any).aufnahme.besitzer, false)
  assertEquals((st.daten as Any).aufnahme.segmente[0].pfad, '')
  assertEquals((await gespraechAktion(db, QUIRIN, { action: 'gespraech_datei_url', id, nr: 1 }, leser)).status, 403)
  for (const action of ['gespraech_marker', 'gespraech_notiz', 'gespraech_upload_url', 'gespraech_segment_fertig', 'gespraech_abschliessen', 'gespraech_verwerfen', 'gespraech_neu_auswerten']) {
    const r = await gespraechAktion(db, QUIRIN, { action, id, nr: 1, mime: 'audio/webm', marker: [{ sek: 1, text: 'x' }] }, leser)
    assertEquals(r.status, 403, action)
    assertMatch((r.daten as Any).error, /Ändern kann nur/)
  }
  const liste = await gespraechAktion(db, QUIRIN, { action: 'gespraech_liste', kundeId: 'k_1' }, leser)
  assertEquals((liste.daten as Any).zeilen.length, 1)
  assertEquals((await gespraechAktion(db, QUIRIN, { action: 'gespraech_liste' }, leser)).daten, { zeilen: [], weitere: false })

  const ohne = hilfen({ uhr, rechte: [] }).h
  assertEquals((await gespraechAktion(db, FREMD, { action: 'gespraech_stand', id }, ohne)).status, 403)
  assertEquals((await gespraechAktion(db, FREMD, { action: 'gespraech_liste', kundeId: 'k_1' }, ohne)).status, 403)
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_datei_url', id, nr: 1 }, h)).status, 200)

  // Verworfen: für Leser weg.
  await gespraechAktion(db, HASAN, { action: 'gespraech_verwerfen', id }, h)
  assertEquals((await gespraechAktion(db, QUIRIN, { action: 'gespraech_stand', id }, leser)).status, 403)
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_marker', id, marker: [] }, h)).status, 409)
})

Deno.test('Rechte: Anlegen nur mit Einwilligung, freigegebener Akte und eigenem Termin; Fortsetzung nur für den Server', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h } = hilfen({ uhr })
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_anlegen', art: 'telefon', kundeId: 'k_1' }, h)).status, 400)
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_anlegen', art: 'notiz' }, h)).status, 200) // Notiz ohne Gesprächspartner
  const ohne = hilfen({ uhr, rechte: [] }).h
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_anlegen', art: 'termin', kundeId: 'k_1', einwilligung: { bestaetigt: true } }, ohne)).status, 403)
  assertEquals((await gespraechAktion(db, QUIRIN, { action: 'gespraech_anlegen', art: 'termin', terminId: '11111111-2222-4333-8444-555555555555', einwilligung: { bestaetigt: true } }, h)).status, 403)
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_anlegen', art: 'termin', kundeId: 'k_gibtsnicht', einwilligung: { bestaetigt: true } }, h)).status, 404)
  // Gleiche Kennung zweimal (App war offline) → dieselbe Aufnahme.
  const eigene = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const a = await gespraechAktion(db, HASAN, { action: 'gespraech_anlegen', id: eigene, art: 'notiz' }, h)
  const b = await gespraechAktion(db, HASAN, { action: 'gespraech_anlegen', id: eigene, art: 'notiz' }, h)
  assertEquals([a.daten, b.daten], [{ id: eigene }, { id: eigene }])
  assertEquals((await gespraechAktion(db, QUIRIN, { action: 'gespraech_anlegen', id: eigene, art: 'notiz' }, h)).status, 409)
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_weiter', id: eigene }, h)).status, 403)
  assertEquals((await gespraechAktion(db, null, { action: 'gespraech_stand', id: eigene }, h)).status, 401)
  const dienst = hilfen({ uhr, dienst: true })
  assertEquals((await gespraechAktion(db, null, { action: 'gespraech_weiter', id: eigene }, dienst.h)).status, 200)
  assertEquals(dienst.laeufe.length, 1)
})

// ---------- Nachricht ----------

Deno.test('Nachricht: ohne Mayer-Akte über den privaten Bot (wenn aktiv); abgeschaltet → keine Nachricht, nie doppelt', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p, laeufe } = hilfen({ uhr, privatBot: true })
  const id = await anlegen(db, h, { art: 'notiz', kundeId: undefined, titel: 'Idee Steuer' })
  const u = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 1, mime: 'audio/webm' }, h)
  await hochladen(db, (u.daten as Any).pfad)
  await gespraechAktion(db, HASAN, { action: 'gespraech_segment_fertig', id, nr: 1, dauer_s: 60 }, h)
  await gespraechAktion(db, HASAN, { action: 'gespraech_abschliessen', id }, h)
  await alleFertig(laeufe)
  assertEquals(zeile(db, id).status, 'fertig')
  assertEquals(p.ki, ['auswertung_speichern']) // Notiz: keine Sprecher-Zuordnung per KI
  assertEquals(zeile(db, id).analyse.mail_entwurf, { betreff: '', text: '' })
  assertEquals(p.telegram.length, 0)
  assertEquals(p.privat.length, 1)
  assertMatch(p.privat[0].text, /zur Aufnahme „Idee Steuer“ ist fertig/)

  // Abgeschaltet: keine Nachricht, aber als erledigt markiert.
  db.tabelle('kalender_einstellungen').push({ email: HASAN.email, gespraech_meldung: false })
  const id2 = await anlegen(db, h)
  const u2 = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id: id2, nr: 1, mime: 'audio/webm' }, h)
  await hochladen(db, (u2.daten as Any).pfad)
  await gespraechAktion(db, HASAN, { action: 'gespraech_segment_fertig', id: id2, nr: 1, dauer_s: 60 }, h)
  await gespraechAktion(db, HASAN, { action: 'gespraech_abschliessen', id: id2 }, h)
  await alleFertig(laeufe)
  assertEquals(zeile(db, id2).status, 'fertig')
  assert(zeile(db, id2).gemeldet_am)
  assertEquals(p.telegram.length + p.privat.length, 1)
})

Deno.test('Liste: eigene Aufnahmen seitenweise, neueste zuerst, ohne verworfene', async () => {
  const zeilen: Zeile[] = Array.from({ length: 35 }, (_, i) => ({ id: `r${i}`, mitarbeiter_email: HASAN.email, status: i === 0 ? 'verworfen' : 'fertig', erstellt_am: new Date(START + i * 1000).toISOString(), analyse: { zusammenfassung: `Z${i}` }, uebernommen: i === 34 ? { protokoll: 'p1' } : null }))
  const db = welt({ gespraech_aufnahmen: zeilen })
  const { h } = hilfen({ uhr: { t: START } })
  const s0 = (await gespraechAktion(db, HASAN, { action: 'gespraech_liste' }, h)).daten as Any
  assertEquals(s0.zeilen.length, 30)
  assertEquals(s0.weitere, true)
  assertEquals([s0.zeilen[0].id, s0.zeilen[0].zusammenfassung, s0.zeilen[0].uebernommen, s0.zeilen[0].analyse], ['r34', 'Z34', true, undefined])
  const s1 = (await gespraechAktion(db, HASAN, { action: 'gespraech_liste', seite: 1 }, h)).daten as Any
  assertEquals(s1.zeilen.map((z: Any) => z.id), ['r4', 'r3', 'r2', 'r1'])
  assertEquals(s1.weitere, false)
})
