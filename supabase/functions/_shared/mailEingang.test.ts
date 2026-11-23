// Tests: Prüfung neuer Mails im gemeinsamen Postfach (mailEingang.ts). Datenbank im Speicher (mit ilike, das
// testDoppel.ts nicht kennt), KI als nachgebaute Antwort — ohne Netz.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { absenderHinweis, klassifiziereEingang, likeMaskiert, nachDemSpeichern, verbindlichkeitAusERechnung, versucheAutomatischeZuordnung } from './mailEingang.ts'
import { erzeugeXRechnung, kaeuferAusAnschrift, verkaeuferAusBriefkopf } from './eRechnung/erzeugen.ts'
import { leseERechnung } from './eRechnung/lesen.ts'

type Zeile = Record<string, unknown>

/** ilike-Muster → regulärer Ausdruck (mit `\` als Fluchtzeichen, wie in Postgres). */
function likeZuRegex(muster: string): RegExp {
  let r = ''
  for (let i = 0; i < muster.length; i++) {
    const c = muster[i]
    if (c === '\\' && i + 1 < muster.length) r += muster[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (c === '%') r += '.*'
    else if (c === '_') r += '.'
    else r += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${r}$`, 'i')
}

class Db {
  tabellen: Record<string, Zeile[]>
  /** Wird nach jedem Lesen aufgerufen — damit lässt sich eine gleichzeitige Änderung im Browser nachstellen. */
  nachLesen: ((tabelle: string) => void) | null = null
  /** Tabelle, deren Änderungen scheitern sollen (Fehler der Datenbank nachstellen). */
  updateScheitertIn: string | null = null
  /** Dateien im Speicher je „eimer/pfad“ (für E-Rechnungs-Anhänge). */
  dateien = new Map<string, Uint8Array>()
  readonly storage = {
    from: (eimer: string) => ({
      download: (pfad: string) => {
        const b = this.dateien.get(`${eimer}/${pfad}`)
        return Promise.resolve(b ? { data: new Blob([b as BlobPart]), error: null } : { data: null, error: { message: 'nicht gefunden' } })
      },
    }),
  }
  constructor(t: Record<string, Zeile[]>) {
    this.tabellen = t
  }
  from(tabelle: string) {
    return new Abfrage(this, tabelle)
  }
}

type Ergebnis = { data: unknown; error: { code?: string; message: string } | null }

class Abfrage implements PromiseLike<Ergebnis> {
  private art: 'select' | 'update' | 'insert' = 'select'
  private filter: ((z: Zeile) => boolean)[] = []
  private nutzlast: Zeile | null = null
  private grenze = Infinity
  private einzel = false
  constructor(private db: Db, private tabelle: string) {}
  select() {
    return this
  }
  update(n: Zeile) {
    this.art = 'update'
    this.nutzlast = n
    return this
  }
  insert(n: Zeile) {
    this.art = 'insert'
    this.nutzlast = n
    return this
  }
  eq(s: string, w: unknown) {
    this.filter.push((z) => z[s] === w)
    return this
  }
  is(s: string, w: unknown) {
    this.filter.push((z) => (w === null ? z[s] == null : z[s] === w))
    return this
  }
  neq(s: string, w: unknown) {
    this.filter.push((z) => z[s] != null && z[s] !== w)
    return this
  }
  ilike(s: string, muster: string) {
    const r = likeZuRegex(muster)
    this.filter.push((z) => typeof z[s] === 'string' && r.test(z[s] as string))
    return this
  }
  limit(n: number) {
    this.grenze = n
    return this
  }
  maybeSingle() {
    this.einzel = true
    return this
  }
  then<A = Ergebnis, B = never>(ok?: ((e: Ergebnis) => A | PromiseLike<A>) | null, fehler?: ((g: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return Promise.resolve(this.ausfuehren()).then(ok, fehler)
  }
  private ausfuehren(): Ergebnis {
    const zeilen = (this.db.tabellen[this.tabelle] ??= [])
    if (this.art === 'insert') {
      zeilen.push({ ...this.nutzlast })
      return { data: null, error: null }
    }
    const treffer = zeilen.filter((z) => this.filter.every((f) => f(z)))
    if (this.art === 'update') {
      if (this.db.updateScheitertIn === this.tabelle) return { data: null, error: { message: 'Testfehler' } }
      for (const z of treffer) Object.assign(z, structuredClone(this.nutzlast))
      return { data: treffer.map((z) => ({ id: z.id })), error: null }
    }
    const aus = treffer.slice(0, this.grenze).map((z) => structuredClone(z))
    this.db.nachLesen?.(this.tabelle)
    return { data: this.einzel ? (aus[0] ?? null) : aus, error: null }
  }
}

// Ohne KI-Schlüssel antworten die KI-Helfer ohne Netz (Relevanz „kunde“, keine Telefonnummer, keine Rechnung).
Deno.env.delete('ANTHROPIC_API_KEY')

const MITARBEITER = [{ email: 'info@fahrschule-groeber.de' }, { email: 'eray@example.de' }]

Deno.test('Zuordnung: private Akte mit derselben Adresse bekommt keine Mail des gemeinsamen Postfachs', async () => {
  const db = new Db({
    mitarbeiter: [...MITARBEITER],
    kunden: [{ id: 'k_privat', bereich: 'privat', firma: 'Privatkontakt', email: 'kunde@firma.de', dokumente: [], activities: [] }],
  })
  const z = await versucheAutomatischeZuordnung(db, 'kunde@firma.de', 'Kunde', 'Hallo', 'Text', [])
  assertEquals(z, null)
  assertEquals((db.tabellen.kunden[0].activities as unknown[]).length, 0)
})

Deno.test('Zuordnung: Mayer-Akte wird gefunden, auch wenn dieselbe Adresse zusätzlich privat angelegt ist', async () => {
  const db = new Db({
    mitarbeiter: [...MITARBEITER],
    kunden: [
      { id: 'k_privat', bereich: 'privat', firma: 'Privatkontakt', email: 'kunde@firma.de', dokumente: [], activities: [] },
      { id: 'k_mayer', bereich: 'beratung', firma: 'Firma GmbH', ansprechpartner: 'Frau K', email: 'Kunde@Firma.de', dokumente: [], activities: [] },
    ],
  })
  const z = await versucheAutomatischeZuordnung(db, 'kunde@firma.de', 'Kunde', 'Hallo', 'Text', [])
  assertEquals(z?.kundeId, 'k_mayer')
  assertEquals((db.tabellen.kunden[0].activities as unknown[]).length, 0)
  assertEquals((db.tabellen.kunden[1].activities as unknown[]).length, 1)
})

Deno.test('Zuordnung: Mitarbeiter-Adresse wird nie einer Akte zugeordnet', async () => {
  const db = new Db({
    mitarbeiter: [...MITARBEITER],
    kunden: [{ id: 'k_fs', bereich: 'immobilienkunden', firma: 'Fahrschule', email: 'info@fahrschule-groeber.de', dokumente: [], activities: [] }],
  })
  assertEquals(await versucheAutomatischeZuordnung(db, 'INFO@fahrschule-groeber.de', 'Fahrschule', 'x', 'y', []), null)
})

Deno.test('Zuordnung: „_“ in der Adresse ist kein Platzhalter', async () => {
  const db = new Db({
    mitarbeiter: [],
    kunden: [
      { id: 'k_1', bereich: 'beratung', firma: 'A', email: 'max_muster@firma.de', dokumente: [], activities: [] },
      { id: 'k_2', bereich: 'beratung', firma: 'B', email: 'maxXmuster@firma.de', dokumente: [], activities: [] },
    ],
  })
  assertEquals(likeMaskiert('max_muster@firma.de'), 'max\\_muster@firma.de')
  // Ohne Maskierung träfe das Muster beide Akten (zwei Treffer → keine Zuordnung).
  const z = await versucheAutomatischeZuordnung(db, 'max_muster@firma.de', 'Max', 'x', 'y', [])
  assertEquals(z?.kundeId, 'k_1')
})

Deno.test('Zuordnung: eine zwischendurch im Browser gespeicherte Änderung der Akte bleibt erhalten', async () => {
  const db = new Db({
    mitarbeiter: [],
    kunden: [{ id: 'k_1', bereich: 'beratung', firma: 'A', ansprechpartner: 'B', email: 'a@firma.de', dokumente: [{ id: 'alt' }], activities: [{ id: 'alt' }] }],
  })
  let einmal = false
  db.nachLesen = (t) => {
    if (t !== 'kunden' || einmal) return
    einmal = true
    // Während die Telefonnummer per KI gesucht wird, speichert jemand im Browser ein neues Dokument.
    const k = db.tabellen.kunden[0]
    k.dokumente = [{ id: 'aus-dem-browser' }, ...(k.dokumente as Zeile[])]
    k.activities = [{ id: 'notiz-aus-dem-browser' }, ...(k.activities as Zeile[])]
  }
  const anhang = { filename: 'vertrag.pdf', size: 200_000, contentType: 'application/pdf', url: 'https://x/vertrag.pdf' }
  await versucheAutomatischeZuordnung(db, 'a@firma.de', 'A', 'Vertrag', 'Text', [anhang])
  const k = db.tabellen.kunden[0]
  const dokIds = (k.dokumente as Zeile[]).map((d) => d.id)
  assert(dokIds.includes('aus-dem-browser'), 'Dokument aus dem Browser ging verloren')
  assert(dokIds.includes('alt'))
  assertEquals((k.dokumente as Zeile[]).filter((d) => d.name === 'vertrag.pdf').length, 1)
  assert((k.activities as Zeile[]).some((a) => a.id === 'notiz-aus-dem-browser'), 'Verlaufseintrag aus dem Browser ging verloren')
})

Deno.test('Zuordnung: winzige Signatur-Logos landen nicht in den Dokumenten', async () => {
  const db = new Db({ mitarbeiter: [], kunden: [{ id: 'k_1', bereich: 'beratung', firma: 'A', email: 'a@firma.de', dokumente: [], activities: [] }] })
  await versucheAutomatischeZuordnung(db, 'a@firma.de', 'A', 'x', 'y', [
    { filename: 'image001.png', size: 4000, contentType: 'image/png', url: 'https://x/logo.png' },
    { filename: 'foto.jpg', size: 900_000, contentType: 'image/jpeg', url: 'https://x/foto.jpg' },
  ])
  assertEquals((db.tabellen.kunden[0].dokumente as Zeile[]).map((d) => d.name), ['foto.jpg'])
})

Deno.test('Absender-Hinweis: genaue Adresse, Firmen-Domain, nicht bei Allerwelts-Domains, privat und Mitarbeitern', async () => {
  const db = new Db({
    mitarbeiter: [...MITARBEITER],
    kunden: [
      { id: 'k_vhs', bereich: 'akademie', firma: 'VHS Augsburg', email: 'fabian.weber@vhs-augsburg.de' },
      { id: 'k_gmail', bereich: 'beratung', firma: 'Gmail-Kunde', email: 'jemand@gmail.com' },
      { id: 'k_privat', bereich: 'privat', firma: 'Geheim', email: 'freund@privatfirma.de' },
    ],
  })
  assertStringIncludes(String(await absenderHinweis(db, 'fabian.weber@vhs-augsburg.de')), 'als Kunde hinterlegt')
  assertStringIncludes(String(await absenderHinweis(db, 'tetyana.berkunova@vhs-augsburg.de')), '@vhs-augsburg.de gehört zur Kundenakte „VHS Augsburg“')
  assertEquals(await absenderHinweis(db, 'fremder@gmail.com'), null)
  assertEquals(await absenderHinweis(db, 'freund@privatfirma.de'), null)
  assertEquals(await absenderHinweis(db, 'kollege@privatfirma.de'), null)
  assertEquals(await absenderHinweis(db, 'eray@example.de'), null)
})

Deno.test('Einordnung: der Hinweis auf die Kundenakte geht an die KI mit', async () => {
  const db = new Db({ mitarbeiter: [], kunden: [{ id: 'k_vhs', bereich: 'akademie', firma: 'VHS Augsburg', email: 'fabian.weber@vhs-augsburg.de' }] })
  const echt = globalThis.fetch
  const gesendet: string[] = []
  Deno.env.set('ANTHROPIC_API_KEY', 'test')
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    gesendet.push(String(init?.body ?? ''))
    return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'tool_use', input: { kategorie: 'kunde' } }] }), { status: 200 }))
  }) as typeof fetch
  try {
    const r = await klassifiziereEingang(db, { von: 'tetyana.berkunova@vhs-augsburg.de', vonName: 'Tetyana', betreff: 'AW: TN-Liste zum Ausdruck', text: 'Anbei die Liste' })
    assertEquals(r, 'kunde')
    assertEquals(gesendet.length, 1)
    assertStringIncludes(gesendet[0], 'Hinweis aus dem CRM')
    assertStringIncludes(gesendet[0], 'VHS Augsburg')
    // Unbekannter Absender: kein Hinweis.
    await klassifiziereEingang(db, { von: 'news@shop.de', vonName: 'Shop', betreff: 'Rabatt', text: '50 %' })
    assert(!gesendet[1].includes('Hinweis aus dem CRM'))
  } finally {
    globalThis.fetch = echt
    Deno.env.delete('ANTHROPIC_API_KEY')
  }
})

Deno.test('Nach dem Speichern: Zuordnung wird an der gespeicherten Mail nachgetragen, nicht relevante bleiben ohne', async () => {
  const db = new Db({
    mitarbeiter: [],
    kunden: [{ id: 'k_1', bereich: 'erben', firma: 'A', ansprechpartner: 'B', email: 'a@firma.de', dokumente: [], activities: [] }],
    eingegangene_emails: [{ id: 'm1', message_id: '<1@x>' }, { id: 'm2', message_id: '<2@x>' }],
  })
  const mail = { messageId: '<1@x>', von: 'a@firma.de', vonName: 'A', betreff: 'Frage', text: 'Text', anhaenge: [] }
  const z = await nachDemSpeichern(db, 'm1', mail, 'kunde')
  assertEquals(z?.kundeId, 'k_1')
  assertEquals(db.tabellen.eingegangene_emails[0].zugewiesener_kunde_id, 'k_1')
  assertEquals(db.tabellen.eingegangene_emails[0].zugewiesener_bereich, 'erben')
  assertEquals(await nachDemSpeichern(db, 'm2', { ...mail, messageId: '<2@x>' }, 'nicht_relevant'), null)
  assertEquals(db.tabellen.eingegangene_emails[1].zugewiesener_kunde_id, undefined)
  assertEquals((db.tabellen.kunden[0].activities as unknown[]).length, 1)
})

Deno.test('Nach dem Speichern: schon vom Zeitplan zugeordnete Mail wird nicht noch einmal zur Akte gelegt', async () => {
  const db = new Db({
    mitarbeiter: [],
    kunden: [{ id: 'k_1', bereich: 'beratung', firma: 'A', ansprechpartner: 'B', email: 'a@firma.de', dokumente: [], activities: [{ id: 'vom-zeitplan' }] }],
    eingegangene_emails: [{ id: 'm1', message_id: '<1@x>', zugewiesener_kunde_id: 'k_1' }],
  })
  const anhang = { filename: 'vertrag.pdf', size: 200_000, contentType: 'application/pdf', url: 'https://x/vertrag.pdf' }
  const z = await nachDemSpeichern(db, 'm1', { messageId: '<1@x>', von: 'a@firma.de', vonName: 'A', betreff: 'Vertrag', text: 'Text', anhaenge: [anhang] }, 'kunde')
  assertEquals(z, null)
  assertEquals((db.tabellen.kunden[0].activities as unknown[]).length, 1)
  assertEquals((db.tabellen.kunden[0].dokumente as unknown[]).length, 0)
})

Deno.test('Zuordnung: ein Anhang, der schon in der Akte liegt (gleiche Adresse), wird nicht doppelt abgelegt', async () => {
  const anhang = { filename: 'vertrag.pdf', size: 200_000, contentType: 'application/pdf', url: 'https://x/vertrag.pdf' }
  const db = new Db({
    mitarbeiter: [],
    kunden: [{ id: 'k_1', bereich: 'beratung', firma: 'A', ansprechpartner: 'B', email: 'a@firma.de', dokumente: [{ id: 'd1', name: 'vertrag.pdf', url: anhang.url }], activities: [] }],
    eingegangene_emails: [{ id: 'm1', message_id: '<1@x>' }],
  })
  const z = await nachDemSpeichern(db, 'm1', { messageId: '<1@x>', von: 'a@firma.de', vonName: 'A', betreff: 'Vertrag', text: 'Text', anhaenge: [anhang] }, 'kunde')
  assertEquals(z?.kundeId, 'k_1')
  assertEquals((db.tabellen.kunden[0].dokumente as Zeile[]).length, 1)
  assertEquals(db.tabellen.eingegangene_emails[0].zugewiesener_kunde_id, 'k_1')
  assert(!String((db.tabellen.kunden[0].activities as Zeile[])[0].text).includes('Anhang'), 'kein „Anhang abgelegt“, wenn nichts abgelegt wurde')
})

Deno.test('Zuordnung: scheitert das Ergänzen der Akte, bleibt die Mail unzugeordnet', async () => {
  const db = new Db({
    mitarbeiter: [],
    kunden: [{ id: 'k_1', bereich: 'beratung', firma: 'A', ansprechpartner: 'B', email: 'a@firma.de', dokumente: [], activities: [] }],
    eingegangene_emails: [{ id: 'm1', message_id: '<1@x>' }],
  })
  db.updateScheitertIn = 'kunden'
  const z = await nachDemSpeichern(db, 'm1', { messageId: '<1@x>', von: 'a@firma.de', vonName: 'A', betreff: 'Frage', text: 'Text', anhaenge: [] }, 'kunde')
  assertEquals(z, null)
  assertEquals(db.tabellen.eingegangene_emails[0].zugewiesener_kunde_id, null)
})

// ---------------------------------------------------------------------------------------------
// Modul E-Rechnung (abschaltbar, siehe src/module/eRechnung/README.md)

Deno.env.set('SUPABASE_URL', 'https://test.supabase.co')

function eRechnung(verkaeuferName = 'Beispiel Lieferant GmbH'): string {
  const { verkaeufer, iban } = verkaeuferAusBriefkopf(
    { name: verkaeuferName, fusszeilen: [`${verkaeuferName} · Musterstraße 3 · 89075 Ulm`, 'Sparkasse · IBAN: DE02 1203 0000 0000 2020 51 · Steuernummer 88 123 456 789', 'Tel.: 0731 123 456 · GF: Erika Muster'] },
    'rechnung@beispiel.de',
  )
  return erzeugeXRechnung({
    nummer: 'RE-2026-077', datum: '2026-11-20', faellig: '2026-12-04', verkaeufer, iban,
    kaeufer: kaeuferAusAnschrift('Mayer Holding UG\nSchwabstr. 3\n89075 Ulm', 'Mayer Holding UG', 'info@amayer-holding.com'), kaeuferReferenz: 'k1',
    positionen: [{ bezeichnung: 'Beratung', menge: 2.5, einheit: 'Stunde', einzelpreis: 120 }], ustSatz: 19,
  })
}

function eRechnungsDb(modul: boolean, xml: string): Db {
  const db = new Db({ mitarbeiter: [], kunden: [], eingegangene_emails: [{ id: 'm1', message_id: '<1@x>' }], verbindlichkeiten: [], crm_module: [{ id: 'e_rechnung', aktiv: modul }] })
  db.dateien.set('email-anhaenge/er/xrechnung.xml', new TextEncoder().encode(xml))
  return db
}

const ER_MAIL = {
  messageId: '<1@x>', von: 'rechnung@beispiel.de', vonName: 'Beispiel Lieferant', betreff: 'Unterlagen', text: 'Guten Tag, anbei wie besprochen.',
  anhaenge: [{ filename: 'xrechnung.xml', size: 5000, contentType: 'application/xml', url: 'https://test.supabase.co/storage/v1/object/public/email-anhaenge/er/xrechnung.xml' }],
}

Deno.test('E-Rechnung im Anhang: Mail wird Lieferantenrechnung mit genauen Angaben, auch ohne KI und ohne Hinweis im Text', async () => {
  const db = eRechnungsDb(true, eRechnung())
  await nachDemSpeichern(db, 'm1', ER_MAIL, 'nicht_relevant')
  assertEquals(db.tabellen.verbindlichkeiten.length, 1)
  const v = db.tabellen.verbindlichkeiten[0]
  assertEquals([v.lieferant, v.lieferant_email, v.rechnungsnummer, v.datum, v.zahlungsziel], ['Beispiel Lieferant GmbH', 'rechnung@beispiel.de', 'RE-2026-077', '2026-11-20', '2026-12-04'])
  assertEquals([v.betrag_netto, v.betrag_brutto, v.quelle, v.quell_email_id], [300, 357, 'email-automatisch', '<1@x>'])
})

Deno.test('E-Rechnung im Anhang: Modul aus oder Datei kaputt → wie bisher (ohne KI-Schlüssel keine Verbindlichkeit)', async () => {
  const aus = eRechnungsDb(false, eRechnung())
  await nachDemSpeichern(aus, 'm1', ER_MAIL, 'nicht_relevant')
  assertEquals(aus.tabellen.verbindlichkeiten.length, 0)
  const xml = eRechnung()
  const kaputt = eRechnungsDb(true, xml.slice(0, Math.floor(xml.length / 2)))
  await nachDemSpeichern(kaputt, 'm1', ER_MAIL, 'nicht_relevant')
  assertEquals(kaputt.tabellen.verbindlichkeiten.length, 0)
})

Deno.test('E-Rechnung: eigene Rechnung der Mayer Holding ist keine Lieferantenrechnung, Gutschrift mit Minusbetrag', () => {
  assertEquals(verbindlichkeitAusERechnung(leseERechnung(eRechnung('Mayer Holding UG'))), null)
  // Gutschrift: Minusbetrag (mindert die Schuld)
  const gut = verbindlichkeitAusERechnung({ ...leseERechnung(eRechnung()), art: 'Gutschrift' })!
  assertEquals(gut.istRechnung, true)
  assert((gut.betragBrutto ?? 0) < 0 && (gut.betragNetto ?? 0) < 0)
  assertEquals(verbindlichkeitAusERechnung({ ...leseERechnung(eRechnung()), waehrung: 'USD' })?.betragBrutto, undefined)
})
