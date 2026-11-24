// Prüft die Post-Zuordnung (mailZuordnung.ts) ohne Netz: sichere Regeln (Absender, Verlauf, Betreff-Antwort),
// Vorschläge, Rundschreiben, Beanspruchen (jede Mail nur einmal), private Postfächer und den Trockenlauf.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import {
  type Kontext,
  type MailZeile,
  betreffIstAktenName,
  entscheide,
  istAntwortBetreff,
  kennungNorm,
  nameImText,
  normBetreff,
  ordneNeueMailsZu,
  rundschreibenHinweise,
  verlaufsKennungen,
} from './mailZuordnung.ts'

const JETZT = new Date('2026-11-22T12:00:00Z')
let zaehler = 0
function uuid(): string {
  zaehler++
  return `00000000-0000-4000-8000-${String(zaehler).padStart(12, '0')}`
}

const AKTEN: Zeile[] = [
  { id: 'k_lipps', bereich: 'beratung', firma: 'Christopher Lipps', ansprechpartner: 'Christopher Lipps', email: 'ch.lipps@googlemail.com', dokumente: [], activities: [] },
  { id: 'k_sanny', bereich: 'beratung', firma: 'Sanny (Sandra) Simpfendörfer', ansprechpartner: 'Sanny (Sandra) Simpfendörfer', email: 'sanny30390@gmail.com', dokumente: [], activities: [] },
  { id: 'k_hd', bereich: 'immobilienkunden', firma: 'Hotel Gasthof Hirsch Alfdorf (HD-IMMO, Helmut Dick)', ansprechpartner: 'Helmut Dick', email: 'info@hdimmo.de', dokumente: [], activities: [] },
  { id: 'k_mayr', bereich: 'erben', firma: 'Franz Mayr', ansprechpartner: 'Franz Mayr', email: 'franz.mayr@web.de', dokumente: [], activities: [] },
  { id: 'k_hfg', bereich: 'beratung', firma: 'HFG', ansprechpartner: 'André Sack', email: 'office@hfg-hh.de', dokumente: [], activities: [] },
  { id: 'k_doppelt1', bereich: 'beratung', firma: 'Eins', ansprechpartner: 'Eins', email: 'gemeinsam@firma-x.de', dokumente: [], activities: [] },
  { id: 'k_doppelt2', bereich: 'finanzierungen', firma: 'Zwei', ansprechpartner: 'Zwei', email: 'gemeinsam@firma-x.de', dokumente: [], activities: [] },
  { id: 'k_privat', bereich: 'privat', firma: 'Privat', ansprechpartner: 'Privat', email: 'privat@beispiel.de', dokumente: [], activities: [] },
  { id: 'k_groeber', bereich: 'immobilienkunden', firma: 'Fahrschule Gröber', ansprechpartner: 'Markus Gröber', email: 'info@fahrschule-groeber.de', dokumente: [], activities: [] },
]

const TEAM: Zeile[] = [
  { id: 'm1', name: 'Hasan Süslü', email: 'privat.gf@beispiel.de' },
  { id: 'm2', name: 'Andreas Mayer', email: 'aikidomayer@t-online.de' },
  { id: 'm3', name: 'Markus Gröber', email: 'info@fahrschule-groeber.de' },
]

const GESENDET: Zeile[] = [
  { id: uuid(), message_id: '<abc-123@amayer-holding.com>', an: 'sanny30390@gmail.com', betreff: 'Weitere Expertise zur Optimierung', kunde_id: 'k_sanny', gesendet_am: '2026-11-18T10:00:00Z', besitzer_email: null },
  { id: uuid(), message_id: '<def-456@amayer-holding.com>', an: 'kanzlei@bruestle-eberle.de', betreff: 'Schöllkopf ./. Mayer Holding', kunde_id: 'k_mayr', gesendet_am: '2026-11-10T10:00:00Z', besitzer_email: null },
  { id: uuid(), message_id: null, an: 'hans@grundkontor24.de', betreff: 'Unterlagen zum Verkauf zum Prüfen', kunde_id: 'k_hd', gesendet_am: '2026-11-10T10:00:00Z', besitzer_email: null },
  // Privat gesendet: zählt nie.
  { id: uuid(), message_id: 'pf_x:<priv-1@fundament-it.de>', an: 'jemand@firma-y.de', betreff: 'Privat', kunde_id: 'k_lipps', gesendet_am: '2026-11-10T10:00:00Z', besitzer_email: 'eray@fundament-it.de' },
]

function mail(felder: Partial<MailZeile> & Zeile): Zeile {
  return {
    id: uuid(),
    message_id: `<m${zaehler}@absender.test>`,
    von_name: '',
    betreff: '',
    ausschnitt: '',
    rohdaten: {},
    relevanz: 'kunde',
    ignoriert: false,
    besitzer_email: null,
    zugewiesener_kunde_id: null,
    zugewiesener_bereich: null,
    zugewiesener_kunde_name: null,
    anhaenge: null,
    zuordnung_vorschlag: null,
    zuordnung_geprueft_am: null,
    erstellt_am: '2026-11-22T11:00:00Z',
    mail_datum: '2026-11-22T11:00:00Z',
    ...felder,
  }
}

function datenbank(mails: Zeile[]): FalscheDatenbank {
  return new FalscheDatenbank({
    eingegangene_emails: mails,
    kunden: structuredClone(AKTEN),
    mitarbeiter: structuredClone(TEAM),
    gesendete_emails: structuredClone(GESENDET),
  })
}

function kontext(extra: Partial<Kontext> = {}): Kontext {
  return {
    akten: AKTEN.filter((a) => a.bereich !== 'privat') as unknown as Kontext['akten'],
    mitarbeiterAdressen: new Set(TEAM.map((t) => String(t.email))),
    eigeneWoerter: new Set(['mayer', 'amayer', 'andreas', 'fundament', 'hasan', 'sueslue', 'markus', 'groeber']),
    eigeneDomains: new Set(['amayer-holding.com', 'fundament-it.de', 'fahrschule-groeber.de']),
    gesendet: GESENDET.filter((g) => !g.besitzer_email) as unknown as Kontext['gesendet'],
    kennungAkten: new Map([['<abc-123@amayer-holding.com>', new Set(['k_sanny'])], ['<def-456@amayer-holding.com>', new Set(['k_mayr'])]]),
    ...extra,
  }
}

// ---------- reine Hilfen ----------

Deno.test('normBetreff und istAntwortBetreff', () => {
  assertEquals(normBetreff('AW: Re:  WG: Unterlagen   zum Verkauf'), 'unterlagen zum verkauf')
  assertEquals(normBetreff('*** SPAM *** Re: Hallo'), 'hallo')
  assert(istAntwortBetreff('AW: Unterlagen'))
  assert(istAntwortBetreff('Re[2]: Unterlagen'))
  assert(!istAntwortBetreff('WG: Unterlagen'))
  assert(!istAntwortBetreff('Unterlagen'))
})

Deno.test('Kennungen aus In-Reply-To/References, Postfach-Vorsatz wird entfernt', () => {
  assertEquals(kennungNorm('pf_eray:<ABC@x.de>'), '<abc@x.de>')
  assertEquals(kennungNorm('abc@x.de'), '<abc@x.de>')
  const k = verlaufsKennungen({ 'headers[in_reply_to]': '<A@x.de>', 'headers[references]': '<B@y.de> <A@x.de>', 'headers[references][1]': '<C@z.de>' })
  assertEquals(k.sort(), ['<a@x.de>', '<b@y.de>', '<c@z.de>'])
  assertEquals(verlaufsKennungen({}), [])
})

Deno.test('Rundschreiben- und Systemhinweise', () => {
  assertEquals(rundschreibenHinweise({ id: '1', von: 'a@b.de', rohdaten: { 'headers[list_unsubscribe]': '<mailto:x>' } }).liste.length, 1)
  assertEquals(rundschreibenHinweise({ id: '1', von: 'a@b.de', rohdaten: { 'headers[precedence]': 'bulk' } }).liste.length, 1)
  assertEquals(rundschreibenHinweise({ id: '1', von: 'a@b.de', rohdaten: { 'headers[auto_submitted]': 'no' } }).liste.length, 0)
  assert(rundschreibenHinweise({ id: '1', von: 'MAILER-DAEMON@kundenserver.de' }).system)
  assert(rundschreibenHinweise({ id: '1', von: 'no-reply@etsy.com' }).system)
  assert(!rundschreibenHinweise({ id: '1', von: 'info@hdimmo.de' }).system)
})

Deno.test('Namensabgleich: Nachname plus Vorname, eigene Wörter zählen nicht', () => {
  const eigene = new Set(['mayer', 'andreas'])
  const woerter = (s: string) => new Set(s.toLowerCase().replace(/ö/g, 'oe').split(/[^a-z0-9]+/))
  assert(nameImText({ id: 'x', bereich: 'b', firma: 'Franz Mayr', ansprechpartner: 'Franz Mayr' }, woerter('Fw: grundbuch Franz Mayr'), eigene))
  assertEquals(nameImText({ id: 'x', bereich: 'b', firma: 'Franz Mayr', ansprechpartner: 'Franz Mayr' }, woerter('Herr Mayr ruft an'), eigene), null)
  assertEquals(nameImText({ id: 'x', bereich: 'b', firma: 'Andreas Mayer', ansprechpartner: 'Andreas Mayer' }, woerter('Gruß Andreas Mayer'), eigene), null)
  assert(nameImText({ id: 'x', bereich: 'b', firma: 'Netzgewand', ansprechpartner: 'F. Beckmann' }, woerter('Umsatz bei Netzgewand'), eigene))
})

// ---------- Entscheidung ----------

Deno.test('sicher: Absender gehört genau einer Akte', () => {
  const e = entscheide({ id: '1', von: 'Ch.Lipps@googlemail.com', betreff: 'Unterlagen', relevanz: 'kunde' }, kontext(), JETZT)
  assertEquals(e.art, 'zuordnen')
  if (e.art === 'zuordnen') assertEquals([e.kundeId, e.weg], ['k_lipps', 'absender'])
})

Deno.test('nicht sicher: Adresse gehört zwei Akten, Mitarbeiteradresse, private Akte', () => {
  assertEquals(entscheide({ id: '1', von: 'gemeinsam@firma-x.de', betreff: 'Hallo', relevanz: 'kunde' }, kontext(), JETZT).art, 'vorschlag')
  // Mitarbeiter Markus Gröber nutzt dieselbe Adresse wie die Akte Fahrschule Gröber → nie automatisch.
  assertEquals(entscheide({ id: '1', von: 'info@fahrschule-groeber.de', betreff: 'Test', relevanz: 'kunde' }, kontext(), JETZT).art, 'nichts')
  assertEquals(entscheide({ id: '1', von: 'privat@beispiel.de', betreff: 'Hallo', relevanz: 'kunde' }, kontext(), JETZT).art, 'nichts')
})

Deno.test('sicher: Antwort im Verlauf einer Akte (In-Reply-To), auch wenn die KI sie ausgeblendet hat', () => {
  const e = entscheide(
    { id: '1', von: 'info@bruestle-eberle.de', betreff: 'WG: 245/26 - Schöllkopf ./. Mayer Holding', relevanz: 'nicht_relevant', rohdaten: { 'headers[in_reply_to]': '<DEF-456@amayer-holding.com>' } },
    kontext(),
    JETZT,
  )
  assertEquals(e.art, 'zuordnen')
  if (e.art === 'zuordnen') assertEquals([e.kundeId, e.weg], ['k_mayr', 'verlauf'])
})

Deno.test('Verlauf zeigt auf andere Akte als der Absender → Vorschlag mit beiden', () => {
  const e = entscheide({ id: '1', von: 'ch.lipps@googlemail.com', betreff: 'AW: x', relevanz: 'kunde', rohdaten: { 'headers[references]': '<abc-123@amayer-holding.com>' } }, kontext(), JETZT)
  assertEquals(e.art, 'vorschlag')
  if (e.art === 'vorschlag') assertEquals(e.kandidaten.map((k) => k.kundeId), ['k_lipps', 'k_sanny'])
})

Deno.test('sicher: Betreff-Antwort nur, wenn der Absender der Empfänger war', () => {
  const ja = entscheide({ id: '1', von: 'hans@grundkontor24.de', betreff: 'Re: Unterlagen zum Verkauf zum Prüfen', relevanz: 'kunde' }, kontext(), JETZT)
  assertEquals(ja.art, 'zuordnen')
  if (ja.art === 'zuordnen') assertEquals([ja.kundeId, ja.weg], ['k_hd', 'betreff'])
  // Anderer Absender, gleicher Betreff → nur Vorschlag.
  const nein = entscheide({ id: '1', von: 'info@grundkontor24.de', betreff: 'Re: Unterlagen zum Verkauf zum Prüfen', relevanz: 'kunde' }, kontext(), JETZT)
  assertEquals(nein.art, 'vorschlag')
  if (nein.art === 'vorschlag') {
    assertEquals(nein.kandidaten[0].kundeId, 'k_hd')
    assertStringIncludes(nein.kandidaten[0].grund, 'Betreff')
  }
  // Weiterleitung statt Antwort → nicht sicher.
  assertEquals(entscheide({ id: '1', von: 'hans@grundkontor24.de', betreff: 'WG: Unterlagen zum Verkauf zum Prüfen', relevanz: 'kunde' }, kontext(), JETZT).art, 'vorschlag')
})

Deno.test('Vorschläge: an diese Adresse geschrieben, gleiche Domain, Name im Text; Freemail zählt nicht als Domain', () => {
  const domain = entscheide({ id: '1', von: 'buchhaltung@hdimmo.de', betreff: 'Rechnung', relevanz: 'kunde' }, kontext(), JETZT)
  assertEquals(domain.art, 'vorschlag')
  if (domain.art === 'vorschlag') assertStringIncludes(domain.kandidaten[0].grund, '@hdimmo.de')
  const name = entscheide({ id: '1', von: 'privat.gf@beispiel.de', von_name: 'Hasan Süslü', betreff: 'Fw: grundbuch Franz Mayr', relevanz: 'kunde' }, kontext(), JETZT)
  assertEquals(name.art, 'vorschlag')
  if (name.art === 'vorschlag') assertEquals(name.kandidaten.map((k) => k.kundeId), ['k_mayr'])
  const zweiteAdresse = entscheide({ id: '1', von: 'hello@sanny.rocks', von_name: 'Sanny Simpfendörfer', betreff: 'Vollmacht', relevanz: 'kunde' }, kontext(), JETZT)
  assertEquals(zweiteAdresse.art, 'vorschlag')
  if (zweiteAdresse.art === 'vorschlag') assertEquals(zweiteAdresse.kandidaten[0].kundeId, 'k_sanny')
  assertEquals(entscheide({ id: '1', von: 'irgendwer@gmail.com', betreff: 'Hallo', relevanz: 'kunde' }, kontext(), JETZT).art, 'nichts')
  // Wie die echte Mail vom 19.11.: kein Name im Text, nur die Domain klingt nach der Akte.
  const nurDomain = entscheide({ id: '1', von: 'hello@sanny.rocks', von_name: 'hello@sanny.rocks', betreff: 'Abstimmung – Vollmacht', ausschnitt: 'Hallo Herr Doll, ich lasse mich von Andreas Mayer beraten', relevanz: 'kunde' }, kontext(), JETZT)
  assertEquals(nurDomain.art, 'vorschlag')
  if (nurDomain.art === 'vorschlag') {
    assertEquals(nurDomain.kandidaten.map((k) => k.kundeId), ['k_sanny'])
    assertStringIncludes(nurDomain.kandidaten[0].grund, 'klingt nach')
  }
})

Deno.test('noreply irgendwo in der Adresse gilt als Systemabsender', () => {
  assert(rundschreibenHinweise({ id: '1', von: 'info-noreply@commerzbank.com' }).system)
  assertEquals(entscheide({ id: '1', von: 'info-noreply@hdimmo.de', betreff: 'Neues Dokument', relevanz: 'kunde' }, kontext(), JETZT).art, 'nichts')
})

Deno.test('Rundschreiben: nur markieren, wenn die KI-Einordnung fehlt; Akten-Newsletter bleibt still', () => {
  const lu = { 'headers[list_unsubscribe]': '<https://x/abmelden>' }
  assertEquals(entscheide({ id: '1', von: 'news@shop.de', betreff: 'Angebot', relevanz: null, rohdaten: lu }, kontext(), JETZT).art, 'rundschreiben')
  assertEquals(entscheide({ id: '1', von: 'info@shop.de', betreff: 'Angebot', relevanz: 'kunde', rohdaten: lu }, kontext(), JETZT).art, 'nichts')
  assertEquals(entscheide({ id: '1', von: 'mailer-daemon@kundenserver.de', betreff: 'Mail delivery failed', relevanz: null }, kontext(), JETZT).art, 'rundschreiben')
  assertEquals(entscheide({ id: '1', von: 'office@hfg-hh.de', betreff: 'Neues Objekt', relevanz: 'nicht_relevant', rohdaten: lu }, kontext(), JETZT).art, 'nichts')
  // Akten-Absender mit Abmelde-Kopfzeile, aber von der KI als relevant gesehen → Vorschlag statt automatisch.
  assertEquals(entscheide({ id: '1', von: 'office@hfg-hh.de', betreff: 'Neues Objekt', relevanz: 'kunde', rohdaten: lu }, kontext(), JETZT).art, 'vorschlag')
  // Als unwichtig eingestuft ohne Akten-Bezug → still.
  assertEquals(entscheide({ id: '1', von: 'buchhaltung@hdimmo.de', betreff: 'Rechnung', relevanz: 'nicht_relevant' }, kontext(), JETZT).art, 'nichts')
})

// ---------- Lauf mit Datenbank ----------

Deno.test('Lauf: ordnet sicher zu (Verlauf + Dokumente), legt Vorschläge ab, markiert Rundschreiben, prüft jede Mail einmal', async () => {
  const sicher = mail({ von: 'ch.lipps@googlemail.com', betreff: 'Unterlagen', anhaenge: [{ filename: 'bwa.pdf', size: 50_000, contentType: 'application/pdf', url: 'https://x/bwa.pdf' }] })
  const verlauf = mail({ von: 'info@bruestle-eberle.de', betreff: 'WG: Schöllkopf', relevanz: 'nicht_relevant', rohdaten: { 'headers[in_reply_to]': '<def-456@amayer-holding.com>' } })
  const vorschlag = mail({ von: 'privat.gf@beispiel.de', von_name: 'Hasan Süslü', betreff: 'Fw: grundbuch Franz Mayr' })
  const rund = mail({ von: 'no-reply@shop.de', betreff: 'Angebot', relevanz: null })
  const privat = mail({ von: 'ch.lipps@googlemail.com', betreff: 'Privat', besitzer_email: 'eray@fundament-it.de' })
  const alt = mail({ von: 'ch.lipps@googlemail.com', betreff: 'Alt', erstellt_am: '2026-11-01T10:00:00Z' })
  const db = datenbank([sicher, verlauf, vorschlag, rund, privat, alt])

  const r = await ordneNeueMailsZu(db, { jetzt: JETZT })
  assertEquals(r.fehler, [])
  assertEquals([r.geprueft, r.zugeordnet, r.vorschlaege, r.rundschreiben], [4, 2, 1, 1])

  const zeile = (id: unknown) => db.tabelle('eingegangene_emails').find((z) => z.id === id)!
  assertEquals(zeile(sicher.id).zugewiesener_kunde_id, 'k_lipps')
  assertEquals(zeile(sicher.id).zugewiesener_kunde_name, 'Christopher Lipps')
  assertEquals((zeile(sicher.id).zuordnung_vorschlag as { status: string }).status, 'automatisch')
  assertEquals(zeile(verlauf.id).zugewiesener_kunde_id, 'k_mayr')
  assertEquals(zeile(verlauf.id).relevanz, 'kunde')
  assertEquals(zeile(vorschlag.id).zugewiesener_kunde_id, null)
  const v = zeile(vorschlag.id).zuordnung_vorschlag as { status: string; kandidaten: { kundeId: string }[] }
  assertEquals(v.status, 'offen')
  assertEquals(v.kandidaten[0].kundeId, 'k_mayr')
  assertEquals(zeile(rund.id).relevanz, 'nicht_relevant')
  assertEquals(zeile(privat.id).zuordnung_geprueft_am, null)
  assertEquals(zeile(alt.id).zuordnung_geprueft_am, null)

  const lipps = db.tabelle('kunden').find((k) => k.id === 'k_lipps')!
  assertEquals((lipps.dokumente as { name: string }[]).map((d) => d.name), ['bwa.pdf'])
  assertStringIncludes((lipps.activities as { text: string; user: string }[])[0].text, 'E-Mail zugeordnet')
  assertEquals((lipps.activities as { user: string }[])[0].user, 'System (automatische E-Mail-Zuordnung)')

  // Zweiter Lauf: nichts mehr zu tun (jede Mail nur einmal).
  const r2 = await ordneNeueMailsZu(db, { jetzt: JETZT })
  assertEquals(r2.geprueft, 0)
  assertEquals((db.tabelle('kunden').find((k) => k.id === 'k_lipps')!.activities as unknown[]).length, 1)
})

Deno.test('Lauf: von einem anderen Lauf beanspruchte Mail wird übersprungen; inzwischen manuell zugeordnete bleibt', async () => {
  const schonBeansprucht = mail({ von: 'ch.lipps@googlemail.com', betreff: 'A', zuordnung_geprueft_am: '2026-11-22T11:59:00Z' })
  const db = datenbank([schonBeansprucht])
  assertEquals((await ordneNeueMailsZu(db, { jetzt: JETZT })).geprueft, 0)

  // Zwischen Beanspruchen und Schreiben ordnet ein Mitarbeiter zu → keine Überschreibung.
  const m = mail({ von: 'ch.lipps@googlemail.com', betreff: 'B' })
  const db2 = datenbank([m])
  let abfragen = 0
  db2.nachAbfrage = (info) => {
    // Nach dem Laden der Mails (3. Abfrage auf eingegangene_emails) setzt „jemand“ die Zuordnung.
    if (info.tabelle === 'eingegangene_emails' && ++abfragen === 3) {
      const z = db2.tabelle('eingegangene_emails')[0]
      z.zugewiesener_kunde_id = 'k_sanny'
    }
  }
  await ordneNeueMailsZu(db2, { jetzt: JETZT })
  assertEquals(db2.tabelle('eingegangene_emails')[0].zugewiesener_kunde_id, 'k_sanny')
  assertEquals((db2.tabelle('kunden').find((k) => k.id === 'k_lipps')!.activities as unknown[]).length, 0)
})

Deno.test('Trockenlauf schreibt nichts und beansprucht nichts', async () => {
  const a = mail({ von: 'ch.lipps@googlemail.com', betreff: 'A' })
  const b = mail({ von: 'no-reply@shop.de', betreff: 'B', relevanz: null })
  const db = datenbank([a, b])
  const r = await ordneNeueMailsZu(db, { jetzt: JETZT, trockenlauf: true, tage: 30 })
  assertEquals([r.geprueft, r.zugeordnet, r.rundschreiben], [2, 1, 1])
  assertEquals(r.entscheidungen?.length, 2)
  assert(db.tabelle('eingegangene_emails').every((z) => z.zuordnung_geprueft_am === null && z.zugewiesener_kunde_id === null))
  assertEquals(db.tabelle('eingegangene_emails').find((z) => z.id === b.id)!.relevanz, null)
})

Deno.test('Lauf: Zeit um — nicht geprüfte Mails werden wieder freigegeben und beim nächsten Lauf geprüft', async () => {
  const a = mail({ von: 'ch.lipps@googlemail.com', betreff: 'A' })
  const b = mail({ von: 'sanny30390@gmail.com', betreff: 'B' })
  const db = datenbank([a, b])
  // Budget 0: der Lauf beansprucht beide, kommt aber zu keiner — beide müssen danach wieder offen sein.
  const r = await ordneNeueMailsZu(db, { jetzt: JETZT, zeitBudgetMs: -1 })
  assertEquals(r.geprueft, 0)
  assertEquals(r.fehler, [])
  assert(db.tabelle('eingegangene_emails').every((z) => z.zuordnung_geprueft_am === null))
  const r2 = await ordneNeueMailsZu(db, { jetzt: JETZT })
  assertEquals([r2.geprueft, r2.zugeordnet], [2, 2])
})

Deno.test('Scan-Eingang: Betreff ist genau der Name einer Akte und die Mail hat Anhänge → sicher zuordnen', () => {
  const scan = [{ filename: 'scan.pdf', size: 1000, url: 'x' }]
  const akte = { id: 'k_t', bereich: 'beratung', firma: 'Anna Beispiel', ansprechpartner: 'Anna Beispiel', email: null }
  assert(betreffIstAktenName('Anna Beispiel', akte))
  assert(betreffIstAktenName('Beispiel, Anna', akte))
  assert(betreffIstAktenName('WG: Anna Beispiel Teil 2', akte))
  assert(betreffIstAktenName('Kundenakte Anna Beispiel (3)', akte))
  assert(!betreffIstAktenName('Anna', akte))
  assert(betreffIstAktenName('anna beispil', akte)) // ein Tippfehler
  const paar = { id: 'k_p', bereich: 'erben', firma: 'Erika Mustermann und Otto Normal – Erben', ansprechpartner: 'Erika Musterman, Otto Normal', email: null }
  assert(betreffIstAktenName('Normal Mustermann', paar))
  assert(betreffIstAktenName('Herr Normal und Frau Musterman', paar))
  assert(!betreffIstAktenName('Normal Beispiel', paar))
  assert(!betreffIstAktenName('Anna Beispiel und Otto Muster', akte))
  const k = kontext({ akten: [...kontext().akten, akte] })
  // Fremder Absender ohne Akte, KI hat die Mail als unwichtig eingestuft — trotzdem in die Akte.
  const e = entscheide(mail({ von: 'kollege@scanbuero.test', betreff: 'Anna Beispiel', anhaenge: scan, relevanz: 'nicht_relevant' }) as MailZeile, k, JETZT)
  assertEquals(e.art, 'zuordnen')
  if (e.art === 'zuordnen') assertEquals(e.kundeId, 'k_t')
  // Ohne Anhang: kein sicherer Treffer.
  assertEquals(entscheide(mail({ von: 'kollege@scanbuero.test', betreff: 'Anna Beispiel' }) as MailZeile, k, JETZT).art !== 'zuordnen', true)
  // Gleicher Name in zwei Akten → Vorschlag mit beiden.
  const zwei = kontext({ akten: [...k.akten, { ...akte, id: 'k_t2', bereich: 'erben' }] })
  const v = entscheide(mail({ von: 'kollege@scanbuero.test', betreff: 'Anna Beispiel', anhaenge: scan }) as MailZeile, zwei, JETZT)
  assertEquals(v.art, 'vorschlag')
  if (v.art === 'vorschlag') assertEquals(v.kandidaten.map((x) => x.kundeId).sort(), ['k_t', 'k_t2'])
})
