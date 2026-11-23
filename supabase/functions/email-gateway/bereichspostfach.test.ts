// Prüft das Bereichspostfach (postfach.ts: Art, Sehen/Senden) und die einmalige Überführung eines persönlichen Postfachs
// (bereichspostfach.ts) ohne Netz: Trockenlauf schreibt nichts, echter Lauf stellt um, überführt Mails und gesendete Mails,
// kopiert Anhänge (die privaten bleiben), leert private Vorschläge, vermerkt den Altbestand, ordnet nur eindeutig zu,
// lässt Mails an private Kontakte privat und ist wiederholbar.
//
//   npx -y deno test --allow-all --no-check email-gateway/bereichspostfach.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { aufruferDarfBereich, darfNutzen, darfSehen, postfachArt, type Postfach } from './postfach.ts'
import { absenderAdresse, ueberfuehreInsBereichspostfach } from './bereichspostfach.ts'

const IMMO = 'immo@amayer-holding.com'
const JETZT = new Date('2026-11-23T17:30:00Z')

function postfach(extra: Partial<Postfach> = {}): Postfach {
  return {
    id: 'pf_immo',
    adresse: IMMO,
    anzeige_name: 'Quirin Lutzenberger',
    besitzer_email: IMMO,
    smtp_host: 'smtp.ionos.de',
    smtp_port: 587,
    imap_host: 'imap.ionos.de',
    imap_port: 993,
    benutzer: IMMO,
    geheimnis_name: null,
    aktiv: true,
    letzter_abruf: null,
    letzter_fehler: null,
    letzte_uid: 393,
    uid_gueltigkeit: 1,
    ...extra,
  }
}

const QUIRIN = { email: IMMO, name: 'Quirin Lutzenberger', istGf: false, bereiche: ['immobilien'] }
const HASAN = { email: 'sueslue@hotmail.com', name: 'Hasan Süslü', istGf: true, bereiche: [] }
const BERATER = { email: 'berater@amayer-holding.com', name: 'Berater', istGf: false, bereiche: ['beratung'] }
const IMMO_KOLLEGE = { email: 'kollege@amayer-holding.com', name: 'Kollege', istGf: false, bereiche: ['immobilien'] }

Deno.test('Postfach-Art: persönlich, gemeinsam, Bereich', () => {
  assertEquals(postfachArt(postfach()), 'persoenlich')
  assertEquals(postfachArt(postfach({ besitzer_email: null })), 'gemeinsam')
  assertEquals(postfachArt(postfach({ besitzer_email: null, bereich: 'immobilien' })), 'bereich')
})

Deno.test('Bereichspostfach: sehen nur mit dem Bereich, senden nur Geschäftsführung und Verantwortlicher', () => {
  const p = postfach({ besitzer_email: null, bereich: 'immobilien', verantwortlich_email: IMMO })
  assert(darfSehen(p, QUIRIN))
  assert(darfSehen(p, HASAN))
  assert(darfSehen(p, IMMO_KOLLEGE))
  assert(!darfSehen(p, BERATER))
  assert(!darfSehen(p, null))
  assert(darfNutzen(p, QUIRIN))
  assert(darfNutzen(p, HASAN))
  assert(!darfNutzen(p, IMMO_KOLLEGE))
  assert(!darfNutzen(p, BERATER))
  // Persönlich und gemeinsam wie bisher.
  assert(darfNutzen(postfach(), QUIRIN))
  assert(!darfNutzen(postfach(), HASAN))
  assert(darfNutzen(postfach({ besitzer_email: null }), null))
  // "immobilienkunden" zählt als Immobilien.
  assert(aufruferDarfBereich(IMMO_KOLLEGE, 'immobilienkunden'))
  assert(!aufruferDarfBereich(BERATER, 'immobilienkunden'))
})

Deno.test('Absenderadresse wie bei der Lead-Anlage', () => {
  assertEquals(absenderAdresse('"Hans" <Hans@Firma.de>'), 'hans@firma.de')
  assertEquals(absenderAdresse(' Info@Web.de '), 'info@web.de')
})

/** Zeilen-Kennungen wie in der Datenbank (ordneMailZu erkennt eine Kennung an der UUID-Form). */
function uuid(kurz: string): string {
  return `00000000-0000-4000-8000-${kurz.replace(/\D/g, '').padStart(12, '0')}`
}

function mail(kurz: string, von: string, extra: Zeile = {}): Zeile {
  const id = uuid(kurz)
  return {
    id,
    message_id: `pf_immo:<${kurz}@x>`,
    von,
    von_name: von.split('@')[0],
    betreff: `Betreff ${kurz}`,
    ausschnitt: 'Guten Tag, anbei die Unterlagen.',
    rohdaten: { quelle: 'imap' },
    relevanz: null,
    ignoriert: null,
    besitzer_email: IMMO,
    postfach_id: 'pf_immo',
    zugewiesener_kunde_id: null,
    zugewiesener_bereich: null,
    zugewiesener_kunde_name: null,
    zuordnung_vorschlag: { art: 'privat', status: 'privat_keiner', erstellt_am: '2026-11-22T21:36:02Z' },
    zuordnung_geprueft_am: null,
    mail_datum: '2026-11-10T09:00:00Z',
    erstellt_am: '2026-11-22T21:35:00Z',
    anhaenge: null,
    ...extra,
  }
}

async function aufbau(): Promise<FalscheDatenbank> {
  const db = new FalscheDatenbank({
    postfaecher: [postfach() as unknown as Zeile],
    mitarbeiter: [
      { name: 'Quirin Lutzenberger', email: IMMO, aktiv: true },
      { name: 'Hasan Süslü', email: 'sueslue@hotmail.com', aktiv: true },
    ],
    kunden: [
      { id: 'k_mueller', bereich: 'immobilienkunden', firma: 'Müller Bau GmbH', ansprechpartner: 'Hans Müller', email: 'mueller@muellerbau.de', dokumente: [], activities: [] },
      { id: 'k_privat', bereich: 'privat', firma: 'Tante Erna', ansprechpartner: 'Erna', email: 'erna@web.de', verantwortlich_email: IMMO, dokumente: [], activities: [] },
    ],
    eingegangene_emails: [
      mail('m1', 'mueller@muellerbau.de', {
        anhaenge: [{ filename: 'expose.pdf', size: 40000, contentType: 'application/pdf', url: 'privat:pf_immo/1/1_expose.pdf' }],
        zuordnung_vorschlag: { art: 'privat', status: 'privat_offen', kandidaten: [{ kundeId: 'k_privat', name: 'Tante Erna', bereich: 'privat', privat: true, grund: 'Name im Text' }] },
      }),
      mail('m2', 'fremder@web.de'),
      mail('m3', 'noreply@shop-beispiel.de', { betreff: 'Ihre Bestellung' }),
      mail('m4', 'erna@web.de', { zugewiesener_kunde_id: 'k_privat', zugewiesener_bereich: 'privat', zugewiesener_kunde_name: 'Tante Erna' }),
      // Schon gemeinsame Mail eines anderen Postfachs: bleibt unberührt.
      mail('m5', 'mueller@muellerbau.de', { besitzer_email: null, postfach_id: 'standard', zuordnung_vorschlag: null }),
    ],
    gesendete_emails: [
      { id: 'g1', an: 'mueller@muellerbau.de', betreff: 'Exposé', postfach_id: 'pf_immo', besitzer_email: IMMO, kunde_bereich: null, gesendet_am: '2026-11-11T10:00:00Z' },
      { id: 'g2', an: 'erna@web.de', betreff: 'Privat', postfach_id: 'pf_immo', besitzer_email: IMMO, kunde_bereich: 'privat', gesendet_am: '2026-11-11T11:00:00Z' },
    ],
    vorgeschlagene_leads: [],
    objekt_anfragen: [],
  })
  await db.storage.from('postfach-anhaenge').upload('pf_immo/1/1_expose.pdf', new TextEncoder().encode('%PDF-1.4 Test'), { contentType: 'application/pdf' })
  return db
}

Deno.test('Trockenlauf: zählt und schätzt die Zuordnung, schreibt nichts', async () => {
  const db = await aufbau()
  const vorher = structuredClone(db.tabellen)
  const e = await ueberfuehreInsBereichspostfach(db, { postfachId: 'pf_immo', bereich: 'immobilien', jetzt: JETZT })
  assert(e.ok, e.fehler.join(' | '))
  assert(e.trocken)
  assertEquals(e.postfach.vorher, 'persoenlich')
  assertEquals(e.mails, { privat: 4, ueberfuehrt: 0, privatBelassen: 1, offen: 3 })
  assertEquals(e.anhaenge.privatAbgelegt, 1)
  assertEquals(e.privateVorschlaege, { privat_offen: 1, privat_keiner: 2 })
  assertEquals(e.gesendet, { privat: 2, ueberfuehrt: 0, privatBelassen: 1 })
  assertEquals(e.altbestand, { anfragenVermerkt: 3, absenderVermerkt: 2 })
  assertEquals(e.zuordnung.zugeordnet, 1)
  assertEquals(e.zuordnung.rundschreiben, 1)
  assertEquals(e.zuordnung.ohneTreffer, 1)
  assertEquals(e.zuordnung.beispiele[0].akte, 'Müller Bau GmbH (Hans Müller)')
  assertEquals(db.tabellen, vorher)
  assertEquals(db.protokoll.filter((x) => x.art !== 'select').length, 0)
})

Deno.test('Echter Lauf: umstellen, überführen, Altbestand vermerken, eindeutig zuordnen — und wiederholbar', async () => {
  const db = await aufbau()
  const e = await ueberfuehreInsBereichspostfach(db, { postfachId: 'pf_immo', bereich: 'immobilien', trocken: false, jetzt: JETZT })
  assert(e.ok, e.fehler.join(' | '))
  assert(e.postfach.umgestellt)
  const fach = db.tabellen.postfaecher[0]
  assertEquals([fach.bereich, fach.besitzer_email, fach.verantwortlich_email], ['immobilien', null, IMMO])
  assertEquals(e.mails.ueberfuehrt, 3)
  assertEquals(e.mails.offen, 0)

  const m = (kurz: string) => db.tabellen.eingegangene_emails.find((z) => z.id === uuid(kurz))!
  for (const id of ['m1', 'm2', 'm3']) {
    assertEquals(m(id).besitzer_email, null)
    assertEquals(m(id).postfach_bereich, 'immobilien')
  }
  // Private Vorschläge mit Namen privater Kontakte sind weg.
  assert(!JSON.stringify(m('m2').zuordnung_vorschlag ?? '').includes('privat'))
  assert(!JSON.stringify(m('m1').zuordnung_vorschlag ?? '').includes('Tante Erna'))
  // Mail an einen privaten Kontakt bleibt privat, die gemeinsame Mail unberührt.
  assertEquals(m('m4').besitzer_email, IMMO)
  assertEquals(m('m5').postfach_bereich, undefined)

  // Anhang kopiert, private Datei liegt noch da (nichts gelöscht).
  const anhang = (m('m1').anhaenge as { url: string }[])[0]
  assert(anhang.url.startsWith('https://'), anhang.url)
  assertEquals(e.anhaenge.kopiert, 1)
  assert(db.ablage.get('postfach-anhaenge')!.has('pf_immo/1/1_expose.pdf'))

  // Eindeutige Zuordnung über die Absenderadresse, samt Dokument in der Akte; Systemabsender ausgeblendet; Rest offen.
  assertEquals(m('m1').zugewiesener_kunde_id, 'k_mueller')
  const akte = db.tabellen.kunden.find((k) => k.id === 'k_mueller')!
  assertEquals((akte.dokumente as unknown[]).length, 1)
  assertEquals(m('m3').relevanz, 'nicht_relevant')
  assertEquals(m('m2').zugewiesener_kunde_id, null)
  assertEquals(e.zuordnung.zugeordnet, 1)

  // Gesendete Mails: nur die nicht private.
  const g = (id: string) => db.tabellen.gesendete_emails.find((z) => z.id === id)!
  assertEquals([g('g1').besitzer_email, g('g1').postfach_bereich], [null, 'immobilien'])
  assertEquals(g('g2').besitzer_email, IMMO)

  // Altbestand: Anfragenmanager und Lead-Anlage greifen nicht.
  assertEquals(db.tabellen.objekt_anfragen.map((z) => z.status).sort(), ['vor_start', 'vor_start', 'vor_start'])
  assertEquals(db.tabellen.vorgeschlagene_leads.map((z) => `${z.email}:${z.status}`).sort(), ['fremder@web.de:nicht_relevant', 'noreply@shop-beispiel.de:nicht_relevant'])

  // Wiederholen: nichts doppelt.
  const zweiter = await ueberfuehreInsBereichspostfach(db, { postfachId: 'pf_immo', bereich: 'immobilien', trocken: false, jetzt: JETZT })
  assert(zweiter.ok, zweiter.fehler.join(' | '))
  assertEquals(zweiter.postfach.vorher, 'bereich')
  assertEquals(zweiter.mails.ueberfuehrt, 0)
  assertEquals(zweiter.zuordnung.zugeordnet, 0)
  assertEquals(db.tabellen.objekt_anfragen.length, 3)
  assertEquals(db.tabellen.vorgeschlagene_leads.length, 2)
  assertEquals(((db.tabellen.kunden.find((k) => k.id === 'k_mueller')!.dokumente) as unknown[]).length, 1)
})

Deno.test('Überführung lehnt gemeinsame Postfächer und einen anderen Bereich ab', async () => {
  const db = new FalscheDatenbank({ postfaecher: [postfach({ besitzer_email: null }) as unknown as Zeile] })
  const e = await ueberfuehreInsBereichspostfach(db, { postfachId: 'pf_immo', bereich: 'immobilien', trocken: false })
  assert(!e.ok)
  const db2 = new FalscheDatenbank({ postfaecher: [postfach({ besitzer_email: null, bereich: 'beratung', verantwortlich_email: IMMO }) as unknown as Zeile] })
  const e2 = await ueberfuehreInsBereichspostfach(db2, { postfachId: 'pf_immo', bereich: 'immobilien', trocken: false })
  assert(!e2.ok)
  assertEquals(db2.tabellen.postfaecher[0].bereich, 'beratung')
})
