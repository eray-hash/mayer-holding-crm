// Tests für die Postfach-Helfer (kontakte_vorschlagen, werbung_aufraeumen) — mit Doppeln für Datenbank und Hotmail,
// ohne Netz. Alle Namen und Adressen sind erfunden.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  absenderCode,
  fuehrePostfachHelferAus,
  istPostfachHelferWerkzeug,
  kontaktVorschlagZeilen,
  POSTFACH_HELFER_WERKZEUGE,
  SEITE,
  SEITEN_HOECHSTENS,
  VERSCHIEBEN_HOECHSTENS,
  WERBE_ORDNER,
} from './postfachHelfer.ts'
import type { HotmailAufruf } from './personUeberblick.ts'

const ICH = 'privat.nutzer@hotmail.com'
const MS_ADRESSE = 'privat.nutzer@outlook.de'

// ---------- Datenbank-Doppel (nur lesen; Schreibversuche werden festgehalten) ----------

type Zeile = Record<string, unknown>
type Filter = { op: string; spalte: string; wert: unknown }

function passt(z: Zeile, f: Filter): boolean {
  const v = z[f.spalte]
  if (f.op === 'eq') return v !== null && v !== undefined && String(v) === String(f.wert)
  if (f.op === 'ilike') return typeof v === 'string' && v.toLowerCase() === String(f.wert).toLowerCase()
  throw new Error(`Operator ${f.op} fehlt im Doppel`)
}

class FalscheDb {
  abfragen: { tabelle: string; filter: Filter[] }[] = []
  schreibversuche: string[] = []
  constructor(public tabellen: Record<string, Zeile[]>) {}
  from(tabelle: string) {
    // deno-lint-ignore no-this-alias
    const db = this
    const filter: Filter[] = []
    let einzel = false
    const schreiben = () => {
      db.schreibversuche.push(tabelle)
      return q
    }
    const q = {
      select: () => q,
      eq: (spalte: string, wert: unknown) => (filter.push({ op: 'eq', spalte, wert }), q),
      ilike: (spalte: string, wert: unknown) => (filter.push({ op: 'ilike', spalte, wert }), q),
      maybeSingle: () => ((einzel = true), q),
      insert: schreiben,
      update: schreiben,
      upsert: schreiben,
      delete: schreiben,
      then: (ok: (r: { data: unknown; error: null }) => unknown, nein?: (e: unknown) => unknown) => {
        db.abfragen.push({ tabelle, filter: [...filter] })
        const zeilen = (db.tabellen[tabelle] ?? []).filter((z) => filter.every((f) => passt(z, f)))
        return Promise.resolve({ data: einzel ? zeilen[0] ?? null : structuredClone(zeilen), error: null }).then(ok, nein)
      },
    }
    return q
  }
}

function neueDb(kunden: Zeile[] = []) {
  return new FalscheDb({
    kunden,
    ms_konten: [{ login_email: ICH, ms_adresse: MS_ADRESSE }, { login_email: 'andere@beispiel.de', ms_adresse: 'andere@gmx.de' }],
    mitarbeiter: [{ email: 'kollege@mayer-beispiel.de' }, { email: ICH }],
    postfaecher: [{ adresse: 'info@mayer-beispiel.de' }],
    privat_einstellungen: [],
  })
}

// ---------- Hotmail-Doppel ----------

type P = [string, string] // [Name, Adresse]
type TestMail = { id: string; von: P; an?: P[]; cc?: P[]; betreff?: string; vorschau?: string; art?: string; relevant?: boolean; alterTage?: number }

const vor = (tage: number, minuten = 0) => new Date(Date.now() - tage * 864e5 - minuten * 6e4).toISOString()
const tn = ([name, adresse]: P) => ({ name, adresse })
function alsListe(m: TestMail, i: number) {
  return {
    id: m.id,
    von: tn(m.von),
    an: (m.an ?? [['', ICH]]).map(tn),
    cc: (m.cc ?? []).map(tn),
    betreff: m.betreff ?? 'Hallo',
    datum: vor(m.alterTage ?? 1, i),
    vorschau: m.vorschau ?? '',
    art: m.art ?? 'unwichtig',
    relevant: m.relevant ?? true,
  }
}

type Aufruf = Record<string, unknown>
function neuesPostfach(eingang: TestMail[], gesendet: TestMail[], o: { ordner?: { id: string; name: string; pfad: string }[]; endlos?: boolean } = {}) {
  const aufrufe: Aufruf[] = []
  const ordner = [...(o.ordner ?? [{ id: 'ORD-EINGANG', name: 'Posteingang', pfad: 'Posteingang' }])]
  const listen: Record<string, ReturnType<typeof alsListe>[]> = { inbox: eingang.map(alsListe), sentitems: gesendet.map(alsListe) }
  const hotmail: HotmailAufruf = (body) => {
    aufrufe.push(body)
    const ok = (daten: Record<string, unknown>) => Promise.resolve({ ok: true, status: 200, daten })
    if (body.action === 'outlook_liste') {
      const ab = Number(body.ab) || 0
      const anzahl = Number(body.anzahl) || 30
      if (o.endlos && body.ordner === 'inbox') {
        const mails = Array.from({ length: anzahl }, (_, i) => alsListe({ id: `E${ab + i}`, von: [`Person ${ab + i}`, `person${ab + i}@gmx.de`] }, ab + i))
        return ok({ mails, ausgeblendet: 0, weiter: true, naechstesAb: ab + anzahl })
      }
      const alle = listen[String(body.ordner)] ?? []
      return ok({ mails: alle.slice(ab, ab + anzahl), ausgeblendet: 0, weiter: ab + anzahl < alle.length, naechstesAb: ab + anzahl })
    }
    if (body.action === 'outlook_ordner') return ok({ ordner })
    if (body.action === 'outlook_ordner_anlegen') {
      const neu = { id: 'ORD-WERBUNG-NEU', name: String(body.name), pfad: String(body.name) }
      ordner.push(neu)
      return ok({ id: neu.id, name: neu.name, neu: true })
    }
    if (body.action === 'outlook_verschieben') return ok({ ok: true, id: `neu-${body.id}` })
    return Promise.resolve({ ok: false, status: 400, daten: { error: `unerwartete Aktion ${body.action}` } })
  }
  return { hotmail, aufrufe }
}

const kontext = (db: FalscheDb, hotmail: HotmailAufruf, protokoll: string[] = []) => ({
  supabase: db,
  mitarbeiter: { email: ICH, name: 'Privat Nutzer' },
  protokolliere: (t: string) => void protokoll.push(t),
  hotmail,
  outlookVerbunden: true,
})

// ---------- Daten für kontakte_vorschlagen ----------

const KUNDEN: Zeile[] = [
  { id: 'k1', bereich: 'privat', verantwortlich_email: ICH, ansprechpartner: 'Bernd Beispiel', firma: null, email: 'bernd@beispiel-firma.de' },
  { id: 'k2', bereich: 'privat', verantwortlich_email: ICH, ansprechpartner: 'Clara Muster', firma: null, email: null },
  // Kontakt eines ANDEREN Mitarbeiters — darf nichts herausfiltern.
  { id: 'k3', bereich: 'privat', verantwortlich_email: 'andere@beispiel.de', ansprechpartner: 'Dora Probe', firma: null, email: 'dora.probe@web.de' },
  // Eigener, aber kein privater Kontakt — zählt nicht als privater Kontakt.
  { id: 'k4', bereich: 'beratung', verantwortlich_email: ICH, ansprechpartner: 'Emil Test', firma: null, email: 'emil@beispiel-werk.de' },
]

const ANNA: P = ['Anna Beispiel', 'anna.beispiel@gmx.de']
const EINGANG_K: TestMail[] = [
  { id: 'a1', von: ANNA, vorschau: 'Viele Grüße, Anna Beispiel, Beispiel Bau GmbH' },
  { id: 'a2', von: ANNA, alterTage: 40 },
  ...[1, 2, 3, 4].map((i) => ({ id: `b${i}`, von: ['Bernd Beispiel', 'bernd@beispiel-firma.de'] as P })),
  ...[1, 2, 3].map((i) => ({ id: `c${i}`, von: ['Clara Muster', 'clara.muster@gmx.de'] as P })),
  { id: 'd1', von: ['Dora Probe', 'dora.probe@web.de'] },
  ...[1, 2, 3, 4, 5].map((i) => ({ id: `n${i}`, von: ['Shop', 'news@shop-beispiel.de'] as P, art: 'werbung' })),
  ...[1, 2, 3, 4].map((i) => ({ id: `v${i}`, von: ['Max Verkauf', 'max.verkauf@shop-beispiel.de'] as P, art: 'werbung', betreff: 'Nur heute: 30 % Rabatt' })),
  ...[1, 2, 3].map((i) => ({ id: `r${i}`, von: ['Dienst', 'noreply@dienst-beispiel.de'] as P })),
  ...[1, 2, 3].map((i) => ({ id: `l${i}`, von: ['Netzwerk', 'mitteilungen@linkedin.com'] as P })),
  ...[1, 2, 3].map((i) => ({ id: `m${i}`, von: ['Kollege', 'kollege@mayer-beispiel.de'] as P })),
  ...[1, 2, 3].map((i) => ({ id: `g${i}`, von: ['Geschäftsführung', 'chef@mayer-beispiel.de'] as P })),
  // Uralt — außerhalb des Zeitraums.
  ...[1, 2, 3].map((i) => ({ id: `alt${i}`, von: ['Alte Bekannte', 'alte.bekannte@gmx.de'] as P, alterTage: 500 })),
]
const GESENDET_K: TestMail[] = [
  { id: 's1', von: ['', ICH], an: [ANNA] },
  { id: 's2', von: ['', ICH], an: [ANNA] },
  { id: 's3', von: ['', ICH], an: [['Kollege', 'kollege@mayer-beispiel.de']], cc: [ANNA, ['', MS_ADRESSE]] },
  { id: 's4', von: ['', ICH], an: [['Bernd Beispiel', 'bernd@beispiel-firma.de']] },
  { id: 's5', von: ['', ICH], an: [['Clara Muster', 'c.muster@web.de']] },
  { id: 's6', von: ['', ICH], an: [['Dora Probe', 'dora.probe@web.de']] },
  { id: 's7', von: ['', ICH], an: [['Emil Test', 'emil@beispiel-werk.de']] },
  // Rundmail an 12 Empfänger zählt nicht.
  { id: 's8', von: ['', ICH], an: Array.from({ length: 12 }, (_, i) => [`Rund ${i}`, `rundmail${i}@gmx.de`] as P) },
]

// ---------- Werkzeug-Definitionen ----------

Deno.test('Werkzeuge sind definiert und erkennbar', () => {
  assertEquals(POSTFACH_HELFER_WERKZEUGE.map((w) => w.name), ['kontakte_vorschlagen', 'werbung_aufraeumen'])
  assert(istPostfachHelferWerkzeug('werbung_aufraeumen'))
  assert(!istPostfachHelferWerkzeug('kunde_anlegen'))
})

Deno.test('ohne verbundenes Microsoft-Konto: Fehler, kein Hotmail-Aufruf', async () => {
  const { hotmail, aufrufe } = neuesPostfach([], [])
  const r = await fuehrePostfachHelferAus('kontakte_vorschlagen', {}, { ...kontext(neueDb(), hotmail), outlookVerbunden: false })
  assertStringIncludes(r, 'kein Microsoft-Konto')
  assertEquals(aufrufe.length, 0)
})

// ---------- kontakte_vorschlagen ----------

Deno.test('kontakte_vorschlagen zählt beide Richtungen und filtert Kontakte, Werbung, System, Mayer, eigene Adressen', async () => {
  const db = neueDb(KUNDEN)
  const { hotmail, aufrufe } = neuesPostfach(EINGANG_K, GESENDET_K)
  const protokoll: string[] = []
  const r = await fuehrePostfachHelferAus('kontakte_vorschlagen', {}, kontext(db, hotmail, protokoll))

  // Anna: 3× an sie (einmal in Kopie), 2× von ihr — steht oben, Firma aus der Signatur.
  const zeilen = r.split('\n')
  const anna = zeilen.find((z) => z.startsWith('1. '))
  assert(anna, r)
  assertStringIncludes(anna, 'Anna Beispiel')
  assertStringIncludes(anna, 'anna.beispiel@gmx.de')
  assertStringIncludes(anna, '3× gesendet, 2× empfangen')
  assertStringIncludes(anna, 'Firma: Beispiel Bau GmbH')
  assertStringIncludes(anna, 'letzte Mail')

  // Kontakt eines anderen Mitarbeiters und eigener Nicht-Privat-Kontakt werden trotzdem vorgeschlagen.
  assertStringIncludes(r, 'Dora Probe')
  assertStringIncludes(r, 'Emil Test')
  assertStringIncludes(r, 'Firma: beispiel-werk.de (aus der Adresse)')

  // Herausgefiltert.
  for (const raus of ['bernd@', 'Clara', 'c.muster', 'shop-beispiel', 'Max Verkauf', 'noreply', 'linkedin', 'mayer-beispiel', MS_ADRESSE, 'rundmail', 'alte.bekannte']) {
    assert(!r.includes(raus), `„${raus}“ darf nicht vorkommen:\n${r}`)
  }
  assertStringIncludes(r, 'Noch nichts angelegt')
  assertStringIncludes(r, 'kunde_anlegen')
  assertStringIncludes(r, 'Vollständig: ja')

  // Nur gelesen: keine Schreibversuche, keine Verschiebe-Aktionen; Kontakte nur mit Besitzer-Bedingung abgefragt.
  assertEquals(db.schreibversuche, [])
  assert(aufrufe.every((a) => a.action === 'outlook_liste'))
  const kundenAbfragen = db.abfragen.filter((a) => a.tabelle === 'kunden')
  assert(kundenAbfragen.length > 0)
  for (const a of kundenAbfragen) {
    assert(a.filter.some((f) => f.spalte === 'verantwortlich_email' && String(f.wert) === ICH))
    assert(a.filter.some((f) => f.spalte === 'bereich' && f.wert === 'privat'))
  }
  for (const a of db.abfragen.filter((x) => x.tabelle === 'ms_konten')) assert(a.filter.some((f) => f.spalte === 'login_email' && f.wert === ICH))
  assertEquals(protokoll.length, 1)
})

Deno.test('kontakte_vorschlagen: höchstens 10 Vorschläge', async () => {
  const vornamen = ['Anke', 'Berta', 'Carla', 'Doris', 'Edda', 'Frieda', 'Gerda', 'Hanna', 'Ilse', 'Jutta', 'Karla', 'Lotte', 'Mia', 'Nora', 'Olga']
  const gesendet: TestMail[] = vornamen.map((v, i) => ({ id: `s${i}`, von: ['', ICH] as P, an: [[`${v} Beispiel`, `${v.toLowerCase()}@web.de`] as P] }))
  const { hotmail } = neuesPostfach([], gesendet)
  const r = await fuehrePostfachHelferAus('kontakte_vorschlagen', {}, kontext(neueDb(), hotmail))
  assertEquals(r.split('\n').filter((z) => /^\d+\. /.test(z)).length, 10)
  assertStringIncludes(r, '(10 von 15;')
})

Deno.test('kontakte_vorschlagen: Grenzen-Hinweis, wenn nicht alles gelesen wurde', async () => {
  const { hotmail, aufrufe } = neuesPostfach([], [], { endlos: true })
  const r = await fuehrePostfachHelferAus('kontakte_vorschlagen', {}, kontext(neueDb(), hotmail))
  assertStringIncludes(r, 'Vollständig: nein')
  assertStringIncludes(r, `Posteingang: nur die neuesten ${(SEITE * SEITEN_HOECHSTENS).toLocaleString('de-DE')} Mails gelesen`)
  assertEquals(aufrufe.filter((a) => a.ordner === 'inbox').length, SEITEN_HOECHSTENS)
})

Deno.test('kontaktVorschlagZeilen: eine Zeile für den Wochenrückblick, leer ohne Treffer oder Konto', async () => {
  const { hotmail } = neuesPostfach(EINGANG_K, GESENDET_K)
  const zeilen = await kontaktVorschlagZeilen(neueDb(KUNDEN), ICH, hotmail, true)
  assertEquals(zeilen.length, 1)
  assertStringIncludes(zeilen[0], '1 neuer häufiger Mail-Partner')
  assertStringIncludes(zeilen[0], 'Anna Beispiel')
  assertStringIncludes(zeilen[0], '„Kontakte vorschlagen“')

  const leer = neuesPostfach([], [])
  assertEquals(await kontaktVorschlagZeilen(neueDb(KUNDEN), ICH, leer.hotmail, true), [])
  assertEquals(await kontaktVorschlagZeilen(neueDb(KUNDEN), ICH, hotmail, false), [])
})

// ---------- werbung_aufraeumen ----------

const EINGANG_W: TestMail[] = [
  ...[1, 2, 3].map((i) => ({ id: `shop${i}`, von: ['Beispiel-Shop', `news@mail.shop-beispiel.de`] as P, art: 'werbung', betreff: `Newsletter ${i}: 20 % Rabatt` })),
  ...[1, 2].map((i) => ({ id: `reise${i}`, von: ['Reise', 'angebote@reise-beispiel.de'] as P, art: 'werbung', betreff: `Sommerangebot ${i}` })),
  // Verein: werbeartig, aber er schreibt selbst dorthin → bleibt.
  { id: 'verein1', von: ['Verein', 'newsletter@verein-beispiel.de'], art: 'werbung', betreff: 'Vereinsnews' },
  // Privatperson mit Freemail, nur „Sonstige“ → keine Werbung.
  { id: 'freund1', von: ['Ein Freund', 'ein.freund@gmx.de'], art: 'werbung', relevant: false, betreff: 'Treffen am Samstag?' },
  // Sicherheitscode und Rechnung → nie Werbung.
  { id: 'code1', von: ['Bank', 'noreply@bank-beispiel.de'], art: 'code', betreff: 'Ihr Code' },
  { id: 'rech1', von: ['Versorger', 'service@versorger-beispiel.de'], art: 'rechnung', betreff: 'Ihre Rechnung' },
  // Zu alt für 90 Tage.
  { id: 'shopalt', von: ['Beispiel-Shop', 'news@shop-beispiel.de'], art: 'werbung', alterTage: 200 },
]
const GESENDET_W: TestMail[] = [{ id: 'sv1', von: ['', ICH], an: [['Verein', 'newsletter@verein-beispiel.de']] }]

const verschoben = (aufrufe: Aufruf[]) => aufrufe.filter((a) => a.action === 'outlook_verschieben')
const SHOP = absenderCode('shop-beispiel.de')
const REISE = absenderCode('reise-beispiel.de')

Deno.test('werbung_aufraeumen Vorschau: Absender mit Anzahl und Code, ändert nichts', async () => {
  const db = neueDb(KUNDEN)
  const { hotmail, aufrufe } = neuesPostfach(EINGANG_W, GESENDET_W)
  const r = await fuehrePostfachHelferAus('werbung_aufraeumen', {}, kontext(db, hotmail))
  assertStringIncludes(r, `- shop-beispiel.de · 3 Mails · gruppe=${SHOP}`)
  assertStringIncludes(r, `- reise-beispiel.de · 2 Mails · gruppe=${REISE}`)
  assert(r.indexOf('shop-beispiel.de') < r.indexOf('reise-beispiel.de'))
  for (const raus of ['verein-beispiel', 'gmx.de', 'bank-beispiel', 'versorger-beispiel']) assert(!r.includes(raus), `„${raus}“ darf nicht vorkommen:\n${r}`)
  assertStringIncludes(r, '1 werbeartige Mails von Kontakten oder Leuten, denen er schreibt')
  assertStringIncludes(r, 'Noch nichts verschoben')
  // Nichts verändert: nur Listen gelesen.
  assert(aufrufe.every((a) => a.action === 'outlook_liste'), JSON.stringify(aufrufe.map((a) => a.action)))
  assertEquals(db.schreibversuche, [])
})

Deno.test('werbung_aufraeumen Anwenden: nur die genannten Absender, Ordner wird angelegt, wenn er fehlt', async () => {
  const { hotmail, aufrufe } = neuesPostfach(EINGANG_W, GESENDET_W)
  const protokoll: string[] = []
  const r = await fuehrePostfachHelferAus('werbung_aufraeumen', { bestaetigt: true, gruppen: [SHOP] }, kontext(neueDb(KUNDEN), hotmail, protokoll))
  const v = verschoben(aufrufe)
  assertEquals(v.map((a) => a.id).sort(), ['shop1', 'shop2', 'shop3'])
  assert(v.every((a) => a.ordner === 'ORD-WERBUNG-NEU'))
  const anlegen = aufrufe.filter((a) => a.action === 'outlook_ordner_anlegen')
  assertEquals(anlegen.length, 1)
  assertEquals(anlegen[0].name, WERBE_ORDNER)
  assertStringIncludes(r, 'verschoben: 3 Mails')
  assertStringIncludes(r, 'neu angelegt')
  assertStringIncludes(r, 'Nichts wurde gelöscht')
  assert(!aufrufe.some((a) => String(a.ordner ?? '').toLowerCase() === 'deleteditems'))
  assertEquals(protokoll.length, 1)
})

Deno.test('werbung_aufraeumen Anwenden über Absenderliste, vorhandener Ordner wird benutzt', async () => {
  const { hotmail, aufrufe } = neuesPostfach(EINGANG_W, GESENDET_W, {
    ordner: [
      { id: 'ORD-ARCHIV', name: 'Archiv', pfad: 'Archiv' },
      { id: 'ORD-UNTER', name: 'Werbung', pfad: 'Archiv › Werbung' },
      { id: 'ORD-WERBUNG', name: 'Werbung', pfad: 'Werbung' },
    ],
  })
  const r = await fuehrePostfachHelferAus('werbung_aufraeumen', { bestaetigt: true, absender: ['reise-beispiel.de', 'unbekannt-beispiel.de'] }, kontext(neueDb(KUNDEN), hotmail))
  const v = verschoben(aufrufe)
  assertEquals(v.map((a) => a.id).sort(), ['reise1', 'reise2'])
  assert(v.every((a) => a.ordner === 'ORD-WERBUNG'))
  assertEquals(aufrufe.filter((a) => a.action === 'outlook_ordner_anlegen').length, 0)
  assert(!r.includes('neu angelegt'))
  assertStringIncludes(r, 'Nicht gefunden (nichts verschoben): unbekannt-beispiel.de')
})

Deno.test('werbung_aufraeumen: bestaetigt ohne Auswahl verschiebt nichts', async () => {
  const { hotmail, aufrufe } = neuesPostfach(EINGANG_W, GESENDET_W)
  const r = await fuehrePostfachHelferAus('werbung_aufraeumen', { bestaetigt: true }, kontext(neueDb(KUNDEN), hotmail))
  assertStringIncludes(r, 'Nichts verschoben')
  assertEquals(verschoben(aufrufe).length, 0)
  assertEquals(aufrufe.filter((a) => a.action === 'outlook_ordner_anlegen').length, 0)
})

Deno.test('werbung_aufraeumen: Grenze je Lauf mit Hinweis auf weitere', async () => {
  const viele: TestMail[] = Array.from({ length: VERSCHIEBEN_HOECHSTENS + 50 }, (_, i) => ({ id: `massen${i}`, von: ['Massen', 'werbung@massen-beispiel.de'] as P, art: 'werbung', alterTage: 1 + (i % 30) }))
  const { hotmail, aufrufe } = neuesPostfach(viele, [])
  const vorschau = await fuehrePostfachHelferAus('werbung_aufraeumen', {}, kontext(neueDb(), hotmail))
  assertStringIncludes(vorschau, `${(VERSCHIEBEN_HOECHSTENS + 50).toLocaleString('de-DE')} Mails`)
  const r = await fuehrePostfachHelferAus('werbung_aufraeumen', { bestaetigt: true, gruppen: [absenderCode('massen-beispiel.de')] }, kontext(neueDb(), hotmail))
  assertEquals(verschoben(aufrufe).length, VERSCHIEBEN_HOECHSTENS)
  assertStringIncludes(r, `verschoben: ${VERSCHIEBEN_HOECHSTENS} Mails`)
  assertStringIncludes(r, 'Es gibt weitere 50 Werbe-Mails')
})

Deno.test('werbung_aufraeumen: fehlgeschlagene Verschiebungen werden gezählt', async () => {
  const { hotmail: basis, aufrufe } = neuesPostfach(EINGANG_W, GESENDET_W)
  const hotmail: HotmailAufruf = (body) =>
    body.action === 'outlook_verschieben' && body.id === 'shop2'
      ? (aufrufe.push(body), Promise.resolve({ ok: false, status: 404, daten: { error: 'Mail nicht gefunden.' } }))
      : basis(body)
  const r = await fuehrePostfachHelferAus('werbung_aufraeumen', { bestaetigt: true, gruppen: [SHOP] }, kontext(neueDb(KUNDEN), hotmail))
  assertStringIncludes(r, 'verschoben: 2 Mails, 1 fehlgeschlagen (Mail nicht gefunden.)')
})
