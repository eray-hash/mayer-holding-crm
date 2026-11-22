// Prüft die Gesuche- und Portal-Werkzeuge mit der Datenbank im Speicher (_shared/testDoppel.ts, ohne Netz):
// Abgleich in beide Richtungen samt Reihenfolge und Grund, Rechte (Bereich Immobilien, private Akten und
// Objekte, privater Assistent), Anlegen des Portal-Zugangs (Schlüssel, Provision, vorhandener Zugang) und
// Verschicken nur mit senden=true über ctx.sendeMail.
import { assert, assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { fuehreGesucheWerkzeugAus, type GesucheKontext, istGesucheWerkzeug, neuesToken, portalEinladung, PROVISION_VORSCHLAG, type SendeMail } from './gesucheWerkzeuge.ts'

const GF = { name: 'Andreas Mayer', email: 'am@firma.de', rolle: 'geschaeftsfuehrung', bereiche: [] }
const IMMO = { name: 'Quirin', email: 'quirin@firma.de', rolle: 'mitarbeiter', bereiche: ['immobilien'] }
/** Verlauf eines Objekts in der Testdatenbank. */
const verlaufVon = (db: ReturnType<typeof falscheDatenbank>, id: string) => (db.tabelle('objekte').find((o) => o.id === id)!.activities ?? []) as { text: string }[]

const BERATUNG = { name: 'Bea', email: 'bea@firma.de', rolle: 'mitarbeiter', bereiche: ['beratung'] }

function daten(): Record<string, Zeile[]> {
  return {
    kunden: [
      {
        id: 'k_mueller', bereich: 'immobilienkunden', firma: 'Müller Invest', ansprechpartner: 'Hans Müller', email: 'hans@mueller.de', telefon: '0731 1',
        gesuche: [
          { id: 'g_mfh', titel: 'MFH Ulm', objekttypen: ['Haus'], lage: 'Ulm, Neu-Ulm', budgetMax: 2000000, baujahrMin: 1990, nutzung: 'Kapitalanlage', notizen: 'gern saniert' },
          { id: 'g_alt', titel: 'Alt erledigt', objekttypen: ['Haus'], lage: 'Ulm', erledigt: true },
        ],
      },
      { id: 'k_klein', bereich: 'immobilienkunden', firma: 'Klein', ansprechpartner: '', email: '', gesuche: [{ id: 'g_klein', titel: 'Haus in Ulm', objekttypen: ['Haus'], lage: 'Ulm' }] },
      { id: 'k_teuer', bereich: 'immobilienkunden', firma: 'Zu wenig Geld', gesuche: [{ id: 'g_teuer', titel: 'Billig', objekttypen: ['Haus'], lage: 'Ulm', budgetMax: 100000 }] },
      { id: 'k_beratung', bereich: 'beratung', firma: 'Berater-Kunde', email: 'b@x.de', gesuche: [{ id: 'g_ber', titel: 'Haus Ulm', objekttypen: ['Haus'], lage: 'Ulm' }] },
      { id: 'k_privat_q', bereich: 'privat', privat_art: 'immobilienkunden', verantwortlich_email: 'quirin@firma.de', firma: 'Quirins Bekannter', gesuche: [{ id: 'g_pq', titel: 'Privat Ulm', objekttypen: ['Haus'], lage: 'Ulm' }] },
    ],
    objekte: [
      { id: 'o_ulm', bezeichnung: 'MFH Ulm Söflingen', adresse: 'Hauptstraße 1, 89077 Ulm', typ: 'Haus', kaufpreis: 1500000, status: 'aktiv', verkaufsdaten: { kennzahlen: { baujahr: 'ca. 1995' } }, activities: [{ id: 'a1', date: '2026-11-01', text: 'alt', user: 'x' }] },
      { id: 'o_ohne_bj', bezeichnung: 'Haus Ulm Ost', adresse: 'Ostweg 2, Ulm', typ: 'Haus', kaufpreis: 900000, status: 'aktiv', activities: [] },
      { id: 'o_verkauft', bezeichnung: 'Verkauft Ulm', adresse: 'Ulm', typ: 'Haus', kaufpreis: 500000, status: 'verkauft' },
      { id: 'o_privat_q', bezeichnung: 'Privathaus Ulm', adresse: 'Privatweg 1, Ulm', typ: 'Haus', kaufpreis: 400000, status: 'aktiv', privat_besitzer: 'quirin@firma.de' },
    ],
    objekt_freigaben: [],
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.test/app' }],
  }
}

function kontext(mitarbeiter: Zeile, db = falscheDatenbank(daten()), sendeMail?: SendeMail) {
  const protokoll: string[] = []
  const k: GesucheKontext = { supabase: db, mitarbeiter: mitarbeiter as GesucheKontext['mitarbeiter'], protokolliere: (t) => protokoll.push(t), heute: '2026-11-22', sendeMail }
  return { k, db, protokoll }
}

Deno.test('Werkzeugnamen werden erkannt', () => {
  for (const n of ['gesuche_suchen', 'passende_kaeufer', 'passende_objekte', 'portal_zugang_anlegen']) assert(istGesucheWerkzeug(n))
  assert(!istGesucheWerkzeug('objekte_suchen'))
})

Deno.test('passende_kaeufer: sortiert, mit Grund, ohne erledigte, zu teure und fremde Bereiche', async () => {
  const { k } = kontext(IMMO)
  const r = await fuehreGesucheWerkzeugAus('passende_kaeufer', { objekt_id: 'o_ulm' }, k)
  assertStringIncludes(r, '2 passende Gesuche, davon 2 ohne offene Punkte')
  // Müller passt in mehr Punkten (Objektart, Lage, Budget, Baujahr) als Klein (Objektart, Lage) → zuerst.
  assert(r.indexOf('Müller Invest') < r.indexOf('Klein'))
  assertStringIncludes(r, 'passt: Objektart Haus, Lage Hauptstraße 1, 89077 Ulm, Preis im Budget, Baujahr 1995')
  assertStringIncludes(r, 'kunde_id=k_mueller, gesuch_id=g_mfh')
  assertStringIncludes(r, 'Portal: noch kein Zugang')
  assertStringIncludes(r, 'keine E-Mail in der Akte') // bei Klein
  assert(!r.includes('g_alt'))
  assert(!r.includes('Zu wenig Geld'))
  assert(!r.includes('Berater-Kunde')) // Bereich Beratung ist für Quirin nicht freigegeben
  assert(!r.includes('Quirins Bekannter')) // private Gesuche nie gegen Holding-Objekte
})

Deno.test('passende_kaeufer: offene Punkte kommen nach hinten und lassen sich ausblenden', async () => {
  const { k } = kontext(GF)
  const r = await fuehreGesucheWerkzeugAus('passende_kaeufer', { objekt_id: 'o_ohne_bj' }, k)
  assertStringIncludes(r, 'noch offen: Baujahr beim Objekt nicht hinterlegt')
  assert(r.indexOf('Klein') < r.indexOf('Müller Invest'))
  assertStringIncludes(r, 'Berater-Kunde') // Geschäftsführung sieht alle Bereiche
  const nur = await fuehreGesucheWerkzeugAus('passende_kaeufer', { objekt_id: 'o_ohne_bj', nur_vollstaendige: true }, k)
  assert(!nur.includes('Müller Invest'))
})

Deno.test('passende_kaeufer: verkauftes Objekt, fehlende Rechte, fremdes privates Objekt', async () => {
  assertStringIncludes(await fuehreGesucheWerkzeugAus('passende_kaeufer', { objekt_id: 'o_verkauft' }, kontext(GF).k), 'steht nicht mehr zur Vermittlung')
  assertStringIncludes(await fuehreGesucheWerkzeugAus('passende_kaeufer', { objekt_id: 'o_ulm' }, kontext(BERATUNG).k), 'Nicht freigegeben')
  assertStringIncludes(await fuehreGesucheWerkzeugAus('passende_kaeufer', { objekt_id: 'o_privat_q' }, kontext(GF).k), 'Es gibt kein Objekt')
})

Deno.test('passende_kaeufer: privates Objekt nur gegen eigene private Gesuche', async () => {
  const r = await fuehreGesucheWerkzeugAus('passende_kaeufer', { objekt_id: 'o_privat_q' }, kontext({ ...IMMO, nurPrivat: true }).k)
  assertStringIncludes(r, 'Quirins Bekannter')
  assert(!r.includes('Müller'))
  assert(!r.includes('Portal:'))
})

Deno.test('passende_objekte: per Kunde und per Gesuch, ohne Verkauftes und Privates', async () => {
  const { k } = kontext(IMMO)
  const r = await fuehreGesucheWerkzeugAus('passende_objekte', { kunde_id: 'k_mueller' }, k)
  assertStringIncludes(r, 'Gesuch „MFH Ulm“ von Müller Invest (Hans Müller)')
  assertStringIncludes(r, '2 passende Objekte')
  assert(r.indexOf('o_ulm') < r.indexOf('o_ohne_bj'))
  assert(!r.includes('o_verkauft') && !r.includes('o_privat_q') && !r.includes('Alt erledigt'))
  const g = await fuehreGesucheWerkzeugAus('passende_objekte', { gesuch_id: 'g_klein' }, k)
  assertStringIncludes(g, 'Gesuch „Haus in Ulm“ von Klein')
  // Ein Gesuch aus einem nicht freigegebenen Bereich gibt es für Quirin nicht.
  assertStringIncludes(await fuehreGesucheWerkzeugAus('passende_objekte', { gesuch_id: 'g_ber' }, k), 'Dieses Gesuch gibt es nicht')
  assertStringIncludes(await fuehreGesucheWerkzeugAus('passende_objekte', { kunde_id: 'k_privat_q' }, kontext(GF).k), 'keine Akte')
})

Deno.test('gesuche_suchen: Suchwörter, Rechte, erledigte nur auf Wunsch', async () => {
  const { k } = kontext(IMMO)
  const alle = await fuehreGesucheWerkzeugAus('gesuche_suchen', {}, k)
  assertStringIncludes(alle, 'Müller Invest')
  assertStringIncludes(alle, 'Quirins Bekannter') // eigener privater Kontakt
  assert(!alle.includes('Berater-Kunde'))
  assert(!alle.includes('Alt erledigt'))
  const such = await fuehreGesucheWerkzeugAus('gesuche_suchen', { suchbegriff: 'muller saniert' }, k)
  assertEquals(such, 'Keine Gesuche zu „muller saniert“ gefunden.')
  const such2 = await fuehreGesucheWerkzeugAus('gesuche_suchen', { suchbegriff: 'Müller saniert' }, k)
  assertStringIncludes(such2, '1 Gesuch (offen)')
  assertStringIncludes(such2, 'bis 2.000.000 €')
  assertStringIncludes(such2, 'ab Baujahr 1990')
  const mit = await fuehreGesucheWerkzeugAus('gesuche_suchen', { kunde_id: 'k_mueller', mit_erledigten: true }, k)
  assertStringIncludes(mit, 'Alt erledigt')
})

Deno.test('portal_zugang_anlegen: legt Zugang wie im CRM an, ohne zu senden', async () => {
  let gesendet = 0
  const { k, db, protokoll } = kontext(IMMO, undefined, () => (gesendet++, Promise.resolve(null)))
  const r = await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm', kunde_id: 'k_mueller' }, k)
  assertStringIncludes(r, 'Angelegt: Zugang zum Interessenten-Portal von „MFH Ulm Söflingen“ für Hans Müller (hans@mueller.de)')
  assertStringIncludes(r, 'Noch nicht verschickt')
  assertEquals(gesendet, 0)
  const [f] = db.tabelle('objekt_freigaben')
  assertEquals(f.kunde_id, 'k_mueller')
  assertEquals(f.kunde_bereich, 'immobilienkunden')
  assertEquals(f.provision, PROVISION_VORSCHLAG)
  assertEquals(f.erstellt_von, 'Quirin')
  assertMatch(String(f.token), /^[A-Za-z0-9_-]{43}$/)
  assertStringIncludes(r, `Link: https://crm.test/app/#/formular/objekt/${f.token}`)
  const verlauf = verlaufVon(db, 'o_ulm')
  assertEquals(verlauf.length, 2)
  assertStringIncludes(verlauf[0].text, 'Zugang zum Interessenten-Portal für Hans Müller')
  assertEquals(protokoll.length, 1)

  // Zweiter Aufruf: vorhandener offener Zugang wird genommen, kein neuer.
  const r2 = await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm', kunde_id: 'k_mueller' }, k)
  assertStringIncludes(r2, 'schon einen offenen Zugang')
  assertEquals(db.tabelle('objekt_freigaben').length, 1)
  // passende_kaeufer zeigt den Zugang jetzt an.
  assertStringIncludes(await fuehreGesucheWerkzeugAus('passende_kaeufer', { objekt_id: 'o_ulm' }, k), 'Portal: Link angelegt, noch nicht zugestimmt')
})

Deno.test('portal_zugang_anlegen: senden=true schickt die Mail mit dem Text des Knopfs „Per E-Mail“', async () => {
  const mails: Parameters<SendeMail>[0][] = []
  const { k, db } = kontext(IMMO, undefined, (m) => (mails.push(m), Promise.resolve(null)))
  const r = await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm', kunde_id: 'k_mueller', senden: true }, k)
  assertStringIncludes(r, 'mit dem Link an hans@mueller.de geschickt')
  assertEquals(mails.length, 1)
  const f = db.tabelle('objekt_freigaben')[0]
  const erwartet = portalEinladung({ name: 'Hans Müller', objektBezeichnung: 'MFH Ulm Söflingen', link: `https://crm.test/app/#/formular/objekt/${f.token}`, absender: 'Quirin' })
  assertEquals(mails[0], { an: 'hans@mueller.de', anName: 'Hans Müller', betreff: erwartet.betreff, text: erwartet.text, kundeId: 'k_mueller', kundeBereich: 'immobilienkunden', kundeName: 'Hans Müller' })
  assertEquals(erwartet.betreff, 'Ihre Unterlagen zu MFH Ulm Söflingen')
  assertStringIncludes(verlaufVon(db, 'o_ulm')[0].text, 'und per Mail geschickt')
})

Deno.test('portal_zugang_anlegen: ohne Akte, Versandfehler, fehlende Adresse', async () => {
  const { k, db } = kontext(IMMO, undefined, () => Promise.resolve('Server nicht erreichbar'))
  const r = await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm', name: 'Eva Neu', email: 'Eva@Neu.de', provision: '2 %', senden: true }, k)
  assertStringIncludes(r, 'Nicht verschickt: Server nicht erreichbar')
  const f = db.tabelle('objekt_freigaben')[0]
  assertEquals([f.kunde_id, f.email, f.provision], [null, 'eva@neu.de', '2 %'])
  assertStringIncludes(await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm', kunde_id: 'k_klein', senden: true }, k), 'keine E-Mail-Adresse')
  assertEquals(db.tabelle('objekt_freigaben').length, 1)
  assertStringIncludes(await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm' }, k), 'Name des Interessenten fehlt')
  // Ohne Versandweg: mit senden nichts anlegen.
  assertStringIncludes(await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm', name: 'X Y', email: 'x@y.de', senden: true }, kontext(IMMO).k), 'Verschicken ist hier nicht möglich')
})

Deno.test('portal_zugang_anlegen: Rechte und nur Objekte der Holding', async () => {
  assertStringIncludes(await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm', kunde_id: 'k_mueller' }, kontext(BERATUNG).k), 'Nicht freigegeben')
  assertStringIncludes(await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm', kunde_id: 'k_beratung' }, kontext(IMMO).k), 'Nicht freigegeben')
  assertStringIncludes(await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_privat_q', name: 'A B' }, kontext(IMMO).k), 'nur für Objekte der Holding')
  assertStringIncludes(await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm', kunde_id: 'k_privat_q' }, kontext(IMMO).k), 'nur für Objekte der Holding')
  assertStringIncludes(await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm', name: 'A B' }, kontext({ ...IMMO, nurPrivat: true }).k), 'nur für Objekte der Holding')
  assertStringIncludes(await fuehreGesucheWerkzeugAus('portal_zugang_anlegen', { objekt_id: 'o_ulm', kunde_id: 'k_eingang_ungeklaert' }, kontext(IMMO).k), 'Sammelakten')
})

Deno.test('Schlüssel: 43 Zeichen base64url, jedes Mal neu', () => {
  const a = neuesToken()
  assertMatch(a, /^[A-Za-z0-9_-]{43}$/)
  assert(a !== neuesToken())
})
