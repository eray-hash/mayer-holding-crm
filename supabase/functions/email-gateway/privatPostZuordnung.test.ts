// Prüft die Vorschläge für private Postfächer (privatPostZuordnung.ts) ohne Netz: Rundschreiben-Erkennung im Text,
// Entscheidung mit dem Kontext des Besitzers (nur seine Akten, Bereichsrechte, eigene private Kontakte), Beanspruchen,
// dass nur private Zeilen berührt werden und dass nie automatisch zugeordnet oder übergeben wird.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import type { Kontext } from './mailZuordnung.ts'
import { entscheidePrivat, istHaengenderAnspruch, kontextFuerBesitzer, privatRundschreiben, pruefePrivatePost } from './privatPostZuordnung.ts'

const JETZT = new Date('2026-11-22T12:00:00Z')
let zaehler = 0
function uuid(): string {
  zaehler++
  return `00000000-0000-4000-8000-${String(zaehler).padStart(12, '0')}`
}

const AKTEN: Zeile[] = [
  { id: 'k_lipps', bereich: 'beratung', firma: 'Christopher Lipps', ansprechpartner: 'Christopher Lipps', email: 'ch.lipps@googlemail.com', verantwortlich_email: null },
  { id: 'k_hd', bereich: 'immobilienkunden', firma: 'HD-IMMO', ansprechpartner: 'Helmut Dick', email: 'info@hdimmo.de', verantwortlich_email: null },
  { id: 'k_fin', bereich: 'finanzierungen', firma: 'Kredit Kunde', ansprechpartner: 'Konrad Kredit', email: 'konrad@kreditkunde.de', verantwortlich_email: null },
  { id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: 'Ungeklärte Eingänge', ansprechpartner: '', email: 'sammel@beispiel.de', verantwortlich_email: null },
  { id: 'k_priv_quirin', bereich: 'privat', firma: 'Oma Erna', ansprechpartner: 'Erna Beispiel', email: 'erna@beispiel-privat.de', verantwortlich_email: 'immo@amayer-holding.com' },
  { id: 'k_priv_fremd', bereich: 'privat', firma: 'Fremder Privatkontakt', ansprechpartner: 'Fritz Fremd', email: 'fritz@fremd-privat.de', verantwortlich_email: 'eray.yesil@fundament-it.de' },
]

const TEAM: Zeile[] = [
  { id: 'm1', name: 'Quirin Lang', email: 'immo@amayer-holding.com', aktiv: true, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] },
  { id: 'm2', name: 'Eray Yesil', email: 'eray.yesil@fundament-it.de', aktiv: true, rolle: 'geschaeftsfuehrung', ist_admin: true, bereiche: [] },
  { id: 'm3', name: 'Alt Ausgeschieden', email: 'alt@amayer-holding.com', aktiv: false, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] },
]

function mail(felder: Zeile): Zeile {
  return {
    id: uuid(),
    message_id: `pf_x:<m${zaehler}@absender.test>`,
    von_name: '',
    betreff: '',
    ausschnitt: '',
    rohdaten: { quelle: 'imap' },
    relevanz: null,
    ignoriert: false,
    besitzer_email: 'immo@amayer-holding.com',
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
    gesendete_emails: [
      { id: uuid(), message_id: '<g1@amayer-holding.com>', an: 'hans@grundkontor24.de', betreff: 'Exposé Hirsch', kunde_id: 'k_hd', gesendet_am: '2026-11-15T10:00:00Z', besitzer_email: null },
      { id: uuid(), message_id: 'pf_q:<p1@amayer-holding.com>', an: 'tante@beispiel-privat.de', betreff: 'Geburtstag', kunde_id: 'k_priv_quirin', gesendet_am: '2026-11-15T10:00:00Z', besitzer_email: 'immo@amayer-holding.com' },
    ],
    postfaecher: [{ id: 'pf_q', adresse: 'immo@amayer-holding.com', besitzer_email: 'immo@amayer-holding.com' }],
  })
}

function basisKontext(): Kontext {
  return {
    akten: AKTEN.filter((a) => a.bereich !== 'privat') as unknown as Kontext['akten'],
    mitarbeiterAdressen: new Set(TEAM.map((t) => String(t.email))),
    eigeneWoerter: new Set(['mayer', 'amayer', 'andreas', 'fundament', 'quirin', 'lang', 'eray', 'yesil']),
    eigeneDomains: new Set(['amayer-holding.com', 'fundament-it.de']),
    gesendet: [{ message_id: '<g1@amayer-holding.com>', an: 'hans@grundkontor24.de', betreff: 'Exposé Hirsch', kunde_id: 'k_hd', gesendet_am: '2026-11-15T10:00:00Z' }],
    kennungAkten: new Map([['<g1@amayer-holding.com>', new Set(['k_hd'])]]),
  }
}

const QUIRIN = { ...(TEAM[0] as Record<string, unknown>), email: 'immo@amayer-holding.com' } as unknown as Parameters<typeof kontextFuerBesitzer>[1]
const ERAY = { ...(TEAM[1] as Record<string, unknown>), email: 'eray.yesil@fundament-it.de' } as unknown as Parameters<typeof kontextFuerBesitzer>[1]
const GESENDET_PRIVAT = [{ message_id: 'pf_q:<p1@amayer-holding.com>', an: 'tante@beispiel-privat.de', betreff: 'Geburtstag', kunde_id: 'k_priv_quirin', gesendet_am: '2026-11-15T10:00:00Z', besitzer_email: 'immo@amayer-holding.com' }]

function quirinKontext(): Kontext {
  return kontextFuerBesitzer(basisKontext(), QUIRIN, AKTEN as never, GESENDET_PRIVAT, ['immo@amayer-holding.com'])
}

// ---------- Rundschreiben ----------

Deno.test('Rundschreiben: starke Hinweise genügen, schwache erst zu zweit, Gespräche nie', () => {
  assert(privatRundschreiben({ id: '1', von: 'shop@laden.de', betreff: 'Neu im Sortiment', ausschnitt: 'Wenn Sie diese E-Mails nicht mehr erhalten möchten, klicken Sie hier.' }))
  assert(privatRundschreiben({ id: '1', von: 'a@b.de', betreff: 'Angebot', ausschnitt: 'Probleme bei der Darstellung? Im Browser ansehen' }))
  assert(privatRundschreiben({ id: '1', von: 'a@b.de', betreff: 'x', ausschnitt: 'To stop receiving these, unsubscribe here' }))
  // Reine Benachrichtigung (noreply, Impressum) bleibt sichtbar; noreply mit Werbung wird ausgeblendet.
  assertEquals(privatRundschreiben({ id: '1', von: 'noreply@pruefstelle.de', betreff: 'Ihr Prüftermin', ausschnitt: 'Ihr Termin am Montag. Impressum' }), null)
  assert(privatRundschreiben({ id: '1', von: 'noreply@shop.de', betreff: 'Nur heute', ausschnitt: '20 % Rabatt auf alles' }))
  // Schwach: nur „abmelden“ (Fahrschüler meldet sich von der Fahrstunde ab) → kein Rundschreiben.
  assertEquals(privatRundschreiben({ id: '1', von: 'schueler@gmail.com', betreff: 'Fahrstunde', ausschnitt: 'Ich muss mich für morgen leider abmelden.' }), null)
  // Zwei schwache, einer davon Werbung: Newsletter + Impressum.
  assert(privatRundschreiben({ id: '1', von: 'info@verband.de', betreff: 'Newsletter November', ausschnitt: 'Liebe Mitglieder … Impressum' }))
  // Versandadresse + abmelden.
  assert(privatRundschreiben({ id: '1', von: 'newsletter@firma.de', betreff: 'Neuigkeiten', ausschnitt: 'Hier abmelden' }))
  // Antwort im Gespräch → nie Rundschreiben (außer Systemabsender).
  assertEquals(privatRundschreiben({ id: '1', von: 'kunde@firma.de', betreff: 'AW: Newsletter', ausschnitt: 'Bitte vom Newsletter abmelden, danke. Impressum unten.' }), null)
})

// ---------- Kontext des Besitzers ----------

Deno.test('Kontext: nur Akten mit Bereichsrecht, keine Sammelakten, nur eigene private Kontakte', () => {
  const k = quirinKontext()
  const ids = k.akten.map((a) => a.id).sort()
  assertEquals(ids, ['k_hd', 'k_priv_quirin'])
  // Geschäftsführung: alle Holding-Akten, aber trotzdem nur die eigenen privaten Kontakte.
  const g = kontextFuerBesitzer(basisKontext(), ERAY, AKTEN as never, [], ['eray.yesil@fundament-it.de']).akten.map((a) => a.id).sort()
  assertEquals(g, ['k_fin', 'k_hd', 'k_lipps', 'k_priv_fremd'])
  // Private gesendete Mail an den eigenen Kontakt zählt.
  assert(k.gesendet.some((x) => x.kunde_id === 'k_priv_quirin'))
})

// ---------- Entscheidung ----------

Deno.test('sicherer Treffer wird nur ein Vorschlag (sicher), nie eine Zuordnung', () => {
  const e = entscheidePrivat({ id: '1', von: 'info@hdimmo.de', betreff: 'Unterlagen' }, quirinKontext(), JETZT)
  assertEquals(e.art, 'vorschlag')
  if (e.art === 'vorschlag') {
    assertEquals(e.kandidaten.map((x) => [x.kundeId, x.sicher, x.privat]), [['k_hd', true, false]])
  }
})

Deno.test('Akte ohne Bereichsrecht wird nie vorgeschlagen, auch nicht bei exakter Adresse', () => {
  const e = entscheidePrivat({ id: '1', von: 'ch.lipps@googlemail.com', betreff: 'Frage' }, quirinKontext(), JETZT)
  assertEquals(e.art, 'nichts')
  // Fremder privater Kontakt eines Kollegen: ebenso nie.
  assertEquals(entscheidePrivat({ id: '1', von: 'fritz@fremd-privat.de', betreff: 'Hallo' }, quirinKontext(), JETZT).art, 'nichts')
})

Deno.test('eigener privater Kontakt wird vorgeschlagen (privat: true)', () => {
  const e = entscheidePrivat({ id: '1', von: 'erna@beispiel-privat.de', betreff: 'Kuchen' }, quirinKontext(), JETZT)
  assertEquals(e.art, 'vorschlag')
  if (e.art === 'vorschlag') assertEquals([e.kandidaten[0].kundeId, e.kandidaten[0].privat], ['k_priv_quirin', true])
  // Antwort an die Empfängerin einer privat gesendeten Mail (gleicher Betreff) → Kontakt.
  const antwort = entscheidePrivat({ id: '1', von: 'tante@beispiel-privat.de', betreff: 'AW: Geburtstag' }, quirinKontext(), JETZT)
  assertEquals(antwort.art, 'vorschlag')
  if (antwort.art === 'vorschlag') assertEquals(antwort.kandidaten[0].kundeId, 'k_priv_quirin')
})

Deno.test('Rundschreiben ohne bekannten Absender → ausblenden; Kollege nie; Name im Rundschreiben zählt nicht', () => {
  assertEquals(entscheidePrivat({ id: '1', von: 'news@portal.de', betreff: 'Marktbericht', ausschnitt: 'Helmut Dick … Newsletter abbestellen' }, quirinKontext(), JETZT).art, 'rundschreiben')
  assertEquals(entscheidePrivat({ id: '1', von: 'eray.yesil@fundament-it.de', betreff: 'Newsletter Entwurf', ausschnitt: 'unsubscribe' }, quirinKontext(), JETZT).art, 'nichts')
  // Absender bei Akte hinterlegt → Vorschlag statt Ausblenden.
  assertEquals(entscheidePrivat({ id: '1', von: 'info@hdimmo.de', betreff: 'Neue Objekte', ausschnitt: 'Newsletter abbestellen' }, quirinKontext(), JETZT).art, 'vorschlag')
  assertEquals(entscheidePrivat({ id: '1', von: 'irgendwer@gmail.com', betreff: 'Hallo' }, quirinKontext(), JETZT).art, 'nichts')
})

Deno.test('hängender Anspruch: erst nach zehn Minuten', () => {
  assert(!istHaengenderAnspruch({ art: 'privat', status: 'privat_pruefung', seit: '2026-11-22T11:55:00Z' }, JETZT))
  assert(istHaengenderAnspruch({ art: 'privat', status: 'privat_pruefung', seit: '2026-11-22T11:40:00Z' }, JETZT))
  assert(!istHaengenderAnspruch({ art: 'privat', status: 'privat_offen', seit: '2026-11-22T11:40:00Z' }, JETZT))
  assert(!istHaengenderAnspruch({ status: 'offen' }, JETZT))
})

// ---------- Lauf ----------

Deno.test('Lauf: schreibt nur private Zeilen, ordnet nie zu, jede Mail einmal, inaktive Besitzer nicht', async () => {
  const sicher = mail({ von: 'info@hdimmo.de', betreff: 'Unterlagen' })
  const rund = mail({ von: 'shop@laden.de', betreff: 'Angebot', ausschnitt: 'Wenn Sie diese E-Mails nicht mehr erhalten möchten' })
  const leer = mail({ von: 'irgendwer@gmail.com', betreff: 'Hallo' })
  const oeffentlich = mail({ von: 'info@hdimmo.de', betreff: 'Öffentlich', besitzer_email: null })
  const inaktiv = mail({ von: 'info@hdimmo.de', betreff: 'Alt', besitzer_email: 'alt@amayer-holding.com' })
  const alt = mail({ von: 'info@hdimmo.de', betreff: 'Uralt', erstellt_am: '2026-09-01T10:00:00Z' })
  const schonAbgelegt = mail({ von: 'erna@beispiel-privat.de', betreff: 'Abgelegt', zugewiesener_kunde_id: 'k_priv_quirin' })
  const db = datenbank([sicher, rund, leer, oeffentlich, inaktiv, alt, schonAbgelegt])
  const r = await pruefePrivatePost(db as never, { jetzt: JETZT })
  assertEquals(r.fehler, [])
  assertEquals([r.geprueft, r.vorschlaege, r.sicher, r.rundschreiben, r.keiner], [3, 1, 1, 1, 1])
  const zeile = (id: unknown) => db.tabelle('eingegangene_emails').find((z) => z.id === id)!
  const v = zeile(sicher.id).zuordnung_vorschlag as { art: string; status: string; kandidaten: { kundeId: string; sicher: boolean }[] }
  assertEquals([v.art, v.status, v.kandidaten[0].kundeId, v.kandidaten[0].sicher], ['privat', 'privat_offen', 'k_hd', true])
  assertEquals(zeile(sicher.id).zugewiesener_kunde_id, null)
  assertEquals(zeile(sicher.id).besitzer_email, 'immo@amayer-holding.com')
  assertEquals((zeile(rund.id).zuordnung_vorschlag as { status: string }).status, 'privat_rundschreiben')
  assertEquals((zeile(leer.id).zuordnung_vorschlag as { status: string }).status, 'privat_keiner')
  for (const unberuehrt of [oeffentlich, inaktiv, alt, schonAbgelegt]) assertEquals(zeile(unberuehrt.id).zuordnung_vorschlag, null)
  // Keine Akte geändert, keine Mail freigegeben.
  assert(!db.protokoll.some((p) => p.tabelle === 'kunden' && p.art !== 'select'))
  // Zweiter Lauf: nichts mehr zu tun.
  const r2 = await pruefePrivatePost(db as never, { jetzt: JETZT })
  assertEquals(r2.geprueft, 0)
})

Deno.test('Trockenlauf: zählt je Besitzer, schreibt nichts', async () => {
  const db = datenbank([mail({ von: 'info@hdimmo.de', betreff: 'A' }), mail({ von: 'erna@beispiel-privat.de', betreff: 'B' }), mail({ von: 'x@gmail.com', betreff: 'C', besitzer_email: 'eray.yesil@fundament-it.de' })])
  const r = await pruefePrivatePost(db as never, { jetzt: JETZT, trockenlauf: true })
  assertEquals(r.geprueft, 3)
  assertEquals(r.jeBesitzer?.['immo@amayer-holding.com'], { geprueft: 2, vorschlaege: 2, sicher: 2, mitPrivatKontakt: 1, rundschreiben: 0, keiner: 0 })
  assertEquals(r.jeBesitzer?.['eray.yesil@fundament-it.de']?.keiner, 1)
  assert(!db.protokoll.some((p) => p.art !== 'select'))
})
