// Tests der Gesprächs-App, Runde 5: Sprachen (Abschrift mit Spracherkennung, Auswertung immer Deutsch, Übersetzung
// auf Anforderung), Fragebogen und Aktenfelder (Auswertung und Übernahme), Teilen mit Kollegen und Gesprächsnotiz.
import { assert, assertEquals, assertMatch, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { falscheDatenbank, type FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { GESPRAECH_BUCKET, gespraechAktion, type GespraechHilfen, type KiFunktion, UEBERSETZUNG_ZEICHEN } from './gespraechPipeline.ts'
import { type GespraechKontext, gespraechUebernehmen } from './gespraechUebernehmen.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const HASAN = { email: 'hasan@mayer.de', name: 'Hasan Yilmaz' }
const QUIRIN = { email: 'quirin@mayer.de', name: 'Quirin Lang' }
const ANDREAS = { email: 'andreas@mayer.de', name: 'Andreas Mayer' }
const START = Date.parse('2026-11-22T10:00:00Z')

const VORLAGE = `# MANDANTENFRAGEBOGEN
Name / Vorname: {{Name / Vorname}}
Familienstand / Kinder: {{Familienstand / Kinder}}
☐ Testament / Erbvertrag
☐ Vorsorgevollmacht`

function welt(extra: Record<string, Zeile[]> = {}) {
  const db = falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', name: HASAN.name, email: HASAN.email, aktiv: true, telegram_chat_id: 111 },
      { id: 'm2', name: QUIRIN.name, email: QUIRIN.email, aktiv: true, telegram_chat_id: 222 },
      { id: 'm3', name: ANDREAS.name, email: ANDREAS.email, aktiv: true, telegram_chat_id: null },
    ],
    kunden: [
      { id: 'k_1', bereich: 'erben', firma: 'Familie Yıldız', ansprechpartner: 'Ayşe Yıldız', telefon: '', email: 'ayse@kunde.test', anschrift: '', sachverhalt: '', branche: 'Gastronomie', dienstleistungen: null, activities: [{ id: 'a0', date: '2026-11-01', text: 'alt', user: 'x' }] },
      { id: 'k_privat', bereich: 'privat', firma: 'Tante Erna', verantwortlich_email: HASAN.email, activities: [] },
    ],
    vorlagen: [
      { id: 'vl_erben', bereich: 'erben', typ: 'Fragebogen', name: 'Mandantenfragebogen – Nachfolge', text: VORLAGE },
      { id: 'vl_leer', bereich: 'erben', typ: 'Fragebogen', name: 'Leere Vorlage', text: '' },
    ],
    leistungen_preisliste: [{ bezeichnung: 'Nachfolgeberatung', sortierung: 1 }, { bezeichnung: 'Testamentsgestaltung', sortierung: 2 }],
    objekte: [],
    termine: [],
    kalender_einstellungen: [],
    gespraech_aufnahmen: [],
    ...extra,
  })
  const echt = db.storage.from
  ;(db as Any).storage = {
    from: (eimer: string) => ({
      ...echt(eimer),
      createSignedUploadUrl: (pfad: string) => Promise.resolve({ data: { signedUrl: `https://speicher.test/upload/${pfad}`, token: 't', path: pfad }, error: null }),
    }),
  }
  return db
}

type Protokoll = { ki: { werkzeug: string; system: string; prompt: string; props: string[] }[]; abschrift: { name: string; hinweis: string; sprache: string | null | undefined }[]; telegram: { chat: unknown; text: string }[] }

const TUERKISCH = 'Merhaba Ayşe Hanım, nasılsınız? İyiyim, teşekkürler. Vasiyetnamem 2019 yılından, noterde duruyor.'

function hilfen(o: { uhr: { t: number }; ki?: KiFunktion; erkannt?: string; mitTeilen?: boolean; rechte?: Record<string, string[]> }) {
  const p: Protokoll = { ki: [], abschrift: [], telegram: [] }
  const laeufe: Promise<unknown>[] = []
  const rechte = o.rechte ?? { [HASAN.email]: ['k_1', 'k_privat'], [QUIRIN.email]: ['k_1'], [ANDREAS.email]: ['k_1'] }
  const h: GespraechHilfen = {
    jetzt: () => o.uhr.t,
    restMs: () => 300_000,
    imHintergrund: (a) => void laeufe.push(a),
    stosseAn: () => Promise.resolve(),
    darfKunde: (id) => Promise.resolve((rechte[HASAN.email] ?? []).includes(id)),
    darfObjekt: () => Promise.resolve(false),
    ...(o.mitTeilen === false ? {} : { darfKundeFuer: (email: string, id: string) => Promise.resolve((rechte[email] ?? []).includes(id)) }),
    schreibeAb: (_b, name, _m, hinweis, _t, sprache) => {
      p.abschrift.push({ name, hinweis, sprache })
      return Promise.resolve({ text: TUERKISCH, stuecke: [], ...(o.erkannt ? { sprache: o.erkannt } : {}) })
    },
    ki: o.ki ?? kiFake(p),
    sendeTelegram: (chat, text) => {
      p.telegram.push({ chat, text })
      return Promise.resolve(true)
    },
    sendePrivat: () => Promise.resolve(true),
    privatBotAktiv: () => Promise.resolve(false),
  }
  return { h, p, laeufe }
}

function kiFake(p: Protokoll): KiFunktion {
  return (a) => {
    p.ki.push({ werkzeug: a.werkzeug.name, system: a.system, prompt: a.prompt, props: Object.keys((a.werkzeug.input_schema as Any).properties ?? {}) })
    if (a.werkzeug.name === 'sprecher_zuordnen') return Promise.resolve({ personen: [{ kuerzel: 'K', name: 'Ayşe Yıldız' }], wechsel: ['1 M', '2 K'] })
    if (a.werkzeug.name === 'uebersetzung_speichern') {
      const nrs = [...a.prompt.matchAll(/^(\d+): /gm)].map((m) => Number(m[1]))
      return Promise.resolve({ absaetze: nrs.map((nr) => ({ nr, text: `Deutsch ${nr}` })) })
    }
    if (a.werkzeug.name === 'mail_uebersetzen') return Promise.resolve({ betreff: 'Görüşmemiz', text: 'Sayın Ayşe Hanım, …' })
    return Promise.resolve({
      zusammenfassung: 'Frau Yıldız möchte ihre Nachfolge regeln. Ein Testament von 2019 liegt beim Notar.',
      naechste_schritte: [{ text: 'Testament prüfen', faellig: '2026-11-27' }],
      mail_entwurf: { betreff: 'Unser Gespräch', text: 'Sehr geehrte Frau Yıldız,\n\nvielen Dank.\n\nMit freundlichen Grüßen\nHasan Yilmaz' },
      fragebogen: [
        { nr: 3, antwort: 'Testament von 2019, liegt beim Notar', sicher: true },
        { nr: 2, antwort: 'verheiratet, zwei Kinder', sicher: false },
        { nr: 9, frage: 'Erfunden', antwort: 'nein', sicher: true },
      ],
      aktenfelder: { sachverhalt: 'Nachfolge und Testament prüfen.', branche: 'Gastronomie', dienstleistungen: ['Testamentsgestaltung'] },
    })
  }
}

async function alleFertig(laeufe: Promise<unknown>[]): Promise<void> {
  while (laeufe.length) await laeufe.shift()
}

function zeile(db: FalscheDatenbank, id: string): Any {
  return db.tabelle('gespraech_aufnahmen').find((z) => z.id === id)!
}

/** Anlegen, ein Abschnitt hochladen, abschließen, alles abarbeiten. */
async function fertigeAufnahme(db: FalscheDatenbank, h: GespraechHilfen, laeufe: Promise<unknown>[], extra: Record<string, unknown> = {}): Promise<string> {
  const r = await gespraechAktion(db, HASAN, { action: 'gespraech_anlegen', art: 'termin', kundeId: 'k_1', einwilligung: { bestaetigt: true, text: 'Einverstanden' }, ...extra }, h)
  assertEquals(r.status, 200, JSON.stringify(r.daten))
  const id = (r.daten as Any).id
  const u = await gespraechAktion(db, HASAN, { action: 'gespraech_upload_url', id, nr: 1, mime: 'audio/webm' }, h)
  await db.storage.from(GESPRAECH_BUCKET).upload((u.daten as Any).pfad, new TextEncoder().encode('ton'), { contentType: 'audio/webm' })
  await gespraechAktion(db, HASAN, { action: 'gespraech_segment_fertig', id, nr: 1, dauer_s: 60, bytes: 3 }, h)
  await gespraechAktion(db, HASAN, { action: 'gespraech_abschliessen', id, dauer_s: 60 }, h)
  await alleFertig(laeufe)
  assertEquals(zeile(db, id).status, 'fertig', JSON.stringify(zeile(db, id).bearbeitung))
  return id
}

// ---------- Sprachen ----------

Deno.test('Sprache: türkisch eingestellt → Kürzel tr an die Spracherkennung, Schreibhilfe ohne deutschen Satz, Auswertung auf Deutsch', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p, laeufe } = hilfen({ uhr, erkannt: 'Turkish' })
  const id = await fertigeAufnahme(db, h, laeufe, { sprache: 'türkisch' })
  const z = zeile(db, id)
  assertEquals(z.sprache, 'tuerkisch')
  assertEquals(p.abschrift[0].sprache, 'tr')
  assert(!p.abschrift[0].hinweis.includes('Gespräch der Mayer Holding'), p.abschrift[0].hinweis)
  assertStringIncludes(p.abschrift[0].hinweis, 'Ayşe Yıldız')
  assertEquals(z.segmente[0].sprache, 'tr')
  assertEquals(z.sprache_erkannt, 'tr')
  const analyse = p.ki.find((k) => k.werkzeug === 'auswertung_speichern')!
  assertStringIncludes(analyse.system, 'ganz oder teilweise auf Türkisch')
  assertStringIncludes(analyse.system, 'trotzdem alle Felder auf Deutsch')
  assertStringIncludes(p.ki.find((k) => k.werkzeug === 'sprecher_zuordnen')!.system, 'auf Türkisch')
})

Deno.test('Sprache: automatisch → keine Sprache an die Spracherkennung, erkannte Sprache je Abschnitt; ohne Angabe bleibt Deutsch', async () => {
  const db = welt()
  const uhr = { t: START }
  const auto = hilfen({ uhr, erkannt: 'english' })
  const id = await fertigeAufnahme(db, auto.h, auto.laeufe, { sprache: 'automatisch' })
  assertEquals(auto.p.abschrift[0].sprache, null)
  assertEquals(zeile(db, id).sprache_erkannt, 'en')

  const alt = hilfen({ uhr })
  const id2 = await fertigeAufnahme(db, alt.h, alt.laeufe)
  assertEquals(zeile(db, id2).sprache, undefined) // ältere App: Spalte bleibt bei der Vorgabe der Tabelle
  assertEquals(alt.p.abschrift[0].sprache, 'de')
  assertStringIncludes(alt.p.abschrift[0].hinweis, 'Gespräch der Mayer Holding')
  assertEquals(zeile(db, id2).sprache_erkannt, 'de')
  assert(!alt.p.ki.find((k) => k.werkzeug === 'auswertung_speichern')!.system.includes('ganz oder teilweise auf'))
})

Deno.test('Sprache: „Neu auswerten“ mit anderer Sprache schreibt alle Abschnitte neu ab und leert die Übersetzung', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p, laeufe } = hilfen({ uhr, erkannt: 'turkish' })
  const id = await fertigeAufnahme(db, h, laeufe)
  zeile(db, id).uebersetzung = { abschrift: { absaetze: ['x'], quelle: 1, fertig: true, am: '' } }
  uhr.t += 60_000
  const r = await gespraechAktion(db, HASAN, { action: 'gespraech_neu_auswerten', id, sprache: 'tuerkisch' }, h)
  assertEquals(r.status, 200, JSON.stringify(r.daten))
  assertEquals(zeile(db, id).uebersetzung, null)
  await alleFertig(laeufe)
  const z = zeile(db, id)
  assertEquals(z.sprache, 'tuerkisch')
  assertEquals(p.abschrift.map((a) => a.sprache), ['de', 'tr'])
  assertEquals(z.status, 'fertig')
  // Ton gelöscht → mit anderer Sprache geht es nicht mehr.
  z.audio_geloescht_am = new Date(uhr.t).toISOString()
  const r2 = await gespraechAktion(db, HASAN, { action: 'gespraech_neu_auswerten', id, sprache: 'englisch' }, h)
  assertEquals(r2.status, 410)
})

Deno.test('Übersetzen: deutsche Abschrift in Teilen, zwischengespeichert; Leser dürfen; Deutsch → Hinweis', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p, laeufe } = hilfen({ uhr, erkannt: 'turkish' })
  const id = await fertigeAufnahme(db, h, laeufe, { sprache: 'automatisch' })
  // Viele lange Absätze → mehrere Aufrufe.
  const lang = 'ç'.repeat(Math.ceil(UEBERSETZUNG_ZEICHEN / 2) + 10)
  zeile(db, id).sprecher = [0, 1, 2].map((i) => ({ label: i % 2 ? 'Kunde' : 'Mitarbeiter', sek: i * 10, text: `${lang} ${i}` }))
  const vorher = p.ki.length
  const r = await gespraechAktion(db, QUIRIN, { action: 'gespraech_uebersetzen', id }, h)
  assertEquals(r.status, 200, JSON.stringify(r.daten))
  assertEquals((r.daten as Any).absaetze, ['Deutsch 1', 'Deutsch 2', 'Deutsch 3'])
  assertEquals((r.daten as Any).fertig, true)
  assertEquals(p.ki.length - vorher, 3)
  assertEquals(zeile(db, id).uebersetzung.abschrift.quelle, 3)
  // Zweiter Aufruf: aus dem Zwischenspeicher.
  await gespraechAktion(db, HASAN, { action: 'gespraech_uebersetzen', id, art: 'abschrift' }, h)
  assertEquals(p.ki.length - vorher, 3)
  // Deutsche Aufnahme.
  const de = hilfen({ uhr })
  const id2 = await fertigeAufnahme(db, de.h, de.laeufe)
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_uebersetzen', id: id2 }, de.h)).status, 400)
})

Deno.test('Übersetzen: Mail-Entwurf in die Sprache des Kunden (nur Besitzer), gleicher Text aus dem Zwischenspeicher', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p, laeufe } = hilfen({ uhr, erkannt: 'turkish' })
  const id = await fertigeAufnahme(db, h, laeufe)
  const ein = { action: 'gespraech_uebersetzen', id, art: 'mail', sprache: 'tuerkisch', betreff: 'Unser Gespräch', text: 'Sehr geehrte Frau Yıldız, …' }
  const r = await gespraechAktion(db, HASAN, ein, h)
  assertEquals(r.daten, { betreff: 'Görüşmemiz', text: 'Sayın Ayşe Hanım, …', sprache: 'tr' })
  const n = p.ki.length
  await gespraechAktion(db, HASAN, ein, h)
  assertEquals(p.ki.length, n)
  await gespraechAktion(db, HASAN, { ...ein, text: 'Anderer Text' }, h)
  assertEquals(p.ki.length, n + 1)
  assertStringIncludes(p.ki[n].system, '„Türkisch“')
  assertEquals((await gespraechAktion(db, HASAN, { ...ein, sprache: 'deutsch' }, h)).status, 400)
  assertEquals((await gespraechAktion(db, QUIRIN, ein, h)).status, 403)
})

// ---------- Fragebogen und Aktenfelder ----------

Deno.test('Fragebogen: Vorlage des Bereichs in Auftrag und Werkzeug, Antworten auf die Fragen der Vorlage, Aktenfelder', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p, laeufe } = hilfen({ uhr })
  const id = await fertigeAufnahme(db, h, laeufe)
  const k = p.ki.find((x) => x.werkzeug === 'auswertung_speichern')!
  assert(k.props.includes('fragebogen') && k.props.includes('aktenfelder'))
  assertStringIncludes(k.prompt, 'Fragebogen „Mandantenfragebogen – Nachfolge“')
  assertStringIncludes(k.prompt, '3. Testament / Erbvertrag')
  assertStringIncludes(k.prompt, 'Dienstleistungen laut Preisliste: Nachfolgeberatung, Testamentsgestaltung')
  assertStringIncludes(k.prompt, 'Branche: Gastronomie')
  const a = zeile(db, id).analyse
  assertEquals(a.fragebogen, [
    { frage: 'Familienstand / Kinder', antwort: 'verheiratet, zwei Kinder', sicher: false },
    { frage: 'Testament / Erbvertrag', antwort: 'Testament von 2019, liegt beim Notar', sicher: true },
  ])
  assertEquals(a.fragebogen_vorlage, { id: 'vl_erben', name: 'Mandantenfragebogen – Nachfolge' })
  assertEquals(a.aktenfelder, { sachverhalt: 'Nachfolge und Testament prüfen.', branche: 'Gastronomie', dienstleistungen: ['Testamentsgestaltung'] })
})

Deno.test('Fragebogen: private Akte → weder Fragebogen noch Aktenfelder', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p, laeufe } = hilfen({ uhr })
  const id = await fertigeAufnahme(db, h, laeufe, { kundeId: 'k_privat' })
  const k = p.ki.find((x) => x.werkzeug === 'auswertung_speichern')!
  assert(!k.props.includes('fragebogen') && !k.props.includes('aktenfelder'))
  const a = zeile(db, id).analyse
  assertEquals(a.fragebogen, undefined)
  assertEquals(a.aktenfelder, undefined)
})

/** Testdatenbank für gespraechUebernehmen (ilike wie dort genutzt: genauer Vergleich). */
function mitIlike(db: FalscheDatenbank) {
  // deno-lint-ignore no-explicit-any
  const erweitere = (q: any): any => {
    q.ilike = (spalte: string, muster: string) => erweitere(q.eq(spalte, String(muster).replace(/\\(.)/g, '$1')))
    return q
  }
  return { from: (t: string) => erweitere(db.from(t)), storage: db.storage }
}

Deno.test('Übernahme: Fragebogen als PDF unter Dokumente, Aktenfelder nur in leere Felder, zweiter Aufruf legt nichts doppelt an', async () => {
  const db = welt({ protokolle: [], wiedervorlagen: [], todos: [] })
  const uhr = { t: START }
  const { h, laeufe } = hilfen({ uhr })
  const id = await fertigeAufnahme(db, h, laeufe)
  const k: GespraechKontext = {
    admin: mitIlike(db),
    aufrufer: { email: HASAN.email, name: HASAN.name, istGf: false },
    heute: '2026-11-22',
    darfKunde: () => Promise.resolve(true),
    darfBereich: () => Promise.resolve(true),
    linkBasis: 'https://crm.test/',
  }
  const auswahl = { fragebogen: true, aktenfelder: ['sachverhalt', 'branche', 'dienstleistungen'] }
  const bearbeitet = { fragebogen: [...zeile(db, id).analyse.fragebogen, { frage: 'Vorsorgevollmacht', antwort: 'liegt vor', sicher: true }] }
  const r = await gespraechUebernehmen(k, { id, auswahl, bearbeitet })
  assertEquals(r.status, 200, JSON.stringify(r.daten))
  const akte = db.tabelle('kunden').find((x) => x.id === 'k_1') as Any
  assertEquals(akte.sachverhalt, 'Nachfolge und Testament prüfen.')
  assertEquals(akte.dienstleistungen, ['Testamentsgestaltung'])
  assertEquals(akte.branche, 'Gastronomie') // stand schon da — nicht überschrieben
  const doks = akte.dokumente as Any[]
  assertEquals(doks.length, 1)
  assertEquals(doks[0].typ, 'application/pdf')
  assertMatch(doks[0].name, /^Mandantenfragebogen – Nachfolge – Gespräch 22\.11\.2026\.pdf$/)
  const datei = db.ablage.get('kunden-dokumente')?.get(doks[0].url)
  assert(datei, 'PDF liegt im Speicher der Akte')
  assertEquals(new TextDecoder().decode(datei.bytes.slice(0, 5)), '%PDF-')
  assertEquals(datei.contentType, 'application/pdf')
  const u = zeile(db, id).uebernommen
  assertEquals(u.fragebogen, { dokumentId: doks[0].id })
  assertEquals(u.aktenfelder, { sachverhalt: 'ergaenzt', branche: 'belegt', dienstleistungen: 'ergaenzt' })
  const d = r.daten as Any
  assert(d.zeilen.some((z: string) => z.includes('Fragebogen als PDF')))
  assert(d.hinweise.some((x: string) => x.startsWith('Branche nicht übernommen')))
  assert(akte.activities.some((a: Any) => a.text.startsWith('Sachverhalt aus der Gesprächsaufnahme')))

  const r2 = await gespraechUebernehmen(k, { id, auswahl, bearbeitet })
  assertEquals(r2.status, 200)
  const akte2 = db.tabelle('kunden').find((x) => x.id === 'k_1') as Any
  assertEquals((akte2.dokumente as Any[]).length, 1)
  assertEquals((r2.daten as Any).hinweise, [])
})

// ---------- Teilen ----------

Deno.test('Teilen: mögliche Empfänger, Telegram nur an Berechtigte mit Telegram, kein Doppeltes binnen 10 Minuten', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, p, laeufe } = hilfen({ uhr, rechte: { [HASAN.email]: ['k_1'], [QUIRIN.email]: ['k_1'], [ANDREAS.email]: [] } })
  const id = await fertigeAufnahme(db, h, laeufe)
  const telegramVorher = p.telegram.length // „Auswertung fertig“ an Hasan

  const pr = await gespraechAktion(db, HASAN, { action: 'gespraech_teilen', id, pruefen: true }, h)
  assertEquals((pr.daten as Any).empfaenger, [
    { email: QUIRIN.email, name: QUIRIN.name, darf: true, telegram: true },
    { email: ANDREAS.email, name: ANDREAS.name, darf: false, telegram: false },
  ])

  const r = await gespraechAktion(db, HASAN, { action: 'gespraech_teilen', id, an: [QUIRIN.email, ANDREAS.email, 'fremd@x.de'], notiz: 'Bitte Testament anschauen' }, h)
  assertEquals(r.status, 200)
  assertEquals((r.daten as Any).gesendet, [QUIRIN.name])
  assertEquals((r.daten as Any).nicht, [{ name: ANDREAS.name, grund: 'darf diese Akte nicht sehen' }, { name: 'fremd@x.de', grund: 'kein aktiver Mitarbeiter' }])
  const nachricht = p.telegram[telegramVorher]
  assertEquals(nachricht.chat, 222)
  assertMatch(nachricht.text, /^🎙️ Hasan Yilmaz teilt ein Gespräch mit dir: Ayşe Yıldız \(Familie Yıldız\) — Kundentermin vom 22\.11\.2026/)
  assertStringIncludes(nachricht.text, '„Bitte Testament anschauen“')
  assertStringIncludes(nachricht.text, '- Testament prüfen (bis 27.11.2026)')
  assertStringIncludes(nachricht.text, `Ansehen: https://eray-hash.github.io/mayer-holding-crm/gespraech/#/aufnahme/${id}`)
  assertEquals(zeile(db, id).geteilt.length, 1)

  uhr.t += 60_000
  const r2 = await gespraechAktion(db, HASAN, { action: 'gespraech_teilen', id, an: [QUIRIN.email] }, h)
  assertEquals((r2.daten as Any).nicht, [{ name: QUIRIN.name, grund: 'hat sie gerade eben schon bekommen' }])
  assertEquals(p.telegram.length, telegramVorher + 1)
  // Nur der Besitzer teilt; ohne Rechteprüfung im Server ist Teilen aus.
  assertEquals((await gespraechAktion(db, QUIRIN, { action: 'gespraech_teilen', id, an: [HASAN.email] }, h)).status, 403)
  const ohne = hilfen({ uhr, mitTeilen: false })
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_teilen', id, an: [QUIRIN.email] }, ohne.h)).status, 501)
})

Deno.test('Teilen: private Aufnahme nicht; Gesprächsnotiz an den Kunden landet im Verlauf und in geteilt, ohne Doppeltes', async () => {
  const db = welt()
  const uhr = { t: START }
  const { h, laeufe } = hilfen({ uhr })
  const privat = await fertigeAufnahme(db, h, laeufe, { kundeId: 'k_privat' })
  assertEquals((await gespraechAktion(db, HASAN, { action: 'gespraech_teilen', id: privat, an: [QUIRIN.email] }, h)).status, 409)

  const id = await fertigeAufnahme(db, h, laeufe)
  const ein = { action: 'gespraech_kundennotiz_vermerken', id, an: 'ayse@kunde.test', betreff: 'Gesprächsnotiz vom 22.11.2026', sprache: 'tr' }
  const r = await gespraechAktion(db, HASAN, ein, h)
  assertEquals(r.status, 200, JSON.stringify(r.daten))
  const akte = db.tabelle('kunden').find((x) => x.id === 'k_1') as Any
  assertEquals(akte.activities.length, 2)
  assertEquals(akte.activities[0].text, 'Gesprächsnotiz zur Aufnahme „Kundentermin vom 22.11.2026“ an ayse@kunde.test geschickt — Betreff: Gesprächsnotiz vom 22.11.2026 (auf Türkisch).')
  assertEquals(akte.activities[0].user, HASAN.name)
  assertEquals(zeile(db, id).geteilt.map((g: Any) => [g.art, g.an, g.sprache]), [['kunde', 'ayse@kunde.test', 'tr']])
  const r2 = await gespraechAktion(db, HASAN, ein, h)
  assertEquals((r2.daten as Any).schon, true)
  assertEquals((db.tabelle('kunden').find((x) => x.id === 'k_1') as Any).activities.length, 2)
  assertEquals((await gespraechAktion(db, HASAN, { ...ein, an: 'keine-adresse' }, h)).status, 400)
})
